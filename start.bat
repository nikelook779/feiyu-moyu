@echo off
chcp 65001 >nul
title 肥鱼摸鱼大作战
cd /d "%~dp0"

echo.
echo   ============================================
echo      肥鱼摸鱼大作战  -  正在启动...
echo   ============================================
echo.

REM 找一个可用的 Python
set PY=
where python >nul 2>nul && set PY=python
if not defined PY ( where py >nul 2>nul && set PY=py )
if not defined PY goto :nopy

echo   [1/2] 正在启动本地服务器...
start "" "%PY%" -m http.server 8899 --bind 127.0.0.1
timeout /t 2 /nobreak >nul

echo   [2/2] 打开浏览器...
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8899/index.html

echo.
echo   ------------------------------------------------
echo   游戏已在浏览器打开。
echo   关掉这个黑窗口就会停止服务器。
echo   ------------------------------------------------
echo.
echo   按任意键关闭服务器...
pause >nul

echo   服务器已停止，下次摸鱼见！
timeout /t 1 /nobreak >nul
exit /b 0

:nopy
echo   [!] 没检测到 Python。
echo.
echo   你可以直接双击 index.html 玩 ——
echo   这个游戏是纯前端的，不需要服务器。
echo.
pause
exit /b 0