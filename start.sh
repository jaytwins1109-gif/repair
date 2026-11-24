#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=========================================="
echo "  服务器主板维修 Agent - 一键启动"
echo "=========================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装 Node.js 24 或更高版本。"
  echo "       下载地址: https://nodejs.org/"
  exit 1
fi
echo "[OK] Node.js 已安装: $(node --version)"

echo
if [ ! -d "node_modules" ]; then
  echo "[1/3] 首次运行，正在安装依赖，请稍候..."
  npm run setup
else
  echo "[1/3] 依赖已存在，跳过安装。"
fi

echo "[2/3] 启动服务（后端 :3001 + 前端 :5173）..."
echo "      请手动打开 http://localhost:5173"
echo "      按 Ctrl+C 可停止服务。"
echo

echo "[3/3] 运行中，日志如下："
echo "=========================================="
npm run dev
