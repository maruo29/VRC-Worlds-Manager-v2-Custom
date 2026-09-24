@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo  VRC Worlds Manager - インストーラをビルド
echo ==========================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [エラー] npm が見つかりません。Node.js をインストールしてください。
  goto :fail
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [エラー] cargo が見つかりません。Rust をインストールしてください。
  goto :fail
)

if not exist "node_modules" (
  echo [1/2] 依存パッケージをインストールします...
  call npm install
  if errorlevel 1 goto :fail
) else (
  echo [1/2] node_modules は導入済みのためスキップします。
)

echo.
echo [2/2] アプリをビルドします。初回やクリーンビルドでは10分以上かかります...
echo.
call npm run tauri build
if errorlevel 1 goto :fail

set "OUTDIR=%~dp0src-tauri\target\release\bundle\nsis"
echo.
echo ==========================================
echo  ビルド成功
echo ==========================================
echo インストーラの場所: %OUTDIR%
echo.
echo インストールせずに試すだけなら、この exe を直接実行できます:
echo   %~dp0src-tauri\target\release\vrc-worlds-manager.exe
echo.
echo ※ インストールする前に、起動中の VRC Worlds Manager を終了してください。
if exist "%OUTDIR%" start "" explorer "%OUTDIR%"
goto :end

:fail
echo.
echo ==========================================
echo  ビルド失敗
echo ==========================================
echo 上に出ているエラーを確認してください。
pause
exit /b 1

:end
pause
