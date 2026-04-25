# withme-dashboards

社内共有ダッシュボードハブ。GitHub Pages で公開されています。

## 🌐 公開URL

https://roar6116-blip.github.io/withme-dashboards/

## 📁 構成

```
withme-dashboards/
├── index.html        トップページ（カード式メニュー）
├── salon/            エステ事業部のダッシュボード
├── landcore/         LANDCORE事業部のダッシュボード
└── common/           全社共通のダッシュボード
```

## 🛡 公開ポリシー

- **このリポジトリはパブリック**です。GitHub Pages の制約上、誰でも URL を知っていれば閲覧可能です
- **機密情報は絶対に含めない**こと
  - ❌ NG: 顧客の個人情報、財務詳細、内部金額の詳細、API キー
  - ✅ OK: 集計済み売上推移、店舗別の傾向、KPI 達成状況
- 検索エンジンには `<meta name="robots" content="noindex,nofollow">` で除外設定済み

## ➕ 新しいダッシュボードを追加する手順

1. 該当カテゴリのフォルダ（`salon/`, `landcore/`, `common/`）に `dashboard-name.html` を配置
2. `index.html` の該当カードからリンクを張る（`href="salon/dashboard-name.html"`）
3. `git add . && git commit -m "add: ダッシュボード名" && git push`
4. 1〜2分後に自動反映

## 🔧 ローカルでの確認

```bash
# シンプルにブラウザで開くだけ
start index.html

# またはローカルサーバー起動
npx http-server .
```

## 📦 関連リポジトリ

- `withme-salon` — エステ事業部のソースデータ
- `landcore` — LANDCORE のソースデータ
- `nikkei_bulk_import` — 日計表ETL（データ供給元）
