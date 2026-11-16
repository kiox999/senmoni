/* Firebase(Googleログイン + Firestore)との通信 */
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut
} from 'firebase/auth';
import {
  initializeFirestore, doc, runTransaction, serverTimestamp, collection, addDoc,
  writeBatch, increment, query, where, getDocs, getDoc, setDoc, updateDoc, deleteField, FieldPath
  , deleteDoc
} from 'firebase/firestore';
import { getMessaging, getToken, deleteToken, isSupported as messagingSupported } from 'firebase/messaging';

var MAX_JSON = 900000;   /* Firestoreは1ドキュメント1MiBまで */

export function isConfigured(cfg) {
  return !!(cfg && cfg.apiKey && cfg.projectId && cfg.appId && String(cfg.apiKey).indexOf('YOUR_') !== 0);
}

export function createFirebaseTransport(cfg) {
  var app = initializeApp(cfg);
  var auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver
  });
  var db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

  function toUser(u) { return u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null; }

  return {
    /* onAuth(user, interactive) */
    init: function (onAuth, takeInteractive) {
      getRedirectResult(auth).catch(function () { /* リダイレクト経由でない通常起動では何も起きない */ });
      onAuthStateChanged(auth, function (u) { onAuth(toUser(u), u ? takeInteractive() : false); });
    },
    signIn: async function () {
      var provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        var c = e && e.code;
        if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') {
          try { sessionStorage.setItem('bsync-interactive', '1'); } catch (x) { /* noop */ }
          await signInWithRedirect(auth, provider);
          return;
        }
        if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
        throw e;
      }
    },
    signOut: function () { return signOut(auth); },
    /* お問い合わせ: inquiries に1件追加する（ログイン不要。読み取りはコンソールからのみ） */
    sendInquiry: function (d) {
      var u = auth.currentUser;
      return addDoc(collection(db, 'inquiries'), Object.assign({}, d, { uid: u ? u.uid : '', createdAt: serverTimestamp() }));
    },
    /* 正答率の集計: 1人1問1回だけ。目印(qstatBy)と集計(qstats)を同時に書き、規則で整合性を確かめる */
    reportStat: function (uid, subj, qid, ok) {
      var id = subj + '_' + qid;
      var b = writeBatch(db);
      b.set(doc(db, 'qstatBy', id + '_' + uid), { ok: !!ok });
      b.set(doc(db, 'qstats', id), { subj: subj, qid: qid, n: increment(1), c: increment(ok ? 1 : 0) }, { merge: true });
      return b.commit();
    },
    /* 回答数が min 以上の問題の集計値を取得する（単一フィールドの範囲検索なので複合インデックスは不要） */
    fetchStats: async function (min) {
      var snap = await getDocs(query(collection(db, 'qstats'), where('n', '>=', min)));
      var rows = [];
      snap.forEach(function (d) { var x = d.data(); rows.push({ subj: x.subj, qid: x.qid, n: x.n, c: x.c }); });
      return rows;
    },
    /* 作者かどうか: Firebaseコンソールで admins/<uid> を作った人だけ true */
    checkAdmin: async function (uid) {
      var snap = await getDoc(doc(db, 'admins', uid));
      return snap.exists();
    },
    /* 作者が固定した難易度 { subj: { qid: level } } */
    fetchPins: async function () {
      var snap = await getDocs(collection(db, 'diffPins'));
      var out = {};
      snap.forEach(function (d) { var x = d.data(); out[d.id] = (x && x.p) || {}; });
      return out;
    },
    /* level が null なら固定を外す */
    setPin: function (subj, qid, level) {
      var ref = doc(db, 'diffPins', subj);
      if (level) { var p = {}; p[String(qid)] = level; return setDoc(ref, { p: p }, { merge: true }); }
      return updateDoc(ref, new FieldPath('p', String(qid)), deleteField());
    },
    /* ---- リマインド通知（Webプッシュ） ---- */
    pushConfigured: function () { return !!(cfg.vapidKey && cfg.messagingSenderId); },
    pushSupported: function () {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return Promise.resolve(false);
      return messagingSupported().catch(function () { return false; });
    },
    /* この端末の通知の宛先（トークン）を取得する。アプリ本体の sw.js をそのまま使う */
    pushToken: async function () {
      var reg = await navigator.serviceWorker.ready;
      return getToken(getMessaging(app), { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
    },
    pushDropToken: function () { return deleteToken(getMessaging(app)).catch(function () { return false; }); },
    /* 宛先と通知時刻を pushSubs/<uid>_<端末ID> に保存する */
    pushSave: function (uid, dev, d) {
      return setDoc(doc(db, 'pushSubs', uid + '_' + dev),
        { uid: uid, token: d.token, hour: d.hour, utcHour: d.utcHour, tz: d.tz, updatedAt: serverTimestamp() }, { merge: true });
    },
    pushRemove: function (uid, dev) { return deleteDoc(doc(db, 'pushSubs', uid + '_' + dev)); },
    /* 「この日は解いた」の目印。通知を送る側が見て、解いた日は送らない */
    pushActive: function (uid, day) { return setDoc(doc(db, 'pushAct', uid), { last: day }); },
    /* クラウドの1ドキュメントを読み、mergeFn(cloudData)の結果を（変化があれば）書き込む。競合時はトランザクションが自動で再試行する */
    syncDoc: function (uid, docId, mergeFn) {
      var ref = doc(db, 'users', uid, 'state', docId);
      return runTransaction(db, async function (tx) {
        var snap = await tx.get(ref);
        var cloud = {};
        if (snap.exists()) { try { cloud = JSON.parse(snap.data().json) || {}; } catch (e) { cloud = {}; } }
        var merged = mergeFn(cloud);
        var json = JSON.stringify(merged);
        if (json.length > MAX_JSON) throw new Error('データが大きすぎて同期できません(' + docId + ')');
        if (!snap.exists() || json !== JSON.stringify(cloud)) tx.set(ref, { json: json, updatedAt: serverTimestamp(), v: 1 });
        return merged;
      });
    }
  };
}
