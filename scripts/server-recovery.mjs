import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const directory = mkdtempSync(join(tmpdir(), "snail-server-recovery-"));
const file = join(directory, "original.db"),
  restored = join(directory, "restored.db");
const origin = "http://localhost:3201";
let child;
async function start(database) {
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "localhost",
      "--port",
      "3201",
    ],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        APP_ORIGIN: origin,
        SQLITE_FILE: database,
        NEXT_TELEMETRY_DISABLED: "1",
        LLM_MODE: "mock",
        AI_LIVE_ENABLED: "false",
        LLM_GLOBAL_DAILY_CALL_LIMIT: "0",
        DEEPSEEK_API_KEY: "",
      },
    },
  );
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error("server failed to start");
    try {
      const r = await fetch(origin + "/api/scenarios");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("server startup timeout");
}
async function stop() {
  if (!child) return;
  const stopping = child;
  child = undefined;
  if (stopping.exitCode !== null || stopping.signalCode !== null) return;
  const closed = new Promise((r) => stopping.once("exit", r));
  stopping.kill();
  await closed;
}
async function run() {
  await start(file);
  let cookie = "",
    csrf = "";
  const call = async (path, data) => {
    const r = await fetch(origin + "/api/" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Snail-Request": "1",
        "X-CSRF-Token": csrf,
        Cookie: cookie,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    assert.ok(r.ok, "local API failure");
    return r.json();
  };
  const me = await call("visitor", {});
  csrf = me.csrfToken;
  const created = await call("sessions", {
    name: "重启恢复验收",
    background: "合成访客",
    stats: { body: 5, agility: 5, mind: 5, presence: 5 },
  });
  const id = created.state.id;
  const p = await call(`sessions/${id}/proposals`, {
    expectedStateVersion: 0,
    actionOptionId: "book.s1.key.body",
  });
  const input = {
    proposalId: p.proposal.id,
    clientTurnId: randomUUID(),
    expectedStateVersion: 0,
  };
  const original = await call(`sessions/${id}/turns`, input);
  await stop();
  await start(file);
  const replay = await call(`sessions/${id}/turns`, input);
  assert.deepEqual(replay, original);
  await stop();
  const db = new DatabaseSync(file);
  await backup(db, restored);
  db.close();
  await start(restored);
  const restoredResult = await call(`sessions/${id}/turns`, input);
  assert.deepEqual(restoredResult, original);
  assert.equal((await call(`sessions/${id}`)).state.turn, 1);
  await stop();
  console.log(
    JSON.stringify({
      serverProcessRestart: "PASS",
      sameVisitor: "PASS",
      sameDieAndResult: "PASS",
      sqliteConsistentBackupRestore: "PASS",
      modelRequests: 0,
      realUserData: false,
    }),
  );
}
try {
  await run();
} catch {
  process.exitCode = 1;
  console.error("server recovery FAILED (redacted)");
} finally {
  await stop();
  const target = resolve(directory);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !target.includes("snail-server-recovery-")
  )
    throw Error("unsafe cleanup target");
  rmSync(target, { recursive: true, force: true });
}
