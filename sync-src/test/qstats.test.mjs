import assert from 'node:assert/strict';
import { createQStats } from '../qstats.js';

function fakeLS() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }; }
let pass = 0;
async function t(name, fn) { await fn(); pass++; console.log('  ok  ' + name); }

await t('同じ問題は1回だけ積まれ、送信後にキューが空になる', async () => {
  const ls = fakeLS(), sent = [];
  const qs = createQStats({ ls, transport: { reportStat: async (u, s, q, ok) => { sent.push([u, s, q, ok]); } } });
  qs.report('kyukyu', 12, true); qs.report('kyukyu', 12, false); qs.report('naika', 3, false); qs.report('bad', 1, true);
  await qs.flush('u1');
  assert.deepEqual(sent, [['u1', 'kyukyu', 12, true], ['u1', 'naika', 3, false]]);
  assert.deepEqual(JSON.parse(ls.getItem('bstat-queue')), []);
});

await t('規則で拒否（既に送信済み）なら捨て、通信エラーなら残す', async () => {
  const ls = fakeLS();
  let mode = 'deny';
  const qs = createQStats({ ls, transport: { reportStat: async () => { const e = new Error('x'); e.code = mode === 'deny' ? 'permission-denied' : 'unavailable'; throw e; } } });
  qs.report('shouni', 5, true);
  await qs.flush('u1');
  assert.equal(JSON.parse(ls.getItem('bstat-queue')).length, 0);
  mode = 'net'; qs.report('shouni', 6, true);
  await qs.flush('u1');
  assert.equal(JSON.parse(ls.getItem('bstat-queue')).length, 1);
});

await t('集計の取得は科目ごとに保存され、期限内は再取得しない', async () => {
  const ls = fakeLS(); let calls = 0;
  const qs = createQStats({ ls, transport: { fetchStats: async (min) => { calls++; assert.equal(min, 30); return [{ subj: 'kyukyu', qid: 7, n: 40, c: 10 }, { subj: 'x', qid: 1, n: 50, c: 1 }]; } } });
  await qs.refresh(false); await qs.refresh(false);
  assert.equal(calls, 1);
  assert.deepEqual(qs.get('kyukyu'), { 7: [40, 10] });
  assert.deepEqual(qs.get('naika'), {});
});
await t('作者の固定: 取得・設定・解除が端末にも反映される', async () => {
  const ls = fakeLS(); const calls = [];
  const qs = createQStats({ ls, transport: {
    fetchPins: async () => ({ kyukyu: { 3: 'hard' } }),
    setPin: async (s, q, l) => { calls.push([s, q, l]); } } });
  await qs.refreshPins();
  assert.deepEqual(qs.pins('kyukyu'), { 3: 'hard' });
  await qs.setPin('kyukyu', 9, 'hard');
  await qs.setPin('kyukyu', 3, null);
  assert.deepEqual(qs.pins('kyukyu'), { 9: 'hard' });
  assert.deepEqual(calls, [['kyukyu', 9, 'hard'], ['kyukyu', 3, null]]);
  await assert.rejects(() => qs.setPin('kyukyu', 1, 'super'));
});
console.log(pass + ' tests passed');
