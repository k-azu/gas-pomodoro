import { useEffect, useRef, useState } from "react";
import type { Editor } from "../../../editor/markweaveEditor";
import type { ToolbarDropdownItem } from "./toolbarTypes";
import { useEditorSignal } from "./useEditorSignal";

interface ToolbarDropdownProps {
  item: ToolbarDropdownItem;
  editor: Editor;
}

export function ToolbarDropdown({ item, editor }: ToolbarDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEditorSignal(editor);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const activeStates = item.items.map((option) => option.isActive(editor));
  const activeIndex = activeStates.findIndex(Boolean);
  const activeItem = activeIndex >= 0 ? item.items[activeIndex] : undefined;
  const hasActive = activeIndex >= 0;
  const triggerContent = item.showActiveLabel
    ? (activeItem?.label ?? item.defaultLabel ?? item.name)
    : (item.icon ?? item.name);

  return (
    <div className="mdg-toolbar-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`mdg-toolbar-btn mdg-toolbar-dropdown-trigger${hasActive ? " mdg-toolbar-btn--active" : ""}`}
        title={item.title}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span>{triggerContent}</span>
        <span className="mdg-toolbar-dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="mdg-toolbar-dropdown-menu" role="menu">
          {item.items.map((option, index) => (
            <button
              key={option.name}
              type="button"
              className={`mdg-toolbar-dropdown-item${activeStates[index] ? " mdg-toolbar-dropdown-item--active" : ""}`}
              role="menuitem"
              onClick={() => {
                option.action(editor);
                setOpen(false);
              }}
            >
              {option.icon && <span className="mdg-toolbar-dropdown-item-icon">{option.icon}</span>}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
