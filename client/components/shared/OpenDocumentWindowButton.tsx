import { useState } from "react";
import { useApp } from "../../contexts/AppContext";
import type { StandaloneDocumentTarget } from "../../lib/documentWindow";
import { openStandaloneDocument } from "../../lib/documentWindow";
import { ExternalLinkIcon } from "./Icons";
import s from "./OpenDocumentWindowButton.module.css";

export function OpenDocumentWindowButton({
  target,
  onBeforeOpen,
  disabled = false,
}: {
  target: StandaloneDocumentTarget;
  onBeforeOpen: () => Promise<boolean>;
  disabled?: boolean;
}) {
  const { webAppUrl } = useApp();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const handleOpen = async () => {
    if (opening || disabled) return;
    setOpening(true);
    setFailed(false);
    try {
      const popup = await openStandaloneDocument(target, webAppUrl, onBeforeOpen);
      if (!popup) setFailed(true);
    } catch (error) {
      console.error("Failed to transfer document edit access", error);
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className={s.container}>
      <button
        type="button"
        className={s.button}
        onClick={() => void handleOpen()}
        disabled={opening || disabled}
        title="保存して新しいタブで編集"
      >
        <ExternalLinkIcon size={13} />
        <span>{opening ? "移行中..." : "新しいタブ"}</span>
      </button>
      {failed && <span className={s.error}>移行失敗</span>}
    </div>
  );
}
