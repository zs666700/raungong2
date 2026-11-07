# 活动智囊 · 第一轮验收报告（用例 1–6）

- 执行日期：2026-11-07
- 环境：`pnpm mock`（devmock，127.0.0.1:8082）、`pnpm dev`（Vite，127.0.0.1:5173）、`node devmock/seed-demo.mjs`
- 浏览器：Playwright-core + 本机 Microsoft Edge，headless
- Mock 状态：用例 1 开始前启动，**本轮 0 次重启**；seed-demo 在启动后执行一次（`evidence/00-mock-state.json`）
- 约束：未修改 `src/` 与 `devmock/`；测试脚本放在 `docs/test-runs/2026-11-07/scripts/`
- 原始结果：`evidence/results-round1.json`；控制台/网络异常：`evidence/99-console-errors.json`
- 说明：第一版脚本在用例 6 把 `version` 从预算合计对象里读，导致一次测试脚本 FAIL；修正后重跑，应用侧无改动。下表的“实际”为最终重跑结果。

## 1. 用例执行表

| ID | 来源 | 步骤 | 预期 | 实际 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| 1 | 11.1 A1 | ① 匿名调 `GET /api/v1/plans`、`GET /api/v1/plans/{id}`；② 匿名打开 `/plans`；③ 登录；④ 匿名打开 `/plans/{id}`；⑤ 登录；⑥ 写入失效 token 后访问 `/` | 两个 API 均 401；浏览器跳登录；登录后详情回到原 `/plans/{id}`；失效 token 跳登录 | API 列表 401、详情 401；浏览器 `/plans -> /login?redirect=/`，登录后 `/`；`/plans/{id} -> /login?redirect=/plans/{id}`，登录后原详情；失效 token -> `/login?redirect=%2F&expired=1` | **PASS** | `evidence/01-unauth.json`；`screenshots/01-unauth-plans-login.png`、`01-unauth-detail-login.png`、`01-after-login-detail.png`、`01-expired-token-login.png` |
| 2 | 11.1 A2 | 注册新账号；`/plans/new` 填「迎新晚会 / 迎新晚会类型 / 100 人 / 2000 元 / 默认一周后 19:00 / 学校礼堂」；记录 `POST /api/v1/plans/generate` 请求 | 202；请求体字段正确；不发送 `template_id` | 202；字段：`theme, activity_type(welcome_party), participants(100), budget_yuan(2000), starts_at(2026-11-14T11:00:00Z，本地 19:00), duration_minutes(120), location, tone, target_audience`；`template_id=false`；带 `Idempotency-Key` | **PASS** | `evidence/02-generate-request.json`；`screenshots/03-generating-processing.png` |
| 3 | 11.1 A2 / 前端 README 联调自检 | 提交后进入进度页；观察未知阶段文案；读取 `sessionStorage`；刷新；等待自动进入详情 | 202 -> 轮询 -> 详情；未知 stage 显示「处理中」；刷新后 `plan-task:{planId}` 仍在并继续轮询 | 202；5 次轮询；「处理中」已观察；storage 前=`8a11bec0-...`，刷新后相同；最终进入 `/plans/2c04ddd8-...` | **PASS** | `evidence/03-generation.json`；`screenshots/03-generating-processing.png`、`03-detail-after-reload.png` |
| 4 | 11.1 A3 | 详情页读取 10 个导航标签；逐节点击并截图；调 `GET /plans/{id}` 核对 `content` | 10 章节全部渲染；10 章节可映射为 6 部分 + 警告与假设 | 导航：活动概览/筹备阶段/当晚流程/预算/物资/分工/宣传/风险/复盘/警告与假设；逐节渲染=true；`plan/materials/tasks/promotion/risks/review` 均在；materials 10、tasks 12、risks 6、assumptions 3 | **PASS** | `evidence/04-sections.json`；`screenshots/04-section-01..10-*.png` |
| 5 | 11.1 A7 | 详情「物资」记录初始值；第一项数量 1 -> 3；保存；对比 PATCH 响应与页面；查看预算合计 | 页面小计与物资汇总取自服务端；`version+1`；`items_total_yuan / planned_yuan` 按预算节数据核对 | 服务端小计 `¥ 1,080.00`，页面 `¥ 1,080.00`；服务端汇总 `¥ 2,306.97`，页面 `¥ 2,306.97`；version v1 -> v2；预算明细合计 `¥ 1,559.97` 不变、计划合计 `¥ 1,719.97` 不变 | **PASS**（附口径说明 F1） | `evidence/05-materials.json`；`screenshots/05-materials-before/editing/after.png`、`05-budget-before/after-materials-edit.png` |
| 6 | 11.1 A7 / README 联调自检 | demo_studio 登录；新建「预算合计验证」120 人 / 3600 元；预算编辑；预备金 500；保存 | 服务端 `items_total=2808`、`planned=3308`；页面计划合计 `¥ 3,308.00`；version+1 | 新建返回 202；服务端 `items_total=2808`、`contingency=500`、`planned=3308`；页面 `¥ 3,308.00`；version v1 -> v2；重新 GET 仍为 3308 | **PASS** | `evidence/06-budget.json`；`screenshots/06-budget-before/editing-contingency-500/after.png` |

### 每个用例开始前的 Mock 状态

6 个用例全部 `mockRestartedBeforeCase: false`；`evidence/00-mock-state.json` 记录 `restartsDuringRound: 0`，`mock.log` 只有一次 `[mock] ... 已启动`。因此本轮“刷新后修改仍在”只在同一 devmock 进程内成立，重启即清空；不能据此判断生产持久化。

## 2. 缺陷清单

