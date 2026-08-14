// 明細タブのパース検証。
// フィクスチャは実際の「01slenderme甲府店_新規予約管理シート_2026年」の
// 月別タブの並び（左に余白列、右に集計ブロックが同居）を再現している。
// 実行: node scripts/funnel-parse.test.mjs
import assert from 'node:assert/strict';
import {
  parseCellDate, findHeader, extractRows, extractDbRows, judgeStatus,
  newBucket, bump, finalize, pct,
} from './funnel-parse.js';
import { resolveStore } from './funnel-config.js';

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
}

// 実シートの１月タブを模した値配列（A列が空、B列から明細、右側に集計ブロック）
const JAN_TAB = [
  ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['', 'NO', '予約通知日', '予約媒体', '顧客名', '電話番号', '予約日', '年齢', '最終確認日',
   '予約確定', '来店状況', '契約状況', '契約金額', '備考：契約内容/キャンセル理由など'],
  ['', '1', '2026/01/08', 'HPB', '見藤杏美', '08058883960', '2026/01/12', '29', '',
   '確定', '来店', '契約', '¥237,600', '無料CS'],
  ['', '2', '2026/01/08', 'インスタ広告', '古屋宏美', '09044579427', '2026/01/19', '40', '',
   '確定', '来店', '契約', '¥299,700', ''],
  ['', '3', '2026/01/11', 'HPB', '土橋舞華', '08066213890', '2026/01/23', '28', '',
   '確定', '来店', 'なし', '', '口コミOK'],
  // 予約確定列に運用メモ（Gmail）が入っているが来店済み → 確定として数える
  ['', '4', '2026/01/14', 'HPB', '花見麗華', '08034947180', '2026/01/16', '40', '',
   'Gmail', '来店', 'なし', '', 'SMS送信×'],
  ['', '5', '2026/01/17', 'アフィリエイト', '坂本光里', '09087408517', '', '', '',
   'キャンセル', '', '', '', '当日キャンセル'],
  ['', '6', '2026/01/20', 'インスタ広告', '名取麻鈴', '08053806706', '', '30', '',
   '後追い', '', '', '', '連絡中'],
  // 予約通知日が無い空行（シート末尾の連番だけ残っている行）
  ['', '7', '', '', '', '', '', '', '', '', '', '', '', ''],
  // 右側に同居している集計ブロック（明細として拾ってはいけない）
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '',
   '項目', 'HPB', 'インスタ広告', '合計'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '',
   '予約確定率', '83%', '57%', '79%'],
];

console.log('parseCellDate');
check('スラッシュ区切り', () => assert.equal(parseCellDate('2026/01/28'), '2026-01-28'));
check('ハイフン・桁揺れ', () => assert.equal(parseCellDate('2026-1-8'), '2026-01-08'));
check('年省略は fallbackYear で補完', () => assert.equal(parseCellDate('1/28', 2026), '2026-01-28'));
check('空・非日付は null', () => {
  assert.equal(parseCellDate(''), null);
  assert.equal(parseCellDate('確定'), null);
  assert.equal(parseCellDate(null), null);
});

console.log('findHeader');
check('余白列があってもヘッダー行を特定できる', () => {
  const h = findHeader(JAN_TAB);
  assert.equal(h.rowIndex, 1);
  assert.equal(h.map.date, 2);
  assert.equal(h.map.media, 3);
  assert.equal(h.map.confirmed, 9);
  assert.equal(h.map.visit, 10);
  assert.equal(h.map.contract, 11);
});
check('ヘッダーが無いタブは null', () => {
  assert.equal(findHeader([['', '項目', 'HPB'], ['', '予約確定率', '83%']]), null);
});
check('2025年の語順違い「予約日通知」も拾う', () => {
  const rows2025 = [
    ['', '１月_新規予約管理表'],
    [],
    ['', 'NO', '予約日通知', '予約媒体', '顧客名', '電話番号', '予約日', '年齢',
     '予約確定', '来店状況', '契約状況', '契約金額', '備考'],
    ['', '1', '2025/01/06', 'HPB', '渡邉汐莉', '09054900927', '2025/01/10', '40',
     '確定', '来店', '契約', '¥335,500', '口コミOK'],
  ];
  const h = findHeader(rows2025);
  assert.equal(h.rowIndex, 2);
  assert.equal(h.map.date, 2);
  const rows = extractRows(rows2025, 2025);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2025-01-06');
  assert.equal(rows[0].isContract, true);
});

