# 生产环境部署指南（DEPLOY.md）

> 面向运维 / 网管，按步骤执行即可；不需要懂开发。
> 系统**仅限公司内部局域网使用**，禁止做公网端口映射。

## 0. 先记住一句话

生产模式只需要 **一个端口：3000**。同一个 Node 进程同时提供网页和 API；开发模式的 3001 / 5173 两个端口在生产环境**不需要启动、也不需要放行**。

---

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | **24.x**（本机验证 v24.14.0；最低 20.x）。安装后执行 `node -v`、`npm -v` 能显示版本号即可 |
| npm | 随 Node.js 一起安装，无需单独安装 |
| 操作系统 | Windows 10/11 或 Linux；本文以 Windows 为例，Linux 命令在对应步骤一并给出 |
| 浏览器 | 工位电脑用 Chrome / Edge，分辨率 1080p 及以上（不适配手机） |
| 网络 | 服务器与工位电脑在同一内网、能互相 ping 通 |
| 权限 | 安装 Node、放行防火墙、创建「任务计划程序」需要管理员权限 |
| 磁盘 | 建议预留 2 GB 以上（依赖 + 附件 + 备份） |

如未安装 Node，到 <https://nodejs.org/> 下载 LTS 安装包，一路「下一步」安装完成。

---

## 2. 目录结构

把整个项目复制到部署电脑，例如 `D:\repair\`（下文称 `<项目目录>`）：

```text
D:\repair\                       ← 项目根目录
├─ package.json                  ← 依赖与启动脚本
├─ DEPLOY.md                     ← 本手册
├─ client\
│  ├─ src\                       ← 前端源码（排障/重新构建用）
│  └─ dist\                      ← 【生产前端产物】构建后必须有 index.html
│     ├─ index.html
│     └─ assets\  (带哈希的 css/js)
└─ server\
   ├─ src\                       ← 后端源码
   ├─ dist\                      ← 【生产后端产物】构建后必须有 index.js
   │  └─ index.js
   ├─ data\repair.db             ← 【重点备份】数据库（账号/案例/设置/API Key）
   ├─ uploads\                   ← 【重点备份】现场照片与图纸原件
   └─ backups\                   ← 服务启动时自动生成的数据库快照
```

> 不要只复制 `dist` 目录：下次更新或重新构建需要源码和 `package.json`。
> `server/data`、`server/uploads`、`server/backups` 里是真实业务数据，迁移到新机器时必须一并复制。

---

## 3. 首次部署（只做一次）

以管理员身份打开 **CMD**（不是 PowerShell 也可以，下面命令在 CMD 中执行）：

```bat
cd /d D:\repair
npm run setup
npm run build
set PORT=3000
npm run start
```

Linux 等价命令：

```bash
cd /opt/repair
npm run setup
npm run build
PORT=3000 npm run start
```

三条命令的作用：

- `npm run setup`：安装根目录、server、client 三处依赖（首次或依赖变化时才需要）。
- `npm run build`：编译后端到 `server/dist`，打包前端到 `client/dist`。
- `npm run start`：运行 `node server/dist/index.js`，**一个进程同时提供网页和接口**。

启动成功时控制台应出现（路径以实际部署目录为准）：

```text
[migration] {...}
[seed] {...}
[backup] {...}
[static] {"dir":"D:\\repair\\client\\dist","enabled":true}
[repair-agent-server] http://localhost:3000
```

看到 `[static] ... "enabled":true` 且没有报错，就说明前端静态资源已由后端托管成功。在本机浏览器打开 <http://localhost:3000>。

**上线前必须做两件事**（用工程师账号登录后在界面操作）：

1. 「设置 → 种子账号初始密码」修改默认密码 `Repair@2026`，并通知所有使用者（种子账号见 `README.md`）。
2. 如使用大模型对话检索，在「设置 → 模型配置」填写 API Key；密钥只存服务端数据库，界面脱敏显示。

---

## 4. 后台常驻与开机自启

不要直接关掉终端就走人——窗口关了服务就停。二选一。

### 方案 A（Windows 推荐）：批处理脚本 + 任务计划程序

在 `<项目目录>` 新建文本文件 `start-production.bat`，内容如下：

```bat
@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=3000
title 服务器主板维修 Agent - 生产服务
echo [生产模式] 统一端口 3000，按 Ctrl+C 停止。
node server\dist\index.js
pause
```

**立即后台运行（不占住窗口）**：

```bat
start "" /min D:\repair\start-production.bat
```

**设置开机自启**：

1. 按 `Win + R`，输入 `taskschd.msc`，回车打开「任务计划程序」。
2. 右侧「创建基本任务」→ 名称填 `RepairAgent-Prod` → 下一步。
3. 触发器选「计算机启动时」→ 下一步。
4. 操作选「启动程序」→ 程序/脚本填 `D:\repair\start-production.bat`；**起始于（可选）**填 `D:\repair` → 下一步 → 完成。
5. 打开该任务「属性」→ 常规 → 勾选「不管用户是否登录都要运行」；设置 → 勾选「如果任务失败，重新启动」，间隔 1 分钟、最多 3 次。

以后重启服务器会自动在后台跑起来；手动重启服务可在任务计划程序里「结束任务」再「运行」。

### 方案 B：PM2（Windows / Linux 均可）

```bat
npm install -g pm2
cd /d D:\repair
set PORT=3000
pm2 start server/dist/index.js --name repair-agent
pm2 save
pm2 startup
```

`pm2 startup` 会打印一条命令，按提示**再执行一次那条命令**即完成开机自启。Linux 下把 `set PORT=3000` 换成 `PORT=3000 pm2 start server/dist/index.js --name repair-agent`。

常用维护命令：

```bat
pm2 status                 :: 看状态
pm2 logs repair-agent      :: 看实时日志
pm2 restart repair-agent   :: 重启
pm2 stop repair-agent      :: 停止
```

> 注意：如果机器上 PM2 守护进程之前已经启动过，`set PORT=3000` 可能不会传递给旧守护进程。先执行 `pm2 kill`，再按上面顺序重新启动一次。

---

## 5. 防火墙与局域网访问

**只需放行 TCP 3000 这一个端口。** 3001 / 5173 是开发端口，生产环境不要放行。

Windows（管理员 CMD）：

```bat
netsh advfirewall firewall add rule name="RepairAgent-Prod" dir=in action=allow protocol=TCP localport=3000
```

撤销规则：`netsh advfirewall firewall delete rule name="RepairAgent-Prod"`

Linux（ufw，仅允许内网网段示例）：

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
```

