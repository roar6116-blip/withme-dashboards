// schema v2.0 (6ブランド店舗単位) で reviews.json を生成
// - Google: cache/google-reviews.json から取得 (Text Search 経由)
// - HPB:    既存 reviews.json から維持 (手動入力)
import fs from 'node:fs';
import path from 'node:path';
import { STORES } from './stores-config.js';

const CACHE_DIR = path.resolve('scripts/cache');
const OUTPUT = path.resolve('salon/data/reviews.json');

function readCache(name) {
  const p = path.join(CACHE_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
function readExisting() {
  return fs.existsSync(OUTPUT) ? JSON.parse(fs.readFileSync(OUTPUT, 'utf8')) : null;
}

function calcWeightedRating(items) {
  const total = items.reduce((a, i) => a + (i.review_count || 0), 0);
  if (total === 0) return 0;
  const sum = items.reduce((a, i) => a + (i.rating || 0) * (i.review_count || 0), 0);
  return Number((sum / total).toFixed(2));
}

function calcScore(store, allMaxCount) {
  const totalCount = store.totals.review_count;
  const rating = store.totals.weighted_rating;
  const blogTotal = store.totals.blog_count_total;

  const countScore = (totalCount / allMaxCount) * 60;
  const ratingScore = Math.max(0, Math.min(1, (rating - 4.0) / 1.0)) * 30;
  const blogScore = Math.min(1, blogTotal / 500) * 10;

  return Math.round(countScore + ratingScore + blogScore);
}

function main() {
  const googleCache = readCache('google-reviews.json');
  const hpbCache = readCache('hpb-data.json');
  const existing = readExisting();

  const stores = STORES.map(meta => {
    const prevStore = existing?.stores.find(s => s.store_id === meta.store_id);
    const gFromCache = googleCache?.[meta.store_id];
    const hFromCache = hpbCache?.[meta.store_id];

    // HPB
    const hpbAvailable = meta.hpb?.available !== false && !!meta.hpb?.url;
    const prevHpb = prevStore?.hpb || {};
    const hpb = hpbAvailable ? {
      salon_name: meta.hpb.salon_name,
      url: meta.hpb.url,
      review_count: hFromCache?.review_count ?? prevHpb.review_count ?? 0,
      rating: hFromCache?.rating ?? prevHpb.rating ?? 0,
      blog_count_total: hFromCache?.blog_count_total ?? prevHpb.blog_count_total ?? 0,
      blog_count_this_month: hFromCache?.blog_count_this_month ?? prevHpb.blog_count_this_month ?? 0,
      new_reviews_this_month: hFromCache?.new_reviews_this_month ?? prevHpb.new_reviews_this_month ?? 0,
      available: true
    } : {
      salon_name: null,
      url: null,
      review_count: 0,
      rating: 0,
      blog_count_total: 0,
      blog_count_this_month: 0,
      new_reviews_this_month: 0,
      available: false,
      note: meta.hpb?.note || 'HPB広告ページなし'
    };

    // Google
    const prevGoogle = prevStore?.google || {};
    const google = {
      label: gFromCache?.label || meta.google?.label,
      url: gFromCache?.place_id
        ? `https://www.google.com/maps/place/?q=place_id:${gFromCache.place_id}`
        : prevGoogle.url || null,
      review_count: gFromCache?.review_count ?? prevGoogle.review_count ?? 0,
      rating: gFromCache?.rating ?? prevGoogle.rating ?? 0,
      new_reviews_this_month: gFromCache?.new_reviews_this_month ?? prevGoogle.new_reviews_this_month ?? 0
    };
    if (gFromCache?.place_id) google.place_id = gFromCache.place_id;

    return {
      store_id: meta.store_id,
      store_name: meta.store_name,
      brand: meta.brand,
      area: meta.area,
      hpb,
      google,
      monthly_trend: prevStore?.monthly_trend || []
    };
  });

  // totals
  for (const s of stores) {
    const totalCount = (s.hpb.available ? s.hpb.review_count : 0) + s.google.review_count;
    const items = [
      ...(s.hpb.available ? [{ rating: s.hpb.rating, review_count: s.hpb.review_count }] : []),
      { rating: s.google.rating, review_count: s.google.review_count }
    ];
    s.totals = {
      review_count: totalCount,
      weighted_rating: calcWeightedRating(items),
      blog_count_total: s.hpb.available ? s.hpb.blog_count_total : 0,
      blog_count_this_month: s.hpb.available ? s.hpb.blog_count_this_month : 0,
      new_reviews_this_month: (s.hpb.available ? s.hpb.new_reviews_this_month : 0) + s.google.new_reviews_this_month
    };
  }

  // スコア + ランキング
  const maxCount = Math.max(1, ...stores.map(s => s.totals.review_count));
  for (const s of stores) {
    s.score = calcScore(s, maxCount);
  }
  const sorted = [...stores].sort((a, b) => b.score - a.score);
  sorted.forEach((s, i) => { s.rank = i + 1; });

  // 全社サマリー
  const totalReviews = stores.reduce((a, s) => a + s.totals.review_count, 0);
  const company_totals = {
    total_reviews: totalReviews,
    total_new_this_month: stores.reduce((a, s) => a + s.totals.new_reviews_this_month, 0),
    average_rating: Number(
      (stores.reduce((a, s) => a + s.totals.weighted_rating * s.totals.review_count, 0) / Math.max(1, totalReviews)).toFixed(2)
    ),
    total_blog_this_month: stores.reduce((a, s) => a + s.totals.blog_count_this_month, 0),
    total_blog_all: stores.reduce((a, s) => a + s.totals.blog_count_total, 0),
    store_count: stores.length
  };

  // アラート
  const alerts = [];
  const top = sorted[0];
  if (top) {
    alerts.push({
      level: 'info',
      store_id: top.store_id,
      message: `${top.store_name} が総合1位（HPB+Google合計 ${top.totals.review_count}件・★${top.totals.weighted_rating}）`
    });
  }

  const out = {
    schema_version: '2.0.0',
    schema_note: '6ブランド店舗単位の集計（広告露出単位）',
    generated_at: new Date().toISOString(),
    data_sources: {
      google: googleCache ? 'Places API Text Search (auto, hourly)' : 'inherited from previous',
      hpb: hpbCache ? 'Spreadsheet (auto)' : 'manual input (sample values)',
      blog: 'manual input (placeholder values)',
      monthly_trend: existing?.data_sources?.monthly_trend || 'inherited'
    },
    stores,
    company_totals,
    alerts
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  console.log('[build] reviews.json written');
}

main();
