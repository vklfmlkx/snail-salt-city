import { AIError } from "./ai";
import type { Config } from "./config";

const transient = new Set([
  "network",
  "timeout",
  "rate_limit",
  "provider_error",
  "empty_content",
  "invalid_json",
  "schema_invalid",
  "truncated",
  "illegal_reference",
]);

/** Each attempt goes through the gateway and budget reservation independently. */
export async function retryCustom<T>(
  cfg: Config,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const deadline = Date.now() + cfg.LLM_CUSTOM_TOTAL_TIMEOUT_MS;
  for (let attempt = 1; attempt <= cfg.LLM_CUSTOM_MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AIError("timeout");
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(control.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            control.abort();
            reject(new AIError("timeout"));
          }, remaining);
        }),
      ]);
    } catch (e) {
      if (
        !(e instanceof AIError) ||
        !transient.has(e.code) ||
        attempt === cfg.LLM_CUSTOM_MAX_ATTEMPTS ||
        Date.now() >= deadline
      )
        throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const delay = Math.min(250 * attempt, deadline - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new AIError("provider_error");
}
