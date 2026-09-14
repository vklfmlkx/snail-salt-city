import { curatedBooks } from "../../src/content/curated";
import { readToEnd, chooseStory } from "./reading";
import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("new scenario, male protagonist, six faces, saved dice animation and resume", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await chooseStory(page);
  await expect(
    page.getByText(curatedBooks[0].title, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("蜗牛已到楼下", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "男主角", exact: true }).click();
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".chapter-plaque")).toContainText(
    curatedBooks[0].stages[0].title,
  );
  await readToEnd(page);
  await page.getByRole("button", { name: "决定行动", exact: true }).click();
  await expect(page.locator(".recommended button")).toHaveCount(
    curatedBooks[0].stages[0].choices.length,
  );
  await page.locator(".recommended button").first().click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /确认并行动/ }).click();
  const saved = await (await response).json();
  const modal = page.getByRole("dialog", { name: "命运的骰子" });
  await expect(modal).toBeVisible();
  await expect(modal.locator(".d10")).toHaveText(String(saved.turn.result.die));
  await expect(modal).toContainText("难度");
  await page.screenshot({
    animations: "disabled",
    path: join(
      process.env.SNAIL_EVIDENCE_DIR ?? tmpdir(),
      `homecoming-${info.project.name}-dice.png`,
    ),
  });
  await modal.getByRole("button", { name: "进入剧情" }).click();
  await expect(page.locator(".progress")).toContainText("第1回合");
  await page.getByRole("button", { name: "同桌伙伴" }).click();
  const gallery = page.locator(".cast-gallery");
  await expect(
    gallery.locator(".cast-selector").first().getByRole("button"),
  ).toHaveCount(7);
  await gallery.getByRole("button", { name: "男主角", exact: true }).click();
  await gallery.getByRole("button", { name: "惊讶", exact: true }).click();
  await expect(gallery.locator(".sprite-portrait")).toHaveAttribute(
    "data-expression",
    "surprised",
  );
  await expect(gallery.locator(".sprite-portrait")).toHaveAttribute(
    "data-actor",
    "hero_m",
  );
  await gallery.getByRole("button", { name: "难过", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: join(
      process.env.SNAIL_EVIDENCE_DIR ?? tmpdir(),
      `homecoming-${info.project.name}-cast.png`,
    ),
  });
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: /继续我的故事|查看本局结局/ }).click();
  await expect(page.getByRole("dialog", { name: "命运的骰子" })).toHaveCount(0);
  await page.getByRole("button", { name: "本回合骰点" }).click();
  await expect(page.locator(".result-card")).toContainText(
    `d10 ${saved.turn.result.die}`,
  );
  await page.keyboard.press("Escape");
  await page.screenshot({
    animations: "disabled",
    path: join(
      process.env.SNAIL_EVIDENCE_DIR ?? tmpdir(),
      `homecoming-${info.project.name}-game.png`,
    ),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
