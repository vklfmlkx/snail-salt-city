import { test, expect } from "@playwright/test";
import { chooseStory } from "./reading";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("封面、阅读菜单和角色卡使用玩家提示，登录失败在首页可见", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?login=failed");
  await expect(page.locator(".notice-banner")).toContainText("登录未完成");
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.getByRole("button", { name: "设置与说明", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "知乎登录暂未开放", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".settings-content")).not.toContainText("凭证");
  await page.getByRole("button", { name: "关闭设置与说明" }).click();
  await chooseStory(page);
  await page.getByRole("button", { name: "入座，开始跑团" }).click();
  await page.getByRole("button", { name: "角色", exact: true }).click();
  await expect(page.locator(".character-name")).toContainText("林小满（你）");
  await page.screenshot({
    path: join(tmpdir(), `release-copy-${info.project.name}-character.png`),
  });
  await page.getByRole("button", { name: "关闭角色与随身手记" }).click();
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.locator(".dialogue-log article").first()).toBeVisible();
  await page.getByRole("button", { name: "关闭这一路的记录" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByText("这里切换的是跑团房间，不会改变故事进度。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回封面，保留存档" }).click();
  await expect(
    page.getByRole("button", { name: "继续我的故事", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("退出失败保留账号并显示可见反馈，不产生未处理异常", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/visitor", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        account: { name: "测试玩家" },
        oauthReady: true,
      },
    });
  });
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "暂时无法退出，请稍后再试。" } },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "设置与说明", exact: true }).click();
  await page.getByRole("button", { name: "退出账号", exact: true }).click();
  await expect(page.locator(".settings-content [role=alert]")).toContainText(
    "暂时无法退出",
  );
  await expect(page.locator(".settings-content")).toContainText(
    "已登录：测试玩家",
  );
  expect(errors).toEqual([]);
});
