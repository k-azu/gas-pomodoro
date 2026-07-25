export type DocumentSearchType = "memo" | "task";
export type DocumentSearchFilter = "all" | DocumentSearchType;

export interface DocumentSearchCounts {
  all: number;
  memo: number;
  task: number;
}

export interface DocumentSearchResult {
  type: DocumentSearchType;
  id: string;
  title: string;
  path: string;
  snippet: string;
  tags?: string[];
  status?: string;
  isArchived: boolean;
  updatedAt: string;
}

export interface DocumentSearchResponse {
  results: DocumentSearchResult[];
  counts: DocumentSearchCounts;
}
