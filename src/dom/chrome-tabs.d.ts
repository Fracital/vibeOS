declare module 'chrome-tabs' {
	interface ChromeTabProperties {
		id?: string;
		title?: string;
		favicon?: string | false;
	}

	export default class ChromeTabs {
		el: HTMLElement;
		styleEl: HTMLStyleElement;
		readonly tabEls: HTMLElement[];
		readonly activeTabEl: HTMLElement | null;
		readonly tabContentEl: HTMLElement;
		readonly tabPositions: number[];
		init(element: HTMLElement): void;
		emit(eventName: string, data: unknown): void;
		setupEvents(): void;
		setupDraggabilly(): void;
		layoutTabs(): void;
		addTab(properties?: ChromeTabProperties, options?: {animate?: boolean; background?: boolean}): void;
		setCurrentTab(tab: HTMLElement): void;
		removeTab(tab: HTMLElement): void;
		updateTab(tab: HTMLElement, properties: ChromeTabProperties): void;
		animateTabMove(tab: HTMLElement, from: number, to: number): void;
	}
}
