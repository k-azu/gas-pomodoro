import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers/app";

test.describe("プロジェクト・案件の検索", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "1" } });
  });

  test("案件を検索して開ける", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });

    await dialog.getByRole("textbox", { name: "検索キーワード" }).fill("React化");
    const result = dialog.getByRole("option").filter({ hasText: "案件" }).first();
    await expect(result).toBeVisible();
    await result.click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('input[value="React化"]')).toBeVisible();
  });

  test("タスクの絞り込みにはプロジェクトも含まれる", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });

    await dialog.getByRole("tab", { name: /タスク/ }).click();
    await dialog.getByRole("textbox", { name: "検索キーワード" }).fill("GAS Pomodoro");
    await expect(
      dialog.getByRole("option").filter({ hasText: "プロジェクト" }).first(),
    ).toBeVisible();
  });
});
