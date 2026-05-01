// 「【WithMe】店舗評価マスタ」スプレッドシートから手動入力データを取得
// 出力: scripts/cache/hpb-data.json
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CACHE_DIR = path.resolve('scripts/cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

async function main() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.REVIEW_MASTER_SHEET_ID) {
    console.warn('[hpb] Service account or sheet ID not set. Skipping.');
    return;
  }

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // シート構成（入力シート）:
  // A:年月 B:HPB店舗名 C:HPB口コミ累計 D:HPB平均評価 E:HPBブログ累計 F:今月新着件数
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.REVIEW_MASTER_SHEET_ID,
    range: '入力!A2:F1000'
  });

  const rows = res.data.values || [];
  const data = rows
    .filter(r => r.length >= 5)
    .map(r => ({
      year_month: r[0],
      salon_name: r[1],
      review_count: Number(r[2]) || 0,
      rating: Number(r[3]) || 0,
      blog_count_total: Number(r[4]) || 0,
      new_reviews_this_month: Number(r[5]) || 0
    }));

  fs.writeFileSync(path.join(CACHE_DIR, 'hpb-data.json'), JSON.stringify(data, null, 2));
  console.log(`[hpb] ${data.length} rows written`);
}

main().catch(e => { console.error(e); process.exit(1); });
