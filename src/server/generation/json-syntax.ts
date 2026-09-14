import { jsonrepair } from "jsonrepair";
/** Syntax-only recovery. Reject repairs that add/remove lexical story content. */
export function recoverDraftJSON(raw: unknown): unknown {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("unparsedDraft" in raw) ||
    typeof raw.unparsedDraft !== "string"
  )
    return raw;
  const text = raw.unparsedDraft;
  let result = "",
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      result += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    if (c === ",") {
      let j = i + 1;
      while (/\s/.test(text[j] ?? "") && j < text.length) j++;
      if (text[j] === "]" || text[j] === "}") continue;
    }
    result += c;
  }
  try {
    return JSON.parse(result);
  } catch {
    if (!text.trim().startsWith("{") || !text.trim().endsWith("}")) return raw;
    try {
      const repaired = jsonrepair(text);
      const lexical = (s: string) => s.replace(/[\s"“”„‘’'`\\,:{}\[\]]/gu, "");
      if (lexical(text) !== lexical(repaired)) return raw;
      return JSON.parse(repaired);
    } catch {
      return raw;
    }
  }
}
