/**
 * 活动智囊 · 2026-11-07 接口级补测：真实后端（临时 8083 + 临时 SQLite）
 * 目的：devmock 未实现 duplicate/delete，用真实后端验证 T17/T18；顺带确认真实后端的 T01/T15。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVID = path.join(OUT, "evidence");
const BACKEND = path.resolve(OUT, "../../../raungong-main/backend");
const PYTHON = path.join(BACKEND, ".venv", "Scripts", "python.exe");
const DB_PATH = path.join(EVID, "round2-backend.db");
const DB_URL = `sqlite+aiosqlite:///${DB_PATH.replace(/\\/g, "/")}`;
const BASE = "http://127.0.0.1:8083";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const logPath = path.join(EVID, "real-backend.log");
fs.writeFileSync(logPath, "", "utf8");

function suffix() {
  return `${Date.now().toString(36).slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function api(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

async function waitHealth(timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return await res.json();
    } catch {
      /* not ready */
    }
    await sleep(500);
  }
  throw new Error(`healthz timeout after ${timeoutMs}ms`);
}

async function waitTask(token, taskId, timeoutMs = 30000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await api(`/api/v1/tasks/${taskId}`, { token });
    if (last.json?.status === "succeeded" || last.json?.status === "failed") return last;
    await sleep(500);
  }
  return last;
}

