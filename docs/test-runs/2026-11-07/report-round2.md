# 活动智囊 · 第二轮验收报告（用例 7–10 + 接口级）

- 执行日期：2026-11-07
- 环境：`pnpm mock`（devmock 8082）、`pnpm dev`（Vite 5173）、Playwright-core + Edge
- Mock 状态：**本轮 0 次重启**（仍为第一轮同一进程，`evidence/20-mock-state-round2.json`）
- 真实后端补测：临时启动 `127.0.0.1:8083`，使用 `evidence/round2-backend.db` 临时 SQLite；测试完成后已停止。
- 约束：未修改 `src/` 与 `devmock/`；只新增 `docs/test-runs/2026-11-07/` 下的脚本与证据。
- 环境事故：第一轮执行 7–10 时 Vite 因监听正在写入的 `08-export.md` 报 `EBUSY` 退出；重启 Vite 并将下载/PDF 先写临时目录后复制，7–10 重跑全部通过。记录见 `evidence/vite-ebusy-incident.txt`，不是应用缺陷。

## 1. 用例执行表

### 前端可测（7–10）

| ID | 来源 | 步骤 | 预期 | 实际 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| 7 | 11.1 A8 | 同一用户两个标签页同时编辑物资；A 先保存；B 用旧 version 保存；点击「载入最新版本」 | A 200 且 version+1；B 409 `VERSION_CONFLICT`；弹窗提示并载入最新；内容不被 B 覆盖 | A=200 v2；B=409 `VERSION_CONFLICT` `current_version=2`；弹窗含「当前版本为 v2」「版本冲突」；B 重载后 v2，第一项数量=2 套（A 的值） | **PASS** | `evidence/07-conflict.json`；`screenshots/07-conflict-dialog.png`；`screenshots/07-after-conflict-reload.png` |
| 8 | 11.1 A9 | 详情页点击 Markdown；捕获下载与 `/export` 响应；读取文件 | 200、`text/markdown`；`filename*` 中文文件名；UTF-8 无乱码且含全部章节 | 200；`text/markdown; charset=utf-8`；文件名 `409 冲突用例 804624活动方案.md`；14 个 `##` 标题；含活动概览/物资清单/任务分工/宣传方案/风险与复盘；无替换字符 | **PASS** | `evidence/08-export.json`；`evidence/08-export.md`；`screenshots/08-export-page.png` |
| 9 | 11.1 A10 | 打开 `/plans/{id}/print`；print media；680px 近似 A4 内容宽度；检查表格；生成 A4 PDF | 10 章节；表格无横向溢出；PDF 为 A4 | 10 章节；溢出表=0；`scrollWidth/clientWidth=680/680`；PDF 1,725,775 B、15 页、MediaBox `594.95996 × 841.91998`（A4） | **PASS** | `evidence/09-print.json`；`evidence/09-print.pdf`；`screenshots/09-print-a4-794.png`；`screenshots/09-print-a4-content-680.png` |
| 10 | 11.1 A13 | 新建两个方案；分别拦截任务响应为 `AGENT_TIMEOUT` 与 `AGENT_OUTPUT_INVALID`；检查错误码与重试入口 | 页面显示对应错误码 + 可重试；重试入口可用 | `AGENT_TIMEOUT · 可重试`，按钮可见；`AGENT_OUTPUT_INVALID · 可重试`，按钮可见；点击后进入 `/plans/new` | **PASS** | `evidence/10-failure.json`；`screenshots/10-failure-timeout.png`；`screenshots/10-failure-invalid-json.png` |

> 用例 10 的两个错误码由 Playwright 改写 `GET /tasks/{id}` 响应触发；devmock 原生只支持主题含“失败”的 `MOCK_GENERATION_FAILED`。这是 UI 分支验证，不是 devmock 自然行为。

### 接口级（devmock 8082；T17/T18 用真实后端 8083）

