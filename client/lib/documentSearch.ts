import type { DocumentSearchFilter, DocumentSearchResponse } from "../types/search";
import { serverCall } from "./serverCall";

const SEARCH_RESULT_LIMIT = 50;

export async function searchSavedDocuments(
  query: string,
  filter: DocumentSearchFilter,
): Promise<DocumentSearchResponse> {
  const response = (await serverCall(
    "searchDocuments",
    query,
    filter,
    SEARCH_RESULT_LIMIT,
  )) as DocumentSearchResponse | null;

  if (!response || !Array.isArray(response.results) || !response.counts) {
    throw new Error("検索結果の形式が正しくありません");
  }

  return response;
}