function payload(theme) {
  return {
    theme,
    activity_type: "welcome_party",
    participants: 100,
    budget_yuan: 2000,
    starts_at: "2026-11-20T19:00:00+08:00",
    duration_minutes: 120,
    location: "学校礼堂",
    target_audience: "新生",
    goals: ["真实后端接口测试"],
    constraints: "",
    tone: "lively",
    extra_notes: "",
  };
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  fs.rmSync(DB_PATH, { force: true });
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
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

  const results = [];
  const evidence = { backend: BACKEND, dbPath: DB_PATH, base: BASE };
  try {
    evidence.health = await waitHealth();
    const username = `real_${suffix()}`;
    const register = await api("/api/v1/auth/register", {
      method: "POST",
      body: { username, password: "test12345", display_name: "真实后端测试" },
    });
    const duplicateRegister = await api("/api/v1/auth/register", {
      method: "POST",
      body: { username, password: "test12345", display_name: "真实后端测试" },
    });
    const token = register.json.access_token;

    const plan1 = await api("/api/v1/plans/generate", { method: "POST", token, body: payload("复制方案真实后端") });
    const plan2 = await api("/api/v1/plans/generate", { method: "POST", token, body: payload("软删除真实后端") });
    const task1 = await waitTask(token, plan1.json.task_id);
    const task2 = await waitTask(token, plan2.json.task_id);
    const detail1Before = await api(`/api/v1/plans/${plan1.json.plan_id}`, { token });

    // T17 复制方案
    const duplicate = await api(`/api/v1/plans/${plan1.json.plan_id}/duplicate`, {
      method: "POST",
      token,
      body: {},
    });
    const detail1After = await api(`/api/v1/plans/${plan1.json.plan_id}`, { token });
    const duplicateDetail = duplicate.json?.id
      ? await api(`/api/v1/plans/${duplicate.json.id}`, { token })
      : { status: 0, json: null };
    const t17 = {
      taskStatus1: task1?.json?.status,
      taskStatus2: task2?.json?.status,
      originalPlanId: plan1.json.plan_id,
      duplicateStatus: duplicate.status,
      duplicatePlanId: duplicate.json?.id,
      newId: duplicate.json?.id && duplicate.json.id !== plan1.json.plan_id,
      originalVersionBefore: detail1Before.json?.version,
      originalVersionAfter: detail1After.json?.version,
      originalContentUnchanged:
        JSON.stringify(detail1Before.json?.content) === JSON.stringify(detail1After.json?.content),
      duplicateMatchesOriginal:
        JSON.stringify(duplicateDetail.json?.content) === JSON.stringify(detail1Before.json?.content),
    };
    results.push({
      id: "T17",
      source: "16.2",
      status: t17.newId && duplicate.status === 201 && t17.originalContentUnchanged && t17.duplicateMatchesOriginal ? "PASS" : "FAIL",
      actual: `duplicate=${duplicate.status}，新 ID=${t17.newId}，原方案 version ${t17.originalVersionBefore}->${t17.originalVersionAfter}，内容不变=${t17.originalContentUnchanged}，副本内容一致=${t17.duplicateMatchesOriginal}`,
      evidence: "evidence/interface-real-backend.json#T17",
      checks: t17,
    });

    // T18 软删除
    const beforeDeleteList = await api("/api/v1/plans?page=1&page_size=100", { token });
    const deleted = await api(`/api/v1/plans/${plan2.json.plan_id}`, { method: "DELETE", token });
    const afterDeleteGet = await api(`/api/v1/plans/${plan2.json.plan_id}`, { token });
    const afterDeleteList = await api("/api/v1/plans?page=1&page_size=100", { token });
    const t18 = {
      deleteStatus: deleted.status,
      getAfterDelete: afterDeleteGet.status,
      inListBefore: beforeDeleteList.json?.items?.some((item) => item.id === plan2.json.plan_id),
      inListAfter: afterDeleteList.json?.items?.some((item) => item.id === plan2.json.plan_id),
    };
    results.push({
      id: "T18",
      source: "16.2",
      status: t18.deleteStatus === 204 && t18.getAfterDelete === 404 && t18.inListBefore && !t18.inListAfter ? "PASS" : "FAIL",
      actual: `DELETE=${t18.deleteStatus}；删除后 GET=${t18.getAfterDelete}；列表删除前包含=${t18.inListBefore}，删除后包含=${t18.inListAfter}`,
      evidence: "evidence/interface-real-backend.json#T18",
      checks: t18,
    });

    // 顺带确认真实后端的 T01/T15 行为
    const t01 = {
      status: duplicateRegister.status,
      body: duplicateRegister.json,
      hasStructuredCode: Boolean(duplicateRegister.json?.code || duplicateRegister.json?.detail?.code || duplicateRegister.json?.error?.code),
    };
    results.push({
      id: "T01-real",
      source: "16.2",
      status: t01.status === 409 && t01.hasStructuredCode ? "PASS" : "FAIL",
      actual: `重复注册=${t01.status}，body=${JSON.stringify(t01.body)}，结构化错误码=${t01.hasStructuredCode}`,
      evidence: "evidence/interface-real-backend.json#T01",
      checks: t01,
    });
    const pdf = await api(`/api/v1/plans/${plan1.json.plan_id}/export?format=pdf`, { token });
    results.push({
      id: "T15-real",
      source: "16.2",
      status: pdf.status === 501 ? "PASS" : "FAIL",
      actual: `export?format=pdf=${pdf.status}，body=${pdf.text}`,
      evidence: "evidence/interface-real-backend.json#T15",
      checks: { status: pdf.status, body: pdf.text, expected: 501, expectedCode: "PDF_NOT_ENABLED" },
    });

    evidence.username = username;
    evidence.registerStatus = register.status;
    evidence.taskStatuses = { task1: task1?.json?.status, task2: task2?.json?.status };
    evidence.T17 = t17;
    evidence.T18 = t18;
    evidence.T01 = t01;
    evidence.T15 = { status: pdf.status, body: pdf.text };
    evidence.results = results;
  } finally {
    saveEvidence(evidence, results);
    child.kill();
    await sleep(500);
    if (child.exitCode === null) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    }
    logStream.end();
  }
}

function saveEvidence(evidence, results) {
  fs.writeFileSync(
    path.join(EVID, "interface-real-backend.json"),
    JSON.stringify({ generatedAt: nowIso(), evidence, results }, null, 2),
    "utf8",
  );
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((error) => {
  const results = [{ id: "REAL", status: "BLOCK", actual: String(error) }];
  saveEvidence({ error: String(error) }, results);
  console.error(error);
  process.exitCode = 1;
});
