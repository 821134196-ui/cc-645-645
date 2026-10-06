#!/usr/bin/env bash
# 一条命令启动企业培训录播授权系统（后端 NestJS + 前端 React + SQLite）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> [1/4] 检查 Node 环境"
node -v || { echo "请先安装 Node.js 18+"; exit 1; }

echo "==> [2/4] 准备后端（NestJS + Prisma + SQLite）"
cd "$ROOT/backend"
[ -f .env ] || cp .env.example .env
[ -d node_modules ] || npm install --no-audit --no-fund
# 首次运行：迁移建库 + 写入演示数据（已存在数据时种子自动跳过）
npx prisma migrate deploy
npm run prisma:seed

echo "==> [3/4] 准备前端（React + Vite）"
cd "$ROOT/frontend"
[ -d node_modules ] || npm install --no-audit --no-fund

echo "==> [4/4] 启动服务"
cd "$ROOT/backend"
npx nest start &
BACK_PID=$!
cd "$ROOT/frontend"
npx vite --host &
FRONT_PID=$!

trap 'echo; echo "正在停止服务…"; kill $BACK_PID $FRONT_PID 2>/dev/null || true' INT TERM EXIT

echo
echo "============================================================"
echo " 前端页面:  http://localhost:5173"
echo " 后端接口:  http://localhost:3001/api"
echo " 演示账号:  admin(管理员) / alice 研发部 / bob 销售部 / carol 人事部"
echo "           密码统一为 123456"
echo " 端到端验证: 另开终端执行  npm run e2e"
echo "============================================================"
echo "按 Ctrl+C 停止全部服务"
wait
