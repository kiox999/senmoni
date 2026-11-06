# 専門医試験 演習

内科・小児科・救急科の専門医試験演習を1つにまとめたWebアプリ（PWA）です。

- スマホで開いて「ホーム画面に追加」するとアプリとして使えます（初回表示後はオフラインでも動作）
- 学習データ（成績・段位・復習予定）は科目ごとに端末内に保存されます。Googleログインによる端末間の引き継ぎ（任意）は [docs/SYNC_SETUP.md](docs/SYNC_SETUP.md) を参照
- 学習目的の教材です。実際の診療判断には用いないでください

## ファイル構成
- `index.html` … アプリ本体（科目選択＋演習エンジン）
- `data/naika.js` `data/shouni.js` `data/kyukyu.js` … 各科目の問題データ
- `sw.js` `manifest.webmanifest` `icons/` … ホーム画面追加・オフライン用
- `sync-src/` `sync.bundle.js` `firebase-config.js` `firestore.rules` … クラウド同期（任意）
