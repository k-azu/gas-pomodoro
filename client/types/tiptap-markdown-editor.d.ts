/**
 * Fallback type declarations for tiptap-markdown-editor (CDN build).
 *
 * When the real package is installed (link:../tiptap-markdown-editor),
 * TypeScript uses its bundled types and this file is ignored.
 * When the package is absent (public users), this provides minimal types
 * so that typecheck passes without the private repo.
 */
declare module "tiptap-markdown-editor" {
  import type { ComponentType } from "react";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Editor = any;

  export type EditorMode = "wysiwyg" | "markdown";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type EditorState = any;

  export interface MentionTrigger {
    char: string;
    scheme: string;
    items: (query: string) => { id: string; label: string }[];
    onClick?: (id: string) => void;
  }

  export type ToolbarItem =
    | { type: "button"; name: string; action?: (editor: Editor) => void; [key: string]: unknown }
    | { type: "separator" };

  export function useEditor(options: {
    extensions?: unknown[];
    content?: string;
    contentType?: "markdown" | "html";
    editable?: boolean;
    onUpdate?: (props: { editor: Editor; transaction: any }) => void;
    onFocus?: () => void;
    onBlur?: () => void;
  }): Editor | null;

  export function getDefaultExtensions(options?: {
    onImageUpload?: (file: File) => Promise<string>;
    mentions?: MentionTrigger[];
  }): unknown[];

  export function parseMarkdown(editor: Editor, markdown: string): unknown;
  export function createEditorState(editor: Editor, doc: unknown): EditorState;

  export const Toolbar: ComponentType<{
    editor: Editor;
    items?: ToolbarItem[] | false;
  }>;

  export const EditorBody: ComponentType<{
    editor: Editor;
    mode: EditorMode;
    rawMarkdown: string;
    setRawMarkdown: (md: string) => void;
    placeholder?: string;
    readOnly?: boolean;
  }>;

  export const DEFAULT_TOOLBAR_ITEMS: ToolbarItem[];

  export function insertImageWithUpload(
    editor: Editor,
    file: File,
    upload: (file: File) => Promise<string>,
  ): void;
}
