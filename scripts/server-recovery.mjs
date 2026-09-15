import {
  supervise,
  assertPortAvailable,
  probeHealth,
} from "./process-supervisor.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const directory = mkdtempSync(join(tmpdir(), "snail-server-recovery-"));
const file = join(directory, "original.db"),
  restored = join(directory, "restored.db");
const origin = "http://127.0.0.1:3201";
let child;
async function start(database) {
  await assertPortAvailable(3201);
  child = supervise({
    args: [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3201",
    ],
    healthUrl: origin + "/api/health",
    baseDelayMs: 150,
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
      FEATURE_ZHIHU_OAUTH: "false",
      FEATURE_ZHIHU_API: "false",
      FEATURE_PLAYER_SCENARIO_GENERATION: "false",
      ZHIHU_OAUTH_APP_ID: "",
      ZHIHU_OAUTH_APP_KEY: "",
      ZHIHU_OAUTH_REDIRECT_URI: "",
    },
  });
  for (let i = 0; i < 100; i++) {
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
  await stopping.stop();
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
  let state = created.state;
  const id = state.id;
  if (state.script?.activity?.status === 0) {
    const q = await call(`sessions/${id}/activity`, {
      expectedStateVersion: state.version,
    });
    state = (
      await call(`sessions/${id}/activity`, {
        expectedStateVersion: state.version,
        challengeId: q.challenge.id,
        answers: [0],
      })
    ).state;
  }
  const p = await call(`sessions/${id}/proposals`, {
    expectedStateVersion: state.version,
    actionOptionId: state.actions[0].id,
  });
  const input = {
    proposalId: p.proposal.id,
    clientTurnId: randomUUID(),
    expectedStateVersion: state.version,
  };
  const original = await call(`sessions/${id}/turns`, input);
  const crashedPid = child.pid;
  process.kill(crashedPid, "SIGKILL");
  let recovered = false;
  for (let i = 0; i < 150; i++) {
    if (
      child.pid &&
      child.pid !== crashedPid &&
      (await probeHealth(origin + "/api/health", 500))
    ) {
      recovered = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(recovered, "supervisor did not restart game");
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
      automaticCrashRestart: "PASS",
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
