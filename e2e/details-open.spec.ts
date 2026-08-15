import { expect, test } from "@playwright/test";
import { gotoApp, selectMemo, setMockContentOverride, waitForSyncComplete } from "./helpers/app";

test("Details本文はEditorStateを作り直す文書切り替え後も保持される", async ({ page }) => {
  await setMockContentOverride(page, {
    content:
      "<details>\n<summary>テスト見出し</summary>\n\n隠しコンテンツ\n\n</details>\n\nその他テキスト",
    updatedAt: "2030-01-01T00:00:00.000Z",
  });
  await gotoApp(page);
  await waitForSyncComplete(page);

  await expect(page.locator(".mdg-details")).toBeVisible();
  await selectMemo(page, "議事録");
  await selectMemo(page, "開発メモ");

  await expect(page.locator(".mdg-details")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText("隠しコンテンツ");
});
