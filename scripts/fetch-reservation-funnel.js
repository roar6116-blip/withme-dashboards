// 新規予約管理データから予約ファネルを集計し salon/data/funnel.json を生成する。
//
// データ源は2系統ある:
//   当年（2026年以降） … 【WithMe】新規予約管理DB の「予約明細」タブ（単一シートの正規化テーブル）
//   前年（2025年）     … 旧方式の店舗×メニュー別スプレッドシート群（前年同期比較のためだけに読む）
//
// 出力するのは集計済みの件数と率のみ。顧客名・電話番号・契約金額は一切書き出さない。
//
// 必要な環境変数:
//   GOOGLE_SERVICE_ACCOUNT_JSON  サービスアカウント鍵（JSON文字列）
//   RESERVATION_DB_ID            新規予約管理DBのスプレッドシートID
//   RESERVATION_FOLDER_PREV      前年（2025年）の旧シートが入った Drive フォルダID
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import {
  STORES,
  MENUS,
  MEDIA_ORDER,
  TARGET,
  classifyFile,
  isMonthlyTab,
  resolveStore,
} from './funnel-config.js';
import {
  ymd,
  extractRows,
  extractDbRows,
  newBucket,
  bump,
  finalize,
} from './funnel-parse.js';

const DB_SHEET_NAME = '予約明細';

// リポジトリルートからでも scripts/ からでも同じ場所に書き出せるよう、
// このファイルの位置を基準に解決する
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(REPO_ROOT, 'salon', 'data', 'funnel.json');
const warnings = [];

// ---------------------------------------------------------------- 日付ユーティリティ

/** 実行時点の JST の「今日」を YYYY-MM-DD で返す */
function todayJst() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- Google API

async function listSpreadsheetsRecursive(drive, folderId, acc = []) {
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 200,
      pageToken,
    });
    for (const f of res.data.files || []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        await listSpreadsheetsRecursive(drive, f.id, acc);
      } else if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
        acc.push(f);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return acc;
}

/** 新DBの「予約明細」タブを丸ごと読み、明細行に変換する */
async function readReservationDb(sheetsApi, dbId) {
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: dbId,
    range: `'${DB_SHEET_NAME}'!A:AD`,
    majorDimension: 'ROWS',
  });
  const values = res.data.values || [];
  if (values.length <= 1) throw new Error(`${DB_SHEET_NAME} タブにデータがありません`);

  const { rows, unknownStores, skipped } = extractDbRows(values, resolveStore);
  if (unknownStores.length) {
    warnings.push(`新DB: 未知の店舗名を除外しました（${unknownStores.join(' / ')}）`);
  }
  console.log(`[funnel] 新規予約管理DB: ${rows.length} rows（除外 ${skipped}）`);
  return rows;
}

/** 1スプレッドシートの全月別タブから明細行を読み出す */
async function readSpreadsheet(sheetsApi, fileId, fileName, year) {
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId: fileId,
    fields: 'sheets.properties.title',
  });
  const tabs = (meta.data.sheets || [])
    .map((s) => s.properties.title)
    .filter(isMonthlyTab);

  if (tabs.length === 0) {
    warnings.push(`${fileName}: 月別タブが見つかりませんでした`);
    return [];
  }

  const res = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId: fileId,
    ranges: tabs.map((t) => `'${t.replace(/'/g, "''")}'!A1:Z400`),
    majorDimension: 'ROWS',
  });

  const rows = [];
  for (const range of res.data.valueRanges || []) {
    rows.push(...extractRows(range.values || [], year));
  }
  return rows;
}

// ---------------------------------------------------------------- メイン

