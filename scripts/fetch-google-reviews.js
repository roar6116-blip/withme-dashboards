// Places API (New) Text Search で各店舗を検索 → 件数・評価・Place ID 取得
// 出力: scripts/cache/google-reviews.json
//
// 「今月の新着件数」は月初スナップショットとの差分で算出する。
// スナップショットは salon/data/google-monthly-snapshot.json に git 管理下で永続化する
// （scripts/cache/ は .gitignore 対象で GitHub Actions の実行間で消えるため、
//   以前は「前回cron実行(1時間前)との差分」を計算しており実質常に0になっていた）
import fs from 'node:fs';
import path from 'node:path';
import { STORES } from './stores-config.js';

const CACHE_DIR = path.resolve('scripts/cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const SNAPSHOT_PATH = path.resolve('salon/data/google-monthly-snapshot.json');
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

async function searchPlace(query, apiKey) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount'
    },
    body: JSON.stringify({ textQuery: query, languageCode: 'ja', regionCode: 'JP' })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const top = (data.places || [])[0];
  if (!top) return null;
  return {
    place_id: top.id,
    display_name: top.displayName?.text,
    address: top.formattedAddress,
    review_count: top.userRatingCount ?? 0,
    rating: top.rating ?? 0
  };
}

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return { year_month: null, counts: {} };
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch (e) {
    return { year_month: null, counts: {} };
  }
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn('[google] GOOGLE_PLACES_API_KEY not set. Skipping (will use existing data).');
    return;
  }

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const snapshot = readSnapshot();
  const isNewMonth = snapshot.year_month !== currentMonth;
  const newSnapshotCounts = isNewMonth ? {} : { ...snapshot.counts };
  const result = {};

  for (const store of STORES) {
    const q = store.google?.text_query;
    if (!q) {
      console.warn(`[google] Skipping ${store.store_id} (no text_query)`);
      continue;
    }
    try {
      const data = await searchPlace(q, apiKey);
      if (!data) {
        console.warn(`[google] No match for ${store.store_id}: "${q}"`);
        continue;
      }

      // 今月の月初スナップショットとの差分 = 今月の新着件数
      const baseline = isNewMonth ? data.review_count : (snapshot.counts?.[store.store_id] ?? data.review_count);
      const newThisMonth = Math.max(0, data.review_count - baseline);
      if (isNewMonth) newSnapshotCounts[store.store_id] = data.review_count;

      result[store.store_id] = {
        place_id: data.place_id,
        label: data.display_name || store.google.label,
        review_count: data.review_count,
        rating: data.rating,
        new_reviews_this_month: newThisMonth
      };
      console.log(`[google] ${store.store_id}: ${data.review_count} reviews (+${newThisMonth} this month), ★${data.rating} (${data.place_id})`);
    } catch (e) {
      console.error(`[google] Failed for ${store.store_id}: ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(CACHE_DIR, 'google-reviews.json'), JSON.stringify(result, null, 2));
  console.log(`[google] cache written for ${Object.keys(result).length} stores`);

  // 月が変わったタイミングでのみスナップショットを更新（月内は固定して差分の基準を保つ）
  if (isNewMonth) {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ year_month: currentMonth, counts: newSnapshotCounts }, null, 2));
    console.log(`[google] monthly snapshot reset for ${currentMonth}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
