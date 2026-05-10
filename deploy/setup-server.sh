#!/usr/bin/env bash
# ==========================================
# InkMind 阿里云服务器初始化脚本（CentOS / RHEL / AlmaLinux）
# 使用 yum 包管理器，安装 Docker 环境
# ==========================================
# 用法：sudo bash deploy/setup-server.sh
# ==========================================

set -e

DEPLOY_PATH="${DEPLOY_PATH:-/opt/inkmind}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"

echo "=========================================="
echo "  InkMind 服务器初始化（Docker 方案）"
echo "=========================================="
echo "部署路径: $DEPLOY_PATH"
echo ""

# ------------------------------------------
# 1. 系统更新 & 基础工具
# ------------------------------------------
echo "[1/5] 更新系统 & 安装基础工具..."
yum update -y
yum install -y git curl wget yum-utils

# ------------------------------------------
# 2. 安装 Docker（使用阿里云镜像源）
# ------------------------------------------
echo "[2/5] 安装 Docker..."

if ! command -v docker &>/dev/null; then
  rm -f /etc/yum.repos.d/docker-ce*.repo

  cat > /etc/yum.repos.d/docker-ce.repo << 'REPOEOF'
[docker-ce-stable]
name=Docker CE Stable - $basearch
baseurl=https://mirrors.aliyun.com/docker-ce/linux/centos/$releasever/$basearch/stable
enabled=1
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/docker-ce/linux/centos/gpg

[docker-ce-stable-debuginfo]
name=Docker CE Stable - Debuginfo $basearch
baseurl=https://mirrors.aliyun.com/docker-ce/linux/centos/$releasever/debug-$basearch/stable
enabled=0
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/docker-ce/linux/centos/gpg

[docker-ce-stable-source]
name=Docker CE Stable - Sources
baseurl=https://mirrors.aliyun.com/docker-ce/linux/centos/$releasever/source/stable
enabled=0
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/docker-ce/linux/centos/gpg
REPOEOF

  yum makecache fast 2>/dev/null || yum makecache
  yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  systemctl start docker
fi

docker --version
docker compose version

# ------------------------------------------
# 3. 配置 Docker 镜像加速（阿里云）
# ------------------------------------------
echo "[3/5] 配置 Docker 镜像加速..."

mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl daemon-reload
systemctl restart docker

# ------------------------------------------
# 4. 准备部署目录
# ------------------------------------------
echo "[4/5] 准备部署目录..."

mkdir -p "$DEPLOY_PATH"

if [ ! -d "$DEPLOY_PATH/.git" ]; then
  echo "请手动将项目代码部署到 $DEPLOY_PATH"
  echo "例如: git clone https://github.com/<your-repo>/InkMind.git $DEPLOY_PATH"
fi

# ------------------------------------------
# 5. 创建 .env 配置
# ------------------------------------------
echo "[5/5] 创建环境配置..."

if [ ! -f "$DEPLOY_PATH/.env" ]; then
  cp "$DEPLOY_PATH/deploy/env.production.template" "$DEPLOY_PATH/.env"
  echo "已创建 $DEPLOY_PATH/.env，请编辑填入实际配置"
fi

# ------------------------------------------
# 完成
# ------------------------------------------
echo ""
echo "=========================================="
echo "  服务器初始化完成！"
echo "=========================================="
echo ""
echo "后续步骤："
echo "  1. 编辑 .env 配置："
echo "     vim $DEPLOY_PATH/.env"
echo ""
echo "  2. 本地构建并启动（首次或测试）："
echo "     cd $DEPLOY_PATH && docker compose up -d --build"
echo ""
echo "  3. 或从镜像仓库拉取部署："
echo "     cd $DEPLOY_PATH && docker compose pull && docker compose up -d"
echo ""
echo "  4. 配置 GitHub Actions 自动部署（添加 Secrets 后 push 到 main 分支即可）"
echo ""
echo "常用命令："
echo "  查看日志:   docker compose logs -f"
echo "  重启服务:   docker compose restart"
echo "  停止服务:   docker compose down"
echo "  查看状态:   docker compose ps"
echo ""
