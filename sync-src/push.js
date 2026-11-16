/* リマインド通知（その日まだ問題を解いていないときに、決めた時刻に届くプッシュ通知）の端末側。
   設定はこの端末の localStorage('bpush-v1') に置く（端末ごとの設定なので同期しない） */
var KEY = 'bpush-v1';

/* 端末の「hour時」が協定世界時の何時にあたるか。off は Date#getTimezoneOffset()（日本は -540） */
export function utcHourOf(hour, off) {
  var m = ((hour * 60 + off) % 1440 + 1440) % 1440;
  return Math.floor(m / 60);
}

/* 送信側の判定: いま送るべき宛先なら、その「日付(YYYY-MM-DD・端末の現地時間)」を返す。送らないなら null。
   定期実行は遅れることがあるので、決めた時刻から2時間未満なら送る（sent で二重送信を防ぐ）。
   dayStart は本人の「1日の切り替え時刻」（0〜6。未設定は4） */
export function dueDay(sub, lastActive, nowMs, dayStart) {
  var ds = (typeof dayStart === 'number' && dayStart >= 0 && dayStart <= 6) ? Math.floor(dayStart) : 4;
  if (!sub || typeof sub.hour !== 'number' || typeof sub.tz !== 'number') return null;
  var local = nowMs - sub.tz * 60000;
  var diff = (new Date(local).getUTCHours() - sub.hour + 24) % 24;
  if (diff > 1) return null;
  /* 1日の切り替え時刻(dayStart)より前の深夜は、前日として数える（アプリの todayKey と同じ数え方） */
  var day = new Date(local - diff * 3600000 - ds * 3600000).toISOString().slice(0, 10);
  if (sub.sent === day || lastActive === day) return null;
  return day;
}

export function createPush(opts) {
  var ls = opts.ls, t = opts.transport, getUid = opts.getUid;
  var tzOff = opts.tzOffset || function () { return new Date().getTimezoneOffset(); };
  var supported = null;

  function read() {
    var d = null;
    try { d = JSON.parse(ls.getItem(KEY)); } catch (e) { /* noop */ }
    if (!d || typeof d !== 'object') d = {};
    if (!d.dev) { d.dev = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); write(d); }
    if (typeof d.hour !== 'number') d.hour = 20;
    return d;
  }
  function write(d) { try { ls.setItem(KEY, JSON.stringify(d)); } catch (e) { /* noop */ } }
  function configured() { return !!(t.pushConfigured && t.pushConfigured()); }

  async function register(d, uid) {
    var token = await t.pushToken();
    if (!token) throw new Error('通知の宛先を取得できませんでした');
    var off = tzOff(), rec = { token: token, hour: d.hour, utcHour: utcHourOf(d.hour, off), tz: off };
    await t.pushSave(uid, d.dev, rec);
    d.on = true; d.uid = uid; d.token = token; d.utcHour = rec.utcHour; d.tz = off; d.at = Date.now();
    write(d);
  }

  return {
    check: function () {
      if (!configured()) { supported = false; return Promise.resolve(false); }
      return t.pushSupported().then(function (v) { supported = !!v; return supported; });
    },
    state: function () {
      var d = read(), uid = getUid();
      var perm = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
      return { configured: configured(), supported: supported, signedIn: !!uid, perm: perm,
        on: !!(d.on && uid && d.uid === uid && perm === 'granted'), hour: d.hour };
    },
    enable: async function (hour) {
      var uid = getUid();
      if (!uid) throw new Error('ログインが必要です');
      var d = read();
      if (typeof hour === 'number') d.hour = hour;
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(perm === 'denied'
        ? '通知が許可されていません。ブラウザ（または端末）の設定で、このアプリの通知を許可してください'
        : '通知が許可されませんでした');
      await register(d, uid);
    },
    setHour: async function (hour) {
      var d = read(), uid = getUid();
      d.hour = hour; write(d);
      if (d.on && uid && d.uid === uid) await register(d, uid);
    },
    disable: async function () {
      var d = read(), uid = getUid();
      d.on = false; write(d);
      if (uid && d.uid === uid) { try { await t.pushRemove(uid, d.dev); } catch (e) { /* 次回の送信時に無効な宛先として消える */ } }
      await t.pushDropToken();
      d.token = ''; write(d);
    },
    /* 起動時: 宛先の更新・時差の変化（旅行・夏時間）を反映する。変化がなければ7日に1回だけ書く */
    refresh: async function () {
      var d = read(), uid = getUid();
      if (!d.on || !uid || d.uid !== uid || supported !== true) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      var token = await t.pushToken(), off = tzOff();
      if (token === d.token && off === d.tz && Date.now() - (d.at || 0) < 7 * 86400000) return;
      await register(d, uid);
    },
    /* 問題を解いた日を1日1回だけ記録する（通知を使っていない端末で解いた分も数えるため、ログイン中は常に送る） */
    markActive: function (day) {
      var uid = getUid();
      if (!uid || !configured()) return;
      var d = read(), mark = uid + ' ' + day;
      if (d.act === mark) return;
      d.act = mark; write(d);
      t.pushActive(uid, day).catch(function () { var x = read(); if (x.act === mark) { x.act = ''; write(x); } });
    }
  };
}
