export type StandaloneDocumentTarget =
  | { tab: "memo"; memoId: string }
  | { tab: "task"; taskNode: { type: "project" | "case" | "task"; id: string } };

type StandaloneDocumentQuery = Readonly<Record<string, string>>;

export function buildDocumentHash(target: StandaloneDocumentTarget): string {
  const params = new URLSearchParams();
  params.set("tab", target.tab);
  if (target.tab === "memo") params.set("memo", target.memoId);
  else {
    params.set("type", target.taskNode.type);
    params.set("id", target.taskNode.id);
  }
  return `#${params.toString()}`;
}

export function buildStandaloneDocumentUrl(
  currentUrl: string,
  target: StandaloneDocumentTarget,
): string {
  const url = new URL(currentUrl);
  url.searchParams.set("view", "document");
  url.searchParams.set("tab", target.tab);
  url.searchParams.delete("memo");
  url.searchParams.delete("type");
  url.searchParams.delete("id");
  if (target.tab === "memo") url.searchParams.set("memo", target.memoId);
  else {
    url.searchParams.set("type", target.taskNode.type);
    url.searchParams.set("id", target.taskNode.id);
  }
  url.hash = buildDocumentHash(target);
  return url.toString();
}

function readTarget(params: URLSearchParams): StandaloneDocumentTarget | null {
  if (params.get("tab") === "memo") {
    const memoId = params.get("memo");
    return memoId ? { tab: "memo", memoId } : null;
  }
  if (params.get("tab") !== "task") return null;
  const type = params.get("type");
  const id = params.get("id");
  if ((type !== "project" && type !== "case" && type !== "task") || !id) return null;
  return { tab: "task", taskNode: { type, id } };
}

export function readStandaloneDocumentTarget(
  currentUrl: string,
  initialQuery?: StandaloneDocumentQuery,
): StandaloneDocumentTarget | null {
  const url = new URL(currentUrl);
  const query = initialQuery ? new URLSearchParams(initialQuery) : url.searchParams;
  if (query.get("view") !== "document") return null;
  return readTarget(query) ?? readTarget(new URLSearchParams(url.hash.slice(1)));
}

function readInitialQueryFromDocument(): StandaloneDocumentQuery | undefined {
  const readMeta = (name: string) =>
    document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";
  if (readMeta("gas-document-view") !== "document") return undefined;
  return {
    view: "document",
    tab: readMeta("gas-document-tab"),
    memo: readMeta("gas-document-memo"),
    type: readMeta("gas-document-type"),
    id: readMeta("gas-document-id"),
  };
}

export function readCurrentStandaloneDocumentTarget(): StandaloneDocumentTarget | null {
  return readStandaloneDocumentTarget(window.location.href, readInitialQueryFromDocument());
}

export async function openStandaloneDocument(
  target: StandaloneDocumentTarget,
  webAppUrl: string | undefined,
  beforeNavigate: () => Promise<boolean>,
): Promise<Window | null> {
  const popup = window.open("about:blank", "_blank");
  if (!popup) return null;
  try {
    popup.opener = null;
    popup.document.title = "ドキュメントを開いています";
    popup.document.body.textContent = "編集内容を保存しています...";
    if (!(await beforeNavigate())) throw new Error("Document edit access could not be transferred");
    popup.location.replace(buildStandaloneDocumentUrl(webAppUrl || window.location.href, target));
    return popup;
  } catch (error) {
    popup.close();
    throw error;
  }
}
