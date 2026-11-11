/* 問題ごとの正答率の集計（任意参加・匿名集計）。
   - 送信: ログイン中のユーザーが「その問題に初めて答えたとき」の正誤だけを数える（1人1問1回。firestore.rules で強制）
   - 受信: 回答数が MIN_N 以上の問題の集計値を数日に1回取得し、端末に保存する（ログイン不要）
   アプリ本体は window.BoardSync.qstats(subj) で { qid: [回答数, 正答数] } を受け取り、難易度の補正に使う */

export var MIN_N = 30;                 /* この回答数に達した問題だけを補正に使う */
var QUEUE_KEY = 'bstat-queue';         /* board- で始めない（学習データの同期の対象外にする） */
var CACHE_KEY = 'bstat-cache';
var REFRESH_MS = 3 * 24 * 3600 * 1000;
var MAX_QUEUE = 500;
var SUBJECTS = ['naika', 'shouni', 'kyukyu'];

function getJSON(ls, k, dflt) { try { var v = JSON.parse(ls.getItem(k)); return v == null ? dflt : v; } catch (e) { return dflt; } }
function setJSON(ls, k, v) { try { ls.setItem(k, JSON.stringify(v)); } catch (e) { /* 容量超過などは無視 */ } }

export function createQStats(opts) {
  var ls = opts.ls, transport = opts.transport;
  var flushing = false, fetching = false;

  /* 初回回答を送信待ちに積む。未ログインでも積んでおき、ログイン後に送る */
  function report(subj, qid, ok) {
    if (SUBJECTS.indexOf(subj) < 0 || typeof qid !== 'number' || !isFinite(qid)) return;
    var q = getJSON(ls, QUEUE_KEY, []);
    if (!Array.isArray(q)) q = [];
    for (var i = 0; i < q.length; i++) if (q[i][0] === subj && q[i][1] === qid) return;
    q.push([subj, qid, ok ? 1 : 0]);
    if (q.length > MAX_QUEUE) q = q.slice(q.length - MAX_QUEUE);
    setJSON(ls, QUEUE_KEY, q);
  }

  /* 送信待ちを順に送る。重複（同じ人が同じ問題をすでに送信済み）は規則で拒否されるので捨てる */
  async function flush(uid) {
    if (flushing || !uid || !transport.reportStat) return;
    flushing = true;
    try {
      var q = getJSON(ls, QUEUE_KEY, []);
      while (Array.isArray(q) && q.length) {
        var it = q[0];
        try { await transport.reportStat(uid, it[0], it[1], !!it[2]); }
        catch (e) {
          var code = e && e.code;
          if (code !== 'permission-denied' && code !== 'failed-precondition' && code !== 'invalid-argument') break;  /* 通信エラーなどは次回に再試行 */
        }
        q = getJSON(ls, QUEUE_KEY, []);
        if (Array.isArray(q) && q.length && q[0][0] === it[0] && q[0][1] === it[1]) q.shift();
        setJSON(ls, QUEUE_KEY, q);
      }
    } finally { flushing = false; }
  }

  async function refresh(force) {
    if (fetching || !transport.fetchStats) return;
    var c = getJSON(ls, CACHE_KEY, null);
    if (!force && c && c.ts && Date.now() - c.ts < REFRESH_MS) return;
    fetching = true;
    try {
      var rows = await transport.fetchStats(MIN_N);
      var data = {};
      rows.forEach(function (r) {
        if (SUBJECTS.indexOf(r.subj) < 0) return;
        (data[r.subj] = data[r.subj] || {})[r.qid] = [r.n, r.c];
      });
      setJSON(ls, CACHE_KEY, { ts: Date.now(), min: MIN_N, data: data });
    } catch (e) { /* 取得できなければ前回の値を使い続ける */ }
    finally { fetching = false; }
  }

  function get(subj) {
    var c = getJSON(ls, CACHE_KEY, null);
    return (c && c.data && c.data[subj]) || {};
  }

  return { report: report, flush: flush, refresh: refresh, get: get };
}
