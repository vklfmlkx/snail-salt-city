import { StoryCache } from "../src/server/zhihu-stories";
async function main() {
  const cache = new StoryCache();
  const catalog = await cache.catalog(false);
  if (!process.argv.includes("--live")) {
    console.log(
      "dry-run: cache the 20 catalog stories, no model or credential",
    );
    return;
  }
  for (const item of catalog) {
    const source = await cache.detail(item, catalog, true);
    console.log(
      JSON.stringify({
        id: source.workId,
        title: source.title,
        author: source.author,
        introduction: source.introduction,
        excerpt: source.content.slice(0, 1100),
      }),
    );
  }
}
main().catch(() => {
  console.error("story_cache_failed");
  process.exitCode = 1;
});
