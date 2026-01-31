# VRC Worlds Manager v2 - 改造版変更履歴

このドキュメントは、オリジナル版からの変更点を記載しています。

## 概要

このリポジトリは [Raifa21/VRC-Worlds-Manager-v2](https://github.com/Raifa21/VRC-Worlds-Manager-v2) のフォークです。
非営利目的での配布を目的として、いくつかの機能追加とUIの改善を行いました。

---

## 追加機能一覧

### 1. デフォルトインスタンスタイプ設定
**追加日**: 2026-01-30

ワールド詳細を開いた時に自動選択されるインスタンスタイプをデフォルト設定できるようになりました。

**変更ファイル**:
- `src-tauri/src/definitions/entities.rs` - `DefaultInstanceType` enum追加
- `src-tauri/src/commands/preferences_commands.rs` - get/set コマンド追加
- `src/app/listview/settings/page.tsx` - 設定UI追加
- `src/app/listview/settings/hook.tsx` - 設定ロジック追加
- `src/app/listview/components/popups/world-details/index.tsx` - デフォルト値適用

---

### 2. フォルダのドラッグ＆ドロップ並び替え
**追加日**: 2026-01-30

フォルダ一覧画面でフォルダをドラッグ＆ドロップして順番を変更できるようになりました。

**変更ファイル**:
- `src/app/listview/folders/special/folder-view/page.tsx` - DnD実装
- `@hello-pangea/dnd` ライブラリ使用

---

### 3. お気に入り（★）ボタン
**追加日**: 2026-01-31

ワールドカードに★お気に入りボタンを追加しました。撮影済み・共有済みと同様のフィルタリングが可能です。

**変更ファイル**:
- `src-tauri/src/definitions/entities.rs` - `is_favorite` フィールド追加
- `src-tauri/src/services/folder_manager.rs` - `set_world_favorite` 関数追加
- `src-tauri/src/commands/world_status_commands.rs` - コマンド追加
- `src/components/world-card.tsx` - ★ボタンUI追加
- `src/app/listview/components/world-grid/hook.tsx` - ハンドラ追加
- `src/app/listview/hook/use-filters.tsx` - お気に入りフィルタ追加
- `src/app/listview/components/searchbar.tsx` - フィルタUI追加
- `locales/en-US.json`, `locales/ja-JP.json` - ローカライズ追加

---

### 4. ウィンドウサイズの記憶
**追加日**: 2026-01-31

アプリのウィンドウサイズと位置を次回起動時に復元するようになりました。

**変更ファイル**:
- `src-tauri/Cargo.toml` - `tauri-plugin-window-state` 追加
- `src-tauri/src/lib.rs` - プラグイン初期化

---

### 5. フォルダトグル操作のログ追加
**追加日**: 2026-01-31

デバッグ用にワールド詳細画面のフォルダトグル操作のログを追加しました。

**変更ファイル**:
- `src/app/listview/components/popups/world-details/index.tsx` - ログ追加

---

## ビルド方法

```bash
# 依存関係のインストール
npm install

# 開発モードで起動
npm run tauri dev

# プロダクションビルド
npm run tauri build
```

---

## ライセンス

このプロジェクトはオリジナルと同様に **MIT License** の下で配布されます。

一部アイコン（Launchpad Iconsなど）は **CC-BY-NC 4.0** ライセンスに従います。
詳細は `LICENSE_ADDITIONAL` を参照してください。

---

## クレジット

- **Original Project**: [Raifa21/VRC-Worlds-Manager-v2](https://github.com/Raifa21/VRC-Worlds-Manager-v2)
- **Original Authors**: Raifa, siloneco

---

## 免責事項

このソフトウェアは非営利目的で配布されています。
VRChat Inc.とは無関係であり、VRChatの公式製品ではありません。
