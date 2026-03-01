# Client Rules

## Icons

- All SVG icon components are defined in `client/components/shared/Icons.tsx`
- Do NOT define inline SVG icons or local icon components in feature files
- To add a new icon: export a new component from `Icons.tsx` following the existing pattern (`size` + `color` props with defaults)
- To use an icon: `import { XxxIcon } from "../shared/Icons"`

## CSS Modules

- すべてのコンポーネントは CSS Modules (`*.module.css`) を使う
- `global.css` にコンポーネント固有のスタイルを追加しない
- import は `import s from "./Xxx.module.css"` 、className は `s['class-name']` (bracket notation)
- クラス名にハイフンを含む場合は `s['my-class']`、含まない場合は `s.myClass` でもよい

### global.css に残してよいもの

- CSS 変数 (`:root`)、リセット (`*`, `body`)
- `.btn-*` — 複数コンポーネントで使うボタンユーティリティ
- `.pomodoro-dot` — TimerCard + CollapsedStrip で共有
- `.editor-full-container` — 3rd-party エディタの上書き (複数コンポーネントで使用)
- `.memo-tag-dot` — MemoTab + ContextMenu で共有
- `@keyframes spin`

### global.css に追加する前に確認すること

- そのクラスは本当に複数コンポーネントで使われるか？ → 1 箇所だけなら module.css に書く
- 複数箇所で同じ HTML 構造+スタイルが繰り返されていないか？ → 共通コンポーネント (`client/components/shared/`) に抽出する
- グローバルクラスを module.css から参照する場合は `:global(.class-name)` を使う

## 共通コンポーネント

- 複数の feature コンポーネントで繰り返される UI パターンは `client/components/shared/` に抽出する
- 既存の共通コンポーネント: `RecordField`, `FormActions`, `ItemPicker`, `ContextMenu`, `PanelToolbar`
- グローバル CSS で「複数ファイルで使うから」と残す前に、共通コンポーネント化を検討する
