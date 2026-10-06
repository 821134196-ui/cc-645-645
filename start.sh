#!/usr/bin/env bash
# 一条本地命令启动整个项目：
#   安装依赖 → 生成 Prisma Client → 初始化 SQLite 与种子 → 构建前端 → 启动 NestJS
# 启动后访问 http://localhost:3000
set -e
cd "$(dirname "$0")"

echo "==> [1/5] 检查依赖"
if [ ! -d node_modules ]; then
  npm install
fi

echo "==> [2/5] 生成 Prisma Client 并构建后端"
(cd backend && npx prisma generate && npx nest build)

echo "==> [3/5] 初始化数据库（仅首次）"
if [ ! -f backend/prisma/dev.db ]; then
  (cd backend && npx prisma migrate deploy && npm run seed)
fi

echo "==> [4/5] 构建前端页面"
if [ ! -d frontend/dist ]; then
  npm run build --workspace frontend
fi

echo "==> [5/5] 启动服务（http://localhost:3000，Ctrl+C 退出）"
cd backend
set -a
# shellcheck disable=SC1091
source .env
set +a
node dist/main.js
