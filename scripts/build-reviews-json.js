// 取得済みキャッシュをマージして salon/data/reviews.json を生成
import fs from 'node:fs';
import path from 'node:path';
import { STORES, SCORE_WEIGHTS, ALERT_THRESHOLDS } from './stores-config.js';

const CACHE_DIR = path.resolve('scripts/cache');
const OUTPUT = path.resolve('salon/data/reviews.json');

function readCache(name) {
  const p = path.join(CACHE_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
function readExisting() {
  return fs.existsSync(OUTPUT) ? JSON.parse(fs.readFileSync(OUTPUT, 'utf8')) : null;
}

function findExistingStore(existing, storeId) {
  if (!existing) return null;
  return existing.stores.find(s => s.store_id === storeId) || null;
}
function findExistingHpb(prevStore, salonName) {
  if (!prevStore) return null;
  return prevStore.hpb_salons.find(h => h.salon_name === salonName) || null;
}
function findExistingGbp(prevStore, label) {
  if (!prevStore) return null;
  return prevStore.google_business_profiles.find(g => g.label === label) || null;
}

function calcWeightedRating(items) {
  const total = items.reduce((a, i) => a + i.review_count, 0);
  if (total === 0) return 0;
  const sum = items.reduce((a, i) => a + i.rating * i.review_count, 0);
  return Number((sum / total).toFixed(2));
}

function calcScore(store, totals, allTotals) {
  const w = SCORE_WEIGHTS;
  let score = 0;

  // HPB件数シェア
  const hpbCount = store.hpb_salons.reduce((a, h) => a + h.review_count, 0);
  score += allTotals.hpb_count > 0
    ? (hpbCount / allTotals.hpb_count) * w.hpb_count_share * STORES.length
    : 0;

  // HPB平均評価 (★4.0未満で0、★5.0で満点)
  const hpbRating = calcWeightedRating(store.hpb_salons);
  score += Math.max(0, Math.min(1, (hpbRating - 4.0) / 1.0)) * w.hpb_rating;

  // Google件数シェア
  const googleCount = store.google_business_profiles.reduce((a, g) => a + g.review_count, 0);
  score += allTotals.google_count > 0
    ? (googleCount / allTotals.google_count) * w.google_count_share * STORES.length
    : 0;

  // Google平均評価
  const googleRating = calcWeightedRating(store.google_business_profiles);
  score += Math.max(0, Math.min(1, (googleRating - 4.0) / 1.0)) * w.google_rating;

  // 月次ブログ
  const blogMonth = store.hpb_salons.reduce((a, h) => a + (h.blog_count_this_month || 0), 0);
  score += Math.min(1, blogMonth / 10) * w.blog_monthly;

  // 直近の新規獲得（簡易：今月新着 / 期待値10件で頭打ち）
  const newThisMonth = store.hpb_salons.reduce((a, h) => a + h.new_reviews_this_month, 0)
                    + store.google_business_profiles.reduce((a, g) => a + g.new_reviews_this_month, 0);
  score += Math.min(1, newThisMonth / 10) * w.recent_growth;

  return Math.round(Math.min(100, score));
}

function buildAlerts(stores) {
  const alerts = [];
  // 1位店舗
  const top = stores.find(s => s.rank === 1);
  if (top) {
    const newCount = top.totals.new_reviews_this_month;
    if (newCount > 0) {
      alerts.push({ level: 'info', store_id: top.store_id, message: `${top.physical_name}が今月新着${newCount}件で全社1位` });
    }
  }
  // 評価4.5未満
  for (const s of stores) {
    if (s.totals.weighted_rating > 0 && s.totals.weighted_rating < ALERT_THRESHOLDS.rating_warn) {
      alerts.push({ level: 'warn', store_id: s.store_id, message: `${s.physical_name}の平均評価が★${s.totals.weighted_rating}（閾値★${ALERT_THRESHOLDS.rating_warn}を下回る）` });
    }
  }
  // ブログ0本
  for (const s of stores) {
    if (s.totals.blog_count_this_month === 0) {
      alerts.push({ level: 'warn', store_id: s.store_id, message: `${s.physical_name}は今月ブログ投稿0本` });
    }
  }
  return alerts;
}

function main() {
  const googleCache = readCache('google-reviews.json');
  const hpbCache = readCache('hpb-data.json');
  const existing = readExisting();

  // 既存データを継承しつつ、キャッシュがあれば上書き
  const stores = STORES.map(meta => {
    const prev = findExistingStore(existing, meta.store_id);

    const hpb_salons = meta.hpb_salons.map(s => {
      const prevH = findExistingHpb(prev, s.salon_name);
      const fromCache = hpbCache?.find(h => h.salon_name === s.salon_name);
      return {
        salon_name: s.salon_name,
        review_count: fromCache?.review_count ?? prevH?.review_count ?? 0,
        rating: fromCache?.rating ?? prevH?.rating ?? 0,
        blog_count_total: fromCache?.blog_count_total ?? prevH?.blog_count_total ?? 0,
        blog_count_this_month: prevH?.blog_count_this_month ?? 0,
        new_reviews_this_month: fromCache?.new_reviews_this_month ?? prevH?.new_reviews_this_month ?? 0
      };
    });

    const google_business_profiles = meta.google_business_profiles.map(g => {
      const prevG = findExistingGbp(prev, g.label);
      const fromCache = googleCache?.[meta.store_id]?.find(c => c.label === g.label);
      const out = {
        label: g.label,
        review_count: fromCache?.review_count ?? prevG?.review_count ?? 0,
        rating: fromCache?.rating ?? prevG?.rating ?? 0,
        new_reviews_this_month: fromCache?.new_reviews_this_month ?? prevG?.new_reviews_this_month ?? 0,
        primary: g.primary
      };
      if (g.internal_note) out.internal_note = g.internal_note;
      return out;
    });

    return { ...meta, hpb_salons, google_business_profiles };
  });

  // 全店合計（スコア計算用）
  const allTotals = {
    hpb_count: stores.reduce((a, s) => a + s.hpb_salons.reduce((aa, h) => aa + h.review_count, 0), 0),
    google_count: stores.reduce((a, s) => a + s.google_business_profiles.reduce((aa, g) => aa + g.review_count, 0), 0)
  };

  // totalsとscore算出
  for (const s of stores) {
    const hpbCount = s.hpb_salons.reduce((a, h) => a + h.review_count, 0);
    const googleCount = s.google_business_profiles.reduce((a, g) => a + g.review_count, 0);
    const hpbNew = s.hpb_salons.reduce((a, h) => a + h.new_reviews_this_month, 0);
    const googleNew = s.google_business_profiles.reduce((a, g) => a + g.new_reviews_this_month, 0);
    const blogTotal = s.hpb_salons.reduce((a, h) => a + h.blog_count_total, 0);
    const blogMonth = s.hpb_salons.reduce((a, h) => a + (h.blog_count_this_month || 0), 0);

    s.totals = {
      review_count: hpbCount + googleCount,
      weighted_rating: calcWeightedRating([...s.hpb_salons, ...s.google_business_profiles]),
      blog_count_total: blogTotal,
      blog_count_this_month: blogMonth,
      new_reviews_this_month: hpbNew + googleNew
    };
    s.score = calcScore(s, s.totals, allTotals);
  }

  // ランキング
  const sorted = [...stores].sort((a, b) => b.score - a.score);
  sorted.forEach((s, i) => { s.rank = i + 1; });

  // 全社サマリー
  const company_totals = {
    total_reviews: stores.reduce((a, s) => a + s.totals.review_count, 0),
    total_new_this_month: stores.reduce((a, s) => a + s.totals.new_reviews_this_month, 0),
    average_rating: Number(
      (stores.reduce((a, s) => a + s.totals.weighted_rating * s.totals.review_count, 0) /
       Math.max(1, stores.reduce((a, s) => a + s.totals.review_count, 0))).toFixed(2)
    ),
    total_blog_this_month: stores.reduce((a, s) => a + s.totals.blog_count_this_month, 0),
    total_blog_all: stores.reduce((a, s) => a + s.totals.blog_count_total, 0)
  };

  const out = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    data_sources: {
      google: googleCache ? 'GBP API (auto, hourly)' : 'inherited from previous',
      hpb: hpbCache ? 'Spreadsheet (auto)' : 'inherited from previous',
      blog: 'Spreadsheet manual input (monthly)'
    },
    stores,
    company_totals,
    alerts: buildAlerts(stores)
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  console.log('[build] reviews.json written');
}

main();
