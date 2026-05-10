#!/usr/bin/env bash
# ==========================================
# InkMind 部署脚本（Docker Compose 方案）
# ==========================================
# 用法：bash deploy/deploy.sh
# 在项目根目录下运行
# ==========================================

set -e

DEPLOY_PATH="${DEPLOY_PATH:-/opt/inkmind}"
ENV_FILE="$DEPLOY_PATH/.env"

echo "=========================================="
echo "  InkMind 部署（Docker Compose）"
echo "=========================================="
echo "路径: $DEPLOY_PATH"
echo ""

cd "$DEPLOY_PATH"

# ------------------------------------------
# 1. 检查 .env 文件
# ------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  echo "错误: 未找到 $ENV_FILE"
  echo "请先创建: cp deploy/env.production.template $ENV_FILE"
  exit 1
fi

# ------------------------------------------
# 2. 拉取最新代码
# ------------------------------------------
echo "[1/4] 拉取最新代码..."
git fetch origin main
git reset --hard origin/main

# ------------------------------------------
# 3. 构建镜像
# ------------------------------------------
echo "[2/4] 构建 Docker 镜像..."
docker compose build --no-cache

# ------------------------------------------
# 4. 启动服务
# ------------------------------------------
echo "[3/4] 启动服务..."
docker compose up -d --remove-orphans

# ------------------------------------------
# 5. 健康检查
# ------------------------------------------
echo "[4/4] 健康检查..."
echo -n "等待服务启动"
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1/health >/dev/null 2>&1; then
    echo " OK"
    break
  fi
  echo -n "."
  sleep 3
done

# 清理旧镜像
docker image prune -f

# ------------------------------------------
# 完成
# ------------------------------------------
echo ""
echo "=========================================="
echo "  部署完成！"
echo "=========================================="
echo ""
echo "后端: $(docker compose ps backend --format '{{.Status}}')"
echo "前端: $(docker compose ps frontend --format '{{.Status}}')"
echo ""
echo "访问地址: http://$(hostname -I | awk '{print $1}')"
echo ""
echo "常用命令："
echo "  查看日志:   docker compose logs -f"
echo "  重启服务:   docker compose restart"
echo "  停止服务:   docker compose down"
echo "  查看状态:   docker compose ps"
echo ""
