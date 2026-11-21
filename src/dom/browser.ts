// vibeBrowser uses the vendored Stomp proxy in scripts/stomp/.
import 'chrome-tabs/css/chrome-tabs.css';
import './browser.css';
import { VibeChromeTabs } from './chromeTabStrip';
import type { DesktopAPI } from './types';
import { iconUrl } from './types';
import { inspectSite, installSite, installedSites } from './catalog';
import { defaultStompBookmarks, loadBrowserBookmarks, saveBrowserBookmarks } from './bookmarks';
import type { BrowserBookmark } from './bookmarks';

interface StompFrame extends EventTarget {
	url: string | null;
	title: string | null;
	canGoBack: boolean | null;
	canGoForward: boolean | null;
	go(url: string): Promise<void>;
	back(): Promise<boolean>;
	forward(): Promise<boolean>;
	reload(): Promise<boolean>;
}

interface StompControllerInstance {
	frames: StompFrame[];
	wait(): Promise<void>;
	createFrame(element: HTMLIFrameElement): StompFrame;
}

interface StompConstructor {
	new (options: {
		serviceworker: ServiceWorkerRegistration;
		transport: { module: string; options: { wisp: string }[] };
		directory: string;
		codec: string;
		onOpen(url: string, source?: StompFrame): void;
	}): StompControllerInstance;
	register(directory: string): Promise<ServiceWorkerRegistration>;
}

const stompDirectory = '/scripts/stomp/';
const stompRelay = 'wss://holywisp.fracit.al/';
let controllerPromise: Promise<StompControllerInstance> | null = null;
let controllerScriptPromise: Promise<void> | null = null;
let openFromProxy: (url: string, source?: StompFrame) => void = () => {};
const frameOpeners = new WeakMap<StompFrame, (url: string) => void>();
const browserWindows = new Set<{ element: HTMLElement; openTab(url: string): void }>();

function getStomp(): StompConstructor | undefined {
	return (window as Window & { StompController?: StompConstructor }).StompController;
}

function ensureStompScript(): Promise<void> {
	if (getStomp()) return Promise.resolve();
	if (controllerScriptPromise) return controllerScriptPromise;
	controllerScriptPromise = new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = `${stompDirectory}Controller.js`;
		script.onload = () => getStomp() ? resolve() : reject(new Error('Stomp controller did not load'));
		script.onerror = () => reject(new Error('Stomp controller script is missing'));
		document.head.appendChild(script);
	}).catch((error: unknown) => {
		controllerScriptPromise = null;
		throw error;
	});
	return controllerScriptPromise;
}

function getController(): Promise<StompControllerInstance> {
	if (controllerPromise) return controllerPromise;
	controllerPromise = (async () => {
		if (!window.isSecureContext || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) {
			throw new Error('Web browsing requires HTTPS or localhost for its service worker');
		}
		await ensureStompScript();
		const Constructor = getStomp();
		if (!Constructor) throw new Error('Stomp controller is unavailable');
		const registration = await Constructor.register(stompDirectory);
		const controller = new Constructor({
			serviceworker: registration,
			transport: { module: `${stompDirectory}epoxy/index.mjs`, options: [{ wisp: stompRelay }] },
			directory: stompDirectory,
			codec: 'xor',
			onOpen: (url, source) => openFromProxy(url, source),
		});
		await controller.wait();
		return controller;
	})().catch((error: unknown) => {
		controllerPromise = null;
		throw error;
	});
	return controllerPromise;
}

// External webview windows share the same Stomp controller and transport as vibeBrowser.
// A direct remote iframe would bypass the proxy and often fail to render at all.
export async function mountProxiedWebview(
	iframe: HTMLIFrameElement,
	url: string,
	isActive: () => boolean,
): Promise<() => void> {
	const controller = await getController();
	if(!isActive())return () => {};
	const frame = controller.createFrame(iframe);
	let detached = false;
	const detach = (): void => {
		if(detached)return;
		detached = true;
		const index = controller.frames.indexOf(frame);
		if(index !== -1)controller.frames.splice(index, 1);
	};
	try {
		await frame.go(url);
		if(!isActive())detach();
		return detach;
	}catch(error) {
		detach();
		throw error;
	}
}

function resolveAddress(text: string): string | null {
	const input = text.trim();
	if (!input) return null;
	if (/^https?:\/\//i.test(input)) {
		try {
			const url = new URL(input);
			return /^https?:$/.test(url.protocol) ? url.href : null;
		} catch {
			return null;
		}
	}
	if (input.startsWith('/')) return new URL(input, location.origin).href;
	if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(input)) return `http://${input}`;
	if (/^[^\s/]+\.[^\s]+(?::\d+)?(?:\/\S*)?$/i.test(input)) return `https://${input}`;
	return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
}

function toolButton(label: string, icon: string): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'vibe-browser-tool';
	button.title = label;
	button.setAttribute('aria-label', label);
	const image = document.createElement('img');
	image.src = iconUrl(icon);
	image.alt = '';
	image.width = 16;
	image.height = 16;
	button.appendChild(image);
	return button;
}

interface BrowserTab {
	id: number;
	button: HTMLElement;
	label: HTMLElement;
	icon: HTMLElement;
	close: HTMLElement;
	panel: HTMLElement;
	iframe: HTMLIFrameElement;
	home: HTMLElement;
	notice: HTMLElement;
	frame: StompFrame | null;
	owner: StompControllerInstance | null;
	connection: Promise<StompFrame | null> | null;
	frameNavigate: EventListener | null;
	frameLoad: EventListener | null;
	bridgeLoad: EventListener | null;
	innerDocument: Document | null;
	url: string | null;
	title: string;
	favicon: string;
	request: number;
	metadataRequest: number;
	closed: boolean;
}