访问方式：

1. 在服务器上执行 `ipconfig`（Linux 用 `ip addr`），记下网卡 IPv4，例如 `192.168.1.10`。
2. 其他工位电脑浏览器打开 `http://192.168.1.10:3000`。
3. 本机可用 `http://localhost:3000`。

防火墙只选「专用网络 / 专用配置文件」，**禁止把 3000 映射到公网**。

---

## 6. 数据备份策略

必须备份这三处：

| 路径 | 内容 | 说明 |
| --- | --- | --- |
| `server/data/repair.db` | 账号、案例、设置、API Key | 核心数据库，最关键 |
| `server/uploads/` | 现场照片、图纸原件 | 案例附件实体文件 |
| `server/backups/` | 启动时的数据库快照 | 快照会自动清空 API Key，恢复后需重新填 |

Windows 每日自动备份示例：把下面内容保存为 `backup-repair.bat`，同样用「任务计划程序」设置为每天 23:00 运行：

```bat
@echo off
robocopy "D:\repair\server\data" "D:\backup\repair\data" repair.db* /R:1 /W:1
robocopy "D:\repair\server\uploads" "D:\backup\repair\uploads" /E /R:1 /W:1
robocopy "D:\repair\server\backups" "D:\backup\repair\backups" /E /R:1 /W:1
```

要点：

- 备份目录 `D:\backup\repair` 要在首次运行前建好；最好放到另一块硬盘或另一台机器。
- 备份前先停服务，或在系统界面点「数据备份」生成快照，避免复制到写一半的数据库。
- 保留最近 7～30 天；每季度做一次恢复演练。
- 恢复：先停服务 → 覆盖 `server/data/repair.db` 和 `server/uploads/` → 再启动服务 → 在界面重新填写 API Key。

---

## 7. 日常版本更新

```bat
cd /d D:\repair
git pull
npm run setup
npm run build
pm2 restart repair-agent
```

若不是 git 分发，用新版本文件覆盖源码后，同样执行 `npm run setup`（依赖有变化时）、`npm run build`，再按第 4 节重启服务。每次更新前先按第 6 节备份。

---

## 8. 常见故障排查

| 现象 | 处理 |
| --- | --- |
| 打开是空白页 / 404 | 确认执行过 `npm run build` 且 `client/dist/index.html` 存在；控制台应有 `[static] ... "enabled":true` |
| 提示端口被占用 | `netstat -ano | findstr :3000` 找到占用进程；结束它，或改 `PORT` 并同步改防火墙规则 |
| 登录提示账号密码错误 | 先用 `README.md` 的种子账号；若已改过初始密码，用改后的密码 |
| 上传附件失败 | 检查 `server/uploads/` 写权限和磁盘剩余空间 |
| 局域网电脑打不开 | 检查服务器 IP 是否正确、是否同一网段、防火墙 3000 规则是否生效、服务是否仍在运行 |
| 对话检索无结果 | 先确认大模型 API Key 已填且总开关开启；未配置时系统按规则词典降级匹配 |
