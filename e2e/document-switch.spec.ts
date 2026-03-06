/**
 * B. ドキュメント切り替え — キャッシュ or IDB → switchDocument
 */
import { test, expect } from "@playwright/test";
import { idbGet, idbPut } from "./helpers/idb";
import {
  gotoApp,
  selectMemo,
  typeInEditor,
  typeInEditorSequentially,
  waitForSyncComplete,
  getEditorText,
} from "./helpers/app";

const MEMO_STORE = "memos";
const MEMO_1_ID = "mock-memo-1"; // "開発メモ"
const MEMO_2_ID = "mock-memo-2"; // "議事録"

test.describe("B. ドキュメント切り替え", () => {
  test("B1: キャッシュなし → IDB から読み込み", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Open memo1 first (memo2 has never been opened → no cache)
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Seed content to memo2 directly in IDB
    const record = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    record.content = "IDB直接書き込み";
    await idbPut(page, MEMO_STORE, record);

    // Switch to memo2 (no cache → reads from IDB)
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    const text = await getEditorText(page);
    expect(text).toContain("IDB直接書き込み");
  });

  test("B2: キャッシュあり → IDB スキップ + キャッシュ復元", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Open memo1 and type (creates editor cache)
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "キャッシュ内容");
    await page.waitForTimeout(500);

    // Switch to memo2 (saves memo1 EditorState to cache)
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    // Modify memo1 content directly in IDB (simulate external change)
    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    record.content = "IDB上書き内容";
    await idbPut(page, MEMO_STORE, record);

    // Switch back to memo1 (cache hit → IDB skipped)
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText("キャッシュ内容", {
      timeout: 3_000,
    });

    // Verify IDB-modified content is NOT shown
    const text = await getEditorText(page);
    expect(text).not.toContain("IDB上書き内容");
  });

  test("B3: 往復で両ドキュメントの内容保持", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Type in memo1
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "メモ1の内容");
    await page.waitForTimeout(300);

    // Type in memo2
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "メモ2の内容");
    await page.waitForTimeout(2500); // Wait for debounce to flush

    // Switch back to memo1
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText("メモ1の内容", {
      timeout: 3_000,
    });

    // Verify both in IDB (switch flushes memo2, debounce already flushed too)
    await page.waitForTimeout(500);
    const rec1 = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    const rec2 = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    expect(rec1.content).toContain("メモ1の内容");
    expect(rec2.content).toContain("メモ2の内容");
  });

  test("B4: 同セッション再選択 → resolve スキップ", async ({ page }) => {
    await gotoApp(page, { params: { mockDelay: "500" } });
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Switch away and back
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");

    // Should NOT show syncing (_resolveStatus prevents re-resolve)
    await page.waitForTimeout(300);
    const indicator = page.locator('[data-status="syncing"]');
    await expect(indicator).not.toBeVisible();
  });

  test("B5: キャッシュなし切り替え後の undo でマークダウン形式にならない", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Open memo1 (memo2 is never opened → no cache)
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);

    // Seed markdown content to memo2 in IDB
    const record = await idbGet(page, MEMO_STORE, MEMO_2_ID);
    record.content = "# 議事録タイトル\n\n- **重要**: ポイント1";
    await idbPut(page, MEMO_STORE, record);

    // Switch to memo2 (no cache → reads from IDB, EditorState.create resets history)
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("重要", { timeout: 3_000 });

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

  test("B6: キャッシュあり切り替え後の undo で入力が取り消される", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // Open memo1 and type (creates undo history + editor cache)
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "BaseText");
    await page.waitForTimeout(300);

    // Switch to memo2 (saves memo1 EditorState with undo history to cache)
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);

    // Switch back to memo1 (cache hit → undo history restored)
    await selectMemo(page, "開発メモ");
    await expect(page.locator(".ProseMirror")).toContainText("BaseText", {
      timeout: 3_000,
    });

    // Type more text after returning (use pressSequentially for undo granularity)
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.waitForTimeout(200);
    await page.keyboard.press("End");
    await typeInEditorSequentially(page, "Extra");
    await page.waitForTimeout(200);
    expect(await getEditorText(page)).toContain("BaseTextExtra");

    // Press Ctrl+Z — should undo the "Extra" portion
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(200);

    const text = await getEditorText(page);
    expect(text).toContain("BaseText");
    expect(text).not.toContain("Extra");
  });
});
