import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "snail-e2e-"));
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "localhost",
    "--port",
    "3100",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      APP_ORIGIN: "http://localhost:3100",
      SQLITE_FILE: process.env.SNAIL_E2E_DB || join(dir, "test.db"),
      LLM_MODE: "mock",
      AI_LIVE_ENABLED: "false",
      LLM_GLOBAL_DAILY_CALL_LIMIT: "0",
      DEEPSEEK_API_KEY: "",
      FEATURE_ZHIHU_OAUTH: "false",
      FEATURE_ZHIHU_API: "false",
      ZHIHU_OAUTH_APP_ID: "",
      ZHIHU_OAUTH_APP_KEY: "",
      ZHIHU_OAUTH_REDIRECT_URI: "",
    },
  },
);
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
child.on("exit", (code) => process.exit(code ?? 0));
