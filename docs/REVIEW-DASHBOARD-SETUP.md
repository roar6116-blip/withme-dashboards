# 店舗別口コミ評価ダッシュボード セットアップ手順

このダッシュボードは **GitHub Actions で1時間ごとに自動更新**されます。
データ取得は次の優先順で動作します:

1. **GBP API**（承認済みの場合）— 口コミ件数・評価・本文を直接取得
2. **Places API (New)**（現在の運用）— 口コミ件数・評価のみ取得（**即利用可能**）
3. データ供給がない場合 — 既存の `reviews.json` から値を引き継ぎ（欠損なし）

---

## 現在のステータス（2026-05-01）

| 項目 | 状態 |
|---|---|
| GCPプロジェクト `withme-gbp-api` | ✅ 作成済み（番号: `286280578309`） |
| My Business Account Management API | ✅ 有効 / クォータ0（承認待ち） |
| My Business Business Information API | ✅ 有効 / クォータ0（承認待ち） |
| **GBP API access 申請** | ⏳ 受理（Case `9-2959000039900` / 7〜10営業日待ち） |
| **Places API (New)** | ✅ **有効・利用可能** |
| Places API キー | ✅ 発行・Places API のみに制限 |

→ **Places API 経路で先行稼働開始可能**。GBP 承認後に切り替え予定。

---

## 全体像

```
GitHub Actions (cron 1h)
  ├─ scripts/fetch-google-reviews.js
  │    └─ GBP API or Places API のどちらかで店舗別件数・評価取得
  ├─ scripts/fetch-hpb-data.js
  │    └─ Google スプシから HPB 手動入力分を取得
  ├─ scripts/build-reviews-json.js
  │    └─ マージ＆スコア計算
  └─ scripts/append-history.js
        └─ 月次スナップショット
              ↓
        salon/data/reviews.json (更新)
              ↓
        git push → Cloudflare Pages 自動再デプロイ
              ↓
        https://withme-dashboard.pages.dev/salon/reviews.html
```

---

## 1. Places API モード（現運用）の設定

### 1-1. Places API キーを GitHub Secrets に登録

1. ブラウザで Cloud Console にログイン: https://console.cloud.google.com/google/maps-apis/credentials?project=withme-gbp-api
2. APIキー（`AIzaSy...` で始まる文字列）をコピー
3. GitHubリポ Settings → Secrets and variables → Actions → **New repository secret**
4. Name: `GOOGLE_PLACES_API_KEY`、Secret: コピーしたAPIキー → Save

### 1-2. 6つのGBPの Place ID を取得

1. https://developers.google.com/maps/documentation/places/web-service/place-id を開く
2. マップ上で各店舗を検索（または下記の正式名称で検索）:
   - `Slender Me甲府本店`
   - `Touch Me甲府昭和店【タッチミー】`
   - `小顔矯正コルギ専門店 KaoKao甲府本店`
   - `プレミアム全身脱毛Touch Me富士店【タッチミー】`
   - `韓国式小顔矯正コルギ・肌管理専門店 KaoKao富士店`
   - `Slender Me富士店`（※補助GBP）
3. 表示される `ChIJ...` 形式の Place ID をコピー
4. `scripts/stores-config.js` の各 `place_id: 'TODO_SET_PLACE_ID'` を実際のIDで置換

### 1-3. 動作確認

```bash
cd scripts
npm install
GOOGLE_PLACES_API_KEY=<キー> node fetch-google-reviews.js
node build-reviews-json.js
```

`scripts/cache/google-reviews.json` と `salon/data/reviews.json` が生成されれば成功。

---

## 2. HPB手動入力（共通）

サロンボードはAPI非対応のため、店長が月初に手動入力する運用。

### 2-1. スプシ作成

新規スプシを作成 → ファイル名: **`【WithMe】店舗評価マスタ`**
配置先: `Google Drive > 100_WithMe > マーケ > 店舗評価`

#### シート1「入力」（店長が月初に入力）

| 列 | ヘッダー | 内容 | 例 |
|---|---|---|---|
| A | 年月 | YYYY-MM | 2026-05 |
| B | HPB店舗名 | 「設定」シートと一致 | TouchMe富士店 |
| C | HPB口コミ累計 | サロンボードの累計件数 | 245 |
| D | HPB平均評価 | サロンボード上の平均★ | 4.8 |
| E | HPBブログ累計 | サロンボードの累計記事数 | 487 |
| F | 今月新着件数 | C列の前月比 | 5 |

#### シート2「設定」（店舗マスタ）

