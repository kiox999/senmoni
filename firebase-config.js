/* Firebaseの設定（公開しても問題ない値です。他人のデータの保護は firestore.rules で行います）。
   手順は docs/SYNC_SETUP.md を参照。空のままだと、同期機能は表示されず従来どおり端末内だけで動きます。 */
window.BOARD_FIREBASE = {
  apiKey: "AIzaSyBhEPdm0_FqmIuZ1QV1En_-uYxWVybhjjs",
  authDomain: "senmoni-board.firebaseapp.com",
  projectId: "senmoni-board",
  appId: "1:940899832203:web:8e88cf5436d2986d0adf8e"
};

/* お問い合わせをメールでも受け取る（Web3Forms のアクセスキー。公開してよい値です）。
   https://web3forms.com で受信したいメールアドレスを入力すると届くキーを貼る。空ならメール送信はしない */
window.BOARD_WEB3FORMS_KEY = "";
