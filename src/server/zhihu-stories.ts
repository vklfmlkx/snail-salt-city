import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const STORY_BASE =
  "https://api.zhihu.com/km-indep-home/hackathon/v2/story";
export const sampleTags = [
  "惊悚",
  "悬疑",
  "权谋",
  "言情",
  "玄幻奇幻",
  "脑洞",
  "科幻",
  "现实情感",
  "仙侠",
  "穿越",
];
const idSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((v) => !/[\s/\\?#%]/u.test(v) && v !== "." && v !== "..");
const itemSchema = z
  .object({
    work_id: idSchema,
    title: z.string().default(""),
    description: z.string().default(""),
    labels: z.array(z.string()).default([]),
  })
  .passthrough();
export type StoryItem = z.infer<typeof itemSchema>;
export type StorySource = {
  workId: string;
  title: string;
  author: string | null;
  labels: string[];
  introduction: string;
  content: string;
  sourceUrl: string;
  fetchedAt: string;
  sha256: string;
  completeness?: "not_declared";
};
export async function boundedJSON(url: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error(`zhihu_http_${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw Error("zhihu_empty_body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    bytes += r.value.length;
    if (bytes > 4_000_000) {
      await reader.cancel();
      throw Error("zhihu_response_too_large");
    }
    chunks.push(r.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function parseCatalog(raw: unknown) {
  return z.array(itemSchema).max(1000).parse(raw);
}
export function pickSamples(catalog: StoryItem[], tags = sampleTags) {
  // Backtracking protects narrow categories from being consumed by broad tags.
  const ordered = [...tags].sort(
    (a, b) =>
      catalog.filter((s) => s.labels.includes(a)).length -
      catalog.filter((s) => s.labels.includes(b)).length,
  );
  const selected = new Map<string, StoryItem>(),
    used = new Set<string>();
  function search(i: number): boolean {
    if (i === ordered.length) return true;
    const tag = ordered[i];
    for (const s of catalog.filter((s) => s.labels.includes(tag))) {
      if (used.has(s.work_id)) continue;
      used.add(s.work_id);
      selected.set(tag, s);
      if (search(i + 1)) return true;
      used.delete(s.work_id);
      selected.delete(tag);
    }
    return false;
  }
  if (!search(0)) throw Error("zhihu_cannot_cover_tags_with_distinct_stories");
  return tags.map((tag) => ({ tag, item: selected.get(tag)! }));
}
export function matchStories(catalog: StoryItem[], prompt: string) {
  let q = prompt.trim().toLowerCase();
  if (!q || q.length > 500) throw Error("invalid_style_prompt");
  const aliases: Record<string, string> = {
    恐怖: "惊悚",
    吓人: "惊悚",
    推理: "悬疑",
    探案: "悬疑",
    恋爱: "言情",
    爱情: "言情",
    修仙: "仙侠",
    宫斗: "权谋",
    太空: "科幻",
    未来科技: "科幻",
    亲情: "现实情感",
    奇幻: "玄幻奇幻",
  };
  q +=
    " " +
    Object.entries(aliases)
      .filter(([word]) => q.includes(word))
      .map(([, tag]) => tag)
      .join(" ");
  const grams = [
    ...new Set(q.match(/[\p{Script=Han}]{2}|[a-z0-9]{2,}/gu) ?? []),
  ];
  return catalog
    .map((item) => {
      const text =
        `${item.title} ${item.description} ${item.labels.join(" ")}`.toLowerCase();
      return {
        item,
        score:
          item.labels.reduce(
            (n, t) => n + (q.includes(t.toLowerCase()) ? 12 : 0),
            0,
          ) + grams.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0),
      };
    })
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.item.work_id.localeCompare(b.item.work_id),
    );
}
export function normalizeStory(
  raw: unknown,
  item: StoryItem,
  fetchedAt: string,
): StorySource {
  const d = z
    .object({
      work_id: idSchema.optional(),
      chapter_name: z.string().optional(),
      author_name: z.string().optional(),
      labels: z.array(z.string()).optional(),
      introduction: z.string().optional(),
      content: z.string().min(100).max(1_000_000),
    })
    .passthrough()
    .parse(raw);
  if (d.work_id && d.work_id !== item.work_id)
    throw Error("zhihu_detail_id_mismatch");
  const content = d.content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
  if (content.length < 100) throw Error("zhihu_no_usable_body");
  return {
    workId: item.work_id,
    title: d.chapter_name ?? item.title,
    author: d.author_name ?? null,
    labels: d.labels ?? item.labels,
    introduction: d.introduction ?? item.description,
    content,
    sourceUrl: `${STORY_BASE}/${encodeURIComponent(item.work_id)}`,
    fetchedAt,
    sha256: createHash("sha256").update(content).digest("hex"),
    completeness: "not_declared",
  };
}
export class StoryCache {
  constructor(
    readonly root = "data/story-sources/zhihu",
    readonly fetcher: typeof fetch = fetch,
  ) {}
  async catalog(live = false, refresh = false) {
    const path = join(this.root, "catalog.json");
    if (existsSync(path) && !refresh)
      return parseCatalog(JSON.parse(readFileSync(path, "utf8")).data);
    if (!live) throw Error("zhihu_catalog_not_cached");
    const data = await boundedJSON(`${STORY_BASE}/list`, this.fetcher);
    const parsed = parseCatalog(data);
    mkdirSync(this.root, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          source: `${STORY_BASE}/list`,
          fetchedAt: new Date().toISOString(),
          data,
        },
        null,
        2,
      ),
    );
    return parsed;
  }
  async detail(item: StoryItem, catalog: StoryItem[], live = false) {
    idSchema.parse(item.work_id);
    if (!catalog.some((s) => s.work_id === item.work_id))
      throw Error("zhihu_id_not_in_catalog");
    const file = join(this.root, `${item.work_id}.json`);
    if (existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, "utf8"));
      return normalizeStory(cached.raw, item, cached.fetchedAt);
    }
    if (!live) throw Error("zhihu_story_not_cached");
    const raw = await boundedJSON(
        `${STORY_BASE}/${encodeURIComponent(item.work_id)}`,
        this.fetcher,
      ),
      fetchedAt = new Date().toISOString(),
      story = normalizeStory(raw, item, fetchedAt);
    mkdirSync(this.root, { recursive: true });
    writeFileSync(file, JSON.stringify({ fetchedAt, raw, story }, null, 2));
    return story;
  }
}
