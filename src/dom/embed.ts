// The desktop inside another page: the STomp web proxy's demo (Fracital/powerMouse, which keeps
// vibeOS as a git submodule) imports this module when its user first switches to vibeOS. The
// host owns the proxy and the tabs; the desktop shows each host tab in a browser window, with the
// tab's own live frame element, and hands the tabs back when the host's view returns.
import { bootDesktop } from './desktop';
import { adoptHostTab, adoptHostWindows, releaseHostTabs, runHostKey } from './browser';
import type { HostKey, HostWindowState, LaunchOptions } from './browser';
import type { BrowserHost, DesktopAPI, HostFetchInit, HostTab } from './types';

export type { BrowserHost, HostFetchInit, HostKey, HostTab };

export interface EmbeddedDesktop {
	readonly root: HTMLElement;
	shown(): boolean;
	// the desktop takes over the page, each tab in a window, `focus`'s window on top
	show(tabs: HostTab[], focus: HostTab | null): void;
	// the tabs go back to the host (HostTab.element back where the host keeps it, by
	// host.returnTab), in their windows' order; the tab of the window on top is `focus`
	hide(): { tabs: HostTab[]; focus: HostTab | null };
	// a tab the host opened while the desktop shows
	adopt(tab: HostTab): void;
	runKey(key: HostKey): void;
}

const cascade = 30;

export function mountDesktop(host: BrowserHost, parent: HTMLElement = document.body): EmbeddedDesktop {
	let root = document.getElementById('vibeos-root');
	if (!root) {
		root = document.createElement('div');
		root.id = 'vibeos-root';
		root.setAttribute('aria-label', 'vibeOS desktop');
		parent.append(root);
	}
	root.hidden = true;
	const desktop = root;
	const api: DesktopAPI | null = bootDesktop(host);
	if (!api) throw new Error('The vibeOS desktop is already running on this page');
	// where each host tab's window was the last time the desktop showed
	const kept = new WeakMap<HostTab, HostWindowState>();
	let shown = false;
	const place = (index: number): LaunchOptions['bounds'] => {
		const width = Math.min(900, window.innerWidth);
		const height = Math.min(620, window.innerHeight - 26);
		const step = (index % 8) * cascade;
		return {
			x: Math.max(0, (window.innerWidth - width) / 2 - 3.5 * cascade + step),
			y: Math.max(26, (window.innerHeight - height) / 2 - 3.5 * cascade + step + 13),
			width,
			height,
		};
	};
	return {
		root: desktop,
		shown: () => shown,
		show(tabs, focus) {
			if (shown) return;
			shown = true;
			desktop.hidden = false;
			const windows: LaunchOptions[] = [];
			const placed = new Set<HostTab>();
			let fresh = 0;
			for (const tab of tabs) {
				if (placed.has(tab)) continue;
				const state = kept.get(tab);
				if (state) {
					// the window it shared with others, those still open and not placed yet
					const group = state.tabs.filter((other) => tabs.includes(other) && !placed.has(other));
					for (const other of group) placed.add(other);
					const active = group.includes(focus as HostTab)
						? focus
						: group.includes(state.active as HostTab)
							? state.active
							: group[0];
					windows.push({ tabs: group, active, bounds: state.bounds, maximized: state.maximized });
				} else {
					placed.add(tab);
					windows.push({ tabs: [tab], active: tab, bounds: place(fresh++) });
				}
			}
			// the window of the focused tab opens last, so it is on top
			const at = windows.findIndex((entry) => entry.tabs?.includes(focus as HostTab));
			if (at >= 0) windows.push(...windows.splice(at, 1));
			adoptHostWindows(api, windows, focus);
		},
		hide() {
			if (!shown) return { tabs: [], focus: null };
			const { windows, focus } = releaseHostTabs();
			for (const state of windows) for (const tab of state.tabs) kept.set(tab, state);
			shown = false;
			desktop.hidden = true;
			return { tabs: windows.flatMap((state) => state.tabs), focus };
		},
		adopt(tab) {
			if (shown) adoptHostTab(api, tab);
		},
		runKey: runHostKey,
	};
}
