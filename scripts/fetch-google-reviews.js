// Places API (New) で各 Place の口コミ件数・平均評価を取得
// 出力: scripts/cache/google-reviews.json
//
// 切り替え方針:
// - GBP API 承認済み (GBP_OAUTH_REFRESH_TOKEN がセット) → GBP API 経由 (口コミ本文も取得可)
// - そうでなければ Places API (New) で件数・評価のみ取得 (本文は別経路)
//
// Places API (New) Place Details:
//   POST https://places.googleapis.com/v1/places/{place_id}
//   Header: X-Goog-Api-Key, X-Goog-FieldMask: id,displayName,rating,userRatingCount
import fs from 'node:fs';
import path from 'node:path';
import { STORES } from './stores-config.js';

const CACHE_DIR = path.resolve('scripts/cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1';
const FIELD_MASK = 'id,displayName,rating,userRatingCount';

async function fetchPlaceViaPlacesApi(placeId, apiKey) {
  const url = `${PLACES_ENDPOINT}/places/${encodeURIComponent(placeId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    review_count: data.userRatingCount ?? 0,
    rating: data.rating ?? 0,
    display_name: data.displayName?.text ?? null
  };
}

async function fetchAllPlaces(apiKey) {
  const result = {};
  for (const store of STORES) {
    result[store.store_id] = [];
    for (const gbp of store.google_business_profiles) {
      if (!gbp.place_id || gbp.place_id.startsWith('TODO_')) {
        console.warn(`[google] Skipping ${gbp.label} (place_id not set)`);
        continue;
      }
      try {
        const data = await fetchPlaceViaPlacesApi(gbp.place_id, apiKey);
        result[store.store_id].push({
          label: gbp.label,
          review_count: data.review_count,
          rating: data.rating,
          new_reviews_this_month: 0  // 履歴差分から計算するため、ここでは 0
        });
        console.log(`[google] ${gbp.label}: ${data.review_count} reviews, ★${data.rating}`);
      } catch (e) {
        console.error(`[google] Failed for ${gbp.label}: ${e.message}`);
      }
    }
  }
  return result;
}

async function main() {
  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const gbpRefreshToken = process.env.GBP_OAUTH_REFRESH_TOKEN;

  if (gbpRefreshToken) {
    // 将来 GBP API 承認後に有効化するパス
    console.log('[google] GBP API mode (not implemented yet, falling back to Places API)');
  }

  if (!placesApiKey) {
    console.warn('[google] GOOGLE_PLACES_API_KEY not set. Skipping (will use existing data).');
    return;
  }

  const result = await fetchAllPlaces(placesApiKey);
  const cachePath = path.join(CACHE_DIR, 'google-reviews.json');

  // 前月との差分から「今月新着件数」を計算（前回キャッシュがあれば）
  const prevPath = path.join(CACHE_DIR, 'google-reviews-prev.json');
  if (fs.existsSync(cachePath)) {
    fs.copyFileSync(cachePath, prevPath);
  }
  if (fs.existsSync(prevPath)) {
    const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
    for (const storeId of Object.keys(result)) {
      const prevList = prev[storeId] || [];
      for (const cur of result[storeId]) {
        const prevItem = prevList.find(p => p.label === cur.label);
        if (prevItem) {
          const diff = cur.review_count - prevItem.review_count;
          cur.new_reviews_this_month = diff > 0 ? diff : 0;
        }
      }
    }
  }

  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
  console.log(`[google] cache written: ${cachePath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
