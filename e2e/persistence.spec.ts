/**
 * D. コンテンツ永続化 — 入力 → IDB → リロード後復元
 * F. IDB 書き込みデバウンス
 */
import { test, expect } from "@playwright/test";
import { idbGet } from "./helpers/idb";
import {
  gotoApp,
  selectMemo,
  typeInEditor,
  waitForSyncComplete,
  getEditorText,
} from "./helpers/app";

const MEMO_STORE = "memos";
const MEMO_1_ID = "mock-memo-1"; // "開発メモ"

test.describe("D. コンテンツ永続化", () => {
  test("D1: 入力 → IDB 保存 + _contentDirtyAt 設定", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "永続化テスト");
    await page.waitForTimeout(2500); // 2s debounce + margin

    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("永続化テスト");
    expect(record._contentDirtyAt).not.toBeNull();
  });

  test("D2: リロード後 IDB から復元", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await typeInEditor(page, "リロード生存テスト");
    await page.waitForTimeout(2500); // Wait for debounce flush

    // Reload
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });

    // Verify IDB preserved
    const record = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(record.content).toContain("リロード生存テスト");

    // Verify editor displays it
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    const text = await getEditorText(page);
    expect(text).toContain("リロード生存テスト");
  });
});

test.describe("F. IDB 書き込みデバウンス", () => {
  test("F1: 入力直後は IDB に書き込まれず、2秒後に書き込まれる", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "デバウンステスト");

    // 直後 → IDB にはまだ反映されていない
    const before = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(before.content || "").not.toContain("デバウンステスト");

    // 2.5秒後 → IDB に反映
    await page.waitForTimeout(2500);
    const after = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(after.content).toContain("デバウンステスト");
  });

  test("F2: ドキュメント切替で前のドキュメントが即座にフラッシュされる", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "切替フラッシュ");

    // 直後 → まだ IDB にない
    const before = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(before.content || "").not.toContain("切替フラッシュ");

    // ドキュメント切替 → 即座にフラッシュ
    await selectMemo(page, "議事録");
    await page.waitForTimeout(500); // async IDB chain の完了待ち

    const after = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(after.content).toContain("切替フラッシュ");
  });

  test("F3: リロードで beforeunload フラッシュされる", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "リロードフラッシュ");

    // 直後 → まだ IDB にない
    const before = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(before.content || "").not.toContain("リロードフラッシュ");

    // リロード → beforeunload でフラッシュ
    await page.reload();
    await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });

    const after = await idbGet(page, MEMO_STORE, MEMO_1_ID);
    expect(after.content).toContain("リロードフラッシュ");
  });
});
