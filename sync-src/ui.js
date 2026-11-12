/* 同期の画面（ハブ画面のボタン、パネル、確認ダイアログ、更新通知バー） */
var CSS = '\
#bsync-btn{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;margin-top:10px;text-align:left}\
#bsync-btn .bs-sub{font:500 11.5px var(--sans);color:var(--soft);display:block;margin-top:2px}\
#bsync-btn .bs-main{font:600 13px var(--sans)}\
#bsync-btn .bs-dot{width:9px;height:9px;border-radius:50%;background:var(--line);flex:none}\
#bsync-btn .bs-dot.ok{background:var(--good)}#bsync-btn .bs-dot.err{background:var(--bad)}#bsync-btn .bs-dot.busy{background:var(--warn)}\
.bs-ov{position:fixed;inset:0;z-index:200;background:rgba(10,14,22,.5);display:flex;align-items:center;justify-content:center;padding:20px}\
.bs-box{width:100%;max-width:400px;max-height:88vh;overflow:auto;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:16px;padding:20px 18px 16px;box-shadow:0 12px 40px rgba(0,0,0,.25);font-family:var(--sans)}\
.bs-box h2{margin:0 0 8px;font:800 17px var(--sans)}\
.bs-box p{margin:0 0 10px;font:400 13px/1.7 var(--sans);color:var(--ink)}\
.bs-box .bs-soft{color:var(--soft);font-size:12px}\
.bs-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}\
.bs-b{font:600 13.5px var(--sans);padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:none;color:var(--ink);cursor:pointer}\
.bs-b.pri{background:var(--accent);color:var(--accentInk);border-color:var(--accent)}\
.bs-b.danger{color:var(--bad)}\
.bs-b[disabled]{opacity:.5}\
.bs-b:focus-visible,.bs-ta:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\
.bs-ta{display:block;width:100%;margin-top:8px;font:400 12px var(--mono);padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);box-sizing:border-box;min-height:90px}\
.bs-box details{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}\
.bs-box summary{font:600 12.5px var(--sans);color:var(--accent);cursor:pointer}\
.bs-err{color:var(--bad);font:500 12px/1.6 var(--sans);margin-top:8px;white-space:pre-wrap}\
#bsync-bar{position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom,0px));z-index:150;max-width:496px;margin:0 auto;background:var(--ink);color:var(--bg);border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:10px;font:500 12.5px/1.5 var(--sans);box-shadow:0 6px 24px rgba(0,0,0,.3)}\
#bsync-bar span{flex:1}\
#bsync-bar button{font:700 12.5px var(--sans);padding:7px 12px;border-radius:9px;border:0;background:var(--accent);color:var(--accentInk);cursor:pointer}\
#bsync-bar button.x{background:none;color:inherit;opacity:.7}';

