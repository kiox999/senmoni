/* 同期の本体。通信(transport)・端末内保存(store)・画面への質問(ask)は外から渡す */
import { DOC_IDS, mergeDoc, deepEq, keysFor } from './merge.js';

function withTimeout(p, ms, msg) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error(msg)); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

export function createSync(deps) {
  var store = deps.store, transport = deps.transport;
  var now = deps.now || Date.now;
  var st = { user: null, status: 'init', last: store.getLast(), error: '', pending: false };
  var running = null, rerun = null;
  var listeners = [];
  var readyResolve, ready = new Promise(function (r) { readyResolve = r; });

  function emit() { listeners.forEach(function (f) { try { f(st); } catch (e) { /* noop */ } }); }
  function setStatus(s, err) { st.status = s; st.error = err || ''; emit(); }

  /* 変更が無い場合の「整形だけの差」を無視するための正規形 */
  function norm(docId, d) { return mergeDoc(docId, d, d, d); }

  async function syncAll(opts) {
    opts = opts || {};
    if (!st.user) return { skipped: true };
    if (running) { rerun = Object.assign(rerun || {}, opts); return running; }
    var uid = st.user.uid;
    running = (async function () {
      setStatus('syncing');
      var plan = [];
      DOC_IDS.forEach(function (docId) {
        var local = store.read(docId), base = store.getBase(uid, docId);
        if (opts.onlyChanged && base && deepEq(local, base)) return;
        plan.push({ docId: docId, local: local, base: base || {} });
      });
      var results = [];
      for (var i = 0; i < plan.length; i++) {
        var p = plan[i];
        var merged = await withTimeout(
          transport.syncDoc(uid, p.docId, function (cloud) { return mergeDoc(p.docId, p.base, p.local, cloud); }),
          deps.timeoutMs || 25000, '通信がタイムアウトしました');
        results.push({ docId: p.docId, local: p.local, merged: merged });
      }
      var canApply = !!opts.force || !deps.engineOn();
      var applied = false, pending = false;
      results.forEach(function (r) {
        if (deepEq(r.merged, norm(r.docId, r.local))) { store.setBase(uid, r.docId, r.local); return; }   /* クラウド側に新しい内容なし */
        var untouched = deepEq(store.read(r.docId), r.local);
        if (canApply && untouched) { store.write(r.docId, r.merged); store.setBase(uid, r.docId, r.merged); applied = true; }
        else { store.setBase(uid, r.docId, r.local); pending = true; }
      });
      st.last = now(); store.setLast(st.last); store.setOwner(uid);
      st.pending = pending;
      setStatus('ok');
      return { applied: applied, pending: pending };
    })().catch(function (e) {
      setStatus('error', (e && e.message) || String(e));
      return { error: e };
    }).then(function (res) {
      running = null;
      if (rerun) { var o = rerun; rerun = null; Promise.resolve().then(function () { return syncAll(o); }); }
      return res;
    });
    return running;
  }

  /* ログイン状態の変化。interactive=true はログイン操作の直後 */
  async function onAuth(user, interactive) {
    st.user = user;
    if (!user) { store.setRemembered(''); setStatus('signedout'); readyResolve(); return; }
    store.setRemembered(user.uid);
    try {
      var owner = store.getOwner();
      if (owner === user.uid) {
        var r = await syncAll({ force: !!interactive });
        if (interactive && r && r.applied) deps.reload();
        return;
      }
      /* 初回ログイン、または別アカウントでのログイン */
      var hasData = store.hasData();
      if (hasData) {
        var choice = await deps.ask(owner ? 'other-account' : 'first-merge', { email: user.email || '' });
        if (choice === 'cancel') { await transport.signOut(); return; }
        if (choice === 'discard') store.wipe();
      }
      store.clearBase(user.uid);
      var r2 = await syncAll({ force: true });
      if (r2 && r2.error) return;
      if (r2 && r2.applied) deps.reload();
    } finally { readyResolve(); }
  }

  /* 手動バックアップ用 */
  function exportAll() {
    var docs = {};
    DOC_IDS.forEach(function (id) { docs[id] = store.read(id); });
    return { app: 'senmoni', v: 1, ts: now(), docs: docs };
  }
  function importAll(data) {
    if (!data || data.app !== 'senmoni' || !data.docs || typeof data.docs !== 'object') throw new Error('引き継ぎコードの形式が違います');
    store.wipe();
    DOC_IDS.forEach(function (id) {
      var d = data.docs[id]; if (!d || typeof d !== 'object') return;
      var clean = {}; keysFor(id).forEach(function (k) { if (d[k] !== undefined) clean[k] = d[k]; });
      store.write(id, clean);
    });
  }

  return {
    state: st, ready: ready, syncAll: syncAll, onAuth: onAuth, exportAll: exportAll, importAll: importAll,
    subscribe: function (f) { listeners.push(f); f(st); return function () { listeners = listeners.filter(function (x) { return x !== f; }); }; },
    setStatus: setStatus, readyNow: function () { readyResolve(); }
  };
}
