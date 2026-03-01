/**
 * Icons — centralised SVG icon components
 *
 * All icons used across the app live here.
 * Props follow a common pattern: `size` (px) and `color` (CSS color string).
 */

/** Checkmark */
export function CheckIcon({
  size = 16,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Inbox / project */
export function InboxIcon({
  size = 16,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M2.5 9.5L4.5 3.5h7l2 6"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 9.5v3a1 1 0 001 1h9a1 1 0 001-1v-3h-3.5l-1 1.5h-2l-1-1.5H2.5z"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** File / case */
export function FileIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M4.5 1.5h5l4 4v8.5a1 1 0 01-1 1h-8a1 1 0 01-1-1v-11.5a1 1 0 011-1z"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9.5 1.5v4h4" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/** Memo / document with lines */
export function MemoIcon({ size = 16, color = "#757575" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" stroke={color} strokeWidth="1.3" />
      <line x1="5" y1="6" x2="11" y2="6" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <line
        x1="5"
        y1="9.5"
        x2="9"
        y2="9.5"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Six-dot grip handle for drag */
export function GripIcon({ size = 10 }: { size?: number }) {
  const h = Math.round(size * 1.4);
  return (
    <svg width={size} height={h} viewBox="0 0 10 14" fill="currentColor">
      <circle cx="3" cy="2" r="1.2" />
      <circle cx="7" cy="2" r="1.2" />
      <circle cx="3" cy="7" r="1.2" />
      <circle cx="7" cy="7" r="1.2" />
      <circle cx="3" cy="12" r="1.2" />
      <circle cx="7" cy="12" r="1.2" />
    </svg>
  );
}

/** Pencil / edit */
export function EditIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
      <path d="M12.1 1.3a1.5 1.5 0 012.1 2.1L5.6 12l-3.2.8.8-3.2z" />
    </svg>
  );
}

/** Calendar */
export function CalendarIcon({
  size = 14,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="12" rx="2" stroke={color} strokeWidth="1.5" />
      <path d="M1 7h14" stroke={color} strokeWidth="1.5" />
      <path d="M5 1v4M11 1v4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Chevron Down */
export function ChevronDownIcon({
  size = 16,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M4 6l4 4 4-4"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
