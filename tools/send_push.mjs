/* リマインド通知の送信（GitHub Actions が1時間ごとに実行する。.github/workflows/push.yml）。
   その日まだ問題を解いていない人の端末へ、本人が決めた時刻に通知を送る。
   必要なもの: 環境変数 FIREBASE_SERVICE_ACCOUNT（サービスアカウントの秘密鍵JSON。docs/PUSH_SETUP.md）
   試し方: DRY_RUN=1 を付けると、送らずに対象件数だけ表示する */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { dueDay } from '../sync-src/push.js';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log('FIREBASE_SERVICE_ACCOUNT が未設定のため、何もしません（docs/PUSH_SETUP.md）'); process.exit(0); }
const DRY = !!process.env.DRY_RUN;
const URL_ = process.env.APP_URL || 'https://kiox999.github.io/senmoni/';

initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore(), fcm = getMessaging();
const now = Date.now(), h = new Date(now).getUTCHours();

/* 実行の遅れに備えて、1時間前が予定だった宛先も拾う（送信済みは sent で除外） */
const snap = await db.collection('pushSubs').where('utcHour', 'in', [h, (h + 23) % 24, (h + 22) % 24]).get();
const acts = new Map();
let sent = 0, skipped = 0, removed = 0, failed = 0;

for (const d of snap.docs) {
  const sub = d.data();
  if (!sub.uid || !sub.token) { skipped++; continue; }
  if (!acts.has(sub.uid)) {
    const a = await db.collection('pushAct').doc(sub.uid).get();
    /* 本人の「1日の切り替え時刻」は同期データ(users/<uid>/state/global)にある。無ければ既定の4時 */
    let ds;
    try { const g = await db.doc('users/' + sub.uid + '/state/global').get(); if (g.exists) ds = JSON.parse(g.data().json).dayStart; } catch (e) { /* 既定値を使う */ }
    acts.set(sub.uid, { last: a.exists ? (a.data().last || '') : '', ds });
  }
  const act = acts.get(sub.uid);
  const day = dueDay(sub, act.last, now, act.ds);
  if (!day) { skipped++; continue; }
  if (DRY) { sent++; continue; }
  try {
    await fcm.send({
      token: sub.token,
      data: { title: '専門医試験 演習', body: '今日はまだ問題を解いていません。1問だけでも解いてみませんか。', url: URL_ },
      webpush: { headers: { TTL: '7200', Urgency: 'high' } }
    });
    await d.ref.update({ sent: day });
    sent++;
  } catch (e) {
    const c = (e && e.code) || '';
    if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token' || c === 'messaging/invalid-argument') {
      await d.ref.delete(); removed++;       /* アプリを消した・通知を切った端末 */
    } else { failed++; console.log('送信失敗: ' + c); }
  }
}
console.log((DRY ? '[DRY_RUN] ' : '') + '対象 ' + snap.size + ' 件 / 送信 ' + sent + ' / 対象外 ' + skipped + ' / 無効な宛先を削除 ' + removed + ' / 失敗 ' + failed);
if (failed && !sent) process.exit(1);
