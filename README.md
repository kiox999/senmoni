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

## データを直したとき
```
python3 tools/check_data.py   # 問題データの検査（誤りが0件になるまで直す）
python3 tools/stamp.py        # 版番号を中身から決めて sw.js と index.html に書き込む
```
- プルリクエストごとに GitHub 上で同じ検査が走ります（`.github/workflows/check.yml`）
- 検査の中身：問題番号の重複、選択肢の数、「Nつ選べ」と正解数、選択肢の「のみ」「だけ」、暗記ポイントの体言止め・「→」「＝」の誤用、関連知識と事典の対応 など
- 関連知識は事典本文と同じ文章なので、問題側には項目名（`dd`）だけを置いています。事典にない独自の文章を出したい問題だけ `deepdive` に本文を書きます。`dd` と `deepdive` の両方があるときは、表示は `deepdive`、事典との紐づけは `dd` を使います。`python3 tools/pack_deep.py` で写しを参照に置き換えられます
- 制度やガイドラインに左右される問題は `python3 tools/review_list.py` で一覧にできます。出典に当たって確かめた問題には `chk`（例 `"2026-11"`）を書くと、解説の下に確認時期が出ます
