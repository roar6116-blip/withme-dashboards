// 新規予約管理シートの明細タブを解析するロジック（Google API に依存しない純粋関数群）

/** YYYY-MM-DD を組み立てる */
export function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * セルの日付文字列を YYYY-MM-DD に正規化する。
 * シートには "2026/01/28" 形式で入っているが、"2026-1-8" や "1/28" の揺れも拾う。
 * 年が省略されている場合は fallbackYear を補う。
 */
export function parseCellDate(value, fallbackYear) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})$/);
  if (m && fallbackYear) return ymd(fallbackYear, Number(m[1]), Number(m[2]));

  return null;
}

const HEADER_ALIASES = {
  // 2026年のシートは「予約通知日」、2025年のシートは「予約日通知」で語順が違う
  date: ['予約通知日', '予約日通知', '通知日'],
  media: ['予約媒体', '媒体'],
  confirmed: ['予約確定', 'ステータス'],
  visit: ['来店状況', '来店'],
  contract: ['契約状況', '契約'],
};

/**
 * 3列（予約確定 / 来店状況 / 契約状況）からファネルの3段階を判定する。
 *
 * 注意点:
 * - 来店状況には `未来店` という値が入ることがある（新DBで導入）。
 *   単純な「来店を含む」判定では未来店を来店として数えてしまうため、否定形を除外する。
 * - 予約確定列には `SMS` `Gmail` `終了` `不在（2回）` 等の運用メモが入る行がある。
 *   来店・契約が付いていれば確定済とみなして取りこぼしを防ぐ。
 */
export function judgeStatus(confirmedCell, visitCell, contractCell) {
  const c = String(contractCell ?? '').trim();
  const v = String(visitCell ?? '').trim();
  const f = String(confirmedCell ?? '').trim();

  const isNegated = (s, word) => new RegExp(`(未|非)${word}|${word}(なし|無し|せず)`).test(s);

  const isContract = c.includes('契約') && !isNegated(c, '契約');
  const isVisit = (v.includes('来店') && !isNegated(v, '来店')) || isContract;
  const isConfirmed = (f.includes('確定') && !isNegated(f, '確定')) || isVisit;

  return { isConfirmed, isVisit, isContract };
}

/**
 * タブの値配列からヘッダー行を探し、項目→列インデックスの対応を返す。
 * 月別タブは左に余白列があったり、右側に集計ブロックが同居していたりするため、
 * 固定の列番号ではなくヘッダー名で引く。
 */
export function findHeader(rows) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? '').trim());
    const map = {};
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      const idx = cells.findIndex((c) => aliases.includes(c));
      if (idx >= 0) map[key] = idx;
    }
    // 日付と媒体が揃っていれば明細のヘッダー行とみなす
    if (map.date != null && map.media != null) return { rowIndex: i, map };
  }
  return null;
}

/**
 * 1タブ分の明細行を抽出する。
 * ステータスは3列に分かれている（予約確定 / 来店状況 / 契約状況）。
 * 「来店」「契約」が入っていれば確定も済んでいるとみなす（予約確定列に
 * 'Gmail' 等の運用メモが入っている行を取りこぼさないため）。
 */
export function extractRows(values, year) {
  const header = findHeader(values);
  if (!header) return [];

  const { rowIndex, map } = header;
  const out = [];

  for (let i = rowIndex + 1; i < values.length; i++) {
    const row = values[i] || [];
    const cell = (idx) => (idx == null ? '' : String(row[idx] ?? '').trim());

    const date = parseCellDate(cell(map.date), year);
    if (!date) continue; // 予約通知日が無い行は空行または集計行

    const status = judgeStatus(cell(map.confirmed), cell(map.visit), cell(map.contract));

    out.push({
      date,
      media: cell(map.media) || 'その他',
      ...status,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 新DB（予約明細タブ）

const DB_COLUMNS = {
  date: '予約通知日',
  store: '店舗',
  menu: 'メニュー',
  media: '予約媒体',
  confirmed: '予約確定',
  visit: '来店状況',
  contract: '契約状況',
  deleted: '削除フラグ',
  id: '予約ID',
};

/**
 * 【WithMe】新規予約管理DB の「予約明細」タブを解析する。
 * 店舗・メニューが列として持たれているため、店舗別ファイルのような外部情報は不要。
 * storeResolver は店舗名を店舗コードへ変換する関数（未知の店舗名は null を返す）。
 */
export function extractDbRows(values, storeResolver) {
  if (!values.length) return { rows: [], unknownStores: [], skipped: 0 };

  const header = (values[0] || []).map((c) => String(c ?? '').trim());
  const idx = {};
  for (const [key, name] of Object.entries(DB_COLUMNS)) {
    const i = header.indexOf(name);
    if (i >= 0) idx[key] = i;
  }
  const missing = ['date', 'store', 'menu', 'media', 'confirmed', 'visit', 'contract']
    .filter((k) => idx[k] == null);
  if (missing.length) {
    throw new Error(`予約明細タブに必要な列がありません: ${missing.map((k) => DB_COLUMNS[k]).join(', ')}`);
  }

  const rows = [];
  const unknownStores = new Set();
  let skipped = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const cell = (key) => (idx[key] == null ? '' : String(row[idx[key]] ?? '').trim());

    if (idx.id != null && !cell('id')) continue; // 空行
    if (idx.deleted != null && cell('deleted')) { skipped++; continue; } // 削除フラグ付き

    const date = parseCellDate(cell('date'));
    if (!date) { skipped++; continue; }

    const store = storeResolver(cell('store'));
    if (!store) { unknownStores.add(cell('store') || '(空)'); skipped++; continue; }

    rows.push({
      date,
      store,
      menu: cell('menu') || '未設定',
      media: cell('media') || 'その他',
      ...judgeStatus(cell('confirmed'), cell('visit'), cell('contract')),
    });
  }

  return { rows, unknownStores: [...unknownStores], skipped };
}

// ---------------------------------------------------------------- 集計バケット

export function newBucket() {
  return { count: 0, confirmed: 0, visit: 0, contract: 0 };
}

export function bump(bucket, row) {
  bucket.count += 1;
  if (row.isConfirmed) bucket.confirmed += 1;
  if (row.isVisit) bucket.visit += 1;
  if (row.isContract) bucket.contract += 1;
}

/** 率は小数第1位まで。母数0のときは null（画面側で「—」表示） */
export function pct(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** バケットを率つきの出力形に変換する */
export function finalize(bucket) {
  return {
    count: bucket.count,
    confirmed: bucket.confirmed,
    visit: bucket.visit,
    contract: bucket.contract,
    confirmedRate: pct(bucket.confirmed, bucket.count),
    visitRate: pct(bucket.visit, bucket.confirmed),
    bookingToVisitRate: pct(bucket.visit, bucket.count),
    contractRate: pct(bucket.contract, bucket.visit),
  };
}
