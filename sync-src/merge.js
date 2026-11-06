/* 同期データの統合ロジック（純粋関数。ブラウザ・Nodeの両方で動く）
 *
 * 3方向マージ: base（前回同期時の状態）・local（この端末の今）・cloud（クラウドの今）
 *  - 数値カウンタ（XP、解答回数など）… cloud + (local - base)。別々の端末で稼いだ分が合算される
 *  - 集合（購入済みの色・音色など）… 和集合
 *  - マップ（ブックマーク、メモなど）… キーごとに「この端末で変えたか／クラウドで変えたか」で判定
 *  - 単独の設定値… この端末で変えていなければクラウド側、変えていればこの端末側
 */

export var DOC_IDS = ['global', 'naika', 'shouni', 'kyukyu'];

/* 全科目共通（購入物・XP・見た目） */
export var GLOBAL_KEYS = ['theme', 'fontsize', 'fontfamily', 'sound', 'soundVol', 'tutSeen',
  'xp', 'xpTotal', 'owned', 'ownedSkins', 'ownedPacks', 'palette', 'skin', 'pack'];

/* 科目ごと（学習データ） */
export var SUBJECT_KEYS = ['prog', 'hist', 'log', 'marks', 'examLog', 'rank', 'feedback',
  'bmNames', 'dailyGoal', 'spacing'];

export function keysFor(docId) { return docId === 'global' ? GLOBAL_KEYS : SUBJECT_KEYS; }

export function deepEq(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a !== a && b !== b; /* NaN */
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var j = 0; j < ka.length; j++) {
    var k = ka[j];
    if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEq(a[k], b[k])) return false;
  }
  return true;
}

