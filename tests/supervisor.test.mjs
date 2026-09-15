import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import {
  supervise,
  restartDelay,
  assertPortAvailable,
  probeHealth,
} from "../scripts/process-supervisor.mjs";

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await sleep(20);
  }
  throw Error("condition timed out");
}
async function fixture(mode = "healthy") {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/api/health`;
  const events = [];
  const guard = supervise({
    args: [
      "-e",
      `const http=require('node:http');http.createServer((req,res)=>{if('${mode}'!=='hang')res.end('snail-ready');}).listen(${port},'127.0.0.1');`,
    ],
    healthUrl: url,
    stdio: "ignore",
    log: (e) => events.push(e),
    startupGraceMs: 350,
    intervalMs: 40,
    probeTimeoutMs: 80,
    baseDelayMs: 40,
    maxDelayMs: 100,
    stopGraceMs: 100,
  });
  return { guard, events, url };
}

test("restart delay grows and stays capped", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 100].map((n) => restartDelay(n)),
    [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000],
  );
});
test("crashed child is restarted; intentional stop never restarts", async () => {
  const { guard, events, url } = await fixture();
  try {
    await until(() => probeHealth(url, 100));
    const pid = guard.pid;
    process.kill(pid, "SIGKILL");
    await until(() => guard.pid && guard.pid !== pid);
    await until(() => probeHealth(url, 100));
    assert.equal(events.filter((e) => e.event === "restarting").length, 1);
    await guard.stop();
    const count = events.length;
    await sleep(200);
    assert.equal(events.length, count);
    assert.equal(await probeHealth(url, 100), false);
  } finally {
    await guard.stop();
  }
});
test("consecutive health timeouts recycle an unresponsive process", async () => {
  const { guard, events } = await fixture("hang");
  try {
    await until(() => events.some((e) => e.event === "unresponsive"));
    await until(() => events.filter((e) => e.event === "started").length >= 2);
    assert.deepEqual(
      events
        .filter((e) => e.event === "health-missed")
        .slice(0, 3)
        .map((e) => e.count),
      [1, 2, 3],
    );
  } finally {
    await guard.stop();
  }
});
test("spawn errors back off and stop cancels a pending restart", async () => {
  const events = [];
  const guard = supervise({
    command: "snail-nonexistent-executable",
    args: [],
    healthUrl: "http://127.0.0.1:1",
    stdio: "ignore",
    baseDelayMs: 200,
    log: (e) => events.push(e),
  });
  await until(() => events.some((e) => e.event === "restarting"));
  await guard.stop();
  await sleep(300);
  assert.equal(events.filter((e) => e.event === "restarting").length, 1);
});
test("busy port is rejected without touching its owner", async () => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(
      assertPortAvailable(server.address().port),
      /已被占用/,
    );
    assert.ok(server.listening);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
