# AGENTS.md

Rules for anyone, human or agent, working in the vibeOS repository. Read this file and
STYLE.md before changing anything. When a rule here conflicts with a tool default, this file wins.

## Git policy

- Never commit, amend, rebase, tag, push, or open a pull request without explicit authorization
  from the maintainer in the current conversation. "Fix X" is not authorization to commit.
  Authorization for one commit does not carry over to the next.
- Leave the working tree for the maintainer to review. Report what changed and stop.
- Never rewrite history on `master`.
- No `Co-Authored-By` or other AI attribution trailers in commit messages. Commits carry the
  maintainer's identity only.

## Writing rules

- No em dashes anywhere: not in code, comments, documentation, commit messages, or chat
  replies. Use a comma, a period, a colon, or parentheses instead. The same goes for en dashes
  used as punctuation.
- Do not edit `README.md`. It is maintained by hand, and the Credits section in particular is
  the maintainer's to curate. If something needs documenting, say so in your reply and let the
  maintainer decide where it goes.
- Third-party attribution lives next to the vendored code (for example `scripts/v86/LICENSE`
  and `scripts/net/LICENSE`), never in `README.md`.

## How the project is built

- There is no build step, bundler, package manager, or framework. `index.html` loads plain
  scripts in order, and every file shares the global scope. New scripts are added as a
  `<script>` tag in `index.html`, after the files they depend on and before `appMan.js` and
  `wallpaper.js`, which must stay last.
- Everything visible is painted on one 2D canvas (`mctx`) at 1280x720 by a render loop in
  `scripts/main.js`. Mouse events arrive on the `#overlay` div and are resolved to
  `interactable` objects by position and index. There is no DOM UI apart from webview iframes.
- A desktop app is a function named `init<Thing>` that creates a `cwindow` and draws its
  contents in the window's render callback. Apps are registered in `startEntries` in
  `scripts/appMan.js`. Shared widgets (`cwindow`, `interactable`, `inputbar`, `button`,
  `windowOptions`) live in `scripts/main.js` and `scripts/constructors.js`.
- HTML or third-party web apps run in an iframe through `initWebView` and live under
  `appfiles/`. Keep their upstream code as is apart from the smallest fix needed; vibeOS
  specific tweaks go in a clearly commented block.
- An iframe sits above the canvas and takes the mouse, so `webview.place()` only shows the real
  one while its window has the focus. The rest of the time the page is drawn on the canvas from
  a picture of its DOM (`scripts/snapshot.js`, an SVG `<foreignObject>` rendered by the browser
  itself). That needs the page to be same origin, which pages behind the web proxy are.
- Windows must fit the desktop: the taskbar is 26px, a title bar is 30px, so content is at most
  about 654px tall. `cwindow` shrinks anything larger to the desktop and keeps the title bar on
  screen, but a shrunk window cuts its content off, so size windows to fit or scroll them.
- Each `cwindow` owns a band of 1000 interactable indices starting at `contentBox.index`. Give a
  widget inside a window the index `contentBox.index + n` and the window manager does the rest:
  the widget follows the window when it is raised, only reacts inside the window frame, and is
  deleted when the window closes. Never use absolute indices inside a window. Shell elements
  (taskbar, menus) use `shellIndex + n`.
- Content taller than its window goes through `window.scrollView(top, bottom, contentHeight,
  draw)` in the render callback, which clips, follows the wheel and draws the scrollbar.
  `scripts/transcript.js` is the smallest example.
- Windows can be resized by their left, right and bottom edges. A window whose app sets its
  width or height every frame, or whose layout is fixed, sets `window.resizable = false`.
  `minWidth` and `minHeight` bound the drag.
- The render loop runs on `requestAnimationFrame`. Do not add `setInterval` timers for anything
  that is drawn: read the clock in the render callback instead (see the caret in `inputbar` and
  the taskbar clock).
- Keys and the clipboard go to the interactable that has the focus (`cursor.focus`), which takes
  part by defining `keydown(e)`, `copy()`, `cut()`, `paste(text)` or `selectAll()`. Text drawn on
  the canvas becomes selectable through the `selection` helper in `scripts/selection.js`.
- Rich text is written as markdown and drawn by the `markdown` widget in `scripts/markdown.js`
  (`initMarkdownViewer` is the ready made window). Web links open in vibeBrowser.
- Multi-line text input is the `editor` widget in `scripts/editor.js` (caret, selection, undo,
  clipboard, a plain mode and a rich mode that formats markdown in place). The Text Editor in
  `scripts/textEditor.js` is the app around it, and shows how a window asks before closing with
  unsaved work (`window.beforeClose`).

## Vendored code

- `scripts/v86/` holds the v86 emulator build, BIOS files and small disk images from
  https://copy.sh/v86/ (BSD 2-Clause). `scripts/net/` holds libcurl.js (LGPL v3). Do not edit
  these files. Update them by replacing them with a newer upstream build and say which version.
- `scripts/stomp/` holds the Stomp web proxy (GPL-3.0), copied from the `dist` branch of
  https://github.com/Fracital/powerMouse (`SOURCE` names the commit it was built from), and
  `scripts/stomp/epoxy/` the patched epoxy transport it uses (AGPL-3.0, `UPSTREAM` lists the
  revisions and patches). Same rule: replace, never edit. `scripts/stomp.js` is the wrapper;
  the browser (`scripts/web.js`) and proxied webviews load pages through it, tunnelled over the
  relay from `scripts/relay.js`. It runs in Stomp's same-origin mode, which is not a security
  boundary between a proxied page and the desktop.
- Larger systems are not vendored. They stream from `i.copy.sh` through the wisp relay in
  `scripts/relay.js`, because copy.sh sends no CORS headers. The relay URL is the maintainer's
  public instance and is configured only in that file.
- Guest networking in the emulator uses the same relay as a wisp network backend
  (`network_relay_url` in `scripts/v86.js`, derived from `relay.url`). The emulator connects to
  destination IP addresses, not hostnames, so the relay must run with `allow_direct_ip`
  enabled or every outbound connection is closed with wisp reason 0x48.
- Keep the repository deployable on Cloudflare Pages: no single file over 25 MiB and well
  under 20,000 files.

## Testing

- Serve the repo over HTTP (`python3 -m http.server`) and open `index.html` in a browser.
  Opening it as a local file works for the desktop and the web games, but the emulator needs
  HTTP for its wasm and disk images, and the browser needs https or localhost for its service
  worker.
- After changing anything in `scripts/`, open at least one window, one game and the emulator
  and check the browser console. There is no automated test suite; say in your report what you
  ran and what you saw.
- Do not add dependencies, build tooling, or test frameworks without asking first.
