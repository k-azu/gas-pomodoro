export function supportsWebLocks(): boolean {
  return typeof navigator !== "undefined" && navigator.locks != null;
}
