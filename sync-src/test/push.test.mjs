import assert from 'node:assert/strict';
import { createPush, utcHourOf, dueDay } from '../push.js';

function fakeLS() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }; }
let pass = 0;
async function t(name, fn) { await fn(); pass++; console.log('  ok  ' + name); }
const JST = -540;

await t('現地時刻→協定世界時の換算', async () => {
  assert.equal(utcHourOf(20, JST), 11);
  assert.equal(utcHourOf(7, JST), 22);
  assert.equal(utcHourOf(20, 300), 1);     /* 米国東部(冬) */
  assert.equal(utcHourOf(20, -330), 14);   /* インド(+5:30)は切り捨て */
});

await t('送信判定: 決めた時刻〜3時間未満・未送信・その日未解答のときだけ送る', async () => {
  const sub = { hour: 20, tz: JST };
  const at = (iso) => Date.parse(iso);   /* UTC */
  assert.equal(dueDay(sub, '', at('2026-11-17T11:05:00Z')), '2026-11-17');            /* 20:05 JST */
  assert.equal(dueDay(sub, '', at('2026-11-17T12:40:00Z')), '2026-11-17');            /* 21:40 遅延実行 */
  assert.equal(dueDay(sub, '', at('2026-11-17T13:05:00Z')), '2026-11-17');            /* 22:05 かなり遅れた実行 */
  assert.equal(dueDay(sub, '', at('2026-11-17T14:05:00Z')), null);                    /* 23:05 遅すぎ */
  assert.equal(dueDay(sub, '', at('2026-11-17T10:55:00Z')), null);                    /* 19:55 まだ */
  assert.equal(dueDay(sub, '2026-11-17', at('2026-11-17T11:05:00Z')), null);          /* 今日は解いた */
  assert.equal(dueDay(sub, '2026-11-16', at('2026-11-17T11:05:00Z')), '2026-11-17');  /* 昨日解いただけ */
  assert.equal(dueDay({ hour: 20, tz: JST, sent: '2026-11-17' }, '', at('2026-11-17T12:05:00Z')), null); /* 送信済み */
  /* 切り替え4時: 午前2時の通知は「前日」の扱い。前日の夜に解いていれば送らない */
  assert.equal(dueDay({ hour: 2, tz: JST }, '2026-11-17', at('2026-11-17T17:05:00Z'), 4), null);
  assert.equal(dueDay({ hour: 2, tz: JST }, '2026-11-16', at('2026-11-17T17:05:00Z'), 4), '2026-11-17');
  /* 切り替え0時なら日付どおり */
  assert.equal(dueDay({ hour: 2, tz: JST }, '2026-11-17', at('2026-11-17T17:05:00Z'), 0), '2026-11-18');
  /* 23時設定で実行が0時台にずれても、対象は前日のまま */
  assert.equal(dueDay({ hour: 23, tz: JST }, '', at('2026-11-17T15:10:00Z')), '2026-11-17');
  assert.equal(dueDay({ hour: 23, tz: JST }, '2026-11-17', at('2026-11-17T15:10:00Z')), null);
});

function fakeT(log) {
  return { pushConfigured: () => true, pushSupported: async () => true, pushToken: async () => 'tok1',
    pushDropToken: async () => { log.push(['drop']); }, pushSave: async (u, d, r) => { log.push(['save', u, r.hour, r.utcHour, r.tz, r.token]); },
    pushRemove: async (u) => { log.push(['remove', u]); }, pushActive: async (u, day) => { log.push(['act', u, day]); } };
}

await t('有効化→時刻変更→解除', async () => {
  globalThis.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
  const ls = fakeLS(), log = [];
  const p = createPush({ ls, transport: fakeT(log), getUid: () => 'u1', tzOffset: () => JST });
  await p.check();
  assert.equal(p.state().on, false);
  await p.enable(21);
  assert.deepEqual(log[0], ['save', 'u1', 21, 12, JST, 'tok1']);
  assert.equal(p.state().on, true);
  await p.setHour(7);
  assert.deepEqual(log[1], ['save', 'u1', 7, 22, JST, 'tok1']);
  await p.refresh();                       /* 変化なし→書かない */
  assert.equal(log.length, 2);
  await p.disable();
  assert.deepEqual(log.slice(2), [['remove', 'u1'], ['drop']]);
  assert.equal(p.state().on, false);
});

await t('通知が拒否されたら有効にならない／別アカウントでは無効扱い', async () => {
  globalThis.Notification = { permission: 'denied', requestPermission: async () => 'denied' };
  const ls = fakeLS(), log = []; let uid = 'u1';
  const p = createPush({ ls, transport: fakeT(log), getUid: () => uid, tzOffset: () => JST });
  await p.check();
  await assert.rejects(() => p.enable(20));
  assert.equal(log.length, 0);
  globalThis.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
  await p.enable(20);
  uid = 'u2';
  assert.equal(p.state().on, false);
});

await t('解いた日の記録は1日1回。未ログインでは送らない', async () => {
  const ls = fakeLS(), log = []; let uid = null;
  const p = createPush({ ls, transport: fakeT(log), getUid: () => uid, tzOffset: () => JST });
  p.markActive('2026-11-17');
  assert.equal(log.length, 0);
  uid = 'u1';
  p.markActive('2026-11-17'); p.markActive('2026-11-17'); p.markActive('2026-11-18');
  assert.deepEqual(log, [['act', 'u1', '2026-11-17'], ['act', 'u1', '2026-11-18']]);
});

console.log('push: ' + pass + ' passed');
