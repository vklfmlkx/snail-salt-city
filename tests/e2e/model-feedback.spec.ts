import { test, expect } from "@playwright/test";
import { loginOffline } from "./account";
import { chooseStory, readToEnd } from "./reading";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("自定义行动等待有翻书提示；超时、隧道错误和断网均在当前窗口反馈且保留输入", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loginOffline(page);
  await page.getByRole("button", { name: "测试功能", exact: true }).click();
  await page.getByRole("checkbox", { name: "自定义行动", exact: true }).check();
  await page.getByRole("button", { name: "关闭测试功能" }).click();
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await readToEnd(page);
  await page.locator(".action-shortcut").click();
  const input = page.getByLabel("自定义行动（测试）", { exact: true });
  await input.fill("抢走房卡去一楼，之后再想办法回来");
  const me = await (await page.request.get("/api/me")).json();
  const before = await (
    await page.request.get(`/api/sessions/${me.activeGameId}`)
  ).json();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let mode = "slow",
    calls = 0;
  await page.route("**/api/sessions/*/proposals", async (route) => {
    calls++;
    if (mode === "slow") {
      await gate;
      return route.fulfill({
        json: {
          kind: "fallback",
          errorCode: "timeout",
          message:
            "城主接写超时，自动尝试后仍未取得结果。输入已保留，尚未消耗行动。",
        },
      });
    }
    if (mode === "html")
      return route.fulfill({
        status: 504,
        contentType: "text/html",
        body: "<html>Gateway timeout</html>",
      });
    if (mode === "network") return route.abort("failed");
    if (mode === "empty") return route.fulfill({ json: {} });
    return route.continue();
  });
  const submit = () =>
    page.getByRole("button", { name: "预览自定义行动", exact: true });
  await submit().click();
  const loading = page.getByRole("status", { name: "城主正在接写剧情" });
  await expect(loading).toBeVisible();
  // Allow subpixel border rounding while requiring the whole status card in view.
  await expect(loading).toBeInViewport({ ratio: 0.99 });
  await expect(
    page.getByRole("button", { name: "城主正在接写剧情…", exact: true }),
  ).toBeDisabled();
  await expect(loading).toContainText(/已等待 [1-9]\d* 秒/);
  await page.screenshot({
    path: join(tmpdir(), `snail-model-loading-${info.project.name}.png`),
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await loading
      .locator(".flipping-book i")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  expect(calls).toBe(1);
  release();
  const feedback = page.locator(".action-feedback");
  await expect(feedback).toContainText("超时");
  await expect(feedback).toBeVisible();
  await expect(feedback).toBeFocused();
  await expect(loading).toHaveCount(0);
  await expect(input).toHaveValue("抢走房卡去一楼，之后再想办法回来");
  await page.screenshot({
    path: join(tmpdir(), `snail-model-timeout-${info.project.name}.png`),
  });
  mode = "html";
  await submit().click();
  await expect(feedback).toContainText("有效的行动预览");
  mode = "network";
  await submit().click();
  await expect(feedback).toContainText("网络连接中断");
  mode = "empty";
  await submit().click();
  await expect(feedback).toContainText("没有返回可用");
  const after = await (
    await page.request.get(`/api/sessions/${me.activeGameId}`)
  ).json();
  expect(after.state.version).toBe(before.state.version);
  expect(after.turns).toEqual(before.turns);
  mode = "success";
  await submit().click();
  await expect(page.getByRole("region", { name: "行动预览" })).toBeVisible();
  await expect(feedback).toHaveCount(0);
  expect(errors).toEqual([]);
});
