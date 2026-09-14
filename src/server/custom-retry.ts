import { AIError, type AIErrorCode } from "./ai";
import type { Config } from "./config";

// Transport/protocol failures only. illegal_reference means an unusable ID or
// evidence reference, never a subjective judgment about the player's story.
const retryableResponseErrors = new Set<AIErrorCode>([
  "network",
  "timeout",
  "provider_timeout",
  "rate_limit",
  "provider_error",
  "empty_content",
  "invalid_json",
  "schema_invalid",
  "truncated",
  "illegal_reference",
]);

export function customFailureMessage(code: AIErrorCode) {
  const reason =
    code === "provider_timeout"
      ? "已连上配文服务，但服务端迟迟没有返回完整结果，本次等待已超时。请稍后再试。"
      : code === "timeout"
        ? "本次等待已超时，自动尝试后仍未取得完整结果，可能是服务端等待过久或连接不稳定。"
        : code === "network" || code === "provider_error"
          ? "配文服务连接异常，这次没能生成桥段。"
          : code === "rate_limit"
            ? "目前请求较多，配文服务暂时忙不过来。"
            : code === "quota"
              ? "配文服务的可用额度已用完，暂时无法接写。"
              : code === "configuration" || code === "auth"
                ? "配文服务暂时无法连接，需要维护者检查配置。"
                : code === "refusal"
                  ? "配文服务未能处理这段描述，可以换一种说法。"
                  : "城主返回的内容不完整，自动尝试后仍没能整理出可用桥段。";
  return `${reason}你的输入已保留，尚未投骰或消耗行动。可以调整做法后重新预览，或选择推荐行动。`;
}

/**
 * Retry only when no usable API response was received. A valid interpretation,
 * including clarify/unsupported, is final and returns immediately. Never retry
 * merely to persuade the model to approve an action. Each attempt reserves quota.
 */
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
    let abortFallback: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(control.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            control.abort();
            // Let the aborted provider report its precise phase (e.g. HTTP 200
            // with no body) before the watchdog handles an uncooperative task.
            abortFallback = setTimeout(() => reject(new AIError("timeout")), 0);
          }, remaining);
        }),
      ]);
    } catch (e) {
      if (
        !(e instanceof AIError) ||
        !retryableResponseErrors.has(e.code) ||
        attempt === cfg.LLM_CUSTOM_MAX_ATTEMPTS ||
        Date.now() >= deadline
      )
        throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (abortFallback) clearTimeout(abortFallback);
    }
    const delay = Math.min(250 * attempt, deadline - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new AIError("provider_error");
}
