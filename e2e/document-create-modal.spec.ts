import { expect, test } from "@playwright/test";
import { gotoApp, waitForSyncComplete } from "./helpers/app";

test("メモとプロジェクトを名前付きで新規作成する", async ({ page }) => {
  await gotoApp(page);
  await waitForSyncComplete(page);

  await page.getByRole("button", { name: "メモを新規作成" }).click();
  const memoDialog = page.getByRole("dialog", { name: "メモを新規作成" });
  await expect(memoDialog.getByRole("radio")).toHaveCount(0);
  await memoDialog.getByLabel("メモ名").fill("モーダルから作成したメモ");
  await memoDialog.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.getByText("モーダルから作成したメモ", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "タスク", exact: true }).click();
  await page.getByRole("button", { name: "プロジェクトを新規作成" }).click();
  const projectDialog = page.getByRole("dialog", { name: "プロジェクトを新規作成" });
  await expect(projectDialog.getByRole("radio")).toHaveCount(0);
  await projectDialog.getByLabel("プロジェクト名").fill("モーダルから作成したプロジェクト");
  await projectDialog.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.getByText("モーダルから作成したプロジェクト", { exact: true })).toBeVisible();
});

test("プロジェクト配下ではケースか直属タスクを選択して作成する", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "タスク", exact: true }).click();

  const project = page.locator('[data-type="project"][data-id="mock-proj-1"]');
  await project.hover();
  await project.getByRole("button", { name: "GAS Pomodoroに新規作成" }).click();

  let dialog = page.getByRole("dialog", { name: "「GAS Pomodoro」に新規作成" });
  await dialog.getByLabel("名前").fill("モーダルから作成したケース");
  const caseButton = dialog.getByRole("button", { name: "ケース作成" });
  const taskButton = dialog.getByRole("button", { name: "タスク作成" });
  const [caseBox, taskBox] = await Promise.all([
    caseButton.boundingBox(),
    taskButton.boundingBox(),
  ]);
  expect(caseBox).not.toBeNull();
  expect(taskBox).not.toBeNull();
  expect(Math.abs(caseBox!.y - taskBox!.y)).toBeLessThan(1);
  await caseButton.click();
  await expect(page.getByText("モーダルから作成したケース", { exact: true })).toBeVisible();

  await project.hover();
  await project.getByRole("button", { name: "GAS Pomodoroに新規作成" }).click();
  dialog = page.getByRole("dialog", { name: "「GAS Pomodoro」に新規作成" });
  await dialog.getByLabel("名前").fill("プロジェクト直属の新規タスク");
  await dialog.getByRole("button", { name: "タスク作成" }).click();

  await expect(
    project.locator(':scope > [class*="task-tree-children"] > [data-type="task"]', {
      hasText: "プロジェクト直属の新規タスク",
    }),
  ).toBeVisible();
});

test("ケース配下では種類選択なしでタスクを作成する", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "タスク", exact: true }).click();

  const project = page.locator('[data-type="project"][data-id="mock-proj-1"]');
  await project.locator("[class*='task-tree-toggle']").first().click();
  const caseItem = page.locator('[data-type="case"][data-id="mock-case-1"]');
  await caseItem.hover();
  await caseItem.getByRole("button", { name: "React化にタスクを追加" }).click();

  const dialog = page.getByRole("dialog", { name: "「React化」にタスクを作成" });
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await dialog.getByLabel("タスク名").fill("ケース直属の新規タスク");
  await dialog.getByRole("button", { name: "作成", exact: true }).click();

  await expect(
    caseItem.locator(':scope > [class*="task-tree-children"] > [data-type="task"]', {
      hasText: "ケース直属の新規タスク",
    }),
  ).toBeVisible();
});
