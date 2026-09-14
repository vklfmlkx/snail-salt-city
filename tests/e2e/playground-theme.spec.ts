import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("小游戏广场使用浅色，四款游戏和难度选择清晰且可进入", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "小游戏广场", exact: true }).click();
  for (const selector of [
    ".page-playground",
    ".playground-stage",
    ".pixel-start",
  ]) {
    const rgb = await page
      .locator(selector)
      .evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(
      rgb
        .match(/\d+/g)!
        .slice(0, 3)
        .map(Number)
        .every((v) => v > 210),
    ).toBe(true);
  }
  await page.screenshot({
    path: join(tmpdir(), `snail-plaza-${info.project.name}.png`),
    fullPage: true,
  });
  for (const name of ["云巅小径", "穿云信使", "弹仓对决", "星夜领队"]) {
    const choice = page
      .getByRole("navigation", { name: "选择小游戏" })
      .getByRole("button", { name, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".pixel-start h2")).toHaveText(name);
    await page.getByRole("button", { name: "开始挑战", exact: true }).click();
    await expect(page.locator(".pixel-start")).toHaveCount(0);
    await expect(page.locator("canvas")).toBeVisible();
  }
  const modes = page.locator(".arcade-difficulty button");
  for (let i = 0; i < 3; i++) {
    await modes.nth(i).click();
    await expect(modes.nth(i)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".pixel-start")).toBeVisible();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "返回封面", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
