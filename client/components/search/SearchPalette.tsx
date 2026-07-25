import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigation } from "../../contexts/NavigationContext";
import { searchSavedDocuments } from "../../lib/documentSearch";
import type {
  DocumentSearchCounts,
  DocumentSearchFilter,
  DocumentSearchResult,
} from "../../types/search";
import { MemoIcon, SearchIcon, TaskListIcon } from "../shared/Icons";
import s from "./SearchPalette.module.css";

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

const FILTERS: Array<{ id: DocumentSearchFilter; label: string }> = [
  { id: "all", label: "すべて" },
  { id: "memo", label: "メモ" },
  { id: "task", label: "タスク" },
];

const STATUS_LABELS: Record<string, string> = {
  docs: "Docs",
  doing: "Doing",
  review: "Review",
  todo: "ToDo",
  pending: "Pending",
  done: "Done",
};

const EMPTY_COUNTS: DocumentSearchCounts = { all: 0, memo: 0, task: 0 };
const SEARCH_DEBOUNCE_MS = 300;

export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const nav = useNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCompletedSearchKeyRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocumentSearchFilter>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [results, setResults] = useState<DocumentSearchResult[]>([]);
  const [counts, setCounts] = useState<DocumentSearchCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retrySequence, setRetrySequence] = useState(0);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filter]);

  useEffect(() => {
    if (!open) return;

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      lastCompletedSearchKeyRef.current = null;
      setLoading(false);
      setSearchError(null);
      setResults([]);
      setCounts(EMPTY_COUNTS);
      return;
    }

    const searchKey = `${filter}\u0000${normalizedQuery}\u0000${retrySequence}`;
    const hasCachedResults = lastCompletedSearchKeyRef.current === searchKey;

    let cancelled = false;
    if (!hasCachedResults) {
      setLoading(true);
      setSearchError(null);
      setResults([]);
    }

    const timer = window.setTimeout(() => {
      searchSavedDocuments(normalizedQuery, filter)
        .then((response) => {
          if (cancelled) return;
          setResults(response.results);
          setCounts(response.counts);
          setSearchError(null);
          lastCompletedSearchKeyRef.current = searchKey;
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.error("[SearchPalette] Failed to search documents:", error);
          if (hasCachedResults) return;
          setResults([]);
          setCounts(EMPTY_COUNTS);
          setSearchError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled && !hasCachedResults) {
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filter, open, query, retrySequence]);

  if (!open) return null;

  const openResult = (result: DocumentSearchResult) => {
    if (result.type === "memo") {
      nav.navigateToDocument("memo", {
        memoId: result.id,
        searchQuery: query,
        searchDocument: result,
      });
    } else {
      nav.navigateToDocument("task", {
        taskNode: { type: "task", id: result.id },
        searchQuery: query,
        searchDocument: result,
      });
    }
    onClose();
  };

  const totalCount = counts[filter];
  const hasQuery = Boolean(query.trim());
  const resultCountLabel = !hasQuery
    ? ""
    : loading
      ? "検索中…"
      : results.length < totalCount
        ? `${results.length} / ${totalCount}件`
        : `${totalCount}件`;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter" && results[selectedIndex]) {
      event.preventDefault();
      openResult(results[selectedIndex]);
    }
  };

  return (
    <div
      className={s.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={s.palette}
        role="dialog"
        aria-modal="true"
        aria-label="文書を検索"
        onKeyDown={handleKeyDown}
      >
        <div className={s["search-header"]}>
          <SearchIcon size={20} color="#616161" />
          <input
            ref={inputRef}
            className={s.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="メモとタスクを検索..."
            aria-label="検索キーワード"
          />
          {query && (
            <button
              className={s["clear-button"]}
              onClick={() => setQuery("")}
              aria-label="入力を消去"
            >
              ×
            </button>
          )}
          <kbd className={s["escape-key"]}>Esc</kbd>
        </div>

        <div className={s["filter-bar"]}>
          <div className={s.filters} role="tablist" aria-label="文書の種類">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`${s.filter}${filter === item.id ? ` ${s.active}` : ""}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span className={s.count}>{loading ? "…" : counts[item.id]}</span>
              </button>
            ))}
          </div>
          <span className={s.scope}>保存済みの内容</span>
        </div>

        <div className={s["result-heading"]}>
          <span>{hasQuery ? `「${query.trim()}」の検索結果` : "文書を検索"}</span>
          <span>{resultCountLabel}</span>
        </div>

        <div className={s.results} role="listbox" aria-label="検索結果" aria-busy={loading}>
          {!hasQuery ? (
            <div className={s.empty}>
              <SearchIcon size={28} color="#bdbdbd" />
              <strong>キーワードを入力してください</strong>
              <span>保存済みのメモとタスクを検索します。</span>
            </div>
          ) : loading ? (
            <div className={s.empty} role="status">
              <span className={s.spinner} />
              <strong>保存済みの文書を検索しています</strong>
            </div>
          ) : searchError ? (
            <div className={s.empty} role="alert">
              <SearchIcon size={28} color="#bdbdbd" />
              <strong>文書を検索できませんでした</strong>
              <span>{searchError}</span>
              <button
                type="button"
                className={s["retry-button"]}
                onClick={() => setRetrySequence((sequence) => sequence + 1)}
              >
                再試行
              </button>
            </div>
          ) : results.length > 0 ? (
            results.map((result, index) => (
              <SearchResultRow
                key={`${result.type}:${result.id}`}
                result={result}
                query={query}
                selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => openResult(result)}
              />
            ))
          ) : (
            <div className={s.empty}>
              <SearchIcon size={28} color="#bdbdbd" />
              <strong>一致する文書がありません</strong>
              <span>キーワードを変えるか、種類の絞り込みを解除してください。</span>
            </div>
          )}
        </div>

        <div className={s.footer}>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 選択
          </span>
          <span>
            <kbd>Enter</kbd> 開く
          </span>
          <span className={s["source-label"]}>保存済みデータ</span>
        </div>
      </section>
    </div>
  );
}

function SearchResultRow({
  result,
  query,
  selected,
  onMouseEnter,
  onClick,
}: {
  result: DocumentSearchResult;
  query: string;
  selected: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`${s.result}${selected ? ` ${s.selected}` : ""}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className={`${s["result-icon"]} ${s[result.type]}`}>
        {result.type === "memo" ? (
          <MemoIcon size={18} color="#5e35b1" />
        ) : (
          <TaskListIcon size={18} color="#1976d2" />
        )}
      </span>
      <span className={s["result-main"]}>
        <span className={s["result-topline"]}>
          <span className={s.title}>{highlightText(result.title, query)}</span>
          <span className={s.path}>{result.path}</span>
        </span>
        <span className={s.snippet}>{highlightText(result.snippet, query)}</span>
        <span className={s.metadata}>
          <span className={`${s["type-badge"]} ${s[result.type]}`}>
            {result.type === "memo" ? "メモ" : "タスク"}
          </span>
          {result.isArchived && <span className={s["archived-badge"]}>アーカイブ済み</span>}
          {result.status && (
            <span className={s["status-badge"]}>
              {STATUS_LABELS[result.status] ?? result.status}
            </span>
          )}
          {result.tags?.map((tag) => (
            <span key={tag} className={s.tag}>
              #{tag}
            </span>
          ))}
          <span className={s.updated}>{formatUpdatedAt(result.updatedAt)}</span>
        </span>
      </span>
      <span className={s.chevron}>›</span>
    </button>
  );
}

function highlightText(text: string, query: string): ReactNode {
  const tokens = query.normalize("NFKC").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text;

  const pattern = tokens.map(escapeRegExp).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  const tokenSet = new Set(tokens.map((token) => token.toLocaleLowerCase("ja")));

  return parts.map((part, index) =>
    tokenSet.has(part.normalize("NFKC").toLocaleLowerCase("ja")) ? (
      <mark key={`${part}-${index}`}>{part}</mark>
    ) : (
      part
    ),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新日時不明";
  return `${date.getMonth() + 1}月${date.getDate()}日 更新`;
}
