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
  date: ['予約通知日', '通知日'],
  media: ['予約媒体', '媒体'],
  confirmed: ['予約確定', 'ステータス'],
  visit: ['来店状況', '来店'],
  contract: ['契約状況', '契約'],
};

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

    const isContract = cell(map.contract).includes('契約');
    const isVisit = cell(map.visit).includes('来店') || isContract;
    const isConfirmed = cell(map.confirmed).includes('確定') || isVisit;

    out.push({
      date,
      media: cell(map.media) || 'その他',
      isConfirmed,
      isVisit,
      isContract,
    });
  }
  return out;
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
