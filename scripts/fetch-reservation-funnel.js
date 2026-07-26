// 新規予約管理シート（店舗×メニュー別スプレッドシート）から予約ファネルを集計し
// salon/data/funnel.json を生成する。
//
// 出力するのは集計済みの件数と率のみ。顧客名・電話番号・契約金額は一切書き出さない。
//
// 必要な環境変数:
//   GOOGLE_SERVICE_ACCOUNT_JSON  サービスアカウント鍵（JSON文字列）
//   RESERVATION_FOLDER_CURRENT   当年の新規予約管理シートが入った Drive フォルダID
//   RESERVATION_FOLDER_PREV      前年の新規予約管理シートが入った Drive フォルダID
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
} from './funnel-config.js';
import { ymd, extractRows, newBucket, bump, finalize } from './funnel-parse.js';

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
    'RESERVATION_FOLDER_CURRENT',
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

  // 「昨日まで」を集計対象にする（当日は入力途中のため）
  const today = todayJst();
  const [ty, tm, td] = today.split('-').map(Number);
  const asOfDate = new Date(Date.UTC(ty, tm - 1, td - 1));
  const year = asOfDate.getUTCFullYear();
  const month = asOfDate.getUTCMonth() + 1;
  const day = asOfDate.getUTCDate();
  const asOf = ymd(year, month, day);

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

  // --- ファイル探索 ---
  const files = [];
  for (const [folderKey, envKey, fileYear] of [
    ['current', 'RESERVATION_FOLDER_CURRENT', year],
    ['prev', 'RESERVATION_FOLDER_PREV', year - 1],
  ]) {
    const found = await listSpreadsheetsRecursive(drive, process.env[envKey]);
    for (const f of found) {
      const cls = classifyFile(f.name);
      if (!cls) continue;
      files.push({ ...f, ...cls, folderKey, fileYear });
    }
  }

  if (files.length === 0) {
    console.error('[funnel] 対象スプレッドシートが1件も見つかりませんでした');
    process.exit(1);
  }

  // --- 読み込み ---
  const records = [];
  const sources = { current: [], prev: [] };
  for (const f of files) {
    try {
      const rows = await readSpreadsheet(sheetsApi, f.id, f.name, f.fileYear);
      for (const r of rows) records.push({ ...r, store: f.store, menu: f.menu });
      sources[f.folderKey].push({ name: f.name, store: f.store, menu: f.menu, rows: rows.length });
      console.log(`[funnel] ${f.name}: ${rows.length} rows`);
    } catch (e) {
      warnings.push(`${f.name}: 読み込み失敗 (${e.message})`);
      console.error(`[funnel] ${f.name} 読み込み失敗:`, e.message);
    }
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
