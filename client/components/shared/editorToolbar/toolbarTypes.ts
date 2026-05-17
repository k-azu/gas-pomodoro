import type { ReactNode } from "react";
import type { Editor } from "../../../editor/markweaveEditor";

export interface ToolbarDropdownOption {
  name: string;
  label: string;
  icon?: ReactNode;
  isActive: (editor: Editor) => boolean;
  action: (editor: Editor) => void;
}

export interface ToolbarDropdownItem {
  type: "dropdown";
  name: string;
  icon?: ReactNode;
  title?: string;
  showActiveLabel?: boolean;
  defaultLabel?: string;
  items: ToolbarDropdownOption[];
}

export type ToolbarItem =
  | {
      type: "button";
      name?: string;
      icon?: ReactNode;
      title?: string;
      isActive?: (editor: Editor) => boolean;
      action?: (editor: Editor) => void;
    }
  | { type: "divider" }
  | ToolbarDropdownItem;
