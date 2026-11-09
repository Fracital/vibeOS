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
- Windows must fit the desktop: the taskbar is 26px, a title bar is 30px, so content is at most
  about 654px tall. Nothing clamps window sizes for you.

## Vendored code

- `scripts/v86/` holds the v86 emulator build, BIOS files and small disk images from
  https://copy.sh/v86/ (BSD 2-Clause). `scripts/net/` holds libcurl.js (LGPL v3). Do not edit
  these files. Update them by replacing them with a newer upstream build and say which version.
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
  HTTP for its wasm and disk images.
- After changing anything in `scripts/`, open at least one window, one game and the emulator
  and check the browser console. There is no automated test suite; say in your report what you
  ran and what you saw.
- Do not add dependencies, build tooling, or test frameworks without asking first.
