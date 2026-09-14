import { z } from "zod";
export const PatchSchema = z
  .object({
    edits: z
      .array(
        z
          .object({ path: z.string().min(2).max(200), value: z.unknown() })
          .strict(),
      )
      .min(1)
      .max(48),
  })
  .strict();

/** Bounded JSON data replacement; never evaluates code or invents prose. */
export function applyManuscriptPatch(
  draft: unknown,
  raw: unknown,
  allowedPaths?: Set<string>,
): unknown {
  const patch = PatchSchema.parse(raw),
    copy = structuredClone(draft);
  const paths = patch.edits.map((e) => e.path);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((a) => paths.some((b) => a !== b && b.startsWith(a + "/")))
  )
    throw Error("patch_overlapping_paths");
  for (const edit of patch.edits) {
    if (allowedPaths && !allowedPaths.has(edit.path))
      throw Error("patch_field_locked");
    if (
      !/^\/(?:title|logline|bible|facts|nodes|endings)(?:\/[A-Za-z0-9_]+)*$/.test(
        edit.path,
      )
    )
      throw Error("patch_path_invalid");
    const parts = edit.path.slice(1).split("/");
    if (
      parts.some((p) => ["__proto__", "constructor", "prototype"].includes(p))
    )
      throw Error("patch_path_invalid");
    let parent: unknown = copy;
    for (const key of parts.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
        throw Error("patch_path_missing");
      parent = (parent as Record<string, unknown>)[key];
    }
    const key = parts.at(-1)!;
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
      throw Error("patch_path_missing");
    (parent as Record<string, unknown>)[key] = structuredClone(edit.value);
  }
  return copy;
}
