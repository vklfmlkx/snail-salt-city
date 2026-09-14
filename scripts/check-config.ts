// Read-only local audit. Never prints credentials, raw configuration or validation inputs.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { readConfig, liveReady } from "../src/server/config";
import { oauthReady } from "../src/server/zhihu-login";
try {
  const raw = parseEnv(readFileSync(".env.local", "utf8"));
  const names = [
    ...readFileSync("src/server/config.ts", "utf8").matchAll(
      /^  ([A-Z][A-Z0-9_]+):/gm,
    ),
  ].map((m) => m[1]);
  const c = readConfig(raw);
  console.log(
    JSON.stringify({
      source: ".env.local",
      valid: true,
      missingFields: names.filter((k) => !Object.hasOwn(raw, k)),
      ignoredFields: Object.keys(raw).filter((k) => !names.includes(k)),
      credentials: [
        "DEEPSEEK_API_KEY",
        "ZHIHU_OAUTH_APP_ID",
        "ZHIHU_OAUTH_APP_KEY",
      ].map((name) => ({ name, filled: !!raw[name]?.trim() })),
      callbackFilled: !!c.ZHIHU_OAUTH_REDIRECT_URI,
      productionOrigin: c.APP_ORIGIN.startsWith("https://"),
      generationEnabled:
        liveReady(c) && c.FEATURE_PLAYER_SCENARIO_GENERATION === "true",
      zhihuLoginReady: oauthReady(c),
      note: "Local start:live has explicit overrides. Deployment uses its own environment configuration.",
    }),
  );
} catch (e) {
  const fields =
    e && typeof e === "object" && "issues" in e && Array.isArray(e.issues)
      ? e.issues.map(
          (i: { path?: unknown[] }) => i.path?.join(".") ?? "unknown",
        )
      : [];
  console.log(
    JSON.stringify({
      valid: false,
      invalidFields: fields,
      message: "配置未通过检查；未输出配置内容或凭证。",
    }),
  );
  process.exitCode = 1;
}
