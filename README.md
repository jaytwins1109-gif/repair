> ## ⚠️ 免责声明与安全提示
>
> - **演示 / 开源版本**：本项目仅用于技术演示与开源学习。仓库内的**所有案例、机型、客户名称、工号与人名均为模拟数据**，不对应任何真实客户、真实设备或真实维修记录，请勿据此做出实际维修或商业决策。
> - **生产部署必改默认密码**：源码中写有种子账号初始密码（见 `SEED_INITIAL_PASSWORD`，默认 `Repair@2026`）。**在生产环境部署前，务必在「设置 → 种子账号初始密码」页面用工程师账号修改为强密码**，并通知所有使用者；默认密码公开可查，不修改即上线存在被未授权访问的风险。
> - **妥善保管 API Key**：对话检索的大模型 API Key 存放在服务端数据库 `llm_configs` 表中（不在仓库文件内），界面脱敏显示。请自行申请并保管密钥，**不要将真实 API Key 提交到仓库、写入日志或分享给他人**；备份文件会自动清空密钥，恢复后需在界面重新填写。
> - **终端适配（PC 桌面端）**：本项目是纯粹的 PC 桌面端 Web 应用，专为 **1080p 及以上分辨率的工位电脑浏览器**设计与验收；**暂不适配手机等移动端小屏设备**，不提供响应式移动布局。
> - **网络安全边界**：系统**仅供公司内部局域网使用**，请勿配置公网端口映射或使用反向代理暴露到公网；数据安全依托于公司内网的物理隔离、防火墙策略与终端管理，而非面向公网的安全设计。
> - **局域网访问**：同机访问 `http://localhost:5173`。若需局域网内其他工位电脑访问：① 在本机打开 CMD/PowerShell 执行 `ipconfig`，记下当前网卡的 IPv4 地址（如 `192.168.1.10`）；② 其他电脑浏览器访问 `http://<本机IPv4>:5173`（Vite 已 `--host 0.0.0.0`）；③ 在 Windows「高级设置 → 入站规则」放行 TCP **3001**（后端 API）与 **5173**（前端），或以管理员身份执行 `netsh advfirewall firewall add rule name="RepairAgent" dir=in action=allow protocol=TCP localport=3001,5173`。仅建议在「专用网络」配置文件下放行。

# 服务器主板维修 Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个面向服务器板级维修场景的知识库 + 对话检索系统：把历史维修记录沉淀成案例库，技术员用自然语言描述故障现象即可检索相似案例；工程师负责案例审核、词典/机型维护、大模型配置与数据备份。

**开源仓库**：<https://github.com/jaytwins1109-gif/repair>（MIT 许可，详见 [LICENSE](LICENSE)）。

技术栈：Express 4 + TypeScript + better-sqlite3（后端）、React 18 + Vite 6 + Tailwind（前端）。数据全部落在本地 SQLite，无外部数据库依赖。

---

## 1. 快速开始

环境要求：Node.js 24（Windows 本机验证过），npm。

**一键启动**（推荐）：
- Windows：双击根目录 `start.bat`（自动检查 Node、首次安装依赖、启动服务并打开浏览器）
- macOS / Linux：`bash start.sh`（自动检查 Node、首次安装依赖并启动服务）

手动启动等效命令：

```bash
# 1) 安装依赖（根目录一次装齐 server / client）
npm run setup

# 2) 一键启动开发服务（server :3001 + client :5173，带热重载）
npm run dev
```

打开浏览器访问 <http://localhost:5173>。 Vite 会把 `/api` 代理到后端 `http://localhost:3001`（见 `client/vite.config.ts`）。

单独启动/构建：

```bash
npm run dev:server     # tsx watch src/index.ts，后端 :3001
npm run dev:client     # vite --host 0.0.0.0，前端 :5173
npm --prefix server run build    # tsc 编译到 server/dist
npm --prefix client run build    # tsc --noEmit && vite build，产物 client/dist
npm --prefix server run start    # 用编译产物启动（生产形态）
```

`PORT` 环境变量可覆盖后端端口（默认 3001；若改端口需同步改 Vite proxy）。

首次启动时后端会自动：建库 → 跑迁移 → 播种种子数据（账号、演示案例、故障词典、机型别名）→ 备份数据库。迁移/播种结果和备份路径会打印在控制台：

```text
[migration] {...}
[seed] {...}
[backup] {...}
```

---

## 2. 登录与角色

初始密码统一为 **`Repair@2026`**（源码常量 `server/src/db/index.ts` 的 `SEED_INITIAL_PASSWORD`，新库首次建库时写入）。种子账号：

| 工号 | 姓名 | 角色 | 职位 |
| --- | --- | --- | --- |
| WX1001 | 陈立群 | engineer（工程师） | 硬件维修工程师 |
| WX1002 | 韩志远 | engineer（工程师） | 硬件维修工程师 |
| WX2001 | 李文博 | technician（技术员） | 主板维修技术员 |
| WX2002 | 赵鹏程 | technician | 主板维修技术员 |
| WX2003 | 周天成 | technician | 主板维修技术员 |
| WX2004 | 吴嘉豪 | technician | 主板维修技术员 |
| WX2005 | 郑晓帆 | technician | 主板维修技术员 |
| WX2006 | 孙铭泽 | technician | 主板维修技术员 |
| WX2007 | 马海涛 | technician | 主板维修技术员 |
| WX2008 | 徐若涵 | technician | 主板维修技术员 |

- **工程师**：案例审核、机型/客户/词典维护、系统与大模型设置、批量改初始密码、数据导出、清理示例数据。
- **技术员**：提交案例、对话检索、查看已通过案例与附件。

