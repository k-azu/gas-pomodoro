interface CategoryItem {
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

const CATEGORIES_CACHE_KEY = "categories_v1";
const INT_CATEGORIES_CACHE_KEY = "int_categories_v1";
const CACHE_TTL = 300; // 5 minutes

function getCategories(): CategoryItem[] {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CATEGORIES_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as CategoryItem[];
    } catch (_e) {
      // fall through
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Categories")!;
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

  cache.put(CATEGORIES_CACHE_KEY, JSON.stringify(result), CACHE_TTL);
  return result;
}

function getInterruptionCategories(): CategoryItem[] {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(INT_CATEGORIES_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as CategoryItem[];
    } catch (_e) {
      // fall through
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("InterruptionCategories")!;
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

  cache.put(INT_CATEGORIES_CACHE_KEY, JSON.stringify(result), CACHE_TTL);
  return result;
}

function addCategory(
  name: string,
  color?: string,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Categories")!;
  const lastRow = sheet.getLastRow();

  // Check for duplicate
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    if (existing.some((row) => String(row[0]) === name)) {
      return { success: false, message: "カテゴリが既に存在します" };
    }
  }

  const nextOrder = lastRow;
  sheet.appendRow([name, color || "#757575", nextOrder, true]);

  // Invalidate cache
  CacheService.getScriptCache().remove(CATEGORIES_CACHE_KEY);

  return { success: true };
}

function addInterruptionCategory(
  name: string,
  color?: string,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("InterruptionCategories")!;
  const lastRow = sheet.getLastRow();

  // Check for duplicate
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    if (existing.some((row) => String(row[0]) === name)) {
      return { success: false, message: "カテゴリが既に存在します" };
    }
  }

  const nextOrder = lastRow;
  sheet.appendRow([name, color || "#757575", nextOrder, true]);

  // Invalidate cache
  CacheService.getScriptCache().remove(INT_CATEGORIES_CACHE_KEY);

  return { success: true };
}

function getAllCategoriesForSettings(sheetType: string): CategoryItem[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName =
    sheetType === "InterruptionCategories"
      ? "InterruptionCategories"
      : "Categories";
  const sheet = ss.getSheetByName(sheetName)!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  return data
    .map((row) => ({
      name: String(row[0]),
      color: String(row[1]),
      sortOrder: Number(row[2]),
      isActive: row[3] === true,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function reorderCategories(
  orderedNames: string[],
  sheetType: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName =
    sheetType === "InterruptionCategories"
      ? "InterruptionCategories"
      : "Categories";
  const sheet = ss.getSheetByName(sheetName)!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true };

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  for (let i = 0; i < orderedNames.length; i++) {
    for (let j = 0; j < data.length; j++) {
      if (String(data[j][0]) === orderedNames[i]) {
        data[j][2] = i;
        break;
      }
    }
  }

  const sortOrders = data.map((row) => [row[2]]);
  sheet.getRange(2, 3, lastRow - 1, 1).setValues(sortOrders);

  const cacheKey =
    sheetType === "InterruptionCategories"
      ? INT_CATEGORIES_CACHE_KEY
      : CATEGORIES_CACHE_KEY;
  CacheService.getScriptCache().remove(cacheKey);
  return { success: true };
}

function toggleCategoryActive(
  name: string,
  sheetType: string,
): { success: boolean } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName =
    sheetType === "InterruptionCategories"
      ? "InterruptionCategories"
      : "Categories";
  const sheet = ss.getSheetByName(sheetName)!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === name) {
      const currentActive = data[i][3] === true;
      sheet.getRange(i + 2, 4).setValue(!currentActive);

      const cacheKey =
        sheetType === "InterruptionCategories"
          ? INT_CATEGORIES_CACHE_KEY
          : CATEGORIES_CACHE_KEY;
      CacheService.getScriptCache().remove(cacheKey);
      return { success: true };
    }
  }

  return { success: false };
}

function renameCategory(
  oldName: string,
  newName: string,
  sheetType: string,
): { success: boolean; message?: string } {
  if (!newName || !newName.trim()) {
    return { success: false, message: "名前を入力してください" };
  }
  newName = newName.trim();
  if (oldName === newName) return { success: true };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName =
    sheetType === "InterruptionCategories"
      ? "InterruptionCategories"
      : "Categories";
  const sheet = ss.getSheetByName(sheetName)!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1)
    return { success: false, message: "カテゴリが見つかりません" };

  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  if (data.some((row) => String(row[0]) === newName)) {
    return { success: false, message: "同名のカテゴリが既に存在します" };
  }

  let found = false;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === oldName) {
      sheet.getRange(i + 2, 1).setValue(newName);
      found = true;
      break;
    }
  }
  if (!found) return { success: false, message: "カテゴリが見つかりません" };

  // Update references in log/interruptions
  if (sheetType === "Categories") {
    const logSheet = ss.getSheetByName("PomodoroLog")!;
    const logLastRow = logSheet.getLastRow();
    if (logLastRow > 1) {
      const catCol = logSheet
        .getRange(2, 9, logLastRow - 1, 1)
        .getValues();
      let changed = false;
      for (let i = 0; i < catCol.length; i++) {
        if (String(catCol[i][0]) === oldName) {
          catCol[i][0] = newName;
          changed = true;
        }
      }
      if (changed) {
        logSheet.getRange(2, 9, logLastRow - 1, 1).setValues(catCol);
      }
    }
  } else {
    const intSheet = ss.getSheetByName("Interruptions")!;
    const intLastRow = intSheet.getLastRow();
    if (intLastRow > 1) {
      const catCol = intSheet
        .getRange(2, 7, intLastRow - 1, 1)
        .getValues();
      let changed = false;
      for (let i = 0; i < catCol.length; i++) {
        if (String(catCol[i][0]) === oldName) {
          catCol[i][0] = newName;
          changed = true;
        }
      }
      if (changed) {
        intSheet.getRange(2, 7, intLastRow - 1, 1).setValues(catCol);
      }
    }
  }

  const cacheKey =
    sheetType === "InterruptionCategories"
      ? INT_CATEGORIES_CACHE_KEY
      : CATEGORIES_CACHE_KEY;
  CacheService.getScriptCache().remove(cacheKey);
  return { success: true };
}

function updateCategoryColor(
  name: string,
  color: string,
  sheetType: string,
): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName =
    sheetType === "InterruptionCategories"
      ? "InterruptionCategories"
      : "Categories";
  const sheet = ss.getSheetByName(sheetName)!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1)
    return { success: false, message: "カテゴリが見つかりません" };

  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === name) {
      sheet.getRange(i + 2, 2).setValue(color);
      // Invalidate cache
      const cacheKey =
        sheetType === "InterruptionCategories"
          ? INT_CATEGORIES_CACHE_KEY
          : CATEGORIES_CACHE_KEY;
      CacheService.getScriptCache().remove(cacheKey);
      return { success: true };
    }
  }

  return { success: false, message: "カテゴリが見つかりません" };
}
