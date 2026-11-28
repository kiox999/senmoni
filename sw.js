/* オフライン用キャッシュ。ビルドごとに CACHE 名が変わり、古いキャッシュは削除される */
var CACHE = 'board-2108e0d67515';
var FILES = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192-v2.png', 'icons/icon-512-v2.png',
             'icons/icon-maskable-512-v2.png', 'icons/apple-touch-icon-v2.png', 'icons/badge-96.png',
             'data/naika.js', 'data/shouni.js', 'data/kyukyu.js', 'data/ref.js', 'firebase-config.js', 'sync.bundle.js'];
self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(FILES); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('board-') === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if(url.origin !== location.origin) return;
  /* ページ本体は通信できれば最新を取り、だめならキャッシュ。問題データはキャッシュ優先 */
  if(e.request.mode === 'navigate'){
    e.respondWith(fetch(e.request).then(function(r){
      var copy = r.clone(); caches.open(CACHE).then(function(c){ c.put('index.html', copy); }); return r;
    }).catch(function(){ return caches.match('index.html'); }));
    return;
  }
  /* 設定ファイルは小さいので通信できれば最新を使う（キーの変更をすぐ反映するため） */
  if(/firebase-config\.js$/.test(url.pathname)){
    e.respondWith(fetch(e.request).then(function(r){
      var copy = r.clone(); caches.open(CACHE).then(function(c){ c.put('firebase-config.js', copy); }); return r;
    }).catch(function(){ return caches.match('firebase-config.js', {ignoreSearch:true}); }));
    return;
  }
  e.respondWith(caches.match(e.request, {ignoreSearch:true}).then(function(hit){
    return hit || fetch(e.request);
  }));
});

/* リマインド通知。送信側(tools/send_push.mjs)は data だけを送るので、ここで表示する */
self.addEventListener('push', function(e){
  var p = {};
  try{ p = e.data ? e.data.json() : {}; }catch(er){}
  var d = p.data || p.notification || {};
  e.waitUntil(self.registration.showNotification(d.title || '専門医試験 演習', {
    body: d.body || '今日はまだ問題を解いていません。',
    icon: 'icons/icon-192-v2.png', badge: 'icons/badge-96.png', tag: 'board-remind', renotify: true, data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){ if(list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
