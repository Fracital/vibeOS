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

export const iconUrl = (name: string): string => /^(https?:\/\/|\/)/i.test(name) ? name : `/tango/${name}`;
