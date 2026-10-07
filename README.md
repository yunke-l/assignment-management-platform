# Classwork — Assignment Management Platform

面向小型教学班的作业管理平台。React + TypeScript 前端、NestJS API、PostgreSQL 数据库；使用独立实现和合成演示数据。

本次交付范围：**完整本地版本与部署准备**。线上发布按用户要求留待提供平台后进行。范围核对见 [交付验收](docs/ACCEPTANCE.md)，检查结果见 [验证记录](docs/VERIFICATION.md)，原始范围及阶段见 [开发计划](docs/DEVELOPMENT_PLAN.md)，简历表述和面试演示见 [作品说明](docs/PORTFOLIO.md)。

代码托管：[GitHub 私有仓库](https://github.com/yunke-l/assignment-management-platform) · [GitHub Actions 检查记录](https://github.com/yunke-l/assignment-management-platform/actions/workflows/ci.yml)。查看仓库需要获授权的 GitHub 账号；应用仍在本地运行。

界面采用猫头鹰 Ollie 主题，兼顾亲切的学习氛围与教师的日常工作效率：[设计说明与页面预览](docs/DESIGN.md)。

## 已实现

- 教师／学生登录、邀请注册、刷新后保持登录、退出撤销会话、修改密码后撤销所有会话。
- 教师创建班级、生成限时限次邀请码、撤销邀请、分页查看成员、移除成员。
- 草稿创建、预览、编辑、删除、发布；编辑使用版本号检测冲突，已发布题目不可改。
- 每题 2–6 个选项，最多 20 题，服务端校验与判分，每人一次最终提交。
- 提交请求幂等、数据库截止时间检查、事务回滚及数据库唯一约束。
- 按班级、标题和状态筛选；分页查询；教师查看已提交／未提交名单、分数和平均分。
- 桌面／手机布局、键盘操作、加载与错误状态、失败重试。
- 数据迁移、HTTP 集成测试、Playwright 页面测试、真实 PostgreSQL 验证入口、合成数据查询测量。
- 同源 Web/API 生产入口、Dockerfile、HTTPS 代理配置、CI、部署及备份恢复操作说明。

## 成员与历史作业规则

已按用户确认的规则实现：**发布时固定名单**。新加入者只获得今后发布的作业。移除学生后，该学生立即失去本班既有作业的查看与提交权限；教师保留其历史成绩。重新加入不恢复旧作业权限，但可以收到新的作业。

统计的分母是发布时的名单，包含后来被移除的学生；平均分只计算已提交成绩。未提交显示“Not submitted”，没有提交时平均分为 `null`，不显示为零分。草稿预览统计使用当前班级人数。

## 本地启动（不需要 Docker）

需要 Node.js 22.13+（22.x）或 24+，验证使用 Node 24。在此目录运行：

```sh
npm ci
npm run dev:demo
```

打开 **http://localhost:5173**。API 位于 `http://127.0.0.1:3100/api`。请使用这个 localhost 地址，以匹配浏览器请求的 Origin。

| 账号                         | 密码              | 身份     |
| ---------------------------- | ----------------- | -------- |
| `teacher@example.test`       | `LocalStudy2026!` | A 班教师 |
| `student@example.test`       | `LocalStudy2026!` | A 班学生 |
| `other.teacher@example.test` | `LocalStudy2026!` | B 班教师 |
| `other.student@example.test` | `LocalStudy2026!` | B 班学生 |

演示模式使用 `.local/database` 中的 PGlite（嵌入式 PostgreSQL），不依赖模拟 HTTP。已有数据通过新增迁移升级；种子账号密码不会被重复运行覆盖。同一个数据目录只运行一个实例。Ctrl+C 停止。

演示账号是公开测试数据，不能用于公网环境。演示启动器会补全固定账号和固定班级的演示成员关系；请在自己新建的班级中演示成员移除，避免重启补全固定种子关系造成误解。

### 启动时提示端口已占用

演示需要 `3100`（API）和 `5173`（页面）两个端口。若已有实例运行，直接打开 http://localhost:5173；需要重启时，在原终端按 **Ctrl+C**，等待退出后再运行 `npm run dev:demo`。不要同时启动两个实例访问同一数据目录。

启动器会在迁移和种子数据写入之前检查端口。发现占用会列出具体端口与处理方法，不自动终止其他程序。正常 Ctrl+C 会停止这次启动的开发进程及子进程，避免退出后仍占用端口。若其他阶段失败，请查看简短退出提示上方的原始错误日志。

## 推荐验收流程

1. 用教师账号登录，到 **Classes** 创建班级，生成学生邀请码。
2. 在另一个浏览器或无痕窗口点 **Have an invitation? Create an account**，用新邮箱和邀请码注册学生。
3. 教师在 **Assignments** 新建作业，保存草稿，编辑并保存，再发布到刚建的班级。
4. 学生刷新列表、作答并提交；再次刷新可以读到已保存成绩。
5. 教师查看 **Student progress**，核对提交人数、学生分数和平均分。
6. 教师在 **Classes** 移除学生；学生刷新后看不到旧作业，教师报告仍保留成绩和 Removed 标记。
7. 退出后刷新应回到登录页；**Account** 可修改密码并撤销该账号所有会话。

## 使用独立 PostgreSQL

有 Docker 时：

```sh
cp .env.example .env
docker compose up -d db
npm run db:migrate
ALLOW_DEMO_SEED=true npm run db:seed
npm run dev
```

开发数据库默认绑定 localhost:5434。不要与 demo 同时占用 3100/5173 端口。生产环境必须使用 PostgreSQL。

正式教师由运行环境的管理员通过 CLI 创建邀请，无需额外开放管理员网站或公共教师注册：

```sh
npm run accounts -- invite-teacher teacher@your-domain.example
```

CLI 使用根目录 `.env` 指向的数据库。邀请码绑定邮箱，48 小时内只能注册一次。管理员负责私下转交，程序不自动发送邮件。已有学生使用 **Classes → Join class** 加入其他班级。

## 检查与测试

```sh
npm run check
npm run format:check
npm run test:recovery
```

`check` 包括零警告 ESLint 检查、应用/脚本/测试文件的类型检查、开发进程回归测试、前端请求处理测试、HTTP 集成测试、生产构建及编译入口冒烟检查。`test:recovery` 使用新建的合成 PGlite 数据目录，验证离线备份、恢复、凭据撤销和历史成绩，不触碰本地演示库。默认集成测试使用独立内存 PGlite；真实 PostgreSQL 测试必须指向空的、可丢弃的专用数据库：

```sh
TEST_DATABASE_URL=postgresql://amp:test_only_password@localhost:5432/amp_test npm run check
```

不能指向真实数据：测试会写入合成账号、修改测试作业截止时间并临时注入数据库失败。PGlite 的单连接通过不能替代真实 PostgreSQL 验证。

首次安装浏览器依赖，再运行端到端测试：

```sh
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npm run test:e2e
```

测试自建 3111/5175 端口服务和全新内存数据库，不触碰演示库。HTML 报告在 `playwright-report/`，截图和失败轨迹在 `test-results/`；CI 上传为工作流产物。手机测试是 Chromium 的手机视口与触摸模拟，并非真机 Safari 测试。

合成查询测量需另建名称以 `_bench` 结尾的空数据库：

```sh
BENCH_DATABASE_URL=postgresql://amp:password@localhost:5432/classwork_bench npm run benchmark
```

脚本拒绝已有 users 表的数据库，生成独立样本，记录 HTTP 延迟及 `EXPLAIN (ANALYZE, BUFFERS)`。结果和限制见 [查询测量](docs/PERFORMANCE.md)。

## 项目结构

```text
apps/web/src/              登录、作业、班级和账号界面
apps/api/src/auth/         可撤销会话、密码认证、Origin 防护
apps/api/src/classes/      成员、邀请、权限规则
apps/api/src/assignments/  作业、发布名单、提交及报告
apps/api/src/database/     数据库适配、迁移、种子与管理员 CLI
apps/api/migrations/       追加式 SQL 迁移
apps/api/test/             HTTP 与真实数据库集成测试
packages/contracts/       共享 Zod schema 与响应类型
scripts/                  演示启动、隔离 E2E 服务与基准脚本
e2e/                      桌面及手机页面流程
docs/                     设计、API、验证与部署说明
deploy/                   HTTPS 代理及环境变量示例
```

契约变化后 `npm run build -w @amp/contracts`，必要时重启 API。`npm run check` 和演示启动会自动构建契约。

## 部署与边界

[部署、迁移、回滚和恢复说明](docs/DEPLOYMENT.md) 包含 Docker/Caddy/PostgreSQL 命令。本地 PGlite 离线恢复已通过；代码已接入私有 GitHub 仓库，CI 的各次结果以 Actions 检查记录为准。CI 的 `container` 任务构建生产镜像，运行 PostgreSQL 迁移、静态资源/API 冒烟检查及 Caddy 配置校验。当前没有应用托管部署；公网 HTTPS 及生产 PostgreSQL 备份恢复仍需在目标环境验证。

当前版本不含手工批改、附件、多次作答、AI 批改、邮件自动发送、忘记密码自助恢复和分布式限流。会话固定七天后过期。筛选使用大小写不敏感的标题子串匹配；分页在每次请求内使用一致快照，跨页面浏览期间若数据发生增删，需刷新列表。

更多设计：[架构](docs/ARCHITECTURE.md)、[API](docs/API.md)、[验证证据](docs/VERIFICATION.md)。不要把合成测试结果表述为真实用户规模或线上性能。
