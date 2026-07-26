# scripts/ — データ更新スクリプト

GitHub Actions cron から呼ばれる、データ更新用スクリプト群。
現在2系統ある（口コミダッシュボード / 予約ファネル）。

## 構成

### 口コミダッシュボード（`update-reviews.yml` / `update-hpb-trends.yml`）

| ファイル | 役割 |
|---|---|
| `stores-config.js` | 店舗マスタ・スコア重み・アラート閾値 |
| `fetch-google-reviews.js` | GBP API から各GBPの口コミ件数・評価を取得 → `cache/google-reviews.json` |
| `fetch-hpb-data.js` | スプシから HPB の手動入力分を取得 → `cache/hpb-data.json` |
| `build-reviews-json.js` | キャッシュをマージし、スコア・ランキングを計算 → `salon/data/reviews.json` |
| `append-history.js` | 月次スナップショットを `salon/data/reviews-history.json` に追記 |

### 予約ファネル（`update-reservation-funnel.yml`・毎朝 JST 7:00）

| ファイル | 役割 |
|---|---|
| `funnel-config.js` | 店舗・メニュー・媒体の定義、ファイル名 → 店舗/メニュー判定 |
| `funnel-parse.js` | 明細タブのパースと集計（Google APIに依存しない純粋関数） |
| `fetch-reservation-funnel.js` | Drive探索 → Sheets読取 → 集計 → `salon/data/funnel.json` |
| `funnel-config.test.mjs` / `funnel-parse.test.mjs` | 上記2つの検証。CIでも実行される |

新規予約管理シートは**店舗×メニューごとに別ファイル**で運用されている（統合DBではない）。
詳細な仕様・トラブルシュートは Claude スキル `reservation-funnel` を参照。

集計に失敗した場合はスクリプトが exit 1 するため、`funnel.json` は前日の内容が維持される。

```bash
node scripts/funnel-config.test.mjs && node scripts/funnel-parse.test.mjs
```

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
| `RESERVATION_FOLDER_CURRENT` | 当年の新規予約管理シートが入ったDriveフォルダID | 予約ファネルで必須 |
| `RESERVATION_FOLDER_PREV` | 前年の新規予約管理シートが入ったDriveフォルダID | 予約ファネルで必須 |

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