function el(tag, attrs, html) {
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmtTime(t) {
  if (!t) return '未同期';
  var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; };
  var same = new Date().toDateString() === d.toDateString();
  return (same ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + p(d.getHours()) + ':' + p(d.getMinutes());
}

export function createUI(api) {
  /* api: { sync, signIn, signOut, reloadApply, exportCode, importCode, configured } */
  var sync = api.sync, st = sync.state;
  var overlay = null, btn = null, bar = null;

  function injectCss() { if (document.getElementById('bsync-css')) return; var s = el('style', { id: 'bsync-css' }); s.textContent = CSS; document.head.appendChild(s); }

  function closeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }
  function openOverlay(html) {
    closeOverlay();
    overlay = el('div', { 'class': 'bs-ov', role: 'dialog', 'aria-modal': 'true' });
    var box = el('div', { 'class': 'bs-box' }, html);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay && overlay.dataset.modal !== '1') closeOverlay(); });
    document.body.appendChild(overlay);
    return box;
  }

  /* 確認ダイアログ（アプリ内蔵のconfirm置き換えとは独立。Promiseで結果を返す） */
  function ask(kind, info) {
    return new Promise(function (resolve) {
      var email = esc(info && info.email);
      var title, body, buttons;
      if (kind === 'other-account') {
        title = '別のアカウントでログインします';
        body = '<p>この端末の学習データは、<b>別のアカウント</b>で同期したものです。<br>ログインするアカウント: <b>' + email + '</b></p>'
          + '<p class="bs-soft">「統合する」：この端末のデータを、このアカウントのデータに合算します。<br>「端末のデータを消して復元」：この端末のデータを消して、このアカウントのデータに置き換えます。</p>';
        buttons = [['cancel', 'キャンセル', ''], ['discard', '端末のデータを消して復元', 'danger'], ['merge', '統合する', 'pri']];
      } else {
        title = 'この端末のデータをアカウントに保存します';
        body = '<p>ログインするアカウント: <b>' + email + '</b></p>'
          + '<p>この端末の学習データ・XPを、アカウントに統合します。他の端末ですでにこのアカウントを使っている場合は、XPや解答数が<b>合算</b>されます。</p>';
        buttons = [['cancel', 'キャンセル', ''], ['merge', '統合して続ける', 'pri']];
      }
      var box = openOverlay('<h2>' + title + '</h2>' + body + '<div class="bs-row" style="justify-content:flex-end">'
        + buttons.map(function (b) { return '<button type="button" class="bs-b ' + b[2] + '" data-a="' + b[0] + '">' + b[1] + '</button>'; }).join('') + '</div>');
      overlay.dataset.modal = '1';
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-a]'); if (!b) return;
        closeOverlay(); resolve(b.dataset.a);
      });
    });
  }

  function statusText() {
    if (!st.user) return { main: 'クラウド同期', sub: 'Googleでログインして学習データを引き継ぐ', cls: '' };
    var sub = st.status === 'syncing' ? '同期中…' : st.status === 'error' ? '同期できませんでした（オフラインの可能性があります）' : '同期済み ' + fmtTime(st.last);
    return { main: st.user.email || 'ログイン中', sub: sub, cls: st.status === 'syncing' ? 'busy' : st.status === 'error' ? 'err' : 'ok' };
  }

  function renderBtn() {
    if (!btn) return;
    var t = statusText();
    btn.innerHTML = '<span><span class="bs-main">☁ ' + esc(t.main) + '</span><span class="bs-sub">' + esc(t.sub) + '</span></span><span class="bs-dot ' + t.cls + '"></span>';
  }

  function openPanel() {
    var signedIn = !!st.user;
    var h = '<h2>クラウド同期</h2>';
    if (!signedIn) {
      h += '<p>Googleアカウントでログインすると、XP・解放した配色や音色・成績・復習予定を、スマホやPCなど別の端末でも使えます。</p>'
        + '<p class="bs-soft">ログインしなくても、この端末だけでこれまでどおり使えます。クラウドに保存されるのは学習データだけです。</p>'
        + '<div class="bs-row"><button type="button" class="bs-b pri" data-a="signin">Googleでログイン</button><button type="button" class="bs-b" data-a="close">閉じる</button></div>';
    } else {
      h += '<p>ログイン中: <b>' + esc(st.user.email) + '</b><br><span class="bs-soft" id="bs-stat"></span></p>'
        + '<div class="bs-row"><button type="button" class="bs-b pri" data-a="sync">今すぐ同期</button><button type="button" class="bs-b" data-a="signout">ログアウト</button><button type="button" class="bs-b" data-a="close">閉じる</button></div>'
        + '<p class="bs-soft" style="margin-top:10px">ログアウトしても、この端末のデータは消えません。メモの写真はこの端末にだけ保存され、同期されません。</p>';
    }
    h += '<details><summary>引き継ぎコード（手動バックアップ）</summary>'
      + '<p class="bs-soft" style="margin-top:8px">ログインできないときの予備の方法です。「コードを作る」で表示された文字列を別の端末に貼り付けて「コードから復元」を押すと、<b>その端末のデータはコードの内容に置き換わります</b>。</p>'
      + '<div class="bs-row"><button type="button" class="bs-b" data-a="export">コードを作る</button><button type="button" class="bs-b" data-a="import">コードから復元</button></div>'
      + '<textarea class="bs-ta" id="bs-code" spellcheck="false" placeholder="コードがここに表示されます。復元するときは、ここに貼り付けてください"></textarea></details>'
      + '<div class="bs-err" id="bs-err"></div>';
    var box = openOverlay(h);
    var statEl = box.querySelector('#bs-stat');
    function refresh() { if (statEl) statEl.textContent = statusText().sub; }
    refresh();
    var off = sync.subscribe(function () { if (overlay && overlay.contains(statEl)) refresh(); else off && off(); });
    var errEl = box.querySelector('#bs-err');
    function showErr(m) { errEl.textContent = m || ''; }
    box.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.dataset.a; showErr('');
      try {
        if (a === 'close') closeOverlay();
        else if (a === 'signin') { b.disabled = true; await api.signIn(); if (overlay && overlay.dataset.modal !== '1') closeOverlay(); }
        else if (a === 'signout') { await api.signOut(); if (overlay && overlay.dataset.modal !== '1') closeOverlay(); }
        else if (a === 'sync') {
          b.disabled = true;
          var r = await api.syncNow();
          b.disabled = false;
          if (r && r.error) showErr('同期できませんでした：' + ((r.error && r.error.message) || r.error));
          else if (r && r.applied) location.reload();
          else if (r && r.pending) api.reloadApply();
        }
        else if (a === 'export') {
          var code = JSON.stringify(api.exportCode());
          var ta = box.querySelector('#bs-code'); ta.value = code; ta.focus(); ta.select();
          try { if (navigator.clipboard) await navigator.clipboard.writeText(code); showErr('コピーしました。'); } catch (x) { showErr('上の文字列をすべて選択して、コピーしてください。'); }
        }
        else if (a === 'import') {
          var txt = box.querySelector('#bs-code').value.trim();
          if (!txt) { showErr('コードを貼り付けてください。'); return; }
          var data; try { data = JSON.parse(txt); } catch (x) { showErr('コードを読み取れませんでした。'); return; }
          var ok = await confirmBox('この端末のデータを、コードの内容に置き換えます。よろしいですか？');
          if (!ok) return;
          api.importCode(data); location.reload();
        }
      } catch (err) { b.disabled = false; showErr('処理できませんでした：' + ((err && err.message) || err)); }
    });
  }

  function confirmBox(msg) {
    return new Promise(function (resolve) {
      var prev = overlay;
      var o = el('div', { 'class': 'bs-ov', style: 'z-index:210' });
      o.innerHTML = '<div class="bs-box"><p>' + esc(msg) + '</p><div class="bs-row" style="justify-content:flex-end"><button type="button" class="bs-b" data-a="n">キャンセル</button><button type="button" class="bs-b pri" data-a="y">OK</button></div></div>';
      o.addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (!b) return; o.remove(); resolve(b.dataset.a === 'y'); });
      document.body.appendChild(o);
      void prev;
    });
  }

  function mountButton() {
    var m = document.getElementById('syncMount'); if (!m || btn) return;
    btn = el('button', { type: 'button', 'class': 'hubtool', id: 'bsync-btn' });
    btn.addEventListener('click', openPanel);
    m.appendChild(btn); renderBtn();
  }

  /* 他の端末の更新があるとき、学習中でも邪魔にならない下部バーで知らせる */
  function showBar() {
    if (bar) return;
    bar = el('div', { id: 'bsync-bar' }, '<span>他の端末の学習データが見つかりました。</span><button type="button" data-a="apply">反映する</button><button type="button" class="x" data-a="later">あとで</button>');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'apply') { b.disabled = true; api.reloadApply(); } else { bar.remove(); bar = null; }
    });
    document.body.appendChild(bar);
  }
  function hideBar() { if (bar) { bar.remove(); bar = null; } }

  injectCss();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton); else mountButton();
  sync.subscribe(function () {
    renderBtn(); if (st.pending) showBar(); else hideBar();
    var cs = document.getElementById('csStat'); if (cs) cs.textContent = statusText().sub;   /* 設定タブのカード */
  });

  return { ask: ask, openPanel: openPanel, statusText: statusText };
}
