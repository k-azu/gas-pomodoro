/**
 * M7/M8: Markdown モードでドキュメント切替後に rawMarkdownRef が
 *        旧ドキュメントの内容のまま残るバグの再現テスト
 *
 * 原因: useMarkdownEditor のドキュメント切替 effect が rawMarkdownRef を更新しない
 *
 * テスト手法:
 * - rawMarkdownRef に直接アクセスはできないため、
 *   ドキュメント切替直後に Markdown → WYSIWYG を連続実行して内容を検証する
 * - getEditorText() で WYSIWYG の内容を確認し、旧ドキュメント内容の混入を検出する
 */
import { test, expect } from "@playwright/test";
import {
  gotoApp,
  selectMemo,
  typeInEditor,
  waitForSyncComplete,
  getEditorText,
  switchToMarkdownMode,
  switchToRichTextMode,
} from "./helpers/app";

test.describe("Markdown stale ref on document switch", () => {
  test("M7: Markdown モードでドキュメント切替 → Markdown → WYSIWYG で正しい内容", async ({
    page,
  }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 に固有テキストを入力
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "ALPHA_CONTENT");
    await page.waitForTimeout(300);

    // memo2 に固有テキストを入力
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "BETA_CONTENT");
    await page.waitForTimeout(300);

    // memo2 で Markdown モードに切り替え
    await switchToMarkdownMode(page);
    await page.waitForTimeout(200);

    // memo1 に切り替え（effect が WYSIWYG に戻す）
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // memo1 で Markdown → WYSIWYG の往復
    // setMode("markdown") は editor.getMarkdown() から読むので常に正しい
    // setMode("wysiwyg") は rawMarkdownRef.current から読む ← ここが stale の可能性
    await switchToMarkdownMode(page);
    await page.waitForTimeout(100);
    await switchToRichTextMode(page);
    await page.waitForTimeout(200);

    const text = await getEditorText(page);
    expect(text).toContain("ALPHA_CONTENT");
    expect(text).not.toContain("BETA_CONTENT");
  });

  test("M8: Markdown 編集 → ドキュメント切替 → Markdown → WYSIWYG で正しい内容", async ({
    page,
  }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 に入力
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "FIRST_MEMO_TEXT");
    await page.waitForTimeout(300);

    // memo2 に入力
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "SECOND_MEMO_TEXT");
    await page.waitForTimeout(300);

    // memo1 に戻って Markdown モードで追加編集
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(300);
    await switchToMarkdownMode(page);
    const rawEditor = page.locator(".mdg-raw-editor");
    await rawEditor.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("\nMD_ONLY_EDIT");
    await page.waitForTimeout(200);

    // memo2 に切り替え（effect が WYSIWYG に戻す）
    await selectMemo(page, "議事録");
    await page.waitForTimeout(500);

    // memo2 で Markdown → WYSIWYG 往復
    await switchToMarkdownMode(page);
    await page.waitForTimeout(100);
    await switchToRichTextMode(page);
    await page.waitForTimeout(200);

    // memo2 の内容のみ表示されていること
    const text = await getEditorText(page);
    expect(text).toContain("SECOND_MEMO_TEXT");
    expect(text).not.toContain("FIRST_MEMO_TEXT");
    expect(text).not.toContain("MD_ONLY_EDIT");
  });
});
