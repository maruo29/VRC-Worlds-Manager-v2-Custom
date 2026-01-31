# GitHub オープンソース公開ガイド

VRC World Manager V2 - Custom Edition をGitHubで公開するための手順書です。

## 1. 事前準備

以下のファイル整理は完了しています：
- `LICENCE` (MIT) の確認
- `.gitignore` の確認（不要なファイルを除外）
- `README.md` / `README_JP.md` の更新（カスタム機能の記載、リンク修正）
- 一時ファイルの削除 (`build_errors.txt` 等)

## 2. GitHubリポジトリの作成

1. [GitHub](https://github.com/) にログインします。
2. 右上の「+」アイコンをクリックし、「New repository」を選択します。
3. 以下の情報を入力します：
   - **Repository name**: `VRC-Worlds-Manager-v2-Custom` (または任意の名前)
   - **Description**: (任意) `Custom edition of VRC Worlds Manager V2 with additional features.`
   - **Public** を選択します。
   - "Initialize this repository with:" のチェックボックスは**全て外してください**（ローカルに既にコードがあるため）。
4. 「Create repository」をクリックします。

## 3. コードのアップロード

リポジトリ作成後に表示される画面の "...or push an existing repository from the command line" の手順に従います。
以下のコマンドをPowerShell等のターミナルで実行してください（現在のプロジェクトフォルダで）：

```powershell
# Gitリポジトリとして初期化（必須）
git init

# 変更を全てステージング
git add .

# コミット
git commit -m "Initial commit of Custom Edition v1.3.0-2"

# リモートリポジトリを追加（URLは作成したリポジトリのものに置き換えてください）
# 例: git remote add origin https://github.com/YourUsername/VRC-Worlds-Manager-v2-Custom.git
git remote add origin <あなたのリポジトリURL>

# メインブランチをmainに設定（既にmainなら不要ですが念のため）
git branch -M main

# プッシュ
git push -u origin main
```

※ もし `remote origin already exists` と出た場合は、`git remote remove origin` としてから再度追加してください。

## 4. リリースの作成（インストーラの配布）

他のユーザーが簡単にダウンロードできるように、ビルド済みのインストーラを公開します。

1. GitHubリポジトリのページ右側にある "Releases" セクションの "Create a new release" をクリックします。
2. **Choose a tag**: `v1.3.0-2` と入力し、"Create new tag" を選択します。
3. **Release title**: `v1.3.0-2 Custom Edition` などと入力します。
4. **Describe this release**: `CHANGELOG_CUSTOM.md` の内容などを貼り付けると親切です。
   - 特に「本家からの変更点」や「新機能」を強調すると良いでしょう。
5. **Attach binaries by dropping them here...** のエリアに、ビルドしたインストーラをドラッグ＆ドロップします。
   - ファイルパス: `src-tauri/target/release/bundle/nsis/vrc-worlds-manager_1.3.0-2_x64-setup.exe`
   - **Chrome拡張機能**: `browser-extension` フォルダをZip圧縮し、`chrome-extension-v1.3.0-2.zip` などの名前で添付すると、ユーザーが使いやすくなります。
6. 「Publish release」をクリックします。

これで公開完了です！

## 5. 今後の運用

- 機能追加やバグ修正を行ったら、`git add`, `git commit`, `git push` で更新します。
- 新しいバージョンを配布する際は、`tauri.conf.json` と `package.json` のバージョンを上げ、ビルドし、新しいReleaseを作成します。
