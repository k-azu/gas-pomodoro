/**
 * A. 初回ロード — mount 時の IDB → エディタ表示
 */
import { test, expect } from "@playwright/test";
import { idbGet, idbPut } from "./helpers/idb";
import {
  gotoApp,
  selectMemo,
  typeInEditor,
  waitForSyncComplete,
  getEditorText,
} from "./helpers/app";

const MEMO_STORE = "memos";
const MEMO_2_ID = "mock-memo-2"; // "議事録"

test.describe("A. 初回ロード", () => {
  test("A1: IDB に内容あり → エディタに表示", async ({ page }) => {
    // Seed content into IDB by typing
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "初回ロードテスト");
    await page.waitForTimeout(2500); // 2s debounce + margin

    // Reload → fresh initial load from IDB
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const text = await getEditorText(page);
    expect(text).toContain("初回ロードテスト");
  });

  test("A2: IDB 空 → 空エディタ", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    const text = await getEditorText(page);
    expect(text.trim()).toBe("");
  });

  test("A3: syncing → readOnly → 完了後 editable", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "800" } });
    await selectMemo(page, "開発メモ");

    // During sync: syncing indicator visible + editor readOnly
    const indicator = page.locator('[data-status="syncing"]');
    await expect(indicator).toBeVisible({ timeout: 3_000 });
    const editor = page.locator(".ProseMirror");
    await expect(editor).toHaveAttribute("contenteditable", "false", { timeout: 3_000 });

    // After sync: editor editable
    await waitForSyncComplete(page);
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 3_000 });
  });

  test("A4: 初回ロード後の undo でマークダウン形式にならない", async ({ page }) => {
    // Seed markdown content in memo2 (not auto-selected, so editor won't overwrite)
    await gotoApp(page);
    await waitForSyncComplete(page);
    const record = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    record.content = "# テスト見出し\n\n**太字テキスト**です";
    await idbPut(page, MEMO_STORE, record);

    // Reload → fresh initial load from IDB
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("太字テキスト", { timeout: 5_000 });

    // Press Ctrl+Z — should NOT revert to raw markdown
    await editor.click();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Control+z");
    }
    await page.waitForTimeout(200);

    const text = await getEditorText(page);
    expect(text).not.toContain("# ");
    expect(text).not.toContain("**");
  });
});
