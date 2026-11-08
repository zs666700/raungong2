/**
 * D1 / T01 复测：重复注册必须返回 409 + USERNAME_TAKEN。
 * 覆盖：devmock API、真实后端 API、注册页 UI。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVID = path.join(OUT, "evidence");
const SHOTS = path.join(OUT, "screenshots");
const MOCK = "http://127.0.0.1:8082";
const UI = "http://127.0.0.1:5173";
const REAL = "http://127.0.0.1:8083";
const BACKEND = path.resolve(OUT, "../../../raungong-main/backend");
const PYTHON = path.join(BACKEND, ".venv", "Scripts", "python.exe");
const DB_PATH = path.join(EVID, "retest-T01.db");
const DB_URL = `sqlite+aiosqlite:///${DB_PATH.replace(/\\/g, "/")}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

function saveJson(name, data) {
  fs.writeFileSync(path.join(EVID, name), JSON.stringify(data, null, 2), "utf8");
}

function suffix() {
  return `${Date.now().toString(36).slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function api(base, pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: response.status, text, json };
}

async function waitHealth(base, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return await res.json();
    } catch {
      /* not ready */
    }
    await sleep(500);
  }
  throw new Error(`healthz timeout: ${base}`);
}

async function checkD1(base, username, label) {
  const body = { username, password: "test12345", display_name: "D1复测" };
  const first = await api(base, "/api/v1/auth/register", { method: "POST", body });
  const duplicate = await api(base, "/api/v1/auth/register", { method: "POST", body });
  const detail = duplicate.json?.detail;
  const code = detail?.code ?? duplicate.json?.code ?? null;
  const message = detail?.message ?? duplicate.json?.message ?? null;
  return {
    label,
    base,
    username,
    firstStatus: first.status,
    duplicateStatus: duplicate.status,
    duplicateBody: duplicate.json,
    code,
    message,
    pass: first.status === 201 && duplicate.status === 409 && code === "USERNAME_TAKEN" && message === "用户名已存在",
  };
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const startedAt = nowIso();
  const results = { startedAt, mock: null, real: null, ui: null, summary: "FAIL" };

  // 1. devmock API
  results.mock = await checkD1(MOCK, `d1_mock_${suffix()}`, "devmock");

  // 2. 真实后端 API（临时 8083 + 临时 SQLite）
  fs.rmSync(DB_PATH, { force: true });
  const logPath = path.join(EVID, "real-backend-retest.log");
  const logStream = fs.createWriteStream(logPath, { flags: "w" });
  const child = spawn(
    PYTHON,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8083"],
    {
      cwd: BACKEND,
      env: { ...process.env, DATABASE_URL: DB_URL, AGENT_PROVIDER: "mock" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  try {
    results.realHealth = await waitHealth(REAL);
    results.real = await checkD1(REAL, `d1_real_${suffix()}`, "real-backend");
  } catch (error) {
    results.real = { label: "real-backend", error: String(error), pass: false };
  } finally {
    child.kill();
    await sleep(500);
    if (child.exitCode === null) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    }
    logStream.end();
  }

  // 3. 注册页 UI（devmock）
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const uiUsername = `d1_ui_${suffix()}`;
    const password = "test12345";
    const viewport = { width: 1440, height: 960 };

    const ctxA = await browser.newContext({ viewport });
    const pageA = await ctxA.newPage();
    await pageA.goto(`${UI}/login`, { waitUntil: "domcontentloaded" });
    await pageA.locator("#username").waitFor({ timeout: 15000 });
    await pageA.getByRole("tab", { name: "注册" }).click();
    await pageA.fill("#username", uiUsername);
    await pageA.fill("#displayName", "D1复测");
    await pageA.fill("#password", password);
    await pageA.fill("#confirm", password);
    const successResponsePromise = pageA.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().endsWith("/api/v1/auth/register"),
      { timeout: 15000 },
    );
    await pageA.getByRole("button", { name: "注册并进入工作台" }).click();
    const successResponse = await successResponsePromise;
    await pageA.waitForURL((url) => url.origin === UI && url.pathname === "/", { timeout: 15000 });

    const ctxB = await browser.newContext({ viewport });
    const pageB = await ctxB.newPage();
    await pageB.goto(`${UI}/login`, { waitUntil: "domcontentloaded" });
    await pageB.locator("#username").waitFor({ timeout: 15000 });
    await pageB.getByRole("tab", { name: "注册" }).click();
    await pageB.fill("#username", uiUsername);
    await pageB.fill("#displayName", "D1复测");
    await pageB.fill("#password", password);
    await pageB.fill("#confirm", password);
    const duplicateResponsePromise = pageB.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().endsWith("/api/v1/auth/register"),
      { timeout: 15000 },
    );
    await pageB.getByRole("button", { name: "注册并进入工作台" }).click();
    const duplicateResponse = await duplicateResponsePromise;
    const duplicateBody = await duplicateResponse.json();
    await pageB.locator(".server-error").waitFor({ timeout: 10000 });
    const serverError = (await pageB.locator(".server-error").innerText()).trim();
    await pageB.screenshot({ path: path.join(SHOTS, "retest-T01-ui-duplicate.png"), fullPage: true });

    results.ui = {
      username: uiUsername,
      firstRegisterStatus: successResponse.status(),
      duplicateStatus: duplicateResponse.status(),
      duplicateBody,
      serverError,
      screenshot: "screenshots/retest-T01-ui-duplicate.png",
      pass:
        successResponse.status() === 201 &&
        duplicateResponse.status() === 409 &&
        duplicateBody?.detail?.code === "USERNAME_TAKEN" &&
        serverError.includes("用户名已存在"),
    };
    await ctxA.close();
    await ctxB.close();
  } catch (error) {
    results.ui = { error: String(error), pass: false };
  } finally {
    await browser.close();
  }

  results.finishedAt = nowIso();
  const checks = [results.mock?.pass, results.real?.pass, results.ui?.pass];
  results.summary = checks.every(Boolean) ? "PASS" : "FAIL";
  saveJson("retest-T01.json", results);
  console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.summary === "PASS" ? 0 : 1;
}

main().catch((error) => {
  const results = { startedAt: nowIso(), fatal: String(error), summary: "FAIL" };
  saveJson("retest-T01.json", results);
  console.error(error);
  process.exitCode = 1;
});
