export interface DesktopWindow {
	element: HTMLElement;
	content: HTMLElement;
	controls: HTMLElement;
	setTitle(title: string): void;
	setIcon(icon: string): void;
	setSize(width: number, height: number): void;
	focus(): void;
	minimize(): void;
	toggleMaximize(): void;
	isMaximized(): boolean;
	bindDrag(handle: HTMLElement): () => void;
	close(): void;
}

export interface WindowSpec {
	title: string;
	icon?: string;
	width?: number;
	height?: number;
	minWidth?: number;
	minHeight?: number;
	position?: 'center';
	x?: number;
	y?: number;
	resizable?: boolean;
	chrome?: boolean;
	render: (window: DesktopWindow) => void | (() => void);
	beforeClose?: () => boolean;
}

export interface DesktopAPI {
	openWindow(spec: WindowSpec): DesktopWindow;
	openWebApp(title: string, url: string, icon?: string, width?: number, height?: number): DesktopWindow;
	openBrowser(url?: string): void;
	openEmulator(profile?: string): void;
	openAppManager(): void;
	installWebApp?(url: string, kind: 'stomp' | 'pwa', doc?: Document | null): Promise<void>;
	changeWallpaper(value: string): void;
	getWallpaper(): string;
}

export interface AppEntry {
	label: string;
	icon: string;
	description?: string;
	action?: () => void;
	children?: AppEntry[];
}

// Embedded in a host page (src/dom/embed.ts, which the host bundles into one module that defines
// __VIBEOS_EMBED__), vibeOS's static files are next to that module, in whatever directory the
// host serves it from, so the base is known only where the module runs. The site serves them
// from its root.
declare const __VIBEOS_EMBED__: boolean | undefined;
// (a module the host made from one file of its own, at a blob: URL, has no directory: its host
// resolves every file, setAssetResolver)
const moduleBase = (): string => {
	try {
		return new URL('./', import.meta.url).pathname;
	} catch {
		return '/';
	}
};
export const assetBase: string = typeof __VIBEOS_EMBED__ !== 'undefined' && __VIBEOS_EMBED__ ? moduleBase() : '/';

// The host's names for vibeOS's own pages that a window shows in a frame ('/appfiles/tetris/index.html'
// to 'a1b2c3d4/'), relative to assetBase: the address the browser keeps for such a frame then
// names neither vibeOS nor the page (BrowserHost.pages)
let assetPages: Readonly<Record<string, string>> = {};
export const setAssetPages = (pages: Readonly<Record<string, string>> | undefined): void => {
	assetPages = {...pages};
};

// A host that serves no directory of vibeOS's (a page in one file, with vibeOS's files inside it)
// names each file's URL itself (BrowserHost.assets): every root-relative path is the host's then,
// including one it does not carry, so no file is ever asked of a directory that is not there
let assetResolver: ((path: string) => string) | null = null;
export const setAssetResolver = (resolve: ((path: string) => string) | undefined): void => {
	assetResolver = resolve ?? null;
};

// a root-relative path of vibeOS's own static files ('/tango/...') as the page must request it
export const assetUrl = (path: string): string =>
	assetResolver && path.startsWith('/') ? assetResolver(path) :
		Object.hasOwn(assetPages, path) ? assetBase + assetPages[path] :
			path.startsWith('/') && !path.startsWith(assetBase) ? assetBase + path.slice(1) : path;

export const iconUrl = (name: string): string => /^(https?:\/\/|data:|blob:)/i.test(name) ? name : name.startsWith('/') ? assetUrl(name) : assetUrl(`/tango/${name}`);

// a proxied frame as Stomp's controller makes it (createFrame)
export interface StompFrame extends EventTarget {
	url: string | null;
	title: string | null;
	canGoBack: boolean | null;
	canGoForward: boolean | null;
	go(url: string): Promise<void>;
	back(): Promise<boolean>;
	forward(): Promise<boolean>;
	reload(): Promise<boolean>;
}

export interface StompControllerInstance {
	frames: StompFrame[];
	wait(): Promise<void>;
	createFrame(element: HTMLIFrameElement): StompFrame;
}

// a tab of the page that hosts the desktop: its live frame element and what it shows. The
// integrated browser shows host tabs instead of making frames of its own, so a tab keeps its
// document (and everything in it) as it moves between the host's view and a window.
export interface HostTab {
	// the frame element that shows the tab's document now (a host may swap it for another)
	readonly element: HTMLIFrameElement;
	url(): string;
	title(): string;
	icon(): string | null;
	loading(): boolean;
	canGoBack(): boolean;
	canGoForward(): boolean;
	navigate(url: string): void;
	back(): void;
	forward(): void;
	reload(hard?: boolean): void;
	stop(): void;
	close(): void;
	// the host closed the tab itself
	closed(): boolean;
	// calls back on every change of what the tab shows, and when its element is replaced
	watch(callback: () => void): () => void;
}

export interface HostFetchInit {
	method?: string;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

// the page that hosts the desktop (src/dom/embed.ts)
export interface BrowserHost {
	controller(): Promise<StompControllerInstance>;
	// a new tab of the host's, loading url
	createTab(url: string): HostTab;
	// the tab is the one the user works in (the host's active tab)
	activate(tab: HostTab): void;
	// the tab's element goes back where the host shows it (before its window closes)
	returnTab(tab: HostTab): void;
	// the host's browser menu, under anchor (its aria-expanded follows the menu): a browser
	// window's menu is the host's own, the same list of items
	openMenu(anchor: HTMLElement): void;
	// a proxied webview that is not a tab (an installed web app's window)
	mountWebview?(iframe: HTMLIFrameElement, url: string): Promise<() => void>;
	// the host's names for vibeOS's pages that windows show in frames (setAssetPages)
	pages?: Readonly<Record<string, string>>;
	// a host that serves no directory of vibeOS's files names each one's URL: a root-relative
	// path ('/tango/...', '/appfiles/tetris/index.html') to the URL the page loads it from, and
	// a URL that loads nothing for a file it does not carry (setAssetResolver)
	assets?: (path: string) => string;
	// the network as the host's proxy reaches it. A desktop with it fetches what it does not
	// carry (the emulator's core, BIOS and disks, src/dom/v86files.ts) through it, so the page
	// itself never asks another site for anything
	fetch?: (url: string, init?: HostFetchInit) => Promise<Response>;
	// the wisp relay the emulator's guest network may use (none: the guest has no network)
	relay?: string | null;
	// the panel button that leaves the desktop for the host's own view
	leaveLabel: string;
	leave(): void;
}
