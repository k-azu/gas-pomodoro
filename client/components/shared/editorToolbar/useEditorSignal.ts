import { useEffect, useState } from "react";
import type { Editor } from "../../../editor/markweaveEditor";

export function useEditorSignal(editor: Editor) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const update = () => setVersion((version) => version + 1);
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);
}