> 修改初始密码：工程师在「设置 → 种子账号初始密码」输入新密码（8-64 位）并二次确认，接口 `POST /api/auth/change-initial-password` 会批量更新 10 个种子账号，**不影响后续新增账号、不使已登录会话失效**。改后请通知所有使用者。若要连新库的初始值一起改，需修改源码常量后重新建库。

---

## 3. 主要功能

| 模块 | 页面 | 说明 |
| --- | --- | --- |
| 对话检索 | 对话页 | 输入故障现象，返回相似案例。规则词典命中优先；开启大模型后做关键词扩展，失败自动降级到规则匹配并标注 `fallbackReason` |
| 案例库 | 案例库页 | 按机型/客户/故障分类等分面筛选；支持 Excel 批量导入（下载模板 → 预览列映射与前 20 行 → 确认后写库，带批次号）；失败行可导出 CSV |
| 待审核 | 待审核页 | 工程师审批新提交案例（通过/驳回），每次审批写入独立审计日志 |
| 机型 / 客户 | 机型页、客户页 | 机型别名、客户名录维护（工程师可编辑） |
| 大模型配置 | 设置 → 模型配置 | 配置 DeepSeek 等平台的 API Key / 模型名，可多套切换、测试连接、开关总开关、设每日上限；密钥仅存服务端并脱敏显示 |
| 系统设置 | 设置页 | 审核开关、匹配阈值、每日上限、排序截断、故障现象词典、数据导出/备份、种子账号改密等 |

**检索准确性原则**：硬性准入（命中机型/客户之一 + 至少一个现象词族）保留；弱相关结果单独成组、最多 3 条、默认折叠并标注「弱相关，仅供参考」；没有任何案例通过准入时如实返回未找到，不凑数。AI 扩展词只参与打分排序，不参与准入判定。

**附件安全**：现场照片只经带鉴权的 `GET /api/attachments/:id/raw` 获取，前端用 `fetch` + `Authorization: Bearer` 取 blob 后经 `URL.createObjectURL` 显示，严禁把 token 放进图片 URL。

---

## 4. 数据与目录

- 数据库：`server/data/repair.db`（首次启动自动创建，已被 `.gitignore` 排除，不会入库）。
- 备份：启动时自动备份到 `server/backups/`；备份会清空 `llm_configs.api_key`，用备份恢复到新机器后需在「模型配置」里重新填 API Key。
- 上传附件：`server/uploads/`。
- 核心表：`cases`、`case_attachments`、`users`、`sessions`、`import_batches`、`audit_logs`（审批日志）、`llm_configs`、`settings`、`symptom_dict`、`model_alias` 等。

**配置数据红线**：`llm_configs`（尤其 API Key）、`settings`（审核开关、阈值、上限）、`symptom_dict`、`model_alias` 只允许工程师通过界面提交修改；脚本/迁移不得直接写入或删除。

---

## 5. 验证与测试

开发仓库 `server/verify/` 下保留逐轮验证脚本（`verify-r*.mjs` / `*.cjs`）、`client/e2e/r26-e2e.mjs`（Playwright 真实浏览器 E2E）。临时验证脚本必须先建独立测试库副本，禁止连开发库：

```bash
# 1) 用 VACUUM INTO 从开发库只读生成副本（路径须在 server/verify/.db/ 下）
node server/verify/verify-copy.mjs --db=<绝对路径>/server/verify/.db/<批次>/data/repair.db

# 2) 运行验证脚本时显式传 --db；守卫会拒绝缺省路径或指向开发库的调用
npx tsx server/verify/verify-xxx.mjs --db=<绝对路径>/server/verify/.db/<批次>/data/repair.db

# 3) 测完删除整个副本目录
```

浏览器 E2E（需先装 Chromium）：`npx playwright install chromium`，然后 `cd client && node e2e/r26-e2e.mjs`（依赖开发服务已启动）。

---

## 6. 代码托管与开源说明

本项目已开源托管于 <https://github.com/jaytwins1109-gif/repair>，采用 MIT 协议（见 [LICENSE](LICENSE)）。克隆：

```bash
git clone git@github.com:jaytwins1109-gif/repair.git
cd repair
npm run setup && npm run dev
```

- 默认分支 `master`，本地与远程已建立追踪；日常改动 `git add -A && git commit` 后 `git push origin master` 即可。
- 如需改用自己的远程：`git remote set-url origin <你的仓库地址>`。
- 敏感文件已在 `.gitignore` 排除：`node_modules`、`dist`、`server/data`、`server/backups`、`server/uploads`、所有 `*.db*`、`.env*`、`client/e2e/*.xlsx` 等。推送前可复核：

```bash
git status --short --untracked-files=all      # 应为空
git ls-files | Select-String '\.(db|png|key|env)$'   # 应零命中
```

---

## 7. 人工验收项

失败行导出的 CSV 已由真实浏览器验证写入时会对 `= + - @` 开头的单元格加前导单引号转义，但 **用 Excel 实际打开 CSV、确认公式不被执行** 由使用者本地人工验收。

---

## 8. 交接说明

- 项目规则与逐轮改动历史见根目录 `CODEBUDDY.md`、`PROJECT_LOG.md`（开工先读规则）。
- **防注入与大模型约束的实现与验证结论**见根目录 `约束防护.md`（SQL/LIKE/附件/CSV 注入防护、LLM 准入与降级、密钥与配置红线等）。
- API Key 在数据库 `llm_configs` 表中、不在仓库文件里；换机器后须在界面重新填写。
- 本 README 面向使用者与交接；更细的逐轮验证证据见 `PROJECT_LOG.md`。
