import type { Editor } from "../../../editor/markweaveEditor";
import type { ToolbarItem } from "./toolbarTypes";
import { ToolbarButton } from "./ToolbarButton";
import { ToolbarDivider } from "./ToolbarDivider";
import { ToolbarDropdown } from "./ToolbarDropdown";

interface ToolbarProps {
  editor: Editor;
  items: ToolbarItem[];
}

export function Toolbar({ editor, items }: ToolbarProps) {
  return (
    <div className="mdg-toolbar" role="toolbar" aria-label="Formatting toolbar">
      {items.map((item, index) => {
        if (item.type === "divider") {
          return <ToolbarDivider key={index} />;
        }
        if (item.type === "dropdown") {
          return <ToolbarDropdown key={item.name} item={item} editor={editor} />;
        }
        return <ToolbarButton key={item.name ?? index} item={item} editor={editor} />;
      })}
    </div>
  );
}
