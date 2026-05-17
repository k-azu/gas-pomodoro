import type { Editor } from "../../../editor/markweaveEditor";
import type { ToolbarItem } from "./toolbarTypes";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBlockquote,
  IconBold,
  IconCode,
  IconCodeBlock,
  IconDetails,
  IconH1,
  IconH2,
  IconH3,
  IconHorizontalRule,
  IconImage,
  IconInfo,
  IconItalic,
  IconLightbulb,
  IconLink,
  IconList,
  IconListOrdered,
  IconListTodo,
  IconOctagon,
  IconPilcrow,
  IconStrikethrough,
  IconTable,
  IconUnderline,
} from "./toolbarIcons";

const chain = (editor: Editor) => editor.chain().focus() as any;

function hasCheckedListItem(editor: Editor, checked: boolean | null) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "listItem") {
      return $from.node(depth).attrs.checked === checked;
    }
  }
  return checked === null && editor.isActive("bulletList");
}

function hasTaskListItem(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "listItem") {
      return $from.node(depth).attrs.checked !== null;
    }
  }
  return false;
}

export const DEFAULT_TOOLBAR_ITEMS: ToolbarItem[] = [
  {
    type: "dropdown",
    name: "heading",
    title: "Heading",
    showActiveLabel: true,
    defaultLabel: "Normal",
    items: [
      {
        name: "normal",
        label: "Normal",
        icon: <IconPilcrow />,
        isActive: (editor) =>
          !editor.isActive("heading", { level: 1 }) &&
          !editor.isActive("heading", { level: 2 }) &&
          !editor.isActive("heading", { level: 3 }),
        action: (editor) => {
          if (editor.isActive("heading")) chain(editor).setParagraph().run();
        },
      },
      {
        name: "heading1",
        label: "Heading 1",
        icon: <IconH1 />,
        isActive: (editor) => editor.isActive("heading", { level: 1 }),
        action: (editor) => chain(editor).toggleHeading({ level: 1 }).run(),
      },
      {
        name: "heading2",
        label: "Heading 2",
        icon: <IconH2 />,
        isActive: (editor) => editor.isActive("heading", { level: 2 }),
        action: (editor) => chain(editor).toggleHeading({ level: 2 }).run(),
      },
      {
        name: "heading3",
        label: "Heading 3",
        icon: <IconH3 />,
        isActive: (editor) => editor.isActive("heading", { level: 3 }),
        action: (editor) => chain(editor).toggleHeading({ level: 3 }).run(),
      },
    ],
  },
  { type: "divider" },
  {
    type: "button",
    name: "bold",
    title: "Bold",
    icon: <IconBold />,
    isActive: (editor) => editor.isActive("bold"),
    action: (editor) => chain(editor).toggleBold().run(),
  },
  {
    type: "button",
    name: "italic",
    title: "Italic",
    icon: <IconItalic />,
    isActive: (editor) => editor.isActive("italic"),
    action: (editor) => chain(editor).toggleItalic().run(),
  },
  {
    type: "button",
    name: "underline",
    title: "Underline",
    icon: <IconUnderline />,
    isActive: (editor) => editor.isActive("underline"),
    action: (editor) => chain(editor).toggleUnderline().run(),
  },
  {
    type: "button",
    name: "strike",
    title: "Strikethrough",
    icon: <IconStrikethrough />,
    isActive: (editor) => editor.isActive("strike"),
    action: (editor) => chain(editor).toggleStrike().run(),
  },
  {
    type: "button",
    name: "code",
    title: "Inline Code",
    icon: <IconCode />,
    isActive: (editor) => editor.isActive("code"),
    action: (editor) => chain(editor).toggleCode().run(),
  },
  { type: "divider" },
  {
    type: "dropdown",
    name: "list",
    title: "List",
    icon: <IconList />,
    items: [
      {
        name: "bulletList",
        label: "Bullet List",
        icon: <IconList />,
        isActive: (editor) => hasCheckedListItem(editor, null),
        action: (editor) => chain(editor).toggleBulletList().run(),
      },
      {
        name: "orderedList",
        label: "Ordered List",
        icon: <IconListOrdered />,
        isActive: (editor) => editor.isActive("orderedList"),
        action: (editor) => chain(editor).toggleOrderedList().run(),
      },
      {
        name: "taskList",
        label: "Task List",
        icon: <IconListTodo />,
        isActive: hasTaskListItem,
        action: (editor) => chain(editor).toggleTaskList().run(),
      },
    ],
  },
  { type: "divider" },
  {
    type: "button",
    name: "blockquote",
    title: "Blockquote",
    icon: <IconBlockquote />,
    isActive: (editor) => editor.isActive("blockquote"),
    action: (editor) => chain(editor).toggleBlockquote().run(),
  },
  {
    type: "dropdown",
    name: "callout",
    title: "Callout",
    icon: <IconInfo />,
    items: [
      {
        name: "calloutNote",
        label: "Note",
        icon: <IconInfo />,
        isActive: (editor) => editor.isActive("callout", { type: "note" }),
        action: (editor) => chain(editor).toggleCallout({ type: "note" }).run(),
      },
      {
        name: "calloutTip",
        label: "Tip",
        icon: <IconLightbulb />,
        isActive: (editor) => editor.isActive("callout", { type: "tip" }),
        action: (editor) => chain(editor).toggleCallout({ type: "tip" }).run(),
      },
      {
        name: "calloutImportant",
        label: "Important",
        icon: <IconAlertCircle />,
        isActive: (editor) => editor.isActive("callout", { type: "important" }),
        action: (editor) => chain(editor).toggleCallout({ type: "important" }).run(),
      },
      {
        name: "calloutWarning",
        label: "Warning",
        icon: <IconAlertTriangle />,
        isActive: (editor) => editor.isActive("callout", { type: "warning" }),
        action: (editor) => chain(editor).toggleCallout({ type: "warning" }).run(),
      },
      {
        name: "calloutCaution",
        label: "Caution",
        icon: <IconOctagon />,
        isActive: (editor) => editor.isActive("callout", { type: "caution" }),
        action: (editor) => chain(editor).toggleCallout({ type: "caution" }).run(),
      },
    ],
  },
  {
    type: "button",
    name: "details",
    title: "Details",
    icon: <IconDetails />,
    isActive: (editor) => editor.isActive("details"),
    action: (editor) => {
      if (editor.isActive("details")) {
        chain(editor).unsetDetails().run();
      } else {
        chain(editor).setDetails().run();
      }
    },
  },
  {
    type: "button",
    name: "codeBlock",
    title: "Code Block",
    icon: <IconCodeBlock />,
    isActive: (editor) => editor.isActive("codeBlock"),
    action: (editor) => chain(editor).toggleCodeBlock().run(),
  },
  {
    type: "button",
    name: "horizontalRule",
    title: "Horizontal Rule",
    icon: <IconHorizontalRule />,
    isActive: () => false,
    action: (editor) => chain(editor).setHorizontalRule().run(),
  },
  { type: "divider" },
  {
    type: "button",
    name: "link",
    title: "Link",
    icon: <IconLink />,
    isActive: (editor) => editor.isActive("link"),
    action: (editor) => {
      if (editor.isActive("link")) {
        chain(editor).unsetLink().run();
      } else {
        chain(editor).setLink({ href: "" }).run();
      }
    },
  },
  {
    type: "button",
    name: "table",
    title: "Insert Table",
    icon: <IconTable />,
    isActive: (editor) => editor.isActive("table"),
    action: (editor) => chain(editor).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    type: "button",
    name: "image",
    title: "Insert Image",
    icon: <IconImage />,
    isActive: () => false,
    action: (editor) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          chain(editor)
            .setImage({ src: reader.result as string, alt: file.name })
            .run();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
  },
];
