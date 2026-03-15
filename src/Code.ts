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

function resolveLinkViaOEmbed(url: string): string | null {
  // YouTube
  if (/^https?:\/\/(www\.)?youtube\.com\/|^https?:\/\/youtu\.be\//.test(url)) {
    const endpoint = "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url);
    const res = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText());
      if (data.title) return data.title;
    }
  }
  return null;
}

function extractTitleFromHtml(html: string): string | null {
  // og:title
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (ogMatch && ogMatch[1]) {
    const title = ogMatch[1].trim();
    if (title) return title;
  }
  // <meta name="title">
  const metaTitle =
    html.match(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']title["']/i);
  if (metaTitle && metaTitle[1]) {
    const title = metaTitle[1].trim();
    if (title) return title;
  }
  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    const title = titleMatch[1].replace(/\s+/g, " ").trim();
    if (title) return title;
  }
  return null;
}

function resolveLink(url: string): { title?: string } {
  try {
    const oEmbed = resolveLinkViaOEmbed(url);
    if (oEmbed) return { title: oEmbed };

    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) return {};
    const html = response.getContentText("UTF-8");
    const title = extractTitleFromHtml(html);
    if (title) return { title };
    return {};
  } catch {
    return {};
  }
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
