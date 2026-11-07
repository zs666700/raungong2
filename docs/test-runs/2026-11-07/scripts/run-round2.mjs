/**
 * 活动智囊 · 2026-11-07 第二轮验收脚本（用例 7–10）
 * 只通过页面发起请求并观察/改写响应做断言；不修改 src/ 或 devmock/。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
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

const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const mockState = {
  startedBeforeRound: true,
  restartsDuringRound: 0,
  healthAtStart: null,
  note: "第二轮开始时 Mock 仍为第一轮同一进程；本轮不重启。",
};

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function saveJson(name, data) {
  fs.writeFileSync(path.join(EVID, name), JSON.stringify(data, null, 2), "utf8");
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

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#username", DEMO.username);
  await page.fill("#password", DEMO.password);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.waitForURL((url) => url.origin === BASE && url.pathname === "/", { timeout: 15000 });
}

async function register(page, username, displayName = "第二轮测试") {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "注册" }).click();
  await page.fill("#username", username);
  await page.fill("#displayName", displayName);
  await page.fill("#password", "test12345");
  await page.fill("#confirm", "test12345");
  await page.getByRole("button", { name: "注册并进入工作台" }).click();
  await page.waitForURL((url) => url.origin === BASE && url.pathname === "/", { timeout: 15000 });
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

async function createReadyPlan(page, { theme, type = "迎新晚会", participants = "100", budget = "2000", location = "学校礼堂" }) {
  await page.goto(`${BASE}/plans/new`, { waitUntil: "networkidle" });
  await page.fill("#theme", theme);
  await page.locator(".type-option").filter({ hasText: type }).click();
  await page.fill("#location", location);
  await page.fill("#participants", participants);
  await page.fill("#budget", budget);
  const responsePromise = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().endsWith("/api/v1/plans/generate"),
    { timeout: 15000 },
  );
  await page.locator(".aside-actions button[type=submit]").click();
  const response = await responsePromise;
  const body = await response.json();
  await page.waitForURL(new RegExp(`/plans/${body.plan_id}$`), { timeout: 30000 });
  await page.locator(".plan-title").waitFor({ timeout: 10000 });
  return { status: response.status(), body, planId: body.plan_id, title: (await page.locator(".plan-title").innerText()).trim() };
}

async function runCase7(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const pageA = await ctx.newPage();
  attach(pageA, "case7-A");
  await login(pageA);
  const suffix = Date.now().toString().slice(-6);
  const created = await createReadyPlan(pageA, { theme: `409 冲突用例 ${suffix}` });
  const planUrl = `${BASE}/plans/${created.planId}`;
  const versionBefore = (await pageA.locator(".version").innerText()).trim();

  const pageB = await ctx.newPage();
  attach(pageB, "case7-B");
  await pageB.goto(planUrl, { waitUntil: "networkidle" });
  await pageB.locator(".plan-title").waitFor({ timeout: 10000 });

  // 两个页面都在 A 保存之前进入编辑状态，确保 B 拿着旧 version。
  await openSection(pageA, "物资");
  await openSection(pageB, "物资");
  await pageA.getByRole("button", { name: "编辑本节" }).click();
  await pageB.getByRole("button", { name: "编辑本节" }).click();
  const qtyA = pageA.locator(".edit-card").first().locator('input[type="number"]').first();
  const qtyB = pageB.locator(".edit-card").first().locator('input[type="number"]').first();
  await qtyA.waitFor({ timeout: 5000 });
  await qtyB.waitFor({ timeout: 5000 });
  await qtyA.fill("2");
  await qtyB.fill("4");
  await sleep(200);

  const aRequestPromise = pageA.waitForRequest(
    (req) => req.method() === "PATCH" && req.url().includes("/sections/materials"),
    { timeout: 10000 },
  );
  const aResponsePromise = pageA.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/sections/materials"),
    { timeout: 10000 },
  );
  await pageA.getByRole("button", { name: "保存本节" }).click();
  const [aRequest, aResponse] = await Promise.all([aRequestPromise, aResponsePromise]);
  const aRequestBody = aRequest.postDataJSON();
  const aResponseBody = await aResponse.json();
  await pageA.waitForFunction(
    (version) => document.querySelector(".version")?.textContent?.trim() === `v${version}`,
    aResponseBody.version,
    { timeout: 10000 },
  );

  const bRequestPromise = pageB.waitForRequest(
    (req) => req.method() === "PATCH" && req.url().includes("/sections/materials"),
    { timeout: 10000 },
  );
  const bResponsePromise = pageB.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/sections/materials"),
    { timeout: 10000 },
  );
  await pageB.getByRole("button", { name: "保存本节" }).click();
  const [bRequest, bResponse] = await Promise.all([bRequestPromise, bResponsePromise]);
  const bRequestBody = bRequest.postDataJSON();
  const bStatus = bResponse.status();
  const bResponseBody = await bResponse.json();
  await pageB.locator(".el-message-box").waitFor({ timeout: 8000 });
  const dialogText = (await pageB.locator(".el-message-box").innerText()).trim();
  await shot(pageB, "07-conflict-dialog.png");
  await pageB.getByRole("button", { name: "载入最新版本" }).click();
  await pageB.waitForFunction(
    (version) => document.querySelector(".version")?.textContent?.trim() === `v${version}`,
    aResponseBody.version,
    { timeout: 10000 },
  );
  await openSection(pageB, "物资");
  const qtyAfter = (await pageB.locator(".materials-table tbody tr").first().locator('td[data-label="数量"]').innerText()).trim();
  const versionAfter = (await pageB.locator(".version").innerText()).trim();
  await shot(pageB, "07-after-conflict-reload.png");

  const checks = {
    aSave200: aResponse.status() === 200,
    aVersionBumped: Number(aResponseBody.version) === Number(versionBefore.replace("v", "")) + 1,
    bothOldVersion: Number(aRequestBody.version) === Number(versionBefore.replace("v", "")) && Number(bRequestBody.version) === Number(versionBefore.replace("v", "")),
    bSave409: bStatus === 409,
    bCodeVersionConflict: bResponseBody?.detail?.code === "VERSION_CONFLICT",
    bCurrentVersion2: Number(bResponseBody?.detail?.current_version) === Number(aResponseBody.version),
    dialogMentionsLatest: dialogText.includes(`当前版本为 v${aResponseBody.version}`) && dialogText.includes("版本冲突"),
    reloadedLatestVersion: versionAfter === `v${aResponseBody.version}`,
    contentNotOverwritten: qtyAfter.startsWith("2"),
  };

  saveJson("07-conflict.json", {
    caseStartedAt: nowIso(),
    planId: created.planId,
    planTitle: created.title,
    versionBefore,
    pageA: { request: aRequestBody, responseStatus: aResponse.status(), response: aResponseBody },
    pageB: { request: bRequestBody, responseStatus: bStatus, response: bResponseBody, dialogText, versionAfter, qtyAfter },
    assertions: checks,
  });

  const expected = "A 保存成功 version+1；B 用旧 version 保存返回 409 VERSION_CONFLICT；弹窗提示并载入最新版本；内容保持 A 的修改，不被 B 覆盖";
  const actual = `A=${aResponse.status()} v${aResponseBody.version}；B=${bStatus} ${bResponseBody?.detail?.code ?? ""} current_version=${bResponseBody?.detail?.current_version}；弹窗含最新版本=${checks.dialogMentionsLatest}；B 重载后 ${versionAfter}，第一项数量=${qtyAfter}`;
  const pass = Object.values(checks).every(Boolean);
  addResult("7", "11.1 A8", "同一用户两个标签页同时编辑物资；A 先保存；B 用旧 version 保存；载入最新版本", expected, actual, pass ? "PASS" : "FAIL", "evidence/07-conflict.json；screenshots/07-conflict-dialog.png；screenshots/07-after-conflict-reload.png", { checks });
  return { ctx, pageA, pageB, created, versionAfter: aResponseBody.version, pass };
}

async function runCase8(browser, run) {
  const { pageA, created } = run;
  const downloadPromise = pageA.waitForEvent("download", { timeout: 15000 });
  const responsePromise = pageA.waitForResponse(
    (res) => res.request().method() === "GET" && res.url().includes("/export"),
    { timeout: 15000 },
  );
  await pageA.getByRole("button", { name: /Markdown/ }).click();
  const [download, response] = await Promise.all([downloadPromise, responsePromise]);
  const filename = download.suggestedFilename();
  const exportPath = path.join(EVID, "08-export.md");
  // 先写系统临时目录，再复制到证据目录，避免 Vite watcher 在 Windows 上锁住文件（EBUSY）。
  const tempExportPath = path.join(os.tmpdir(), `activity-mind-export-${Date.now()}.md`);
  await download.saveAs(tempExportPath);
  const content = fs.readFileSync(tempExportPath, "utf8");
  fs.copyFileSync(tempExportPath, exportPath);
  fs.unlinkSync(tempExportPath);
  const headers = response.headers();
  const headings = content.split(/\r?\n/).filter((line) => line.startsWith("## ")).map((line) => line.replace(/^##\s+/, ""));
  const byteLength = fs.statSync(exportPath).size;
  const hasReplacementChar = content.includes("�");
  const requiredPhrases = ["活动概览", "物资清单", "任务分工", "宣传方案", "风险与复盘"];
  await shot(pageA, "08-export-page.png");

  const checks = {
    status200: response.status() === 200,
    contentTypeMarkdown: (headers["content-type"] ?? "").includes("text/markdown"),
    hasFilenameStar: (headers["content-disposition"] ?? "").includes("filename*=UTF-8''"),
    chineseFilename: /[一-龥]/.test(filename) && filename.endsWith(".md"),
    headingsAtLeast10: headings.length >= 10,
    requiredPhrases: requiredPhrases.every((phrase) => content.includes(phrase)),
    noReplacementChar: !hasReplacementChar,
  };

  saveJson("08-export.json", {
    caseStartedAt: nowIso(),
    planId: created.planId,
    planTitle: created.title,
    response: { status: response.status(), contentType: headers["content-type"], contentDisposition: headers["content-disposition"] },
    suggestedFilename: filename,
    savedTo: "evidence/08-export.md",
    byteLength,
    headings,
    requiredPhrases,
    hasReplacementChar,
    assertions: checks,
  });

  const expected = "blob 下载；响应 200、text/markdown；filename* 解析出中文文件名；Markdown UTF-8 无乱码且含全部章节";
  const actual = `200=${response.status()}；content-type=${headers["content-type"]}；filename=${filename}；标题=${headings.join(" / ")}；字节=${byteLength}；替换字符=${hasReplacementChar}`;
  const pass = Object.values(checks).every(Boolean);
  addResult("8", "11.1 A9", "详情页点击 Markdown；捕获下载和 /export 响应；读取文件校验文件名/编码/章节", expected, actual, pass ? "PASS" : "FAIL", "evidence/08-export.json；evidence/08-export.md；screenshots/08-export-page.png", { checks });
  return pass;
}

async function runCase9(browser, run) {
  const { pageA, created } = run;
  await pageA.goto(`${BASE}/plans/${created.planId}/print`, { waitUntil: "networkidle" });
  await pageA.locator(".print-document").waitFor({ timeout: 10000 });
  const sectionCount = await pageA.locator(".print-document .doc-section").count();
  await pageA.emulateMedia({ media: "print" });
  await pageA.setViewportSize({ width: 794, height: 1123 });
  await sleep(300);
  await shot(pageA, "09-print-a4-794.png");

  await pageA.setViewportSize({ width: 680, height: 1123 });
  await sleep(300);
  const layout = await pageA.evaluate(() => {
    const tables = [...document.querySelectorAll(".print-document table")].map((table, index) => ({
      index,
      tag: table.className,
      clientWidth: table.clientWidth,
      scrollWidth: table.scrollWidth,
      rectWidth: Math.round(table.getBoundingClientRect().width),
      parentClientWidth: table.parentElement?.clientWidth ?? null,
      parentScrollWidth: table.parentElement?.scrollWidth ?? null,
      overflowX: table.scrollWidth > table.clientWidth + 1,
      outsideViewport: table.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
    }));
    return {
      viewportWidth: window.innerWidth,
      bodyClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.documentElement.scrollWidth,
      tables,
    };
  });
  await shot(pageA, "09-print-a4-content-680.png");

  const pdfPath = path.join(EVID, "09-print.pdf");
  const tempPdfPath = path.join(os.tmpdir(), `activity-mind-print-${Date.now()}.pdf`);
  await pageA.pdf({ path: tempPdfPath, printBackground: true, preferCSSPageSize: true });
  const pdfBytes = fs.readFileSync(tempPdfPath);
  fs.copyFileSync(tempPdfPath, pdfPath);
  fs.unlinkSync(tempPdfPath);
  const pdfLatin = pdfBytes.toString("latin1");
  const mediaBoxes = [...pdfLatin.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) => m[1].trim());
  const pageCount = (pdfLatin.match(/\/Type\s*\/Page\b/g) ?? []).length;
  const pdfSize = pdfBytes.length;

  const tablesOverflow = layout.tables.filter((table) => table.overflowX || table.outsideViewport);
  const checks = {
    tenSections: sectionCount === 10,
    noTableOverflow: tablesOverflow.length === 0,
    noBodyHorizontalScroll: layout.bodyScrollWidth <= layout.bodyClientWidth + 1,
    pdfGenerated: pdfSize > 1000,
    a4MediaBox: mediaBoxes.length > 0 && mediaBoxes.every((box) => {
      const [x0, y0, x1, y1] = box.split(/\s+/).map(Number);
      return Math.abs(x0) < 1 && Math.abs(y0) < 1 && x1 > 590 && x1 < 600 && y1 > 838 && y1 < 846;
    }),
  };

  saveJson("09-print.json", {
    caseStartedAt: nowIso(),
    planId: created.planId,
    sectionCount,
    checkViewportWidth: 680,
    layout,
    tablesOverflow,
    pdf: { path: "evidence/09-print.pdf", bytes: pdfSize, mediaBoxes, pageCount },
    assertions: checks,
    note: "680px 近似 A4 内容宽度（210mm - 左右各 15mm ≈ 180mm ≈ 680px）；PDF 由 Playwright 按 CSS @page A4 生成。",
  });

  const expected = "A4 下 10 个章节全渲染；所有表格无横向溢出；生成 A4 PDF 且 MediaBox 为 595×842pt";
  const actual = `章节=${sectionCount}；溢出表=${tablesOverflow.length}；body scrollWidth/clientWidth=${layout.bodyScrollWidth}/${layout.bodyClientWidth}；PDF=${pdfSize}B，页数=${pageCount}，MediaBox=${mediaBoxes.join(" | ")}`;
  const pass = Object.values(checks).every(Boolean);
  addResult("9", "11.1 A10", "打印预览页；print media + A4 内容宽度 680px 检查表格；生成 A4 PDF", expected, actual, pass ? "PASS" : "FAIL", "evidence/09-print.json；evidence/09-print.pdf；screenshots/09-print-a4-794.png；screenshots/09-print-a4-content-680.png", { checks });
  return pass;
}

async function runFailureScenario(browser, { theme, code, message, screenshot }) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  attach(page, `case10-${code}`);
  const username = `r2f_${Date.now().toString(36).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  await register(page, username, "失败态测试");

  let ids = null;
  let resolveIds;
  const idsReady = new Promise((resolve) => {
    resolveIds = resolve;
  });
  await page.route(/\/api\/v1\/tasks\//, async (route) => {
    if (!ids) await idsReady;
    const stamp = nowIso();
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        task_id: ids.task_id,
        plan_id: ids.plan_id,
        type: "generate",
        section_key: null,
        status: "failed",
        stage: null,
        progress: 0,
        message: "生成失败",
        attempt: 1,
        error: { code, message, retryable: true },
        created_at: stamp,
        started_at: stamp,
        finished_at: stamp,
      }),
    });
  });

  await page.goto(`${BASE}/plans/new`, { waitUntil: "networkidle" });
  await page.fill("#theme", theme);
  await page.locator(".type-option").filter({ hasText: "其他活动" }).click();
  await page.fill("#location", "线上会议室");
  await page.fill("#participants", "100");
  await page.fill("#budget", "2000");
  const responsePromise = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().endsWith("/api/v1/plans/generate"),
    { timeout: 15000 },
  );
  await page.locator(".aside-actions button[type=submit]").click();
  const response = await responsePromise;
  const responseBody = await response.json();
  ids = { task_id: responseBody.task_id, plan_id: responseBody.plan_id };
  resolveIds();
  await page.waitForURL(new RegExp(`/plans/${ids.plan_id}/generating$`), { timeout: 15000 });
  await page.locator(".outcome-code").waitFor({ timeout: 10000 });
  await page.waitForFunction(
    (expected) => document.querySelector(".outcome-code")?.textContent?.includes(expected),
    code,
    { timeout: 5000 },
  );
  const outcomeCode = (await page.locator(".outcome-code").innerText()).trim();
  const outcomeText = (await page.locator(".outcome").innerText()).trim();
  const retryVisible = await page.getByRole("button", { name: "重新填写并生成" }).isVisible();
  await shot(page, screenshot);
  const checks = {
    status202: response.status() === 202,
    codeShown: outcomeCode.includes(code),
    retryableShown: outcomeCode.includes("可重试"),
    retryEntryVisible: retryVisible,
  };
  return {
    ctx,
    page,
    data: {
      theme,
      code,
      message,
      createStatus: response.status(),
      createResponse: responseBody,
      interceptedTask: { status: "failed", error: { code, message, retryable: true } },
      outcomeCode,
      outcomeText,
      retryVisible,
      assertions: checks,
    },
  };
}

async function runCase10(browser) {
  const timeout = await runFailureScenario(browser, {
    theme: "失败态超时用例",
    code: "AGENT_TIMEOUT",
    message: "智能体响应超时，请稍后重试",
    screenshot: "10-failure-timeout.png",
  });
  const invalid = await runFailureScenario(browser, {
    theme: "失败态非法JSON用例",
    code: "AGENT_OUTPUT_INVALID",
    message: "智能体返回内容中没有 JSON 对象",
    screenshot: "10-failure-invalid-json.png",
  });

  // 验证重试入口确实指向重新填写页（不重新生成同一任务）。
  await timeout.page.getByRole("button", { name: "重新填写并生成" }).click();
  await timeout.page.waitForURL((url) => url.origin === BASE && url.pathname === "/plans/new", { timeout: 10000 });
  const retryPath = new URL(timeout.page.url()).pathname;

  saveJson("10-failure.json", {
    caseStartedAt: nowIso(),
    scenarios: [timeout.data, invalid.data],
    retryPath,
    note: "AGENT_TIMEOUT 与 AGENT_OUTPUT_INVALID 由 Playwright 拦截 GET /tasks/{id} 并返回 failed 任务触发；devmock 原生只支持主题含“失败”的 MOCK_GENERATION_FAILED。",
  });

  const checks = [...Object.values(timeout.data.assertions), ...Object.values(invalid.data.assertions), retryPath === "/plans/new"];
  const pass = checks.every(Boolean);
  const actual = `AGENT_TIMEOUT: code=${timeout.data.outcomeCode}，按钮=${timeout.data.retryVisible}；AGENT_OUTPUT_INVALID: code=${invalid.data.outcomeCode}，按钮=${invalid.data.retryVisible}；重试入口=${retryPath}`;
  addResult("10", "11.1 A13", "新建两个方案；分别拦截任务响应为 AGENT_TIMEOUT / AGENT_OUTPUT_INVALID；断言错误码与重试入口", "展示对应错误码 + 可重试；重试入口可进入重新填写页", actual, pass ? "PASS" : "FAIL", "evidence/10-failure.json；screenshots/10-failure-timeout.png；screenshots/10-failure-invalid-json.png", { checks });
  await timeout.ctx.close();
  await invalid.ctx.close();
  return pass;
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  mockState.healthAtStart = await fetch(`${API}/healthz`).then((r) => r.json());
  saveJson("20-mock-state-round2.json", { ...mockState, recordedAt: nowIso() });

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  let run7 = null;
  try {
    try {
      run7 = await runCase7(browser);
    } catch (error) {
      addResult("7", "11.1 A8", "两个标签页 409 冲突", "409 + 载入最新版本", String(error), "FAIL", "evidence/07-conflict.json", { error: String(error) });
    }
    if (run7) {
      try {
        await runCase8(browser, run7);
      } catch (error) {
        addResult("8", "11.1 A9", "导出 Markdown", "blob + 中文 filename* + 全章节", String(error), "FAIL", "evidence/08-export.json", { error: String(error) });
      }
      try {
        await runCase9(browser, run7);
      } catch (error) {
        addResult("9", "11.1 A10", "打印 A4", "表格不溢出 + A4 PDF", String(error), "FAIL", "evidence/09-print.json", { error: String(error) });
      }
      await run7.ctx.close();
    } else {
      addResult("8", "11.1 A9", "导出 Markdown", "blob + 中文 filename* + 全章节", "被用例 7 阻塞", "BLOCK", "—", {});
      addResult("9", "11.1 A10", "打印 A4", "表格不溢出 + A4 PDF", "被用例 7 阻塞", "BLOCK", "—", {});
    }

    try {
      await runCase10(browser);
    } catch (error) {
      addResult("10", "11.1 A13", "失败态 AGENT_TIMEOUT / 非法 JSON", "错误码 + 重试入口", String(error), "FAIL", "evidence/10-failure.json", { error: String(error) });
    }
  } finally {
    await browser.close();
    saveJson("29-console-errors.json", { consoleErrors, pageErrors, failedRequests });
    saveJson("results-round2.json", { generatedAt: nowIso(), mockState, results });
    console.log(JSON.stringify({ results, consoleErrors, pageErrors, failedRequests }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
