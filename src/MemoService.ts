interface MemoMetadata {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  isActive: boolean;
}

interface MemoTag {
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

const MEMOS_CACHE_KEY = "memos_meta_v1";
const MEMO_TAGS_CACHE_KEY = "memo_tags_v1";
const MEMO_CACHE_TTL = 300; // 5 minutes

function getMemos(): MemoMetadata[] {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(MEMOS_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as MemoMetadata[];
    } catch (_e) {
      // fall through
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Memos")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const result = data
    .filter((row) => row[7] === true)
    .map((row) => ({
      id: String(row[0]),
      name: String(row[1]),
      tags: parseTags(row[3]),
      createdAt: String(row[4]),
      updatedAt: String(row[5]),
      sortOrder: Number(row[6]),
      isActive: Boolean(row[7]),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  cache.put(MEMOS_CACHE_KEY, JSON.stringify(result), MEMO_CACHE_TTL);
  return result;
}

function getMemoContent(
  memoId: string,
): { id: string; content: string } | null {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Memos")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === memoId) {
      const content = String(sheet.getRange(i + 2, 3).getValue());
      return { id: memoId, content };
    }
  }
  return null;
}

function saveMemo(memo: {
  id?: string;
  name: string;
  content: string;
  tags?: string[];
}): { success: boolean; id: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Memos")!;
  const now = new Date().toISOString();
  const tagsJson = JSON.stringify(memo.tags || []);

  if (memo.id) {
    // Update existing
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0]) === memo.id) {
          const row = i + 2;
          sheet.getRange(row, 2).setValue(memo.name);
          sheet.getRange(row, 3).setValue(memo.content);
          sheet.getRange(row, 4).setValue(tagsJson);
          sheet.getRange(row, 6).setValue(now);
          invalidateMemoCache();
          return { success: true, id: memo.id };
        }
      }
    }
  }

  // Insert new
  const id = memo.id || Utilities.getUuid();
  const lastRow = sheet.getLastRow();
  const nextOrder = lastRow; // 1-based after header
  sheet.appendRow([id, memo.name, memo.content, tagsJson, now, now, nextOrder, true]);
  invalidateMemoCache();
  return { success: true, id };
}

function deleteMemo(memoId: string): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Memos")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === memoId) {
      sheet.getRange(i + 2, 8).setValue(false); // isActive = false
      invalidateMemoCache();
      return { success: true };
    }
  }
  return { success: false };
}

function renameMemo(
  memoId: string,
  newName: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Memos")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === memoId) {
      sheet.getRange(i + 2, 2).setValue(newName);
      sheet.getRange(i + 2, 6).setValue(new Date().toISOString());
      invalidateMemoCache();
      return { success: true };
    }
  }
  return { success: false };
}

function updateMemoTags(
  memoId: string,
  tags: string[],
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Memos")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === memoId) {
      sheet.getRange(i + 2, 4).setValue(JSON.stringify(tags));
      sheet.getRange(i + 2, 6).setValue(new Date().toISOString());
      invalidateMemoCache();
      return { success: true };
    }
  }
  return { success: false };
}

function getMemoTags(): MemoTag[] {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(MEMO_TAGS_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as MemoTag[];
    } catch (_e) {
      // fall through
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MemoTags")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const result = data
    .filter((row) => row[3] === true)
    .map((row) => ({
      name: String(row[0]),
      color: String(row[1]),
      sortOrder: Number(row[2]),
      isActive: Boolean(row[3]),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  cache.put(MEMO_TAGS_CACHE_KEY, JSON.stringify(result), MEMO_CACHE_TTL);
  return result;
}

function addMemoTag(
  name: string,
  color?: string,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MemoTags")!;
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    if (existing.some((row) => String(row[0]) === name)) {
      return { success: false, message: "タグが既に存在します" };
    }
  }

  const nextOrder = lastRow;
  sheet.appendRow([name, color || "#757575", nextOrder, true]);
  CacheService.getScriptCache().remove(MEMO_TAGS_CACHE_KEY);
  return { success: true };
}

function updateMemoTagColor(
  name: string,
  color: string,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MemoTags")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false, message: "タグが見つかりません" };

  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === name) {
      sheet.getRange(i + 2, 2).setValue(color);
      CacheService.getScriptCache().remove(MEMO_TAGS_CACHE_KEY);
      return { success: true };
    }
  }
  return { success: false, message: "タグが見つかりません" };
}

function saveMemoContent(
  memoId: string,
  content: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Memos")!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === memoId) {
      // Skip soft-deleted memos
      if (data[i][7] !== true) return { success: false };
      sheet.getRange(i + 2, 3).setValue(content);
      sheet.getRange(i + 2, 6).setValue(new Date().toISOString());
      return { success: true };
    }
  }
  return { success: false };
}

// --- Helpers ---
function parseTags(val: unknown): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(String(val));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function invalidateMemoCache(): void {
  CacheService.getScriptCache().remove(MEMOS_CACHE_KEY);
}
