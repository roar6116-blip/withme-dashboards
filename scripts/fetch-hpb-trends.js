// HPB クチコミ・ブログの投稿日付を取得し、期間別・月別集計を生成
// 出力: scripts/cache/hpb-trends.json
//
// 各店舗の HPB URL:
//   クチコミ一覧: https://beauty.hotpepper.jp/kr/{sln_id}/review/[PN{N}.html]
//   ブログ一覧:   https://beauty.hotpepper.jp/kr/{sln_id}/blog/[PN{N}.html]
//
// 各ページから「YYYY/MM/DD」形式の日付を抽出し、ISO形式（YYYY-MM-DD）に変換して集計。

import fs from 'node:fs';
import path from 'node:path';
import { STORES } from './stores-config.js';

const CACHE_DIR = path.resolve('scripts/cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const REVIEW_PAGES = 4;   // クチコミ4ページ (約120件)
const BLOG_PAGES = 10;    // ブログ10ページ (約100件)
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

async function fetchPageDates(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WithMeDashboardBot/1.0)' }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const matches = html.match(/20\d{2}\/\d{1,2}\/\d{1,2}/g) || [];
    return matches.map(normalizeDate).filter(Boolean);
  } catch (e) {
    return [];
  }
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
    // 礼儀的に小休止
    await new Promise(r => setTimeout(r, 250));
  }
  return all;
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
    const reviewDates = await collectDates(slnId, 'review', REVIEW_PAGES);
    const blogDates = await collectDates(slnId, 'blog', BLOG_PAGES);

    out[store.store_id] = {
      reviews_fetched: reviewDates.length,
      blogs_fetched: blogDates.length,
      latest_review: reviewDates[0] || null,
      latest_blog: blogDates[0] || null,
      period_summary: aggregatePeriods(reviewDates, blogDates),
      monthly_reviews: aggregateMonthly(reviewDates),
      monthly_blogs: aggregateMonthly(blogDates)
    };
    console.log(`  → reviews:${reviewDates.length} blogs:${blogDates.length} latest_review:${reviewDates[0]} latest_blog:${blogDates[0]}`);
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
