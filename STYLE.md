# vibeOS code style

These rules are strict for code written by the vibeOS team under `scripts/` and `index.html`.
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
- Plain ES2017 that runs in a browser without a build step. No modules, no `import`, no
  TypeScript, no JSX.
- No em dashes or en dashes anywhere, including comments.

## Naming

- `camelCase` for variables, functions and object keys. App launchers are `init<Name>`
  (`initTextEditor`, `initLinuxVM`).
- Widget classes are lowercase single words, matching the existing ones: `cwindow`,
  `interactable`, `inputbar`, `button`, `cswitch`, `cradio`, `windowOptions`.
- Interactable ids are `<owner>_<part>` (`vm-linux_titlebar`, `webview_<timestamp>`).
- Files are `camelCase.js` or `lowercase.js`, one feature per file.

## Declarations

- Declare with `var` in one comma-chained block at the top of the scope, one name per line,
  the continuation lines indented one tab:

  ```js
  var vmWindow = null,
  	vmMsg = '',
  	profiles = {};
  ```

- `let` and `const` are fine inside functions written new, but do not mix styles within one
  file.
- Never leak accidental globals. Every name is declared.

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

- All drawing goes through `mctx` inside a render callback. Restore any state you change
  (`textAlign`, `textBaseline`, `shadowBlur`) before returning.
- Positions are computed from the window (`window.x`, `window.contentBox.y`) every frame.
  Nothing is cached across frames except images and measured sizes.
- Fonts are the loaded Google fonts only: `Open Sans` for UI text, `Inconsolata` or
  `Roboto Mono` for monospace.

## HTML and CSS

- `index.html` holds the only stylesheet for the desktop. Keep it there, tabs, one property
  per line.
- Changes to a ported app's HTML are limited to a single `<style>` or `<script>` block marked
  with a `vibeOS:` comment so upstream updates stay easy.
