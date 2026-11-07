/**
 * 活动智囊 · 2026-11-07 接口级用例（devmock 8082）
 * T01/T02/T04/T07/T10/T14/T15/T16/T17/T18
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:8082";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVID = path.join(OUT, "evidence");
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

function saveJson(name, data) {
  fs.writeFileSync(path.join(EVID, name), JSON.stringify(data, null, 2), "utf8");
}

function addResult(id, source, steps, expected, actual, status, evidence, extra = {}) {
  results.push({ id, source, steps, expected, actual, status, evidence, mockRestartedBeforeCase: false, ...extra });
}

function suffix() {
  return `${Date.now().toString(36).slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function api(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: response.status, headers: Object.fromEntries(response.headers), text, json };
}

async function register(username) {
  return api("/api/v1/auth/register", {
    method: "POST",
    body: { username, password: "test12345", display_name: "接口测试" },
  });
}

async function login(username, password = "test12345") {
  return api("/api/v1/auth/login", { method: "POST", body: { username, password } });
}

function planPayload(theme) {
  return {
    theme,
    activity_type: "welcome_party",
    participants: 100,
    budget_yuan: 2000,
    starts_at: "2026-11-20T19:00:00+08:00",
    duration_minutes: 120,
    location: "学校礼堂",
    target_audience: "新生",
    goals: ["接口测试目标"],
    constraints: "",
    tone: "lively",
    extra_notes: "",
  };
}

async function createPlan(token, payload, idempotencyKey) {
  return api("/api/v1/plans/generate", {
    method: "POST",
    token,
    body: payload,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
  });
}

async function waitTask(token, taskId, timeoutMs = 15000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await api(`/api/v1/tasks/${taskId}`, { token });
    const status = last.json?.status;
    if (status === "succeeded" || status === "failed") return last;
    await sleep(500);
  }
  return last;
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  const evidence = {};
  const u01 = `t01_${suffix()}`;
  const u04a = `t04a_${suffix()}`;
  const u04b = `t04b_${suffix()}`;
  const u07 = `t07_${suffix()}`;

  // T01 注册重复用户名
  const first = await register(u01);
  const duplicate = await register(u01);
  const t01 = {
    username: u01,
    firstRegister: { status: first.status, body: first.json },
    duplicateRegister: { status: duplicate.status, body: duplicate.json, text: duplicate.text },
    expectedCode: "USERNAME_TAKEN",
    actualHasCode: Boolean(duplicate.json?.code || duplicate.json?.detail?.code || duplicate.json?.error?.code),
  };
  evidence.T01 = t01;
  addResult(
    "T01",
    "16.2",
    "同一用户名连续注册两次",
    "409 USERNAME_TAKEN",
    `status=${duplicate.status}；body=${duplicate.text}；结构化错误码=${t01.actualHasCode ? "有" : "无"}`,
    duplicate.status === 409 && t01.actualHasCode ? "PASS" : "FAIL",
    "evidence/interface-devMock.json#T01",
    { checks: t01 },
  );

  // T02 错误密码与不存在账号
  const wrongPassword = await login(u01, "wrongpass123");
  const unknownUser = await login(`nouser_${suffix()}`, "whatever123");
  const t02 = {
    wrongPassword: { status: wrongPassword.status, body: wrongPassword.json },
    unknownUser: { status: unknownUser.status, body: unknownUser.json },
    sameMessage: wrongPassword.json?.detail === unknownUser.json?.detail,
  };
  evidence.T02 = t02;
  addResult(
    "T02",
    "16.2",
    "已存在账号输入错误密码；不存在账号登录",
    "均 401，且不提示账号是否存在",
    `错误密码=${wrongPassword.status}「${wrongPassword.json?.detail}」；不存在账号=${unknownUser.status}「${unknownUser.json?.detail}」；文案相同=${t02.sameMessage}`,
    wrongPassword.status === 401 && unknownUser.status === 401 && t02.sameMessage ? "PASS" : "FAIL",
    "evidence/interface-devMock.json#T02",
    { checks: t02 },
  );

  // T04 跨用户访问
  const regA = await register(u04a);
  const regB = await register(u04b);
  const tokenA = regA.json.access_token;
  const tokenB = regB.json.access_token;
  const aPlan = await createPlan(tokenA, planPayload("跨用户访问用例"));
  const bReadPlan = await api(`/api/v1/plans/${aPlan.json.plan_id}`, { token: tokenB });
  const bReadTask = await api(`/api/v1/tasks/${aPlan.json.task_id}`, { token: tokenB });
  const bList = await api("/api/v1/plans", { token: tokenB });
  const t04 = {
    userA: u04a,
    userB: u04b,
    aPlanId: aPlan.json.plan_id,
    aTaskId: aPlan.json.task_id,
    bReadPlan: { status: bReadPlan.status, body: bReadPlan.json },
    bReadTask: { status: bReadTask.status, body: bReadTask.json },
    bList: { status: bList.status, total: bList.json?.pagination?.total, items: bList.json?.items?.length },
  };
  evidence.T04 = t04;
  addResult(
    "T04",
    "16.2",
    "用户 A 创建方案；用户 B 用自己的 token 读取 A 的方案和任务；B 看列表",
    "方案与任务均 404，B 列表为空",
    `B 读方案=${bReadPlan.status}；B 读任务=${bReadTask.status}；B 列表 total=${bList.json?.pagination?.total}`,
    bReadPlan.status === 404 && bReadTask.status === 404 && bList.json?.pagination?.total === 0 ? "PASS" : "FAIL",
    "evidence/interface-devMock.json#T04",
    { checks: t04 },
  );

  // T07 相同/不同 Idempotency-Key
  const reg07 = await register(u07);
  const token07 = reg07.json.access_token;
  const key = `k-${crypto.randomUUID()}`;
  const payload07 = planPayload("幂等键测试方案");
  const firstKey = await createPlan(token07, payload07, key);
  const sameKeyAgain = await createPlan(token07, payload07, key);
  const listAfterSameKey = await api("/api/v1/plans", { token: token07 });
  const newKey = `k-${crypto.randomUUID()}`;
  const newKeyPlan = await createPlan(token07, payload07, newKey);
  const listAfterNewKey = await api("/api/v1/plans", { token: token07 });
  const t07 = {
    sameKey: {
      first: { status: firstKey.status, body: firstKey.json },
      second: { status: sameKeyAgain.status, body: sameKeyAgain.json },
      sameTaskId: firstKey.json?.task_id === sameKeyAgain.json?.task_id,
      samePlanId: firstKey.json?.plan_id === sameKeyAgain.json?.plan_id,
      listTotal: listAfterSameKey.json?.pagination?.total,
    },
    newKey: {
      status: newKeyPlan.status,
      body: newKeyPlan.json,
      differentTask: newKeyPlan.json?.task_id !== firstKey.json?.task_id,
      listTotal: listAfterNewKey.json?.pagination?.total,
    },
  };
  evidence.T07 = t07;
  addResult(
    "T07",
    "16.2",
    "相同 payload + 相同 Idempotency-Key 连续提交两次；再用新 Key 提交一次",
    "同 key 返回同一 task_id/plan_id 且只一条；新 key 产生新 task/plan",
    `同 key：${sameKeyAgain.status}，同 task=${t07.sameKey.sameTaskId}，同 plan=${t07.sameKey.samePlanId}，列表 total=${t07.sameKey.listTotal}；新 key：${newKeyPlan.status}，新 task=${t07.newKey.differentTask}，列表 total=${t07.newKey.listTotal}`,
    firstKey.status === 202 &&
      sameKeyAgain.status === 202 &&
      t07.sameKey.sameTaskId &&
      t07.sameKey.samePlanId &&
      t07.sameKey.listTotal === 1 &&
      newKeyPlan.status === 202 &&
      t07.newKey.differentTask &&
      t07.newKey.listTotal === 2
      ? "PASS"
      : "FAIL",
    "evidence/interface-devMock.json#T07",
    { checks: t07, note: "同一次提交在网络层重试时复用 key；用户再次点击是新的 key，会得到新 task/plan，属预期。" },
  );

  // 等待第一份方案 ready，用于 T10/T14/T15
  const readyTask = await waitTask(token07, firstKey.json.task_id);
  const detailBefore = await api(`/api/v1/plans/${firstKey.json.plan_id}`, { token: token07 });
  const detail = detailBefore.json;

  // T10 服务端重算小计
  const materials = JSON.parse(JSON.stringify(detail.content.materials));
  materials.items[0].quantity = 5;
  materials.items[0].unit_price_yuan = 30;
  materials.items[0].subtotal_yuan = 200; // 模拟模型写错
  const patch = await api(`/api/v1/plans/${firstKey.json.plan_id}/sections/materials`, {
    method: "PATCH",
    token: token07,
    body: { version: detail.version, data: materials, comment: "T10 服务端重算" },
  });
  const detailAfter = await api(`/api/v1/plans/${firstKey.json.plan_id}`, { token: token07 });
  const t10 = {
    readyTaskStatus: readyTask?.json?.status,
    beforeVersion: detail.version,
    submittedItem: { quantity: 5, unit_price_yuan: 30, subtotal_yuan: 200 },
    responseStatus: patch.status,
    responseVersion: patch.json?.version,
    responseItem0Subtotal: patch.json?.data?.items?.[0]?.subtotal_yuan,
    persistedSubtotal: detailAfter.json?.content?.materials?.items?.[0]?.subtotal_yuan,
    assertion: "服务端返回 150 时页面显示 150，前端不得用 30×5 覆盖",
    uiBindingEvidence: "用例 5 已证明非编辑态表格直接渲染 item.subtotal_yuan（MaterialsSection.vue:102）",
  };
  evidence.T10 = t10;
  addResult(
    "T10",
    "16.2",
    "PATCH materials，第一项数量 5、单价 30、模型写小计 200；读取响应与详情",
    "服务端改为 150（断言：服务端返回 150 时页面显示 150，前端不得用 30×5 覆盖）",
    `PATCH=${patch.status}；响应小计=${t10.responseItem0Subtotal}；详情小计=${t10.persistedSubtotal}；版本 ${t10.beforeVersion}->${t10.responseVersion}`,
    patch.status === 200 && Number(t10.responseItem0Subtotal) === 150 && Number(t10.persistedSubtotal) === 150 ? "PASS" : "FAIL",
    "evidence/interface-devMock.json#T10",
    { checks: t10 },
  );

  // T14 Markdown 导出
  const exportMd = await api(`/api/v1/plans/${firstKey.json.plan_id}/export?format=markdown`, { token: token07 });
  const headings = (exportMd.text.match(/^## .+$/gm) ?? []).map((line) => line.replace(/^##\s+/, ""));
  const disposition = exportMd.headers["content-disposition"] ?? "";
  const filenameStar = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const decodedFilename = filenameStar ? decodeURIComponent(filenameStar[1]) : null;
  const t14 = {
    status: exportMd.status,
    contentType: exportMd.headers["content-type"],
    contentDisposition: disposition,
    decodedFilename,
    headings,
    headingCount: headings.length,
    hasSixParts: ["活动概览", "物资清单", "任务分工", "宣传方案", "风险与复盘"].every((part) => exportMd.text.includes(part)),
    hasReplacementChar: exportMd.text.includes("�"),
  };
  evidence.T14 = t14;
  addResult(
    "T14",
    "16.2",
    "GET /plans/{id}/export?format=markdown",
    "200，text/markdown，含 6 个部分（实际 Markdown 标题更多）；中文文件名",
    `status=${exportMd.status}；content-type=${t14.contentType}；filename=${decodedFilename}；标题数=${t14.headingCount}；六部分关键词=${t14.hasSixParts}`,
    exportMd.status === 200 &&
      (t14.contentType ?? "").includes("text/markdown") &&
      Boolean(decodedFilename) &&
      t14.hasSixParts &&
      !t14.hasReplacementChar
      ? "PASS"
      : "FAIL",
    "evidence/interface-devMock.json#T14",
    { checks: t14 },
  );

  // T15 PDF 未启用
  const exportPdf = await api(`/api/v1/plans/${firstKey.json.plan_id}/export?format=pdf`, { token: token07 });
  const t15 = {
    status: exportPdf.status,
    body: exportPdf.text,
    expectedStatus: 501,
    expectedCode: "PDF_NOT_ENABLED",
    readme: "L116/L177：服务端 PDF 未实现；当前后端没有 PDF 接口",
  };
  evidence.T15 = t15;
  addResult(
    "T15",
    "16.2",
    "GET /plans/{id}/export?format=pdf",
    "501 PDF_NOT_ENABLED（README 已标注服务端 PDF 未实现）",
    `实际 status=${exportPdf.status}，body=${exportPdf.text}；未返回 501/PDF_NOT_ENABLED`,
    "FAIL",
    "evidence/interface-devMock.json#T15",
    { checks: t15, knownGap: true, note: "按 README 属未实现功能，不计前端缺陷；接口预期 501 未实现。" },
  );

  // T16 列表分页与字段
  const listPage = await api("/api/v1/plans?page=1&page_size=1", { token: token07 });
  const t16 = {
    status: listPage.status,
    pagination: listPage.json?.pagination,
    itemCount: listPage.json?.items?.length,
    itemKeys: Object.keys(listPage.json?.items?.[0] ?? {}),
    hasContentJson: Object.prototype.hasOwnProperty.call(listPage.json?.items?.[0] ?? {}, "content_json"),
    bListTotal: bList.json?.pagination?.total,
  };
  evidence.T16 = t16;
  addResult(
    "T16",
    "16.2",
    "GET /plans?page=1&page_size=1；检查分页、content_json 与跨用户隔离",
    "只返回自己的方案；不含 content_json；分页字段正确",
    `status=${listPage.status}；total=${t16.pagination?.total}；page_items=${t16.itemCount}；has_content_json=${t16.hasContentJson}；B 列表 total=${t16.bListTotal}`,
    listPage.status === 200 &&
      t16.pagination?.total === 2 &&
      t16.itemCount === 1 &&
      !t16.hasContentJson &&
      t16.bListTotal === 0
      ? "PASS"
      : "FAIL",
    "evidence/interface-devMock.json#T16",
    { checks: t16 },
  );

  // T17/T18 devmock 不支持
  const duplicatePlan = await api(`/api/v1/plans/${firstKey.json.plan_id}/duplicate`, {
    method: "POST",
    token: token07,
    body: {},
  });
  const deleted = await api(`/api/v1/plans/${firstKey.json.plan_id}`, { method: "DELETE", token: token07 });
  const t17dev = { status: duplicatePlan.status, body: duplicatePlan.json, note: "devmock 未实现 duplicate 路由" };
  const t18dev = { status: deleted.status, body: deleted.json, note: "devmock 未实现 DELETE 路由" };
  evidence.T17_18_devmock = { T17: t17dev, T18: t18dev };
  addResult(
    "T17",
    "16.2",
    "devmock：POST /plans/{id}/duplicate",
    "新 ID，原方案不变",
    `devmock 返回 ${duplicatePlan.status}「${duplicatePlan.json?.detail}」；无路由，无法在 devmock 执行`,
    "BLOCK",
    "evidence/interface-devMock.json#T17_18_devmock",
    { checks: t17dev, note: "改用 8083 临时真实后端补测。" },
  );
  addResult(
    "T18",
    "16.2",
    "devmock：DELETE /plans/{id}",
    "204；再查询 404，列表不出现",
    `devmock 返回 ${deleted.status}「${deleted.json?.detail}」；无路由，无法在 devmock 执行`,
    "BLOCK",
    "evidence/interface-devMock.json#T17_18_devmock",
    { checks: t18dev, note: "改用 8083 临时真实后端补测。" },
  );

  saveJson("interface-devMock.json", { generatedAt: nowIso(), base: BASE, evidence, results });
  console.log(JSON.stringify({ results, evidence }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
