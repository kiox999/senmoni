/* Firebase(Googleログイン + Firestore)との通信 */
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut
} from 'firebase/auth';
import { initializeFirestore, doc, runTransaction, serverTimestamp } from 'firebase/firestore';

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
