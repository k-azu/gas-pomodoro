/**
 * App operation helpers for E2E tests
 */
import { expect, type Page } from "@playwright/test";

interface GotoAppOptions {
  /** URL query params (e.g. { mockDelay: "500" }) */
  params?: Record<string, string>;
  /** URL hash (e.g. "tab=memo") */
  hash?: string;
}

/**
 * Navigate to app with optional query params and hash, then wait for load.
 */
export async function gotoApp(page: Page, opts?: GotoAppOptions): Promise<void> {
  const params = new URLSearchParams(opts?.params);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const hash = opts?.hash ? `#${opts.hash}` : "#tab=memo";
  await page.goto(`/${qs}${hash}`);
  // Wait for app to render — the sidebar list should appear
  await page.waitForSelector("[class*='sidebar']", { timeout: 10_000 });
}

/**
 * Set __mockContentOverride via addInitScript so it's available before app code runs on reload.
 * Must be called BEFORE page.reload() or page.goto().
 */
export async function setMockContentOverride(page: Page, value: unknown): Promise<void> {
  await page.addInitScript((val: unknown) => {
    (window as any).__mockContentOverride = val;
  }, value);
}

/**
 * Set __mockContentShouldFail via addInitScript.
 * Must be called BEFORE page.reload() or page.goto().
 */
export async function setMockContentShouldFail(page: Page, shouldFail: boolean): Promise<void> {
  await page.addInitScript((val: boolean) => {
    (window as any).__mockContentShouldFail = val;
  }, shouldFail);
}

/**
 * Select a memo by name from the sidebar.
 */
export async function selectMemo(page: Page, name: string): Promise<void> {
  await page.locator("[class*='sidebar-item']", { hasText: name }).click();
  // Wait for editor to load (ProseMirror in rich text mode, or raw editor in markdown mode)
  await page.waitForSelector(".ProseMirror, .mdg-raw-editor", { timeout: 5_000 });
}

/**
 * Type text into the ProseMirror editor.
 * Uses keyboard.insertText for reliable multi-byte (Japanese) input.
 */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.waitForTimeout(100);
  await page.keyboard.insertText(text);
}

/**
 * Type text character-by-character (creates undo history per character group).
 * Use this when undo behavior matters.
 */
export async function typeInEditorSequentially(page: Page, text: string): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.waitForTimeout(100);
  await editor.pressSequentially(text, { delay: 50 });
}

/**
 * Wait for [data-status="syncing"] to disappear AND editor to become editable.
 */
export async function waitForSyncComplete(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('[data-status="syncing"]'), {
    timeout: 15_000,
  });
  // Also wait for editor to become editable (readOnly is cleared after resolve)
  const editor = page.locator(".ProseMirror");
  if (await editor.count()) {
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 5_000 });
  }
}

/**
 * Get the text content of the ProseMirror editor.
 */
export async function getEditorText(page: Page): Promise<string> {
  return page.locator(".ProseMirror").innerText();
}

/**
 * Switch to Markdown mode by clicking the Markdown button in the mode toggle.
 */
export async function switchToMarkdownMode(page: Page): Promise<void> {
  await page.locator(".mdg-mode-btn", { hasText: "Markdown" }).click();
  await page.waitForSelector(".mdg-raw-editor", { timeout: 3_000 });
}

/**
 * Switch to Rich Text (WYSIWYG) mode by clicking the Rich Text button.
 */
export async function switchToRichTextMode(page: Page): Promise<void> {
  await page.locator(".mdg-mode-btn", { hasText: "Rich Text" }).click();
  await page.waitForSelector(".ProseMirror", { timeout: 3_000 });
}

/**
 * Get the text content of the raw markdown editor (textarea).
 */
export async function getRawEditorText(page: Page): Promise<string> {
  return page.locator(".mdg-raw-editor").inputValue();
}
