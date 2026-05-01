// 店舗マスタ設定
//
// Place ID 取得方法:
// 1. https://developers.google.com/maps/documentation/places/web-service/place-id を開く
// 2. 「Find the ID for a particular place」のマップで店舗名を検索
// 3. 表示される ChIJ... 形式の ID を以下の place_id にコピー
//
// 各GBPの実名（Gmail通知から判明 / 2026-04時点）:
//   SlenderMe甲府店    → "Slender Me甲府本店"
//   TouchMe甲府昭和店  → "Touch Me甲府昭和店【タッチミー】"
//   KaoKao甲府店       → "小顔矯正コルギ専門店 KaoKao甲府本店"
//                        ＋ "AO甲府本店" (補助GBP・別物の場合あり)
//   TouchMe富士店      → "プレミアム全身脱毛Touch Me富士店【タッチミー】"
//   KaoKao富士店       → "韓国式小顔矯正コルギ・肌管理専門店 KaoKao富士店"
//   旧SlenderMe富士店  → "Slender Me富士店"
export const STORES = [
  {
    store_id: 'sm_kofu',
    physical_name: 'SlenderMe甲府店',
    brand: 'SlenderMe',
    hpb_salons: [
      { salon_name: 'SlenderMe甲府店', hpb_salon_id: 'TODO_SET_HPB_ID' }
    ],
    google_business_profiles: [
      { label: 'SlenderMe甲府店', place_id: 'TODO_SET_PLACE_ID', primary: true }
    ]
  },
  {
    store_id: 'tm_kofu_showa',
    physical_name: 'TouchMe甲府昭和店',
    brand: 'TouchMe',
    hpb_salons: [
      { salon_name: 'TouchMe甲府昭和店', hpb_salon_id: 'TODO_SET_HPB_ID' },
      { salon_name: 'KaoKao甲府店', hpb_salon_id: 'TODO_SET_HPB_ID' }
    ],
    google_business_profiles: [
      { label: 'TouchMe甲府昭和店', place_id: 'TODO_SET_PLACE_ID', primary: true },
      { label: 'KaoKao甲府店', place_id: 'TODO_SET_PLACE_ID', primary: false }
    ]
  },
  {
    store_id: 'tm_fuji',
    physical_name: 'TouchMe富士店',
    brand: 'TouchMe',
    hpb_salons: [
      { salon_name: 'TouchMe富士店', hpb_salon_id: 'TODO_SET_HPB_ID' },
      { salon_name: 'KaoKao富士店', hpb_salon_id: 'TODO_SET_HPB_ID' }
    ],
    google_business_profiles: [
      { label: 'TouchMe富士店', place_id: 'TODO_SET_PLACE_ID', primary: true },
      { label: 'KaoKao富士店', place_id: 'TODO_SET_PLACE_ID', primary: false },
      {
        label: 'TouchMe富士店 (補助GBP)',
        place_id: 'TODO_SET_PLACE_ID',
        primary: false,
        internal_note: '旧SlenderMe富士店GBP・2026-01統合・継続運用'
      }
    ]
  }
];

// 総合スコアの重み (合計100点)
export const SCORE_WEIGHTS = {
  hpb_count_share: 25,    // HPB口コミ件数の全店比率
  hpb_rating: 25,         // HPB平均評価 (★4.0未満は0点、★5.0で満点)
  google_count_share: 15, // Google口コミ件数の全店比率
  google_rating: 15,      // Google平均評価
  blog_monthly: 10,       // 月次ブログ投稿 (10本で満点)
  recent_growth: 10       // 直近3ヶ月の新規口コミ獲得数
};

// アラート閾値
export const ALERT_THRESHOLDS = {
  rating_warn: 4.5,       // ★が4.5を下回ったら警告
  no_reviews_days: 30,    // 30日以上新着なし
  no_blog_month: 1        // 月にブログ0本
};
