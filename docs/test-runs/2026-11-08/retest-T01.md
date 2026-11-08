# D1 / T01 复测报告

- 日期：2026-11-08
- 结论：**PASS，D1 可以关闭**
- 被测提交：`622d9fa`（包含修复提交 `3635b61`）
- 修复位置：
  - 后端：`raungong-main/backend/app/api/v1/auth.py:45-49`
  - devmock：`devmock/server.mjs:374`
- 新响应格式：

```json
{
  "detail": {
    "code": "USERNAME_TAKEN",
    "message": "用户名已存在"
  }
}
```

## 复测结果

| 场景 | 步骤 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| devmock API | 注册新用户后再用同一用户名注册 | 201 → 409 `USERNAME_TAKEN` | 201 → 409；`detail.code=USERNAME_TAKEN`，`detail.message=用户名已存在` | **PASS** |
| 真实后端 API | 临时 8083 + 临时 SQLite，重复注册 | 201 → 409 `USERNAME_TAKEN` | 201 → 409；响应格式同上；健康检查 `agent=mock/configured` | **PASS** |
| 注册页 UI | 新窗口用已存在用户名注册 | 页面显示「用户名已存在」 | 409；`.server-error` 显示「用户名已存在」；未跳转工作台 | **PASS** |

关键结论：

- 后端与 devmock 都补齐了结构化错误码，D1 的契约差异已消除。
- 前端 `getErrorMessage` 能从 `detail.message` 提取文案，未因响应从字符串变成对象而回归。
- 首次注册仍返回 201，未影响正常注册流程。

## 证据

- 报文：`evidence/retest-T01.json`
- UI 截图：`screenshots/retest-T01-ui-duplicate.png`
- 真实后端日志：`evidence/real-backend-retest.log`
- 临时真实后端：`127.0.0.1:8083`，测试后已停止；临时库 `evidence/retest-T01.db`

## 说明

- 之前 D1 的证据来自修复前的本地代码（基于 `7a052ed`）；拉取远程 `3635b61` 后复测，当前 HEAD 已包含修复。
- 本次未修改任何源码；只新增了 `docs/test-runs/2026-11-08/` 下的复测脚本与证据。
- devmock（8082）与 Vite（5173）当前仍在运行。
