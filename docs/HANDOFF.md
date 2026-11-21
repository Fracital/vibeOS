# vibeOS HTML5 rebuild handoff

Updated November 21, 2026. The work is uncommitted on `master`.

## Reference and active implementation

The unchanged original is preserved in the detached worktree `.worktrees/original` at
commit `81fde71`. It still runs with `python3 -m http.server 4322 --bind 127.0.0.1`
from that directory.

The active single-page app uses Astro, native HTML/CSS and strict TypeScript modules.
The entry is `src/pages/index.astro`. The shell, desktop apps, browser and emulator
are in `src/dom/`. Its assets are available at historic root URLs through `public/`.
The Cloudflare Pages build output is `dist/`, with `public/_redirects` supplying
the SPA fallback. `src/desktop/` retains compatibility TypeScript copies of the old
canvas runtime as a migration reference, and is not used by the production entry.
Third-party vendor libraries remain separately maintained. The v86 JavaScript and wasm
were subsequently replaced together from the official `v86@0.5.473` npm tarball;
`scripts/v86/UPSTREAM` records their hashes and provenance. The other vendor
files retain their original bytes.

## Welcome window and first-boot setup

The startup screen in `src/dom/welcome.ts` and `welcome.css` uses the compact
"Getting Started with Windows 2000" layout as a visual reference:
https://guidebookgallery.org/screenshots/welcome/ and
https://discover.hubpages.com/technology/Install-Windows-2000-Professional-In-Oracle-VM-VirtualBox.
It uses original vibeOS branding, a small logo header, topic navigation, brief
onboarding instructions and a footer preference.

By default it opens once on each desktop boot. The startup checkbox and
"Never show again" button update the shared local preference
`vibeos.welcome.showOnBoot.v1`. The Settings > General page exposes the same
checkbox and a manual "Open Welcome" action; Applications > Settings >
Getting Started opens it too. A singleton prevents duplicate welcome windows.
The welcome window offers direct actions for vibeBrowser and App Manager.

`node tooling/smoke-welcome.mjs` reuses an existing CDP browser endpoint at
port 9357, checks the first boot, topic navigation, never-show persistence,
reload behavior, re-enabling from Settings, manual opening, and preference
synchronization, then restores the test browser's original storage value.
The test screenshot is `.parity/welcome-startup.png`. The original Windows 2000
popup was not part of the old vibeOS baseline, so parity snapshots dismiss the
optional window before comparing the desktop underneath it.

## Recent desktop improvements

The HTML5 shell now dismisses Applications when launching an entry or clicking
outside the menu. Window content and embedded iframe focus raise their owner
window. The clock offers a hover and keyboard-focus date/time tooltip, and native
scrollbars use a Windows-like track and thumb. The v86 display scales within
its available viewport without a page scrollbar.

Mouse and Touchpad settings are available from the Settings menu. Kittydog Crystal
is the default cursor theme, with 23 original Xcursor sprites converted from the
user-provided archive into `public/cursors/kittydog/`. Tango Classic and the
system cursor are selectable with live previews. Pointer response adjusts vibeOS
window dragging only; a browser cannot modify the OS mouse acceleration.

The browser now has classic Chrome-styled tabs, bookmarks, navigation controls,
keyboard shortcuts and separate STomp frames. `src/dom/catalog.ts` keeps
metadata-backed website titles, descriptions, icons and manifests, using the
original Tango icons only when metadata is unavailable. The Installed Apps
category and App Manager support installing, launching and uninstalling STomp
apps and PWA launchers. A PWA launcher installed in vibeOS is not a host-browser
or operating-system installation. Chrome Canvas opens through STomp without
an additional URL strip or "Open in browser" button. Its iframe fills the
web-app content area directly below the native vibeOS window titlebar. A live
proxy smoke test returned the site title `Canvas` and a STomp-encoded iframe
URL without console errors.

The November 20 Chrome interaction pass further tightened the interface.
Buttons and their labels are non-selectable, and Applications keeps only one
category expanded at a time, including nested menus. The browser now places the
original vibeOS window-manager controls in the same slim blue tab bar, reusing
the Tango min, max and close icons rather than creating separate browser buttons.
A minimized browser
can be restored from its taskbar button; double-clicking the free tabstrip
area maximizes or restores the window. Tabs reorder by drag and drop, can
accept dropped bookmarks, and middle-click closes one. Bookmarks reorder by
drag and drop and persist in the local browser profile.

`src/dom/bookmarks.ts` seeds the exact ten STomp demo bookmarks from
Fracital/powerMouse revision `058c7e729c67f1a2f31b09ed3919652572aa315c`:
Fracital, vibeOS, estrogen, Krunk, Reddit, Google, YouTube, Discord,
Chrome Web Store and N SVG. Curated icons from that pinned revision are in
`public/stomp-bookmarks/icons/`, with SHA-256 hashes in the adjacent `SOURCE`.
The module imports existing vibeBrowser bookmark data before initializing its
own saved order. It can read a same-origin `stomp-demo:bookmarks` store, but
browser origin isolation prevents directly reading the remote STomp demo's
storage on `stomp.fracit.al`. The New Tab layout also reflects Chrome's older
grid-and-sidebar approach, with bookmarks, search and recently closed tabs.

