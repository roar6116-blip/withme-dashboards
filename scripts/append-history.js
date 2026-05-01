// reviews.json の最新スナップショットを reviews-history.json に月次で追記
// 同一年月のデータが既に存在する場合は上書き
import fs from 'node:fs';
import path from 'node:path';

const REVIEWS = path.resolve('salon/data/reviews.json');
const HISTORY = path.resolve('salon/data/reviews-history.json');

function main() {
  const latest = JSON.parse(fs.readFileSync(REVIEWS, 'utf8'));
  const history = fs.existsSync(HISTORY)
    ? JSON.parse(fs.readFileSync(HISTORY, 'utf8'))
    : { schema_version: '1.0.0', description: '月次推移データ。GitHub Actions cron が自動追記。', history: [] };

  const now = new Date(latest.generated_at);
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const snapshot = {};
  for (const s of latest.stores) {
    const googleCount = s.google_business_profiles.reduce((a, g) => a + g.review_count, 0);
    const hpbCount = s.hpb_salons.reduce((a, h) => a + h.review_count, 0);
    const googleRating = (() => {
      const t = googleCount;
      if (t === 0) return 0;
      const sum = s.google_business_profiles.reduce((a, g) => a + g.rating * g.review_count, 0);
      return Number((sum / t).toFixed(2));
    })();
    const hpbRating = (() => {
      if (hpbCount === 0) return 0;
      const sum = s.hpb_salons.reduce((a, h) => a + h.rating * h.review_count, 0);
      return Number((sum / hpbCount).toFixed(2));
    })();
    snapshot[s.store_id] = {
      google_count: googleCount,
      google_rating: googleRating,
      hpb_count: hpbCount,
      hpb_rating: hpbRating,
      blog_new: s.totals.blog_count_this_month,
      score: s.score
    };
  }

  const idx = history.history.findIndex(h => h.year_month === ym);
  if (idx >= 0) {
    history.history[idx] = { year_month: ym, stores: snapshot };
  } else {
    history.history.push({ year_month: ym, stores: snapshot });
    history.history.sort((a, b) => a.year_month.localeCompare(b.year_month));
    // 直近24ヶ月のみ保持
    if (history.history.length > 24) {
      history.history = history.history.slice(-24);
    }
  }

  fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2));
  console.log(`[history] ${ym} updated (${history.history.length} months)`);
}

main();
