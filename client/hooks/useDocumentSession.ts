import { useReducer } from "react";
import { documentSessionReducer, initialDocumentSessionState } from "../lib/documentSessionModel";

export type { DocumentSessionEvent, DocumentSessionState } from "../lib/documentSessionModel";

export function useDocumentSession() {
  return useReducer(documentSessionReducer, initialDocumentSessionState);
}