`tooling/smoke-features.mjs` includes assertions for single-category menu
expansion, non-selectable button labels, exact STomp bookmark names/icons,
bookmark drag and saved order, tab reordering, middle-click close, the
integrated window buttons and taskbar restoration. The follow-up browser
test passed these checks in Chromium before and after the final New Tab visual
pass. A subsequent Windows 8-era pass replaces the early three-column
most-visited/sidebar mockup with a responsive Apps-first launcher. The new
bookmark icon paths and pinned
SHA-256 checks are also validated in `tooling/check-build.mjs`. The latest
full Astro build and strict TypeScript check pass, with 3,869 files in the
validated staging output (`/dev/shm/vibeos-astro`)
within Cloudflare Pages limits and all 3,815 original assets still matching.

## 2012 to 2014 Chrome on Windows 8 redesign

The browser now follows the pre-Material Chrome desktop look from the Windows 8
period, rather than the older 2008/2009 version: desaturated blue window frame,
low-angle trapezoid tabs, white active tab continuous with the toolbar, classic
gray-blue omnibox, compact bookmark strip and integrated window controls. The
bookmarks row now shares one continuous 65px toolbar gradient with the address
and navigation controls, with no separating border or visible native scrollbar.
Horizontal bookmark scrolling and drag reordering remain available; when the
bookmarks bar is hidden, the toolbar supplies the bottom border instead. The
new-tab page is the **Apps** page itself (not a bookmark-bar link). It displays
the original STomp site shortcuts, plus apps installed within vibeOS, with
large 64px icons and responsive layout. The original YouTube logo did not fit
the square tile cleanly, so `/icons/youtube.svg` is a locally drawn, properly
proportioned red play-button icon rather than a stretched bitmap.

The hand-built tab DOM was replaced with the MIT-licensed `chrome-tabs@5.4.0`
package, which depends on `draggabilly@2.2.0`. Chrome Tabs still supplies the
tab shapes, layout and reorder operations. Its Draggabilly event handling was
later deliberately disabled in the typed `src/dom/chromeTabStrip.ts` adapter:
the upstream implementation rebuilds drag instances on tab changes and uses
delayed drag cleanup, which proved unreliable with repeated operations.

The adapter now owns one pointer-driven, horizontally constrained drag session
at a time. It caches geometry at pointer-down, waits for a 5px movement, moves
at animation-frame rate, uses a 7px reorder hysteresis and animated neighboring
tabs, then settles into the new slot. Escape, pointer cancellation, window blur,
visibility changes, resizing and tab closure end the drag without leaving
stale transforms or sorting classes. Cancelled drags restore original order.
Tabs no longer shrink to an unclickable 24px minimum: the strip scrolls at a
readable minimum width, supports wheel scrolling and scrolls automatically
near its edges while dragging. Keyboard-selected tabs are brought into view.
Reduced-motion preferences disable settle animation without disabling drag.
The decorative browser icon at the start of the upper tab strip was removed.
The original Tango window controls remain in the same slim bar.

`src/dom/browser.ts` continues to manage STomp frames, tab state, keyboard
shortcuts, and modified link clicks. Closing a tab during drag now resolves
its current model position after cancellation, avoiding a stale-index bug that
previously left a closed entry in keyboard tab navigation. Bookmarks retain
persistent native drag-and-drop reordering, and middle-click closes a tab.

Chrome-like modified link gestures are supported for bookmarks, the Apps page,
and accessible STomp-proxied documents: Ctrl-click or middle-click opens a
background tab; Ctrl+Shift-click opens a foreground tab; Shift-click opens a
separate vibeOS browser window. Accessible iframe documents forward their
keyboard events and hyperlink modifier gestures to the browser window. Cross-
origin frames that cannot expose their document cannot be intercepted by the
host DOM, so support there depends on the STomp controller.

The browser keyboard shortcuts include Ctrl+T/W/Shift+T, Ctrl+Tab and
Ctrl+Shift+Tab, Ctrl+1 through 9, Ctrl+L or Alt+D, Ctrl+R/F5,
Alt+Left/Right, Ctrl+D, Ctrl+Shift+B, Ctrl+Plus/Minus/0,
Ctrl+Shift+PageUp/PageDown, Escape, and Ctrl+N (new vibeOS browser window).
`tooling/smoke-tabdrag.mjs` tests keyboard shortcuts, drag movement and release,
horizontal clamp, rapid reversals, Escape/blur/pointercancel, closing while
dragging, reduced motion, modified clicks, crowded tab scrolling and same-origin
iframe interactions. The latest staging run passed 33 of 33 tests with zero
runtime errors. The broader
app smoke test also verified that the three native window controls were moved
into the tab bar and that STomp, App Manager and FreeDOS still work. No commits or
deployments were made.

