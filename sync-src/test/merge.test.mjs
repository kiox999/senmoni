import assert from 'node:assert/strict';
import { mergeGlobal, mergeSubject, mergeDoc, deepEq } from '../merge.js';

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ok  ' + name); }

t('XP: 2端末で別々に稼いだ分が合算される', () => {
  const base = { xp: 100, xpTotal: 500 };
  const a = { xp: 150, xpTotal: 550 }, cloud = { xp: 130, xpTotal: 530 };
  const m = mergeGlobal(base, a, cloud);
  assert.equal(m.xp, 180); assert.equal(m.xpTotal, 580);
});
t('XP: 使った分(購入)も反映され、0未満にならない', () => {
  const m = mergeGlobal({ xp: 100 }, { xp: 0 }, { xp: 50 });
  assert.equal(m.xp, 0);
});
t('初回ログイン(base無し): 端末とクラウドのXPを合算', () => {
  const m = mergeGlobal({}, { xp: 200, xpTotal: 200 }, { xp: 1000, xpTotal: 3000 });
  assert.equal(m.xp, 1200); assert.equal(m.xpTotal, 3200);
});
t('クラウドが空なら端末の値がそのまま上がる', () => {
  const m = mergeGlobal({}, { xp: 7, xpTotal: 9, owned: ['default', 'mint'], palette: 'mint' }, {});
  assert.deepEqual(m, { xp: 7, xpTotal: 9, owned: ['default', 'mint'], palette: 'mint' });
});
t('購入済みは和集合', () => {
  const m = mergeGlobal({ owned: ['default'] }, { owned: ['default', 'mint'] }, { owned: ['default', 'sakura'] });
  assert.deepEqual(m.owned.sort(), ['default', 'mint', 'sakura']);
});
t('設定値: 端末で変えていなければクラウド、変えていれば端末', () => {
  assert.equal(mergeGlobal({ theme: 'auto' }, { theme: 'auto' }, { theme: 'dark' }).theme, 'dark');
  assert.equal(mergeGlobal({ theme: 'auto' }, { theme: 'light' }, { theme: 'dark' }).theme, 'light');
});
t('prog: 解答回数は合算、直近の解答情報は新しい方', () => {
  const b = { prog: { 1: { seen: 1, ok: 1, ng: 0, due: 10, ival: 1, last: 100, lastOk: true, bm: 0 } } };
  const l = { prog: { 1: { seen: 2, ok: 2, ng: 0, due: 20, ival: 2, last: 200, lastOk: true, bm: 0 } } };
  const c = { prog: { 1: { seen: 2, ok: 1, ng: 1, due: 15, ival: 1, last: 150, lastOk: false, bm: 0 } } };
  const m = mergeSubject(b, l, c).prog[1];
  assert.equal(m.seen, 3); assert.equal(m.ok, 2); assert.equal(m.ng, 1);
  assert.equal(m.last, 200); assert.equal(m.due, 20); assert.equal(m.lastOk, true);
});
t('prog: 片方にしかない問題は両方残る', () => {
  const m = mergeSubject({}, { prog: { 1: { seen: 1, ok: 1, ng: 0, last: 5 } } }, { prog: { 2: { seen: 1, ok: 0, ng: 1, last: 6 } } });
  assert.deepEqual(Object.keys(m.prog).sort(), ['1', '2']);
});
t('prog: ブックマークの付け外しは変えた側が勝つ', () => {
  const e = (bm) => ({ seen: 1, ok: 1, ng: 0, last: 1, bm });
  assert.equal(mergeSubject({ prog: { 1: e(0) } }, { prog: { 1: e(2) } }, { prog: { 1: e(0) } }).prog[1].bm, 2);
  assert.equal(mergeSubject({ prog: { 1: e(0) } }, { prog: { 1: e(0) } }, { prog: { 1: e(3) } }).prog[1].bm, 3);
});
t('prog: 端末でリセットしたら(クラウドが変わっていなければ)削除が伝わる', () => {
  const e = { seen: 1, ok: 1, ng: 0, last: 1 };
  assert.deepEqual(mergeSubject({ prog: { 1: e } }, { prog: {} }, { prog: { 1: e } }).prog, {});
  /* リセット後にクラウドだけ更新されていた場合は残す */
  const e2 = { seen: 2, ok: 2, ng: 0, last: 2 };
  assert.deepEqual(Object.keys(mergeSubject({ prog: { 1: e } }, { prog: {} }, { prog: { 1: e2 } }).prog), ['1']);
});
t('hist: 日ごとの解答数が合算される', () => {
  const m = mergeSubject({ hist: { d1: { a: 5, c: 3 } } }, { hist: { d1: { a: 8, c: 5 } } }, { hist: { d1: { a: 7, c: 4 }, d2: { a: 2, c: 2 } } });
  assert.deepEqual(m.hist, { d1: { a: 10, c: 6 }, d2: { a: 2, c: 2 } });
});
t('marks: 追加と削除', () => {
  const m = mergeSubject({ marks: { a: 1, b: 1 } }, { marks: { a: 1, c: 1 } }, { marks: { a: 1, b: 1, d: 1 } });
  assert.deepEqual(Object.keys(m.marks).sort(), ['a', 'c', 'd']);   /* bは端末で外した */
});
t('log/examLog: 重複を除き新しい順・上限あり', () => {
  const mk = (i) => ({ id: i, ok: true, ts: i });
  const l = []; for (let i = 1; i <= 50; i++) l.push(mk(i));
  const c = [mk(60), mk(61), mk(1)];
  const m = mergeSubject({}, { log: l.reverse() }, { log: c }).log;
  assert.equal(m.length, 50); assert.equal(m[0].ts, 61);
  assert.equal(new Set(m.map((x) => x.id + '@' + x.ts)).size, 50);
});
t('rank は大きい方', () => {
  assert.equal(mergeSubject({}, { rank: 3 }, { rank: 5 }).rank, 5);
});
t('feedback(メモ): 追加は両方残り、端末での削除・編集は反映', () => {
  const m1 = { id: 1, text: 'a', photos: [], ts: 10 }, m2 = { id: 2, text: 'b', photos: [], ts: 20 }, m3 = { id: 3, text: 'c', photos: [], ts: 30 };
  const r = mergeSubject({ feedback: [m1, m2] }, { feedback: [{ ...m1, text: 'a2' }] }, { feedback: [m1, m2, m3] }).feedback;
  assert.deepEqual(r.map((x) => x.text), ['a2', 'c']);
});
t('冪等: 同期直後にもう一度マージしても変わらない', () => {
  const l = { xp: 40, xpTotal: 90, owned: ['default'] };
  const c = { xp: 10, xpTotal: 50, owned: ['default', 'mint'] };
  const m1 = mergeGlobal({}, l, c);
  const m2 = mergeGlobal(m1, m1, m1);
  assert.ok(deepEq(m1, m2));
  const sl = { prog: { 1: { seen: 2, ok: 1, ng: 1, last: 5, bm: 1 } }, hist: { d: { a: 2, c: 1 } }, marks: { x: 1 } };
  const s1 = mergeSubject({}, sl, {});
  assert.ok(deepEq(mergeSubject(s1, s1, s1), s1));
});
t('mergeDoc(l,l,l) は自分自身(正規形)', () => {
  const sl = { prog: { 1: { seen: 2, ok: 1, ng: 1, last: 5, bm: 1 } }, hist: { d: { a: 2, c: 1 } }, rank: 2 };
  assert.ok(deepEq(mergeDoc('naika', sl, sl, sl), sl));
});
console.log(n + ' tests passed');
