import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { useApp } from "../../contexts/AppContext";
import s from "./AppLayout.module.css";
import { MemoTab } from "../memo/MemoTab";
import { TaskTab } from "../task/TaskTab";
import { readCurrentStandaloneDocumentTarget } from "../../lib/documentWindow";

export function AppLayout() {
  const { isLoading, error } = useApp();
  const standaloneTarget = readCurrentStandaloneDocumentTarget();

  if (error) {
    return (
      <div style={{ padding: 24, color: "#e53935" }}>
        <h2>初期化エラー</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`${s["loading-overlay"]} ${s.visible}`}>
        <div className={s.spinner} />
      </div>
    );
  }

  if (standaloneTarget) {
    return (
      <div className={s["document-layout"]} data-standalone-document>
        {standaloneTarget.tab === "memo" ? (
          <MemoTab standalone documentId={standaloneTarget.memoId} />
        ) : (
          <TaskTab standalone documentNode={standaloneTarget.taskNode} />
        )}
      </div>
    );
  }

  return (
    <div className={s["app-layout"]}>
      <LeftPanel />
      <RightPanel />
    </div>
  );
}
