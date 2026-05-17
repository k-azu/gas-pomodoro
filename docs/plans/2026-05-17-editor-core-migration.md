# @markweave/editor-core Migration Plan

Date: 2026-05-17

## Context

`gas-pomodoro` currently depends on `tiptap-markdown-editor` through a local
`link:` dependency and a CDN fallback.

The target direction is to keep that local-link workflow for now, but replace
the editor implementation dependency with `@markweave/editor-core` from the
neighboring `markweave` repository.

Expected local checkout layout:

```text
github.com/k-azu/
  gas-pomodoro/
  markweave/
```

Initial dependency target:

```json
{
  "optionalDependencies": {
    "@markweave/editor-core": "link:../markweave/packages/editor-core"
  }
}
```

This plan assumes the chosen architecture is "policy B":

- `@markweave/editor-core` provides reusable editor core behavior.
- `gas-pomodoro` keeps app-specific UI and document state.
- No git submodule is introduced at this stage.
- No npm publish is required for the first migration.
- CDN/IIFE support is deferred until after local-link migration works.

## Goals

- Replace imports from `tiptap-markdown-editor` with a local adapter for
  `@markweave/editor-core`.
- Keep `gas-pomodoro`'s document cache, mode switching, raw Markdown mode, and
  editor layout in this repository.
- Preserve the current `link:`-based local development workflow.
- Keep the first migration small enough to validate with typecheck, build, and
  existing e2e tests.

## Non-Goals

- Do not publish `@markweave/editor-core` to npm yet.
- Do not add `markweave` as a git submodule.
- Do not implement CDN fallback in the first pass.
- Do not move `gas-pomodoro`'s `EditorLayout`, mode toggle UI, or document
  cache logic into `editor-core`.

## Current Dependency Surface

`gas-pomodoro` imports these symbols from `tiptap-markdown-editor`:

- `useEditor`
- `getDefaultExtensions`
- `parseMarkdown`
- `createEditorState`
- `EditorBody`
- `Toolbar`
- `DEFAULT_TOOLBAR_ITEMS`
- `insertImageWithUpload`
- Types: `Editor`, `EditorMode`, `EditorState`, `MentionTrigger`,
  `ToolbarItem`

`@markweave/editor-core` currently exports:

- `EditorBody`
- `getDefaultExtensions`
- `parseMarkdown`
- `useRichMarkdownEditor`
- `insertImageWithUpload`
- Types: `Editor`, `MentionTrigger`, `ImageUploadResult`, and related hook
  types

Important difference:

- Old `EditorBody` renders both WYSIWYG and raw Markdown modes.
- New `@markweave/editor-core` `EditorBody` renders only the rich editor body.
- `Toolbar`, `DEFAULT_TOOLBAR_ITEMS`, mode switching, and raw Markdown textarea
  should stay in `gas-pomodoro`.

## Recommended Migration Shape

Add a local adapter module in `gas-pomodoro`:

```text
client/editor/markweaveEditor.ts
```

This adapter should be the only direct import point for `@markweave/editor-core`
inside `gas-pomodoro`, at least during migration.

Initial adapter responsibilities:

- Re-export core editor primitives from `@markweave/editor-core`.
- Provide local `EditorMode`, `ToolbarItem`, and `EditorState` types where
  `editor-core` intentionally does not own app UI state.
- Optionally wrap or normalize option names if the old and new APIs differ.

Example target shape:

```ts
export {
  EditorBody as RichEditorBody,
  getDefaultExtensions,
  insertImageWithUpload,
  parseMarkdown,
} from "@markweave/editor-core";
export type { Editor, MentionTrigger } from "@markweave/editor-core";

export { useEditor } from "@tiptap/react";
export type { EditorState } from "@tiptap/pm/state";

export type EditorMode = "wysiwyg" | "markdown";
```

`createEditorState` has two possible paths:

1. Prefer adding it to `@markweave/editor-core` if it is still useful as a
   shared ProseMirror helper.
2. Otherwise keep a tiny local helper in `gas-pomodoro`:

