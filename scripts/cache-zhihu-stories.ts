import { writeFileSync } from "node:fs";
import { StoryCache, pickSamples } from "../src/server/zhihu-stories";
async function main() {
  const cache = new StoryCache(),
    live = process.argv.includes("--live"),
    offline = process.argv.includes("--offline");
  if (!live && !offline) {
    console.log(
      "Dry-run: stories:list + 10 distinct tag samples; no credentials or network. Pass --live to fetch/cache or --offline to rebuild cached index.",
    );
    return;
  }
  const catalog = await cache.catalog(
      live,
      !offline && process.argv.includes("--refresh"),
    ),
    samples = [];
  for (const { tag, item } of pickSamples(catalog)) {
    const story = await cache.detail(item, catalog, live);
    const { content, ...meta } = story;
    samples.push({
      tag,
      ...meta,
      characters: content.length,
      file: `${story.workId}.json`,
    });
    console.log(
      JSON.stringify({
        tag,
        title: story.title,
        author: story.author,
        characters: content.length,
      }),
    );
  }
  writeFileSync(
    `${cache.root}/samples.json`,
    JSON.stringify(
      { grouping: "用户确认的10种标签，非官方10类目录", samples },
      null,
      2,
    ),
  );
  console.log("Saved 10 distinct story bodies and provenance.");
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
