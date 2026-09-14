#!/usr/bin/env node
/**
 * One-shot DeepSeek connectivity probe. NOT the game's provider implementation.
 * Default: OFFLINE. --live: at most ONE potentially billable HTTP request.
 * No dependencies, no SDK retries, no player text, no raw response/key logging.
 * See DEEPSEEK_INTEGRATION.md. Requires a modern supported Node LTS.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export class ProbeError extends Error {
  constructor(code, status = undefined) {
    super(code);
    this.name = "ProbeError";
    this.code = code;
    this.status = status;
  }
}

export function readProbeConfig(env = process.env) {
  const base = (env.LLM_BASE_URL || "https://api.deepseek.com").trim();
  const path = (env.LLM_API_PATH || "/chat/completions").trim();
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    throw new ProbeError("configuration");
  }
  // This probe is deliberately restricted to the confirmed official endpoint.
  if (
    parsed.origin !== "https://api.deepseek.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    path !== "/chat/completions"
  ) {
    throw new ProbeError("configuration");
  }
  const model = (env.LLM_MODEL_INTERPRETER || "deepseek-flash").trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(model))
    throw new ProbeError("configuration");
  const key = (env.DEEPSEEK_API_KEY || "").trim();
  // Missing is permitted for dry-run; no fallback to LLM_API_KEY or OPENAI_API_KEY.
  if (key && (/\s/.test(key) || key.length > 4096))
    throw new ProbeError("configuration");
  return { endpoint: `${parsed.origin}${path}`, model, key };
}

export function buildProbeBody(config) {
  return {
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          'Reply with one JSON object only. No extra keys. Required example: {"ok":true,"project":"snail-salt-city"}.',
      },
      {
        role: "user",
        content:
          "This is a synthetic connection check. Return exactly the JSON object requested above.",
      },
    ],
    stream: false,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    max_tokens: 128,
  };
}

function statusCode(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limit";
  if (status >= 300 && status < 400) return "redirect_rejected";
  if (status === 400 || status === 404 || status === 422)
    return "configuration_or_model";
  return "provider_error";
}

async function readLimitedJson(response, maxBytes) {
  if (!response.body) throw new ProbeError("invalid_response");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ProbeError("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks, length).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new ProbeError("invalid_response_json");
  }
}

export function validateProbeResponse(data) {
  const choice = data?.choices?.[0];
  if (!choice?.message) throw new ProbeError("invalid_response");
  if (choice.finish_reason === "length") throw new ProbeError("truncated");
  if (choice.finish_reason === "content_filter" || choice.message.refusal)
    throw new ProbeError("refusal");
  if (choice.finish_reason !== "stop" || choice.message.tool_calls?.length)
    throw new ProbeError("unexpected_finish");
  const content = choice.message.content;
  // reasoning_content is intentionally never used or returned.
  if (typeof content !== "string" || !content.trim())
    throw new ProbeError("empty_content");
  if (content.length > 4096) throw new ProbeError("content_too_large");
  let result;
  try {
    result = JSON.parse(content);
  } catch {
    throw new ProbeError("invalid_json");
  }
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    Object.keys(result).sort().join(",") !== "ok,project" ||
    result.ok !== true ||
    result.project !== "snail-salt-city"
  ) {
    throw new ProbeError("schema_invalid");
  }
  const usage = {};
  for (const field of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
    const value = data?.usage?.[field];
    if (Number.isSafeInteger(value) && value >= 0) usage[field] = value;
  }
  const returnedModel =
    typeof data.model === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(data.model)
      ? data.model
      : null;
  return { returnedModel, usage: Object.keys(usage).length ? usage : null };
}

export async function runProbe({
  live = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  maxResponseBytes = 131072,
} = {}) {
  const config = readProbeConfig(env);
  if (!live) {
    return {
      status: "DRY_RUN",
      networkRequests: 0,
      configuredModel: config.model,
      keyConfigured: Boolean(config.key),
      thinking: "disabled",
      outputMode: "json_object",
      note: "No API called. --live explicitly authorizes at most one potentially billable request.",
    };
  }
  if (!config.key) throw new ProbeError("missing_key");
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000 ||
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 1048576
  ) {
    throw new ProbeError("configuration");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      redirect: "manual",
      signal: controller.signal,
      body: JSON.stringify(buildProbeBody(config)),
    });
    if (!response.ok) {
      // Do not read, print, or forward the provider's error payload.
      await response.body?.cancel().catch(() => {});
      throw new ProbeError(statusCode(response.status), response.status);
    }
    const data = await readLimitedJson(response, maxResponseBytes);
    const result = validateProbeResponse(data);
    return {
      status: "PASS",
      networkRequests: 1,
      configuredModel: config.model,
      ...result,
      elapsedMs: Math.max(0, Date.now() - started),
      note: "One synthetic JSON request passed. Game behavior, Windows and deployment remain separate tests.",
    };
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    if (
      controller.signal.aborted ||
      error?.name === "AbortError" ||
      error?.name === "TimeoutError"
    ) {
      throw new ProbeError("timeout");
    }
    throw new ProbeError("network");
  } finally {
    clearTimeout(timer);
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length === 1 && argv[0] === "--help") {
      console.log(
        "node scripts/deepseek-smoke.mjs [--live]\nDefault is offline. --live sends at most ONE paid-capable request using DEEPSEEK_API_KEY.",
      );
      return 0;
    }
    if (argv.some((arg) => arg !== "--live") || argv.length > 1)
      throw new ProbeError("arguments");
    const live = argv.includes("--live");
    if (live)
      console.log(
        "LIVE PROBE: at most one request; no retries. This may incur a charge.",
      );
    console.log(JSON.stringify(await runProbe({ live }), null, 2));
    return 0;
  } catch (error) {
    const safe =
      error instanceof ProbeError ? error : new ProbeError("internal");
    console.error(
      JSON.stringify({
        status: "FAIL",
        code: safe.code,
        httpStatus: safe.status ?? null,
      }),
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}
