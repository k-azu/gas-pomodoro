type SavedDocumentSearchFilter = "all" | "memo" | "task";
type SavedDocumentSearchType = "memo" | "task";

interface SavedDocumentSearchResult {
  type: SavedDocumentSearchType;
  id: string;
  title: string;
  path: string;
  snippet: string;
  tags?: string[];
  status?: string;
  isArchived: boolean;
  updatedAt: string;
}

interface SavedDocumentSearchResponse {
  results: SavedDocumentSearchResult[];
  counts: {
    all: number;
    memo: number;
    task: number;
  };
}

interface SavedDocumentSearchCandidate extends SavedDocumentSearchResult {
  content: string;
  score: number;
}

interface SavedDocumentNormalizedText {
  value: string;
  sourceOffsets: number[];
}

interface SavedDocumentSearchParent {
  name: string;
  isActive: boolean;
}

const SAVED_DOCUMENT_SEARCH_DEFAULT_LIMIT = 50;
const SAVED_DOCUMENT_SEARCH_MAX_LIMIT = 100;
const SAVED_DOCUMENT_SEARCH_MAX_QUERY_LENGTH = 200;
const SAVED_DOCUMENT_SEARCH_MAX_TOKENS = 10;
const SAVED_DOCUMENT_SEARCH_SNIPPET_LENGTH = 150;

/**
 * Search the latest content saved in the spreadsheet.
 *
 * Local/unsynced IndexedDB edits are intentionally not included. The caller
 * receives counts for every type and a filtered, score-sorted result page.
 */