console.log('extractRows');
const rows = extractRows(JAN_TAB, 2026);
check('明細6件のみ抽出（空行・集計ブロックを除外）', () => {
  assert.equal(rows.length, 6);
});
check('顧客名・電話番号・契約金額を持ち出さない', () => {
  const keys = Object.keys(rows[0]).sort();
  assert.deepEqual(keys, ['date', 'isConfirmed', 'isContract', 'isVisit', 'media']);
});
check('予約確定列が「Gmail」でも来店済なら確定扱い', () => {
  const r = rows.find((x) => x.date === '2026-01-14');
  assert.equal(r.isConfirmed, true);
  assert.equal(r.isVisit, true);
  assert.equal(r.isContract, false);
});
check('キャンセル・後追いは未確定', () => {
  assert.equal(rows.find((x) => x.date === '2026-01-17').isConfirmed, false);
  assert.equal(rows.find((x) => x.date === '2026-01-20').isConfirmed, false);
});
check('契約は来店を含意する', () => {
  const contracted = rows.filter((x) => x.isContract);
  assert.equal(contracted.length, 2);
  assert.ok(contracted.every((x) => x.isVisit && x.isConfirmed));
});

console.log('集計');
check('ファネルの率が既存GAS定義と一致する', () => {
  const b = newBucket();
  rows.forEach((r) => bump(b, r));
  const f = finalize(b);
  // 予約発生6 / 確定4 / 来店4 / 契約2
  assert.equal(f.count, 6);
  assert.equal(f.confirmed, 4);
  assert.equal(f.visit, 4);
  assert.equal(f.contract, 2);
  assert.equal(f.confirmedRate, 66.7);          // 確定 ÷ 予約発生
  assert.equal(f.visitRate, 100);               // 来店 ÷ 確定
  assert.equal(f.bookingToVisitRate, 66.7);     // 来店 ÷ 予約発生
  assert.equal(f.contractRate, 50);             // 契約 ÷ 来店
});
check('母数0のとき率は null', () => {
  assert.equal(pct(0, 0), null);
  assert.equal(finalize(newBucket()).confirmedRate, null);
});

console.log('judgeStatus');
check('「未来店」を来店として数えない（新DBで導入された値）', () => {
  const s = judgeStatus('確定', '未来店', '');
  assert.equal(s.isVisit, false);
  assert.equal(s.isConfirmed, true);   // 確定はしている
  assert.equal(s.isContract, false);
});
check('「来店」は来店として数える', () => {
  assert.equal(judgeStatus('確定', '来店', 'なし').isVisit, true);
});
check('旧シートの「なし」も来店ではない', () => {
  assert.equal(judgeStatus('キャンセル', 'なし', '').isVisit, false);
});
check('契約は来店・確定を含意する', () => {
  const s = judgeStatus('', '', '契約');
  assert.ok(s.isContract && s.isVisit && s.isConfirmed);
});
check('運用メモ（SMS/Gmail/終了/不在）でも来店済なら確定', () => {
  for (const memo of ['SMS', 'Gmail', '終了', '不在（2回）', 'メール']) {
    const s = judgeStatus(memo, '来店', 'なし');
    assert.equal(s.isConfirmed, true, memo);
    assert.equal(s.isVisit, true, memo);
  }
});
check('キャンセル・後追いは未確定', () => {
  assert.equal(judgeStatus('キャンセル', '', '').isConfirmed, false);
  assert.equal(judgeStatus('後追い', '', '').isConfirmed, false);
});

