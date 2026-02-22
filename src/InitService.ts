function initializeSpreadsheet(): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // PomodoroLog sheet
  let logSheet = ss.getSheetByName("PomodoroLog");
  if (!logSheet) {
    logSheet = ss.insertSheet("PomodoroLog");
    logSheet
      .getRange("A1:O1")
      .setValues([
        [
          "id",
          "date",
          "startTime",
          "endTime",
          "durationSeconds",
          "actualDurationSeconds",
          "type",
          "description",
          "category",
          "workInterruptions",
          "nonWorkInterruptions",
          "workInterruptionSeconds",
          "nonWorkInterruptionSeconds",
          "completionStatus",
          "pomodoroSetIndex",
        ],
      ]);
    logSheet.getRange("A1:O1").setFontWeight("bold");
    logSheet.setFrozenRows(1);
  }

  // Interruptions sheet
  let intSheet = ss.getSheetByName("Interruptions");
  if (!intSheet) {
    intSheet = ss.insertSheet("Interruptions");
    intSheet
      .getRange("A1:H1")
      .setValues([
        [
          "id",
          "pomodoroId",
          "type",
          "startTime",
          "endTime",
          "durationSeconds",
          "category",
          "note",
        ],
      ]);
    intSheet.getRange("A1:H1").setFontWeight("bold");
    intSheet.setFrozenRows(1);
  }

  // Categories sheet
  let catSheet = ss.getSheetByName("Categories");
  if (!catSheet) {
    catSheet = ss.insertSheet("Categories");
    catSheet
      .getRange("A1:D1")
      .setValues([["name", "color", "sortOrder", "isActive"]]);
    catSheet.getRange("A1:D1").setFontWeight("bold");
    catSheet.setFrozenRows(1);
    // Default categories
    catSheet.getRange("A2:D4").setValues([
      ["作業", "#4285f4", 1, true],
      ["学習", "#34a853", 2, true],
      ["その他", "#9e9e9e", 3, true],
    ]);
  }

  // InterruptionCategories sheet
  let intCatSheet = ss.getSheetByName("InterruptionCategories");
  if (!intCatSheet) {
    intCatSheet = ss.insertSheet("InterruptionCategories");
    intCatSheet
      .getRange("A1:D1")
      .setValues([["name", "color", "sortOrder", "isActive"]]);
    intCatSheet.getRange("A1:D1").setFontWeight("bold");
    intCatSheet.setFrozenRows(1);
    intCatSheet.getRange("A2:D7").setValues([
      ["会議・ミーティング", "#ef5350", 1, true],
      ["質問・相談", "#ab47bc", 2, true],
      ["メール・チャット", "#42a5f5", 3, true],
      ["電話", "#66bb6a", 4, true],
      ["SNS・ネット", "#ffa726", 5, true],
      ["その他", "#9e9e9e", 6, true],
    ]);
  }

  // Memos sheet
  let memosSheet = ss.getSheetByName("Memos");
  if (!memosSheet) {
    memosSheet = ss.insertSheet("Memos");
    memosSheet
      .getRange("A1:H1")
      .setValues([
        [
          "id",
          "name",
          "content",
          "tags",
          "createdAt",
          "updatedAt",
          "sortOrder",
          "isActive",
        ],
      ]);
    memosSheet.getRange("A1:H1").setFontWeight("bold");
    memosSheet.setFrozenRows(1);
  }

  // MemoTags sheet
  let memoTagsSheet = ss.getSheetByName("MemoTags");
  if (!memoTagsSheet) {
    memoTagsSheet = ss.insertSheet("MemoTags");
    memoTagsSheet
      .getRange("A1:D1")
      .setValues([["name", "color", "sortOrder", "isActive"]]);
    memoTagsSheet.getRange("A1:D1").setFontWeight("bold");
    memoTagsSheet.setFrozenRows(1);
  }

  // Projects sheet
  let projSheet = ss.getSheetByName("Projects");
  if (!projSheet) {
    projSheet = ss.insertSheet("Projects");
    projSheet
      .getRange("A1:H1")
      .setValues([
        [
          "id",
          "name",
          "content",
          "color",
          "sortOrder",
          "isActive",
          "createdAt",
          "updatedAt",
        ],
      ]);
    projSheet.getRange("A1:H1").setFontWeight("bold");
    projSheet.setFrozenRows(1);
  }

  // Cases sheet
  let casesSheet = ss.getSheetByName("Cases");
  if (!casesSheet) {
    casesSheet = ss.insertSheet("Cases");
    casesSheet
      .getRange("A1:H1")
      .setValues([
        [
          "id",
          "projectId",
          "name",
          "content",
          "sortOrder",
          "isActive",
          "createdAt",
          "updatedAt",
        ],
      ]);
    casesSheet.getRange("A1:H1").setFontWeight("bold");
    casesSheet.setFrozenRows(1);
  }

  // Tasks sheet
  let tasksSheet = ss.getSheetByName("Tasks");
  if (!tasksSheet) {
    tasksSheet = ss.insertSheet("Tasks");
    tasksSheet
      .getRange("A1:M1")
      .setValues([
        [
          "id",
          "projectId",
          "caseId",
          "name",
          "content",
          "status",
          "sortOrder",
          "isActive",
          "createdAt",
          "completedAt",
          "startedAt",
          "dueDate",
          "updatedAt",
        ],
      ]);
    tasksSheet.getRange("A1:M1").setFontWeight("bold");
    tasksSheet.setFrozenRows(1);
  }

  // PomodoroLog: add taskId column (P) if not present
  if (logSheet.getRange("P1").getValue() === "") {
    logSheet.getRange("P1").setValue("taskId");
    logSheet.getRange("P1").setFontWeight("bold");
  }

  // TimerConfig sheet
  let configSheet = ss.getSheetByName("TimerConfig");
  if (!configSheet) {
    configSheet = ss.insertSheet("TimerConfig");
    configSheet
      .getRange("A1:F1")
      .setValues([
        [
          "patternName",
          "workMinutes",
          "shortBreakMinutes",
          "longBreakMinutes",
          "pomodorosBeforeLongBreak",
          "isActive",
        ],
      ]);
    configSheet.getRange("A1:F1").setFontWeight("bold");
    configSheet.setFrozenRows(1);
    configSheet.getRange("A2:F3").setValues([
      ["Standard", 25, 5, 15, 4, true],
      ["Test (1min)", 1, 1, 1, 4, false],
    ]);
  }
}
