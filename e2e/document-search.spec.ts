import { test, expect } from "@playwright/test";
import {
  gotoApp,
  setMockContentOverride,
  switchToMarkdownMode,
  waitForSyncComplete,
} from "./helpers/app";

test.describe("保存済み文書の検索", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "1" } });
  });

  test("本文キーワードでメモを検索し、結果から開ける", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();

    const dialog = page.getByRole("dialog", { name: "文書を検索" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("キーワードを入力してください")).toBeVisible();
    await expect(dialog.getByText("保存済みデータ")).toBeVisible();
    await expect(dialog.getByText("UIモック")).toHaveCount(0);

    await page.getByRole("textbox", { name: "検索キーワード" }).fill("IndexedDB");
    await expect(dialog.getByRole("option", { name: /開発メモ/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /議事録/ })).toHaveCount(0);

    await dialog.getByRole("option", { name: /開発メモ/ }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('input[value="開発メモ"]')).toBeVisible();
  });

  test("Ctrl+Kで開き、タスクに絞り込んでタスクへ移動できる", async ({ page }) => {
    await page.keyboard.press("Control+k");

    const dialog = page.getByRole("dialog", { name: "文書を検索" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("tab", { name: /タスク/ }).click();
    await page.getByRole("textbox", { name: "検索キーワード" }).fill("タイマー");
    await dialog.getByRole("option", { name: /タイマー表示のバグ/ }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('input[value="タイマー表示のバグ"]')).toBeVisible();
  });

  test("検索結果へ移動した後も検索条件と結果を保持する", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "文書を検索" });

    await dialog.getByRole("tab", { name: /タスク/ }).click();
    await dialog.getByRole("textbox", { name: "検索キーワード" }).fill("タイマー");
    await expect.poll(() => page.evaluate(() => window.__mockDocumentSearchCallCount ?? 0)).toBe(1);
    await dialog.getByRole("option", { name: /タイマー表示のバグ/ }).click();

    await page.getByRole("button", { name: "検索を開く" }).click();
    await expect(dialog.getByRole("textbox", { name: "検索キーワード" })).toHaveValue("タイマー");
    await expect(dialog.getByRole("tab", { name: /タスク/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByRole("option", { name: /タイマー表示のバグ/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__mockDocumentSearchCallCount ?? 0)).toBe(2);
  });

  test("アーカイブ済みメモを検索して読み取り専用で開ける", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });

    await dialog.getByRole("textbox", { name: "検索キーワード" }).fill("旧バグトラッカー");
    const result = dialog.getByRole("option", { name: /旧バグトラッカー/ });
    await expect(result.getByText("アーカイブ済み")).toBeVisible();
    await result.click();

    await expect(page.locator('input[value="旧バグトラッカー"]')).toBeVisible();
    await expect(page.getByText("アーカイブ済み・読み取り専用")).toBeVisible();
    await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "false");
    await expect(page.getByRole("toolbar", { name: "Formatting toolbar" })).toHaveCount(0);

    await page.getByRole("button", { name: "タスク", exact: true }).click();
    await page.getByRole("button", { name: "メモ", exact: true }).click();
    await expect(page.locator('input[value="旧バグトラッカー"]')).toBeVisible();
    await expect(page.getByText("アーカイブ済み・読み取り専用")).toBeVisible();
    await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "false");
  });

  test("アーカイブ済みタスクを検索して読み取り専用で開ける", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });

    await dialog.getByRole("textbox", { name: "検索キーワード" }).fill("旧ビルド設定");
    const result = dialog.getByRole("option", { name: /旧ビルド設定の削除/ });
    await expect(result.getByText("アーカイブ済み")).toBeVisible();
    await result.click();

    await expect(page.locator('input[value="旧ビルド設定の削除"]')).toBeVisible();
    await expect(page.getByText("アーカイブ済み・読み取り専用")).toBeVisible();
    await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "false");
    await expect(page.locator("[class*='task-date-input']").first()).toBeDisabled();

    await page.getByRole("button", { name: "メモ", exact: true }).click();
    await page.getByRole("button", { name: "タスク", exact: true }).click();
    await expect(page.locator('input[value="旧ビルド設定の削除"]')).toBeVisible();
    await expect(page.getByText("アーカイブ済み・読み取り専用")).toBeVisible();
    await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "false");

    await page.goBack();
    await page.goForward();
    await expect(page.locator('input[value="旧ビルド設定の削除"]')).toBeVisible();
    await expect(page.getByText("アーカイブ済み・読み取り専用")).toBeVisible();
    await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "false");
  });

  test("履歴で戻ってもアーカイブ済みメモを読み取り専用で復元する", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });

    await dialog.getByRole("textbox", { name: "検索キーワード" }).fill("旧バグトラッカー");
    await dialog.getByRole("option", { name: /旧バグトラッカー/ }).click();
    await expect(page.locator('input[value="旧バグトラッカー"]')).toBeVisible();

    await page.getByRole("button", { name: "検索を開く" }).click();
    await dialog.getByRole("textbox", { name: "検索キーワード" }).fill("IndexedDB");
    await dialog.getByRole("option", { name: /開発メモ/ }).click();
    await expect(page.locator('input[value="開発メモ"]')).toBeVisible();

    await page.goBack();
    await expect(page.locator('input[value="旧バグトラッカー"]')).toBeVisible();
    await expect(page.getByText("アーカイブ済み・読み取り専用")).toBeVisible();
    await expect(page.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "false");
  });

  test("該当なしとEscapeによる閉じる操作を表示できる", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });

    await page.getByRole("textbox", { name: "検索キーワード" }).fill("存在しないキーワード");
    await expect(dialog.getByText("一致する文書がありません")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("検索結果から開いた本文をハイライトして一致箇所を移動できる", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });
    await page.getByRole("textbox", { name: "検索キーワード" }).fill("改善");
    await dialog.getByRole("option", { name: /開発メモ/ }).click();

    const navigation = page.getByRole("search", { name: "本文内の検索結果" });
    await expect(navigation).toBeVisible();
    await expect(navigation).toContainText("1 / 2");
    await expect(page.locator(".hitomd-search-match")).toHaveCount(2);
    await expect(page.locator(".hitomd-search-match-active")).toHaveCount(1);

    await navigation.getByRole("button", { name: "次の一致箇所" }).click();
    await expect(navigation).toContainText("2 / 2");
    await expect(page.locator(".hitomd-search-match-active")).toHaveText("改善");

    await navigation.getByRole("button", { name: "本文内検索を終了" }).click();
    await expect(navigation).toBeHidden();
    await expect(page.locator(".hitomd-search-match")).toHaveCount(0);
  });

  test("本文を編集すると一致件数も更新される", async ({ page }) => {
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });
    await dialog.getByRole("textbox", { name: "検索キーワード" }).fill("改善");
    await dialog.getByRole("option", { name: /開発メモ/ }).click();

    const navigation = page.getByRole("search", { name: "本文内の検索結果" });
    await expect(navigation).toContainText("1 / 2");
    await waitForSyncComplete(page);

    const editor = page.locator(".ProseMirror");
    await editor.fill("検索語を削除しました");
    await expect(editor).not.toContainText("改善");

    await expect(navigation).toContainText("一致なし");
    await expect(page.locator(".hitomd-search-match")).toHaveCount(0);
  });

  test("Markdown表示では現在の一致箇所を選択してスクロール対象にできる", async ({ page }) => {
    await switchToMarkdownMode(page);
    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });
    await page.getByRole("textbox", { name: "検索キーワード" }).fill("改善");
    await dialog.getByRole("option", { name: /開発メモ/ }).click();

    const navigation = page.getByRole("search", { name: "本文内の検索結果" });
    await expect(navigation).toContainText("1 / 2");
    await expect
      .poll(() =>
        page
          .locator(".mdg-raw-editor")
          .evaluate((textarea: HTMLTextAreaElement) =>
            textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
          ),
      )
      .toBe("改善");

    await navigation.getByRole("button", { name: "次の一致箇所" }).click();
    await expect(navigation).toContainText("2 / 2");
    await expect
      .poll(() =>
        page
          .locator(".mdg-raw-editor")
          .evaluate((textarea: HTMLTextAreaElement) =>
            textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
          ),
      )
      .toBe("改善");
  });

  test("一致箇所が本文の下部にある場合は自動でスクロールする", async ({ page }) => {
    const spacer = Array.from(
      { length: 100 },
      (_, index) => `## セクション ${index + 1}\n\nスクロール確認用の本文です。`,
    ).join("\n\n");
    await setMockContentOverride(page, {
      content: `# 長い文書\n\n${spacer}\n\n## 対象\n\n最終改善ポイント`,
      updatedAt: "2030-01-01T00:00:00.000Z",
    });
    await page.reload();
    await expect(page.locator(".ProseMirror")).toContainText("最終改善ポイント");

    await page.getByRole("button", { name: "検索を開く" }).click();
    const dialog = page.getByRole("dialog", { name: "文書を検索" });
    await page.getByRole("textbox", { name: "検索キーワード" }).fill("改善");
    await dialog.getByRole("option", { name: /開発メモ/ }).click();

    await expect(page.getByRole("search", { name: "本文内の検索結果" })).toContainText("1 / 1");
    await expect
      .poll(() =>
        page.locator(".hitomd-search-match-active").evaluate((match) => {
          const scroller = match.closest<HTMLElement>("[class*='page-root']");
          return scroller?.scrollTop ?? 0;
        }),
      )
      .toBeGreaterThan(500);
  });
});
