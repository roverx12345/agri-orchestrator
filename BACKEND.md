# 种花田 app 后端 MVP

## 当前定位

这个仓库原本是 `agri-orchestrator` OpenClaw 插件工程。
本次增量加入了一个 **业务后端 MVP**，把业务真源放到 PostgreSQL，OpenClaw 只保留为编排/解释层。

## 新增后端结构

```text
src/backend/
├── app.ts
├── config.ts
├── http.ts
├── repository.ts
├── runtime.ts
├── server.ts
├── services.ts
├── worker.ts
├── db/
│   ├── migrate.ts
│   └── pg.ts
├── migrations/
│   └── 001_init.sql
├── modules/
│   ├── background-data/routes.ts
│   ├── exports/routes.ts
│   ├── health/routes.ts
│   ├── observations/routes.ts
│   ├── operations/routes.ts
│   ├── plugin-adapter/routes.ts
│   ├── recommendations/routes.ts
│   ├── reminders/routes.ts
│   └── units/routes.ts
├── rules/
│   └── engine.ts
├── scripts/
│   └── seed-demo.ts
└── storage/
    └── local-storage.ts
```

## 数据流

1. `units / crop_plans / observations / operation_logs / background_snapshots` 进入 PostgreSQL。
2. `care-check` 从这些结构化数据读取上下文。
3. 后端规则引擎输出：
   - `recommendations[]`
   - `reminders[]`
   - `missingInputs[]`
4. OpenClaw 插件未来应调用 `/plugin/*` 接口，不再把关键业务状态只放在 OpenClaw memory。

## 规则引擎

当前实现为 `generic conservative mode`：

- water check
- nutrition check
- pest/disease scout priority
- harvest readiness placeholder
- general risk scan
- high-risk operation confirmation scan

原则：缺关键输入时，不给激进建议，而是输出 `requiredInputs` 和保守动作。

## 关键环境变量

见 `.env.backend.example`：

- `DATABASE_URL`：PostgreSQL 连接串
- `BACKEND_HOST` / `BACKEND_PORT`：HTTP 服务监听地址
- `STORAGE_DIR`：上传文件和导出文件目录
- `REMINDER_SCAN_INTERVAL_MS`：worker 扫描提醒的周期
- `REMINDER_LOOKAHEAD_MINUTES`：预留给后续 reminder 窗口策略的配置项，当前可保持默认

## 启动方式

### 1. 启 PostgreSQL

本地可直接用：

```bash
docker compose -f docker-compose.backend.yml up -d
```

### 2. 编译

```bash
npm run build
```

### 3. 跑 migration

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seedflower npm run db:migrate
```

### 4. 启后端

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seedflower npm run backend:start
```

### 5. 启 worker

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seedflower npm run worker:start
```

### 6. 写入演示数据

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/seedflower npm run backend:seed
```

## API 摘要

### Unit / Crop Plan

- `POST /units`
- `GET /units/:id`
- `PATCH /units/:id`
- `POST /units/:id/crop-plans`
- `GET /units/:id/timeline`

### Observation

- `POST /units/:id/observations/user`
- `POST /units/:id/observations/coworker`
- `GET /units/:id/observations`

上传支持两种方式：

- `application/json`：直接传结构化 `payload`
- `multipart/form-data`：字段 `payload` 放 JSON，文件字段可直接上传

### Operation

- `POST /units/:id/operations`
- `GET /units/:id/operations`

高风险操作（如 `spraying` / `harvest` / `postharvest`）要求 `confirmed=true` 或 `confirmedBy`。

### Recommendation / Care Check

- `POST /units/:id/care-check`
- `GET /units/:id/recommendations`

`care-check` 返回结构化 JSON，不只返回自然语言。

### Reminders

- `POST /units/:id/reminders`
- `GET /units/:id/reminders`
- `POST /reminders/:id/complete`
- `POST /reminders/:id/skip`

### Background Data

- `POST /background/ingest/raw`
- `POST /background/ingest/normalized`
- `POST /background/ingest/feature`
- `POST /units/:id/background/weather/forecast`
- `GET /units/:id/background/latest`

`POST /units/:id/background/weather/forecast` 当前内置了 `open-meteo` 预测接入：

