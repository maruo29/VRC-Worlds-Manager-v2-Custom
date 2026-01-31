# 自動アップデート機能の設定ガイド

本家バージョンではなく、あなたのリポジトリ (`maruo29/VRC-Worlds-Manager-v2-Custom`) から自動アップデートを配信するための設定手順です。

**(重要)** 先ほどのトラブルで `tauri.conf.json` が壊れていたため、修理しました。このガイドの手順で進めてください。

## よくある質問
- **Q. TAURI_PRIVATE_KEY はどこにありますか？**
  - A. 以下の「1. 署名鍵の生成」を行うと作成されます。作成先のパス（場所）が画面に表示されるので、そこを確認します。
- **Q. ENCRYPTION_KEY / ENCRYPTION_IV は記憶しておく必要はありますか？**
  - A. GitHubに一度設定してしまえば、基本的には忘れても動作には問題ありません。ただし、将来同じキーを使いたくなった時のためにメモしておくと安心です。

## 1. 署名鍵の生成

余計なオプションを付けず、シンプルに実行します。
ターミナル（PowerShell）で以下のコマンドを実行してください：

```powershell
npm run tauri signer generate
```

1. パスワードの入力を求められるので、入力してEnterを押します（画面には何も表示されませんが入力されています）。確認用にもう一度入力します。
2. 成功すると、画面に以下のようなメッセージが表示されます：
   `Your secret key was generated successfully - C:\Users\ユーザー名\.tauri\vrc-worlds-manager.key`
   `Your public key was generated successfully - C:\Users\ユーザー名\.tauri\vrc-worlds-manager.pub`

**この「ファイルの場所」をコピーしておいてください。**

## 2. GitHub Secrets の設定

GitHubリポジトリのページに行き、以下の4つの環境変数を設定します。
（Settings -> Secrets and variables -> Actions -> New repository secret）

| Name | Value (設定する値) |
| :--- | :--- |
| **`TAURI_PRIVATE_KEY`** | 手順1で作られた **秘密鍵ファイル（.key）** をメモ帳で開き、中身を**すべて**コピペします。<br>※ ファイルはエクスプローラーのアドレスバーにパスを貼り付けると開けます。 |
| **`TAURI_PRIVATE_KEY_PASSWORD`** | さっき設定したパスワード。 |
| **`ENCRYPTION_KEY`** | 適当なランダム文字列（例: `mysecretkey32char...`）。 |
| **`ENCRYPTION_IV`** | 適当なランダム文字列。 |

## 3. アップデート配信URLの設定

`src-tauri/tauri.conf.json` を開き、以下の2箇所を手動で書き換えてください。

1. `endpoints`: 既に設定済みのはずですが、確認してください。
2. `pubkey`: 手順1で作られた **公開鍵ファイル（.pub）** をメモ帳で開き、その中身を貼ります。

```json
    "updater": {
      "endpoints": [
        "https://github.com/maruo29/VRC-Worlds-Manager-v2-Custom/releases/latest/download/latest.json"
      ],
      "pubkey": "ここに .pub ファイルの中身を貼り付け"
    },
```

## 4. 変更の反映

最後に、鍵の設定を含んだ設定ファイルをGitHubに送ります。

```powershell
git add .
git commit -m "Configure updater keys"
git push
```
