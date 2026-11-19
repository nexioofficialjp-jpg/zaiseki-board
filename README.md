# 在席ボード

事務所の在席状況を一覧で共有するボード。タップで 在席 → 外出 → 退社 → 休み → 在席 と切り替わる。

- `docs/` … 表示側(GitHub Pages)。`index.html` が一覧ボード、`me.html?t=<トークン>` が本人用ワンタップ画面。
- `Code.js` / `appsscript.json` … データ側(Google Apps Script、スプレッドシートに保存)。JSON API のみ。
- `admin.mjs` … 名簿の追加・変更(管理者のPCでのみ実行。鍵ファイル `secret.js` は公開しない)。
- `手順書.md` … 運用・配備手順。

名簿のデータ(名前・状態)はこのリポジトリには含まれない。
