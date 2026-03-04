function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  initializeSpreadsheet();
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("Pomodoro Timer")
    .setFaviconUrl("https://drive.google.com/uc?id=1WaX5uI1Uxgt63EiOkIh1ZpiRmi77_w2h&.png") // ※ 任意
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSpreadsheetUrl(): string {
  return SpreadsheetApp.getActiveSpreadsheet().getUrl();
}

function getAllInitData(): {
  timerConfigs: TimerConfig[];
  categories: CategoryItem[];
  interruptionCategories: CategoryItem[];
  spreadsheetUrl: string;
  recentRecordsBulk: PomodoroRecord[];
  recentInterruptionsBulk: InterruptionRecord[];
  memos: MemoMetadata[];
  memoTags: MemoTag[];
  projects: ProjectMetadata[];
  cases: CaseMetadata[];
  tasks: TaskMetadata[];
} {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- TimerConfig ---
  const tcSheet = ss.getSheetByName("TimerConfig")!;
  const tcLastRow = tcSheet.getLastRow();
  let timerConfigs: TimerConfig[];
  if (tcLastRow <= 1) {
    timerConfigs = [
      {
        patternName: "Standard",
        workMinutes: 25,
        shortBreakMinutes: 5,
        longBreakMinutes: 15,
        pomodorosBeforeLongBreak: 4,
      },
    ];
  } else {
    const tcData = tcSheet.getRange(2, 1, tcLastRow - 1, 6).getValues();
    timerConfigs = tcData.map((row) => ({
      patternName: String(row[0]),
      workMinutes: Number(row[1]),
      shortBreakMinutes: Number(row[2]),
      longBreakMinutes: Number(row[3]),
      pomodorosBeforeLongBreak: Number(row[4]),
      isActive: row[5] === true,
    }));
  }

  // --- Categories ---
  const catSheet = ss.getSheetByName("Categories")!;
  const catLastRow = catSheet.getLastRow();
  let categories: CategoryItem[] = [];
  if (catLastRow > 1) {
    const catData = catSheet.getRange(2, 1, catLastRow - 1, 4).getValues();
    categories = catData
      .filter((row) => row[3] === true)
      .map((row) => ({
        name: String(row[0]),
        color: String(row[1]),
        sortOrder: Number(row[2]),
        isActive: Boolean(row[3]),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // --- InterruptionCategories ---
  const icSheet = ss.getSheetByName("InterruptionCategories")!;
  const icLastRow = icSheet.getLastRow();
  let interruptionCategories: CategoryItem[] = [];
  if (icLastRow > 1) {
    const icData = icSheet.getRange(2, 1, icLastRow - 1, 4).getValues();
    interruptionCategories = icData
      .filter((row) => row[3] === true)
      .map((row) => ({
        name: String(row[0]),
        color: String(row[1]),
        sortOrder: Number(row[2]),
        isActive: Boolean(row[3]),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // --- PomodoroLog + Interruptions bulk (for IDB cache) ---
  const bulk = getRecentRecordsBulk(1000);

  // --- Memos & MemoTags ---
  const memos = getMemos();
  const memoTags = getMemoTags();

  // --- Tasks ---
  const taskData = getAllTaskData();

  return {
    timerConfigs,
    categories,
    interruptionCategories,
    spreadsheetUrl: ss.getUrl(),
    recentRecordsBulk: bulk.records,
    recentInterruptionsBulk: bulk.interruptions,
    memos,
    memoTags,
    projects: taskData.projects,
    cases: taskData.cases,
    tasks: taskData.tasks,
  };
}
