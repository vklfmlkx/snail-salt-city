import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chooseStory } from "./reading";

test("entering a story and changing speakers work without any further artwork network access", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  const requested: string[] = [];
  await page.route("**/assets/**", async (route) => {
    requested.push(route.request().url());
    await route.abort();
  });
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.getByRole("region", { name: "剧情对话" })).toBeVisible();
  const speakers = new Set<string>();
  for (let i = 0; i < 7; i++) {
    await expect
      .poll(() =>
        page.locator(".room-art, .sprite-portrait img").evaluateAll((nodes) =>
          nodes.every((node) => {
            const image = node as HTMLImageElement;
            return (
              image.src.startsWith("blob:") &&
              image.complete &&
              image.naturalWidth > 0
            );
          }),
        ),
      )
      .toBe(true);
    const src = await page
      .locator(".active-speaker img")
      .first()
      .getAttribute("src")
      .catch(() => null);
    if (src) speakers.add(src);
    const next = page.getByRole("button", { name: "继续对话", exact: true });
    if (!(await next.count())) break;
    await next.click();
  }
  expect(speakers.size).toBeGreaterThan(1);
  expect(requested).toEqual([]);
});

test("all active artwork loads before entry; failed artwork can retry", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route("**/assets/tabletop/v2/hero_m.png?*", async (route) => {
    if (fail) {
      await held;
      await route.abort();
    } else await route.continue();
  });
  await page.goto("/");
  await expect(page).toHaveTitle(/蜗牛与盐选城/);
  await expect(
    page.getByRole("heading", { name: "故事正在布置中" }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "11",
    { timeout: 20000 },
  );
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toHaveCount(0);
  const size = await page.evaluate(() => ({
    width: innerWidth,
    body: document.body.scrollWidth,
  }));
  expect(size.body).toBeLessThanOrEqual(size.width);
  await page.screenshot({
    path: join(tmpdir(), `snail-assets-loading-${info.project.name}.png`),
  });
  release();
  await expect(page.getByText("1 张图片暂时没有加载成功。")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "选择故事", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "精选剧本", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("image failure offers entry without trapping the player", async ({
  page,
}) => {
  await page.route("**/assets/tabletop/v2/hero_m.png?*", (route) =>
    route.abort(),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "先进入游戏" })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole("button", { name: "先进入游戏" }).click();
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeEnabled();
});

test("versioned images have persistent cache headers and reuse cache on reload", async ({
  page,
}) => {
  const assets = new Set<string>();
  page.on("response", (r) => {
    if (r.url().includes("/assets/")) assets.add(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  expect(assets.size).toBe(12);
  expect([...assets].every((url) => /\?v=[a-f0-9]{16}$/.test(url))).toBe(true);
  const image = await page.request.get([...assets][0]);
  expect(image.headers()["cache-control"]).toContain("max-age=31536000");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  const entries = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((r) => r.name.includes("/assets/"))
      .map((r) => (r as PerformanceResourceTiming).transferSize),
  );
  expect(entries.length).toBe(12);
  expect(entries.every((n) => n === 0)).toBe(true);
});
