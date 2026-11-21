# vibeOS code style

These rules are strict for first-party desktop code under `src/dom/` and the Astro
application entry `src/pages/index.astro`.
Vendored and ported code (`appfiles/`, `scripts/v86/`, `scripts/net/`, `tango/`) keeps its
upstream formatting and is never reformatted. See `.editorconfig` for the editor settings and
`.prettierrc` for the formatter; `.prettierignore` keeps Prettier off the vendored directories.
Prettier enforces the mechanical rules below (tabs, quotes, semicolons, line width). Run it on
the files you touched, not on the whole tree, because older files were written by hand.

## General

- Tabs for indentation. Never spaces, never mixed.
- UTF-8, LF line endings, one newline at end of file, no trailing whitespace.
- Single quotes for strings. Template literals only when interpolating.
- One statement per line, terminated with a semicolon.
- Typed ES2022 TypeScript modules, compiled by Astro. Use explicit interfaces for shared APIs
  and strict TypeScript checking. Do not introduce new globals or canvas-based UI.
- Astro owns the HTML entry, and `tooling/` owns the build and comparison scripts.
- No em dashes or en dashes anywhere, including comments.

## Naming

- `camelCase` for variables, functions and object keys. App launchers are `init<Name>`
  (`initTextEditor`, `initLinuxVM`).
- Widget classes are lowercase single words, matching the existing ones: `cwindow`,
  `interactable`, `inputbar`, `button`, `cswitch`, `cradio`, `windowOptions`.
- Interactable ids are `<owner>_<part>` (`vm-linux_titlebar`, `webview_<timestamp>`).
- Files are `camelCase.ts` or `lowercase.ts`, one feature per file.

## Declarations

- The preserved legacy desktop in `src/desktop/` uses `var` declarations. When reading it,
  expect comma-chained blocks with continuation lines indented one tab:

  ```js
  var vmWindow = null,
  	vmMsg = '',
  	profiles = {};
  ```

- `let` and `const` are fine inside functions written new, but do not mix styles within one
  file.
- Prefer `const` for new native modules and `let` for changing state. Avoid leaking globals.

## Functions and control flow

- Arrow functions for callbacks and most helpers. `forEach` callbacks are `(e,i)=>{ ... }`,
  nested ones `(ee,ii)=>`, matching the codebase.
- A single-statement `if` may stay on one line with no space after the keyword:
  `if(emulator == null)return;`. Anything longer uses braces.
- Compare with `===` and `!==`, except `== null` and `!= null` to catch both `null` and
  `undefined`. Existing `==` comparisons in a file you are editing may stay as they are.
- Early returns over deep nesting. No `else` after a `return`.
- Async work uses `async`/`await` with `try`/`catch`, never bare promise chains that swallow
  errors.

## Comments

- `//` comments, lowercase, explaining why rather than what. A blank line before a comment that
  introduces a block.
- A file that wraps third-party code starts with a short comment naming the upstream project
  and where the vendored files live.
- No commented-out code in new work. Delete it.

## Rendering code

- Render the desktop and its applications using semantic HTML elements and CSS. Reuse the
  `DesktopAPI` interfaces in `src/dom/types.ts` for windows, browser and emulator actions.
- Compute bounds from the viewport and window geometry. Preserve focus, resizing, stacking,
  selection and the original dimensions where possible.
- Fonts are the loaded Google fonts only: `Open Sans` for UI text, `Inconsolata` or
  `Roboto Mono` for monospace.

## HTML and CSS

- `src/pages/index.astro` holds the application entry. Keep CSS in `src/dom/*.css`, use tabs,
  one property per line, and preserve the layered window manager.
- Changes to a ported app's HTML are limited to a single `<style>` or `<script>` block marked
  with a `vibeOS:` comment so upstream updates stay easy.
