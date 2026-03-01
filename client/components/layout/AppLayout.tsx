import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { useApp } from "../../contexts/AppContext";
import s from "./AppLayout.module.css";

export function AppLayout() {
  const { isLoading, error } = useApp();

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
      <div className={`${s['loading-overlay']} ${s.visible}`}>
        <div className={s.spinner} />
      </div>
    );
  }

  return (
    <div className={s['app-layout']}>
      <LeftPanel />
      <RightPanel />
    </div>
  );
}
