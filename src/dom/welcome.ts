import type { DesktopAPI, DesktopWindow } from './types';
import './welcome.css';

const storageKey = 'vibeos.welcome.showOnBoot.v1';
let showOnBoot = true;
let openWindow: DesktopWindow | null = null;

try {
	showOnBoot = localStorage.getItem(storageKey) !== 'false';
} catch { /* the welcome window still works when storage is unavailable */ }

export const readWelcomeOnBoot = (): boolean => showOnBoot;

export const saveWelcomeOnBoot = (enabled: boolean): void => {
	showOnBoot = enabled;
	try { localStorage.setItem(storageKey, String(enabled)); } catch { /* storage unavailable */ }
	window.dispatchEvent(new CustomEvent('vibeos:welcome-changed', {detail: enabled}));
};

const element = <K extends keyof HTMLElementTagNameMap>(
	tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag);
	if(className)node.className = className;
	if(text)node.textContent = text;
	return node;
};

type WelcomeSection = 'start' | 'browse' | 'apps' | 'personalize';

export const openWelcome = (api: DesktopAPI): void => {
	if(openWindow?.element.isConnected){
		openWindow.focus();
		return;
	}

	const win = api.openWindow({
		title: 'Getting Started with vibeOS',
		icon: 'categories/24/applications-system.png',
		width: 560,
		height: 348,
		minWidth: 320,
		minHeight: 250,
		position: 'center',
		resizable: false,
		render(window) {
			const root = element('div', 'vo-welcome');
			const masthead = element('header', 'vo-welcome-masthead');
			const emblem = element('span', 'vo-welcome-emblem');
			emblem.setAttribute('aria-hidden', 'true');
			for(const color of ['blue', 'orange', 'green', 'cyan']){
				emblem.append(element('i', 'vo-welcome-tile-' + color));
			}
			const brand = element('div', 'vo-welcome-brand');
			brand.append(element('strong', '', 'vibeOS'), element('span', '', 'Getting Started'));
			masthead.append(emblem, brand);
			const body = element('div', 'vo-welcome-body');
			const navigation = element('nav', 'vo-welcome-nav');
			navigation.setAttribute('aria-label', 'Getting started topics');
			const panel = element('section', 'vo-welcome-panel');
			panel.setAttribute('aria-live', 'polite');
			body.append(navigation, panel);
			const footer = element('footer', 'vo-welcome-footer');
			const startupLabel = element('label', 'vo-welcome-startup');
			const startup = element('input');
			startup.type = 'checkbox';
			startup.checked = readWelcomeOnBoot();
			startup.addEventListener('change', () => saveWelcomeOnBoot(startup.checked));
			startupLabel.append(startup, element('span', '', 'Show this screen at startup'));
			const actions = element('div', 'vo-welcome-actions');
			const never = element('button', 'vo-welcome-button', 'Never show again');
			never.type = 'button';
			never.addEventListener('click', () => {
				saveWelcomeOnBoot(false);
				window.close();
			});
			const close = element('button', 'vo-welcome-button vo-welcome-primary', 'Close');
			close.type = 'button';
			close.addEventListener('click', () => window.close());
			actions.append(never, close);
			footer.append(startupLabel, actions);
			root.append(masthead, body, footer);
			window.content.classList.add('vo-welcome-window');
			window.content.append(root);

			const topics: Array<{id: WelcomeSection; label: string; heading: string; intro: string; tip: string; action?: {label: string; run: () => void}}> = [
				{id: 'start', label: 'Getting Started', heading: 'Welcome to vibeOS',
					intro: 'Your desktop is ready. Choose Applications at the top left to find tools, games, and settings.',
					tip: 'Move windows by their title bars, resize them from their edges, and use the orange close button when you are finished.'},
				{id: 'browse', label: 'Explore the Internet', heading: 'Browse the Web',
					intro: 'vibeBrowser opens websites through the built-in STomp web proxy.',
					tip: 'Enter a website address or search in the address bar. Use Ctrl+T to open a new browser tab.',
					action: {label: 'Open vibeBrowser', run: () => api.openBrowser()}},
				{id: 'apps', label: 'Find Your Apps', heading: 'Applications and Games',
					intro: 'The Applications menu includes a text editor, emulator, classic games, and an App Manager.',
					tip: 'Try Games for 2048 and Tetris, or Installed Apps to manage website launchers.',
					action: {label: 'Open App Manager', run: () => api.openAppManager()}},
				{id: 'personalize', label: 'Customize vibeOS', heading: 'Make It Yours',
					intro: 'Change the wallpaper, mouse cursor, and other settings from the Applications menu.',
					tip: 'You can show this welcome screen again at any time from Settings, even after choosing Never show again.'},
			];
			const buttons = new Map<WelcomeSection, HTMLButtonElement>();
			let selected: WelcomeSection = 'start';
			const renderTopic = () => {
				const topic = topics.find(item => item.id === selected) ?? topics[0];
				for(const [key, button] of buttons){
					button.classList.toggle('vo-welcome-selected', key === selected);
					button.setAttribute('aria-current', key === selected ? 'page' : 'false');
				}
				panel.replaceChildren(
					element('h2', '', topic.heading),
					element('p', '', topic.intro),
					element('p', 'vo-welcome-tip', topic.tip),
				);
				if(topic.action){
					const action = element('button', 'vo-welcome-link', topic.action.label);
					action.type = 'button';
					action.addEventListener('click', topic.action.run);
					panel.append(action);
				}
			};
			for(const topic of topics){
				const button = element('button', 'vo-welcome-nav-item', topic.label);
				button.type = 'button';
				button.addEventListener('click', () => {
					selected = topic.id;
					renderTopic();
				});
				navigation.append(button);
				buttons.set(topic.id, button);
			}
			renderTopic();
			const onSettingChange = () => { startup.checked = readWelcomeOnBoot(); };
			globalThis.window.addEventListener('vibeos:welcome-changed', onSettingChange);
			return () => {
				globalThis.window.removeEventListener('vibeos:welcome-changed', onSettingChange);
				if(openWindow === window)openWindow = null;
			};
		},
	});
	openWindow = win;
};

export const bootWelcome = (api: DesktopAPI): void => {
	if(readWelcomeOnBoot())openWelcome(api);
};
