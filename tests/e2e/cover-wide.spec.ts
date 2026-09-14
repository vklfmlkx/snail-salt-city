import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("wide cover preserves whole illustration with menu outside and no black bars", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "wide desktop composition");
  for (const width of [1920, 2560]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "选择故事" })).toBeVisible();
    const img = page.locator(".cover-frame img");
    const dimensions = await img.evaluate(async (el: HTMLImageElement) => {
      await el.decode();
      const r = el.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
        fit: getComputedStyle(el).objectFit,
      };
    });
    expect(dimensions.naturalWidth).toBe(1683);
    expect(dimensions.naturalHeight).toBe(935);
    expect(dimensions.width / dimensions.height).toBeCloseTo(1683 / 935, 2);
    expect(dimensions.fit).toBe("contain");
    const illustration = await img.boundingBox(),
      menu = await page.locator(".title-controls").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(
      illustration!.x + illustration!.width,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(tmpdir(), `branch-cover-${width}.png`),
      fullPage: true,
    });
  }
});
