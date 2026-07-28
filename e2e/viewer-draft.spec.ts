import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers/app";

const ACTIVE_VIEWER_KEY = "gas_pomodoro_active_viewer";

async function openHistory(page: Page, index = 1): Promise<void> {
  await page.locator("[class*='record-item-row']").nth(index).click();
  await expect(page.getByRole("button", { name: "履歴詳細" })).toBeVisible();
  await expect(page.locator(".ProseMirror:visible")).toBeEditable();
}

async function appendToViewer(page: Page, text: string): Promise<void> {
  const editor = page.locator(".ProseMirror:visible");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText(text);
}

test.describe("履歴詳細の未保存変更", () => {
  test("戻る時に保存・破棄・継続を選択できる", async ({ page }) => {
    await gotoApp(page);
    await openHistory(page);
    await appendToViewer(page, "戻るガード");

    await page.getByRole("button", { name: "戻る" }).click();
    const dialog = page.getByRole("dialog", { name: "未保存の変更" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "編集を続ける" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".ProseMirror:visible")).toContainText("戻るガード");

    await page.getByRole("button", { name: "戻る" }).click();
    await dialog.getByRole("button", { name: "変更を破棄" }).click();
    await expect(page.getByRole("button", { name: "履歴詳細" })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_VIEWER_KEY)).toBeNull();
  });

  test("別履歴選択時に現在の変更を破棄して移動できる", async ({ page }) => {
    await gotoApp(page);
    await openHistory(page);
    await appendToViewer(page, "別履歴ガード");

    await page.locator("[class*='record-item-row']").nth(2).click();
    const dialog = page.getByRole("dialog", { name: "未保存の変更" });
    await expect(dialog).toContainText("選択した履歴");
    await dialog.getByRole("button", { name: "変更を破棄" }).click();

    await expect(page.locator(".ProseMirror:visible")).toContainText("バグ調査");
    await expect(page.locator(".ProseMirror:visible")).not.toContainText("別履歴ガード");
  });

  test("別履歴選択時に保存してから移動し、保存失敗時は移動しない", async ({ page }) => {
    await gotoApp(page);
    await openHistory(page);
    await appendToViewer(page, "保存失敗保持");
    await page.waitForTimeout(1200);

    await page.locator("[class*='record-item-row']").nth(2).click();
    const dialog = page.getByRole("dialog", { name: "未保存の変更" });
    await page.evaluate(() => {
      (window as any).__mockContentShouldFail = true;
    });
    page.once("dialog", (alert) => alert.dismiss());
    await dialog.getByRole("button", { name: "保存して移動" }).click();

    await expect(dialog).toBeVisible();
    await expect(page.locator(".ProseMirror:visible")).toContainText("保存失敗保持");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("gas_pomodoro_viewer_draft:record:mock-rec-2"),
      ),
    ).not.toBeNull();

    await page.evaluate(() => {
      (window as any).__mockContentShouldFail = false;
    });
    await dialog.getByRole("button", { name: "保存して移動" }).click();
    await expect(page.locator(".ProseMirror:visible")).toContainText("バグ調査");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("gas_pomodoro_viewer_draft:record:mock-rec-2"),
      ),
    ).toBeNull();
  });

  test("再読み込み後にローカル下書きを復元する", async ({ page }) => {
    await gotoApp(page);
    await openHistory(page);
    await appendToViewer(page, "再読み込み復元");
    await page.waitForTimeout(1200);

    await page.reload();

    await expect(page.getByRole("button", { name: "履歴詳細" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("status")).toHaveText("未保存の変更を復元しました");
    await expect(page.locator(".ProseMirror:visible")).toContainText("再読み込み復元");
  });

  test("本文以外の変更だけでも再読み込み後に復元する", async ({ page }) => {
    await gotoApp(page);
    await openHistory(page);
    const startInput = page.locator("input[type='datetime-local']:visible").first();
    const original = await startInput.inputValue();
    const minute = (Number(original.slice(-2)) + 1) % 60;
    const changed = `${original.slice(0, -2)}${String(minute).padStart(2, "0")}`;
    await startInput.fill(changed);
    await page.waitForTimeout(1200);

    await page.reload();

    await expect(page.getByRole("button", { name: "履歴詳細" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("input[type='datetime-local']:visible").first()).toHaveValue(changed);
    await expect(page.getByRole("status")).toHaveText("未保存の変更を復元しました");
  });

  test("未編集でも最後に開いていた履歴詳細を新しいページで復元する", async ({ page }) => {
    await gotoApp(page);
    await openHistory(page);
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), ACTIVE_VIEWER_KEY))
      .not.toBeNull();

    const restoredPage = await page.context().newPage();
    await restoredPage.goto("/#tab=memo");

    await expect(restoredPage.getByRole("button", { name: "履歴詳細" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(restoredPage.locator(".ProseMirror:visible")).toContainText("コードレビュー");
    await expect(restoredPage.getByRole("status")).toHaveCount(0);
  });

  test("保存後の最新内容をクリーンな状態としてクラッシュ復元する", async ({ page }) => {
    await gotoApp(page);
    await openHistory(page);
    await appendToViewer(page, "保存後クラッシュ復元");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        }, ACTIVE_VIEWER_KEY),
      )
      .toMatchObject({ dirty: false });

    const restoredPage = await page.context().newPage();
    await restoredPage.goto("/#tab=memo");

    await expect(restoredPage.locator(".ProseMirror:visible")).toContainText(
      "保存後クラッシュ復元",
      { timeout: 10_000 },
    );
    await expect(restoredPage.getByRole("status")).toHaveCount(0);
    await expect(restoredPage.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  test("7日を超えた最新履歴詳細は自動復元しない", async ({ page }) => {
    await gotoApp(page);
    await openHistory(page);
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), ACTIVE_VIEWER_KEY))
      .not.toBeNull();
    await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const snapshot = JSON.parse(raw);
      snapshot.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem(key, JSON.stringify(snapshot));
    }, ACTIVE_VIEWER_KEY);

    const restoredPage = await page.context().newPage();
    await gotoApp(restoredPage);

    await expect(restoredPage.getByRole("button", { name: "履歴詳細" })).toHaveCount(0);
    expect(
      await restoredPage.evaluate((key) => localStorage.getItem(key), ACTIVE_VIEWER_KEY),
    ).toBeNull();
  });
});
