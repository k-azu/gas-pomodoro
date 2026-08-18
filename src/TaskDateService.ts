function readTaskDateValue(value: unknown, timeZone: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return Utilities.formatDate(value, timeZone, "yyyy-MM-dd");
  }
  return String(value ?? "");
}
