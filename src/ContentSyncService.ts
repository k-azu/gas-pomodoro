interface ContentSaveResult {
  status: "saved" | "conflict" | "notFound" | "inactive";
  content?: string;
  revision?: number;
  updatedAt?: string;
  mutationId?: string;
}

interface ContentSheetConfig {
  sheetName: string;
  idColumn: number;
  contentColumn: number;
  updatedAtColumn: number;
  revisionColumn: number;
  mutationColumn: number;
  isActiveColumn?: number;
}

interface EntityCreateSheetConfig {
  sheetName: string;
  idColumn: number;
  updatedAtColumn: number;
}

interface EntityCreateResult {
  id: string;
  updatedAt: string;
}

/** Serialize mutations that participate in the content active/revision invariant. */
function withContentMutationLock<T>(operation: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Append an entity row at most once for a caller-generated UUID.
 *
 * Create requests are retried when the client cannot observe their response,
 * and multiple tabs may adopt the same pending local entity. The server must
 * therefore treat an existing ID as the acknowledgement of the original
 * create without overwriting any metadata or content written afterwards.
 */
function createEntityRowOnce(
  config: EntityCreateSheetConfig,
  id: string,
  buildRow: (updatedAt: string, sortOrder: number) => unknown[],
): EntityCreateResult {
  return withContentMutationLock(() => {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName)!;
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const width = Math.max(config.idColumn, config.updatedAtColumn);
      const data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
      for (let i = data.length - 1; i >= 0; i--) {
        if (String(data[i][config.idColumn - 1]) !== id) continue;
        return {
          id,
          updatedAt: String(data[i][config.updatedAtColumn - 1] || new Date().toISOString()),
        };
      }
    }

    const updatedAt = new Date().toISOString();
    sheet.appendRow(buildRow(updatedAt, lastRow));
    SpreadsheetApp.flush();
    return { id, updatedAt };
  });
}

/**
 * Compare-and-set content write shared by memos/projects/cases/tasks.
 * The script lock is intentionally held only for the row lookup + write.
 */
function saveRevisionedContent(
  config: ContentSheetConfig,
  id: string,
  content: string,
  baseRevision: number,
  mutationId: string,
): ContentSaveResult {
  return withContentMutationLock(() => {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName)!;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { status: "notFound" };

    const width = Math.max(
      config.idColumn,
      config.contentColumn,
      config.updatedAtColumn,
      config.revisionColumn,
      config.mutationColumn,
      config.isActiveColumn || 0,
    );
    const data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (String(data[i][config.idColumn - 1]) !== id) continue;

      if (config.isActiveColumn && data[i][config.isActiveColumn - 1] !== true) {
        return { status: "inactive" };
      }

      const row = i + 2;
      const currentContent = String(data[i][config.contentColumn - 1] || "");
      const currentRevision = Math.max(1, Number(data[i][config.revisionColumn - 1]) || 1);
      const currentUpdatedAt = String(data[i][config.updatedAtColumn - 1] || "");
      const lastMutationId = String(data[i][config.mutationColumn - 1] || "");

      // A retry after a successful write returns the original acknowledgement.
      if (mutationId && lastMutationId === mutationId) {
        return {
          status: "saved",
          content: currentContent,
          revision: currentRevision,
          updatedAt: currentUpdatedAt,
          mutationId,
        };
      }

      if (currentRevision !== baseRevision) {
        return {
          status: "conflict",
          content: currentContent,
          revision: currentRevision,
          updatedAt: currentUpdatedAt,
        };
      }

      const nextRevision = currentRevision + 1;
      const updatedAt = new Date().toISOString();
      sheet.getRange(row, config.contentColumn).setValue(content);
      sheet.getRange(row, config.updatedAtColumn).setValue(updatedAt);
      sheet.getRange(row, config.revisionColumn).setValue(nextRevision);
      sheet.getRange(row, config.mutationColumn).setValue(mutationId);
      SpreadsheetApp.flush();

      return {
        status: "saved",
        content,
        revision: nextRevision,
        updatedAt,
        mutationId,
      };
    }
    return { status: "notFound" };
  });
}