function isNum(x) { return typeof x === 'number' && isFinite(x); }
function num(x) { return isNum(x) ? x : 0; }
function obj(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
function arr(x) { return Array.isArray(x) ? x : []; }
function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

/* 数値カウンタ: クラウドの値に、この端末が前回同期から増減させた分を足す */
function counter3(b, l, c) { return Math.max(0, Math.round(num(c) + (num(l) - num(b)))); }

/* 単独の値 */
function scalar3(b, l, c) {
  if (l === undefined) return c;
  if (c === undefined) return l;
  return deepEq(l, b) ? c : l;
}

/* キーごとのマップ（値は丸ごと比較） */
function map3(b, l, c) {
  b = obj(b); l = obj(l); c = obj(c);
  var out = {}, seen = {};
  [l, c].forEach(function (m) {
    Object.keys(m).forEach(function (k) {
      if (seen[k]) return; seen[k] = 1;
      var bv = b[k], lv = l[k], cv = c[k];
      var v = deepEq(lv, bv) ? cv : (deepEq(cv, bv) ? lv : lv);
      if (v !== undefined) out[k] = clone(v);
    });
  });
  /* 両方に無いが base にだけあるキーは削除済み */
  return out;
}

function union(a, b) {
  var out = [], seen = {};
  arr(a).concat(arr(b)).forEach(function (x) {
    var k = typeof x + ':' + x;
    if (!seen[k]) { seen[k] = 1; out.push(x); }
  });
  return out;
}

/* ---------- 全科目共通 ---------- */
export function mergeGlobal(base, local, cloud) {
  base = obj(base); local = obj(local); cloud = obj(cloud);
  var out = {};
  ['xp', 'xpTotal'].forEach(function (k) {
    if (local[k] === undefined && cloud[k] === undefined) return;
    out[k] = counter3(base[k], local[k], cloud[k]);
  });
  ['owned', 'ownedSkins', 'ownedPacks'].forEach(function (k) {
    if (local[k] === undefined && cloud[k] === undefined) return;
    out[k] = union(local[k], cloud[k]);
  });
  if (local.tutSeen !== undefined || cloud.tutSeen !== undefined) {
    out.tutSeen = (isNum(local.tutSeen) && isNum(cloud.tutSeen))
      ? Math.max(local.tutSeen, cloud.tutSeen) : scalar3(base.tutSeen, local.tutSeen, cloud.tutSeen);
  }
  ['theme', 'fontsize', 'fontfamily', 'sound', 'soundVol', 'palette', 'skin', 'pack'].forEach(function (k) {
    var v = scalar3(base[k], local[k], cloud[k]);
    if (v !== undefined) out[k] = clone(v);
  });
  return out;
}

/* ---------- 科目ごと ---------- */
function mergeProgEntry(b, l, c) {
  b = obj(b); l = obj(l); c = obj(c);
  var out = {};
  ['seen', 'ok', 'ng'].forEach(function (k) { out[k] = counter3(b[k], l[k], c[k]); });
  /* 直近の解答に関する項目は、解答が新しいほうを採用（一式で揃える） */
  var win = num(l.last) >= num(c.last) ? l : c;
  var lose = win === l ? c : l;
  ['due', 'ival', 'last', 'lastOk'].forEach(function (k) {
    if (win[k] !== undefined) out[k] = clone(win[k]);
    else if (lose[k] !== undefined) out[k] = clone(lose[k]);
  });
  var done = { seen: 1, ok: 1, ng: 1, due: 1, ival: 1, last: 1, lastOk: 1 };
  var keys = union(Object.keys(l), Object.keys(c));
  keys.forEach(function (k) {
    if (done[k]) return;
    var v = scalar3(b[k], l[k], c[k]);
    if (v !== undefined) out[k] = clone(v);
  });
  return out;
}

function mergeProg(b, l, c) {
  b = obj(b); l = obj(l); c = obj(c);
  var out = {};
  union(Object.keys(l), Object.keys(c)).forEach(function (id) {
    var bv = b[id], lv = l[id], cv = c[id], v;
    if (lv && cv) v = mergeProgEntry(bv, lv, cv);
    else if (lv) v = (bv && deepEq(lv, bv)) ? undefined : lv;   /* クラウドで消えた＋この端末は未変更 → 削除を反映 */
    else v = (bv && deepEq(cv, bv)) ? undefined : cv;           /* この端末で消した＋クラウドは未変更 → 削除を反映 */
    if (v !== undefined) out[id] = clone(v);
  });
  return out;
}

function mergeHist(b, l, c) {
  b = obj(b); l = obj(l); c = obj(c);
  var out = {};
  union(Object.keys(l), Object.keys(c)).forEach(function (d) {
    var bv = obj(b[d]), lv = obj(l[d]), cv = obj(c[d]);
    var a = counter3(bv.a, lv.a, cv.a), k = counter3(bv.c, lv.c, cv.c);
    if (a > 0 || k > 0) out[d] = { a: a, c: Math.min(k, a) };
  });
  return out;
}

function mergeLog(l, c, limit, keyf) {
  var seen = {}, out = [];
  arr(l).concat(arr(c)).forEach(function (e) {
    if (!e || typeof e !== 'object') return;
    var k = keyf(e);
    if (seen[k]) return; seen[k] = 1; out.push(e);
  });
  out.sort(function (x, y) { return num(y.ts) - num(x.ts); });
  return clone(out.slice(0, limit));
}

function memoKey(m) { return String(m && m.id) + '@' + String(m && m.ts); }
function mergeFeedback(b, l, c) {
  function toMap(a) { var m = {}; arr(a).forEach(function (x) { if (x && typeof x === 'object') m[memoKey(x)] = x; }); return m; }
  var m = map3(toMap(b), toMap(l), toMap(c));
  return Object.keys(m).map(function (k) { return m[k]; }).sort(function (x, y) { return num(x.ts) - num(y.ts); });
}

export function mergeSubject(base, local, cloud) {
  base = obj(base); local = obj(local); cloud = obj(cloud);
  var out = {};
  var has = function (k) { return local[k] !== undefined || cloud[k] !== undefined; };
  if (has('prog')) out.prog = mergeProg(base.prog, local.prog, cloud.prog);
  if (has('hist')) out.hist = mergeHist(base.hist, local.hist, cloud.hist);
  if (has('log')) out.log = mergeLog(local.log, cloud.log, 50, function (e) { return e.id + '@' + e.ts; });
  if (has('examLog')) out.examLog = mergeLog(local.examLog, cloud.examLog, 30, function (e) { return e.rank + '@' + e.ts; });
  if (has('marks')) out.marks = map3(base.marks, local.marks, cloud.marks);
  if (has('bmNames')) out.bmNames = map3(base.bmNames, local.bmNames, cloud.bmNames);
  if (has('feedback')) out.feedback = mergeFeedback(base.feedback, local.feedback, cloud.feedback);
  if (has('rank')) out.rank = Math.max(num(local.rank), num(cloud.rank));
  ['dailyGoal', 'spacing'].forEach(function (k) {
    var v = scalar3(base[k], local[k], cloud[k]);
    if (v !== undefined) out[k] = clone(v);
  });
  return out;
}

export function mergeDoc(docId, base, local, cloud) {
  return docId === 'global' ? mergeGlobal(base, local, cloud) : mergeSubject(base, local, cloud);
}

/* 学習データが実質空か（初回ログイン時の確認ダイアログの要否判断に使う） */
export function isEmptyDoc(docId, d) {
  d = obj(d);
  if (docId === 'global') return !(num(d.xpTotal) > 0 || num(d.xp) > 0 || arr(d.owned).length > 1 || arr(d.ownedSkins).length > 1 || arr(d.ownedPacks).length > 1);
  return !(Object.keys(obj(d.prog)).length || Object.keys(obj(d.hist)).length || arr(d.feedback).length || arr(d.examLog).length || num(d.rank) > 0);
}
