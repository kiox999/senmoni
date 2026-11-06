import assert from 'node:assert/strict';
import { createSync } from '../core.js';
import { createStore } from '../store.js';

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('  ok  ' + name); }

function fakeLS() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), _m: m };
}
/* クラウド(全端末で共有) */
function fakeCloud() {
  const docs = new Map();
  return {
    docs,
    transportFor(getUid) {
      return {
        syncDoc: async (uid, docId, fn) => {
          const key = uid + '/' + docId;
          const cloud = docs.has(key) ? JSON.parse(docs.get(key)) : {};
          const merged = fn(cloud);
          docs.set(key, JSON.stringify(merged));
          return merged;
        },
        signOut: async () => {}
      };
    }
  };
}
function device(cloud, opts = {}) {
  const ls = fakeLS();
  const store = createStore(ls);
  let engineOn = false, reloaded = 0, answer = opts.answer || 'merge';
  const sync = createSync({
    store, transport: cloud.transportFor(), engineOn: () => engineOn,
    reload: () => { reloaded++; }, ask: async () => answer
  });
  return {
    ls, store, sync,
    get reloaded() { return reloaded; }, setEngine(v) { engineOn = v; }, setAnswer(a) { answer = a; },
    setLocal(key, obj) { ls.setItem(key, JSON.stringify(obj)); },
    getLocal(key) { return JSON.parse(ls.getItem(key)); }
  };
}
const U = { uid: 'u1', email: 'a@example.com' };
const entry = (seen, last) => ({ seen, ok: seen, ng: 0, due: 0, ival: 1, last, lastOk: true, bm: 0 });

await t('端末Aで初回ログイン → クラウドに上がり、2台目で合算されて反映される', async () => {
  const cloud = fakeCloud();
  const A = device(cloud), B = device(cloud);
  A.setLocal('board-global-v1', { xp: 300, xpTotal: 800, owned: ['default', 'mint'], palette: 'mint' });
  A.setLocal('board-naika-v1', { prog: { 1: entry(2, 100) }, hist: { d1: { a: 2, c: 2 } }, rank: 1, xp: 300, xpTotal: 800, count: 10 });
  await A.sync.onAuth(U, true);
  assert.equal(JSON.parse(cloud.docs.get('u1/global')).xp, 300);

  B.setLocal('board-global-v1', { xp: 50, xpTotal: 120, owned: ['default'] });
  B.setLocal('board-naika-v1', { prog: { 1: entry(1, 50), 2: entry(1, 60) }, hist: { d1: { a: 1, c: 1 } }, xp: 50, xpTotal: 120 });
  await B.sync.onAuth(U, true);
  const g = B.getLocal('board-global-v1');
  assert.equal(g.xp, 350); assert.equal(g.xpTotal, 920);
  assert.deepEqual(g.owned.sort(), ['default', 'mint']);
  const nk = B.getLocal('board-naika-v1');
  assert.equal(nk.prog[1].seen, 3); assert.ok(nk.prog[2]);
  assert.equal(nk.xpTotal, 920, '科目ファイル側のXP表示も揃う');
  assert.equal(B.reloaded, 1, '反映後に再読み込み');
});

await t('学習中(エンジン起動中)は上書きせず保留→再読み込み後の起動時同期で取り込む', async () => {
  const cloud = fakeCloud();
  const A = device(cloud), B = device(cloud);
  A.setLocal('board-global-v1', { xp: 100, xpTotal: 100 });
  await A.sync.onAuth(U, true);
  B.setLocal('board-global-v1', { xp: 100, xpTotal: 100 });
  await B.sync.onAuth(U, true);          // Bも同じ状態から開始
  // Aで +40
  A.setLocal('board-global-v1', { xp: 140, xpTotal: 140 });
  await A.sync.syncAll({ onlyChanged: true });
  // Bは学習中(エンジン起動)で +10
  B.setEngine(true);
  B.setLocal('board-global-v1', { xp: 110, xpTotal: 110 });
  const r = await B.sync.syncAll({ onlyChanged: true });
  assert.equal(r.pending, true); assert.equal(r.applied, false);
  assert.equal(B.getLocal('board-global-v1').xp, 110, '学習中は端末内を書き換えない');
  assert.equal(JSON.parse(cloud.docs.get('u1/global')).xp, 150, 'クラウドは両方の増分を合算');
  // 再読み込み相当: エンジンOFFで起動時同期
  B.setEngine(false);
  const r2 = await B.sync.syncAll({});
  assert.equal(r2.applied, true);
  assert.equal(B.getLocal('board-global-v1').xp, 150);
  // 追加の二重計上がない
  await B.sync.syncAll({}); await A.sync.syncAll({});
  assert.equal(JSON.parse(cloud.docs.get('u1/global')).xp, 150);
  assert.equal(A.getLocal('board-global-v1').xp, 150);
});

