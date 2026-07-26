// funnel-config / パーサの最小検証
// 実行: node scripts/funnel-config.test.mjs
import assert from 'node:assert/strict';
import { classifyFile, isMonthlyTab } from './funnel-config.js';

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
}

console.log('classifyFile');
check('slenderme甲府 → SM甲府 / 痩身', () => {
  assert.deepEqual(classifyFile('01slenderme甲府店_新規予約管理シート_2026年'), {
    store: 'sm-kofu', menu: '痩身', brand: 'slenderme',
  });
});
check('touchme甲府昭和 → TM甲府昭和 / 脱毛', () => {
  assert.deepEqual(classifyFile('02touchme甲府昭和店_新規予約管理シート_2026年'), {
    store: 'tm-kofu', menu: '脱毛', brand: 'touchme',
  });
});
check('kaokao甲府 → TM甲府昭和 / フェイシャル（同居ブランド）', () => {
  assert.deepEqual(classifyFile('02kaokao甲府店_新規予約管理シート_2026年'), {
    store: 'tm-kofu', menu: 'フェイシャル', brand: 'kaokao',
  });
});
check('touchme富士（痩身）→ TM富士 / 痩身（括弧の明示を優先）', () => {
  assert.deepEqual(classifyFile('03touchme富士店（痩身）_新規予約管理シート_2026年'), {
    store: 'tm-fuji', menu: '痩身', brand: 'touchme',
  });
});
check('touchme富士（脱毛）→ TM富士 / 脱毛', () => {
  assert.deepEqual(classifyFile('03touchme富士店（脱毛）_新規予約管理シート_2026年'), {
    store: 'tm-fuji', menu: '脱毛', brand: 'touchme',
  });
});
check('kaokao富士 → TM富士 / フェイシャル', () => {
  assert.deepEqual(classifyFile('03kaokao富士店_新規予約管理シート_2026年'), {
    store: 'tm-fuji', menu: 'フェイシャル', brand: 'kaokao',
  });
});
check('slenderme富士(2025) → TM富士 / 痩身（2026/02統合を反映）', () => {
  assert.deepEqual(classifyFile('slenderme富士店_新規予約管理シート_2025年'), {
    store: 'tm-fuji', menu: '痩身', brand: 'slenderme',
  });
});
check('無関係ファイルは null', () => {
  assert.equal(classifyFile('販促費管理表_2026'), null);
  assert.equal(classifyFile('【WithMe】日計表・総合DB'), null);
});

console.log('isMonthlyTab');
check('全角の月別タブを認識', () => {
  assert.equal(isMonthlyTab('１月_新規予約管理表'), true);
  assert.equal(isMonthlyTab('１２月_新規予約管理表'), true);
});
check('半角の月別タブも認識', () => {
  assert.equal(isMonthlyTab('7月_新規予約管理表'), true);
});
check('集計タブ・後追いリストは除外', () => {
  assert.equal(isMonthlyTab('後追いリスト'), false);
  assert.equal(isMonthlyTab('年間集計'), false);
});

console.log(`\n${passed} passed`);
