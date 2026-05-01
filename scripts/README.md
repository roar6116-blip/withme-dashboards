# scripts/ — データ更新スクリプト

GitHub Actions cron (`.github/workflows/update-reviews.yml`) から呼ばれる、データ更新用スクリプト群。

## 構成

| ファイル | 役割 |
|---|---|
| `stores-config.js` | 店舗マスタ・スコア重み・アラート閾値 |
| `fetch-google-reviews.js` | GBP API から各GBPの口コミ件数・評価を取得 → `cache/google-reviews.json` |
| `fetch-hpb-data.js` | スプシから HPB の手動入力分を取得 → `cache/hpb-data.json` |
| `build-reviews-json.js` | キャッシュをマージし、スコア・ランキングを計算 → `salon/data/reviews.json` |
| `append-history.js` | 月次スナップショットを `salon/data/reviews-history.json` に追記 |

## 実行順序

```
fetch-google-reviews.js   ┐
                           ├→ build-reviews-json.js → append-history.js
fetch-hpb-data.js          ┘
```

Google/HPBどちらかが失敗しても、既存の `reviews.json` から値を引き継ぐため、ダッシュボードは欠損なく表示される（`continue-on-error: true`）。

## 必要な GitHub Secrets

| Secret名 | 内容 | 必須？ |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Places API (New) のキー | **現運用で必須** |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | スプシ読取用サービスアカウントJSON（全文） | 必須 |
| `REVIEW_MASTER_SHEET_ID` | 「【WithMe】店舗評価マスタ」のスプシID | 必須 |
| `GBP_OAUTH_CLIENT_ID` | Google Cloud OAuth Client ID | GBP承認後 |
| `GBP_OAUTH_CLIENT_SECRET` | Google Cloud OAuth Client Secret | GBP承認後 |
| `GBP_OAUTH_REFRESH_TOKEN` | GBP用のリフレッシュトークン | GBP承認後 |
| `GBP_ACCOUNT_ID` | GBPアカウントID | GBP承認後 |

設定手順は `../docs/REVIEW-DASHBOARD-SETUP.md` 参照。

## ローカル実行

```bash
cd scripts
npm install
# .env を作成して環境変数をセット
node build-reviews-json.js
node append-history.js
```

## 既知の制約

- **Places API (New)** で取得できるのは件数・平均評価・最新5件のレビュー本文のみ。本文を全件取得するには GBP API 承認が必要。
- HPB はAPI非対応のため、店長が「【WithMe】店舗評価マスタ」スプシに手動入力する運用
- HPBブログ累計のみ手動入力 → 月次以下の頻度では更新されない
- 「今月新着件数」は Places API では直接取得できないため、前回キャッシュとの差分から計算。初回は0、2回目以降から正しく算出される。