| 列 | ヘッダー | 内容 |
|---|---|---|
| A | HPB店舗名 | 一意の店舗名 |
| B | 物理店舗ID | sm_kofu / tm_kofu_showa / tm_fuji |
| C | サロンID | サロンボードURLの末尾 |
| D | LINE通知ID | 月次レポート送信先 |

スプシID（URL中の `/d/{ここ}/edit`）を GitHub Secrets `REVIEW_MASTER_SHEET_ID` に登録。

### 2-2. Service Account 作成（スプシ読取用）

1. Cloud Console: https://console.cloud.google.com/iam-admin/serviceaccounts?project=withme-gbp-api
2. 「サービス アカウントを作成」 → 名前: `withme-dashboard-sheets`
3. 作成後、「キー → 新しい鍵を作成 → JSON」でダウンロード
4. **スプシをサービスアカウントのメールアドレスと共有**（閲覧権限）
5. ダウンロードした JSON 全文を GitHub Secrets `GOOGLE_SERVICE_ACCOUNT_JSON` に登録

---

## 3. GBP API モード（承認後・自動切替）

申請承認メールが届いたら、以下を行うことで GBP API 経由に切り替わる:

1. Cloud Console で My Business Account Management API のクォータが 0 → 1以上に変わっていることを確認
2. OAuth 2.0 の認証情報（デスクトップアプリ）を作成
3. ローカルでリフレッシュトークンを取得
4. GitHub Secrets に登録:
   - `GBP_OAUTH_CLIENT_ID`
   - `GBP_OAUTH_CLIENT_SECRET`
   - `GBP_OAUTH_REFRESH_TOKEN`
   - `GBP_ACCOUNT_ID`

`fetch-google-reviews.js` は `GBP_OAUTH_REFRESH_TOKEN` がセットされていれば GBP API モードに切り替わる（実装は今後拡張）。

---

## 4. GitHub Secrets 一覧

| Secret 名 | 用途 | 必須？ |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Places API（口コミ件数・評価取得） | **現運用で必須** |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | スプシ読取（HPB手動入力データ） | 必須 |
| `REVIEW_MASTER_SHEET_ID` | 「店舗評価マスタ」スプシID | 必須 |
| `GBP_OAUTH_CLIENT_ID` | GBP API OAuth Client ID | GBP承認後 |
| `GBP_OAUTH_CLIENT_SECRET` | GBP API OAuth Client Secret | GBP承認後 |
| `GBP_OAUTH_REFRESH_TOKEN` | GBP API リフレッシュトークン | GBP承認後 |
| `GBP_ACCOUNT_ID` | GBPアカウントID | GBP承認後 |

---

## 5. 動作確認

1. GitHub Actions タブを開く
2. 「Update Review Dashboard」ワークフロー → **Run workflow** で手動実行
3. 1〜2分待つ → `salon/data/reviews.json` が自動コミットされていれば成功
4. https://withme-dashboard.pages.dev/salon/reviews.html で最新データ表示確認

---

## トラブルシューティング

### `[google] GOOGLE_PLACES_API_KEY not set` で止まる

→ GitHub Secrets に `GOOGLE_PLACES_API_KEY` が登録されていない。手順1-1を再確認。

### Places API 呼び出しが 403 エラー

→ APIキーの制限が厳しすぎる可能性。「APIの制限」で **Places API (New)** が選択されているか確認。

### スプシから読めない

→ サービスアカウントのメールアドレスをスプシの共有リストに追加していない（閲覧者でOK）。

### ダッシュボードが古いまま

→ Cloudflare Pages のビルドログを確認。GitHub push 後1〜2分でデプロイされる。
   `withme-dashboard.pages.dev/?_=ts` でブラウザキャッシュバスター。

---

## セットアップ完了までの段階

| 段階 | ダッシュボード状態 |
|---|---|
| 0. 何もしない | ダミーデータで動作（既存サンプル6ヶ月分） |
| 1. Places API キー＋Place ID 投入 | Google分は自動・1時間ごと更新 |
| 2. HPBスプシ手動入力開始 | HPB分も含めて自動運用 |
| 3. GBP API承認後（数週間後） | GBP API 経由に自動切替 |

---

## 関連ファイル

- `scripts/stores-config.js` — Place ID と salon_id を書き込む場所
- `scripts/build-reviews-json.js` — スコア計算ロジック
- `scripts/fetch-google-reviews.js` — Places API / GBP API 切替ロジック
- `.github/workflows/update-reviews.yml` — cron定義
- `salon/data/reviews.json` — 最新スナップショット
- `salon/data/reviews-history.json` — 月次推移DB
