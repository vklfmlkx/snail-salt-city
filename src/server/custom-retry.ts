import { AIError, type AIErrorCode } from "./ai";
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

export function customFailureMessage(code: AIErrorCode) {
  const reason =
    code === "timeout"
      ? "城主接写超时，自动尝试后仍未取得结果。"
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
