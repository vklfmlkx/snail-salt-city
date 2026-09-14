import { PatchSchema } from "./patch";
/** Only replace existing JSON data, never source/version metadata or object prototypes. */
export function patchBook(draft: unknown, raw: unknown) {
  const { edits } = PatchSchema.parse(raw),
    copy = structuredClone(draft),
    paths = edits.map((e) => e.path);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((a) => paths.some((b) => a !== b && b.startsWith(a + "/")))
  )
    throw Error("patch_overlapping_paths");
  for (const { path, value } of edits) {
    if (
      !/^\/(?:title|description|stages|endings|roleNames|graphFlags|initialFlags|flagLabels|flags)(?:\/[A-Za-z0-9_-]+)*$/.test(
        path,
      )
    )
      throw Error("patch_field_locked");
    const parts = path.slice(1).split("/");
    if (
      parts.some((p) => ["__proto__", "constructor", "prototype"].includes(p))
    )
      throw Error("patch_field_locked");
    let parent = copy as Record<string, unknown>;
    for (const key of parts.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
        throw Error(
          `patch_path_missing: ${path}; '${key}'不存在，请按输入当前格式替换已有父对象/数组`,
        );
      parent = parent[key] as Record<string, unknown>;
    }
    const key = parts.at(-1)!;
    if (!parent || !Object.hasOwn(parent, key))
      throw Error(
        `patch_path_missing: ${path}; '${key}'不存在，请替换已有父对象/数组`,
      );
    parent[key] = structuredClone(value);
  }
  return copy;
}
