import { useState } from "react";
import { useApp } from "../../contexts/AppContext";
import type { StandaloneDocumentTarget } from "../../lib/documentWindow";
import { openStandaloneDocument } from "../../lib/documentWindow";
import { showErrorToast } from "../../lib/toast";
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
  const handleOpen = async () => {
    if (opening || disabled) return;
    setOpening(true);
    try {
      const popup = await openStandaloneDocument(target, webAppUrl, onBeforeOpen);
      if (!popup) {
        showErrorToast(
          "新しいタブを開けませんでした。ポップアップがブロックされていないか確認してください",
        );
      }
    } catch (error) {
      console.error("Failed to transfer document edit access", error);
      showErrorToast("保存が完了しなかったため、新しいタブで開けませんでした", () => {
        void handleOpen();
      });
    } finally {
      setOpening(false);
    }
  };
  return (
    <button
      type="button"
      className={s.button}
      onClick={() => void handleOpen()}
      disabled={opening || disabled}
      title="保存して新しいタブで編集"
    >
      <ExternalLinkIcon size={13} />
      <span>{opening ? "開いています..." : "新しいタブ"}</span>
    </button>
  );
}
