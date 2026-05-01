// 店舗マスタ設定 (6ブランド店舗単位 schema v2.0)
//
// text_query: Places API Text Search で店舗を特定する検索文字列
// hpb_url:    HPB クチコミページの正規URL

export const STORES = [
  {
    store_id: 'tm_kofu_showa',
    store_name: 'TouchMe甲府昭和店',
    brand: 'TouchMe',
    area: '甲府',
    google: {
      label: 'Touch Me甲府昭和店【タッチミー】',
      text_query: 'Touch Me甲府昭和店【タッチミー】 山梨県昭和町清水新居'
    },
    hpb: {
      salon_name: 'TouchMe甲府昭和店',
      url: 'https://beauty.hotpepper.jp/kr/slnH000530271/',
      sln_id: 'slnH000530271'
    }
  },
  {
    store_id: 'tm_fuji',
    store_name: 'TouchMe富士店',
    brand: 'TouchMe',
    area: '富士',
    google: {
      label: 'Touch Me富士店【タッチミー】',
      text_query: 'プレミアム全身脱毛Touch Me富士店【タッチミー】 静岡県富士市伝法'
    },
    hpb: {
      salon_name: 'TouchMe富士店',
      url: 'https://beauty.hotpepper.jp/kr/slnH000584577/',
      sln_id: 'slnH000584577'
    }
  },
  {
    store_id: 'sm_kofu',
    store_name: 'SlenderMe甲府店',
    brand: 'SlenderMe',
    area: '甲府',
    google: {
      label: 'Slender Me甲府本店',
      text_query: '痩身ダイエット専門店 Slender Me甲府本店 山梨県甲府市徳行'
    },
    hpb: {
      salon_name: 'SlenderMe甲府店',
      url: 'https://beauty.hotpepper.jp/kr/slnH000494565/',
      sln_id: 'slnH000494565'
    }
  },
  {
    store_id: 'kk_kofu',
    store_name: 'KaoKao甲府店',
    brand: 'KaoKao',
    area: '甲府',
    google: {
      label: 'KaoKao甲府本店',
      text_query: '小顔矯正コルギ専門店 KaoKao甲府本店 山梨県昭和町清水新居'
    },
    hpb: {
      salon_name: 'KaoKao甲府店',
      url: 'https://beauty.hotpepper.jp/kr/slnH000652811/',
      sln_id: 'slnH000652811'
    }
  },
  {
    store_id: 'kk_fuji',
    store_name: 'KaoKao富士店',
    brand: 'KaoKao',
    area: '富士',
    google: {
      label: 'KaoKao富士店',
      text_query: '韓国式小顔矯正コルギ・肌管理専門店 KaoKao富士店 静岡県富士市伝法'
    },
    hpb: {
      salon_name: 'KaoKao富士店',
      url: 'https://beauty.hotpepper.jp/kr/slnH000748746/',
      sln_id: 'slnH000748746'
    }
  },
  {
    store_id: 'sm_fuji',
    store_name: 'SlenderMe富士店',
    brand: 'SlenderMe',
    area: '富士',
    google: {
      label: 'Slender Me富士店',
      text_query: '痩身ダイエット専門店 Slender Me富士店 静岡県富士市伝法'
    },
    hpb: {
      salon_name: null,
      url: null,
      sln_id: null,
      available: false,
      note: 'HPB広告ページなし。TouchMe富士店併設で運営'
    }
  }
];

// アラート閾値
export const ALERT_THRESHOLDS = {
  rating_warn: 4.5,
  no_reviews_days: 30,
  no_blog_month: 1
};
