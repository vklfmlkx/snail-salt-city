import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { request } from "node:http";
import { createServer } from "node:net";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

export function restartDelay(failures, base = 2000, ceiling = 60000) {
  return Math.min(ceiling, base * 2 ** Math.min(failures, 16));
}

// Check only the local Node event loop, never a paid API or the public tunnel.
export function probeHealth(url, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(ok);
    };
    const req = request(url, { method: "GET", agent: false }, (res) => {
      let body = "";
      res.on("data", (part) => {
        body += part;
        if (body.length > 1024) req.destroy();
      });
      res.on("end", () =>
        finish(res.statusCode === 200 && body === "snail-ready"),
      );
      res.on("error", () => finish(false));
    });
    const deadline = setTimeout(() => {
      req.destroy();
      finish(false);
    }, timeout);
    req.on("error", () => finish(false));
    req.end();
  });
}

export async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(Error(`端口 ${port} 已被占用，请先停止原来的游戏服务。`)),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

export function fileLogger(path) {
  return (event) => {
    // Only supervisor metadata, never environment values or request content.
    console.log(`[守护] ${JSON.stringify(event)}`);
    try {
      mkdirSync(dirname(path), { recursive: true });
      try {
        if (statSync(path).size > 1024 * 1024) renameSync(path, `${path}.1`);
      } catch {}
      appendFileSync(
        path,
        JSON.stringify({ time: new Date().toISOString(), ...event }) + "\n",
      );
    } catch {
      // Full disk must not take the supervisor down as well.
    }
  };
}

/** Owns exactly one direct child. Never starts a replacement before it exits. */
export function supervise({
  command = process.execPath,
  args,
  env = process.env,
  cwd = process.cwd(),
  healthUrl,
  log = () => {},
  stdio = "inherit",
  intervalMs = 15000,
  probeTimeoutMs = 5000,
  startupGraceMs = 90000,
  failureThreshold = 3,
  stableMs = 120000,
  baseDelayMs = 2000,
  maxDelayMs = 60000,
  stopGraceMs = 10000,
}) {
  const events = new EventEmitter();
  let child,
    timer,
    killTimer,
    stopping = false,
    failures = 0;
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const report = (event) => {
    log(event);
    events.emit("status", event);
  };
  function terminate(target) {
    if (target.exitCode !== null || target.signalCode !== null) return;
    target.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (target.exitCode === null && target.signalCode === null)
        target.kill("SIGKILL");
    }, stopGraceMs);
  }
  function launch() {
    if (stopping) return;
    const started = Date.now();
    let unhealthy = 0,
      finished = false;
    child = spawn(command, args, { cwd, env, stdio, windowsHide: true });
    const current = child;
    current.once("spawn", () => report({ event: "started", pid: current.pid }));
    function exited(code, signal) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      child = undefined;
      report({ event: "exited", code, signal });
      if (stopping) {
        finish();
        return;
      }
      if (Date.now() - started >= stableMs) failures = 0;
      const delayMs = restartDelay(failures++, baseDelayMs, maxDelayMs);
      report({ event: "restarting", delayMs });
      timer = setTimeout(launch, delayMs);
    }
    current.on("error", () => {
      if (!current.pid) exited(null, "spawn-error");
      else report({ event: "child-control-error", pid: current.pid });
    });
    current.once("exit", exited);
    async function check() {
      if (stopping || finished || child !== current) return;
      const ok = await probeHealth(healthUrl, probeTimeoutMs);
      if (stopping || finished || child !== current) return;
      unhealthy = ok ? 0 : unhealthy + 1;
      if (!ok) report({ event: "health-missed", count: unhealthy });
      if (unhealthy >= failureThreshold) {
        report({ event: "unresponsive", pid: current.pid });
        terminate(current);
      } else timer = setTimeout(check, intervalMs);
    }
    timer = setTimeout(check, startupGraceMs);
  }
  function stop() {
    if (stopping) return done;
    stopping = true;
    clearTimeout(timer);
    report({ event: "stopping" });
    if (child) terminate(child);
    else finish();
    return done;
  }
  // Let the caller subscribe before the first spawn.
  timer = setTimeout(launch, 0);
  return {
    events,
    done,
    stop,
    get pid() {
      return child?.pid;
    },
  };
}

export async function runGuardedServer({ port, env = process.env }) {
  await assertPortAvailable(Number(port));
  const guard = supervise({
    args: [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    env,
    healthUrl: `http://127.0.0.1:${port}/api/health`,
    log: fileLogger("data/logs/supervisor.log"),
  });
  const stop = () => {
    void guard.stop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await guard.done;
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