| ID | 来源 | 步骤 | 预期 | 实际 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| T01 | 16.2 | 同一用户名连续注册两次 | 409 `USERNAME_TAKEN` | 409，但 body 为 `{"detail":"用户名已存在"}`，**无结构化错误码**；真实后端同样 | **FAIL**（契约差异） | `evidence/interface-devMock.json#T01`；`evidence/interface-real-backend.json#T01` |
| T02 | 16.2 | 错误密码；不存在账号 | 均 401，不提示账号是否存在 | 均 401「用户名或密码错误」，文案相同 | **PASS** | `evidence/interface-devMock.json#T02` |
| T04 | 16.2 | A 创建方案；B 读取 A 的方案/任务/列表 | 404；B 列表为空 | B 读方案 404、读任务 404；B 列表 total=0 | **PASS** | `evidence/interface-devMock.json#T04` |
| T07 | 16.2 | 相同 payload + 相同 Key 提交两次；再用新 Key 提交 | 同 Key 同一 task_id/plan_id 且仅一条；新 Key 产生新 task/plan | 同 Key：202，同 task=true，同 plan=true，列表 total=1；新 Key：202，新 task=true，列表 total=2 | **PASS** | `evidence/interface-devMock.json#T07` |
| T10 | 16.2 | PATCH materials：数量 5、单价 30、模型写小计 200；读响应与详情 | 服务端改为 150 | PATCH 200；响应小计=150；详情小计=150；version 1→2。断言：**服务端返回 150 时页面显示 150，前端不得用 30×5 覆盖** | **PASS** | `evidence/interface-devMock.json#T10`；页面绑定证据见 `evidence/05-materials.json` |
| T14 | 16.2 | `GET /plans/{id}/export?format=markdown` | 200，`text/markdown`，含 6 个部分；中文文件名 | 200；`text/markdown; charset=utf-8`；filename=`幂等键测试方案活动方案.md`；14 个 `##` 标题；6 部分关键词都在；无乱码 | **PASS** | `evidence/interface-devMock.json#T14` |
| T15 | 16.2 | `GET /plans/{id}/export?format=pdf` | 501 `PDF_NOT_ENABLED` | **400** `{"detail":"目前只支持 markdown"}`；真实后端同样 400，无 501 | **FAIL**（已知未实现） | `evidence/interface-devMock.json#T15`；`evidence/interface-real-backend.json#T15` |
| T16 | 16.2 | `GET /plans?page=1&page_size=1`；检查分页与字段 | 只返回自己的方案；不含 content_json | total=2、page_items=1、无 content_json；B 列表 total=0 | **PASS** | `evidence/interface-devMock.json#T16` |
| T17 | 16.2 | devmock：duplicate；真实后端：`POST /plans/{id}/duplicate` | 新 ID，原方案不变 | devmock 404（无路由，BLOCK）；真实后端 201，新 ID=true，原方案 v1→v1、内容不变，副本内容一致 | **PASS**（真实后端） | `evidence/interface-devMock.json#T17_18_devmock`；`evidence/interface-real-backend.json#T17` |
| T18 | 16.2 | devmock：DELETE；真实后端：`DELETE /plans/{id}` | 204；再查询 404；列表不出现 | devmock 404（无路由，BLOCK）；真实后端 DELETE=204，GET=404，列表删除前包含=true、删除后=false | **PASS**（真实后端） | `evidence/interface-devMock.json#T17_18_devmock`；`evidence/interface-real-backend.json#T18` |

### T07 的两种 key 语义（按要求区分）

| 场景 | 前端行为 | 服务端结果 | 证据 |
|---|---|---|---|
| 同一次提交的网络重试 | `PlanCreateView.vue:99-101` 捕获网络错误后用同一 `idempotencyKey` 重发 | 同一 `task_id` / `plan_id`，列表仍为 1 条 | `evidence/interface-devMock.json#T07.sameKey` |
| 用户再次点击提交 | `PlanCreateView.vue:90` 每次 `createId()` 生成新 key | 新 `task_id` / `plan_id`，列表变为 2 条 | `evidence/interface-devMock.json#T07.newKey` |

## 2. 缺陷清单

### 已确认应用/接口缺陷

| 编号 | 级别 | 现象 | 影响 | 证据 |
|---|---|---|---|---|
| D1 / T01 | **低（API 契约）** | 重复注册返回 409，但 body 只有 `{"detail":"用户名已存在"}`，没有文档约定的 `USERNAME_TAKEN` 结构化错误码；devmock 与真实后端一致 | 前端只展示 detail，不影响用户；严格按 16.2 断言错误码的测试会失败。建议后端返回统一错误码或明确调整用例 | `evidence/interface-devMock.json#T01`；`evidence/interface-real-backend.json#T01` |

### 已知未实现 / 不计前端缺陷

| 编号 | 级别 | 现象 | 依据 | 证据 |
|---|---|---|---|---|
| T15 | 中（已知未实现） | `format=pdf` 返回 400，不是 501 `PDF_NOT_ENABLED`；devmock 与真实后端都没有 PDF 路由 | README L116「未实现的功能不出现入口：……服务端 PDF……」；L177「当前后端没有 PDF 接口，打印页使用浏览器打印能力」 | `evidence/interface-devMock.json#T15`；`evidence/interface-real-backend.json#T15` |

### 覆盖/环境说明（非应用缺陷）

| 编号 | 内容 | 证据 |
|---|---|---|
| F6 | Vite 在第一次跑用例 8 时因 `EBUSY` 监听 `08-export.md` 退出；重启并将下载/PDF 先写临时目录后重跑，7–10 全 PASS。Mock 未重启 | `evidence/vite-ebusy-incident.txt`；`evidence/round2-console.log` |
| F7 | T10 的 30×5 本身也等于 150，单看数值无法区分“服务端值”与“前端重算”；已用用例 5 的非编辑态绑定（`MaterialsSection.vue:102` 直接渲染 `item.subtotal_yuan`）补足页面侧证据 | `evidence/05-materials.json`；`evidence/interface-devMock.json#T10` |
| F8 | devmock 没有 duplicate/delete 路由，T17/T18 在 devmock 上为 BLOCK；已用 8083 临时真实后端补测为 PASS | `evidence/interface-devMock.json#T17_18_devmock`；`evidence/interface-real-backend.json` |
| F9 | 第一轮报告中的 F1（物资汇总不联动预算合计）与 F2（`/plans` 归一为 `/`）仍然有效 | `report-round1.md` |

