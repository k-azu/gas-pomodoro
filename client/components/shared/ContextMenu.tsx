import { useEffect, useRef } from "react";
import { CheckIcon } from "./Icons";
import s from "./ContextMenu.module.css";

export interface ContextMenuSection {
  title?: string;
  items: ContextMenuItem[];
}

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  checked?: boolean;
  dotColor?: string;
  onClick: () => void;
}

export function ContextMenu({
  position,
  sections,
  onClose,
}: {
  position: { x: number; y: number };
  sections: ContextMenuSection[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener("click", handle), 0);
    return () => document.removeEventListener("click", handle);
  }, [onClose]);

  // Adjust position to stay on screen
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      ref.current.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      ref.current.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, []);

  return (
    <div
      ref={ref}
      className={s['memo-context-menu']}
      style={{ left: position.x, top: position.y }}
    >
      {sections.map((section, si) => (
        <div key={si}>
          {section.title && (
            <div className={s['memo-context-separator']}>{section.title}</div>
          )}
          {section.items.map((item, ii) => (
            <div
              key={ii}
              className={`${s['memo-context-item']}${item.danger ? ` ${s['memo-context-danger']}` : ""}`}
              onClick={() => {
                onClose();
                item.onClick();
              }}
            >
              {item.dotColor && (
                <span className="memo-tag-dot" style={{ background: item.dotColor }} />
              )}
              {item.label}
              {item.checked && (
                <span className={s['memo-context-check']}>
                  <CheckIcon size={12} />
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
