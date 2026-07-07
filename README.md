# Travel Plan Server - 部署指南 🚀

项目功能：上传和管理 HTML 旅行计划，支持密钥分享、下载、3D 查看器。

---

## 一、部署方案选择

| 方案 | 平台 | 国内访问 | 费用 | 难度 |
|---|---|---|---|---|
| ⭐ **推荐** | **Zeabur** (zeabur.com) | ✅ 极快（国内节点） | 免费起 | ⭐ 简单 |
| 备选 | Railway (railway.app) | ✅ 一般 | 月$5起 | ⭐ 简单 |
| 备选 | 阿里云 ECS | ✅ 极快 | 按量付费 | ⭐⭐⭐ 较高 |

**本指南以 Zeabur 为例** —— 国内访问快、免费额度、一键部署 Node.js。

---

## 二、部署到 Zeabur（10 分钟）

### 第 1 步：准备 GitHub 仓库

```bash
# 1. 打开 https://github.com 登录你的账号
# 2. 点右上角 + → New repository
# 3. 填仓库名: travel-plan-server
# 4. 选 Private (私有仓库) → Create repository
# 5. 在本地打开终端执行以下命令：
```

```bash
cd D:\Ddocument\CodeX\systemBuildTest\travel-plan-server

# 初始化 Git
git init
git add .
git commit -m "first commit"

# 关联远程仓库（替换 YOUR_USERNAME 为你的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/travel-plan-server.git
git branch -M main
git push -u origin main
```

> 💡 不会用 Git? 也可以直接把整个 `travel-plan-server` 文件夹拖到 GitHub 网页上传。

### 第 2 步：在 Zeabur 创建项目

1. 打开 https://zeabur.com 注册账号（支持 GitHub 登录）
2. 点击 **New Project** → **Deploy from GitHub**
3. 授权 Zeabur 访问你的 GitHub
4. 选择 `travel-plan-server` 仓库
5. Zeabur 会自动检测 Node.js → 自动部署

### 第 3 步：配置环境变量和存储

在 Zeabur 项目页面：

**环境变量（自动设置）：**
- `PORT=8080`
- `NODE_ENV=production`

**持久化存储（重要！保存上传文件和数据库）：**
1. Zeabur 项目 → **Settings** → **Volumes**
2. 添加 Volume：
   - Mount Path: `/data`
   - Size: 1GB（免费足够）
3. 保存后 Zeabur 会自动重启

### 第 4 步：部署完成 🎉

部署成功后你会得到域名：
```
https://travel-plan-server.zeabur.app
```

现在从任何地方访问：
```
https://travel-plan-server.zeabur.app/admin
```

默认管理员：`admin` / `admin123`（登录后请立刻改密码）

---

## 三、项目结构说明

```
travel-plan-server/
├── server.js         # 主服务器（Express + 所有 API）
├── db.js             # JSON 文件数据库
├── package.json      # 依赖管理
├── zeabur.json       # Zeabur 部署配置
├── Procfile          # Railway/Render 部署配置
├── .env              # 环境变量
├── data/             # ⭐ 数据库文件（JSON 存储）
│   ├── admins.json
│   ├── plans.json
│   └── login_logs.json
├── uploads/          # ⭐ 上传的 HTML 文件存储
├── public/           # 前端页面
│   ├── index.html    # 管理后台（Vue 2 + Element UI）
│   └── viewer.html   # 计划查看器（3D 效果）
└── README.md         # 本文件
```

### 数据持久化原理

- `data/` 目录 → 存储管理员账号、计划元数据、登录日志
- `uploads/` 目录 → 存储上传的 HTML 文件
- **Zeabur 的 Volume 会确保这些目录在重启后数据不丢失**
- 数据格式是 JSON，人类可读，可手动备份

---

## 四、日常管理

### 管理员操作

1. 访问 `https://你的域名/admin`
2. 登录（默认 admin / admin123）
3. **计划管理** - 上传 HTML、生成密钥、查看/分享/删除
4. **用户管理** - 查看登录历史、修改密码

### 查看器操作

1. 把分享链接发给别人：`https://你的域名/view/1?key=xxxxxxxx`
2. 对方访问后输入密钥 → 3D 星空背景 → 查看计划内容
3. 支持下载 HTML 文件

### 备份数据库

```bash
# 复制 data/ 和 uploads/ 即可备份整个系统
cp -r data/ backups/2024-01-01/
cp -r uploads/ backups/2024-01-01/
```

---

## 五、部署到其他平台

### Railway（全球访问快）

```bash
# 1. 注册 https://railway.app
# 2. New Project → Deploy from GitHub
# 3. 选择仓库
# 4. 添加 Volume: /data
```

### 阿里云 ECS（国内最快、最可控）

适合流量大的场景：

```bash
# 1. 购买 ECS（2核4G，Ubuntu 22.04）
# 2. SSH 连接服务器
ssh root@你的服务器IP

# 3. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 4. 部署代码
git clone https://github.com/YOUR_USERNAME/travel-plan-server.git
cd travel-plan-server
npm install

# 5. 使用 PM2 守护进程
npm install -g pm2
pm2 start server.js --name travel-plan
pm2 save
pm2 startup

# 6. 配置 Nginx 反向代理 + SSL（可选但推荐）
```

---

## 六、常见问题

**Q: 部署后无法访问？**
A: 检查 Zeabur 日志 → 重新部署

**Q: 上传文件后重启丢失了？**
A: 确认 Volume 已正确挂载到 `/data` 目录

**Q: 忘记管理员密码？**
A: 删除 `data/admins.json` 文件，重启服务后会重新创建默认密码

**Q: 域名可以自定义吗？**
A: Zeabur 支持绑定自定义域名（设置里添加）

**Q: 费用多少？**
A: Zeabur 免费额度够用（每月 1000 小时运行时间 + 1GB 存储）