**本轮未发现应用代码缺陷。** 以下为需要确认的口径差异与覆盖限制，不计为已确认缺陷：

| 编号 | 级别 | 现象 | 证据 | 影响 / 处理建议 |
|---|---|---|---|---|
| F1 | 中（口径待确认） | 修改物资数量后，物资汇总 `summary.estimated_cost_yuan` 从 1,586.97 更新为 2,306.97；但预算节的 `items_total_yuan` 仍为 1,559.97、`planned_yuan` 仍为 1,719.97，没有联动 | `evidence/05-materials.json` | 数据契约中 `materials` 与 `plan.budget` 是两个独立 section，PATCH materials 只返回 materials 数据。若验收 A7 的“总计”指预算计划合计，应判不满足；若指物资汇总，则通过。需确认口径。 |
| F2 | 低（路由归一） | 前端没有 `/plans` 列表路由；匿名访问 `/plans` 被 catch-all 归一到 `/`，登录参数为 `redirect=/`，登录后回 `/`，不会回到字面上的 `/plans` | `evidence/01-unauth.json` | README 定义列表路由为 `/`，按 README 属预期；若验收要求 `/plans` 原样回跳，需要额外路由或重定向映射。 |
| F3 | 提示（覆盖限制） | “阶段未知显示处理中”是通过 Playwright 改写任务轮询响应（`stage=mystery_stage, message=''`）触发的；devmock 原生流程在该时刻返回 `stage=planning`，不会自然出现未知阶段 | `evidence/03-generation.json` | UI 分支已验证，但不能据此声称 devmock 会自然产生该状态；真实后端未知 stage 场景需后端配合造数据。 |
| F4 | 提示（环境） | devmock 是内存存储，本轮未重启；刷新持久化只在同一进程成立 | `evidence/00-mock-state.json` | Mock 重启即清空，不能作为持久化验收依据；持久化见第二轮之外的 PostgreSQL 移交项。 |
| F5 | 提示（预期噪声） | `case1-expired` 有 1 条 401 console error；`case6` 有页面跳转时的 `net::ERR_ABORTED` | `evidence/99-console-errors.json` | 401 是失效 token 用例的预期结果；ABORTED 是导航/关闭页面导致，不是应用异常。 |

## 3. 覆盖总结

### 本轮通过率

- 第一轮计划执行 6 项：**6/6 PASS（100%）**。
- 页面截图：`screenshots/` 下 26 张；报文与断言：`evidence/` 下 10 个 JSON。

### N/A 项依据（前端不适用，不找入口、不判缺陷）

| 项 | 依据（README） |
|---|---|
| A11 的「复制、删除」 | L116：「未实现的功能不出现入口：删除、复制……」 |
| A12「另存为模板、用模板新建」 | L116 同上「模板」 |
| T15「PDF 未启用 -> 501」 | L116「服务端 PDF」；L177「当前后端没有 PDF 接口，打印页使用浏览器打印能力」 |
| T17「复制方案」、T18「软删除」 | L116「删除、复制」；前端无入口。后端接口级可另测，但不属于前端缺陷 |
| 版本历史、恢复版本、单节重新生成、取消生成、归档 | L116 同句列出；不在 A/B/C 三份清单中，无对应执行行 |

### 需真实后端或运维的移交项（本轮未执行）

| 项 | 原因 |
|---|---|
| B1 10 并发生成 | devmock 单进程内存，不能代表 FastAPI BackgroundTasks + SQLite/PostgreSQL 并发 |
| B3 API Key 不出现在 bundle/Git/日志 | 需要生产构建、Git 历史扫描和后端日志/密钥扫描 |
| B4 P95 ≤ 120s（5 次采样） | devmock 约 3 秒，真实 LLM 延迟无法在 Mock 上代表 |
| B5 服务重启后历史仍在（PostgreSQL） | Mock 重启必清空；本地 SQLite 也不能替代生产 PostgreSQL 验证 |
| T08 智能体超时 -> `AGENT_TIMEOUT` | 需要真实智能体/可控 stub；默认 `ENABLE_FALLBACK=true` 会降级为成功，且 LangGraph 超时映射为 `AGENT_UPSTREAM_ERROR` |
| T09 非法 JSON 修复/降级 | devmock 永远返回合法内容，需要后端 stub 或真实模型 |
| T11 超预算 10% 触发重试 | 后端目前只追加 warning，未实现 10% 重试 |
| A4/A5/A6 真实 LLM 内容质量 | Mock/fixture 满足字段、条数、预算；后端 validator 不强制校验每项字段/风险条数/预算上限，真实模型输出需另测 |
| A13 真实超时/非法 JSON 失败态 | devmock 只支持主题含“失败”的 `MOCK_GENERATION_FAILED`，不模拟 `AGENT_TIMEOUT`/非法 JSON |
| B6 健康检查返回数据库与智能体状态 | 真实后端 `/healthz` 无数据库状态；devmock 连 agent 字段都没有；需接口级另测 |

### 第二轮待执行

- 前端可测：7（409 双标签页）、8（导出 Markdown）、9（打印 A4）、10（失败态 `AGENT_TIMEOUT`/非法 JSON）
- 仅接口级：T01、T02、T04、T07、T10、T14、T15、T16、T17、T18

## 附：本轮可复现命令

```bash
pnpm mock                 # 8082
pnpm dev                  # 5173
node devmock/seed-demo.mjs
node docs/test-runs/2026-11-07/scripts/run-round1.mjs
```

`run-round1.mjs` 依赖 `docs/test-runs/2026-11-07/scripts/node_modules/playwright-core`（测试目录内安装，不进入项目依赖）。
