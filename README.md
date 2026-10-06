# 企业培训录播授权与到期下架系统

员工能否观看课程，取决于**所在部门**和**讲师/管理员对具体视频版本登记的授权期限**。系统覆盖授权登记、到期拦截、版本续签、到期/下架下架、模拟续签提醒与完整的访问审计。

## 技术栈

- 后端：TypeScript + NestJS + Prisma + SQLite（JWT 鉴权、HMAC 短时效签名地址、Range 流式播放）
- 前端：React + TypeScript + Vite
- 视频：本地文件（`backend/media`）；许可文件：本地（`backend/uploads/licenses`）
- 提醒：模拟实现（落库 `Notification` + 后端控制台日志）

## 一条命令启动

```bash
bash start.sh        # 或 npm start
```

脚本会自动：安装前后端依赖 → 复制 `.env` → Prisma 迁移建库 → 写入演示数据 → 启动前后端。

- 前端页面：http://localhost:5173
- 后端接口：http://localhost:3001/api
- 演示账号（密码均为 `123456`）：
  - `admin` 系统管理员（研发部）
  - `alice` 张爱研（研发部）
  - `bob` 李销冠（销售部）
  - `carol` 王人事（人事部）

重置演示数据：`npm run reseed`（或 `cd backend && RESEED=1 npm run prisma:seed`）。

## 端到端验证

后端运行时，另开一个终端：

```bash
npm run e2e
```

42 项断言覆盖完整授权生命周期（最后输出 `42 通过 / 0 失败`）。

## 核心设计：为什么旧链接会失效

1. **员工从不接触文件真实路径**。前端只拿到形如 `/api/media/stream/:versionId?u=..&v=..&l=..&m=..&e=..&s=..` 的短时效（默认 5 分钟）HMAC 签名地址，签名绑定 用户 / 视频版本 / 具体许可 / 播放或下载用途。
2. **签名通过 ≠ 授权通过**。媒体端点每次请求都重新查库判定：
   - 许可仍为 `ACTIVE`（未下架）、当前时间在 `validFrom ~ validUntil` 内；
   - 许可未被续签接替（`supersededById` 为空）；
   - 当前用户部门在该许可的授权部门名单内；
   - 签名本人使用、播放/下载用途不可互换、未篡改、未超时。
3. 因此**授权到期、管理员下架、版本续签后，员工此前拿到的播放/下载地址立即失效**；跨部门员工即使拿到链接也无法访问。

## 版本续签规则（不允许直接延长旧许可）

- 续签 = 选择**同一门课程的另一个视频版本** + 登记**新的许可文件** + 新期限/部门，创建一条**全新 License 记录**。
- 旧许可只写入 `supersededById` 指向新许可，状态派生为“已续签”，**截止日期等任何字段不被修改**。
- 服务端拒绝：在同一视频版本上续签（=变相延期）、用其他课程的版本续签、对已续签许可重复续签。

## 页面说明

- **我的课程**（员工）：每个视频版本展示授权状态与到期时间；播放/下载时服务端二次鉴权；拒绝原因直接展示。
- **续签提醒**（管理员）：列出未来 7 天（`RENEW_WINDOW_DAYS` 可调）内到期的授权，一键模拟扫描发送提醒，或直接发起续签。
- **授权管理**（管理员）：按 有效/即将到期/已到期/已下架/已续签 筛选；登记新授权、续签、下架（原因必填）、下载许可文件。
- **历史授权**：按课程查看全部许可记录（到期、接替链、下架原因均保留）。
- **访问记录**：每次播放/下载尝试（放行与拒绝）均留痕，含 `EXPIRED / TAKEN_DOWN / DEPARTMENT_MISMATCH / RENEWED / BAD_SIGNATURE` 等原因。
- **模拟通知**：查看/扫描续签提醒（真实环境替换 NotificationService 即可接入邮件或企业 IM）。

## 目录结构

```
backend/
  prisma/schema.prisma     Department/User/Course/VideoVersion/License/...
  prisma/seed.ts           演示数据（含即将到期、已到期、仅跨部门、已下架四种场景）
  src/license/             授权判定 + HMAC 签名地址
  src/courses/             员工课程列表 / 打开视频二次鉴权
  src/media/               播放(Range)/下载端点：每次请求重新鉴权 + 访问日志
  src/admin/               签发、版本续签、下架、筛选、历史、访问记录、模拟提醒
frontend/                  React 页面
scripts/e2e.ts             端到端流程验证
start.sh                   一条命令启动
```
