/* 端末内(localStorage)の読み書き。アプリ本体の保存形式 board-<科目>-v1 / board-global-v1 をそのまま読み書きする */
import { DOC_IDS, GLOBAL_KEYS, SUBJECT_KEYS, keysFor, isEmptyDoc } from './merge.js';

var GLOBAL_KEY = 'board-global-v1';
function dataKey(docId) { return docId === 'global' ? GLOBAL_KEY : 'board-' + docId + '-v1'; }

export function createStore(ls, rawSet) {
  rawSet = rawSet || function (k, v) { ls.setItem(k, v); };
  function getJSON(k) { try { var v = JSON.parse(ls.getItem(k)); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
  function getStr(k) { try { return ls.getItem(k) || ''; } catch (e) { return ''; } }
  function setStr(k, v) { try { rawSet(k, v); } catch (e) { /* 容量超過などは無視（同期は次回に再試行） */ } }

  function read(docId) {
    var raw = getJSON(dataKey(docId)), out = {};
    if (!raw) return out;
    keysFor(docId).forEach(function (k) { if (raw[k] !== undefined) out[k] = raw[k]; });
    return out;
  }

  /* 科目ファイルにも XP などの写しが入っているため、全科目共通の値を反映して一覧画面の表示を揃える */
  function patchSubjects() {
    var g = getJSON(GLOBAL_KEY) || {};
    DOC_IDS.forEach(function (id) {
      if (id === 'global') return;
      var raw = getJSON(dataKey(id)); if (!raw) return;
      ['xp', 'xpTotal'].forEach(function (k) { if (g[k] !== undefined) raw[k] = g[k]; });
      setStr(dataKey(id), JSON.stringify(raw));
    });
  }

  function write(docId, data) {
    var cur = getJSON(dataKey(docId)) || {};
    keysFor(docId).forEach(function (k) { if (data[k] !== undefined) cur[k] = data[k]; });
    setStr(dataKey(docId), JSON.stringify(cur));
    if (docId === 'global') patchSubjects();
    else {
      var g = getJSON(GLOBAL_KEY) || {};
      var raw = getJSON(dataKey(docId));
      if (raw) { ['xp', 'xpTotal'].forEach(function (k) { if (g[k] !== undefined) raw[k] = g[k]; }); setStr(dataKey(docId), JSON.stringify(raw)); }
    }
  }

  function wipe() {
    DOC_IDS.forEach(function (id) { try { ls.removeItem(dataKey(id)); } catch (e) { /* noop */ } });
  }

  function hasData() {
    return DOC_IDS.some(function (id) { return !isEmptyDoc(id, read(id)); });
  }

  var P = 'bsync-';
  return {
    read: read, write: write, wipe: wipe, hasData: hasData,
    getBase: function (uid, docId) { return getJSON(P + 'base-' + uid + '-' + docId); },
    setBase: function (uid, docId, data) { setStr(P + 'base-' + uid + '-' + docId, JSON.stringify(data)); },
    clearBase: function (uid) { DOC_IDS.forEach(function (id) { try { ls.removeItem(P + 'base-' + uid + '-' + id); } catch (e) { /* noop */ } }); },
    getOwner: function () { return getStr(P + 'owner'); },
    setOwner: function (uid) { setStr(P + 'owner', uid || ''); },
    getRemembered: function () { return getStr(P + 'uid'); },
    setRemembered: function (uid) { if (uid) setStr(P + 'uid', uid); else { try { ls.removeItem(P + 'uid'); } catch (e) { /* noop */ } } },
    getLast: function () { return parseInt(getStr(P + 'last'), 10) || 0; },
    setLast: function (t) { setStr(P + 'last', String(t)); }
  };
}
