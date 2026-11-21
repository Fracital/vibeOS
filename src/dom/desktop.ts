import { createApplications, openAppManager } from './apps';
import { launchBrowser, mountProxiedWebview, setBrowserHost } from './browser';
import { launchEmulator } from './emulator';
import { openMouseSettings, applyMouseSettings, readMouseSettings } from './mouse';
import { cachedSiteInfo, inspectSite, installSite } from './catalog';
import { bootWelcome, openWelcome } from './welcome';
import type { AppEntry, BrowserHost, DesktopAPI, DesktopWindow, WindowSpec } from './types';
import { assetUrl, iconUrl } from './types';
import './desktop.css';
import './apps.css';
import './browser.css';
import './emulator.css';
import './mouse.css';

const taskbarHeight = 26;
const titlebarHeight = 30;
const defaultWallpaper = 'wallpapers/a.png';
const wallpaperKey = 'vibeos.wallpaper';

const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
	const element = document.createElement(tag);
	if(className)element.className = className;
	if(text != null)element.textContent = text;
	return element;
};

const positionInsideDesktop = (element: HTMLElement, width: number, height: number, x: number, y: number, fitInside = false) => {
	const desktopWidth = window.innerWidth;
	const desktopHeight = window.innerHeight;
	const safeWidth = Math.min(Math.max(120, width), desktopWidth);
	const safeHeight = Math.min(Math.max(titlebarHeight, height), Math.max(titlebarHeight, desktopHeight - taskbarHeight));
	element.style.width = `${safeWidth}px`;
	element.style.height = `${safeHeight}px`;
	element.style.left = `${Math.min(Math.max(x, fitInside ? 0 : 60 - safeWidth), Math.max(0, desktopWidth - (fitInside ? safeWidth : 60)))}px`;
	element.style.top = `${safeHeight >= desktopHeight - taskbarHeight ? taskbarHeight : Math.min(Math.max(y, taskbarHeight), Math.max(taskbarHeight, desktopHeight - (fitInside ? safeHeight : titlebarHeight)))}px`;
};

