// reviews.json (schema v2.0 - 6ブランド店舗単位) の最新スナップショットを
// reviews-history.json に月次で追記
import fs from 'node:fs';
import path from 'node:path';

const REVIEWS = path.resolve('salon/data/reviews.json');
const HISTORY = path.resolve('salon/data/reviews-history.json');

function main() {
  const latest = JSON.parse(fs.readFileSync(REVIEWS, 'utf8'));
  const history = fs.existsSync(HISTORY)
    ? JSON.parse(fs.readFileSync(HISTORY, 'utf8'))
    : { schema_version: '2.0.0', description: '6ブランド店舗単位の月次推移DB。GitHub Actions cron が自動追記。', history: [] };

  const now = new Date(latest.generated_at || Date.now());
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const snapshot = {};
  for (const s of latest.stores) {
    const hpb = s.hpb || {};
    const google = s.google || {};
    snapshot[s.store_id] = {
      hpb_count: hpb.available ? (hpb.review_count || 0) : 0,
      hpb_rating: hpb.available ? (hpb.rating || 0) : 0,
      google_count: google.review_count || 0,
      google_rating: google.rating || 0,
      blog_total: hpb.available ? (hpb.blog_count_total || 0) : 0,
      blog_new: s.totals?.blog_count_this_month || 0,
      score: s.score || 0,
      rank: s.rank || 0
    };
  }

  const idx = history.history.findIndex(h => h.year_month === ym);
  if (idx >= 0) {
    history.history[idx] = { year_month: ym, stores: snapshot };
  } else {
    history.history.push({ year_month: ym, stores: snapshot });
    history.history.sort((a, b) => a.year_month.localeCompare(b.year_month));
    if (history.history.length > 24) {
      history.history = history.history.slice(-24);
    }
  }

  fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2));
  console.log(`[history] ${ym} updated (${history.history.length} months total)`);
}

main();
