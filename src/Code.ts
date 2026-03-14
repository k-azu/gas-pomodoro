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
  // Use cached service functions (CacheService-backed)
  const timerConfigs = getAllTimerConfigs();
  const categories = getCategories();
  const interruptionCategories = getInterruptionCategories();

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
    spreadsheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    recentRecordsBulk: bulk.records,
    recentInterruptionsBulk: bulk.interruptions,
    memos,
    memoTags,
    projects: taskData.projects,
    cases: taskData.cases,
    tasks: taskData.tasks,
  };
}