await t('繰り返し同期してもXPが増えない(冪等)', async () => {
  const cloud = fakeCloud(); const A = device(cloud);
  A.setLocal('board-global-v1', { xp: 10, xpTotal: 10 });
  await A.sync.onAuth(U, true);
  for (let i = 0; i < 5; i++) await A.sync.syncAll({});
  assert.equal(JSON.parse(cloud.docs.get('u1/global')).xp, 10);
  assert.equal(A.getLocal('board-global-v1').xp, 10);
});

await t('別アカウントでログイン: 「端末のデータを消して復元」を選ぶと合算されない', async () => {
  const cloud = fakeCloud();
  const A = device(cloud);
  A.setLocal('board-global-v1', { xp: 500, xpTotal: 500 });
  await A.sync.onAuth(U, true);
  // 別ユーザーのクラウドデータ
  cloud.docs.set('u2/global', JSON.stringify({ xp: 20, xpTotal: 20 }));
  A.setAnswer('discard');
  await A.sync.onAuth({ uid: 'u2', email: 'b@example.com' }, true);
  assert.equal(A.getLocal('board-global-v1').xp, 20);
  assert.equal(JSON.parse(cloud.docs.get('u1/global')).xp, 500, '元のアカウントのデータは無傷');
});

await t('別アカウントでログイン: 「統合する」なら合算、キャンセルなら何もしない', async () => {
  const cloud = fakeCloud();
  const A = device(cloud);
  A.setLocal('board-global-v1', { xp: 500, xpTotal: 500 });
  await A.sync.onAuth(U, true);
  cloud.docs.set('u2/global', JSON.stringify({ xp: 20, xpTotal: 20 }));
  A.setAnswer('cancel');
  await A.sync.onAuth({ uid: 'u2', email: 'b@example.com' }, true);
  assert.equal(A.getLocal('board-global-v1').xp, 500);
  assert.equal(JSON.parse(cloud.docs.get('u2/global')).xp, 20);
  A.setAnswer('merge');
  await A.sync.onAuth({ uid: 'u2', email: 'b@example.com' }, true);
  assert.equal(A.getLocal('board-global-v1').xp, 520);
});

await t('通信失敗時は端末内データを壊さず、次回に再試行できる', async () => {
  const cloud = fakeCloud(); const A = device(cloud);
  A.setLocal('board-global-v1', { xp: 10, xpTotal: 10 });
  await A.sync.onAuth(U, true);
  const orig = cloud.transportFor;
  A.sync.state.user = U;
  const bad = createSync({ store: A.store, transport: { syncDoc: async () => { throw new Error('offline'); }, signOut: async () => {} }, engineOn: () => false, reload() {}, ask: async () => 'merge' });
  await bad.onAuth(U, false);
  assert.equal(bad.state.status, 'error');
  assert.equal(A.getLocal('board-global-v1').xp, 10);
  void orig;
  A.setLocal('board-global-v1', { xp: 25, xpTotal: 25 });
  await A.sync.syncAll({});
  assert.equal(JSON.parse(cloud.docs.get('u1/global')).xp, 25);
});

await t('引き継ぎコード: 書き出し→別端末へ復元(置き換え)', async () => {
  const cloud = fakeCloud(); const A = device(cloud), B = device(cloud);
  A.setLocal('board-global-v1', { xp: 77, xpTotal: 99, owned: ['default', 'mint'] });
  A.setLocal('board-kyukyu-v1', { prog: { 5: entry(3, 9) }, rank: 2 });
  const code = JSON.parse(JSON.stringify(A.sync.exportAll()));
  B.setLocal('board-global-v1', { xp: 5, xpTotal: 5 });
  B.sync.importAll(code);
  assert.equal(B.getLocal('board-global-v1').xp, 77);
  assert.equal(B.getLocal('board-kyukyu-v1').prog[5].seen, 3);
  assert.throws(() => B.sync.importAll({ foo: 1 }));
});

console.log(n + ' tests passed');