- 依赖地块 `latitude` / `longitude`
- 默认抓取未来 3 天日尺度预报，并选择“明天”作为目标日
- 会自动写入：
  - 一条 `weather` observation
  - 一条 `normalized` background snapshot
  - 一条 `feature` background snapshot（包含 `rainRiskLevel`）

### Exports

- `POST /exports`
- `GET /exports/:id`

当前为 CSV 导出，文件写入 `STORAGE_DIR/exports/`。

### Plugin Adapter

- `GET /plugin/units/:id/context-summary`
- `POST /plugin/units/:id/weather/forecast`
- `POST /plugin/units/:id/observation`
- `POST /plugin/units/:id/care-check`
- `POST /plugin/units/:id/confirm-operation`
- `GET /plugin/units/:id/active-state`

这些接口给 OpenClaw 插件消费，业务逻辑仍在后端。

## OpenClaw 插件联调建议

插件侧优先只调用 `/plugin/*`，不要直接写业务库。

### 建议调用关系

1. 进入某个花/田上下文时：
   - `GET /plugin/units/:id/context-summary`
   - 用于拿当前档案、最近 observation / operation / recommendation / reminder

2. 用户上传图文或结构化记录时：
   - `POST /plugin/units/:id/observation`
   - 支持 JSON，也支持 `multipart/form-data`

3. 用户要求“同步一下这块田的天气”时：
   - `POST /plugin/units/:id/weather/forecast`
   - 推荐 body：`{ "timezone": "auto" }`

4. 用户要求“检查现在该怎么养/怎么管”时：
   - `POST /plugin/units/:id/care-check`
   - 推荐 body：`{ "persist": true }`

5. 用户确认已经执行了某项操作时：
   - 已有 operationId：`POST /plugin/units/:id/confirm-operation`
   - 或直接创建并确认新 operation：同一个接口直接传 operation body

6. 只想快速读取当前状态时：
   - `GET /plugin/units/:id/active-state`

### 返回结构稳定约定

- `context-summary`
  - `unit`
  - `activeCropPlan`
  - `profileSummary`
  - `recentObservations`
  - `recentOperations`
  - `recentRecommendations`
  - `pendingReminders`
  - `latestBackground`

- `active-state`
  - `unitId`
  - `unitStatus`
  - `activeCropPlan`
  - `latestRecommendation`
  - `pendingReminderCount`
  - `lastObservationAt`
  - `lastOperationAt`

- `care-check`
  - `recommendations`
  - `reminders`
  - `missingInputs`
  - `mode`
  - `savedRecommendations`
  - `savedReminders`

## 飞书接入建议

当前仓库还没有直接内置飞书机器人代码，推荐接法是：

1. 飞书机器人 / 飞书应用接收消息
2. 你的中间层把自然语言解析成 `unitId + action`
3. 中间层调用本后端 `/plugin/*` 接口
4. 把结构化结果再回发到飞书群或飞书私聊

推荐把飞书里的几个高频动作固定成模板：

- `新建玉米田：名称=北田A，位置=东区，纬度=..., 经度=...`
- `记录观察：北田A，土壤湿度适中`
- `同步天气：北田A`
- `做一次农田检查：北田A`

一个常见联动顺序是：

```text
飞书消息 -> 查询 unitId -> POST /plugin/units/:id/weather/forecast -> POST /plugin/units/:id/care-check
```

这样飞书里就可以先同步天气，再立即拿到针对当前地块的预警和建议。

## 启动建议

### 本地开发

1. PostgreSQL 单独启动
2. 跑 migration
3. 启后端 HTTP
4. 单独启 worker

后端和 worker 是两个独立进程，联调时建议分别开两个终端。

### 服务器部署

最小部署建议：

1. 一个 PostgreSQL
2. 一个 backend 进程
3. 一个 worker 进程
4. 一个共享 `STORAGE_DIR`

如果用 systemd / supervisor / pm2，建议把 backend 和 worker 分开托管。

## 测试

```bash
npm run typecheck
npm test
```

当前测试覆盖：

- 规则引擎单测
- API 集成测试：建档、上传 observation、care-check、高风险 operation 校验
- 原有 plugin 测试继续通过
