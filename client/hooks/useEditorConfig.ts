/**
 * useEditorConfig — unified editor configuration for all editor instances
 *
 * Combines: onImageUpload + mentions + Drive URL transforms.
 * All editor usage sites import this hook and spread the returned props.
 */
import { useMentionConfig } from "./useMentionConfig";
import { handleImageUpload, resolveDriveUrls, blobUrlsToDrive } from "../lib/imageCache";

export function useEditorConfig() {
  const mentions = useMentionConfig();

  return {
    /** Props to spread onto <DocumentEditor> */
    editorProps: {
      onImageUpload: handleImageUpload,
      mentions,
    },
    /** Options to spread into useDocumentEditor() */
    hookOptions: {
      transformOnLoad: resolveDriveUrls,
      transformOnSave: blobUrlsToDrive,
    },
  };
}
