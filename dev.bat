@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo  VRC Worlds Manager - 開発モードで起動
echo ==========================================
echo.
echo ※ インストール版が起動していると、同一インスタンス制限で
echo    開発版が立ち上がりません。先に終了してください。
echo.

tasklist /fi "imagename eq vrc-worlds-manager.exe" | find /i "vrc-worlds-manager.exe" >nul
if not errorlevel 1 (
  echo [警告] vrc-worlds-manager.exe が起動中です。終了してから再実行してください。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 依存パッケージをインストールします...
  call npm install
  if errorlevel 1 goto :fail
)

echo 開発モードで起動します。ウィンドウを閉じると終了します。
echo （src/lib/bindings.ts は起動時に自動生成されます）
echo.
call npm run tauri dev
if errorlevel 1 goto :fail
goto :end

:fail
echo.
echo 起動に失敗しました。上のエラーを確認してください。
pause
exit /b 1

:end
pause
