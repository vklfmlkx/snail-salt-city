import { faces } from "../../content/script-book";

/** Cosmetic asset fallback only. Never changes dialogue text, speakers, facts or routes. */
export function normalizeExpressions(raw: unknown) {
  const value = structuredClone(raw);
  const warnings: { path: string; code: string }[] = [];
  function walk(v: unknown, path: string) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}/${i}`));
      return;
    }
    for (const [key, child] of Object.entries(v)) {
      if (key === "dialogue" && Array.isArray(child))
        child.forEach((line, i) => {
          if (
            Array.isArray(line) &&
            line.length === 3 &&
            typeof line[1] === "string" &&
            !(faces as readonly string[]).includes(line[1])
          ) {
            line[1] = "neutral";
            warnings.push({
              path: `${path}/dialogue/${i}/1`,
              code: "expression_asset_fallback",
            });
          }
        });
      walk(child, `${path}/${key}`);
    }
  }
  walk(value, "");
  return { value, warnings };
}
