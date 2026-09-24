export type DocumentSearchType = "memo" | "project" | "case" | "task";
/** "task" covers the whole task hierarchy (project / case / task). */
export type DocumentSearchFilter = "all" | "memo" | "task";

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
