/* ブラウザ用の入口。window.BoardSync を公開し、自動同期のきっかけ（保存・画面復帰・通信復帰）を仕掛ける */
import { createSync } from './core.js';
import { createStore } from './store.js';
import { createUI } from './ui.js';
import { createFirebaseTransport, isConfigured } from './transport-firebase.js';
import { createQStats } from './qstats.js';

(function () {
  var cfg = window.BOARD_FIREBASE;
  var testTransport = window.__BOARD_SYNC_TRANSPORT__;   /* 自動テスト専用 */
  if (!testTransport && !isConfigured(cfg)) {
    window.BoardSync = { configured: false, startup: function () { return Promise.resolve(); },
      sendInquiry: function () { return Promise.reject(new Error('送信機能が設定されていません')); },
      reportFirst: function () {}, qstats: function () { return {}; } };
    return;
  }

  var origSet = Storage.prototype.setItem;
  var store = createStore(window.localStorage, function (k, v) { origSet.call(window.localStorage, k, v); });
  var transport = testTransport || createFirebaseTransport(cfg);
  var ui = null;
  var interactiveNext = false;

  var sync = createSync({
    store: store, transport: transport,
    engineOn: function () { return !!window.BOARD_ENGINE_ON; },
    reload: function () { location.reload(); },
    ask: function (kind, info) { return ui.ask(kind, info); }
  });

  function takeInteractive() {
    var v = interactiveNext;
    try { if (sessionStorage.getItem('bsync-interactive')) { v = true; sessionStorage.removeItem('bsync-interactive'); } } catch (e) { /* noop */ }
    interactiveNext = false;
    return v;
  }

  /* ---- 自動同期のきっかけ ---- */
  var timer = null;
  function signedInOwner() { var u = sync.state.user; return !!u && store.getOwner() === u.uid; }
  function scheduleSync(ms) {
    if (timer || !signedInOwner()) return;
    timer = setTimeout(function () { timer = null; sync.syncAll({ onlyChanged: true }); }, ms);
  }
  Storage.prototype.setItem = function (k) {
    if (this === window.localStorage && typeof k === 'string' && k.indexOf('board-') === 0 && k !== 'board-subject') scheduleSync(20000);
    return origSet.apply(this, arguments);
  };
  document.addEventListener('visibilitychange', function () {
    if (!sync.state.user) return;
    if (document.visibilityState === 'hidden') sync.syncAll({ onlyChanged: true });
    else if (signedInOwner() && Date.now() - sync.state.last > 60000) {
      sync.syncAll({}).then(function (r) { if (r && r.applied && !window.BOARD_ENGINE_ON) location.reload(); });
    }
  });
  window.addEventListener('pagehide', function () { if (signedInOwner()) sync.syncAll({ onlyChanged: true }); });
  window.addEventListener('online', function () { if (signedInOwner()) sync.syncAll({}); });

  ui = createUI({
    sync: sync,
    signIn: async function () { interactiveNext = true; try { await transport.signIn(); } finally { interactiveNext = false; } },
    signOut: function () { return transport.signOut(); },
    syncNow: function () { return sync.syncAll({}); },
    /* 学習中に他端末の更新を取り込むときは、いまの内容を送ってから再読み込みする（起動時の同期で取り込まれる） */
    reloadApply: async function () { await sync.syncAll({ onlyChanged: true }); location.reload(); },
    exportCode: function () { return sync.exportAll(); },
    importCode: function (d) { sync.importAll(d); }
  });

  /* ---- 正答率の集計（ログイン中のみ送信。受信はログイン不要） ---- */
  var qs = createQStats({ ls: window.localStorage, transport: transport });
  var qsTimer = null;
  function qsUid() { var u = sync.state.user; return u ? u.uid : null; }
  function flushStats() { var uid = qsUid(); if (uid) qs.flush(uid); }
  function scheduleStats() {
    if (qsTimer || !qsUid()) return;
    qsTimer = setTimeout(function () { qsTimer = null; flushStats(); }, 15000);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushStats(); });
  window.addEventListener('pagehide', flushStats);
  window.addEventListener('online', flushStats);
  setTimeout(function () { qs.refresh(false); }, 4000);

  transport.init(function (user, interactive) {
    sync.onAuth(user, interactive);
    if (user) setTimeout(function () { qs.flush(user.uid); }, 3000);
  }, takeInteractive);

  /* 以前ログインしていない端末では待たない */
  var remembered = store.getRemembered();
  window.BoardSync = {
    configured: true,
    startup: function () { return remembered ? sync.ready : Promise.resolve(); },
    open: function () { ui.openPanel(); },
    summary: function () { return ui.statusText(); },
    sendInquiry: function (d) { return transport.sendInquiry ? transport.sendInquiry(d) : Promise.reject(new Error('送信できません')); },
    /* 初めて答えた問題の正誤を集計に送る（送信はログイン中のみ・まとめて行う） */
    reportFirst: function (subj, qid, ok) { qs.report(subj, qid, ok); scheduleStats(); },
    /* 回答数が十分な問題の集計 { qid: [回答数, 正答数] } */
    qstats: function (subj) { return qs.get(subj); },
    _sync: sync
  };
})();
