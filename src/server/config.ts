import { z } from "zod";
const number = (fallback: number, min = 0, max = 100000) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const schema = z.object({
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  SQLITE_FILE: z.string().default("./data/snail.db"),
  LLM_MODE: z.enum(["mock", "live"]).default("mock"),
  AI_LIVE_ENABLED: z.enum(["true", "false"]).default("false"),
  LLM_PROVIDER: z.literal("deepseek").default("deepseek"),
  LLM_API_STYLE: z
    .literal("openai_chat_completions")
    .default("openai_chat_completions"),
  LLM_BASE_URL: z
    .literal("https://api.deepseek.com")
    .default("https://api.deepseek.com"),
  LLM_API_PATH: z.literal("/chat/completions").default("/chat/completions"),
  DEEPSEEK_API_KEY: z.string().default(""),
  LLM_MODEL_INTERPRETER: z.string().min(1).default("deepseek-flash"),
  LLM_MODEL_NARRATOR: z.string().default("deepseek-flash"),
  LLM_OUTPUT_MODE: z.literal("json_object").default("json_object"),
  DEEPSEEK_THINKING_INTERPRETER: z
    .enum(["disabled", "enabled"])
    .default("disabled"),
  DEEPSEEK_THINKING_NARRATOR: z
    .enum(["disabled", "enabled"])
    .default("disabled"),
  DEEPSEEK_REASONING_EFFORT: z.enum(["high", "max"]).default("high"),
  LLM_INTERPRETER_TIMEOUT_MS: number(12000, 1, 120000),
  LLM_CUSTOM_TIMEOUT_MS: number(45000, 1, 120000),
  LLM_CUSTOM_MAX_OUTPUT_TOKENS: number(4096, 1, 8192),
  LLM_CUSTOM_MAX_ATTEMPTS: number(3, 1, 3),
  LLM_CUSTOM_TOTAL_TIMEOUT_MS: number(90000, 1, 180000),
  LLM_NARRATOR_TIMEOUT_MS: number(20000, 1, 120000),
  LLM_MAX_OUTPUT_TOKENS_INTERPRETER: number(512, 1, 4096),
  LLM_MAX_OUTPUT_TOKENS_NARRATOR: number(2048, 1, 4096),
  LLM_MAX_ATTEMPTS_PER_REQUEST: z.coerce
    .number()
    .refine((x) => x === 1)
    .default(1),
  LLM_GLOBAL_MAX_CONCURRENCY: number(4, 1, 4),
  LLM_PRINCIPAL_MAX_CONCURRENCY: number(1, 1, 1),
  LLM_GLOBAL_DAILY_CALL_LIMIT: number(0),
  LLM_PRINCIPAL_DAILY_CALL_LIMIT: number(120),
  LLM_LOG_RAW_PAYLOADS: z.literal("false").default("false"),
  GUEST_SESSION_DAYS: number(30, 1, 30),
  FEATURE_ZHIHU_API: z.enum(["true", "false"]).default("false"),
  FEATURE_ZHIHU_OAUTH: z.enum(["true", "false"]).default("false"),
  ZHIHU_OAUTH_APP_ID: z.string().default(""),
  ZHIHU_OAUTH_APP_KEY: z.string().default(""),
  ZHIHU_OAUTH_REDIRECT_URI: z.string().default(""),
  FEATURE_PLAYER_SCENARIO_GENERATION: z
    .enum(["true", "false"])
    .default("false"),
  LLM_BUDGET_YUAN: z
    .union([z.literal("unlimited"), z.coerce.number().min(0)])
    .default(10),
  FEATURE_RUNTIME_IMAGE_GENERATION: z.literal("false").default("false"),
});
export type Config = z.infer<typeof schema>;
export function readConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const c = schema.parse(env);
  const u = new URL(c.APP_ORIGIN);
  if (
    u.origin !== c.APP_ORIGIN ||
    !["http:", "https:"].includes(u.protocol) ||
    (u.protocol === "http:" && !["localhost", "127.0.0.1"].includes(u.hostname))
  )
    throw Error("APP_ORIGIN must be HTTPS or local HTTP origin");
  return c;
}
export function liveReady(c: Config) {
  return (
    c.LLM_MODE === "live" &&
    c.AI_LIVE_ENABLED === "true" &&
    !!c.DEEPSEEK_API_KEY &&
    c.LLM_GLOBAL_DAILY_CALL_LIMIT > 0
  );
}