// 実DB「予約明細」タブの列並びを再現したフィクスチャ
const DB_HEADER = ['予約ID', '予約通知日', '店舗', 'メニュー', '予約媒体', '顧客名', '氏名カナ',
  '電話番号', 'メールアドレス', '年齢', '担当スタッフ', '体験料金', '希望日時1', '希望日時2',
  '希望日時3', '来店予定日', '予約確定', '来店状況', '契約状況', '契約金額', '後追い状況',
  '実来店日', '契約日', '最終連絡日', '後追い期限', '備考', '登録日時', '更新日時', '更新者', '削除フラグ'];
const dbRow = (id, date, store, menu, media, confirmed, visit, contract, deleted = '') => {
  const r = new Array(DB_HEADER.length).fill('');
  r[0] = id; r[1] = date; r[2] = store; r[3] = menu; r[4] = media;
  r[5] = '山田花子'; r[7] = '09012345678';
  r[16] = confirmed; r[17] = visit; r[18] = contract; r[19] = '¥123,400';
  r[29] = deleted;
  return r;
};

const DB_TAB = [
  DB_HEADER,
  dbRow('R2026-00001', '2026/01/01', 'TouchMe富士店', 'フェイシャル', 'HPB', '確定', '来店', '契約'),
  dbRow('R2026-00002', '2026/01/04', 'SlenderMe甲府店', '痩身', 'ネット検索', '確定', '来店', 'なし'),
  dbRow('R2026-00003', '2026/01/04', 'TouchMe富士店', 'フェイシャル', 'インスタ広告', '後追い', '', ''),
  dbRow('R2026-00004', '2026/01/05', 'TouchMe甲府昭和店', '脱毛', 'HPB', '確定', '未来店', ''),
  dbRow('R2026-00005', '2026/01/06', 'TouchMe甲府昭和店', '脱毛', '', 'キャンセル', '', ''),
  dbRow('R2026-00006', '2026/01/07', '閉店した店', '痩身', 'HPB', '確定', '来店', '契約'),
  dbRow('R2026-00007', '2026/01/08', 'TouchMe富士店', '痩身', 'HPB', '確定', '来店', '契約', '1'),
  new Array(DB_HEADER.length).fill(''), // 空行
];

console.log('extractDbRows');
const db = extractDbRows(DB_TAB, resolveStore);
check('有効行のみ抽出（削除フラグ・空行・未知店舗を除外）', () => {
  assert.equal(db.rows.length, 5);
  assert.equal(db.skipped, 2);
});
check('未知の店舗名を報告する', () => {
  assert.deepEqual(db.unknownStores, ['閉店した店']);
});
check('店舗名を店舗コードに解決する', () => {
  assert.deepEqual(db.rows.map((r) => r.store),
    ['tm-fuji', 'sm-kofu', 'tm-fuji', 'tm-kofu', 'tm-kofu']);
});
check('顧客名・電話番号・契約金額を持ち出さない', () => {
  assert.deepEqual(Object.keys(db.rows[0]).sort(),
    ['date', 'isConfirmed', 'isContract', 'isVisit', 'media', 'menu', 'store']);
});
check('媒体が空なら「その他」に寄せる', () => {
  assert.equal(db.rows[4].media, 'その他');
});
check('未来店の行は来店に数えない', () => {
  const r = db.rows[3];
  assert.equal(r.isConfirmed, true);
  assert.equal(r.isVisit, false);
});
check('ファネル集計が期待どおり', () => {
  const b = newBucket();
  db.rows.forEach((r) => bump(b, r));
  const f = finalize(b);
  // 予約5 / 確定3(来店2+未来店1) / 来店2 / 契約1
  assert.equal(f.count, 5);
  assert.equal(f.confirmed, 3);
  assert.equal(f.visit, 2);
  assert.equal(f.contract, 1);
});
check('必須列が欠けていたら例外を投げる', () => {
  const broken = [['予約ID', '顧客名'], ['R1', '山田']];
  assert.throws(() => extractDbRows(broken, resolveStore), /必要な列がありません/);
});

console.log(`\n${passed} passed`);
