import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chooseStory } from "./reading";

test("浅色书架、按钮对比度、收起筛选与社区上传空状态", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "选择故事", exact: true }).click();
  await expect(page.locator(".story-card")).toHaveCount(20);
  await expect(page.locator(".tag-filter")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成新故事 →" })).toHaveCount(
    0,
  );
  await expect(page.locator(".page-library")).toHaveCSS(
    "background-color",
    "rgb(255, 248, 232)",
  );
  const contrast = await page
    .locator(".book-tabs button, .library-tools button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const s = getComputedStyle(button);
        const l = (v: string) => {
          const c = v
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map((n) => Number(n) / 255)
            .map((n) =>
              n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
            );
          return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        };
        const a = l(s.color),
          b = l(s.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }),
    );
  for (const value of contrast) expect(value).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({
    path: join(tmpdir(), `library-paper-${info.project.name}.png`),
  });
  await page.getByRole("button", { name: "筛选题材", exact: true }).click();
  await expect(page.locator(".tag-filter")).toBeVisible();
  await page.locator(".tag-filter button").first().click();
  await page
    .getByRole("button", { name: "筛选题材（已选1）", exact: true })
    .click();
  await expect(page.locator(".tag-filter")).toHaveCount(0);
  await page.getByRole("button", { name: "社区剧本", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成新故事 →" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "上传剧本", exact: true }).click();
  await expect(page.locator(".community-upload")).toContainText(
    "请先到自生成剧本处",
  );
  await page
    .getByRole("button", { name: "前往自生成剧本", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "自生成剧本", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "上传剧本", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "生成新故事 →" }).click();
  await expect(page.locator(".page-generate")).toHaveCSS(
    "background-color",
    "rgb(255, 248, 232)",
  );
  expect(errors).toEqual([]);
});

test("切换发言人物使用新的图片元素，避免旧人物短暂套用新表情", async ({
  page,
}) => {
  await page.goto("/");
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  const portrait = page.locator(".active-speaker");
  const first = await portrait.getAttribute("data-actor");
  const old = await portrait.locator("img").elementHandle();
  for (
    let i = 0;
    i < 15 && (await portrait.getAttribute("data-actor")) === first;
    i++
  ) {
    await page.getByRole("button", { name: "继续对话", exact: true }).click();
  }
  expect(await portrait.getAttribute("data-actor")).not.toBe(first);
  expect(await old!.evaluate((img) => img.isConnected)).toBe(false);
  await expect(portrait.locator("img")).toHaveAttribute(
    "src",
    `/assets/tabletop/v2/${await portrait.getAttribute("data-actor")}.png`,
  );
});
