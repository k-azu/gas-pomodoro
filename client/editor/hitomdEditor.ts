import {
  clearSearchHighlights,
  EditorBody as RichEditorBody,
  createEditorState,
  findSearchTextRanges,
  getSearchHighlightSnapshot,
  getDefaultExtensions as getCoreDefaultExtensions,
  insertImageWithUpload,
  parseMarkdown,
  scrollToActiveSearchHighlight,
  setActiveSearchHighlight,
  setSearchHighlights,
  useEditor,
} from "@hitomd/editor-core";
export {
  clearSearchHighlights,
  RichEditorBody,
  createEditorState,
  findSearchTextRanges,
  getSearchHighlightSnapshot,
  getCoreDefaultExtensions,
  insertImageWithUpload,
  parseMarkdown,
  scrollToActiveSearchHighlight,
  setActiveSearchHighlight,
  setSearchHighlights,
  useEditor,
};
export type {
  Editor,
  EditorState,
  MentionTrigger,
  SearchHighlightSnapshot,
  SearchTextRange,
} from "@hitomd/editor-core";

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
  return [
    ...getCoreDefaultExtensions({
      ...rest,
      onResolveLinkTitle: onResolveLink,
      searchHighlight: true,
    }),
  ];
}
