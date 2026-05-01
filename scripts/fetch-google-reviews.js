// Places API (New) Text Search で各店舗を検索 → 件数・評価・Place ID 取得
// 出力: scripts/cache/google-reviews.json
import fs from 'node:fs';
import path from 'node:path';
import { STORES } from './stores-config.js';

const CACHE_DIR = path.resolve('scripts/cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

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

function readPrev() {
  const p = path.join(CACHE_DIR, 'google-reviews.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn('[google] GOOGLE_PLACES_API_KEY not set. Skipping (will use existing data).');
    return;
  }

  const prev = readPrev();
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
      // 前回キャッシュとの差分から「今月新着件数」を算出
      const prevCount = prev[store.store_id]?.review_count ?? data.review_count;
      const newThisMonth = Math.max(0, data.review_count - prevCount);
      result[store.store_id] = {
        place_id: data.place_id,
        label: data.display_name || store.google.label,
        review_count: data.review_count,
        rating: data.rating,
        new_reviews_this_month: newThisMonth
      };
      console.log(`[google] ${store.store_id}: ${data.review_count} reviews, ★${data.rating} (${data.place_id})`);
    } catch (e) {
      console.error(`[google] Failed for ${store.store_id}: ${e.message}`);
      // エラー時は前回の値を維持
      if (prev[store.store_id]) result[store.store_id] = prev[store.store_id];
    }
  }

  fs.writeFileSync(path.join(CACHE_DIR, 'google-reviews.json'), JSON.stringify(result, null, 2));
  console.log(`[google] cache written for ${Object.keys(result).length} stores`);
}

main().catch(e => { console.error(e); process.exit(1); });
