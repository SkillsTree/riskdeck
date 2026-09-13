# HANDOFF — 交接说明（给下一个会话）

本文件是上一轮会话的交接快照。项目已定型并完成端到端验证，以下是全部上下文。

## 一句话

riskdeck = 持续摄取项目计划/文档/动态信息的多项目设计与实施追踪看板。本地服务 + 自包含 Web UI，数据为 entities.json（结构真源）+ events.jsonl（只追加事件流）。

## 已确定的关键决策（不要推翻）

1. **形态**：本地服务 + Web UI（用户选定）；CLI/HTTP API/目录监听三种摄取入口全做，webhook 入口就绪、语义映射放二期；单人起步 + 预留扩展（store 已接口化）。
2. **名字**：riskdeck（用户从 risk 管控意象候选中选定，risk+deck 即“风险看板”；npm 空闲、GitHub 同名约 1 个）。用户曾提出“risk视图”，riskdeck 是其落地变体。
3. **数据模型**：四级层级（project/module/feature/interface，可跳级不可倒置）、双轴状态（design×impl）、依赖边表（图由数据推导+环检测）、里程碑四态（planned/at-risk/hit/missed，hit 需 evidence）、backlog 与承诺分离、事件只追加。
4. **UI 质感**：用户对第一版“观感/交互太糙”不满，v2 按 Linear/Notion 标准重做（⌘K 命令面板、Peek 侧滑详情、依赖图缩放平移、时间线今日线、语义状态点、深浅色）。若再动 UI，保持这个水准线。

## 已验证（全部通过）

- 建板 → 导入旧版 board.json → CLI 全部摄取命令（status/milestone/node/doc/backlog）
- serve：GET /（UI 注入+live 徽标）、GET /api/version、GET /api/snapshot
- POST /api/events（sync:true 同时改实体状态）、POST /api/notes（markdown 直传）、POST /webhooks/github（401 鉴权路径未测， secret 逻辑简单）
- 目录监听：markdown 落盘 → 防抖解析 → 去重入库（source 标记 watch:<file>）
- validate（悬空引用/依赖环/层级倒置）、events 查看、render 静态导出

## 未完成 / 下一步建议

1. git init + 首次提交（数据目录建议 .gitignore 掉 .ingest-state.json 以外的东西？—— state 文件应提交或忽略由你定）
2. 把 `data/` 空目录清理或放 .gitkeep（当前项目里的 data/ 是脚手架残留）
3. Roadmap 里的二期项（README 有清单），优先级建议：MCP server > webhook 语义映射 > 多板库
4. UI 若要再打磨：单文件在 viewer/template.html，改完跑 `node bin/riskdeck.mjs render` 目检即可
5. 仓库顶层测试脚本目前没有；冒烟命令序列见上会话，建议沉淀成 `scripts/smoke.sh`

## 已知小事项

- `--dir` 是所有摄取子命令的看板目录参数（默认当前目录）；位置参数一律是命令参数
- render 的 `-o` 短参数已支持；早期版本单横线 bug 已修
- localStorage 前缀 `rd.`（UI 偏好：主题/视图/层级）
- markdown 解析约定见 README「目录监听」节；解析失败会打 [watch] FAILED 日志并跳过该文件