## 3. 覆盖总结

### 本轮与累计通过率

- 第二轮执行 14 项：**12 PASS / 2 FAIL（T01、T15）**；T17/T18 在 devmock BLOCK，已用真实后端补测为 PASS。
- 累计已执行 20 项（第一轮 6 + 第二轮 14）：**18 PASS / 2 FAIL = 90%**。
- 若按 README 把 T15（服务端 PDF）记为 N/A，则 **18/19 = 94.7%**。
- 第一轮 6/6；第二轮前端 4/4；第二轮接口（含真实后端补测）12/14。

### N/A 项依据（逐条）

| 项 | 依据（README） |
|---|---|
| A11 的复制/删除 | L116「未实现的功能不出现入口：删除、复制……」 |
| A12 模板 | L116 同上「模板」 |
| T15 服务端 PDF（前端） | L116「服务端 PDF」；L177「当前后端没有 PDF 接口，打印页使用浏览器打印能力」 |
| T17/T18（前端） | L116「删除、复制」；前端无入口，后端接口级见上表 |
| 版本历史、恢复版本、单节重新生成、取消生成、归档 | L116 同句列出；不在 A/B/C 清单，无执行行 |

### 需真实后端或运维的移交项

| 项 | 原因 |
|---|---|
| B1 10 并发生成 | 需要真实服务 + PostgreSQL 做并发压测；devmock 单进程内存不能代表 |
| B3 API Key 不出现在 bundle/Git/日志 | 需要生产构建、Git 历史扫描、后端日志/密钥扫描 |
| B4 P95 ≤ 120s（5 次采样） | devmock/后端 mock 的耗时都不代表真实 LLM |
| B5 PostgreSQL 重启后历史仍在 | Mock 重启必清空；本地 SQLite 不能替代生产 |
| T08 智能体超时 -> `AGENT_TIMEOUT` | 默认 `ENABLE_FALLBACK=true` 会降级成功；LangGraph 超时映射为 `AGENT_UPSTREAM_ERROR`，只有 Dify 抛 `AGENT_TIMEOUT` |
| T09 非法 JSON 修复/降级 | devmock 永远返回合法内容，需要后端 stub 或真实模型 |
| T11 超预算 10% 触发重试 | 后端只追加 warning，没有 10% 重试逻辑 |
| A4/A5/A6 真实 LLM 内容质量 | Mock/fixture 满足字段、条数、预算；validator 不强制校验每项字段、风险条数、预算上限 |
| A13 真实失败态 | 本轮用响应改写验证 UI；真实超时/非法 JSON 仍需后端或真实模型 |
| B6 健康检查数据库状态 | 真实后端 `/healthz` 无数据库状态；devmock 无 agent 字段；本轮未在用户指定接口清单内，未执行 |

### 本轮未执行、仍待补的映射项

| 项 | 状态 |
|---|---|
| T03 | 已由第一轮用例 1 等价覆盖：API 401 + 失效 token 跳登录 |
| T06 | 已由第一轮用例 2/3 等价覆盖：202 → 轮询 → ready |
| T12 | 已由第二轮用例 7 等价覆盖：两个标签页保存，后保存者 409 |
| T13 | 已由第一轮用例 5 等价覆盖：保存后重新 GET，内容一致、version+1 |
| T05 | **未执行**；映射预判直接接口返回 422，而文档期望 400 |
| T08 / T09 / T11 | 移交真实后端或可控 stub；默认 fallback 与 LangGraph 超时映射见上文 |
| B2 | 已由 T07 覆盖（同 key / 新 key 两种语义） |
| B6 | 未执行（不在本轮指定接口清单）；真实后端 `/healthz` 无数据库状态 |
| B1 / B3 / B4 / B5 | 需真实服务、PostgreSQL、压测或运维扫描 |
| A4 / A5 / A6 / A13 | Mock/fixture 已覆盖字段与 UI；真实 LLM 内容质量与真实失败触发需后端/真实模型 |

## 4. 证据索引

- 报告：`report-round1.md`、`report-round2.md`
- 结果：`evidence/results-round1.json`、`evidence/results-round2.json`、`evidence/interface-devMock.json`、`evidence/interface-real-backend.json`
- 报文/断言：`evidence/07-conflict.json`、`08-export.json`、`09-print.json`、`10-failure.json`
- 导出文件：`evidence/08-export.md`
- A4 PDF：`evidence/09-print.pdf`（15 页，A4）
- 截图：`screenshots/07-*`、`08-*`、`09-*`、`10-*`
- 事故记录：`evidence/vite-ebusy-incident.txt`
- 临时真实后端：`evidence/round2-backend.db`、`evidence/real-backend.log`

## 5. 环境观察

- `.env.production` 仍被改为 `VITE_API_BASE_URL=http://127.0.0.1:8082`（`git status` 显示 M）。本轮脚本没有写这个文件；开发服务器使用 `.env.development`，不影响本轮结果。是否还原请确认后自行决定。
- 8082（devmock）和 5173（Vite）当前仍在运行；8083 临时真实后端已停止。
