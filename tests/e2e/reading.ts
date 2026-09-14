import { expect, type Page } from "@playwright/test";
export async function chooseStory(page: Page, index = 0) {
  await page.getByRole("button", { name: "选择故事" }).click();
  await expect(page.locator(".story-card")).toHaveCount(20);
  await page.locator(".story-card").nth(index).click();
  await page.getByRole("button", { name: "选择这篇，创建角色 →" }).click();
}
export async function readToEnd(page: Page) {
  await expect(page.locator(".dialogue-prose")).toBeVisible();
  for (let i = 0; i < 100; i++) {
    const next = page.getByRole("button", { name: "继续对话", exact: true });
    if (!(await next.count())) break;
    await next.click();
    if (await page.locator(".arcade-modal").count()) await finishArcade(page);
  }
  await expect(page.locator(".action-shortcut")).toBeEnabled();
}
export async function finishArcade(page: Page) {
  await expect(page.locator(".arcade")).toBeVisible();
  if (await page.locator(".pixel-arcade").count()) {
    await page
      .getByRole("button", { name: /开始挑战|继续挑战/, exact: true })
      .click();
    if (await page.locator(".arcade-summit,.arcade-flight").count()) {
      await expect
        .poll(async () =>
          Number(await page.locator(".pixel-arcade").getAttribute("data-tick")),
        )
        .toBeGreaterThan(0);
    } else if (await page.locator(".arcade-roulette").count())
      await page
        .getByRole("button", { name: "朝对手试射", exact: true })
        .click();
    else
      await page.getByRole("button", { name: "右移 →", exact: true }).click();
    await expect(page.locator(".pixel-arcade")).toHaveAttribute(
      "data-animating",
      "false",
      { timeout: 60000 },
    );
    if (await page.locator(".pixel-result-panel").count())
      await page.getByRole("button", { name: "继续故事", exact: true }).click();
    else {
      await page.getByRole("button", { name: "暂停", exact: true }).click();
      await page
        .getByRole("button", { name: "认输并继续故事", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "继续故事", exact: true }).click();
    return;
  }
  if (await page.locator(".arcade-sokoban").count()) {
    for (const key of ["向上", "向右", "向下", "向右", "向上"])
      await page.getByRole("button", { name: key, exact: true }).click();
  } else {
    const start = page.getByRole("button", { name: "开始／继续", exact: true });
    if (await start.count()) {
      await start.click();
      await expect
        .poll(() => page.locator("progress").getAttribute("value"))
        .not.toBe("0");
    } else
      await page
        .locator(".arcade-grid button:not([disabled]), .tower-board button")
        .first()
        .click();
    await page.getByRole("button", { name: "认输并继续故事" }).click();
  }
  await page.getByRole("button", { name: "继续故事", exact: true }).click();
}
