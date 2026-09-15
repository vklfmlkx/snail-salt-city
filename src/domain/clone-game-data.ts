/** Game snapshots contain only plain objects, arrays and primitive values.
 * Older mobile engines may not implement structuredClone. Preserve undefined
 * and numeric values too, so the fallback produces the same deterministic game.
 */
export function cloneGameData<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function")
    return globalThis.structuredClone(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneGameData) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneGameData(item)]),
  ) as T;
}