const browserFallbackIcon = iconUrl('apps/16/internet-web-browser.png');
let nextBrowserTabId = 0;

const bookmarkIcon = (bookmark: BrowserBookmark): string => {
	try {
		if(/(^|\.)youtube\.com$/i.test(new URL(bookmark.url).hostname))return '/icons/youtube.svg';
	}catch {
		// Keep the bookmarked favicon if its URL is no longer parsable.
	}
	return bookmark.icon;
};

function tabDocument(tab: BrowserTab): Document | null {
	try {
		return tab.iframe.contentDocument?.body ? tab.iframe.contentDocument : null;
	} catch {
		return null;
	}
}

function siteIcon(value: unknown, pageUrl: string): string {
	if (typeof value !== 'string' || !value.trim()) return browserFallbackIcon;
	try {
		if (value.startsWith('/tango/') || value.startsWith('/stomp-bookmarks/icons/')) return value;
		if (/^(?:apps|actions|status|mimetypes)\//.test(value)) return iconUrl(value);
		if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)) return value;
		const parsed = new URL(value, pageUrl);
		return /^https?:$/.test(parsed.protocol) ? parsed.href : browserFallbackIcon;
	} catch {
		return browserFallbackIcon;
	}
}

function browserButton(label: string, icon: string): HTMLButtonElement {
	const button = toolButton(label, icon);
	button.classList.add('vibe-browser-nav');
	return button;
}

