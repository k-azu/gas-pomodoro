/**
 * useEditorConfig — unified editor configuration for all editor instances
 *
 * Combines: onImageUpload + mentions + Drive URL transforms.
 * All editor usage sites import this hook and spread the returned props.
 */
import { useCallback } from "react";
import { useMentionConfig } from "./useMentionConfig";
import { handleImageUpload, resolveDriveUrls, blobUrlsToDrive } from "../lib/imageCache";
import { serverCall } from "../lib/serverCall";

export function useEditorConfig() {
  const mentions = useMentionConfig();

  const onResolveLink = useCallback(
    (url: string) => serverCall("resolveLink", url) as Promise<{ title?: string }>,
    [],
  );

  return {
    /** Props to spread onto <EditorLayout> or useMarkdownEditor/useDocumentEditor */
    editorProps: {
      onImageUpload: handleImageUpload,
      onResolveLink,
      mentions,
    },
    /** Options to spread into useDocumentEditor() */
    hookOptions: {
      transformOnLoad: resolveDriveUrls,
      transformOnSave: blobUrlsToDrive,
    },
  };
}