```ts
import type { Editor } from "@markweave/editor-core";
import { EditorState } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export function createEditorState(editor: Editor, doc: ProseMirrorNode): EditorState {
  return EditorState.create({ doc, plugins: editor.state.plugins });
}
```

For the first pass, option 2 is acceptable because it keeps `editor-core`'s
public API smaller.

## Required Changes in `markweave`

These should be completed before or alongside the `gas-pomodoro` migration.

1. Make `@markweave/editor-core` resolvable from `gas-pomodoro`.

   `packages/editor-core/package.json` can remain `private: true` while using
   `link:` locally. It does not need npm-ready metadata yet.

2. Ensure the package can be built before `gas-pomodoro` consumes it.

   Current package export points to `dist/index.js` and `dist/index.d.ts`, so
   run:

   ```sh
   cd ../markweave
   pnpm --filter @markweave/editor-core run build
   ```

3. Decide CSS export behavior for local link.

   Current export points `./styles.css` to `./src/styles.css`. That is okay for
   local Vite usage, but future npm publication should copy CSS to `dist`.

4. Check API compatibility for options.

   `gas-pomodoro` currently passes `onResolveLink`; `editor-core` uses
   `onResolveLinkTitle`. The adapter or hook call site must normalize this.

5. Confirm image upload result compatibility.

   `gas-pomodoro` currently expects image upload to resolve to a string. New
   `editor-core` supports `ImageUploadResult | string`. The old string-only
   callbacks can remain valid.

## Required Changes in `gas-pomodoro`

### Phase 1: Dependency and Adapter

1. Replace the optional dependency.

   ```diff
   - "tiptap-markdown-editor": "link:../tiptap-markdown-editor"
   + "@markweave/editor-core": "link:../markweave/packages/editor-core"
   ```

2. Add Tiptap dependencies only if needed by the adapter.

   If importing `useEditor`, `EditorState`, or ProseMirror types directly from
   Tiptap packages in `gas-pomodoro`, add compatible dependencies:

   ```json
   {
     "dependencies": {
       "@tiptap/react": "3.23.1",
       "@tiptap/pm": "3.23.1"
     }
   }
   ```

   Prefer matching the exact versions used by `@markweave/editor-core` to avoid
   duplicate ProseMirror/Tiptap instances.

3. Create `client/editor/markweaveEditor.ts`.

4. Create or move local editor UI types:

   - `EditorMode`
   - `ToolbarItem`
   - any toolbar-specific option types used only by `gas-pomodoro`

### Phase 2: Import Replacement

Replace imports from `tiptap-markdown-editor` with imports from the adapter.

Known files:

- `client/main.tsx`
- `client/hooks/useMarkdownEditor.ts`
- `client/hooks/useMentionConfig.ts`
- `client/hooks/useDocumentEditor.ts`
- `client/components/shared/EditorLayout.tsx`
- `client/types/tiptap-markdown-editor.d.ts`

Expected CSS change:

```diff
- import "tiptap-markdown-editor/dist/tiptap-markdown-editor.css";
+ import "@markweave/editor-core/styles.css";
```

If the adapter owns the CSS import instead, keep CSS import centralized and
avoid importing it from many components.

### Phase 3: Replace Editor Body Composition

The old `EditorBody` included raw Markdown mode. The new `editor-core`
`EditorBody` is rich-editor only.

Update `client/components/shared/EditorLayout.tsx` to compose modes locally:

```tsx
{mode === "wysiwyg" ? (
  <RichEditorBody editor={editor} placeholder={placeholder} />
) : (
  <textarea
    className="mdg-raw-editor"
    value={rawMarkdown}
    onChange={(event) => setRawMarkdown(event.currentTarget.value)}
    placeholder={placeholder}
    readOnly={readOnly}
  />
)}
```

Prefer extracting the textarea to a local component if the current CSS or
auto-resize behavior becomes hard to read:

```text
client/components/shared/RawMarkdownEditor.tsx
```

Keep existing `.mdg-raw-editor` class usage so e2e tests and current CSS remain
close to the old behavior.

### Phase 4: Toolbar Ownership

