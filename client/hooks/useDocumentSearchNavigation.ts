import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigation } from "../contexts/NavigationContext";
import {
  clearSearchHighlights,
  findSearchTextRanges,
  getSearchHighlightSnapshot,
  scrollToActiveSearchHighlight,
  setActiveSearchHighlight,
  setSearchHighlights,
  type Editor,
  type EditorMode,
  type SearchTextRange,
} from "../editor/hitomdEditor";

interface UseDocumentSearchNavigationOptions {
  tab: "memo" | "task";
  id: string;
  editor: Editor | null;
  mode: EditorMode;
  rawMarkdown: string;
  contentRevision: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

interface SearchNavigationSession {
  requestId: number;
  query: string;
  count: number;
  activeIndex: number;
}

export interface DocumentSearchNavigationController {
  query: string;
  count: number;
  activeIndex: number;
  previous: () => void;
  next: () => void;
  close: () => void;
}

function scrollRichTextMatch(editor: Editor) {
  requestAnimationFrame(() => {
    scrollToActiveSearchHighlight(editor);
    // ProseMirror and the document scroll restoration can finish in the next frame.
    requestAnimationFrame(() => scrollToActiveSearchHighlight(editor));
  });
}

function selectMarkdownMatch(
  range: SearchTextRange,
  rawMarkdown: string,
  scrollContainer: HTMLDivElement | null,
) {
  if (!scrollContainer) return;
  const textarea = scrollContainer.querySelector<HTMLTextAreaElement>(".mdg-raw-editor");
  if (!textarea) return;

  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(range.from, range.to);

  const style = getComputedStyle(textarea);
  const parsedLineHeight = Number.parseFloat(style.lineHeight);
  const parsedFontSize = Number.parseFloat(style.fontSize);
  const lineHeight = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : (Number.isFinite(parsedFontSize) ? parsedFontSize : 14) * 1.6;
  const lineIndex = rawMarkdown.slice(0, range.from).split("\n").length - 1;
  const containerRect = scrollContainer.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const textareaTop = scrollContainer.scrollTop + textareaRect.top - containerRect.top;
  const target = Math.max(
    0,
    textareaTop + lineIndex * lineHeight - scrollContainer.clientHeight * 0.35,
  );
  scrollContainer.scrollTo({ top: target, behavior: "smooth" });
}

export function useDocumentSearchNavigation({
  tab,
  id,
  editor,
  mode,
  rawMarkdown,
  contentRevision,
  scrollRef,
}: UseDocumentSearchNavigationOptions): DocumentSearchNavigationController | null {
  const nav = useNavigation();
  const [session, setSession] = useState<SearchNavigationSession | null>(null);
  const sessionRef = useRef<SearchNavigationSession | null>(null);
  const markdownRef = useRef(rawMarkdown);
  const markdownMatchesRef = useRef<SearchTextRange[]>([]);
  markdownRef.current = rawMarkdown;
  sessionRef.current = session;

  const request = nav.searchRevealRequest;
  const isTarget = request?.tab === tab && request.id === id;

  useEffect(() => {
    if (!editor) return;
    if (!request || !isTarget) {
      if (sessionRef.current) {
        clearSearchHighlights(editor);
        markdownMatchesRef.current = [];
        sessionRef.current = null;
        setSession(null);
      }
      return;
    }

    let count = 0;
    if (mode === "wysiwyg") {
      markdownMatchesRef.current = [];
      const snapshot = setSearchHighlights(editor, request.query);
      count = snapshot.count;
      if (count > 0) scrollRichTextMatch(editor);
    } else {
      clearSearchHighlights(editor);
      const matches = findSearchTextRanges(markdownRef.current, request.query);
      markdownMatchesRef.current = matches;
      count = matches.length;
      if (matches[0]) {
        requestAnimationFrame(() =>
          selectMarkdownMatch(matches[0], markdownRef.current, scrollRef.current),
        );
      }
    }

    const nextSession = {
      requestId: request.requestId,
      query: request.query,
      count,
      activeIndex: 0,
    };
    sessionRef.current = nextSession;
    setSession(nextSession);
  }, [contentRevision, editor, isTarget, mode, request, scrollRef]);

  useEffect(() => {
    if (!editor || mode !== "wysiwyg" || !request || !isTarget) return;

    const handleTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      const current = sessionRef.current;
      if (!current || current.requestId !== request.requestId) return;

      const snapshot = getSearchHighlightSnapshot(editor);
      const nextSession = {
        ...current,
        count: snapshot.count,
        activeIndex: snapshot.count > 0 ? Math.max(0, snapshot.activeIndex) : 0,
      };
      sessionRef.current = nextSession;
      setSession(nextSession);
    };

    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, isTarget, mode, request]);

  useEffect(() => {
    if (mode !== "markdown" || !request || !isTarget) return;
    const current = sessionRef.current;
    if (!current || current.requestId !== request.requestId) return;

    const matches = findSearchTextRanges(rawMarkdown, request.query);
    markdownMatchesRef.current = matches;
    const activeIndex = matches.length > 0 ? Math.min(current.activeIndex, matches.length - 1) : 0;
    if (matches.length === current.count && activeIndex === current.activeIndex) return;

    const nextSession = { ...current, count: matches.length, activeIndex };
    sessionRef.current = nextSession;
    setSession(nextSession);
  }, [isTarget, mode, rawMarkdown, request]);

  useEffect(
    () => () => {
      if (editor) clearSearchHighlights(editor);
    },
    [editor],
  );

  const activate = useCallback(
    (direction: -1 | 1) => {
      const current = sessionRef.current;
      if (!current || current.count === 0 || !editor) return;
      const activeIndex = (current.activeIndex + direction + current.count) % current.count;

      if (mode === "wysiwyg") {
        setActiveSearchHighlight(editor, activeIndex);
        scrollRichTextMatch(editor);
      } else {
        const range = markdownMatchesRef.current[activeIndex];
        if (range) {
          selectMarkdownMatch(range, markdownRef.current, scrollRef.current);
        }
      }

      const nextSession = { ...current, activeIndex };
      sessionRef.current = nextSession;
      setSession(nextSession);
    },
    [editor, mode, scrollRef],
  );

  const close = useCallback(() => {
    if (editor) clearSearchHighlights(editor);
    markdownMatchesRef.current = [];
    sessionRef.current = null;
    setSession(null);
    nav.clearSearchRevealRequest();
  }, [editor, nav]);

  if (!session || !isTarget) return null;

  return {
    query: session.query,
    count: session.count,
    activeIndex: session.activeIndex,
    previous: () => activate(-1),
    next: () => activate(1),
    close,
  };
}
