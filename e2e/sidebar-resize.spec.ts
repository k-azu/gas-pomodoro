import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoApp } from "./helpers/app";

const RESIZER_NAME = "サイドバーの幅を変更";

async function dragResizer(page: Page, resizer: Locator, deltaX: number): Promise<void> {
  const box = await resizer.boundingBox();
  if (!box) throw new Error("Sidebar resizer is not visible");

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 5 });
  await page.mouse.up();
}

test("メモとタスクのサイドバー幅を個別に変更して保持する", async ({ page }) => {
  await gotoApp(page);

  const memoResizer = page.getByRole("separator", { name: RESIZER_NAME });
  await expect(memoResizer).toHaveAttribute("aria-valuenow", "260");
  await dragResizer(page, memoResizer, 80);
  await expect(memoResizer).toHaveAttribute("aria-valuenow", "340");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("gas_pomodoro_memo_sidebar_width")))
    .toBe("340");

  await page.getByRole("button", { name: "タスク", exact: true }).click();
  const taskResizer = page.getByRole("separator", { name: RESIZER_NAME });
  await expect(taskResizer).toHaveAttribute("aria-valuenow", "260");
  await taskResizer.press("End");
  await expect(taskResizer).toHaveAttribute("aria-valuenow", "480");

  await page.getByRole("button", { name: "メモ", exact: true }).click();
  await expect(memoResizer).toHaveAttribute("aria-valuenow", "340");

  await page.reload();
  await expect(page.getByRole("separator", { name: RESIZER_NAME })).toHaveAttribute(
    "aria-valuenow",
    "340",
  );
});

test("折りたたんでも変更したサイドバー幅を維持する", async ({ page }) => {
  await gotoApp(page);

  const resizer = page.getByRole("separator", { name: RESIZER_NAME });
  await resizer.press("Home");
  await expect(resizer).toHaveAttribute("aria-valuenow", "180");

  await page.locator('button[title="サイドバーを閉じる"]:visible').click();
  await expect(resizer).toBeHidden();
  await page.locator('button[title="サイドバーを開く"]:visible').click();
  await expect(page.getByRole("separator", { name: RESIZER_NAME })).toHaveAttribute(
    "aria-valuenow",
    "180",
  );
});

test("リサイズ領域が一覧のスクロール領域と重ならない", async ({ page }) => {
  await gotoApp(page);

  const resizer = page.getByRole("separator", { name: RESIZER_NAME });
  const list = page.locator("[class*='sidebar-list']:visible");
  const [resizerBox, listBox] = await Promise.all([resizer.boundingBox(), list.boundingBox()]);
  if (!resizerBox || !listBox) throw new Error("Sidebar layout is not visible");

  expect(listBox.x + listBox.width).toBeLessThanOrEqual(resizerBox.x);
});

test("リサイズ中の追加ポインターを無視してbodyの操作スタイルを復元する", async ({ page }) => {
  await gotoApp(page);

  const resizer = page.getByRole("separator", { name: RESIZER_NAME });
  const originalBodyStyle = await page.evaluate(() => ({
    cursor: document.body.style.cursor,
    userSelect: document.body.style.userSelect,
  }));

  await resizer.evaluate((element) => {
    element.setPointerCapture = () => undefined;
    const dispatch = (type: string, pointerId: number) => {
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          clientX: 250,
          pointerId,
          pointerType: "touch",
        }),
      );
    };

    dispatch("pointerdown", 1);
    dispatch("pointerdown", 2);
    dispatch("pointerup", 2);
    dispatch("pointerup", 1);
  });

  await expect
    .poll(() =>
      page.evaluate(() => ({
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      })),
    )
    .toEqual(originalBodyStyle);
});