// host: the page that embeds the desktop (src/dom/embed.ts), whose tabs the browser shows
export function bootDesktop(host?: BrowserHost): DesktopAPI | null {
	const root = document.getElementById('vibeos-root');
	if(!root)throw new Error('Missing desktop root');
	if(root.dataset.booted === 'true')return null;
	root.dataset.booted = 'true';
	if(host)setBrowserHost(host);

	const wallpaper = create('div', 'vo-wallpaper');
	wallpaper.id = 'vo-wallpaper';
	wallpaper.setAttribute('aria-hidden', 'true');
	const windowsLayer = create('main', 'vo-windows');
	windowsLayer.id = 'vo-windows';
	windowsLayer.setAttribute('aria-label', 'Open applications');
	const panel = create('header', 'vo-panel');
	const launcher = create('button', 'vo-applications', 'Applications');
	launcher.type = 'button';
	launcher.setAttribute('aria-haspopup', 'menu');
	launcher.setAttribute('aria-expanded', 'false');
	const launcherImage = create('img');
	launcherImage.src = iconUrl('applications-button.png');
	launcherImage.alt = '';
	launcher.prepend(launcherImage);
	const clock = create('time', 'vo-clock');
	clock.title = 'Local date and time';
	clock.tabIndex = 0;
	clock.setAttribute('aria-label', 'Local date and time');
	const taskButtons = create('div', 'vo-panel-tasks');
	panel.append(launcher, taskButtons, clock);
	if(host){
		const leave = create('button', 'vo-applications vo-leave', host.leaveLabel);
		leave.type = 'button';
		leave.title = `Back to ${host.leaveLabel}`;
		leave.addEventListener('click', (event) => {
			event.stopPropagation();
			host.leave();
		});
		launcher.after(leave);
	}
	const applicationMenu = create('nav', 'vo-application-menu');
	applicationMenu.setAttribute('aria-label', 'Applications');
	applicationMenu.hidden = true;
	const contextMenu = create('nav', 'vo-context-menu');
	contextMenu.setAttribute('aria-label', 'Desktop menu');
	contextMenu.hidden = true;
	root.append(wallpaper, windowsLayer, panel, applicationMenu, contextMenu);
	let mouseSettings = readMouseSettings();
	applyMouseSettings(root, mouseSettings);
	window.addEventListener('vibeos:mouse-changed', () => {
		mouseSettings = readMouseSettings();
		applyMouseSettings(root, mouseSettings);
	});

	let topWindow = 100;
	let serial = 0;
	let dismissMenus = () => {};
	let savedWallpaper = defaultWallpaper;
	try { savedWallpaper = localStorage.getItem(wallpaperKey) || defaultWallpaper; } catch { /* private browsing */ }
	const changeWallpaper = (value: string) => {
		if(/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) {
			wallpaper.style.backgroundImage = 'none';
			wallpaper.style.backgroundColor = value;
		} else if(/^wallpapers\/[\w-]+\.png$/i.test(value)) {
			wallpaper.style.backgroundColor = '#1e79d4';
			wallpaper.style.backgroundImage = `url("${iconUrl(value)}")`;
		} else return;
		savedWallpaper = value;
		try { localStorage.setItem(wallpaperKey, value); } catch { /* storage unavailable */ }
	};
	changeWallpaper(savedWallpaper);

	const openWindow = (spec: WindowSpec): DesktopWindow => {
		const outerWidth = Math.max(spec.minWidth ?? 220, spec.width ?? 500);
		// The original cwindow draws an extra 20px of frame beneath its height.
		const outerHeight = Math.max((spec.minHeight ?? 100) + 20, (spec.height ?? 418) + 20);
		const element = create('section', 'vo-window');
		if(spec.chrome)element.classList.add('vo-window-chrome');
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', spec.title);
		element.dataset.windowId = `vo-window-${++serial}`;
		const titlebar = create('div', 'vo-titlebar');
		const titleIcon = create('img', 'vo-title-icon');
		titleIcon.alt = '';
		titleIcon.src = iconUrl(spec.icon ?? 'status/24/image-missing.png');
		const title = create('span', 'vo-window-title', spec.title);
		const controls = create('div', 'vo-window-controls');
		const minButton = create('button', 'vo-window-minimize');
		minButton.type = 'button';
		minButton.title = 'Minimize window';
		minButton.setAttribute('aria-label', 'Minimize window');
		const maxButton = create('button', 'vo-window-maximize');
		maxButton.type = 'button';
		maxButton.title = 'Maximize window';
		maxButton.setAttribute('aria-label', 'Maximize window');
		const closeButton = create('button', 'vo-window-close');
		closeButton.type = 'button';
		closeButton.title = `Close ${spec.title}`;
		closeButton.setAttribute('aria-label', `Close ${spec.title}`);
		controls.append(minButton, maxButton, closeButton);
		titlebar.append(titleIcon, title, controls);
		const content = create('div', 'vo-window-content');
		element.append(titlebar, content);
		windowsLayer.append(element);
		// The original desktop opens settings, wallpaper and web-apps at (50, 50).
		// Editors, terminals and the browser request centered placement.
		const initialX = spec.position === 'center' ? Math.max(0, (window.innerWidth - outerWidth) / 2) : (spec.x ?? 50);
		const initialY = spec.position === 'center' ? (window.innerHeight - (spec.height ?? 418)) / 2 : (spec.y ?? 50);
			positionInsideDesktop(element, outerWidth, outerHeight, initialX, initialY, spec.position === 'center');
		let maximized = false;
		let minimized = false;
		let restoreBounds: {left: number; top: number; width: number; height: number} | null = null;
		let taskButton: HTMLButtonElement | null = null;
		const dragCleanups: Array<() => void> = [];
		const restoreVisibility = () => {
			if(!minimized)return;
			minimized = false;
			element.hidden = false;
			taskButton?.remove();
			taskButton = null;
		};
		const focus = () => {
			if(!element.isConnected)return;
			restoreVisibility();
			dismissMenus();
			topWindow++;
			element.style.zIndex = String(topWindow);
			for(const node of windowsLayer.querySelectorAll('.vo-window'))node.classList.toggle('vo-active', node === element);
		};
		const onHostBlur = () => {
			if(document.activeElement instanceof HTMLIFrameElement && element.contains(document.activeElement))focus();
		};
		const trackIframes = () => {
			for(const frame of element.querySelectorAll('iframe'))frame.addEventListener('focus', focus);
		};
		const frameObserver = new MutationObserver(trackIframes);
		frameObserver.observe(content, {childList: true, subtree: true});
		window.addEventListener('blur', onHostBlur);
		let onDestroy: void | (() => void);
		let closed = false;
		const close = () => {
			if(closed || (spec.beforeClose && spec.beforeClose() === false))return;
			closed = true;
			try { onDestroy?.(); } finally {
				for(const cleanup of dragCleanups)cleanup();
				taskButton?.remove();
				frameObserver.disconnect();
				window.removeEventListener('blur', onHostBlur);
				element.remove();
			}
			const remaining = [...windowsLayer.querySelectorAll<HTMLElement>('.vo-window')].filter((node) => !node.hidden);
			remaining.sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex));
			if(remaining.length)remaining[remaining.length - 1].classList.add('vo-active');
		};
		const minimize = () => {
			if(closed || minimized)return;
			minimized = true;
			element.hidden = true;
			element.classList.remove('vo-active');
			const entry = create('button', 'vo-task-entry');
			entry.type = 'button';
			entry.title = `Restore ${title.textContent || spec.title}`;
			entry.setAttribute('aria-label', entry.title);
			const image = create('img');
			image.alt = '';
			image.src = titleIcon.src;
			entry.append(image, create('span', '', title.textContent || spec.title));
			entry.addEventListener('click', focus);
			taskButtons.append(entry);
			taskButton = entry;
			const remaining = [...windowsLayer.querySelectorAll<HTMLElement>('.vo-window')].filter((node) => !node.hidden);
			remaining.sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex));
			if(remaining.length)remaining[remaining.length - 1].classList.add('vo-active');
		};
		const toggleMaximize = () => {
			if(closed)return;
			focus();
			if(maximized && restoreBounds){
				maximized = false;
				element.classList.remove('vo-maximized');
				positionInsideDesktop(element, restoreBounds.width, restoreBounds.height, restoreBounds.left, restoreBounds.top);
				restoreBounds = null;
			}else{
				restoreBounds = {
					left: element.offsetLeft,
					top: element.offsetTop,
					width: element.offsetWidth,
					height: element.offsetHeight,
				};
				maximized = true;
				element.classList.add('vo-maximized');
				element.style.left = '0px';
				element.style.top = `${taskbarHeight}px`;
				element.style.width = `${window.innerWidth}px`;
				element.style.height = `${window.innerHeight - taskbarHeight}px`;
			}
			maxButton.title = maximized ? 'Restore window' : 'Maximize window';
			maxButton.setAttribute('aria-label', maxButton.title);
		};
		const bindDrag = (handle: HTMLElement): (() => void) => {
			const move = (event: PointerEvent) => {
				if(event.button !== 0 || closed || maximized)return;
				const target = event.target;
				if(target instanceof Element && target.closest('button, a, input, select, [role="tab"], [data-no-window-drag]'))return;
				const startX = event.clientX;
				const startY = event.clientY;
				const startLeft = element.offsetLeft;
				const startTop = element.offsetTop;
				focus();
				handle.setPointerCapture(event.pointerId);
				const onMove = (current: PointerEvent) => {
					if(current.pointerId !== event.pointerId)return;
					const sensitivity = mouseSettings.sensitivity;
					const dx = current.clientX - startX;
					const dy = current.clientY - startY;
					const responseX = 1 + (sensitivity - 1) * Math.min(1, Math.abs(dx) / 55);
					const responseY = 1 + (sensitivity - 1) * Math.min(1, Math.abs(dy) / 55);
					positionInsideDesktop(element, element.offsetWidth, element.offsetHeight, startLeft + dx * responseX, startTop + dy * responseY);
				};
				const stop = () => {
					handle.removeEventListener('pointermove', onMove);
					handle.removeEventListener('pointerup', stop);
					handle.removeEventListener('pointercancel', stop);
				};
				handle.addEventListener('pointermove', onMove);
				handle.addEventListener('pointerup', stop);
				handle.addEventListener('pointercancel', stop);
			};
			handle.addEventListener('pointerdown', move);
			const cleanup = () => handle.removeEventListener('pointerdown', move);
			dragCleanups.push(cleanup);
			return cleanup;
		};
		const win: DesktopWindow = {
			element,
			content,
			controls,
			focus,
			minimize,
			toggleMaximize,
			isMaximized: () => maximized,
			bindDrag,
			close,
			setTitle(value) {
				title.textContent = value;
				element.setAttribute('aria-label', value);
				closeButton.title = `Close ${value}`;
				closeButton.setAttribute('aria-label', `Close ${value}`);
			},
			setIcon(value) {
				titleIcon.src = iconUrl(value);
			},
			setSize(width, height) {
				if(maximized)return;
				positionInsideDesktop(element, width, height, element.offsetLeft, element.offsetTop, true);
			},
		};
		minButton.addEventListener('click', (event) => { event.stopPropagation(); minimize(); });
		maxButton.addEventListener('click', (event) => { event.stopPropagation(); toggleMaximize(); });
		closeButton.addEventListener('click', (event) => { event.stopPropagation(); close(); });
		element.addEventListener('pointerdown', focus);
		element.addEventListener('focusin', focus);
		bindDrag(titlebar);
		titlebar.addEventListener('dblclick', toggleMaximize);

		if(spec.resizable !== false)for(const edge of ['left', 'right', 'bottom', 'bottom-left', 'bottom-right'] as const) {
			const handle = create('div', `vo-resize vo-resize-${edge}`);
			handle.setAttribute('aria-hidden', 'true');
			element.append(handle);
			handle.addEventListener('pointerdown', (event) => {
				if(event.button !== 0)return;
				event.preventDefault();
				event.stopPropagation();
				focus();
				const startX = event.clientX;
				const startY = event.clientY;
				const left = element.offsetLeft;
				const top = element.offsetTop;
				const width = element.offsetWidth;
				const height = element.offsetHeight;
				handle.setPointerCapture(event.pointerId);
				const onMove = (current: PointerEvent) => {
					if(current.pointerId !== event.pointerId)return;
					if(maximized)return;
					const dx = current.clientX - startX;
					const dy = current.clientY - startY;
					const fromLeft = edge.includes('left');
					const fromRight = edge.includes('right');
					const fromBottom = edge.includes('bottom');
					const desiredWidth = fromLeft ? width - dx : fromRight ? width + dx : width;
					const desiredHeight = fromBottom ? height + dy : height;
					const newWidth = Math.min(Math.max(spec.minWidth ?? 220, desiredWidth), window.innerWidth);
					const newHeight = Math.min(Math.max((spec.minHeight ?? 100) + 20, desiredHeight), window.innerHeight - taskbarHeight);
					positionInsideDesktop(element, newWidth, newHeight, fromLeft ? left + width - newWidth : left, top);
				};
				const stop = () => {
					handle.removeEventListener('pointermove', onMove);
					handle.removeEventListener('pointerup', stop);
					handle.removeEventListener('pointercancel', stop);
				};
				handle.addEventListener('pointermove', onMove);
				handle.addEventListener('pointerup', stop);
				handle.addEventListener('pointercancel', stop);
			});
		}
		focus();
		try { onDestroy = spec.render(win); } catch(error) {
			const message = create('pre', 'vo-window-error', String(error));
			content.append(message);
			console.error(error);
		}
		return win;
	};

	const openWebApp = (title: string, url: string, icon?: string, width = 850, height = 600): DesktopWindow =>
		openWindow({
			title,
			icon: icon ?? 'mimetypes/16/html.png',
			width,
			height,
			render(win) {
				win.content.classList.add('vo-web-app');
				const external = /^https?:\/\//i.test(url);
				const iframe = create('iframe', 'vo-web-app-frame');
				iframe.title = title;
				iframe.referrerPolicy = 'no-referrer';
				iframe.allow = 'clipboard-read; clipboard-write; fullscreen';
				win.content.append(iframe);
				let closed = false;
				let detach = () => {};
				const readMetadata = () => {
					if(!external || closed)return;
					let doc: Document | null = null;
					try { doc = iframe.contentDocument; } catch { /* restricted page */ }
					if(!doc?.querySelector('title, meta[property="og:title"], link[rel="icon"]'))return;
					void inspectSite(url, doc).then(info => {
						if(closed)return;
						win.setTitle(info.title || title);
						win.setIcon(info.icon);
						win.element.title = info.description;
					}).catch(() => {});
				};
				iframe.addEventListener('load', readMetadata);
				if(external){
					const saved = cachedSiteInfo(url);
					if(saved){
						win.setIcon(saved.icon);
						win.element.title = saved.description;
					}
					const status = create('div', 'vo-web-app-status', 'Connecting to web proxy...');
					win.content.append(status);
					void mountProxiedWebview(iframe, url, () => !closed).then(cleanup => {
						detach = cleanup;
						if(closed)cleanup();
						else {
							status.remove();
							readMetadata();
						}
					}).catch(error => {
						if(!closed)status.textContent = 'Could not load the page: ' + String(error instanceof Error ? error.message : error);
					});
				}else{
					iframe.src = new URL(assetUrl(url), document.baseURI).href;
				}
				return () => {
					closed = true;
					detach();
					iframe.removeEventListener('load', readMetadata);
					iframe.remove();
				};
			},
		});

	const api: DesktopAPI = {
		openWindow,
		openWebApp,
		openBrowser: (url) => launchBrowser(api, url),
		openEmulator: (profile) => launchEmulator(api, profile),
			openAppManager: () => openAppManager(api),
		installWebApp: async (url, kind, doc) => { await installSite(url, kind, doc); },
		changeWallpaper,
		getWallpaper: () => savedWallpaper,
	};

	const readApplications = (): AppEntry[] => {
		const entries = createApplications(api);
		const settings = entries.find((entry) => entry.label === 'Settings');
		settings?.children?.push({
			label: 'Mouse and Touchpad',
			icon: 'devices/16/input-mouse.png',
			action: () => openMouseSettings(api),
		});
		settings?.children?.push({
			label: 'Getting Started',
			icon: 'categories/16/applications-system.png',
			action: () => openWelcome(api),
		});
		return entries;
	};
	let applications = readApplications();
	const buildRow = (entry: AppEntry): HTMLElement => {
		const row = create('div', 'vo-menu-entry');
		const item = create('button', 'vo-menu-item');
		item.type = 'button';
		if(entry.description)item.title = entry.description;
		const picture = create('img');
		picture.src = iconUrl(entry.icon);
		picture.alt = '';
		picture.onerror = () => { picture.onerror = null; picture.src = iconUrl('mimetypes/16/html.png'); };
		const label = create('span', '', entry.label);
		item.append(picture, label);
		row.append(item);
		if(entry.children?.length) {
			const arrow = create('span', 'vo-menu-arrow', '▸');
			arrow.setAttribute('aria-hidden', 'true');
			item.append(arrow);
			item.setAttribute('aria-haspopup', 'menu');
			item.setAttribute('aria-expanded', 'false');
			const submenu = create('div', 'vo-submenu');
			submenu.setAttribute('role', 'menu');
			for(const child of entry.children)submenu.append(buildRow(child));
			row.append(submenu);
			const collapseSiblings = () => {
				const siblings = row.parentElement?.children;
				if(!siblings)return;
				for(const sibling of siblings){
					if(sibling === row)continue;
					for(const expanded of sibling.querySelectorAll<HTMLElement>('.vo-expanded')){
						expanded.classList.remove('vo-expanded');
						expanded.querySelector(':scope > button')?.setAttribute('aria-expanded', 'false');
					}
					if(sibling instanceof HTMLElement){
						sibling.classList.remove('vo-expanded');
						sibling.querySelector(':scope > button')?.setAttribute('aria-expanded', 'false');
					}
				}
			};
			item.addEventListener('click', (event) => {
				event.stopPropagation();
				const wasOpen = row.classList.contains('vo-expanded');
				collapseSiblings();
				row.classList.toggle('vo-expanded', !wasOpen);
				item.setAttribute('aria-expanded', String(!wasOpen));
			});
			row.addEventListener('pointerenter', () => {
				const siblings = row.parentElement?.children;
				if(!siblings)return;
				const hadOpen = [...siblings].some((sibling) => sibling.classList.contains('vo-expanded'));
				if(hadOpen){
					collapseSiblings();
					row.classList.add('vo-expanded');
					item.setAttribute('aria-expanded', 'true');
				}
			});
		} else {
			item.addEventListener('click', (event) => {
				event.stopPropagation();
				setMenu(false);
				entry.action?.();
			});
		}
		return row;
	};
	const renderApplicationMenu = () => {
		applications = readApplications();
		applicationMenu.replaceChildren(...applications.map(buildRow));
	};
	renderApplicationMenu();
	window.addEventListener('vibeos:apps-changed', renderApplicationMenu);
	const setMenu = (open: boolean) => {
		applicationMenu.hidden = !open;
		launcher.classList.toggle('vo-open', open);
		launcher.setAttribute('aria-expanded', String(open));
		if(!open)for(const row of applicationMenu.querySelectorAll<HTMLElement>('.vo-expanded')){
			row.classList.remove('vo-expanded');
			row.querySelector(':scope > button')?.setAttribute('aria-expanded', 'false');
		}
		if(open)contextMenu.hidden = true;
	};
	dismissMenus = () => {
		setMenu(false);
		contextMenu.hidden = true;
	};
	launcher.addEventListener('click', (event) => { event.stopPropagation(); setMenu(applicationMenu.hidden); });

	const addContextItem = (label: string, icon: string, action: () => void) => {
		const item = create('button', 'vo-menu-item');
		item.type = 'button';
		const picture = create('img');
		picture.src = iconUrl(icon);
		picture.alt = '';
		item.append(picture, create('span', '', label));
		item.addEventListener('click', (event) => {
			event.stopPropagation();
			contextMenu.hidden = true;
			action();
		});
		contextMenu.append(item);
	};
	const findAction = (label: string): (() => void) | undefined => {
		const search = (entries: AppEntry[]): (() => void) | undefined => {
			for(const entry of entries) {
				if(entry.label === label)return entry.action;
				const inside = entry.children && search(entry.children);
				if(inside)return inside;
			}
			return undefined;
		};
		return search(applications);
	};
	addContextItem('Change wallpaper', 'apps/16/preferences-desktop-wallpaper.png', findAction('Wallpaper Picker') ?? (() => {}));
	addContextItem('JS Terminal', 'apps/16/bash.png', findAction('JS Terminal') ?? (() => {}));

	root.addEventListener('contextmenu', (event) => {
		if(!(event.target instanceof Element))return;
		if(event.target.closest('.vo-window, .vo-panel, .vo-application-menu, .vo-context-menu'))return;
		event.preventDefault();
		setMenu(false);
		contextMenu.style.left = `${Math.max(0, Math.min(window.innerWidth - 162, event.clientX))}px`;
		contextMenu.style.top = `${Math.max(taskbarHeight, Math.min(window.innerHeight - 53, event.clientY))}px`;
		contextMenu.hidden = false;
	});
	document.addEventListener('pointerdown', (event) => {
		const target = event.target;
		if(!(target instanceof Element))return;
		if(!target.closest('.vo-application-menu, .vo-applications'))setMenu(false);
		if(!target.closest('.vo-context-menu'))contextMenu.hidden = true;
	});
	document.addEventListener('keydown', (event) => {
		if(event.key === 'Escape') {
			setMenu(false);
			contextMenu.hidden = true;
		}
	});
	window.addEventListener('resize', () => {
		for(const element of windowsLayer.querySelectorAll<HTMLElement>('.vo-window')) {
			if(element.classList.contains('vo-maximized')){
				element.style.left = '0px';
				element.style.top = `${taskbarHeight}px`;
				element.style.width = `${window.innerWidth}px`;
				element.style.height = `${window.innerHeight - taskbarHeight}px`;
				continue;
			}
				positionInsideDesktop(element, element.offsetWidth, element.offsetHeight, element.offsetLeft, element.offsetTop, true);
		}
	});
	const refreshClock = () => {
		const now = new Date();
		const date = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).format(now);
		const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(now);
		clock.textContent = `${date}, ${time}`;
		clock.dateTime = now.toISOString();
		clock.dataset.tooltip = new Intl.DateTimeFormat('en-US', {
			weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
		}).format(now);
		clock.title = clock.dataset.tooltip;
	};
	refreshClock();
	window.setInterval(refreshClock, 15000);
	// an embedding host opens the desktop on its own tabs, not on the welcome screen
	if(!host)bootWelcome(api);
	return api;
}
