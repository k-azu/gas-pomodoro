import type { Editor } from "../../../editor/markweaveEditor";
import type { ToolbarItem } from "./toolbarTypes";
import { useEditorSignal } from "./useEditorSignal";

interface ToolbarButtonProps {
  item: Extract<ToolbarItem, { type: "button" }>;
  editor: Editor;
}

export function ToolbarButton({ item, editor }: ToolbarButtonProps) {
  useEditorSignal(editor);
  const isActive = item.isActive?.(editor) ?? false;

  return (
    <button
      type="button"
      className={`mdg-toolbar-btn${isActive ? " mdg-toolbar-btn--active" : ""}`}
      title={item.title}
      onClick={() => item.action?.(editor)}
      aria-pressed={isActive}
    >
      {item.icon}
    </button>
  );
}
