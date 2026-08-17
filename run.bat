@echo off
chcp 65001 > NUL
echo ========================================================
echo   🏐 排球員身分證生成器 - 地端一鍵啟動
echo   卡片規格: 79.7 mm x 48 mm (300 DPI 超高畫質)
echo ========================================================
echo.

SET PY_CMD=python

:: 檢查 python 命令
%PY_CMD% --version >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Users\Tequila\anaconda3\python.exe" (
        SET PY_CMD="C:\Users\Tequila\anaconda3\python.exe"
    ) else if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
        SET PY_CMD="%LocalAppData%\Programs\Python\Python311\python.exe"
    ) else (
        echo [錯誤] 找不到可用的 Python 環境！請確認已安裝 Python 並將其加入 PATH。
        pause
        exit /b
    )
)

echo [1/2] 正在檢查並安裝依賴套件 (requirements.txt)...
%PY_CMD% -m pip install -r requirements.txt

echo.
echo [2/2] 啟動地端網頁服務中...
%PY_CMD% app.py

pause
