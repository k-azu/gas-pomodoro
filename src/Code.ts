function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  initializeSpreadsheet();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Pomodoro Timer')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSpreadsheetUrl(): string {
  return SpreadsheetApp.getActiveSpreadsheet().getUrl();
}
