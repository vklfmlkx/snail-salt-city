import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("题材标签多选筛选，离线生成说明不调用模型", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择故事" }).click();
  await expect(page.locator(".library-search input")).toHaveCount(0);
  await expect(page.locator(".tag-filter")).toHaveCount(0);
  await page.getByRole("button", { name: "筛选题材", exact: true }).click();
  const tags = page.locator(".tag-filter button");
  await expect(tags.first()).toBeVisible();
  const first = await tags.first().innerText();
  await tags.first().click();
  await expect(
    page.locator(".tag-filter button[aria-pressed=true]"),
  ).toHaveCount(1);
  const catalog = await (await page.request.get("/api/scenarios")).json();
  expect(await page.locator(".story-card").count()).toBe(
    catalog.scenarios.filter((s: any) => s.source.tags.includes(first)).length,
  );
  const second = await tags.nth(1).innerText();
  await tags.nth(1).click();
  await expect(page.locator(".story-card")).toHaveCount(
    catalog.scenarios.filter((s: any) =>
      [first, second].every((t) => s.source.tags.includes(t)),
    ).length,
  );
  await expect(
    page.getByText("同时包含全部所选标签", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.locator(".story-card")).toHaveCount(20);
  await page.getByRole("button", { name: "自生成剧本", exact: true }).click();
  await page.getByRole("button", { name: "生成新故事 →" }).click();
  await expect(
    page.getByRole("heading", { name: "登录后，写一个新故事" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成故事（消耗1次）" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: join(tmpdir(), `generation-${info.project.name}.png`),
  });
});
test("生成表单只能选2—5个标签，提交一次后显示进度", async ({ page }) => {
  const tags = ["悬疑", "脑洞", "科幻", "穿越", "冒险", "日常"],
    jobs: any[] = [];
  let calls = 0;
  await page.route("**/api/generation", async (route) => {
    if (route.request().method() === "POST") {
      calls++;
      const input = route.request().postDataJSON();
      expect(input.tags.length).toBe(5);
      jobs.push({
        ...input,
        status: "running",
        phase: "正在写完整剧本",
        version: null,
        error: null,
      });
      await route.fulfill({ json: { job: jobs[0] }, status: 202 });
    } else
      await route.fulfill({
        json: {
          tags,
          enabled: true,
          count: 20,
          jobs,
          dailyRemaining: 6,
          dailyLimit: 6,
          requiresLogin: false,
          oauthReady: true,
          slots: [],
        },
      });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "选择故事" }).click();
  await page.getByRole("button", { name: "自生成剧本", exact: true }).click();
  await page.getByRole("button", { name: "生成新故事 →" }).click();
  const submit = page.getByRole("button", { name: "生成故事（消耗1次）" });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: tags[0], exact: true }).click();
  await expect(submit).toBeDisabled();
  for (const tag of tags.slice(1, 5))
    await page.getByRole("button", { name: tag, exact: true }).click();
  await expect(
    page.getByRole("button", { name: tags[5], exact: true }),
  ).toBeDisabled();
  await submit.click();
  await expect(page.getByRole("status")).toContainText("正在写完整剧本");
  await expect(
    page.getByRole("button", { name: "正在写作，请稍等…" }),
  ).toBeDisabled();
  expect(calls).toBe(1);
  await expect(page.locator(".flipping-book")).toBeVisible();
  jobs[0].status = "failed";
  jobs[0].phase = "生成未完成";
  jobs[0].error = "这次写作超时了，未完成的稿件没有发布。";
  await expect(
    page.locator(".generation-jobs").getByRole("alert"),
  ).toContainText("写作超时", {
    timeout: 10000,
  });
  await expect(page.locator(".flipping-book")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "生成故事（消耗1次）" }),
  ).toBeEnabled();
});
