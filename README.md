# レシートスキャナー

スマホでレシートを撮影し、OCRで読み取った内容をGoogleスプレッドシートに自動記録するWebアプリです。

## 機能

- 📷 カメラで直接撮影 / ギャラリーから選択
- 🤖 AI（Gemini）によるレシートのOCR読み取り
- ✏️ 読み取り内容の確認・修正
- 📊 Googleスプレッドシートへ自動転記（日付・店舗名・合計金額）

---

## セットアップ手順

### 1. Gemini API キーを取得

1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセス
2. 「APIキーを作成」をクリック
3. 表示されたAPIキーをコピーして保管

### 2. Google Apps Script をデプロイ

1. [Google Apps Script](https://script.google.com) を開く
2. 「新しいプロジェクト」を作成
3. `gas/Code.gs` の内容をすべてコピー＆ペースト
4. **スクリプトプロパティにAPIキーを設定**
   - 「プロジェクトの設定」→「スクリプトプロパティ」
   - 「プロパティを追加」
     - プロパティ: `GEMINI_API_KEY`
     - 値: 手順1で取得したキー
5. **ウェブアプリとしてデプロイ**
   - 「デプロイ」→「新しいデプロイ」
   - 種類: **ウェブアプリ**
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
   - 「デプロイ」をクリック
6. 表示された **ウェブアプリのURL** をコピー（`https://script.google.com/macros/s/.../exec` の形式）

### 3. アプリの設定

1. アプリを開き、右上の ⚙️ をタップ
2. 以下を入力して「設定を保存」
   - **GAS エンドポイント URL**: 手順2-6でコピーしたURL
   - **スプレッドシート URL**: 転記先のGoogleスプレッドシートのURL

---

## 使い方

1. トップ画面の「レシートを撮影する」をタップ
2. レシートをカメラで撮影
3. AIが自動で内容を読み取り（数秒かかります）
4. 内容を確認・必要であれば修正
5. 「スプレッドシートに記録」をタップ → 完了！

---

## スプレッドシートの列構成

| A列 | B列 | C列 |
|-----|-----|-----|
| 日付 | 店舗名 | 合計金額（数値） |

---

## GitHub Pages での公開

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/receipt-scanner.git
git push -u origin main
```

その後、GitHubリポジトリの **Settings → Pages → Source: main branch** を選択すると、`https://YOUR_USERNAME.github.io/receipt-scanner/` で公開されます。

---

## 注意事項

- GAS URLとスプレッドシートURLはブラウザの `localStorage` に保存されます（端末外には送信されません）
- Gemini APIの無料枠: 1分15リクエスト、1日100万トークン（個人利用では十分）
- スプレッドシートは「リンクを知っている人が編集可」にする必要はありません。GASがオーナーとして書き込みます
