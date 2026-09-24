import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { useApp } from "../../contexts/AppContext";
import s from "./AppLayout.module.css";
import { MemoTab } from "../memo/MemoTab";
import { TaskTab } from "../task/TaskTab";
import { readCurrentStandaloneDocumentTarget } from "../../lib/documentWindow";
import { ToastViewport } from "../shared/Toast";

export function AppLayout() {
  const { isLoading, error, timer } = useApp();
  const standaloneTarget = readCurrentStandaloneDocumentTarget();

  if (error) {
    return (
      <div className={s["init-error"]} role="alert">
        <h2>読み込みに失敗しました</h2>
        <p>
          サーバーからデータを取得できませんでした。時間をおいてブラウザでページを再読み込みしてください。
        </p>
        <pre>{error}</pre>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`${s["loading-overlay"]} ${s.visible}`} role="status">
        <div className={s.spinner} />
        <span className={s["loading-label"]}>読み込み中...</span>
      </div>
    );
  }

  if (standaloneTarget) {
    return (
      <div className={s["document-layout"]} data-standalone-document data-phase={timer.dataPhase}>
        {standaloneTarget.tab === "memo" ? (
          <MemoTab standalone documentId={standaloneTarget.memoId} />
        ) : (
          <TaskTab standalone documentNode={standaloneTarget.taskNode} />
        )}
        <ToastViewport />
      </div>
    );
  }

  return (
    <div className={s["app-layout"]} data-phase={timer.dataPhase}>
      <LeftPanel />
      <RightPanel />
      <ToastViewport />
    </div>
  );
}
