/**
 * Details ブロックの展開状態がドキュメント切り替えで保存されるかテスト
 */
import { test, expect } from "@playwright/test";
import { idbGet, idbPut } from "./helpers/idb";
import { gotoApp, selectMemo, waitForSyncComplete } from "./helpers/app";

const MEMO_STORE = "memos";
const MEMO_1_ID = "mock-memo-1";
const MEMO_2_ID = "mock-memo-2";

test.describe("Details ブロックの展開状態", () => {
  test("キャッシュヒットで展開状態が保持される", async ({ page }) => {
    // Seed details block into memo1
    await gotoApp(page);
    await waitForSyncComplete(page);
    const record1 = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    record1.content =
      "<details>\n<summary>テスト見出し</summary>\n\n隠しコンテンツ\n\n</details>\n\nその他テキスト";
    await idbPut(page, MEMO_STORE, record1);

    // Reload to pick up the seeded content
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Verify details block exists and is closed
    const details = page.locator(".mdg-details");
    await expect(details).toBeVisible();
    await expect(details).not.toHaveClass(/is-open/);

    // Check initial DOM structure
    const btnCount = await details.locator("> button").count();
    const detailsHtml = await details.evaluate((el) => el.outerHTML.substring(0, 300));
    console.log("button count:", btnCount);
    console.log("details html:", detailsHtml);

    // Click toggle to open
    const btn = details.locator("> button");
    await btn.click();
    await page.waitForTimeout(500);

    const classAfterClick = await details.getAttribute("class");
    console.log("class after click:", classAfterClick);

    // Check if detailsContent hidden attribute changed
    const contentHidden = await page.evaluate(() => {
      const dc = document.querySelector('[data-type="detailsContent"]');
      return dc ? dc.hasAttribute("hidden") : "not found";
    });
    console.log("content hidden after click:", contentHidden);

    // Debug: check ProseMirror state has open=true
    const debugAfterToggle = await page.evaluate(() => {
      const pm = document.querySelector(".ProseMirror") as any;
      // tiptap stores editor on the DOM element
      const editor = pm?.editor;
      const hasEditor = !!editor;
      // Also try pmViewDesc (ProseMirror internals)
      const pmView = pm?.pmViewDesc?.view;
      const hasPmView = !!pmView;
      // Try to find details node attrs
      const state = editor?.state ?? pmView?.state;
      if (!state) return { hasEditor, hasPmView, error: "no state" };
      const details: any[] = [];
      state.doc.descendants((node: any) => {
        if (node.type.name === "details") {
          details.push({ open: node.attrs.open, attrs: { ...node.attrs } });
        }
      });
      // Also check schema for open attribute
      const detailsType = state.schema.nodes.details;
      const hasOpenAttr = detailsType?.spec?.attrs?.open !== undefined;
      return { hasEditor, hasPmView, details, hasOpenAttr };
    });
    console.log("debug after toggle:", JSON.stringify(debugAfterToggle));

    // Switch to memo2
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    // Switch back to memo1
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // skip restore debug for now

    // Check details is still open
    const detailsAfter = page.locator(".mdg-details");
    await expect(detailsAfter).toHaveClass(/is-open/);
  });
});
