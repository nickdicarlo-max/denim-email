import { expect, test } from "@playwright/test";

test("landing page loads with Denim branding", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Denim|Case Engine/);
});
