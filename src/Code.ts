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
