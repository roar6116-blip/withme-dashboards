// HPB クチコミ・ブログの投稿日付を取得し、期間別・月別集計を生成
// あわせて累計件数・累計評価・ブログ累計数も取得する（従来は欠落していた）
// 出力: scripts/cache/hpb-trends.json
//
// 各店舗の HPB URL:
//   店舗トップ:   https://beauty.hotpepper.jp/kr/{sln_id}/
//                 → JSON-LD構造化データに ratingValue / reviewCount が埋め込まれている
//   クチコミ一覧: https://beauty.hotpepper.jp/kr/{sln_id}/review/[PN{N}.html]
//   ブログ一覧:   https://beauty.hotpepper.jp/kr/{sln_id}/blog/[PN{N}.html]
//                 → 1ページ目の "(1/N)" 表記で総ページ数を取得し、
//                   最終ページの実件数を数えて正確な累計本数を算出する
//
// 各ページから「YYYY/MM/DD」形式の日付を抽出し、ISO形式（YYYY-MM-DD）に変換して集計。

import fs from 'node:fs';
import path from 'node:path';
import { STORES } from './stores-config.js';

const CACHE_DIR = path.resolve('scripts/cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const REVIEW_PAGES = 4;   // クチコミ4ページ (約120件、期間別集計用のサンプル)
const BLOG_PAGES = 10;    // ブログ10ページ (約100件、期間別集計用のサンプル)
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; WithMeDashboardBot/1.0)' };
const PERIOD_DEFS = [
  { k: 'p7',   days: 7 },
  { k: 'p30',  days: 30 },
  { k: 'p60',  days: 60 },
  { k: 'p90',  days: 90 },
  { k: 'p180', days: 180 },
  { k: 'p365', days: 365 }
];

function normalizeDate(raw) {
  const m = raw.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

async function fetchPageDates(url) {
  const html = await fetchHtml(url);
  if (!html) return [];
  const matches = html.match(/20\d{2}\/\d{1,2}\/\d{1,2}/g) || [];
  return matches.map(normalizeDate).filter(Boolean);
}

async function collectDates(slnId, kind, maxPages) {
  const all = [];
  for (let pn = 1; pn <= maxPages; pn++) {
    const url = pn === 1
      ? `https://beauty.hotpepper.jp/kr/${slnId}/${kind}/`
      : `https://beauty.hotpepper.jp/kr/${slnId}/${kind}/PN${pn}.html`;
    const dates = await fetchPageDates(url);
    if (dates.length === 0) break;
    all.push(...dates);
    await new Promise(r => setTimeout(r, 250)); // 礼儀的に小休止
  }
  return all;
}

// 店舗トップページの JSON-LD 構造化データから累計クチコミ件数・平均評価を取得
async function fetchTopPageStats(slnId) {
  const html = await fetchHtml(`https://beauty.hotpepper.jp/kr/${slnId}/`);
  if (!html) return { review_count: null, rating: null };
  const ratingMatch = html.match(/"ratingValue"\s*:\s*"?(\d(?:\.\d+)?)"?/);
  const countMatch = html.match(/"reviewCount"\s*:\s*"?(\d+)"?/);
  return {
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    review_count: countMatch ? Number(countMatch[1]) : null
  };
}

// ブログ累計本数を正確に取得: 1ページ目で総ページ数を確認 → 最終ページの実件数を数える
async function fetchBlogTotal(slnId) {
  const firstHtml = await fetchHtml(`https://beauty.hotpepper.jp/kr/${slnId}/blog/`);
  if (!firstHtml) return null;
  const pageMatch = firstHtml.match(/\((\d+)\/(\d+)\)/);
  if (!pageMatch) {
    // ページネーション表記がない = 1ページのみ
    const links = new Set(firstHtml.match(/blog\/bid[A-Za-z0-9]+\.html/g) || []);
    return links.size;
  }
  const totalPages = Number(pageMatch[2]);
  if (totalPages <= 1) {
    const links = new Set(firstHtml.match(/blog\/bid[A-Za-z0-9]+\.html/g) || []);
    return links.size;
  }
  await new Promise(r => setTimeout(r, 250));
  const lastHtml = await fetchHtml(`https://beauty.hotpepper.jp/kr/${slnId}/blog/PN${totalPages}.html`);
  if (!lastHtml) return null;
  const lastPageLinks = new Set(lastHtml.match(/blog\/bid[A-Za-z0-9]+\.html/g) || []);
  return (totalPages - 1) * 10 + lastPageLinks.size;
}

function aggregateMonthly(dates) {
  const m = {};
  for (const d of dates) {
    const k = d.slice(0, 7);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function aggregatePeriods(reviewDates, blogDates) {
  const now = Date.now();
  const ps = {};
  for (const p of PERIOD_DEFS) {
    const cutoff = now - p.days * 86400000;
    const reviews = reviewDates.filter(d => new Date(d).getTime() >= cutoff).length;
    const blogs = blogDates.filter(d => new Date(d).getTime() >= cutoff).length;
    ps[p.k] = { reviews, blogs };
  }
  return ps;
}

async function main() {
  const out = {};
  for (const store of STORES) {
    const slnId = store.hpb?.sln_id;
    if (!slnId) {
      console.log(`[hpb-trends] skip ${store.store_id} (no sln_id, HPB unavailable)`);
      continue;
    }
    console.log(`[hpb-trends] fetching ${store.store_id} (${slnId})...`);

    const topStats = await fetchTopPageStats(slnId);
    await new Promise(r => setTimeout(r, 250));
    const blogTotal = await fetchBlogTotal(slnId);
    await new Promise(r => setTimeout(r, 250));
    const reviewDates = await collectDates(slnId, 'review', REVIEW_PAGES);
    const blogDates = await collectDates(slnId, 'blog', BLOG_PAGES);

    out[store.store_id] = {
      review_count: topStats.review_count,
      rating: topStats.rating,
      blog_count_total: blogTotal,
      reviews_fetched: reviewDates.length,
      blogs_fetched: blogDates.length,
      latest_review: reviewDates[0] || null,
      latest_blog: blogDates[0] || null,
      period_summary: aggregatePeriods(reviewDates, blogDates),
      monthly_reviews: aggregateMonthly(reviewDates),
      monthly_blogs: aggregateMonthly(blogDates)
    };
    console.log(`  → review_count:${topStats.review_count} rating:${topStats.rating} blog_total:${blogTotal} latest_review:${reviewDates[0]} latest_blog:${blogDates[0]}`);
  }

  const fetchedAt = new Date().toISOString();
  const result = { fetched_at: fetchedAt, stores: out };
  const dst = path.join(CACHE_DIR, 'hpb-trends.json');
  fs.writeFileSync(dst, JSON.stringify(result, null, 2));
  console.log(`[hpb-trends] written to ${dst} (${Object.keys(out).length} stores)`);
}

main().catch(e => {
  console.error('[hpb-trends] failed:', e);
  process.exit(1);
});
