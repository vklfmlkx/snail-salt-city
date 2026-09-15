import { test, expect } from "@playwright/test";
import { chooseStory, readToEnd } from "./reading";
import { join } from "node:path";
import { tmpdir } from "node:os";

for (const mode of ["old-api", "storage-full", "storage-denied"] as const)
  test(`第一幕和小游戏在手机兼容降级后仍可继续：${mode}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await chooseStory(page);
    await page.getByRole("button", { name: "入座，开始跑团" }).click();
    await expect(page.locator(".dialogue-prose")).toBeVisible();
    await page.evaluate((mode) => {
      if (mode === "old-api") {
        Object.defineProperty(window, "structuredClone", {
          value: undefined,
          configurable: true,
        });
        Object.defineProperty(crypto, "randomUUID", {
          value: undefined,
          configurable: true,
        });
        Object.defineProperty(Array.prototype, "at", {
          value: undefined,
          configurable: true,
        });
      } else if (mode === "storage-full")
        Storage.prototype.setItem = function () {
          throw new DOMException(
            "Storage quota exceeded",
            "QuotaExceededError",
          );
        };
      else {
        for (const key of ["sessionStorage", "localStorage"])
          Object.defineProperty(window, key, {
            get() {
              throw new DOMException("Storage disabled", "SecurityError");
            },
            configurable: true,
          });
      }
    }, mode);
    await readToEnd(page);
    await page.locator(".action-shortcut").click();
    await page.locator(".recommended button").first().click();
    await expect(page.getByRole("region", { name: "行动预览" })).toBeVisible();
    await page.screenshot({
      path: join(tmpdir(), `snail-compat-${mode}-${info.project.name}.png`),
    });
    const turn = page.waitForResponse(
      (r) => r.url().includes("/turns") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /确认并行动/ }).click();
    expect((await turn).ok()).toBeTruthy();
    await expect(page.locator("#__next_error__")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

test("未知第一幕异常显示中文恢复入口，已保存的进度可继续", async ({
  page,
}, info) => {
  await page.goto("/");
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".dialogue-prose")).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(window, "structuredClone", {
      value() {
        throw Error("Synthetic render failure");
      },
      configurable: true,
    }),
  );
  for (let i = 0; i < 65; i++) {
    if (
      await page.getByRole("heading", { name: "这一页暂时出了点状况" }).count()
    )
      break;
    const next = page.getByRole("button", { name: "继续对话", exact: true });
    if (!(await next.count())) break;
    try {
      await next.click({ timeout: 1500 });
    } catch {
      break;
    }
  }
  await expect(
    page.getByRole("heading", { name: "这一页暂时出了点状况" }),
  ).toBeVisible();
  await expect(page.getByText(/错误编号：PAGE-/)).toBeVisible();
  await expect(page.getByText("Synthetic render failure")).toHaveCount(0);
  await page.screenshot({
    path: join(tmpdir(), `snail-recovery-${info.project.name}.png`),
  });
  await page.getByRole("link", { name: "重新打开游戏" }).click();
  await expect(
    page.getByRole("button", { name: /继续.*故事|继续游戏|继续跑团/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /继续.*故事|继续游戏|继续跑团/ })
    .click();
  await expect(page.locator(".dialogue-prose")).toBeVisible();
});