function searchDocuments(
  rawQuery: string,
  rawFilter?: string,
  rawLimit?: number,
): SavedDocumentSearchResponse {
  const query = String(rawQuery || "")
    .slice(0, SAVED_DOCUMENT_SEARCH_MAX_QUERY_LENGTH)
    .trim();
  const tokens = documentSearchNormalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SAVED_DOCUMENT_SEARCH_MAX_TOKENS);
  const filter: SavedDocumentSearchFilter =
    rawFilter === "memo" || rawFilter === "task" ? rawFilter : "all";
  const requestedLimit = Number(rawLimit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), SAVED_DOCUMENT_SEARCH_MAX_LIMIT))
    : SAVED_DOCUMENT_SEARCH_DEFAULT_LIMIT;

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const candidates = [
    ...documentSearchReadMemos(spreadsheet),
    ...documentSearchReadTasks(spreadsheet),
  ];

  const matches = candidates
    .filter((candidate) => documentSearchMatches(candidate, tokens))
    .map((candidate) => ({
      ...candidate,
      score: documentSearchScore(candidate, tokens),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        documentSearchTimestamp(right.updatedAt) - documentSearchTimestamp(left.updatedAt) ||
        left.title.localeCompare(right.title, "ja"),
    );

  const memoCount = matches.filter((candidate) => candidate.type === "memo").length;
  const taskCount = matches.filter((candidate) => candidate.type === "task").length;
  const results = matches
    .filter((candidate) => filter === "all" || candidate.type === filter)
    .slice(0, limit)
    .map((candidate) => ({
      ...candidate,
      snippet: documentSearchBuildSnippet(candidate.content, tokens),
    }))
    .map(documentSearchToResult);

  return {
    results,
    counts: {
      all: memoCount + taskCount,
      memo: memoCount,
      task: taskCount,
    },
  };
}

function documentSearchReadMemos(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): SavedDocumentSearchCandidate[] {
  const sheet = spreadsheet.getSheetByName("Memos");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  return values
    .map((row) => ({
      type: "memo" as const,
      id: String(row[0] || ""),
      title: String(row[1] || ""),
      path: "メモ",
      content: String(row[2] || ""),
      snippet: "",
      tags: documentSearchParseTags(row[3]),
      isArchived: row[7] !== true,
      updatedAt: documentSearchDateString(row[5]),
      score: 0,
    }))
    .filter((candidate) => Boolean(candidate.id));
}

function documentSearchReadTasks(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): SavedDocumentSearchCandidate[] {
  const sheet = spreadsheet.getSheetByName("Tasks");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const projects = documentSearchReadParentMap(spreadsheet, "Projects", 0, 1);
  const cases = documentSearchReadParentMap(spreadsheet, "Cases", 0, 2);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();

  return values
    .map((row) => {
      const projectId = String(row[1] || "");
      const caseId = String(row[2] || "");
      const project = projects[projectId];
      const taskCase = cases[caseId];
      const projectName = project?.name;
      const caseName = taskCase?.name;
      const pathParts = [projectName, caseName].filter(Boolean);
      return {
        type: "task" as const,
        id: String(row[0] || ""),
        title: String(row[3] || ""),
        path: pathParts.length > 0 ? pathParts.join(" › ") : "タスク",
        content: String(row[4] || ""),
        snippet: "",
        status: String(row[5] || ""),
        isArchived:
          row[7] !== true ||
          (Boolean(projectId) && (!project || !project.isActive)) ||
          (Boolean(caseId) && (!taskCase || !taskCase.isActive)),
        updatedAt: documentSearchDateString(row[12]),
        score: 0,
      };
    })
    .filter((candidate) => Boolean(candidate.id));
}

function documentSearchReadParentMap(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  sheetName: string,
  idColumn: number,
  nameColumn: number,
): Record<string, SavedDocumentSearchParent> {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return {};

  const rowCount = sheet.getLastRow() - 1;
  const identities = sheet.getRange(2, 1, rowCount, nameColumn + 1).getValues();
  const activeValues = sheet.getRange(2, 6, rowCount, 1).getValues();
  const parents: Record<string, SavedDocumentSearchParent> = {};
  for (let rowIndex = 0; rowIndex < identities.length; rowIndex += 1) {
    const id = String(identities[rowIndex][idColumn] || "");
    if (id) {
      parents[id] = {
        name: String(identities[rowIndex][nameColumn] || ""),
        isActive: activeValues[rowIndex][0] === true,
      };
    }
  }
  return parents;
}

function documentSearchMatches(candidate: SavedDocumentSearchCandidate, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const searchable = documentSearchNormalize(
    [
      candidate.title,
      candidate.path,
      candidate.content,
      ...(candidate.tags || []),
      candidate.status || "",
    ].join(" "),
  );
  return tokens.every((token) => searchable.includes(token));
}

function documentSearchScore(candidate: SavedDocumentSearchCandidate, tokens: string[]): number {
  if (tokens.length === 0) return documentSearchTimestamp(candidate.updatedAt);

  const title = documentSearchNormalize(candidate.title);
  const path = documentSearchNormalize(candidate.path);
  const content = documentSearchNormalize(candidate.content);
  const tags = documentSearchNormalize((candidate.tags || []).join(" "));
  const status = documentSearchNormalize(candidate.status || "");

  return tokens.reduce((score, token) => {
    if (title === token) return score + 120;
    if (title.startsWith(token)) return score + 80;
    if (title.includes(token)) return score + 50;
    if (tags.includes(token)) return score + 28;
    if (status.includes(token)) return score + 20;
    if (path.includes(token)) return score + 16;
    if (content.includes(token)) return score + 12;
    return score;
  }, 0);
}

function documentSearchBuildSnippet(content: string, tokens: string[]): string {
  const plainText = documentSearchPlainText(content);
  if (!plainText) return "本文はありません";

  let sourceIndex = 0;
  if (tokens.length > 0) {
    const normalized = documentSearchNormalizeWithOffsets(plainText);
    let normalizedIndex = -1;
    for (const token of tokens) {
      const index = normalized.value.indexOf(token);
      if (index >= 0 && (normalizedIndex < 0 || index < normalizedIndex)) {
        normalizedIndex = index;
      }
    }
    if (normalizedIndex >= 0) {
      sourceIndex = normalized.sourceOffsets[normalizedIndex] || 0;
    }
  }

  const halfLength = Math.floor(SAVED_DOCUMENT_SEARCH_SNIPPET_LENGTH / 2);
  let start = Math.max(0, sourceIndex - halfLength);
  let end = Math.min(plainText.length, start + SAVED_DOCUMENT_SEARCH_SNIPPET_LENGTH);
  if (end === plainText.length) {
    start = Math.max(0, end - SAVED_DOCUMENT_SEARCH_SNIPPET_LENGTH);
  }

  const excerpt = plainText.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${end < plainText.length ? "…" : ""}`;
}

function documentSearchPlainText(markdown: string): string {
  return String(markdown || "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~>#]/g, "")
    .replace(/^\s*(?:[-+*]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function documentSearchNormalize(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja");
}

function documentSearchNormalizeWithOffsets(value: string): SavedDocumentNormalizedText {
  let normalized = "";
  const sourceOffsets: number[] = [];
  let sourceOffset = 0;

  for (const character of value) {
    const chunk = documentSearchNormalize(character);
    normalized += chunk;
    for (let index = 0; index < chunk.length; index += 1) {
      sourceOffsets.push(sourceOffset);
    }
    sourceOffset += character.length;
  }

  return { value: normalized, sourceOffsets };
}

function documentSearchParseTags(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_error) {
    return [];
  }
}

function documentSearchDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value || "");
}

function documentSearchTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function documentSearchToResult(
  candidate: SavedDocumentSearchCandidate,
): SavedDocumentSearchResult {
  return {
    type: candidate.type,
    id: candidate.id,
    title: candidate.title,
    path: candidate.path,
    snippet: candidate.snippet,
    ...(candidate.tags ? { tags: candidate.tags } : {}),
    ...(candidate.status ? { status: candidate.status } : {}),
    isArchived: candidate.isArchived,
    updatedAt: candidate.updatedAt,
  };
}
