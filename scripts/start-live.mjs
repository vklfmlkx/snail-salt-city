// Explicit opt-in launcher. Standard dev/build/test keep their offline defaults.
// User explicitly authorized uncapped live testing; usage still persists.
import { runGuardedServer } from "./process-supervisor.mjs";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
// Read the user's local credential on the server. Do not let an inherited
// placeholder or dotenv interpolation silently replace the supplied value.
const local = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local", "utf8"))
  : {};
const key = local.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY;
if (!key?.trim()) throw Error("请先在本地 .env.local 填写 DEEPSEEK_API_KEY。");
const port = process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : "3002";
if (!/^\d{4,5}$/.test(port) || Number(port) > 65535)
  throw Error("invalid_port");
// A tunnel's public origin must be explicit; never trust forwarded request headers.
const appOrigin =
  local.APP_ORIGIN?.trim() ||
  process.env.APP_ORIGIN?.trim() ||
  `http://localhost:${port}`;
const originUrl = new URL(appOrigin);
if (
  originUrl.origin !== appOrigin ||
  !["http:", "https:"].includes(originUrl.protocol) ||
  (originUrl.protocol === "http:" &&
    !["localhost", "127.0.0.1"].includes(originUrl.hostname))
)
  throw Error("APP_ORIGIN must be HTTPS or local HTTP origin");
await runGuardedServer({
  port,
  env: {
    ...process.env,
    DEEPSEEK_API_KEY: key,
    LLM_MODEL_INTERPRETER: "deepseek-flash",
    LLM_MODEL_NARRATOR: "deepseek-flash",
    APP_ORIGIN: appOrigin,
    LLM_MODE: "live",
    AI_LIVE_ENABLED: "true",
    FEATURE_PLAYER_SCENARIO_GENERATION: "true",
    FEATURE_ZHIHU_API: "true",
    LLM_BUDGET_YUAN: "unlimited",
    LLM_GLOBAL_DAILY_CALL_LIMIT: "100",
    LLM_MAX_OUTPUT_TOKENS_NARRATOR: "2048",
    DEEPSEEK_THINKING_INTERPRETER: "disabled",
    DEEPSEEK_THINKING_NARRATOR: "disabled",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
