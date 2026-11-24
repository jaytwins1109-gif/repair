@echo off
chcp 65001 >nul
title 服务器主板维修 Agent - 一键启动
cd /d "%~dp0"

echo ==========================================
echo   服务器主板维修 Agent - 一键启动
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 24 或更高版本。
  echo        下载地址: https://nodejs.org/
  pause
  exit /b 1
)
echo [OK] Node.js 已安装: 
node --version

echo.
if not exist "node_modules" (
  echo [1/3] 首次运行，正在安装依赖，请稍候...
  call npm run setup
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
) else (
  echo [1/3] 依赖已存在，跳过安装。
)

echo [2/3] 启动服务（后端 :3001 + 前端 :5173）...
start "" http://localhost:5173
echo       浏览器即将打开 http://localhost:5173
echo       按 Ctrl+C 或关闭本窗口可停止服务。
echo.

echo [3/3] 运行中，日志如下：
echo ==========================================
call npm run dev
pause