export function launchBrowser(api: DesktopAPI, url?: string): void {
	openFromProxy = (target, source) => {
		const opener = source ? frameOpeners.get(source) : undefined;
		if (opener) {
			opener(target);
			return;
		}
		for (const browser of [...browserWindows].reverse()) {
			if (browser.element.classList.contains('vo-active')) {
				browser.openTab(target);
				return;
			}
		}
		api.openBrowser(target);
	};
	api.openWindow({
		title: 'vibeBrowser',
		icon: 'apps/24/internet-web-browser.png',
		chrome: true,
		width: 900,
		height: 600,
		position: 'center',
		minWidth: 360,
		minHeight: 220,
		render: (win) => {
			const root = document.createElement('div');
			root.className = 'vibe-browser';
			const tabStrip = document.createElement('div');
			tabStrip.className = 'vibe-browser-tabstrip';
			const tabList = document.createElement('div');
			tabList.className = 'vibe-browser-tablist chrome-tabs';
			const tabContent = document.createElement('div');
			tabContent.className = 'chrome-tabs-content';
			tabContent.setAttribute('role', 'tablist');
			tabContent.setAttribute('aria-label', 'Browser tabs');
			tabList.append(tabContent);
			const add = document.createElement('button');
			add.type = 'button';
			add.className = 'vibe-browser-new-tab';
			add.textContent = '+';
			add.title = 'New tab (Ctrl+T)';
			add.setAttribute('aria-label', 'New tab');
			// Reuse the exact window-manager controls, rather than create browser buttons.
			tabStrip.append(tabList, add, win.controls);
			const stopDrag = win.bindDrag(tabList);
			tabList.addEventListener('dblclick', (event) => {
				if(!(event.target instanceof Element) || !event.target.closest('.chrome-tab'))win.toggleMaximize();
			});

			const toolbar = document.createElement('form');
			toolbar.className = 'vibe-browser-toolbar';
			const back = browserButton('Back', 'actions/16/go-previous.png');
			const forward = browserButton('Forward', 'actions/16/go-next.png');
			const reload = browserButton('Reload', 'actions/16/view-refresh.png');
			const address = document.createElement('input');
			address.type = 'text';
			address.className = 'vibe-browser-address';
			address.autocomplete = 'off';
			address.spellcheck = false;
			address.placeholder = 'Search or enter an address';
			address.setAttribute('aria-label', 'Address or search');
			const star = document.createElement('button');
			star.type = 'button';
			star.className = 'vibe-browser-star';
			star.textContent = '☆';
			star.title = 'Bookmark this page';
			star.setAttribute('aria-label', 'Bookmark this page');
			const menuWrap = document.createElement('div');
			menuWrap.className = 'vibe-browser-menu-wrap';
			const menuToggle = document.createElement('button');
			menuToggle.type = 'button';
			menuToggle.className = 'vibe-browser-menu-toggle';
			menuToggle.textContent = '⚙';
			menuToggle.title = 'Page and application options';
			menuToggle.setAttribute('aria-label', 'Page and application options');
			menuToggle.setAttribute('aria-haspopup', 'menu');
			menuToggle.setAttribute('aria-expanded', 'false');
			const menu = document.createElement('div');
			menu.className = 'vibe-browser-menu';
			menu.setAttribute('role', 'menu');
			menu.hidden = true;
			const installStomp = document.createElement('button');
			installStomp.type = 'button';
			installStomp.textContent = 'Install STomp app';
			installStomp.setAttribute('role', 'menuitem');
			const installPwa = document.createElement('button');
			installPwa.type = 'button';
			installPwa.textContent = 'Install PWA';
			installPwa.setAttribute('role', 'menuitem');
			const external = document.createElement('button');
			external.type = 'button';
			external.textContent = 'Open in browser';
			external.setAttribute('role', 'menuitem');
			const menuStatus = document.createElement('div');
			menuStatus.className = 'vibe-browser-menu-status';
			menuStatus.setAttribute('role', 'status');
			menuStatus.hidden = true;
			menu.append(installStomp, installPwa, external, menuStatus);
			menuWrap.append(menuToggle, menu);
			toolbar.append(back, forward, reload, address, star, menuWrap);

			const bookmarksBar = document.createElement('div');
			bookmarksBar.className = 'vibe-browser-bookmarks';
			bookmarksBar.setAttribute('aria-label', 'Bookmarks');
			const display = document.createElement('div');
			display.className = 'vibe-browser-display';
			root.append(tabStrip, toolbar, bookmarksBar, display);
			win.content.appendChild(root);

			const chromeTabs = new VibeChromeTabs();
			chromeTabs.init(tabList);
			const layoutObserver = new ResizeObserver(() => {
				chromeTabs.cancelDrag();
				chromeTabs.layoutTabs();
			});
			layoutObserver.observe(tabList);
			const tabs: BrowserTab[] = [];
			let active: BrowserTab | null = null;
			let closed = false;
			let bookmarks = loadBrowserBookmarks();
			const recentlyClosed: Array<{url: string; title: string; icon: string}> = [];
			let draggedBookmark: string | null = null;
			const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
			const syncTabOrder = () => {
				const positions = chromeTabs.tabEls;
				tabs.sort((a, b) => positions.indexOf(a.button) - positions.indexOf(b.button));
			};
			const moveTab = (moving: BrowserTab, destination: number): boolean => {
				const oldIndex = tabs.indexOf(moving);
				const targetIndex = Math.max(0, Math.min(tabs.length - 1, destination));
				if(oldIndex < 0 || targetIndex === oldIndex || moving.closed)return false;
				chromeTabs.animateTabMove(moving.button, oldIndex, targetIndex);
				return true;
			};
			tabList.addEventListener('tabReorder', syncTabOrder);
			const openGesture = (event: MouseEvent, destination: string): boolean => {
				if(event.button !== 1 && !event.ctrlKey && !event.metaKey && !event.shiftKey)return false;
				const url = resolveAddress(destination);
				if(!url)return false;
				event.preventDefault();
				event.stopPropagation();
				if(event.shiftKey && !event.ctrlKey && !event.metaKey){
					api.openBrowser(url);
				}else{
					const foreground = event.shiftKey && (event.ctrlKey || event.metaKey);
					createTab(url, foreground);
				}
				return true;
			};
			const bindDestination = (node: HTMLElement, destination: string, onNormal: () => void): void => {
				node.addEventListener('click', (event) => {
					if(!openGesture(event, destination))onNormal();
				});
				node.addEventListener('auxclick', (event) => {
					if(event.button === 1)openGesture(event, destination);
				});
				node.addEventListener('mousedown', (event) => {
					if(event.button === 1)event.preventDefault();
				});
			};

			const makeEntry = (title: string, icon: string, action: () => void, link?: string): HTMLButtonElement => {
				const button = document.createElement('button');
				button.type = 'button';
				const image = document.createElement('img');
				image.alt = '';
				image.src = icon;
				image.draggable = false;
				image.onerror = () => { image.onerror = null; image.src = browserFallbackIcon; };
				const caption = document.createElement('span');
				caption.textContent = title;
				button.append(image, caption);
				if(link)bindDestination(button, link, action);
				else button.addEventListener('click', action);
				return button;
			};
			const updateMenu = (open: boolean) => {
				menu.hidden = !open;
				menuToggle.setAttribute('aria-expanded', String(open));
				if (open) {
					menuStatus.hidden = true;
					menuStatus.textContent = '';
				}
			};
			const activeUrl = (): string | null => active?.frame?.url || active?.url || null;
			const renderBookmarks = () => {
				bookmarksBar.replaceChildren();
				for (const bookmark of bookmarks) {
					const button = makeEntry(bookmark.title, bookmarkIcon(bookmark), () => {
						if(active)void navigate(active, bookmark.url);
						else createTab(bookmark.url);
					}, bookmark.url);
					button.title = bookmark.description ? `${bookmark.title}\n${bookmark.description}\n${bookmark.url}` : bookmark.url;
					button.classList.add('vibe-browser-bookmark');
					button.dataset.bookmarkUrl = bookmark.url;
					button.draggable = true;
					button.addEventListener('dragstart', (event) => {
						draggedBookmark = bookmark.url;
						button.classList.add('vibe-browser-dragging-bookmark');
						if(event.dataTransfer){
							event.dataTransfer.effectAllowed = 'move';
							event.dataTransfer.setData('application/x-vibeos-bookmark', bookmark.url);
							event.dataTransfer.setData('text/uri-list', bookmark.url);
						}
					});
					button.addEventListener('dragover', (event) => {
						if(!draggedBookmark || draggedBookmark === bookmark.url)return;
						event.preventDefault();
						if(event.dataTransfer)event.dataTransfer.dropEffect = 'move';
						button.classList.add('vibe-browser-bookmark-over');
					});
					button.addEventListener('dragleave', () => button.classList.remove('vibe-browser-bookmark-over'));
					button.addEventListener('drop', (event) => {
						if(!draggedBookmark || draggedBookmark === bookmark.url)return;
						event.preventDefault();
						event.stopPropagation();
						const from = bookmarks.findIndex((item) => item.url === draggedBookmark);
						if(from === -1)return;
						const [moving] = bookmarks.splice(from, 1);
						const to = bookmarks.findIndex((item) => item.url === bookmark.url);
						const after = event.clientX > button.getBoundingClientRect().left + button.offsetWidth / 2;
						bookmarks.splice(to + (after ? 1 : 0), 0, moving);
						draggedBookmark = null;
						saveBrowserBookmarks(bookmarks);
						renderBookmarks();
					});
					button.addEventListener('dragend', () => {
						draggedBookmark = null;
						button.classList.remove('vibe-browser-dragging-bookmark', 'vibe-browser-bookmark-over');
					});
					bookmarksBar.append(button);
				}
			};
			bookmarksBar.addEventListener('dragover', (event) => {
				if(!draggedBookmark)return;
				event.preventDefault();
				if(event.dataTransfer)event.dataTransfer.dropEffect = 'move';
			});
			bookmarksBar.addEventListener('drop', (event) => {
				if(!draggedBookmark)return;
				if(event.target instanceof Element && event.target.closest('.vibe-browser-bookmark'))return;
				event.preventDefault();
				const from = bookmarks.findIndex((item) => item.url === draggedBookmark);
				if(from < 0)return;
				const [moving] = bookmarks.splice(from, 1);
				bookmarks.push(moving);
				draggedBookmark = null;
				saveBrowserBookmarks(bookmarks);
				renderBookmarks();
			});
			const updateActive = (force = false) => {
				if (closed || !active) return;
				const current = activeUrl();
				if (force || document.activeElement !== address) address.value = current ?? '';
				back.disabled = active.frame?.canGoBack !== true;
				forward.disabled = active.frame?.canGoForward !== true;
				reload.disabled = !current || !active.frame;
				star.disabled = !current;
				const saved = !!current && bookmarks.some(item => item.url === current);
				star.textContent = saved ? '★' : '☆';
				star.title = saved ? 'Remove bookmark' : 'Bookmark this page';
				star.setAttribute('aria-label', star.title);
				installStomp.disabled = !current;
				installPwa.disabled = !current;
				external.disabled = !current;
				win.setTitle(active.title === 'New Tab' ? 'New Tab - vibeBrowser' : active.title + ' - vibeBrowser');
			};
			const updateTab = (tab: BrowserTab) => {
				chromeTabs.updateTab(tab.button, {title: tab.title, favicon: tab.favicon});
				tab.button.title = tab.title;
				if (tab === active) updateActive();
			};
			const refreshMetadata = async (tab: BrowserTab) => {
				const current = tab.frame?.url || tab.url;
				if (!current || tab.closed) return;
				const request = ++tab.metadataRequest;
				const document = tabDocument(tab);
				try {
					const info = await inspectSite(current, document);
					if (closed || tab.closed || request !== tab.metadataRequest || (tab.frame?.url || tab.url) !== current) return;
					const metadata = info as unknown as Record<string, unknown>;
					if (typeof metadata.title === 'string' && metadata.title.trim()) tab.title = metadata.title.trim().slice(0, 160);
					tab.favicon = siteIcon(metadata.icon ?? metadata.favicon, current);
					updateTab(tab);
				} catch {
					// A failed metadata fetch must not interrupt navigation.
				}
			};
			const setNotice = (tab: BrowserTab, message: string) => {
				tab.notice.textContent = message;
				tab.notice.hidden = !message;
			};
			const syncFrame = (tab: BrowserTab, inspect = false) => {
				if (closed || tab.closed || !tab.frame) return;
				const current = tab.frame.url;
				if (current) {
					if (current !== tab.url) tab.metadataRequest++;
					tab.url = current;
					tab.home.hidden = true;
					tab.iframe.hidden = false;
				}
				if (tab.frame.title) tab.title = tab.frame.title.slice(0, 160);
				updateTab(tab);
				if (inspect) void refreshMetadata(tab);
			};
			const onFrameLinkGesture = (event: MouseEvent): void => {
				if(event.button !== 1 && !event.ctrlKey && !event.metaKey && !event.shiftKey)return;
				const document = event.currentTarget;
				const tab = tabs.find((item) => item.innerDocument === document);
				const target = event.target as Element | null;
				if(!tab || tab.closed || !target || typeof target.closest !== 'function')return;
				const anchor = target.closest('a[href], area[href]');
				if(!anchor || anchor.hasAttribute('download'))return;
				const raw = anchor.getAttribute('href');
				if(!raw || raw.startsWith('#'))return;
				try {
					const base = tab.frame?.url || tab.url || tab.iframe.contentDocument?.baseURI || location.href;
					const destination = new URL(raw, base);
					if(!['http:', 'https:'].includes(destination.protocol))return;
					if(openGesture(event, destination.href))event.stopImmediatePropagation();
				}catch {
					// Invalid links retain the proxied page's default behavior.
				}
			};
			const onFrameMiddleDown = (event: MouseEvent): void => {
				const target = event.target as Element | null;
				if(event.button === 1 && target && typeof target.closest === 'function' && target.closest('a[href], area[href]')){
					event.preventDefault();
				}
			};
			const attachDocument = (tab: BrowserTab) => {
				if (tab.innerDocument) {
					try {
						tab.innerDocument.removeEventListener('keydown', onShortcut, true);
						tab.innerDocument.removeEventListener('pointerdown', onFramePointer, true);
						tab.innerDocument.removeEventListener('click', onFrameLinkGesture, true);
						tab.innerDocument.removeEventListener('auxclick', onFrameLinkGesture, true);
						tab.innerDocument.removeEventListener('mousedown', onFrameMiddleDown, true);
					} catch {
						// The frame may have navigated away since the last load.
					}
					tab.innerDocument = null;
				}
				const doc = tabDocument(tab);
				if (!doc) return;
				tab.innerDocument = doc;
				doc.addEventListener('keydown', onShortcut, true);
				doc.addEventListener('pointerdown', onFramePointer, true);
				doc.addEventListener('click', onFrameLinkGesture, true);
				doc.addEventListener('auxclick', onFrameLinkGesture, true);
				doc.addEventListener('mousedown', onFrameMiddleDown, true);
			};
			const connect = (tab: BrowserTab): Promise<StompFrame | null> => {
				if (tab.frame) return Promise.resolve(tab.frame);
				if (tab.connection) return tab.connection;
				tab.connection = (async () => {
					const controller = await getController();
					if (closed || tab.closed) return null;
					if (tab.frame) return tab.frame;
					const frame = controller.createFrame(tab.iframe);
					tab.frame = frame;
					tab.owner = controller;
					frameOpeners.set(frame, target => createTab(target));
					tab.frameNavigate = () => {
						syncFrame(tab, true);
						setNotice(tab, '');
					};
					frame.addEventListener('navigate', tab.frameNavigate);
					tab.frameLoad = () => {
						attachDocument(tab);
						syncFrame(tab, true);
						setNotice(tab, '');
					};
					tab.iframe.addEventListener('load', tab.frameLoad);
					if (tab === active) updateActive();
					return frame;
				})().catch((error: unknown) => {
					tab.connection = null;
					throw error;
				});
				return tab.connection;
			};
			const navigate = async (tab: BrowserTab, target: string) => {
				if (closed || tab.closed) return;
				const request = ++tab.request;
				tab.button.classList.add('is-loading');
				tab.metadataRequest++;
				tab.url = target;
				tab.title = new URL(target).hostname || target;
				tab.favicon = browserFallbackIcon;
				tab.home.hidden = true;
				tab.iframe.hidden = false;
				setNotice(tab, 'Connecting to the web proxy...');
				updateTab(tab);
				if (tab === active) updateActive(true);
				try {
					const frame = await connect(tab);
					if (!frame || closed || tab.closed || request !== tab.request) return;
					setNotice(tab, 'Loading page...');
					await frame.go(target);
					if (closed || tab.closed || request !== tab.request) return;
					syncFrame(tab, true);
					setNotice(tab, '');
				} catch (error) {
					if (!closed && !tab.closed && request === tab.request) {
						setNotice(tab, 'Could not load page: ' + String(error instanceof Error ? error.message : error));
					}
				} finally {
					if(request === tab.request)tab.button.classList.remove('is-loading');
				}
			};
			const switchTab = (tab: BrowserTab) => {
				if (closed || tab.closed) return;
				active = tab;
				if(chromeTabs.activeTabEl !== tab.button)chromeTabs.setCurrentTab(tab.button);
				for (const entry of tabs) {
					const selected = entry === tab;
					entry.panel.hidden = !selected;
					entry.button.setAttribute('aria-selected', String(selected));
					entry.button.tabIndex = selected ? 0 : -1;
				}
				updateMenu(false);
				updateActive(true);
				win.focus();
			};
			const closeTab = (tab: BrowserTab, alreadyRemoved = false) => {
				if (tab.closed) return;
				if (tabs.length === 1) {
					win.close();
					return;
				}
				const lastUrl = tab.frame?.url || tab.url;
				if(lastUrl && /^https?:\/\//i.test(lastUrl)){
					recentlyClosed.unshift({url: lastUrl, title: tab.title, icon: tab.favicon});
					recentlyClosed.splice(8);
				}
				const index = tabs.indexOf(tab);
				tab.closed = true;
				tab.request++;
				tab.metadataRequest++;
				if (tab.innerDocument) {
					try {
						tab.innerDocument.removeEventListener('keydown', onShortcut, true);
						tab.innerDocument.removeEventListener('pointerdown', onFramePointer, true);
						tab.innerDocument.removeEventListener('click', onFrameLinkGesture, true);
						tab.innerDocument.removeEventListener('auxclick', onFrameLinkGesture, true);
						tab.innerDocument.removeEventListener('mousedown', onFrameMiddleDown, true);
					} catch {
						// The frame may have already navigated.
					}
				}
				if (tab.frame) {
					frameOpeners.delete(tab.frame);
					if (tab.frameNavigate) tab.frame.removeEventListener('navigate', tab.frameNavigate);
					const ownerIndex = tab.owner?.frames.indexOf(tab.frame) ?? -1;
					if (ownerIndex !== -1) tab.owner?.frames.splice(ownerIndex, 1);
				}
				if (tab.frameLoad) tab.iframe.removeEventListener('load', tab.frameLoad);
				if (tab.bridgeLoad) tab.iframe.removeEventListener('load', tab.bridgeLoad);
				tab.iframe.src = 'about:blank';
				if(!alreadyRemoved)chromeTabs.removeTab(tab.button);
				tab.panel.remove();
				// Cancelling a drag can emit tabReorder and sort the model during
				// removeTab. Never splice using the earlier, now-stale index.
				const currentIndex = tabs.indexOf(tab);
				if(currentIndex >= 0)tabs.splice(currentIndex, 1);
				syncTabOrder();
				if(active === tab || active?.closed) switchTab(tabs[Math.min(index, tabs.length - 1)]);
				for(const other of tabs)if(!other.url && !other.closed)void renderHome(other);
			};
			tabList.addEventListener('activeTabChange', (event: Event) => {
				const element = (event as CustomEvent<{tabEl: HTMLElement}>).detail.tabEl;
				const tab = tabs.find((entry) => entry.button === element);
				if(tab && tab !== active)switchTab(tab);
			});
			tabList.addEventListener('tabRemove', (event: Event) => {
				const element = (event as CustomEvent<{tabEl: HTMLElement}>).detail.tabEl;
				const tab = tabs.find((entry) => entry.button === element);
				if(tab && !tab.closed)closeTab(tab, true);
			});
			const renderHome = async (tab: BrowserTab) => {
				const page = document.createElement('div');
				page.className = 'vibe-browser-newtab-page';
				const header = document.createElement('header');
				header.className = 'vibe-browser-apps-header';
				const heading = document.createElement('h1');
				heading.textContent = 'Apps';
				const subtitle = document.createElement('p');
				subtitle.textContent = 'Your apps and STomp shortcuts';
				header.append(heading, subtitle);
				const grid = document.createElement('div');
				grid.className = 'vibe-browser-app-grid';
				grid.setAttribute('role', 'group');
				grid.setAttribute('aria-label', 'Installed apps and web shortcuts');
				const builtinUrls = new Set(defaultStompBookmarks.map((bookmark) => bookmark.url));
				const shortcuts = [
					...defaultStompBookmarks,
					...bookmarks.filter((bookmark) => !builtinUrls.has(bookmark.url)),
				];
				for(const bookmark of shortcuts){
					const link = makeEntry(bookmark.title, bookmarkIcon(bookmark), () => void navigate(tab, bookmark.url), bookmark.url);
					link.className = 'vibe-browser-app-tile';
					link.title = bookmark.description || bookmark.url;
					grid.append(link);
				}
				const footer = document.createElement('footer');
				footer.className = 'vibe-browser-apps-footer';
				const pageDot = document.createElement('span');
				pageDot.className = 'vibe-browser-apps-page-dot';
				pageDot.setAttribute('aria-label', 'Apps page');
				const pageName = document.createElement('span');
				pageName.textContent = 'Apps';
				footer.append(pageDot, pageName);
				page.append(header, grid, footer);
				tab.home.replaceChildren(page);
				try {
					const entries = await installedSites();
					if(closed || tab.closed || tab.url)return;
					for(const entry of entries){
						const destination = resolveAddress(entry.startUrl || entry.url);
						if(!destination)continue;
						const linkIcon = siteIcon(entry.icon, destination);
						const tile = makeEntry(entry.title, linkIcon, () => void navigate(tab, destination), destination);
						tile.className = 'vibe-browser-app-tile';
						tile.title = entry.description || destination;
						grid.append(tile);
					}
				} catch {
					const message = document.createElement('p');
					message.className = 'vibe-browser-app-empty';
					message.textContent = 'Installed apps are temporarily unavailable.';
					grid.append(message);
				}
			};
			const createTab = (target?: string, foreground = true) => {
				if (closed) return;
				const id = ++nextBrowserTabId;
				chromeTabs.addTab({id: String(id), title: 'New Tab', favicon: browserFallbackIcon}, {
					animate: !reducedMotion.matches, background: true,
				});
				const button = chromeTabs.tabEls.at(-1);
				if(!button)throw new Error('Chrome Tabs did not create its tab');
				button.classList.add('vibe-browser-tab');
				button.id = 'vibe-browser-tab-' + id;
				button.setAttribute('role', 'tab');
				button.setAttribute('aria-selected', 'false');
				button.tabIndex = -1;
				const icon = button.querySelector<HTMLElement>('.chrome-tab-favicon');
				const label = button.querySelector<HTMLElement>('.chrome-tab-title');
				const close = button.querySelector<HTMLElement>('.chrome-tab-close');
				if(!icon || !label || !close)throw new Error('Chrome Tabs template is incomplete');
				close.classList.add('vibe-browser-tab-close');
				close.setAttribute('role', 'button');
				close.tabIndex = 0;
				close.title = 'Close tab (Ctrl+W)';
				close.setAttribute('aria-label', 'Close tab');
				const panel = document.createElement('div');
				panel.className = 'vibe-browser-panel';
				panel.id = 'vibe-browser-panel-' + id;
				panel.hidden = true;
				button.setAttribute('aria-controls', panel.id);
				const iframe = document.createElement('iframe');
				iframe.className = 'vibe-browser-frame';
				iframe.title = 'Browser tab';
				iframe.referrerPolicy = 'no-referrer';
				iframe.hidden = true;
				const home = document.createElement('div');
				home.className = 'vibe-browser-home';
				const notice = document.createElement('div');
				notice.className = 'vibe-browser-message';
				notice.setAttribute('role', 'status');
				notice.hidden = true;
				panel.append(iframe, home, notice);
				const tab: BrowserTab = {
					id, button, label, icon, close, panel, iframe, home, notice,
					frame: null, owner: null, connection: null, frameNavigate: null, frameLoad: null, bridgeLoad: null,
					innerDocument: null, url: null, title: 'New Tab',
					favicon: browserFallbackIcon, request: 0, metadataRequest: 0, closed: false,
				};
				tab.bridgeLoad = () => attachDocument(tab);
				iframe.addEventListener('load', tab.bridgeLoad);
				tabs.push(tab);
				display.append(panel);
				button.addEventListener('click', (event) => {
					if(event.target instanceof Element && event.target.closest('.chrome-tab-close'))return;
					switchTab(tab);
				});
				button.addEventListener('auxclick', (event) => {
					if(event.button !== 1)return;
					event.preventDefault();
					event.stopPropagation();
					closeTab(tab);
				});
				button.addEventListener('dragover', (event) => {
					if(event.dataTransfer?.types.includes('text/uri-list'))event.preventDefault();
				});
				button.addEventListener('drop', (event) => {
					const raw = event.dataTransfer?.getData('text/uri-list');
					const destination = raw ? resolveAddress(raw) : null;
					if(!destination)return;
					event.preventDefault();
					switchTab(tab);
					void navigate(tab, destination);
				});
				button.addEventListener('keydown', (event) => {
					if(event.target !== button)return;
					if(event.key === 'Enter' || event.key === ' '){
						event.preventDefault();
						switchTab(tab);
					}
				});
				// Intercept before the package's bubbling close handler so the
				// app can dispose its STomp frame before removing the tab.
				close.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopImmediatePropagation();
					closeTab(tab);
				}, true);
				close.addEventListener('keydown', (event) => {
					if(event.key !== 'Enter' && event.key !== ' ')return;
					event.preventDefault();
					event.stopPropagation();
					closeTab(tab);
				});
				if(foreground || !active)switchTab(tab);
				void connect(tab).catch((error: unknown) => {
					if (!tab.closed && !target) setNotice(tab, 'Web proxy unavailable: ' + String(error instanceof Error ? error.message : error));
				});
				if (target) {
					const destination = resolveAddress(target);
					if (destination) void navigate(tab, destination);
					else void renderHome(tab);
				} else {
					void renderHome(tab);
					if(foreground)address.focus();
				}
				return tab;
			};
			const onFramePointer = () => {
				win.focus();
			};
			let pageZoom = 1;
			const applyPageZoom = () => {
				for(const tab of tabs){
					if(pageZoom === 1)tab.home.style.removeProperty('zoom');
					else tab.home.style.zoom = String(pageZoom);
					if(pageZoom === 1 && tab.home.style.length === 0)tab.home.removeAttribute('style');
					try {
						const doc = tabDocument(tab);
						if(doc){
							if(pageZoom === 1)doc.documentElement.style.removeProperty('zoom');
							else doc.documentElement.style.zoom = String(pageZoom);
						}
					}catch {
						// Proxied documents may not expose their DOM until navigation completes.
					}
				}
				if(pageZoom === 1){
					for(const node of [root, ...root.querySelectorAll<HTMLElement>('.vibe-browser-display, .vibe-browser-panel, .vibe-browser-frame')]){
						if(node.style.length === 0)node.removeAttribute('style');
					}
				}
			};
			const onShortcut = (event: KeyboardEvent) => {
				if (closed || !win.element.classList.contains('vo-active'))return;
				if (event.currentTarget === document && document.activeElement !== document.body && !win.element.contains(document.activeElement)) return;
				const key = event.key.toLowerCase();
				const ctrl = event.ctrlKey || event.metaKey;
				const handled = () => {
					event.preventDefault();
					event.stopPropagation();
				};
				if(key === 'escape' && !ctrl && !event.altKey){
					if(!menu.hidden){handled();updateMenu(false);}
					return;
				}
				if(key === 'f5' && !ctrl){handled();void command('reload');return;}
				if(event.altKey && !ctrl){
					if(key === 'd'){handled();address.focus();address.select();}
					else if(key === 'arrowleft'){handled();void command('back');}
					else if(key === 'arrowright'){handled();void command('forward');}
					return;
				}
				if(!ctrl || event.altKey)return;
				if(key === 't' && event.shiftKey){
					handled();
					const last = recentlyClosed.shift();
					if(last)createTab(last.url);
				}else if(key === 't'){
					handled();
					createTab();
				}else if(key === 'n' && !event.shiftKey){
					handled();
					api.openBrowser();
				}else if(key === 'w' && active){
					handled();
					closeTab(active);
				}else if(key === 'tab' && active && tabs.length > 1){
					handled();
					syncTabOrder();
					const index = tabs.indexOf(active);
					switchTab(tabs[(index + tabs.length + (event.shiftKey ? -1 : 1)) % tabs.length]);
				}else if(event.shiftKey && (key === 'pageup' || key === 'pagedown') && active){
					handled();
					syncTabOrder();
					moveTab(active, tabs.indexOf(active) + (key === 'pageup' ? -1 : 1));
				}else if(key >= '1' && key <= '9' && !event.shiftKey){
					handled();
					syncTabOrder();
					const index = key === '9' ? tabs.length - 1 : Math.min(tabs.length - 1, Number(key) - 1);
					if(tabs[index])switchTab(tabs[index]);
				}else if(key === 'l' || key === 'k'){
					handled();
					address.focus();
					if(key === 'l')address.select();
					else address.value = '';
				}else if(key === 'r'){
					handled();
					void command('reload');
				}else if(key === 'd' && activeUrl()){
					handled();
					star.click();
				}else if(key === 'b' && event.shiftKey){
					handled();
					bookmarksBar.hidden = !bookmarksBar.hidden;
				}else if(['+', '=', '-', '_', '0'].includes(key)){
					handled();
					pageZoom = key === '0' ? 1 : Math.min(2, Math.max(0.5, Math.round((pageZoom + (key === '-' || key === '_' ? -0.1 : 0.1)) * 10) / 10));
					applyPageZoom();
				}
			};
			const navigateCurrent = () => {
				const destination = resolveAddress(address.value);
				if (active && destination) void navigate(active, destination);
			};
			const command = async (name: 'back' | 'forward' | 'reload') => {
				const tab = active;
				if (!tab?.frame) return;
				try {
					await tab.frame[name]();
					syncFrame(tab, true);
				} catch (error) {
					if (!tab.closed) setNotice(tab, 'Navigation failed: ' + String(error instanceof Error ? error.message : error));
				}
			};
			const install = async (kind: 'stomp' | 'pwa') => {
				const tab = active;
				const current = activeUrl();
				if (!tab || !current) return;
				const doc = tabDocument(tab);
				installStomp.disabled = true;
				installPwa.disabled = true;
				menuStatus.hidden = false;
				menuStatus.textContent = 'Installing...';
				try {
					const host = api as DesktopAPI & { installWebApp?: (target: string, type: 'stomp' | 'pwa', document?: Document | null) => Promise<unknown> | unknown };
					if (host.installWebApp) await host.installWebApp(current, kind, doc);
					else await installSite(current, kind, doc);
					if (!closed) {
						menuStatus.textContent = 'Installed successfully';
						for (const other of tabs) {
							if (!other.url && !other.closed) void renderHome(other);
						}
					}
				} catch (error) {
					if (!closed) menuStatus.textContent = 'Install failed: ' + String(error instanceof Error ? error.message : error);
				} finally {
					if (!closed) updateActive();
				}
			};
			toolbar.addEventListener('submit', (event) => {
				event.preventDefault();
				navigateCurrent();
			});
			back.addEventListener('click', () => void command('back'));
			forward.addEventListener('click', () => void command('forward'));
			reload.addEventListener('click', () => void command('reload'));
			add.addEventListener('click', () => createTab());
			star.addEventListener('click', () => {
				const current = activeUrl();
				if (!current || !active) return;
				const index = bookmarks.findIndex(entry => entry.url === current);
				if (index >= 0) bookmarks.splice(index, 1);
				else bookmarks.unshift({ url: current, title: active.title, icon: active.favicon });
				saveBrowserBookmarks(bookmarks);
				renderBookmarks();
				updateActive();
			});
			menuToggle.addEventListener('click', () => updateMenu(menu.hidden));
			installStomp.addEventListener('click', () => void install('stomp'));
			installPwa.addEventListener('click', () => void install('pwa'));
			external.addEventListener('click', () => {
				const current = activeUrl();
				if (current) window.open(current, '_blank', 'noopener,noreferrer');
				updateMenu(false);
			});
			const outside = (event: PointerEvent) => {
				if (!menuWrap.contains(event.target as Node)) updateMenu(false);
			};
			const syncBookmarks = () => {
				bookmarks = loadBrowserBookmarks();
				renderBookmarks();
				updateActive();
				for(const tab of tabs)if(!tab.url && !tab.closed)void renderHome(tab);
			};
			const refreshInstalled = () => {
				for (const tab of tabs) {
					if (!tab.url && !tab.closed) void renderHome(tab);
				}
			};
			document.addEventListener('keydown', onShortcut, true);
			document.addEventListener('pointerdown', outside, true);
			window.addEventListener('storage', syncBookmarks);
			window.addEventListener('vibeos:bookmarks-changed', syncBookmarks);
			window.addEventListener('vibeos:apps-changed', refreshInstalled);
			const registration = { element: win.element, openTab: (target: string) => { createTab(target); } };
			browserWindows.add(registration);
			renderBookmarks();
			createTab(url);
			return () => {
				closed = true;
				stopDrag();
				layoutObserver.disconnect();
				chromeTabs.dispose();
				browserWindows.delete(registration);
				document.removeEventListener('keydown', onShortcut, true);
				document.removeEventListener('pointerdown', outside, true);
				window.removeEventListener('storage', syncBookmarks);
				window.removeEventListener('vibeos:bookmarks-changed', syncBookmarks);
				window.removeEventListener('vibeos:apps-changed', refreshInstalled);
				for (const tab of tabs) {
					tab.closed = true;
					tab.request++;
					tab.metadataRequest++;
					if (tab.innerDocument) {
						try {
							tab.innerDocument.removeEventListener('keydown', onShortcut, true);
							tab.innerDocument.removeEventListener('pointerdown', onFramePointer, true);
							tab.innerDocument.removeEventListener('click', onFrameLinkGesture, true);
							tab.innerDocument.removeEventListener('auxclick', onFrameLinkGesture, true);
							tab.innerDocument.removeEventListener('mousedown', onFrameMiddleDown, true);
						} catch { /* frame already gone */ }
					}
					if (tab.frame) {
						frameOpeners.delete(tab.frame);
						if (tab.frameNavigate) tab.frame.removeEventListener('navigate', tab.frameNavigate);
						const index = tab.owner?.frames.indexOf(tab.frame) ?? -1;
						if (index !== -1) tab.owner?.frames.splice(index, 1);
					}
					if (tab.frameLoad) tab.iframe.removeEventListener('load', tab.frameLoad);
					if (tab.bridgeLoad) tab.iframe.removeEventListener('load', tab.bridgeLoad);
					tab.iframe.src = 'about:blank';
					tab.iframe.remove();
				}
				tabs.length = 0;
			};
		},
	});
}