The `chrome-tabs` and `draggabilly` MIT notices are published in
`public/licenses/` and checked with other built assets. The source parity
check and the complete Astro build checker passed against the staging output,
including all 3,815 original asset hashes and Cloudflare file limits. On this
machine the default disk-backed `dist/` copy became stuck in filesystem I/O,
so `VIBEOS_DIST_ROOT=/dev/shm/vibeos-astro node tooling/check-build.mjs` was
used to verify the finished production-equivalent Astro output.

`tooling/smoke-features.mjs` verifies menu dismissal, mouse theme and pointer
response, clock tooltip, iframe window stacking, browser tab actions, App Manager
install/uninstall and FreeDOS viewport scaling. `--remote-stomp` adds the live
Chrome Canvas relay check. An earlier local production build on November 20
passed strict TypeScript checks, copied 3,815 original assets with matching
SHA-256, and produced 3,855 Cloudflare-compatible files.

## Checks already performed

- `npm run build` and `npm run check` pass, including strict TypeScript checking
  and static asset comparisons. The most recent full build verified 3,815 source
  assets and 3,815 deployed assets by SHA-256, within Cloudflare Pages limits.
- `tooling/parity-browser.mjs` opens the original and the Astro site in Chrome
  at ports 4322 and 4321. It saves screenshots and observations to `.parity/`.
  The harness recognizes both canvas and native DOM versions, and can be run
  with `--size=800x600` or `--size=1920x1080`.
- The native desktop opens Settings, Text Editor, JS Terminal, Wallpaper Picker,
  2048, Tetris, Breakout, vibeBrowser and the DuckDuckGo webview.
  All three embedded HTML games loaded. The v86 emulator booted Floppy Bird.
  The browser checks recorded no JavaScript exceptions.
- The v86 replacement also passed an isolated FreeDOS boot in Chromium with the
  existing BIOS and floppy. The HTML5 emulator now uses the original VM, State,
  Systems, Online, and Games top menus. Its pause icon and status appear in the
  original locations; file state import/export and in-memory Save/Load are present.
  Tests assert FreeDOS boot, then a Floppy Bird boot with 320x200 framebuffer
  rendered at exactly 640x400, including the running state indicator. Streaming
  operating systems and guest networking remain unverified.
- External webviews now attach to the shared Stomp controller rather than loading
  DuckDuckGo or Bing directly. Live Chrome Canvas through STomp was verified by
  `tooling/smoke-features.mjs --remote-stomp`: the iframe had an encoded STomp
  URL, its site title resolved to Canvas, and no runtime console errors appeared.

## Remaining parity work

**Visual fidelity is close but not yet pixel-identical.** The controlled comparison
`tooling/compare-classic.mjs` launches the same apps in the original and new
desktop with menus dismissed. The latest paired screenshots at 1366x768 and
800x600 show these approximate fractions of pixels differing by more than
3 RGB levels:

| State | 1366x768 | 800x600 |
| --- | ---: | ---: |
| Empty desktop | 0.13% | 0.28% |
| Settings | 5.56% | 12.15% |
| JS Terminal | 2.21% | 4.81% |
| Text Editor | 4.34% | 3.90% |
| Wallpaper Picker | 5.76% | 8.70% |
| Floppy Bird VM | 6.19% | 13.58% |

These differences include independently advancing emulator frames, the clock,
and deliberate additions such as the new welcome preference and native window
minimize/maximize buttons. The wallpaper picker now arranges seven thumbnails
per row at standard desktop widths and wraps them on narrower screens, as the
original did. The editor uses the original orange rich-text toggle. The
original canvas screenshots remain the visual reference.

**Behavior still needing coverage:** full navigation across diverse external
websites, all remaining guest operating systems, streamed remote disk images,
guest networking, all editor commands and state-management edge cases.
Many functional operations have been covered: window placement, stacking,
resizing, menus, browser shortcuts, bookmark persistence, tab dragging,
App Manager install/uninstall, emulator game boot, welcome window persistence
and startup settings. The native JS Terminal deliberately evaluates code inside
a sandboxed iframe. The original evaluated code in the desktop global context,
so this remains an intentional behavioral difference.
Cloudflare Pages deep-link fallback has been configured but has not been tested
on a deployed Pages instance. The local Astro preview does not implement that
fallback.

## Next verification

Run `npm install` once, `npm run dev` for development, `npm run build` for the
production output and `npm run preview -- --host 127.0.0.1 --port 4321` for
comparison. Serve the detached original on port 4322, then run
`node tooling/compare-classic.mjs --size=1366x768` and
`node tooling/compare-classic.mjs --size=800x600` to capture synchronized
desktop and app states. Use `node tooling/smoke-welcome.mjs` and
`tooling/smoke-features.mjs` for behavioral checks. The latest strict
TypeScript check and full Astro staging build passed, with 3,815 original
static assets matching by SHA-256 and 3,869 deployed files under Cloudflare
Pages limits. Build staging on this host uses
`npx astro build --outDir /dev/shm/vibeos-astro-final` and
`VIBEOS_DIST_ROOT=/dev/shm/vibeos-astro-final node tooling/check-build.mjs`
because writing to the disk-backed `dist/` has previously stalled.

No Git commits, pushes, rebases or pull requests were made.