async function main() {
  const required = [
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'RESERVATION_DB_ID',
    'RESERVATION_FOLDER_PREV',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[funnel] 環境変数が未設定です: ${missing.join(', ')}`);
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
  const drive = google.drive({ version: 'v3', auth });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  // 本日（JST）までを集計対象にする。
  // DBは随時更新されるため当日分も含めて出す（入力途中の当日分が混ざる前提）。
  const asOf = todayJst();
  const [year, month, day] = asOf.split('-').map(Number);

  const periods = {
    month: {
      label: `${year}年${month}月（1日〜${day}日）`,
      from: ymd(year, month, 1),
      to: asOf,
    },
    ytd: {
      label: `${year}年 累計（1/1〜${month}/${day}）`,
      from: ymd(year, 1, 1),
      to: asOf,
    },
    prevMonth: {
      label: `${year - 1}年${month}月（1日〜${day}日）`,
      from: ymd(year - 1, month, 1),
      to: ymd(year - 1, month, day),
    },
    prevYtd: {
      label: `${year - 1}年 同期（1/1〜${month}/${day}）`,
      from: ymd(year - 1, 1, 1),
      to: ymd(year - 1, month, day),
    },
  };

  // 各期間の比較相手（前年同月 / 前年同期）
  const COMPARE = { month: 'prevMonth', ytd: 'prevYtd' };

  const inPeriod = (date, p) => date >= p.from && date <= p.to;

  const records = [];
  const sources = { current: [], prev: [] };

  // --- 当年: 新規予約管理DB（単一シート） ---
  // ここが落ちたら集計自体が成立しないので、警告ではなく異常終了させて前回のJSONを残す
  const dbRows = await readReservationDb(sheetsApi, process.env.RESERVATION_DB_ID);
  records.push(...dbRows);
  sources.current.push({ name: '【WithMe】新規予約管理DB / 予約明細', rows: dbRows.length });

  // --- 前年: 旧方式の店舗×メニュー別シート（前年同期比較のためだけに読む） ---
  const prevFiles = [];
  for (const f of await listSpreadsheetsRecursive(drive, process.env.RESERVATION_FOLDER_PREV)) {
    const cls = classifyFile(f.name);
    if (cls) prevFiles.push({ ...f, ...cls });
  }
  if (prevFiles.length === 0) {
    warnings.push('前年（旧シート）が1件も見つかりませんでした。前年比較は空になります');
  }
  const prevYearPrefix = `${year - 1}-`;
  let prevOutOfRange = 0;
  for (const f of prevFiles) {
    try {
      const all = await readSpreadsheet(sheetsApi, f.id, f.name, year - 1);
      // 旧シートには当年日付の行が紛れていることがある。当年は新DBが正なので、
      // 前年ファイルからは前年の行だけを採用して二重計上を防ぐ
      const rows = all.filter((r) => r.date.startsWith(prevYearPrefix));
      prevOutOfRange += all.length - rows.length;
      for (const r of rows) records.push({ ...r, store: f.store, menu: f.menu });
      sources.prev.push({ name: f.name, store: f.store, menu: f.menu, rows: rows.length });
      console.log(`[funnel] ${f.name}: ${rows.length} rows`);
    } catch (e) {
      warnings.push(`${f.name}: 読み込み失敗 (${e.message})`);
      console.error(`[funnel] ${f.name} 読み込み失敗:`, e.message);
    }
  }

  if (prevOutOfRange > 0) {
    console.log(`[funnel] 前年ファイル内の${year}年日付の行 ${prevOutOfRange}件を除外（当年は新DBが正）`);
  }

  if (records.length === 0) {
    console.error('[funnel] 明細行を1件も読み取れませんでした。既存JSONを維持します。');
    process.exit(1);
  }

  // --- 集計 ---
  const periodKeys = ['month', 'ytd', 'prevMonth', 'prevYtd'];
  const total = {};
  const byStore = {};
  const byMedia = {};
  const byMediaStore = {}; // 媒体 × 店舗のクロス（媒体別テーブルの展開用）
  const byStoreMenu = {};

  for (const key of periodKeys) {
    total[key] = newBucket();
    byStore[key] = {};
    byMedia[key] = {};
    byMediaStore[key] = {};
    byStoreMenu[key] = {};
    for (const s of STORES) {
      byStore[key][s.code] = newBucket();
      byStoreMenu[key][s.code] = {};
      for (const m of MENUS) byStoreMenu[key][s.code][m] = newBucket();
    }
  }

  for (const r of records) {
    for (const key of periodKeys) {
      if (!inPeriod(r.date, periods[key])) continue;
      bump(total[key], r);
      if (byStore[key][r.store]) bump(byStore[key][r.store], r);
      if (!byMedia[key][r.media]) byMedia[key][r.media] = newBucket();
      bump(byMedia[key][r.media], r);
      if (!byMediaStore[key][r.media]) {
        byMediaStore[key][r.media] = Object.fromEntries(STORES.map((s) => [s.code, newBucket()]));
      }
      const mediaStoreBucket = byMediaStore[key][r.media][r.store];
      if (mediaStoreBucket) bump(mediaStoreBucket, r);
      const menuBucket = byStoreMenu[key][r.store]?.[r.menu];
      if (menuBucket) bump(menuBucket, r);
    }
  }

  // 媒体は「今年累計の予約発生数」が多い順。表示順リストにあるものを優先して並べる
  const mediaNames = [...new Set(Object.keys(byMedia.ytd).concat(Object.keys(byMedia.month)))];
  mediaNames.sort((a, b) => {
    const ia = MEDIA_ORDER.indexOf(a);
    const ib = MEDIA_ORDER.indexOf(b);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return (byMedia.ytd[b]?.count || 0) - (byMedia.ytd[a]?.count || 0);
  });

  const perPeriod = (pick) =>
    Object.fromEntries(periodKeys.map((k) => [k, finalize(pick(k))]));

  const output = {
    generatedAt: new Date().toISOString(),
    asOf,
    target: TARGET,
    periods,
    compare: COMPARE,
    total: perPeriod((k) => total[k]),
    stores: STORES.map((s) => ({
      code: s.code,
      name: s.name,
      nameEn: s.nameEn,
      ...perPeriod((k) => byStore[k][s.code]),
    })),
    media: mediaNames.map((name) => ({
      name,
      ...perPeriod((k) => byMedia[k][name] || newBucket()),
      // 媒体行を展開したときに出す店舗別の内訳
      stores: STORES.map((s) => ({
        code: s.code,
        name: s.name,
        ...perPeriod((k) => byMediaStore[k][name]?.[s.code] || newBucket()),
      })),
    })),
    heatmap: {
      menus: MENUS,
      stores: STORES.map((s) => ({
        code: s.code,
        name: s.name,
        menus: Object.fromEntries(
          MENUS.map((m) => [m, perPeriod((k) => byStoreMenu[k][s.code][m])])
        ),
        total: perPeriod((k) => byStore[k][s.code]),
      })),
    },
    sources,
    warnings,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(
    `[funnel] 書き出し完了 asOf=${asOf} 明細${records.length}件 警告${warnings.length}件`
  );
  if (warnings.length) warnings.forEach((w) => console.warn(`[funnel] WARN ${w}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
