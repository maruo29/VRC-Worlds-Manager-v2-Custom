# VRC Worlds Manager v2 (カスタムフォーク版)

> [!IMPORTANT]
> **これはフォーク版です** - [Raifa21/VRC-Worlds-Manager-v2](https://github.com/Raifa21/VRC-Worlds-Manager-v2) に機能を追加した改造版です。
> 
> 変更点の一覧は [CHANGELOG_CUSTOM.md](./CHANGELOG_CUSTOM.md) をご覧ください。

[English README is here / 英語のREADMEはこちら。](./README.md)

---

## カスタム機能（フォーク版で追加）

このフォーク版では以下の機能が追加されています：

- ⭐ **お気に入りボタン** - ワールドカードにお気に入りボタン（★）を追加
- 📏 **ウィンドウサイズの記憶** - 次回起動時にウィンドウサイズと位置を復元
- 🎯 **デフォルトインスタンスタイプ** - 設定からデフォルトのインスタンスタイプを変更可能
- 🔀 **フォルダのドラッグ＆ドロップ** - フォルダをドラッグで並び替え
- 📤 **ネイティブエクスポート** - 本家VRC Worlds Manager v2互換形式でのデータエクスポート
- ✨ **カスタムブランディング** - Aboutページの更新と独自ブランディング
- 📝 **ログ機能の強化** - デバッグ用のログ出力を追加

---

## オリジナルの機能

VRC Worlds Managerは、好きなワールドを簡単に整理・保存するためのVRChat向けツールです

---

- お気に入りワールドの追加
  - APIを使用して、VRChatのFavouriteに入っているワールドを自動的に取得し、アプリ内に保存します。  
  - 保存後、VRChatのFavouriteから削除してもアプリ側には残ります。  
  - ワールドのURLリンクを直接追加することもできます。  

- ワールドのフォルダわけ
  - 保存されたワールドを、フォルダ分けできます。  
  - 同じワールドを複数のフォルダに振り分けることも可能です。  

- ワールドの詳細を確認
  - アプリ内からワールドの詳細を確認することができます。  
  - ワールドにメモをつけることもできます。  

- 検索機能
  - アプリ内に保存したワールドに対して、検索をかけることができます。  
  - ワールド作者、タグ、フォルダの検索に対応しています。  

- ワールドを見つける
  - 最近訪れたワールドを取得できます。  
  - タグ、テキスト、除外タグ等でワールドを検索できます。  

- インスタンスを建てる
  - アプリ内からインスタンスを生成できます。もちろんグループインスタンスも生成できます。  
  - インスタンスを生成すると、VRChat公式サイトと同様に、そのインスタンスへのインバイトが届きます。  

- フォルダを共有
  - フォルダを共有し、30日間有効なUUIDを生成できます。  
  - ウェブ上でフォルダを確認することもできます。

---

## スクリーンショット

![image](https://github.com/user-attachments/assets/0c66ccd5-13df-4064-8d08-b91256fc01dc)

![image](https://github.com/user-attachments/assets/d7c7ff13-556e-4118-aefc-c2c3de2e661e)

![image](https://github.com/user-attachments/assets/8ff776d4-3391-48d4-af9d-271db8f9ba94)

![image](https://github.com/user-attachments/assets/6b1fde21-ba5d-4293-b418-7b401687e92e)

![image](https://github.com/user-attachments/assets/bb141a65-dca4-43cb-b1b6-2516e4d66b15)

![image](https://github.com/user-attachments/assets/31b36ff0-5032-47d9-981e-02e482942a67)




---

## Chrome拡張機能

より便利な連携のために、Chrome拡張機能が含まれています。

### 機能
- **コンテキストメニュー検索**: ブラウザで選択したテキストを右クリックし、VRC Worlds Managerで直接検索できます。
- **ディープリンクサポート**: VRChatとの連携を強化します。

### インストール方法
1. Chromeで `chrome://extensions/` を開きます。
2. 右上の「デベロッパーモード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」をクリックし、このリポジトリ内の `browser-extension` フォルダを選択します。

---

## インストール

このリポジトリのリリース (Releases) ページから最新バージョンをダウンロードし、`.exe`ファイルを実行してください。  
追加のセットアップは不要です。

---

## ビルド・リリース

本プロジェクトは [Tauri](https://tauri.app/) と [Next.js](https://nextjs.org/) を使用しています。  
ソースからビルドする場合は、リポジトリをクローンし、[Tauri ドキュメント](https://tauri.app/v1/guides/getting-started/prerequisites/) および [Next.js ドキュメント](https://nextjs.org/docs) の手順に従ってください。

---


## コントリビュート

貢献は大歓迎です！  
ガイドラインは [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。


---

## ライセンス

本プロジェクトはMITライセンスです。詳細は [LICENCE](LICENCE) ファイルをご覧ください。

一部のコンポーネントは [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) ライセンスで提供されており、非営利目的でのみ使用できます。詳細は [LICENSE_ADDITIONAL](LICENSE_ADDITIONAL) ファイルをご覧ください。

---

## クレジット

- VRChatおよびVRChat APIコミュニティの皆様、APIドキュメントの提供に感謝します。  
- サイドバーアイコンは黒音キト様よりCC-BY-NC-4.0ライセンスで提供されています。  
- アプリケーションアイコンはCiel-chanを使用、ArmoireLepus様の許可を得ています。  
