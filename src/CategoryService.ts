interface CategoryItem {
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

function getCategories(): CategoryItem[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Categories')!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  return data
    .filter((row) => row[3] === true)
    .map((row) => ({
      name: String(row[0]),
      color: String(row[1]),
      sortOrder: Number(row[2]),
      isActive: Boolean(row[3])
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function getInterruptionCategories(): CategoryItem[] {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('InterruptionCategories')!;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  return data
    .filter((row) => row[3] === true)
    .map((row) => ({
      name: String(row[0]),
      color: String(row[1]),
      sortOrder: Number(row[2]),
      isActive: Boolean(row[3])
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function addCategory(name: string): { success: boolean; message?: string } {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Categories')!;
  const lastRow = sheet.getLastRow();

  // Check for duplicate
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    if (existing.some((row) => String(row[0]) === name)) {
      return { success: false, message: 'カテゴリが既に存在します' };
    }
  }

  const nextOrder = lastRow;
  sheet.appendRow([name, '#757575', nextOrder, true]);
  return { success: true };
}
