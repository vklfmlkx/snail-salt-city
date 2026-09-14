import { test, expect } from "@playwright/test";
import { curatedBooks } from "../../src/content/curated";
import { chooseStory } from "./reading";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("新版第二人称开场逐段显示，人物自己的我保留", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await expect(page).toHaveTitle(/跑团剧场/);
  await chooseStory(page, 2);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  const opening = curatedBooks[2].stages[0].opening;
  for (let i = 0; i < 7; i++) {
    await expect(page.locator(".dialogue-prose")).toHaveText(opening[i].text);
    if (i < 3)
      await expect(page.locator(".dialogue-prose")).toContainText("你");
    if (i === 6) break;
    await page.getByRole("button", { name: "继续对话", exact: true }).click();
  }
  await expect(page.locator(".action-shortcut")).toBeDisabled();
  expect(opening[5].speaker).toBe("player");
  expect(opening[5].text).toContain("我");
  expect(errors).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    path: join(
      process.env.SNAIL_EVIDENCE_DIR ?? tmpdir(),
      `editorial-second-person-${info.project.name}.png`,
    ),
  });
});

test("旧局已删除时清掉待提交动作与草稿，新局不继承旧阅读位置", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "选择故事" })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem(
      "snail:last-game",
      "00000000-0000-4000-8000-000000000000",
    );
    sessionStorage.setItem(
      "snail:pending",
      JSON.stringify({ gameId: "retired", proposalId: "old" }),
    );
    sessionStorage.setItem("snail:draft", "旧动作不应恢复");
    sessionStorage.setItem("snail:read:retired", "99");
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("snail:last-game")))
    .toBeNull();
  expect(
    await page.evaluate(() => sessionStorage.getItem("snail:pending")),
  ).toBeNull();
  expect(
    await page.evaluate(() => sessionStorage.getItem("snail:read:retired")),
  ).toBeNull();
  await chooseStory(page, 0);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".dialogue-prose")).toHaveText(
    curatedBooks[0].stages[0].opening[0].text,
  );
});
