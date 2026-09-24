/**
 * Markdown モードとドキュメント切り替え
 *
 * ドキュメント切り替え時は常に WYSIWYG モードに戻る仕様。
 * Markdown モードでの編集内容はキャッシュに正しく保存される。
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
  getRawEditorText,
  setMockContentOverride,
} from "./helpers/app";

test.describe("Markdown モードとドキュメント切り替え", () => {
  test("M1: ドキュメント切り替え後は WYSIWYG モードに戻り正しい内容が表示される", async ({
    page,
  }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 を開いて内容を入力
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "メモ1テキスト");
    await page.waitForTimeout(300);

    // memo2 を開いて内容を入力
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "メモ2テキスト");
    await page.waitForTimeout(300);

    // マークダウンモードに切り替え
    await switchToMarkdownMode(page);
    const rawText = await getRawEditorText(page);
    expect(rawText).toContain("メモ2テキスト");

    // memo1 に切り替え → WYSIWYG に戻る
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // WYSIWYG で memo1 の内容が表示されている
    const text = await getEditorText(page);
    expect(text).toContain("メモ1テキスト");
    expect(text).not.toContain("メモ2テキスト");
  });

  test("M2: マークダウンモード → ドキュメント切り替え → Rich Text で正しい内容", async ({
    page,
  }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1, memo2 に内容を設定
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "リッチ確認用1");
    await page.waitForTimeout(300);

    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "リッチ確認用2");
    await page.waitForTimeout(300);

    // マークダウンモードに切り替え
    await switchToMarkdownMode(page);

    // memo1 に切り替え → WYSIWYG に戻る
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // 既に WYSIWYG なので直接確認
    const text = await getEditorText(page);
    expect(text).toContain("リッチ確認用1");
    expect(text).not.toContain("リッチ確認用2");
  });

  test("M3: マークダウンモードで編集 → ドキュメント切り替え → 戻ると編集内容が保存されている", async ({
    page,
  }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 を開く
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "初期テキスト");
    await page.waitForTimeout(300);

    // マークダウンモードに切り替えて編集
    await switchToMarkdownMode(page);
    const rawEditor = page.locator(".mdg-raw-editor");
    await rawEditor.click();
    // 末尾に追加
    await page.keyboard.press("End");
    await page.keyboard.insertText("\n追加行");
    // memo2 に切り替え → Markdown内容を即時保存してからWYSIWYGへ戻る
    await selectMemo(page, "議事録");
    await page.waitForTimeout(500);

    // memo1 に戻る → サーバー確認済みメモリsnapshotからWYSIWYGを作り直す
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    const text = await getEditorText(page);
    expect(text).toContain("初期テキスト");
    expect(text).toContain("追加行");
  });

  test("M5: ドキュメント往復 → 両ドキュメントの内容が正しい", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    // memo1 に入力
    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "往復テスト1");
    await page.waitForTimeout(300);

    // memo2 に入力
    await selectMemo(page, "議事録");
    await waitForSyncComplete(page);
    await typeInEditor(page, "往復テスト2");
    await page.waitForTimeout(300);

    // memo1 → memo2 → memo1 と往復（常に WYSIWYG）
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);
    let text = await getEditorText(page);
    expect(text).toContain("往復テスト1");

    await selectMemo(page, "議事録");
    await page.waitForTimeout(500);
    text = await getEditorText(page);
    expect(text).toContain("往復テスト2");

    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);
    text = await getEditorText(page);
    expect(text).toContain("往復テスト1");
  });

  test("M6: Markdown で編集 → 切り替え → 再度 Markdown で正しい内容", async ({ page }) => {
    await gotoApp(page);
    await waitForSyncComplete(page);

    await selectMemo(page, "開発メモ");
    await waitForSyncComplete(page);
    await typeInEditor(page, "マークダウン確認");
    await page.waitForTimeout(300);

    // Markdown モードに切り替え
    await switchToMarkdownMode(page);
    let rawText = await getRawEditorText(page);
    expect(rawText).toContain("マークダウン確認");

    // memo2 に切り替え → WYSIWYG に戻る
    await selectMemo(page, "議事録");
    await page.waitForTimeout(500);

    // memo1 に戻る → WYSIWYG
    await selectMemo(page, "開発メモ");
    await page.waitForTimeout(500);

    // 再度 Markdown モードに切り替え → 正しい内容が表示される
    await switchToMarkdownMode(page);
    rawText = await getRawEditorText(page);
    expect(rawText).toContain("マークダウン確認");
  });

  test("M7: モードを往復しても画面上端付近の文章を維持する", async ({ page }) => {
    const before = Array.from(
      { length: 24 },
      (_, index) => `# 大きな見出し ${index + 1}\n\n短い本文 ${index + 1}`,
    ).join("\n\n");
    const after = Array.from(
      { length: 16 },
      (_, index) => `## 後続見出し ${index + 1}\n\n後続本文 ${index + 1}`,
    ).join("\n\n");
    await setMockContentOverride(page, {
      content: `${before}\n\n## 表示位置の目印\n\nこの段落を表示したまま切り替える\n\n${after}`,
      updatedAt: "2030-01-01T00:00:00.000Z",
    });
    await gotoApp(page);
    await waitForSyncComplete(page);

    const marker = page.locator(".ProseMirror h2", { hasText: "表示位置の目印" });
    await marker.evaluate((element) => {
      const root = element.closest<HTMLElement>("[class*='page-root']");
      const toolbar = root?.querySelector<HTMLElement>(
        ".mdg-editor-toolbar-row, .mdg-editor-header",
      );
      if (!root || !toolbar) throw new Error("editor scroll container not found");
      root.scrollTop +=
        element.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom - 8;
    });

    await switchToMarkdownMode(page);
    const markdownOffset = await page.locator(".mdg-raw-editor").evaluate((textarea) => {
      const root = textarea.closest<HTMLElement>("[class*='page-root']");
      const toolbar = root?.querySelector<HTMLElement>(
        ".mdg-editor-toolbar-row, .mdg-editor-header",
      );
      if (!root || !toolbar) throw new Error("editor scroll container not found");
      const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight);
      const markerOffset = textarea.value.indexOf("## 表示位置の目印");
      const linesBefore = textarea.value.slice(0, markerOffset).split("\n").length - 1;
      return (
        textarea.getBoundingClientRect().top +
        linesBefore * lineHeight -
        toolbar.getBoundingClientRect().bottom
      );
    });
    expect(Math.abs(markdownOffset - 8)).toBeLessThan(35);

    await switchToRichTextMode(page);
    const richOffset = await marker.evaluate((element) => {
      const root = element.closest<HTMLElement>("[class*='page-root']");
      const toolbar = root?.querySelector<HTMLElement>(
        ".mdg-editor-toolbar-row, .mdg-editor-header",
      );
      if (!root || !toolbar) throw new Error("editor scroll container not found");
      return element.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom;
    });
    expect(Math.abs(richOffset - 8)).toBeLessThan(35);
  });
});
