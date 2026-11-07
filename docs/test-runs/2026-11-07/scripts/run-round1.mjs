/**
 * 活动智囊 · 2026-11-07 第一轮验收脚本（用例 1–6）
 * 只通过页面与 HTTP 观察/断言；不修改 src/ 或 devmock/。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8082";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVID = path.join(OUT, "evidence");
const SHOTS = path.join(OUT, "screenshots");
const VIEWPORT = { width: 1440, height: 960 };
const DEMO = { username: "demo_studio", password: "demo12345" };

// seed-demo.mjs 本轮只运行一次；若重跑 seed，请重新读取其输出中的 ID。
const SEEDED_WELCOME_PLAN_ID = "7bdb54c9-e27a-4af6-aa9c-7158eefce13a";

const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const mockState = {
  startedBeforeRound: true,
  restartsDuringRound: 0,
  healthAtStart: null,
  note: "Mock 在用例 1 开始前启动，seed-demo 在启动后执行一次；本轮不重启。",
};

function nowIso() {
  return new Date().toISOString();
}

function saveJson(name, data) {
  fs.writeFileSync(path.join(EVID, name), JSON.stringify(data, null, 2), "utf8");
}

function money(value) {
  return `¥ ${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: path.join(SHOTS, name), fullPage });
}

function attach(page, label) {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ label, text: msg.text() });
  });
  page.on("pageerror", (err) => pageErrors.push({ label, text: String(err) }));
  page.on("requestfailed", (req) => {
    failedRequests.push({ label, url: req.url(), method: req.method(), failure: req.failure()?.errorText });
  });
}

async function login(page, username = DEMO.username, password = DEMO.password) {
  // 若已因路由守卫停在 /login?redirect=...，保留 redirect 参数，验证“登录后回原页面”。
  if (!/\/login(\?|$)/.test(page.url())) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  }
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.waitForURL((url) => url.origin === BASE && url.pathname !== "/login", { timeout: 15000 });
}

async function register(page, username, displayName = "第一轮测试") {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "注册" }).click();
  await page.fill("#username", username);
  await page.fill("#displayName", displayName);
  await page.fill("#password", "test12345");
  await page.fill("#confirm", "test12345");
  await page.getByRole("button", { name: "注册并进入工作台" }).click();
  await page.waitForURL((url) => url.origin === BASE && url.pathname === "/", { timeout: 15000 });
}

function addResult(id, source, steps, expected, actual, status, evidence, extra = {}) {
  results.push({
    id,
    source,
    steps,
    expected,
    actual,
    status,
    evidence,
    mockRestartedBeforeCase: false,
    ...extra,
  });
}

async function readBudgetTotals(page) {
  const labels = (await page.locator(".totals .total .label").allTextContents()).map((x) => x.trim());
  const values = (await page.locator(".totals .total .value").allTextContents()).map((x) => x.trim());
  const out = {};
  labels.forEach((label, index) => {
    out[label] = values[index];
  });
  return out;
}

async function openSection(page, label) {
  await page.locator(".section-nav .nav-item").filter({ hasText: label }).click();
  await page.waitForFunction(
    (expected) => document.querySelector(".panel-title")?.textContent?.trim() === expected,
    label,
    { timeout: 5000 },
  );
  await sleep(150);
}

async function runCase1(browser) {
  const checks = {};
  const evidence = [];

  const anon = await browser.newContext({ viewport: VIEWPORT });
  const apiPlans = await anon.request.get(`${API}/api/v1/plans`);
  checks.apiGetPlans = { status: apiPlans.status(), body: (await apiPlans.text()).slice(0, 500) };
  const apiDetail = await anon.request.get(`${API}/api/v1/plans/${SEEDED_WELCOME_PLAN_ID}`);
  checks.apiGetPlanDetail = { status: apiDetail.status(), body: (await apiDetail.text()).slice(0, 500) };

  const page = await anon.newPage();
  attach(page, "case1-plans");
  await page.goto(`${BASE}/plans`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/login/, { timeout: 10000 });
  checks.browserPlansRedirect = page.url();
  await shot(page, "01-unauth-plans-login.png");

  await login(page);
  checks.browserPlansAfterLogin = page.url();
  await shot(page, "01-after-login-list.png");

  const detailCtx = await browser.newContext({ viewport: VIEWPORT });
  const detailPage = await detailCtx.newPage();
  attach(detailPage, "case1-detail");
  await detailPage.goto(`${BASE}/plans/${SEEDED_WELCOME_PLAN_ID}`, { waitUntil: "domcontentloaded" });
  await detailPage.waitForURL(/\/login/, { timeout: 10000 });
  checks.browserDetailRedirect = detailPage.url();
  await shot(detailPage, "01-unauth-detail-login.png");

  await login(detailPage);
  await detailPage.waitForURL(new RegExp(`/plans/${SEEDED_WELCOME_PLAN_ID}$`), { timeout: 15000 });
  checks.browserDetailAfterLogin = detailPage.url();
  checks.detailTitleAfterLogin = (await detailPage.locator(".plan-title").innerText()).trim();
  await shot(detailPage, "01-after-login-detail.png");

  const expiredCtx = await browser.newContext({ viewport: VIEWPORT });
  const expiredPage = await expiredCtx.newPage();
  attach(expiredPage, "case1-expired");
  await expiredPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await expiredPage.evaluate(() => localStorage.setItem("token", "expired-token"));
  await expiredPage.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await expiredPage.waitForURL(/\/login/, { timeout: 15000 });
  checks.expiredTokenRedirect = expiredPage.url();
  await shot(expiredPage, "01-expired-token-login.png");

  saveJson("01-unauth.json", checks);
  evidence.push("evidence/01-unauth.json", "screenshots/01-unauth-plans-login.png", "screenshots/01-unauth-detail-login.png", "screenshots/01-after-login-detail.png", "screenshots/01-expired-token-login.png");

  const expected = "API /api/v1/plans 与 /api/v1/plans/{id} 未登录均 401；浏览器访问 /plans 与 /plans/{id} 跳登录；登录后详情回到原 /plans/{id}；失效 token 跳登录";
  const actual = [
    `API 列表 ${checks.apiGetPlans.status}`,
    `API 详情 ${checks.apiGetPlanDetail.status}`,
    `浏览器 /plans -> ${checks.browserPlansRedirect}`,
    `登录后 -> ${checks.browserPlansAfterLogin}`,
    `浏览器 /plans/{id} -> ${checks.browserDetailRedirect}`,
    `登录后 -> ${checks.browserDetailAfterLogin}`,
    `失效 token -> ${checks.expiredTokenRedirect}`,
  ].join("；");

  const pass =
    checks.apiGetPlans.status === 401 &&
    checks.apiGetPlanDetail.status === 401 &&
    checks.browserPlansRedirect.includes("/login") &&
    checks.browserPlansAfterLogin === `${BASE}/` &&
    checks.browserDetailRedirect.includes("/login") &&
    checks.browserDetailAfterLogin === `${BASE}/plans/${SEEDED_WELCOME_PLAN_ID}` &&
    checks.expiredTokenRedirect.includes("/login");
  addResult(
    "1",
    "11.1 A1",
    "① 匿名调 GET /plans、GET /plans/{id}；② 匿名打开 /plans；③ 登录后观察落地页；④ 匿名打开 /plans/{id}；⑤ 登录后观察是否回详情；⑥ 写入失效 token 访问 /",
    expected,
    actual,
    pass ? "PASS" : "FAIL",
    evidence.join("；"),
    { checks },
  );

  await anon.close();
  await detailCtx.close();
  await expiredCtx.close();
  return pass ? null : "用例 1 存在断言未通过，见 evidence/01-unauth.json";
}

async function runCase2And3(browser) {
  const username = `r1_${Date.now().toString(36).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const ctx = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const page = await ctx.newPage();
  attach(page, "case2-3");

  await register(page, username, "第一轮测试");
  const token = await page.evaluate(() => localStorage.getItem("token"));

  let mystery = true;
  const pollLog = [];
  await page.route(/\/api\/v1\/tasks\//, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    const body = await response.json();
    pollLog.push({ stubbed: mystery, status: response.status(), body });
    if (mystery) {
      const modified = { ...body, stage: "mystery_stage", status: "running", message: "" };
      await route.fulfill({
        status: response.status(),
        headers,
        body: JSON.stringify(modified),
      });
    } else {
      await route.fulfill({ status: response.status(), headers, body: JSON.stringify(body) });
    }
  });

  await page.goto(`${BASE}/plans/new`, { waitUntil: "networkidle" });
  await page.fill("#theme", "迎新晚会");
  await page.locator(".type-option").filter({ hasText: "迎新晚会" }).click();
  await page.fill("#location", "学校礼堂");
  await page.fill("#audience", "2026 级新生");
  await page.fill("#participants", "100");
  await page.fill("#budget", "2000");
  const startsAtValue = await page.locator(".el-date-editor input").first().inputValue().catch(() => "");

  const requestPromise = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/api/v1/plans/generate"),
    { timeout: 15000 },
  );
  const responsePromise = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().endsWith("/api/v1/plans/generate"),
    { timeout: 15000 },
  );
  await page.locator(".aside-actions button[type=submit]").click();
  const request = await requestPromise;
  const response = await responsePromise;
  const requestBody = request.postDataJSON();
  const responseBody = await response.json();
  const headers = await request.allHeaders();
  const planId = responseBody.plan_id;
  const taskId = responseBody.task_id;

  await page.waitForURL(/\/plans\/[0-9a-f-]{36}\/generating$/, { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelector(".stage-message")?.textContent?.includes("处理中"),
    { timeout: 5000 },
  );
  await shot(page, "03-generating-processing.png");
  const storageKey = `plan-task:${planId}`;
  const storageBeforeReload = await page.evaluate((key) => sessionStorage.getItem(key), storageKey);

  mystery = false;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}\/generating$/, { timeout: 10000 }).catch(() => {});
  const storageAfterReload = await page.evaluate((key) => sessionStorage.getItem(key), storageKey);
  await page.waitForURL(new RegExp(`/plans/${planId}$`), { timeout: 25000 });
  await page.locator(".plan-title").waitFor({ timeout: 10000 });
  await sleep(300);
  await shot(page, "03-detail-after-reload.png");

  saveJson("02-generate-request.json", {
    requestedAt: nowIso(),
    startsAtFieldShown: startsAtValue,
    requestHeaders: headers,
    requestBody,
    hasTemplateId: Object.prototype.hasOwnProperty.call(requestBody, "template_id"),
    responseStatus: response.status(),
    responseBody,
  });
  saveJson("03-generation.json", {
    requestedAt: nowIso(),
    responseStatus: response.status(),
    responseBody,
    pollLog,
    taskStorageKey: storageKey,
    storageBeforeReload,
    storageAfterReload,
    finalUrl: page.url(),
    note: "处理中阶段的响应由 Playwright 拦截并改写 stage/message 触发；devmock 本身在该时刻通常返回 planning。",
  });

  const expected2 =
    "POST /api/v1/plans/generate 返回 202；请求体含主题/类型/人数/预算/日期/地点，不含 template_id";
  const actual2 = `202=${response.status()}；字段=${Object.keys(requestBody).join(",")}；template_id=${Object.prototype.hasOwnProperty.call(requestBody, "template_id")}`;
  const pass2 =
    response.status() === 202 &&
    requestBody.theme === "迎新晚会" &&
    requestBody.activity_type === "welcome_party" &&
    requestBody.participants === 100 &&
    requestBody.budget_yuan === 2000 &&
    Boolean(requestBody.starts_at) &&
    requestBody.location === "学校礼堂" &&
    !Object.prototype.hasOwnProperty.call(requestBody, "template_id");
  addResult(
    "2",
    "11.1 A2",
    "注册新账号 -> /plans/new 填「迎新晚会/100 人/2000 元/默认一周后 19:00/学校礼堂」-> 提交并记录 POST body",
    expected2,
    actual2,
    pass2 ? "PASS" : "FAIL",
    "evidence/02-generate-request.json；screenshots/03-generating-processing.png",
    { requestBody, templateIdPresent: Object.prototype.hasOwnProperty.call(requestBody, "template_id") },
  );

  const expected3 =
    "202 -> 轮询 200 -> 详情；未知 stage 显示「处理中」；刷新后 plan-task:{planId} 仍存在并继续轮询到详情";
  const actual3 = `202=${response.status()}；轮询次数=${pollLog.length}；处理中=${storageBeforeReload ? "已观察（响应被改写）" : "未观察"}；storage 前=${storageBeforeReload}；刷新后=${storageAfterReload}；最终=${page.url()}`;
  const pass3 =
    response.status() === 202 &&
    pollLog.length >= 1 &&
    storageBeforeReload === taskId &&
    storageAfterReload === taskId &&
    page.url() === `${BASE}/plans/${planId}`;
  addResult(
    "3",
    "11.1 A2 / 前端 README 联调自检",
    "提交后进入进度页 -> 观察未知阶段文案 -> 读取 sessionStorage -> 刷新 -> 等待自动进入详情",
    expected3,
    actual3,
    pass3 ? "PASS" : "FAIL",
    "evidence/03-generation.json；screenshots/03-generating-processing.png；screenshots/03-detail-after-reload.png",
    { planId, taskId, pollCount: pollLog.length },
  );

  if (!pass2 || !pass3) {
    await ctx.close();
    throw new Error("用例 2/3 未全部通过，后续用例 4/5 依赖同一方案，标记 BLOCK");
  }

  return { ctx, page, token, planId, taskId, username };
}

async function runCase4(run) {
  const { ctx, page, token, planId } = run;
  const labels = (await page.locator(".section-nav .nav-text").allTextContents()).map((x) => x.trim());
  const expectedLabels = [
    "活动概览",
    "筹备阶段",
    "当晚流程",
    "预算",
    "物资",
    "分工",
    "宣传",
    "风险",
    "复盘",
    "警告与假设",
  ];
  const sectionEvidence = [];
  for (let index = 0; index < expectedLabels.length; index += 1) {
    const label = expectedLabels[index];
    await openSection(page, label);
    const panelText = (await page.locator(".panel-body").innerText()).trim();
    const panelTitle = (await page.locator(".panel-title").innerText()).trim();
    const name = `04-section-${String(index + 1).padStart(2, "0")}-${label}.png`;
    await shot(page, name);
    sectionEvidence.push({ label, panelTitle, panelTextLength: panelText.length, screenshot: `screenshots/${name}` });
  }

  const detailResponse = await ctx.request.get(`${API}/api/v1/plans/${planId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detail = await detailResponse.json();
  const content = detail.content ?? {};
  const mapping = [
    {
      part: "策划案",
      sections: ["活动概览", "筹备阶段", "当晚流程", "预算"],
      evidenceFields: ["plan.summary", "plan.phases", "plan.rundown", "plan.budget"],
      present: Boolean(content.plan && content.plan.phases && content.plan.rundown && content.plan.budget),
    },
    {
      part: "物资清单",
      sections: ["物资"],
      evidenceFields: ["materials.items", "materials.summary"],
      present: Boolean(content.materials?.items?.length),
    },
    {
      part: "分工表",
      sections: ["分工"],
      evidenceFields: ["tasks.items"],
      present: Boolean(content.tasks?.items?.length),
    },
    {
      part: "宣传文案",
      sections: ["宣传"],
      evidenceFields: ["promotion"],
      present: Boolean(content.promotion),
    },
    {
      part: "风险清单",
      sections: ["风险"],
      evidenceFields: ["risks.items"],
      present: Boolean(content.risks?.items?.length),
    },
    {
      part: "复盘模板",
      sections: ["复盘"],
      evidenceFields: ["review"],
      present: Boolean(content.review),
    },
    {
      part: "附加（不计入六部分）",
      sections: ["警告与假设"],
      evidenceFields: ["warnings", "assumptions"],
      present: Array.isArray(content.warnings) && Array.isArray(content.assumptions),
    },
  ];

  saveJson("04-sections.json", {
    observedLabels: labels,
    expectedLabels,
    sections: sectionEvidence,
    contentKeys: Object.keys(content),
    planKeys: Object.keys(content.plan ?? {}),
    counts: {
      materials: content.materials?.items?.length ?? 0,
      tasks: content.tasks?.items?.length ?? 0,
      risks: content.risks?.items?.length ?? 0,
      warnings: content.warnings?.length ?? 0,
      assumptions: content.assumptions?.length ?? 0,
    },
    mapping,
  });

  const labelsMatch =
    labels.length === expectedLabels.length && expectedLabels.every((label, index) => labels[index] === label);
  const allRendered = sectionEvidence.every((item) => item.panelTextLength > 0 && item.panelTitle === item.label);
  const allPartsPresent = mapping.every((item) => item.present);

  const expected =
    "详情页 10 个章节全部渲染；10 章节可映射为 11.1 的 6 部分 + 警告与假设（额外章节），字段证据齐全";
  const actual = `导航=${labels.join("/")}；逐节渲染=${allRendered}；六部分字段=${allPartsPresent}；materials=${mapping[1].present}、tasks=${mapping[2].present}、promotion=${mapping[3].present}、risks=${mapping[4].present}、review=${mapping[5].present}`;
  addResult(
    "4",
    "11.1 A3",
    "生成完成后进入详情 -> 读取 10 个导航标签 -> 逐节点击并截图 -> 调 GET /plans/{id} 核对 content 字段",
    expected,
    actual,
    labelsMatch && allRendered && allPartsPresent ? "PASS" : "FAIL",
    "evidence/04-sections.json；screenshots/04-section-01..10-*.png",
    { observedLabels: labels },
  );
  return labelsMatch && allRendered && allPartsPresent;
}

async function runCase5(run) {
  const { ctx, page, token, planId } = run;
  await openSection(page, "物资");
  const versionBefore = (await page.locator(".version").innerText()).trim();
  const firstRow = page.locator(".materials-table tbody tr").first();
  const before = {
    version: versionBefore,
    firstRow: {
      quantity: (await firstRow.locator('td[data-label="数量"]').innerText()).trim(),
      unitPrice: (await firstRow.locator('td[data-label="单价"]').innerText()).trim(),
      subtotal: (await firstRow.locator('td[data-label="小计"]').innerText()).trim(),
    },
    summaryValues: (await page.locator(".summary .sum-cell .value").allTextContents()).map((x) => x.trim()),
  };

  await openSection(page, "预算");
  before.budgetTotals = await readBudgetTotals(page);
  await shot(page, "05-budget-before-materials-edit.png");
  await openSection(page, "物资");
  await shot(page, "05-materials-before.png");

  await page.getByRole("button", { name: "编辑本节" }).click();
  await page.locator(".edit-card").first().waitFor({ timeout: 5000 });
  const qtyInput = page.locator(".edit-card").first().locator('input[type="number"]').first();
  const quantityN = await qtyInput.inputValue();
  await qtyInput.fill("3");
  await sleep(250);
  await shot(page, "05-materials-editing.png");

  const patchRequestPromise = page.waitForRequest(
    (req) => req.method() === "PATCH" && req.url().includes("/sections/materials"),
    { timeout: 10000 },
  );
  const patchResponsePromise = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/sections/materials"),
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "保存本节" }).click();
  const [patchRequest, patchResponse] = await Promise.all([patchRequestPromise, patchResponsePromise]);
  const patchRequestBody = patchRequest.postDataJSON();
  const patch = await patchResponse.json();
  await page.waitForFunction(
    (version) => document.querySelector(".version")?.textContent?.trim() === `v${version}`,
    patch.version,
    { timeout: 10000 },
  );
  await sleep(300);
  await shot(page, "05-materials-after.png");

  const afterRow = page.locator(".materials-table tbody tr").first();
  const after = {
    version: (await page.locator(".version").innerText()).trim(),
    firstRow: {
      quantity: (await afterRow.locator('td[data-label="数量"]').innerText()).trim(),
      unitPrice: (await afterRow.locator('td[data-label="单价"]').innerText()).trim(),
      subtotal: (await afterRow.locator('td[data-label="小计"]').innerText()).trim(),
    },
    summaryValues: (await page.locator(".summary .sum-cell .value").allTextContents()).map((x) => x.trim()),
  };

  await openSection(page, "预算");
  after.budgetTotals = await readBudgetTotals(page);
  await shot(page, "05-budget-after-materials-edit.png");

  const detailResponse = await ctx.request.get(`${API}/api/v1/plans/${planId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detail = await detailResponse.json();
  const serverSubtotal = patch.data.items[0].subtotal_yuan;
  const serverSummary = patch.data.summary.estimated_cost_yuan;
  const expectedSubtotalText = money(serverSubtotal);
  const expectedSummaryText = money(serverSummary);
  const expectedVersion = `v${patch.version}`;

  const checks = {
    quantityChanged: Number(patch.data.items[0].quantity) === 3,
    subtotalFromServer: after.firstRow.subtotal === expectedSubtotalText,
    summaryFromServer: after.summaryValues[2] === expectedSummaryText,
    versionIncremented: after.version === expectedVersion,
    persisted: Number(detail.content?.materials?.items?.[0]?.subtotal_yuan) === Number(serverSubtotal),
    budgetItemsTotalUnchanged: after.budgetTotals["明细合计"] === before.budgetTotals["明细合计"],
    budgetPlannedUnchanged: after.budgetTotals["计划合计"] === before.budgetTotals["计划合计"],
  };

  saveJson("05-materials.json", {
    caseStartedAt: nowIso(),
    planId,
    quantityN,
    quantityM: 3,
    before,
    patchRequestBody,
    patchResponse: {
      status: patchResponse.status(),
      version: patch.version,
      item0: patch.data.items[0],
      summary: patch.data.summary,
    },
    after,
    serverDetail: {
      version: detail.version,
      item0: detail.content?.materials?.items?.[0],
      summary: detail.content?.materials?.summary,
      budget: {
        items_total_yuan: detail.content?.plan?.budget?.items_total_yuan,
        planned_yuan: detail.content?.plan?.budget?.planned_yuan,
        contingency_yuan: detail.content?.plan?.budget?.contingency_yuan,
      },
    },
    assertions: checks,
    note:
      "materials PATCH 只返回 materials.items 与 materials.summary；items_total_yuan / planned_yuan 属于 plan.budget，不会随物资编辑联动。",
  });

  const expected =
    "数量 N->3 后，页面第一行小计与物资汇总等于 PATCH 响应中的 subtotal_yuan / summary.estimated_cost_yuan；version+1";
  const actual = `N=${quantityN}，M=3；服务端小计=${expectedSubtotalText}，页面=${after.firstRow.subtotal}；服务端汇总=${expectedSummaryText}，页面=${after.summaryValues[2]}；version ${before.version}->${after.version}；budget 明细合计 ${before.budgetTotals["明细合计"]}->${after.budgetTotals["明细合计"]}，计划合计 ${before.budgetTotals["计划合计"]}->${after.budgetTotals["计划合计"]}`;
  const pass = Object.values(checks).every(Boolean);
  addResult(
    "5",
    "11.1 A7",
    "详情「物资」-> 记录初始数量/小计/汇总 -> 编辑第一项数量为 3 -> 保存 -> 对比 PATCH 响应与页面 -> 查看预算合计",
    expected,
    actual,
    pass ? "PASS" : "FAIL",
    "evidence/05-materials.json；screenshots/05-materials-before/editing/after.png；screenshots/05-budget-before/after-materials-edit.png",
    { checks },
  );
  return pass;
}

async function runCase6(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  attach(page, "case6");
  await login(page);

  // 新建一份干净的 120 人 / 3600 元方案，避免 seed 方案已被上一轮修改。
  await page.goto(`${BASE}/plans/new`, { waitUntil: "networkidle" });
  await page.fill("#theme", "预算合计验证");
  await page.locator(".type-option").filter({ hasText: "迎新晚会" }).click();
  await page.fill("#location", "学校礼堂");
  await page.fill("#participants", "120");
  await page.fill("#budget", "3600");
  const createResponsePromise = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().endsWith("/api/v1/plans/generate"),
    { timeout: 15000 },
  );
  await page.locator(".aside-actions button[type=submit]").click();
  const createResponse = await createResponsePromise;
  const createBody = await createResponse.json();
  const planId = createBody.plan_id;
  await page.waitForURL(new RegExp(`/plans/${planId}$`), { timeout: 25000 });
  await page.locator(".plan-title").waitFor({ timeout: 10000 });
  const versionBefore = (await page.locator(".version").innerText()).trim();

  await openSection(page, "预算");
  const before = await readBudgetTotals(page);
  await shot(page, "06-budget-before.png");

  await page.getByRole("button", { name: "编辑本节" }).click();
  await page.locator(".total-input").waitFor({ timeout: 5000 });
  await page.locator(".total-input").fill("500");
  await sleep(250);
  const preview = await readBudgetTotals(page);
  await shot(page, "06-budget-editing-contingency-500.png");

  const patchRequestPromise = page.waitForRequest(
    (req) => req.method() === "PATCH" && req.url().includes("/sections/plan"),
    { timeout: 10000 },
  );
  const patchResponsePromise = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/sections/plan"),
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "保存本节" }).click();
  const [patchRequest, patchResponse] = await Promise.all([patchRequestPromise, patchResponsePromise]);
  const patchRequestBody = patchRequest.postDataJSON();
  const patch = await patchResponse.json();
  await page.waitForFunction(
    (version) => document.querySelector(".version")?.textContent?.trim() === `v${version}`,
    patch.version,
    { timeout: 10000 },
  );
  await sleep(300);
  const versionAfter = (await page.locator(".version").innerText()).trim();
  const after = await readBudgetTotals(page);
  await shot(page, "06-budget-after.png");

  const detailResponse = await ctx.request.get(`${API}/api/v1/plans/${planId}`, {
    headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("token"))}` },
  });
  const detail = await detailResponse.json();
  const budget = patch.data.budget;
  const checks = {
    itemsTotal: Number(budget.items_total_yuan) === 2808,
    contingency: Number(budget.contingency_yuan) === 500,
    planned: Number(budget.planned_yuan) === 3308,
    plannedPage: after["计划合计"] === money(3308),
    versionIncremented: versionAfter === `v${patch.version}`,
    persisted: Number(detail.content?.plan?.budget?.planned_yuan) === 3308,
  };

  saveJson("06-budget.json", {
    caseStartedAt: nowIso(),
    planTitle: "预算合计验证活动方案",
    planId,
    planCreation: { status: createResponse.status(), body: createBody },
    versionBefore,
    versionAfter,
    before,
    previewWithContingency500: preview,
    patchRequestBody,
    patchResponse: { status: patchResponse.status(), version: patch.version, budget },
    after,
    serverDetail: {
      version: detail.version,
      budget: detail.content?.plan?.budget,
    },
    assertions: checks,
  });

  const expected = "新建 120 人/3600 元方案；预备金改为 500 后，服务端返回 items_total_yuan=2808、planned_yuan=3308；页面计划合计显示 ¥ 3,308.00；version+1";
  const actual = `服务端 items_total=${budget.items_total_yuan}、contingency=${budget.contingency_yuan}、planned=${budget.planned_yuan}；页面计划合计=${after["计划合计"]}；version ${versionBefore}->${versionAfter}`;
  const pass = Object.values(checks).every(Boolean);
  addResult(
    "6",
    "11.1 A7 / README 联调自检",
    "demo_studio 登录 -> 新建「预算合计验证」120 人/3600 元 -> 预算编辑 -> 预备金填 500 -> 保存 -> 对比响应与页面",
    expected,
    actual,
    pass ? "PASS" : "FAIL",
    "evidence/06-budget.json；screenshots/06-budget-before/editing-contingency-500/after.png",
    { checks },
  );
  await ctx.close();
  return pass;
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const health = await fetch(`${API}/healthz`).then((r) => r.json());
  mockState.healthAtStart = health;
  saveJson("00-mock-state.json", { ...mockState, recordedAt: nowIso() });

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  let run = null;
  try {
    try {
      await runCase1(browser);
    } catch (error) {
      addResult("1", "11.1 A1", "未登录 401 / 跳登录 / 登录回原页", "全部通过", String(error), "FAIL", "evidence/01-unauth.json", { error: String(error) });
    }

    try {
      run = await runCase2And3(browser);
    } catch (error) {
      addResult("2", "11.1 A2", "新建并提交方案", "202 且请求体正确", String(error), "FAIL", "evidence/02-generate-request.json", { error: String(error) });
      addResult("3", "11.1 A2", "进度页/刷新恢复", "202->轮询->详情，刷新恢复", "被用例 2 阻塞", "BLOCK", "evidence/03-generation.json", { error: String(error) });
    }

    if (run) {
      try {
        await runCase4(run);
      } catch (error) {
        addResult("4", "11.1 A3", "10 章节渲染与映射", "全部渲染", String(error), "FAIL", "evidence/04-sections.json", { error: String(error) });
      }
      try {
        await runCase5(run);
      } catch (error) {
        addResult("5", "11.1 A7", "物资编辑", "服务端值回显", String(error), "FAIL", "evidence/05-materials.json", { error: String(error) });
      }
      await run.ctx.close();
    } else {
      addResult("4", "11.1 A3", "10 章节渲染与映射", "全部渲染", "被用例 2/3 阻塞", "BLOCK", "—", {});
      addResult("5", "11.1 A7", "物资编辑", "服务端值回显", "被用例 2/3 阻塞", "BLOCK", "—", {});
    }

    try {
      await runCase6(browser);
    } catch (error) {
      addResult("6", "11.1 A7", "预算预备金 500", "2808+500=3308", String(error), "FAIL", "evidence/06-budget.json", { error: String(error) });
    }
  } finally {
    await browser.close();
    saveJson("99-console-errors.json", { consoleErrors, pageErrors, failedRequests });
    saveJson("results-round1.json", { generatedAt: nowIso(), mockState, results });
    console.log(JSON.stringify({ results, consoleErrors, pageErrors, failedRequests }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
