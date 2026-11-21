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

- Astro builds a static single-page app. Install with `npm install`, develop with `npm run dev`,
  validate with `npm run check`, and produce a Cloudflare Pages build using `npm run build`
  (output directory: `dist/`). `src/pages/index.astro` is the single HTML application entry.
- The active desktop is native HTML and CSS in `src/dom/`, built as a typed ES module by Astro.
  `tsconfig.dom.json` runs strict TypeScript checking. `src/dom/desktop.ts` owns the window
  manager, menu, wallpaper, clock and sizing; `src/dom/apps.ts` implements desktop apps;
  `src/dom/browser.ts` and `src/dom/emulator.ts` integrate the vendored proxy and v86.
  The CSS lives beside these source files.
- `src/desktop/*.ts` and `tsconfig.desktop.json` contain a compatibility copy of the
  historical canvas desktop for reference. These files are no longer the production entry.
  The detached `.worktrees/original` also holds the untouched JavaScript original.
- The three vendored browser transport and emulator libraries load in `src/pages/index.astro`
  before the native desktop module. Keep them available at their historic static URLs.
- `public/` exposes historic static URL paths using symlinks to `tango/`, `appfiles/`,
  `scripts/net/`, `scripts/stomp/`, and `scripts/v86/`. Astro copies them into `dist/`.
  Keep references root-relative so they also work on nested SPA routes.
- The desktop uses actual DOM elements for the panel, applications menu, windows, app content,
  controls, selections and input. Do not introduce a canvas desktop or a second parallel shell.
  Use the native `DesktopAPI` in `src/dom/types.ts` to open apps and windows.
- Keep window dimensions, taskbar, title bars, menus, fonts, wallpaper scaling, interactions and
  content close to the original. Check the original visually and functionally before redesigning
  controls, and avoid new features that displace existing controls.
- HTML or third-party web apps run in an iframe through `DesktopAPI.openWebApp` and live under
  `appfiles/`. Keep their upstream code as is apart from the smallest fix needed; vibeOS
  specific tweaks go in a clearly commented block.
- Windows must fit inside the desktop, including on small viewports. The taskbar is 26px and
  the title bar is 30px. Preserve keyboard input, browser clipboard behavior, selection, resize,
  focus, scroll and unsaved editor close confirmation.

## Vendored code

- `scripts/v86/` holds the v86 emulator build, BIOS files and small disk images from
  https://copy.sh/v86/ (BSD 2-Clause). `scripts/net/` holds libcurl.js (LGPL v3). Do not edit
  these files. Update them by replacing them with a newer upstream build and say which version.
- `scripts/stomp/` holds the Stomp web proxy (GPL-3.0), copied from the `dist/` folder of the
  npm package `@sysce/stomp` (built from https://github.com/Fracital/powerMouse; `SOURCE`
  names the package version and the commit it was built from), and
  `scripts/stomp/epoxy/` the patched epoxy transport it uses (AGPL-3.0, `UPSTREAM` lists the
  revisions and patches). Same rule: replace, never edit. `src/dom/browser.ts` integrates
  Stomp, using the public wisp relay; proxied webviews must also use the transport.
  Stomp's same-origin mode is not a security
  boundary between a proxied page and the desktop.
- Larger systems are not vendored. They stream from `i.copy.sh` through the wisp relay
  because copy.sh sends no CORS headers. `src/dom/emulator.ts` owns the relay configuration.
- Guest networking in the emulator uses the same relay as a wisp network backend
  (`network_relay_url` in `src/dom/emulator.ts`). The emulator connects to
  destination IP addresses, not hostnames, so the relay must run with `allow_direct_ip`
  enabled or every outbound connection is closed with wisp reason 0x48.
- Keep the repository deployable on Cloudflare Pages: no single file over 25 MiB and well
  under 20,000 files.

## Testing

- Run `npm run build` to compile the desktop, build the Astro site and compare static assets
  by SHA-256. Use `npm run dev` to serve the desktop. The emulator and proxy require an HTTP
  server; the proxy service worker requires a secure context (localhost or HTTPS).
- For side-by-side parity, the old app lives in `.worktrees/original` at commit `81fde71`.
  Serve the original on port 4322 and the Astro app on port 4321, then run
  `node tooling/parity-browser.mjs` to compare the desktop and open representative apps.
  The comparison script recognizes the legacy canvas and native DOM implementations.
- After changing anything in `src/dom/`, open at least one window, one game and the
  emulator and check the browser console. Validate a narrow and a wide viewport.
- Do not add further dependencies, build tooling, or test frameworks without asking first.
