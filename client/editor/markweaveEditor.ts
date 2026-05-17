import {
  EditorBody as RichEditorBody,
  createEditorState,
  getDefaultExtensions as getCoreDefaultExtensions,
  insertImageWithUpload,
  parseMarkdown,
  useEditor,
} from "@markweave/editor-core";
export {
  RichEditorBody,
  createEditorState,
  getCoreDefaultExtensions,
  insertImageWithUpload,
  parseMarkdown,
  useEditor,
};
export type { Editor, EditorState, MentionTrigger } from "@markweave/editor-core";

export type EditorMode = "wysiwyg" | "markdown";

type CoreDefaultExtensionOptions = Parameters<typeof getCoreDefaultExtensions>[0];

type AppDefaultExtensionOptions = Omit<
  NonNullable<CoreDefaultExtensionOptions>,
  "onResolveLinkTitle"
> & {
  onResolveLink?: (url: string) => Promise<{ title?: string }>;
};

export function getDefaultExtensions(options?: AppDefaultExtensionOptions) {
  const { onResolveLink, ...rest } = options ?? {};
  return getCoreDefaultExtensions({
    ...rest,
    onResolveLinkTitle: onResolveLink,
  });
}
