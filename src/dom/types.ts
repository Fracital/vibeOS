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

// a host page that embeds the desktop (src/dom/embed.ts) serves vibeOS's static files under a
// directory of its own; the bundler that builds the embedded copy defines __VIBEOS_BASE__
declare const __VIBEOS_BASE__: string | undefined;
export const assetBase: string = typeof __VIBEOS_BASE__ === 'string' ? __VIBEOS_BASE__ : '/';

// a root-relative path of vibeOS's own static files ('/tango/...') as the page must request it
export const assetUrl = (path: string): string => path.startsWith('/') && !path.startsWith(assetBase) ? assetBase + path.slice(1) : path;

export const iconUrl = (name: string): string => /^(https?:\/\/|data:)/i.test(name) ? name : name.startsWith('/') ? assetUrl(name) : `${assetBase}tango/${name}`;

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
	// the panel button that leaves the desktop for the host's own view
	leaveLabel: string;
	leave(): void;
}
