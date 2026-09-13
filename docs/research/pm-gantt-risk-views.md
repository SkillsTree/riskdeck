# 项目进度 / 里程碑 / 风险可视化调研 —— riskdeck 设计参照

> 调研日期：2026-09。方法：三个并行研究线（开源甘特/PM 项目、商业 PM 产品、可视化模式理论），全部追溯官方来源；
> 样图已下载至本目录 `images/`（仅官方产品页截图，仅供内部设计参照）。
> **后续落地**：设计规范见 `docs/design/risk-view-design.md`，交互原型见 `viewer/prototype-risk-view.html`。
>
> **设计目标（本次调研的评判标准）**：
> 1. 能从宏观到微观多个精度级别观察跟踪项目（项目群 → 项目 → 模块 → 功能/接口）；
> 2. 宏观态折叠微观粒度事项时，**仍能看到内部微观事项的统计信息**（完成度、逾期数、健康度、趋势）。

---

## 一、样图集（已存 `images/`，均已人工目检）

### A. 宏观折叠 + 聚合统计（与设计目标最直接相关）

| 图 | 文件 | 来源 | 看点 |
|---|---|---|---|
| 项目群组合甘特 | `bryntum-portfolio.png` | [Bryntum Gantt 官网](https://bryntum.com/products/gantt/) | 多项目一屏：WBS 编号 + 项目级**汇总条**（橙/蓝/绿分色），子任务折叠时仍显示每条的完成度深浅；里程碑菱形 + `PO`/`P2` 约束芯片。宏观层"项目=一行"的同时不丢进度信息 |
| 甘特 + 资源负载网格 | `dhtmlx-screen-5.webp` | [dhtmlxGantt 官网](https://dhtmlx.com/docs/products/dhtmlxGantt/) | 上下分栏：上甘特、下资源网格。**分组行直接滚动汇总** `Complete% / Workload / Capacity`（QA 50%/71h/240h），单元格里 `10/24` 分子分母 + 红色超载标记。"折叠组 + 组内统计"的教科书式呈现 |
| 10K 任务多级汇总条 | `bryntum-bigdata.png` | 同 Bryntum | Parent/Sub-parent 两级折叠条，深色段=已完成比例；千级任务量下宏观条仍可读，证明"汇总条"方案可扩展 |
| 工作量热力图 | `ganttpro-feature-1.png` | [GanttPRO 官网](https://www.ganttpro.com/) | 行=人、列=天，格内数字=工时，颜色由绿(闲)到红(过载)。把"负载风险"编码成一眼可扫的热力矩阵 |
| Portfolio 状态 rollup 列表 | `clickup-portfolios.png` | [ClickUp](https://clickup.com/features) | 一行=一个项目：面包屑层级 + **整块状态色格**（Behind/On Track…）+ 起止/负责人；大色块远距离扫视极快 |
| Epic rollup 卡片 | `azure-rollup.png` | [Azure DevOps Delivery Plans](https://learn.microsoft.com/en-us/azure/devops/boards/plans/review-team-plans) | Epic 折叠为一张卡，卡内**按字段分列多条微型进度条**（0%/38%/14%）+ sprint 泳道 |
| 跨项目 overarching 时间线 | `openproject-overarch.png` | [OpenProject 甘特文档](https://www.openproject.org/docs/user-guide/gantt-chart/) | "Include projects"：项目行聚合子项目与里程碑成一条总览时间线；折叠后父行延续 %/日期列 |

### B. 进度/里程碑跟踪

| 图 | 文件 | 来源 | 看点 |
|---|---|---|---|
| S 曲线叠加甘特 | `bryntum-scurve.png` | [Bryntum Gantt 官网](https://bryntum.com/products/gantt/) | 蓝=计划累计进度、绿=实际累计进度两条 S 曲线**直接画在甘特背景上**，任务条内进度填充 + 依赖箭头；计划-实际偏差与排期同屏对照 |
| 汇总条进度填充（浅色） | `dhtmlx-screen-3.webp` | [dhtmlxGantt 官网](https://dhtmlx.com/docs/products/dhtmlxGantt/) | Project/Task 两级汇总条，条内深色段=完成度；叶子任务带依赖链。折叠时宏观条携带微观进度 |
| 分组配色汇总条 + 里程碑钻石 | `dhtmlx-screen-1.webp` | 同上 | 浅色版：绿/青分组汇总条含进度填充，黄钻=里程碑（Beta Release），分组色语义 |
| 汇总条进度填充（深色） | `dhtmlx-screen-4.webp` | 同上 | 同上，深色主题版本；深色下分级色依然可读 |
| 里程碑趋势分析 MTA | `tpg-mta-4.png` | [TPG: Milestone Trend Analysis](https://www.theprojectgroup.com/blog/en/milestone-trend-analysis-ms-project/) | x=报告期、y=里程碑预测日期，45° 线=完成线；每次汇报落一个点，点在线上方=里程碑后推（危险）、下方=提前、落到线=完成。**把"计划被反复改动"本身变成预警信号** |
| 里程碑=聚合容器 | `leantime-milestones.png` | [Leantime](https://leantime.io/) | 里程碑条内联 "(100.00% Done)" 完成度文字 + 负责人头像 chip + 依赖箭头；"Show Tasks" 开关一键展开任务 |
| EPIC 折叠甘特 + KPI 环 | `tapd-plan.png` | [腾讯 TAPD](https://www.tapd.cn/nwx/official/index) | EPIC/STORY/TSTORY 三级折叠；右侧详情卡（P0/工作量/进度条）；角落悬浮"工作完成率 90%"环 |
| SPI/CPI 气泡象限图 | `tpg-evm-2.png` | [TPG: Earned Value Analysis](https://www.theprojectgroup.com/blog/en/earned-value-analysis-with-microsoft-project/) | x=SPI、y=CPI、气泡=预算，绿黄红分级 + 同心环容差带；**把整个项目群折叠成一屏**的宏观健康视图（EVM 指数天然可层层加总） |
| AI 仪表盘 | `clickup-dashboard.png` | [ClickUp Dashboards](https://clickup.com/features/dashboards) | 左：AI 执行摘要（自然语言回答"项目健康吗、为什么"）；右：Sprint velocity 预测部件——当前速率 23pts vs 预测 30pts，柱+虚线预测线。宏观层的"一句话+一图"范本 |

### C. 历史与风险

| 图 | 文件 | 来源 | 看点 |
|---|---|---|---|
| 甘特 + 变更历史流 | `bryntum-versions.png` | [Bryntum Gantt 官网](https://bryntum.com/products/gantt/) | 甘特右侧挂**变更历史面板**："Resized task… / Moved task… / Saved by Amit…"每条带时间戳。与 riskdeck `events.jsonl` 只追加事件流的理念完全同构——历史可以直接变成 UI 的一等公民 |

---

## 二、开源项目管理 / 甘特图项目亮点

### 甘特图组件库

| 项目 | 出彩视图 | 宏观折叠+微观统计 | 风险能力 |
|---|---|---|---|
| **Bryntum Gantt**（商业） | **Rollups：折叠父任务后，子任务以"微缩条"贴在父汇总条上**；Summary 聚合列（子项工期/工时汇总到父行）；S-Curve 三线；10 万+任务大图 | ✅✅✅ **全场最佳**：折叠 + Rollup 微缩条 + Summary 聚合数值 + 完成百分比，四种"折叠后统计"手段齐备 | ✅✅✅ 关键路径、多 baseline、TodoLine 今天线、约束冲突、资源过载直方图 |
| **dhtmlxGantt**（GPL+商业） | 10 级时间缩放（分钟→年、多层表头）；Critical Path 一键红链；Baseline 叠加（条下挂基线子条）；Progress Line（从今天向右的动态期望进度折线） | ✅✅ WBS 树折叠，父行自动汇总为 summary bar | ✅✅ 关键路径/baseline/deadline/约束/进度线——风险全家桶 |
| **frappe/gantt**（~5.4k★） | 极简美感：渐变圆角条+曲线依赖+菱形里程碑；条内进度内条；`show_expected_progress` 期望进度线 | ❌ 仅 Day/Week/Month/Year 缩放，无折叠聚合 | ❌ 仅"实际 vs 期望进度"弱信号 |
| jQuery Gantt（twproject） | 经典主从双栏；进度黑色覆线画在条顶；底部"last change by…"审计条 | ✅ 树折叠、父行聚合 %/工期列 | ✅ 关键路径开关、状态色点 |

来源：[Bryntum 产品页](https://bryntum.com/products/gantt/) · [Rollups 文档](https://bryntum.com/products/gantt/docs/api/Gantt/feature/Rollups) ｜ [dhtmlxGantt](https://dhtmlx.com/docs/products/dhtmlxGantt/) · [关键路径](https://docs.dhtmlx.com/gantt/desktop__critical_path.html) · [baseline](https://docs.dhtmlx.com/gantt/desktop__baselines.html) · [zoom](https://docs.dhtmlx.com/gantt/desktop__zoom.html) ｜ [frappe/gantt](https://github.com/frappe/gantt) · [demo](https://frappe.io/gantt) ｜ [jQuery Gantt demo](https://gantt.twproject.com/)

### 开源 PM 工具

| 产品 | 出彩视图 | 宏观折叠+微观统计 |
|---|---|---|
| **OpenProject** | 甘特与 work package 表格一体（年/季/月二级表头、auto-zoom）；Collapse all 折叠树、父行汇总条；**"Include projects" 跨项目 overarching 时间线（项目行聚合子项目/里程碑）**；Baseline Comparison 两次快照逐字段差值表（EE） | ✅✅ 项目级汇总行 + 折叠后父行仍显示 % 完成/日期列 |
| **Leantime** | **里程碑=聚合容器**：彩色里程碑条内联 "(100.00% Done)" 完成度文字 + 负责人头像 chip + 依赖箭头；**"Show Tasks" 开关把里程碑一键展开为其任务** | ✅ 里程碑级折叠 + 完成 % 内联，对非职业 PM 友好 |
| **Plane**（~45k★） | Gantt 布局在项目/Cycle/Module/View 四处可用；FS/SS/FF 依赖连线可拖拽；里程碑进度指示器聚合关联工作项进度 | ✅ Cycle/Module 即聚合层（进度%、状态），下钻看微观条 |
| **Vikunja** | 新版甘特：可拖拽 Date Range 任意扩展观察窗；完成度以条内渐变淡化表达（最优雅）；今日列高亮 | ❌ 仅月/日两级，无折叠 |
| Taiga / Focalboard / AppFlowy / Huly | 均无成熟甘特/时间轴（Taiga 官方确认不做）；Focalboard 分组折叠卡片计数 chips 可小借鉴 | — |

来源：[OpenProject 甘特](https://www.openproject.org/gantt-chart/) · [文档](https://www.openproject.org/docs/user-guide/gantt-chart/) · [baseline 对比](https://www.openproject.org/docs/user-guide/work-packages/baseline-comparison/) ｜ [Leantime 里程碑图](https://assets.leantime.io/wp-content/uploads/2025/03/leantime-milestones-gantt-chart-project-progress-2048x1152.png) ｜ [Plane 依赖](https://docs.plane.so/core-concepts/issues/timeline-dependency) · [里程碑](https://docs.plane.so/core-concepts/projects/milestones) ｜ [Vikunja 视图](https://vikunja.io/help/views/) · [zoom 讨论](https://community.vikunja.io/t/gantt-chart-zoom-levels-and-ability-to-extend-the-visible-range/4772)

### 图表语法 / 可视化库
- **Mermaid gantt**：`crit` 状态=红+斜纹（内置"风险/关键"色语义，值得直接抄进设计 token）；done 灰 / active 蓝；milestone 菱形。[文档](https://mermaid.js.org/syntax/gantt.html)
- **AntV G2 甘特配方 / G6 TimeBar**：时间轴刷选控件可作"时间窗筛选/回放"组件借鉴。[G2](https://g2.antv.antgroup.com/charts/gantt) · [TimeBar](https://g6.antv.antgroup.com/examples/feature/timebar/)

### 跨项目共性观察（开源侧）
1. **缩放是标配，聚合是稀缺**：几乎都有日→年缩放；但"折叠后父行仍显示聚合统计"只有 Bryntum（Rollups 微缩条+Summary 列）、OpenProject（汇总行+列延续）、Leantime（内联完成%）三家真正做到。
2. **风险三大件 = 关键路径 / baseline / 进度偏差**，只有 dhtmlxGantt 与 Bryntum 是"全家桶"；开源 PM 工具普遍缺位。
3. **"今天线"+今日列高亮**是全行业统一模式；进度统一用"条内深色内条"或"右侧渐变淡化"。
4. **最值得抄的组合**：Bryntum Rollup（折叠父条贴子任务微条）+ dhtmlx Progress Line（今天向右的期望进度斜线）+ OpenProject 跨项目 overarching 汇总行 + Leantime 里程碑内联 "(100.00% Done)" + Mermaid 的 crit 红斜纹风险色。

---

## 三、商业产品亮点视图

### 国外

| 产品 | 标志性视图 | 要点 |
|---|---|---|
| **Monday.com** | Dashboard 多 widget 拼装（Chart/Battery/Numbers/Workload）；Battery 电量隐喻进度、低电量变色；Workload 人×日热力 | 多 board 聚合进同一 dashboard，widget 点击下钻 |
| **ClickUp** | Dashboards（燃尽/velocity/CFD 可按 assignee 拆分）；Workload 容量热力；**Portfolio 多项目状态+进度 rollup 卡片** | 折叠态摘要=数字卡+状态色块，点击进项目 |
| **Asana** | **Portfolio 状态 rollup 列**：On track/At risk/Off track 色点 + 进度% + 到期日 + 负责人；Workload 双模式（effort/balanced）可拖拽改派；里程碑菱形嵌入 Timeline | 宏观列表即"项目群仪表盘" |
| **Linear** | Insights 自定义仪表盘（scope change/cycle time/velocity）；Roadmap 项目卡自动按 issue 完成度算进度条+目标日+健康状态 | 聚合进度全自动，无人工维护 |
| **Smartsheet** | Sheet summary 字段→summary report 把多 sheet 汇成 portfolio；2024 新增 Portfolios 健康度 rollup + **Scenario Planning what-if 情景推演** | "字段上抛→汇总报表"的机制设计 |
| **Wrike** | Gauge 指针仪表卡超阈值变红；官方 library 有"风险登记表+风险 Dashboard"最佳实践手册 | 风险登记册+仪表盘的模板化 |
| **GanttPRO**（甘特类最出彩） | Portfolio view 多项目同时间线，**项目折叠为单 bar（含里程碑菱形+进度%）展开即任务甘特**；Critical path 红链；Baseline 计划/实际偏差条；Workload 热力 | 宏观↔微观主骨架的成熟实现 |
| **Jira Plans** | initiative→epic→story 三级折叠跨项目时间线；velocity 容量泳道；依赖冲突标红；Scenario 方案对比 | 三级折叠 + 容量泳道 |
| **Azure DevOps Delivery Plans** | 多团队 sprint 泳道；**字段准则（field criteria）自动给风险/逾期卡片着色**；**rollup view 行尾聚合计数/effort** | "规则驱动着色 + 行尾聚合列"最工程化 |
| **MS Project** | Summary task 汇总条（子项里程碑自动 rollup）；Critical path 红色（Total Slack=0）；燃尽内置报表 | 汇总条鼻祖 |
| **LiquidPlanner** | ranged estimates + **蒙特卡洛输出置信度完成日期**，按风险概率着色 | 概率化承诺的标杆 |

### 国内

| 产品 | 标志性视图 | 要点 |
|---|---|---|
| **飞书项目** | 甘特图节点子项排期展开（项目→里程碑→工作项）；树形多级折叠；度量/仪表盘"视图控件"联动指标 | [官网](https://project.feishu.cn/) · [度量文档](https://meego-hc.larkoffice.com/b/helpcenter/1ykiuvvj/21cesx3i) |
| **腾讯 TAPD**（风险能力最明确） | 项目仪表盘卡片式自由布局（数字指标/公告/图表可缩放拖拽）；甘特图；燃尽+工时统计；**官方文案"风险节点自动预警""按历史数据预测迭代风险"** | [仪表盘](https://www.tapd.cn/official/article_detail/1139987004001001082) · [全生命周期/风险预警](https://www.tapd.cn/official/article_detail/1139987004001001140) |
| **ONES** | 进度管理专页：里程碑、甘特计划-实际对比、项目仪表盘与绩效度量 | [ones.cn/schedulemanagement](https://ones.cn/schedulemanagement) |
| Teambition / PingCode / Worktile | 项目仪表盘（完成度/燃尽/负载）、甘特与里程碑、进度 rollup | [Teambition](https://www.teambition.com/) · [PingCode](https://pingcode.com/) · [Worktile](https://worktile.com/) |

### 值得 riskdeck 借鉴的 Top 10（商业侧）
1. **Portfolio 折叠甘特**（GanttPRO/Jira Plans）——宏观↔微观主骨架
2. **Asana Portfolio 状态 rollup 列**（色点+进度%+到期+负责人，点击下钻）
3. **Azure field criteria + rollup view**（规则驱动着色 + 行尾聚合计数/工作量）
4. **Workload 人×日热力**（Monday/ClickUp/Asana，格子点击见任务）
5. **Baseline vs 实际偏差条**（GanttPRO/MS Project/ONES，延期=两线夹缝）
6. **Critical path 红链 + 非关键降透明度**（GanttPRO/MS Project）
7. **燃尽 sparkline 卡 + 预测完成日**（ClickUp/TAPD，放折叠态摘要行）
8. **Gauge 阈值仪表卡**（Wrike，过阈值变红）
9. **风险登记册+风险仪表盘模板**（Wrike/TAPD）
10. **延期预测**：LiquidPlanner 蒙特卡洛为标杆；riskdeck 可用"里程碑偏移+事件速率"做轻量预测替代

---

## 四、可视化模式手册（九种模式 + 组合建议）

### 1. 里程碑趋势分析 MTA（Milestone Trend Analysis）
- **形态**：x=报告期（周/月快照），y=里程碑计划日期所在的项目时间轴；每次汇报落点并连成阶梯折线；45° 对角线=完成线，叠加"今日/状态日"竖线。
- **怎么看**：水平线=日期未动；上行=里程碑后推（危险信号）；下行=提前；落到 45° 线=已完成。趋势线相对今日线的斜率即缓冲消耗速度。
- **解决的问题**：把"计划被反复改动"变成历史+预测合一的早期预警曲线，适合多项目并排。
- **宏观/微观**：每条线是该里程碑完整历史；折叠后每项目只剩"上/平/下"走势符号。
- 来源：[TPG MTA 图解](https://www.theprojectgroup.com/blog/en/milestone-trend-analysis-ms-project/) · [Wikipedia (DE)](https://de.wikipedia.org/wiki/Meilensteintrendanalyse) · 样图 `tpg-mta-4.png`

### 2. EVM 挣值 S 曲线
- **形态**：x=时间，y=累计成本/工时；PV(BCWS)、EV(BCWP)、AC(ACWP) 三曲线，状态日后接虚线 forecast（EAC=AC+(BAC−EV)/CPI，MS Project 采用此式）；读数 SPI=EV/PV、CPI=EV/AC。
- **解决的问题**：一张图同时回答"进度快慢+成本高低"，并量化完工预测。
- **宏观/微观**：EV/指数天然可加和，module→project 层层汇总不失真；TPG 建议把指数分档为红黄绿灯，或气泡图（x=SPI, y=CPI, 气泡=预算）折叠整个组合。
- 来源：[TPG EVA 详解](https://www.theprojectgroup.com/blog/en/earned-value-analysis-with-microsoft-project/) · [Wikipedia: EVM](https://en.wikipedia.org/wiki/Earned_value_management)

### 3. 蒙特卡洛 S 曲线 + 龙卷风图
- **形态**：x=完工日期（或成本），直方=频数、折线=累积概率；P10/P50/P90 竖线 + 目标日期线，目标与确定性值之间标注 contingency；另有 Schedule & Cost 散点图联动双维。龙卷风图：水平条由最低到最高估计，按对完工影响降序排列。
- **解决的问题**：把单点计划换成概率承诺（"80% 把握的日期"）；龙卷风图指示先治哪个风险/活动。
- **宏观/微观**：聚合时只上抛 P 系数与方差；置信带宽度本身就是不确定度的折叠度量。
- 来源：[Oracle Primavera Cloud 风险分析（官方文档，含 S 曲线与龙卷风）](https://docs.oracle.com/cd/E80480_01/help/en/user/162022.htm) · [Wikipedia: Tornado diagram](https://en.wikipedia.org/wiki/Tornado_diagram)

### 4. 风险矩阵热力图 + 气泡图
- **形态**：矩阵 x=影响、y=概率，5×5 格绿→红渐变，格内放计数或风险 ID；气泡图 x=概率、y=影响，气泡大小=暴露值（概率×影响×成本），颜色=状态。
- **解决的问题**：一屏排序全部风险；气泡大小让"低频高损"与"高频低损"可直接比较（PMBOK 定量风险分析标准呈现）。
- **宏观/微观**：格内聚合计数即微观折叠，点击格下钻风险列表。
- 来源：[Wikipedia: Risk matrix](https://en.wikipedia.org/wiki/Risk_matrix) · [ICAEW: Risk Bubble Charts](https://www.icaew.com/technical/technology/Excel-community/Excel-community-articles/2022/risk-bubble-charts-part-1)

### 5. 燃尽/燃起图 + 累积流图 CFD
- **形态**：燃尽 x=天、y=剩余量，理想线 vs 实际线；CFD 用堆叠面积图画 Done/In Progress/To Do 时间带，带间垂直距离=WIP，Done 带斜率=吞吐率。
- **解决的问题**：燃尽答"能否按期清零"；CFD 暴露瓶颈与 WIP 膨胀，可外推完成日期。
- **宏观/微观**：多模块燃尽线可缩为 sparkline 并排；CFD 可折叠为总吞吐/总 WIP 两条带。
- 来源：[Atlassian: Burndown](https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-burndown-chart/) · [Atlassian: CFD](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-cumulative-flow-diagram/)

### 6. GitHub 贡献日历式"活跃度/风险密度"热图
- **形态**：列=周、行=周一~周日的小方格，5 档颜色由浅到深编码当日计数，hover tooltip，less→more 图例。
- **解决的问题**：极低认知成本呈现节奏与断档——连续深格=风险积压期，空白=停滞。
- **宏观/微观**：把 commit 计数换成"当日新增 at-risk/missed 数"即可复用；行级可用 52 格年历嵌进项目行。
- 来源：[GitHub Docs: Contributions](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile)

### 7. 层级聚合：treemap / sunburst / icicle
- **形态**：treemap 递归矩形，面积=节点 value（工作量），颜色=健康度，squarified 平铺接近黄金比；sunburst/icicle 以环/列表达同样编码。D3 需先 `root.sum()` 再布局，提供 squarify/slice-dice/binary 平铺。
- **解决的问题**：project→module→feature→interface 四层一屏尽收，面积直觉回答"风险藏在哪个体量里"。
- **宏观/微观**：本身就是"面积折叠+颜色统计"原型，点击子树即放大。
- 来源：[D3 treemap 官方文档](https://d3js.org/d3-hierarchy/treemap) · [Observable: Zoomable treemap](https://observablehq.com/@d3/zoomable-treemap)

### 8. 语义缩放 / 多精度观察模式
- **组合手法**：(a) zoomable treemap/sunburst 点击子树平滑放大+面包屑回退；(b) overview+detail 双栏联动（Cockburn 综述三分类之一）；(c) 甘特汇总条：MS Project Summary Task 把子任务折叠为括号条并汇总日期/进度，展开即明细（dhtmlxGantt 同型 project task）；(d) 时间轴年/季/月/周分级刻度，随缩放切换 tick 粒度；(e) fisheye 焦点+上下文。
- **解决的问题**：在全景健康度与单接口排期间无级切换而不丢上下文。
- 来源：[Cockburn et al. 综述 (TVCG 2009)](https://www.semanticscholar.org/paper/A-review-of-overview%2Bdetail%2C-zooming%2C-and-Cockburn-Karlson/7446295df4e90a427edbfc8cbd789e27478fbc7e) · [MPUG: Project Summary Task](https://mpug.com/display-the-project-summary-task)

### 9. 风险燃尽 + 行内 sparkline
- **形态**：风险燃尽 x=迭代/周，y=未关闭风险数（或暴露值总和），理想下降线+实际线；sparkline 为 20~120px 无轴微型折线，嵌表格行尾，配末值数字与红黄绿点。
- **解决的问题**：燃尽答"风险治理是否有效"；行内 sparkline 让每行携带自身 12 周趋势，列表即仪表盘（Stephen Few 的标准做法）。
- **宏观/微观**：最典型的"折叠但保留统计"微件——一列 sparkline 即全组合趋势矩阵。
- 来源：[PMI Disciplined Agile: Risk Burndown](https://www.pmi.org/zh-cn/store/sitecore/content/microsites/disciplined-agile/agile/riskburndown) · [Few: Best Practices for Scaling Sparklines (PDF)](http://www.perceptualedge.com/articles/visual_business_intelligence/best_practices_for_scaling_sparklines.pdf)

### 组合建议：宏观层微件叠加
1. **顶层 KPI 条**：红黄绿计数（at-risk/missed/逾期接口数）+ 总进度环 + 进度指数徽章。
2. **每行/每卡微件**：进度条带（planned 灰底 + actual 前景 + 今日竖线）、里程碑四态点串（planned ○ / at-risk ◐ / hit ✓ / missed ✗）、12 周 sparkline、预测完成日相对承诺日期的 Δ 天。
3. **默认宏观视图**：可缩放 treemap（面积=工作量、颜色=健康度），节点上叠 3~5 格迷你热图表示近期风险密度。
4. **趋势页按数据成熟度三选一**：MTA（仅里程碑历史）→ EVM S 曲线（有基线/成本）→ 蒙特卡洛置信带（可对外承诺）。
5. **下钻链路**：热力格/矩阵格 → 模块列表（行内 sparkline）→ 甘特汇总条展开 → interface 明细；所有聚合格支持点击下钻，保证"折叠不失真、展开有统计"。

---

## 五、对 riskdeck 的落地建议（映射到现有数据模型）

> 🧪 **可交互原型**：`viewer/prototype-risk-view.html`（双击打开，或 `?variant=A|B|C` 直达；←/→ 切换）。
> 三种结构方案：A 驾驶舱泳道 / B 风险矩阵气泡 / C 时间泳道热力，mock 数据与 entities/events 同构。

riskdeck 已有：四级层级（project→module→feature→interface）、双轴状态（design×impl）、依赖边表、里程碑四态（planned/at-risk/hit/missed）、append-only 事件流。以上参照物几乎都能**直接从现有数据推导**，不需要新增采集负担：

1. **层级时间线（甘特）+ 汇总条**：折叠 project/module 时渲染汇总条——条内进度填充 = 子树 impl(done+verified) 加权完成度（权重=子叶数或里程碑数）；条两端放里程碑四态点串。左列 grid 加三个聚合列：完成度%、at-risk 数、逾期里程碑数。参照 `bryntum-portfolio.png`、`dhtmlx-screen-5.webp`。
2. **健康度 treemap**（宏观首页候选）：面积=子树规模，颜色=健康度（at-risk/missed 占比渐变），点击子树 zoomable 下钻+面包屑；节点内叠 3~5 格"近 4 周事件密度"迷你热图。数据全部来自 entities+events 滚动汇总（store 已有滚动汇总）。
3. **里程碑四态轨道 + MTA**：每 project 一行横向轨道，菱形按日期排布四态着色；对关键里程碑追加 MTA 折线（历史日期来自 events 里 milestone 变更事件，天然满足"每次快照一个点"，无需新采集）。
4. **事件流热力日历 + 行内 sparkline**：events.jsonl 按 node×日 聚合 → GitHub 式 52 格年历（编码=事件密度或风险事件数）；列表页每行行尾嵌 12 周 sparkline。宏观列表立刻"每行都带趋势"。
5. **风险传播着色（依赖图）**：图已有环检测和枢纽统计；在此基础上把"直接 at-risk/missed"与"依赖了风险节点的间接风险"分两级着色（实心/描边），宏观上立刻看出风险沿依赖链的扩散面。
6. **双轴状态矩阵**：design(4 态) × impl(5 态) 的计数热力矩阵作为项目级统计卡——每格显示接口数，点击下钻到节点列表。这是 riskdeck 独有数据的最自然宏观视图。
7. **顶层 KPI 条**：红黄绿计数（at-risk/missed 里程碑、逾期无证据节点）、总进度环（双轴加权）、"承诺日 − 预测日" Δ 天数徽章（预测=滚动速率外推，参考 ClickUp velocity 部件）。
8. **多精度切换骨架**：时间线刻度 年/季/月/周 随缩放自适应；treemap（宏观）↔ 时间线（中观）↔ Peek 详情（微观）三档默认档位，配合已有 ⌘K/Peek 形成完整下钻链路；所有聚合格点击可下钻。

---

## 六、本地样图来源索引

| 文件（`images/`） | 来源页面 |
|---|---|
| `bryntum-portfolio.png` / `bryntum-scurve.png` / `bryntum-bigdata.png` / `bryntum-versions.png` | https://bryntum.com/products/gantt/ |
| `dhtmlx-screen-1.webp` / `dhtmlx-screen-3.webp` / `dhtmlx-screen-4.webp` / `dhtmlx-screen-5.webp` | https://dhtmlx.com/docs/products/dhtmlxGantt/ |
| `ganttpro-feature-1.png` | https://www.ganttpro.com/ |
| `clickup-dashboard.png` | https://clickup.com/features/dashboards |
| `clickup-portfolios.png` / `clickup-workload.png` | https://clickup.com/features |
| `azure-rollup.png` / `azure-plans.png` | https://learn.microsoft.com/en-us/azure/devops/boards/plans/review-team-plans |
| `tapd-plan.png` | https://www.tapd.cn/nwx/official/index |
| `leantime-milestones.png` | https://leantime.io/ |
| `openproject-overarch.png` / `openproject-collapse.png` / `openproject-baseline.png` | https://www.openproject.org/docs/user-guide/gantt-chart/ |
| `frappe-gantt.png` | https://github.com/frappe/gantt |
| `vikunja-gantt.png` | https://vikunja.io/help/views/ |
| `plane-deps.webp` | https://docs.plane.so/core-concepts/issues/timeline-dependency |
| `dhtmlx-scales.png` | https://dhtmlx.com/docs/products/dhtmlxGantt/ |
| `tpg-mta-4.png` / `tpg-evm-2.png` | https://www.theprojectgroup.com/blog/en/ （MTA / EVA 两篇） |
| `monday-dashboards.png` / `jira-plans.webp` / `linear-insights.jpg` / `smartsheet-ppm.jpg` / `ones-schedule.png` | 对应官网（见第三节链接） |

> 所有截图版权归原作者所有，仅作内部设计参照；未逐张目检的图（openproject-*、frappe、vikunja、plane、dhtmlx-scales、monday、jira、linear、smartsheet、ones）描述以来源方官方文案为准。
