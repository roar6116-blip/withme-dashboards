// 予約ファネル集計の設定
// 新規予約管理シートは「店舗 × メニュー」ごとに 1 スプレッドシートで運用されている。
// ファイル名からどの店舗・どのメニューかを判定する。

// 店舗（物理店舗ベース。KaoKao は TouchMe 内に同居するサブブランドなので統合する）
export const STORES = [
  { code: 'sm-kofu', name: 'SlenderMe甲府店', nameEn: 'Slender Me · Kofu' },
  { code: 'tm-kofu', name: 'TouchMe甲府昭和店', nameEn: 'Touch Me · Kofu Showa' },
  { code: 'tm-fuji', name: 'TouchMe富士店', nameEn: 'Touch Me · Fuji' },
];

// メニュー（ヒートマップの列）
export const MENUS = ['痩身', '脱毛', 'フェイシャル'];

/**
 * 新DB「予約明細」タブの店舗名 → 店舗コード。
 * DB側で既に物理店舗単位（KaoKaoはTouchMeに同居）へ寄せられているため、
 * 表記ゆれの吸収だけを行う。
 */
export function resolveStore(storeName) {
  const s = String(storeName ?? '').trim();
  if (!s) return null;
  const hit = STORES.find((x) => x.name === s);
  if (hit) return hit.code;

  // 表記ゆれ用のフォールバック（空白・全角半角・「店」有無）
  const norm = s.replace(/\s|　/g, '').toLowerCase();
  const fallback = STORES.find((x) => norm.startsWith(x.name.replace(/店$/, '').toLowerCase()));
  return fallback ? fallback.code : null;
}

// 媒体の表示順。ここに無い媒体は「その他」に寄せずそのまま末尾に並べる
export const MEDIA_ORDER = [
  'HPB',
  'インスタ広告',
  'Google',
  'アフィリエイト',
  '友達紹介',
  '事業所内紹介',
  'チラシ',
  'ネット検索',
  'その他',
];

// 目標KPI（現行レポート踏襲）
export const TARGET = { confirmedRate: 80, visitRate: 80, bookingToVisitRate: 64 };

// ブランド既定のメニュー。ファイル名に（痩身）（脱毛）等の明示があればそちらを優先する
const BRAND_DEFAULT_MENU = {
  slenderme: '痩身',
  touchme: '脱毛',
  kaokao: 'フェイシャル',
};

/**
 * 新規予約管理シートのファイル名から店舗コードとメニューを判定する。
 * 例:
 *   '01slenderme甲府店_新規予約管理シート_2026年'      → { store:'sm-kofu', menu:'痩身' }
 *   '02kaokao甲府店_新規予約管理シート_2026年'          → { store:'tm-kofu', menu:'フェイシャル' }
 *   '03touchme富士店（痩身）_新規予約管理シート_2026年'  → { store:'tm-fuji', menu:'痩身' }
 *   'slenderme富士店_新規予約管理シート_2025年'          → { store:'tm-fuji', menu:'痩身' }
 *     ※ SlenderMe富士店は 2026/02/01 に TouchMe富士店へ統合済のため、
 *        前年比較でも TM富士 の一部として扱う
 * 判定できないファイルは null を返し、呼び出し側でスキップする。
 */
export function classifyFile(title) {
  const t = String(title).toLowerCase();
  if (!t.includes('新規予約管理シート')) return null;

  const brand = ['slenderme', 'touchme', 'kaokao'].find((b) => t.includes(b));
  if (!brand) return null;

  const isFuji = t.includes('富士');
  const isKofu = t.includes('甲府');
  if (!isFuji && !isKofu) return null;

  let store;
  if (isFuji) store = 'tm-fuji';
  else if (brand === 'slenderme') store = 'sm-kofu';
  else store = 'tm-kofu';

  // ファイル名に括弧付きでメニューが明示されている場合はそれを優先
  let menu = BRAND_DEFAULT_MENU[brand];
  if (t.includes('痩身')) menu = '痩身';
  else if (t.includes('脱毛')) menu = '脱毛';
  else if (t.includes('フェイシャル')) menu = 'フェイシャル';

  return { store, menu, brand };
}

/**
 * 月別タブかどうか。
 * 実際のタブ名は「1月」〜「12月」（他に「集計」「後追い」がある）。
 * 全角数字や末尾のサフィックス（"１月_新規予約管理表" 等）も許容しておく。
 */
export function isMonthlyTab(sheetTitle) {
  const normalized = String(sheetTitle).replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const m = normalized.match(/^\s*(\d{1,2})\s*月/);
  if (!m) return false;
  const month = Number(m[1]);
  return month >= 1 && month <= 12;
}
