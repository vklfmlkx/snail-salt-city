import { curatedBooks } from "../../src/content/curated";
import { readToEnd, chooseStory } from "./reading";
import { test, expect } from "@playwright/test";
test("five allocations, difficulty, single speaker and full chronological backlog", async ({
  page,
}) => {
  await page.goto("/");
  await chooseStory(page);
  await expect(page.locator(".presets button")).toHaveCount(5);
  await page.getByRole("button", { name: /力气担当/ }).click();
  await expect(page.getByLabel("体魄", { exact: true })).toHaveValue("8");
  await page.getByRole("button", { name: /均衡同行/ }).click();
  await expect(page.getByLabel("体魄", { exact: true })).toHaveValue("5");

  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".active-speaker")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "先读完本段" })).toBeDisabled();
  const first = (await page.locator(".dialogue-prose").innerText()).trim();
  await page.getByRole("button", { name: "继续对话", exact: true }).click();
  const second = (await page.locator(".dialogue-prose").innerText()).trim();
  expect(second).not.toBe(first);
  const speaker = await page.locator(".active-speaker").boundingBox(),
    box = await page.locator(".dialogue-box").boundingBox();
  expect(speaker!.x + speaker!.width / 2).toBeGreaterThan(
    box!.x + box!.width / 2,
  );
  expect(speaker!.y + speaker!.height).toBeLessThanOrEqual(box!.y + 1);
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.locator(".dialogue-log")).toContainText(first);
  await expect(page.locator(".dialogue-log")).toContainText(second);
  await expect(page.locator(".dialogue-log details")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await readToEnd(page);
  await page.reload();
  await page.getByRole("button", { name: "继续我的故事" }).click();
  await expect(page.locator(".action-shortcut")).toBeEnabled();
  await page.getByRole("button", { name: "决定行动", exact: true }).click();
  await expect(page.locator(".recommended button")).toHaveCount(
    curatedBooks[0].stages[0].choices.length,
  );
  await expect(page.locator(".action-mode")).toHaveCount(0);
  await expect(page.locator(".recommended button").first()).toContainText(
    `难度${{ low: 10, medium: 12, high: 14 }[curatedBooks[0].stages[0].choices[0].tier!]}`,
  );
  await page.locator(".recommended button").first().click();
  await expect(page.locator(".check-odds")).toContainText(
    /成功 \d+% \/ 部分成功 \d+% \/ 失败 \d+%/,
  );
  await page.getByRole("button", { name: "取消预览" }).click();
  await expect(page.locator(".free-input")).toHaveCount(0);
  await page.locator(".recommended button").first().click();
  await page.getByRole("button", { name: /确认并行动/ }).click();
  await page
    .getByRole("dialog", { name: "命运的骰子" })
    .getByRole("button", { name: "进入剧情" })
    .click();
  await expect(page.getByRole("button", { name: "先读完本段" })).toBeDisabled();
});
