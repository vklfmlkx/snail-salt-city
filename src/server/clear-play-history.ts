import type { Store } from "./database";

// Invoked explicitly by local maintenance only, never during app startup.
export function clearPlayHistory(
  store: Store,
  versions: string[],
  through: number,
) {
  if (
    !versions.length ||
    versions.some(
      (v) =>
        !/^(?:0\.5\.0|homecoming-(?:1\.0|script-2\.0|branch-3\.0)|curated-[a-z0-9-]+-1\.[012])$/.test(
          v,
        ),
    )
  )
    throw Error("Only explicitly audited retired versions may be cleared");
  if (!Number.isSafeInteger(through) || through <= 0)
    throw Error("Invalid audit cutoff");
  const marks = versions.map(() => "?").join(",");
  return store.transaction(() => {
    const summaries = store.db
      .prepare(
        `DELETE FROM ending_summaries WHERE id IN (SELECT id FROM games WHERE scenario_version IN (${marks}) AND created_at<=?)`,
      )
      .run(...versions, through).changes;
    const collection = store.db
      .prepare(
        `DELETE FROM ending_collection WHERE scenario_version IN (${marks}) AND achieved_at<=?`,
      )
      .run(...versions, through).changes;
    // Child rows cascade only from these audited retired games. Current 1.3 and
    // generated books/jobs are deliberately outside this maintenance operation.
    const games = store.db
      .prepare(
        `DELETE FROM games WHERE scenario_version IN (${marks}) AND created_at<=?`,
      )
      .run(...versions, through).changes;
    return {
      games: Number(games),
      summaries: Number(summaries),
      collection: Number(collection),
    };
  });
}
