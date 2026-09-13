# RiskDeck

> 持续摄取项目计划、文档、动态信息的多项目设计与实施追踪看板。

信息如潮汐涌入（events.jsonl 只追加事件流），看板实时呈现每个项目/模块/功能/接口的**设计-实施双轴状态**、**跨级依赖关系**、**里程碑风险预警**。本地服务 + 零依赖 Web UI，数据是 git 友好的纯文本文件。

## 快速开始

```bash
node bin/riskdeck.mjs init ./myboard --title "星舟项目群"
cd myboard

node ../bin/riskdeck.mjs node add project proj-platform --name 电商平台
node ../bin/riskdeck.mjs node add module mod-auth --name 认证中心 --parent proj-platform
node ../bin/riskdeck.mjs status mod-auth --impl verified --note "登录上线" --ref "PR #88"
node ../bin/riskdeck.mjs milestone upsert --id ms-1 --node mod-auth --name "认证 GA" \
  --date 2026-10-01 --status planned --criteria "登录可用,压测通过"

node ../bin/riskdeck.mjs serve ./myboard --watch ./notes   # http://127.0.0.1:7466
```

打开浏览器即得交互看板：**结构**（层级树 + 依赖图 + ⌘K 跳转 + Peek 详情）、**时间线**（里程碑 ◆ 四态预警 + 动态事件流 + 今日线）、**统计**（进度/分布/风险清单/枢纽元素）。数据变更后 15 秒内自动刷新。

## 架构

```
数据层  entities.json（当前结构真源）+ events.jsonl（只追加历史流）
摄取层  CLI 子命令 · HTTP API · 目录监听（markdown frontmatter 约定） · webhook（二期）
服务层  node:http 本地服务：GET / 注入式 UI，GET/POST /api/*
导出    render 子命令 → 自包含静态 HTML（离线可存档/提交）
```

```
bin/riskdeck.mjs    CLI 入口（命令分发）
src/store.mjs       数据层：读写/校验/滚动汇总/导入（校验含悬空引用+依赖环+层级倒置）
src/ingest.mjs      摄取操作：实体变更与历史事件原子同写（CLI 与 HTTP 共用）
src/parser.mjs      markdown 约定解析
src/watcher.mjs     目录监听（防抖 250ms + 内容哈希去重）
src/server.mjs      HTTP 服务与 API
src/report.mjs      阶段汇报投影（风险存量流量/高危触发器/资产门禁/burn-up）
src/render.mjs      静态导出
viewer/template.html 自包含看板 UI（无外部依赖，深浅色自适应）
viewer/report-template.html 自包含汇报 HTML（详略开关/精度切换/其他折叠）
schema/board.schema.json  数据模型 JSON Schema（v2：+risks/assets/goal/estimate）
```

## 数据模型

- **层级**：project → module → feature → interface（可跳级，不可倒置）
- **双轴状态**：`design` draft/reviewed/approved/deprecated；`impl` todo/wip/done/verified/na —— 必须有证据（文档/PR/测试）
- **依赖**：跨层级、跨项目边表（depends/calls/imports/data/deploy），图由边数据机械推导，校验器拒绝依赖环
- **里程碑**：planned / at-risk / hit / missed；hit 必须给 evidence；文档提取不到日期就不建（禁臆造工期）
- **事件流**：append-only，每条含 {date,type,node,from?,to?,note,ref?,source}；状态变更与事件在同一笔操作中写入
- **backlog**：未承诺想法与板上承诺严格分离（uncommitted/planned/cancelled）

## 摄取入口

**CLI**（人和 agent 通用）：`status`（最高频）/ `event` / `node add` / `milestone upsert` / `dep add` / `doc attach` / `backlog add` / `risk upsert` / `asset upsert` / `goal set` / `import-note`

## 阶段汇报（report）

```bash
node bin/riskdeck.mjs report ./myboard --from 2026-08-14 --to 2026-09-12
# → report-<to>.md + report-<to>.html（自包含，含汇报/核查视图切换、精度切换、长尾折叠）
```

报告是看板的**投影**，不是手工文档：数字全部由窗口内事件流计算。主视图为**项目泳道**（移植自 `viewer/prototype-risk-view.html` 变体 A，按需求方评审修正）：车道头 = 目标达成环 + 里程碑轨道 + 四类风险 chips + 暴露值/高危 + 窗口流量 + burn-up；点行 Peek 下钻（目标契约/关联风险/事件流）。自包含 HTML 的 chrome 含顶栏分段导航（滚动跟随）、KPI 卡，**阶段汇报窗口控件（7/14/30/90/自定义）在客户端全量重算投影**——风险存量按窗口末日回放事件推导，流量/达成/burn-up/事件附录随窗口联动。汇报/核查视图切换、数字精度切换、长尾折叠（Top 3 + 其他）。

**达成度纪律**：任务达成度 = 子任务完成率**推导**，禁止手填；允许 `goal set --pct` 人工修正，但生效值被推导值 **±20pp 限幅**，且修正动作走事件流审计（节点上的 progressOverride 会向上滚动参与父级推导）。

风险与资产是 v2 台账实体：`risk upsert`（四类：schedule/resource/problem/quality，暴露值 p×i，生命周期 open→mitigating→resolved/accepted）与 `asset upsert`（流程/工具/经验/模板/数据，提出→沉淀→投产）。目标契约挂节点：`goal set <node> --metric --gate --due --fte`，叶子任务用 `--hours` 估算（两周规则刻度）。

**HTTP API**：
```bash
curl -X POST localhost:7466/api/events -H 'content-type: application/json' \
  -d '{"type":"impl","node":"mod-auth","to":"done","note":"登录完成","ref":"PR #88","sync":true}'
# sync:true 会同时更新实体状态（CLI status 的 API 等价物）

curl -X POST localhost:7466/api/notes --data-binary @note.md   # markdown 直传
```

**目录监听**：`serve --watch notes/` 后，符合约定的 markdown 落盘即入库：
```markdown
---
type: impl        # design|impl|milestone|dependency|note
node: mod-auth
to: done          # 可选 from/to 状态迁移
ref: PR #88
---
正文作为 note 补充说明
```

**Webhook**（入口已就绪，语义映射二期）：`POST /webhooks/github`，设 `TRACEBOARD_WEBHOOK_SECRET` 环境变量并用 `x-traceboard-secret` 头校验。v0.1 统一记录为 note 事件。

## 设计约定

1. **历史绝不改写**：events.jsonl 只增不删；回退状态是重要事实，必须留事件
2. **证据门**：无证据不记状态、不补日期
3. **id 稳定**：永不改名（历史依赖 id）；改名用 name 字段
4. **图由数据推导**：依赖图只从边表渲染，不凭印象补边

## Roadmap

- [ ] 二期：GitHub Issues/PR → 节点状态的自动映射（webhook 语义化）
- [ ] MCP server：让 dsh/codex/claude 的 agent 在会话里直接读写看板
- [ ] 多板库：一个数据目录管理多个项目群（`--board <name>`）
- [ ] 团队共享：LAN 部署 + 简单鉴权（store 层已是接口化设计，可换 sqlite）
- [ ] 设计↔代码对账：从仓库路由/OpenAPI 定义反推接口清单与实施状态 diff

## License

MIT
