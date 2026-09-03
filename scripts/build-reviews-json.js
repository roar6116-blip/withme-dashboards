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
  const hpbTrendsCache = readCache('hpb-trends.json'); // 週次 fetch-hpb-trends.js 由来
  const existing = readExisting();

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const stores = STORES.map(meta => {
    const prevStore = existing?.stores.find(s => s.store_id === meta.store_id);
    const gFromCache = googleCache?.[meta.store_id];
    const hFromCache = hpbCache?.[meta.store_id];
    const trendsForStore = hpbTrendsCache?.stores?.[meta.store_id];

    // HPB
    const hpbAvailable = meta.hpb?.available !== false && !!meta.hpb?.url;
    const prevHpb = prevStore?.hpb || {};
    // 今月（暦月）の新着件数・ブログ件数を trends の月別集計から算出（あれば優先）
    const newReviewsFromTrends = trendsForStore?.monthly_reviews?.[currentMonth];
    const blogThisMonthFromTrends = trendsForStore?.monthly_blogs?.[currentMonth];
    // 直近30日（ローリング）の新着件数・ブログ件数。比較表など「今月」表示の主軸はこちらに統一
    const new30dReviews = trendsForStore?.period_summary?.p30?.reviews;
    const new30dBlogs = trendsForStore?.period_summary?.p30?.blogs;
    const hpb = hpbAvailable ? {
      salon_name: meta.hpb.salon_name,
      url: meta.hpb.url,
      // 累計件数・評価・ブログ累計は fetch-hpb-trends.js が毎日 HPB 公式ページの
      // 構造化データ(JSON-LD)から取得する。取得失敗時のみ前回値を維持。
      review_count: trendsForStore?.review_count ?? hFromCache?.review_count ?? prevHpb.review_count ?? 0,
      rating: trendsForStore?.rating ?? hFromCache?.rating ?? prevHpb.rating ?? 0,
      blog_count_total: trendsForStore?.blog_count_total ?? hFromCache?.blog_count_total ?? prevHpb.blog_count_total ?? 0,
      blog_count_this_month: blogThisMonthFromTrends ?? hFromCache?.blog_count_this_month ?? prevHpb.blog_count_this_month ?? 0,
      new_reviews_this_month: newReviewsFromTrends ?? hFromCache?.new_reviews_this_month ?? prevHpb.new_reviews_this_month ?? 0,
      new_reviews_30d: new30dReviews ?? prevHpb.new_reviews_30d ?? 0,
      new_blogs_30d: new30dBlogs ?? prevHpb.new_blogs_30d ?? 0,
      available: true
    } : {
      salon_name: null,
      url: null,
      review_count: 0,
      rating: 0,
      blog_count_total: 0,
      blog_count_this_month: 0,
      new_reviews_this_month: 0,
      new_reviews_30d: 0,
      new_blogs_30d: 0,
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

    // 期間別集計データ: hpb-trends.json があれば優先、なければ前回値を引き継ぐ
    const trends = hpbTrendsCache?.stores?.[meta.store_id];
    const monthlyReviews = trends?.monthly_reviews || prevStore?.monthly_reviews || {};
    const monthlyBlogs = trends?.monthly_blogs || prevStore?.monthly_blogs || {};
    const periodSummary = trends?.period_summary || prevStore?.period_summary || {};
    // monthly_trend は monthly_reviews から派生
    const monthlyTrend = Object.entries(monthlyReviews)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      store_id: meta.store_id,
      store_name: meta.store_name,
      brand: meta.brand,
      area: meta.area,
      hpb,
      google,
      monthly_trend: monthlyTrend.length > 0 ? monthlyTrend : (prevStore?.monthly_trend || []),
      period_summary: periodSummary,
      monthly_reviews: monthlyReviews,
      monthly_blogs: monthlyBlogs
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
      // 「今月」＝暦月（月初からの日数分のみ）。月初は必然的に少なく出るため
      // 比較表など「一覧性」が求められる箇所では new_reviews_30d を主軸に使う
      new_reviews_this_month: (s.hpb.available ? s.hpb.new_reviews_this_month : 0) + s.google.new_reviews_this_month,
      // 直近30日ローリング。HPBは投稿日ベースの正確な30日集計、Googleは月次スナップショットの近似値
      new_reviews_30d: (s.hpb.available ? s.hpb.new_reviews_30d : 0) + s.google.new_reviews_this_month,
      new_blogs_30d: s.hpb.available ? s.hpb.new_blogs_30d : 0
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
    total_new_30d: stores.reduce((a, s) => a + s.totals.new_reviews_30d, 0),
    total_blogs_30d: stores.reduce((a, s) => a + s.totals.new_blogs_30d, 0),
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
      google: googleCache ? 'Places API Text Search（毎時自動取得、実際の反映は数時間おき）' : '前回値を継承（今回の自動取得は失敗）',
      hpb: hpbTrendsCache ? `HPB公式ページ自動取得（毎日）／最終取得: ${hpbTrendsCache.fetched_at?.slice(0,16).replace('T',' ')} UTC` : '前回値を継承（今回の自動取得は失敗）',
      blog: hpbTrendsCache ? 'HPBブログ一覧ページから自動集計（毎日）' : '前回値を継承',
      note: 'GBP公式API(Google Business Profile API)は2026-05に申請したが却下。Places APIで代替運用中のため件数・評価のみ取得可能（口コミ本文・返信状況は取得不可）'
    },
    stores,
    company_totals,
    alerts
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  console.log('[build] reviews.json written');
}

main();
