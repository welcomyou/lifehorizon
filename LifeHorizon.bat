@echo off
rem ============================================================
rem  LifeHorizon - Dong tien cuoc doi
rem  Nhap dup file nay de khoi dong ung dung (khong can go lenh).
rem  Server chay tai 127.0.0.1 (cong 8300-8310), tu mo trinh duyet.
rem  Dong cua so nay = tat ung dung.
rem ============================================================
title LifeHorizon
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Loi] Chua cai Node.js - tai mien phi tai https://nodejs.org/ roi chay lai file nay.
  echo.
  pause
  exit /b 1
)
node app\server.js --open
pause
