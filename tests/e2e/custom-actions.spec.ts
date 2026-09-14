import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chooseStory, readToEnd } from "./reading";
import { loginOffline } from "./account";

test("自定义行动默认关闭、开启提示风险；完成小游戏和阅读后才能预览与结算", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loginOffline(page);
  await expect(page).toHaveTitle(/蜗牛/);
  await page.getByRole("button", { name: "测试功能", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "自定义行动", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByText("警告：打开后可能会导致剧情前后衔接不上。"),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "自定义行动", exact: true }).check();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/me")).json()).testFeatures
          .customActions,
    )
    .toBe(true);
  await page.screenshot({
    path: join(tmpdir(), `snail-testing-${info.project.name}.png`),
  });
  await page.getByRole("button", { name: "关闭测试功能" }).click();
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".action-shortcut")).toBeDisabled();
  await readToEnd(page);
  await page.locator(".action-shortcut").click();
  await page
    .getByLabel("自定义行动（测试）", { exact: true })
    .fill("抢走郑工的房卡，去一楼的房间");
  await page
    .getByRole("button", { name: "预览自定义行动", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "行动预览" })).toContainText(
    "抢走郑工",
  );
  await expect(page.getByRole("region", { name: "行动预览" })).toContainText(
    "本次方向",
  );
  await page.screenshot({
    path: join(tmpdir(), `snail-custom-preview-${info.project.name}.png`),
  });
  await page.getByRole("button", { name: "确认并行动 →", exact: true }).click();
  await expect(page.getByRole("region", { name: "行动预览" })).toHaveCount(0);
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("访客不可使用测试功能，伪造开启请求也被服务端拒绝", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "测试功能（登录后可用）", exact: true }),
  ).toBeDisabled();
  const me = await (await page.request.get("/api/me")).json();
  const res = await page.request.post("/api/test-features", {
    headers: {
      Origin: "http://localhost:3100",
      "X-Snail-Request": "1",
      "X-CSRF-Token": me.csrfToken,
    },
    data: { customActions: true },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.message).toContain("知乎登录");
  expect(
    (await (await page.request.get("/api/me")).json()).testFeatures
      .customActions,
  ).toBe(false);
  await page.screenshot({
    path: join(tmpdir(), `snail-guest-tests-${info.project.name}.png`),
  });
});

test("未开启时接口拒绝自由输入；退出账号保持页面图片且清除身份与旧存档入口", async ({
  page,
}) => {
  await loginOffline(page);
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".vn-screen")).toBeVisible();
  const m = await (await page.request.get("/api/me")).json();
  const blocked = await page.request.post(
    `/api/sessions/${m.activeGameId}/proposals`,
    {
      headers: {
        Origin: "http://localhost:3100",
        "X-Snail-Request": "1",
        "X-CSRF-Token": m.csrfToken,
      },
      data: { text: "我要抢房卡", expectedStateVersion: 0 },
    },
  );
  expect(blocked.status()).toBe(403);
  const images: string[] = [];
  await page.route("**/assets/**", (route) => {
    images.push(route.request().url());
    return route.abort();
  });
  await page.evaluate(() => {
    (window as unknown as { noReload: boolean }).noReload = true;
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "退出账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "选择故事", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { noReload: boolean }).noReload,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "继续我的故事", exact: true }),
  ).toHaveCount(0);
  const guest = await (await page.request.get("/api/me")).json();
  expect(guest.account).toBeNull();
  expect(guest.activeGameId).toBeNull();
  expect(
    (await page.request.get(`/api/sessions/${m.activeGameId}`)).status(),
  ).toBe(404);
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await expect(page.locator(".vn-screen")).toBeVisible();
  expect(
    await page
      .locator(".sprite-portrait img")
      .evaluateAll((nodes) =>
        nodes.every(
          (n) =>
            (n as HTMLImageElement).src.startsWith("blob:") &&
            (n as HTMLImageElement).naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  expect(images).toEqual([]);
});
