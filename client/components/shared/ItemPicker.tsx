/**
 * ItemPicker — Dropdown picker for categories, tags, tasks, etc.
 * Badge + add-btn pattern matching the original GAS ItemPicker.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { CheckIcon } from "./Icons";
import s from "./ItemPicker.module.css";

export interface PickerItem {
  name: string;
  color: string;
}

interface ItemPickerProps {
  mode: "single" | "multi";
  items: PickerItem[];
  selected: string[];
  onSelect: (selected: string[]) => void;
  onCreateItem?: (name: string, color: string) => void;
  onColorChange?: (name: string, color: string) => void;
  placeholder?: string;
  removable?: boolean;
  compact?: boolean;
  emptyLabel?: string;
}

export function ItemPicker({
  mode,
  items,
  selected,
  onSelect,
  onCreateItem,
  onColorChange,
  placeholder = "検索 / 作成...",
  removable = true,
  compact = false,
  emptyLabel = "空",
}: ItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const toggleItem = useCallback(
    (name: string) => {
      if (mode === "single") {
        onSelect(selected.includes(name) ? [] : [name]);
        setOpen(false);
        setQuery("");
      } else {
        if (selected.includes(name)) {
          onSelect(selected.filter((s) => s !== name));
        } else {
          onSelect([...selected, name]);
        }
      }
    },
    [mode, selected, onSelect],
  );

  const removeItem = useCallback(
    (name: string) => {
      onSelect(selected.filter((s) => s !== name));
    },
    [selected, onSelect],
  );

  const handleCreate = useCallback(() => {
    const name = query.trim();
    if (!name) return;
    onCreateItem?.(name, "#757575");
    toggleItem(name);
    setQuery("");
  }, [query, onCreateItem, toggleItem]);

  const q = query.toLowerCase();
  const filtered = items.filter((item) => !q || item.name.toLowerCase().includes(q));
  const exactMatch = items.some((item) => item.name.toLowerCase() === q);

  const getColor = (name: string) => {
    const item = items.find((i) => i.name === name);
    return item?.color || "#757575";
  };

  const openDropdown = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 2, left: rect.left });
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className={`${s["item-picker"]}${compact ? ` ${s["compact"]}` : ""}`} ref={containerRef}>
      {/* Clickable area — badges + placeholder */}
      <div
        className={s["item-picker-trigger"]}
        onClick={() => {
          if (open) {
            setOpen(false);
            setQuery("");
          } else openDropdown();
        }}
      >
        {selected.length > 0 ? (
          <div className={s["item-picker-badges"]}>
            {selected.map((name) => {
              const color = getColor(name);
              return (
                <span
                  key={name}
                  className={s["item-picker-badge"]}
                  style={{
                    background: color + "22",
                    color: color,
                    borderColor: color + "44",
                  }}
                  onClick={onColorChange ? (e) => e.stopPropagation() : undefined}
                >
                  <span
                    className={s["item-picker-badge-dot"]}
                    style={{ background: color, position: onColorChange ? "relative" : undefined }}
                    onClick={onColorChange ? (e) => e.stopPropagation() : undefined}
                  >
                    {onColorChange && (
                      <input
                        type="color"
                        className={s["item-picker-color"]}
                        value={color}
                        style={{
                          position: "absolute",
                          inset: 0,
                          opacity: 0,
                          cursor: "pointer",
                          width: "100%",
                          height: "100%",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onColorChange(name, e.target.value)}
                      />
                    )}
                  </span>
                  {name}
                  {removable && (
                    <span
                      className={s["item-picker-badge-remove"]}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(name);
                      }}
                    >
                      ×
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        ) : (
          <span className={s["item-picker-empty"]}>{emptyLabel}</span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className={s["item-picker-dropdown"]}
          style={dropdownPos ? { top: dropdownPos.top, left: dropdownPos.left } : undefined}
        >
          <input
            ref={inputRef}
            className={s["item-picker-search"]}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !exactMatch && query.trim()) {
                handleCreate();
              }
              if (e.key === "Escape") {
                setOpen(false);
                setQuery("");
              }
            }}
          />
          <div className={s["item-picker-list"]}>
            {filtered.map((item) => {
              const isSelected = selected.includes(item.name);
              return (
                <div
                  key={item.name}
                  className={`${s["item-picker-option"]}${isSelected ? ` ${s["item-picker-option-selected"]}` : ""}`}
                  style={isSelected ? { background: item.color + "12" } : undefined}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleItem(item.name);
                  }}
                >
                  <span
                    className={s["item-picker-option-dot"]}
                    style={{ background: item.color }}
                  />
                  <span className={s["item-picker-option-label"]}>{item.name}</span>
                  {isSelected && (
                    <span className={s["item-picker-option-check"]}>
                      <CheckIcon size={14} />
                    </span>
                  )}
                </div>
              );
            })}
            {query.trim() && !exactMatch && onCreateItem && (
              <div
                className={`${s["item-picker-option"]} ${s["item-picker-create"]}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleCreate();
                }}
              >
                + 「{query.trim()}」を作成
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
