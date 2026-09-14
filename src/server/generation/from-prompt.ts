import { StoryCache, matchStories, type StorySource } from "../zhihu-stories";
import { generateWholeBook, type WholeBookModel } from "./pipeline";

/** Server/worker entry point. Source fetching and paid model authorization are separate. */
export async function generateFromPrompt(input: {
  style: string;
  cache: StoryCache;
  allowSourceNetwork?: boolean;
  model: WholeBookModel;
  outputRoot?: string;
}) {
  const catalog = await input.cache.catalog(input.allowSourceNetwork === true);
  const matches = matchStories(catalog, input.style);
  if (!matches.length)
    return {
      status: "no_source_match" as const,
      availableTags: [...new Set(catalog.flatMap((s) => s.labels))],
    };
  const source: StorySource = await input.cache.detail(
    matches[0].item,
    catalog,
    input.allowSourceNetwork === true,
  );
  const result = await generateWholeBook(
    source,
    input.style,
    input.model,
    input.outputRoot,
  );
  return {
    ...result,
    selection: {
      workId: source.workId,
      title: source.title,
      labels: source.labels,
      score: matches[0].score,
      method: "cached_catalog_local_matching" as const,
    },
  };
}