Because policy B keeps app-specific UI in `gas-pomodoro`, do not require
`editor-core` to export `Toolbar` or `DEFAULT_TOOLBAR_ITEMS`.

Instead, move or recreate the toolbar definitions locally:

```text
client/components/shared/editorToolbar/
  Toolbar.tsx
  toolbarItems.tsx
  toolbarTypes.ts
```

Short-term migration option:

- Copy the minimal toolbar items actually used by `gas-pomodoro`.
- Keep the image toolbar item override in `EditorLayout`.
- Do not copy unused generic library affordances.

Longer-term cleanup:

- Replace copied SVG icons with existing `client/components/shared/Icons.tsx`
  where possible.
- Keep toolbar commands close to `gas-pomodoro` UX needs.

### Phase 5: Vite Build Behavior

For the first local-link migration, remove or disable the old
`tiptap-markdown-editor` CDN fallback.

In `vite.config.ts`:

- Remove `TIPTAP_CDN_CSS`.
- Remove `TIPTAP_CDN_JS`.
- Remove `tiptapCdnPlugin`.
- Remove `tiptap-markdown-editor` from Rollup external/globals.

First-pass build should bundle `@markweave/editor-core` from the local link.
This is simpler and gives immediate feedback.

Later, after local migration is stable, decide whether GAS production build
needs `@markweave/editor-core` externalized to CDN. If yes:

- `editor-core` should produce the CDN/IIFE bundle.
- `gas-pomodoro` should only inject the CDN script/link and configure Rollup
  externals/globals.

### Phase 6: Type Declaration Cleanup

Remove the old fallback declaration:

```text
client/types/tiptap-markdown-editor.d.ts
```

If local adapter types are needed, create explicit local types instead of a
fake external module declaration:

```text
client/editor/types.ts
```

## Validation Checklist

Run in `markweave` first:

```sh
cd ../markweave
pnpm --filter @markweave/editor-core run build
```

Run in `gas-pomodoro`:

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm run build:gas
```

If browser behavior changed:

```sh
pnpm run test:e2e
```

Manual checks:

- Rich text editor renders.
- Markdown mode renders raw textarea.
- WYSIWYG to Markdown preserves content.
- Markdown to WYSIWYG parses content.
- Switching documents does not leak stale raw Markdown.
- Image upload toolbar still inserts image markdown.
- Mention suggestions still work.
- Link title resolution still works.
- GAS build output includes required editor code when CDN externalization is
  disabled.

## Risks and Watch Points

- Tiptap version duplication:
  `gas-pomodoro` should avoid installing a different Tiptap version than
  `editor-core`. Prefer exact matching versions if direct Tiptap imports are
  needed.

- CSS drift:
  Old `tiptap-markdown-editor` CSS and new `editor-core` CSS both use
  `.mdg-*` classes, but raw Markdown mode CSS may no longer be supplied by
  `editor-core`. Keep raw editor CSS in `gas-pomodoro` if needed.

- Toolbar scope:
  Copying the old generic toolbar wholesale can accidentally preserve unused
  behavior. Start with the commands `gas-pomodoro` actually exposes.

- API option names:
  Normalize `onResolveLink` to `onResolveLinkTitle` in one place.

- Build order:
  Because `@markweave/editor-core` exports `dist/index.js`, local link usage
  may require building `editor-core` before running `gas-pomodoro`.

## Suggested Implementation Order for Next Session

1. Build `../markweave/packages/editor-core`.
2. Change `gas-pomodoro/package.json` dependency to
   `@markweave/editor-core`.
3. Add `client/editor/markweaveEditor.ts`.
4. Move minimal editor-local types into `client/editor/types.ts`.
5. Update `useMarkdownEditor` imports and option naming.
6. Update `EditorLayout` to compose `RichEditorBody` and local raw textarea.
7. Move/create local toolbar components if needed.
8. Remove old `tiptap-markdown-editor` type declaration.
9. Simplify Vite config by removing old CDN fallback.
10. Run typecheck/build/build:gas.
11. Run focused e2e tests for Markdown mode switching and stale raw markdown.

