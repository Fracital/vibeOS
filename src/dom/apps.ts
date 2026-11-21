import type { AppEntry, DesktopAPI, DesktopWindow } from './types';
import { openWelcome, readWelcomeOnBoot, saveWelcomeOnBoot } from './welcome';
import { iconUrl } from './types';
import { cachedSiteInfo, inspectSite, installSite, installedSites, uninstallSite } from './catalog';
import './catalog.css';
import type { InstalledSite } from './catalog';

const wallpaperImages = [
	{ label: 'Default', path: '/tango/wallpapers/a.png' },
	{ label: 'Wave', path: '/tango/wallpapers/b.png' },
	{ label: 'Test Background', path: '/tango/wallpapers/c.png' },
	{ label: 'Garden Tiles (CT)', path: '/tango/wallpapers/GardenTilesCT.png' },
	{ label: 'SysYA_Branded', path: '/tango/wallpapers/SysYABranded.png' },
	{ label: 'SysYA', path: '/tango/wallpapers/SysYA.png' },
	{ label: 'SysYA_Dark', path: '/tango/wallpapers/SysYADark.png' },
];

const wallpaperColors = ['#FF8C00', '#E81123', '#9A0089', '#10893E', '#018574', '#2D7D9A', '#0063B1', '#4A5459'];
const profileNameKey = 'vibeos-profile-name';

function wallpaperValue(value: string): string {
	return value.startsWith('/tango/') ? value.slice('/tango/'.length) : value;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value = ''): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if(className)node.className = className;
	if(value)node.textContent = value;
	return node;
}

function append(parent: HTMLElement, ...children: (HTMLElement | Text)[]): void {
	parent.append(...children);
}

function button(label: string, click: () => void, className = 'vo-app-button'): HTMLButtonElement {
	const node = element('button', className, label);
	node.type = 'button';
	node.addEventListener('click', click);
	return node;
}

function pane(content: HTMLElement, className: string): HTMLElement {
	const node = element('div', 'vo-app-root ' + className);
	content.replaceChildren(node);
	return node;
}

function message(parent: HTMLElement, value: string, className = 'vo-app-note'): HTMLElement {
	const node = element('p', className, value);
	parent.append(node);
	return node;
}

function download(name: string, content: string, mime = 'text/plain'): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const link = element('a');
	link.href = url;
	link.download = name;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readName(): string {
	try {
		return localStorage.getItem(profileNameKey) || 'NOT LOADED';
	}catch{
		return 'NOT LOADED';
	}
}

function setName(name: string): void {
	try {
		localStorage.setItem(profileNameKey, name);
	}catch{
		// the desktop still works if the browser disables storage
	}
}

function applyProfile(data: unknown, api: DesktopAPI): string {
	if(data === null || typeof data !== 'object' || Array.isArray(data))throw new Error('Invalid profile file');
	const profile = data as Record<string, unknown>;
	let count = 0;
	if(typeof profile.name === 'string' && profile.name.trim() && profile.name.length < 100){
		setName(profile.name.trim());
		count++;
	}
	if(typeof profile.wallpaper === 'string'){
		const wallpaper = profile.wallpaper;
		const valid = wallpaperImages.some(item => wallpaperValue(item.path) === wallpaperValue(wallpaper)) ||
			wallpaperColors.some(color => color.toLowerCase() === wallpaper.toLowerCase());
		if(valid){
			api.changeWallpaper(wallpaperValue(wallpaper));
			count++;
		}
	}
	if(!count)throw new Error('The profile has no supported settings');
	return 'Loaded ' + count + (count === 1 ? ' setting' : ' settings');
}

function openSettings(api: DesktopAPI): void {
	api.openWindow({
		title: 'vibeOS Settings',
		icon: iconUrl('categories/24/package_settings.png'),
		width: 500,
		height: 418,
		minWidth: 420,
		minHeight: 320,
		resizable: false,
		render: (win: DesktopWindow) => {
			const root = pane(win.content, 'vo-app-settings');
			const sidebar = element('nav', 'vo-app-settings-sidebar');
			sidebar.setAttribute('aria-label', 'Settings sections');
			const content = element('section', 'vo-app-settings-content');
			append(root, sidebar, content);
			const tabs = [
				['general', 'General'],
				['accounts', 'Accounts'],
				['proxy', 'Proxy'],
				['sysinfo', 'Env. Info'],
				['about', 'About'],
			] as const;
			const tabButtons: HTMLButtonElement[] = [];
			const show = (tab: typeof tabs[number][0]): void => {
				content.replaceChildren();
				tabs.forEach((entry, index) => {
					const selected = entry[0] === tab;
					tabButtons[index].classList.toggle('vo-app-selected', selected);
					tabButtons[index].setAttribute('aria-current', selected ? 'page' : 'false');
				});
				if(tab === 'general'){
					const dimensions = element('div', 'vo-app-settings-general');
					append(dimensions,
						element('div', '', 'Your Screen Resolution: ' + screen.width + 'x' + screen.height),
						element('div', '', 'Desktop Resolution: ' + innerWidth + 'x' + innerHeight),
						element('div', '', 'It follows the size of the browser window.'),
						element('hr'),
						element('p', '', 'Looking for something?'),
						button('Wallpaper Picker', () => openWallpaperPicker(api)),
					);
					content.append(dimensions);
						const welcomeSection = element('div', 'vo-app-welcome-setting');
						const welcomeLabel = element('label', 'vo-app-welcome-toggle');
						const welcomeToggle = element('input');
						welcomeToggle.type = 'checkbox';
						welcomeToggle.checked = readWelcomeOnBoot();
						welcomeToggle.addEventListener('change', () => saveWelcomeOnBoot(welcomeToggle.checked));
						welcomeLabel.append(welcomeToggle, element('span', '', 'Show welcome screen on startup'));
						welcomeSection.append(welcomeLabel, button('Open Welcome', () => openWelcome(api)));
						content.append(welcomeSection);
				}else if(tab === 'accounts'){
					const accounts = element('div', 'vo-app-settings-accounts');
					message(accounts, 'Enter the URL to your profile to load settings and apps. File upload is also available.', 'vo-app-paragraph');
					const url = element('input', 'vo-app-input');
					url.type = 'url';
					url.placeholder = 'Profile URL';
					url.setAttribute('aria-label', 'Profile URL');
					const status = message(accounts, 'Current: ' + readName());
					const result = message(accounts, '');
					const file = element('input');
					file.type = 'file';
					file.accept = '.json,application/json';
					file.hidden = true;
					const loadData = (source: unknown): void => {
						try{
							result.textContent = applyProfile(source, api);
							status.textContent = 'Current: ' + readName();
						}catch(error){
							result.textContent = error instanceof Error ? error.message : String(error);
						}
					};
					file.addEventListener('change', async () => {
						const selected = file.files?.[0];
						if(!selected)return;
						try{
							loadData(JSON.parse(await selected.text()));
						}catch(error){
							result.textContent = 'Could not open profile: ' + String(error);
						}
						file.value = '';
					});
					const urlRow = element('div', 'vo-app-inline-controls');
					append(urlRow, url, button('Load', async () => {
						try{
							const target = new URL(url.value, location.href);
							if(!['http:', 'https:'].includes(target.protocol))throw new Error('Use an HTTP or HTTPS URL');
							const response = await fetch(target.href);
							if(!response.ok)throw new Error('HTTP ' + response.status);
							loadData(await response.json());
						}catch(error){
							result.textContent = 'Could not load profile: ' + String(error);
						}
					}));
					append(accounts, urlRow, button('Open profile file...', () => file.click()), file, status, element('hr'));
					message(accounts, 'Change Profile name:', 'vo-app-paragraph');
					const nameInput = element('input', 'vo-app-input');
					nameInput.type = 'text';
					nameInput.maxLength = 99;
					nameInput.placeholder = 'New Name';
					const nameRow = element('div', 'vo-app-inline-controls');
					append(nameRow, nameInput, button('Change', () => {
						const value = nameInput.value.trim();
						if(!value){
							result.textContent = 'Enter a profile name.';
							return;
						}
						setName(value);
						status.textContent = 'Current: ' + readName();
						result.textContent = 'Profile updated';
					}));
					append(accounts, nameRow, button('Export', () => {
						download('vibeos-profile.json', JSON.stringify({
							version: 1,
							name: readName(),
							wallpaper: api.getWallpaper(),
						}, null, 2), 'application/json');
						result.textContent = 'Exported profile';
					}), result, element('hr'));
					const actions = element('div', 'vo-app-inline-controls');
					append(actions,
						button('Clear Data & Reload', () => {
							if(!confirm('Clear the saved profile name and reload vibeOS?'))return;
							try{localStorage.removeItem(profileNameKey);}catch{ /* storage unavailable */ }
							location.reload();
						}),
						button('Reset vibeOS', () => {
							if(!confirm('Reset the vibeOS profile and wallpaper?'))return;
							try{localStorage.removeItem(profileNameKey);}catch{ /* storage unavailable */ }
							api.changeWallpaper(wallpaperValue(wallpaperImages[0].path));
							status.textContent = 'Current: NOT LOADED';
							result.textContent = 'Settings reset';
						}),
					);
					accounts.append(actions);
					content.append(accounts);
				}else if(tab === 'proxy'){
					message(content, 'The proxy page is unavailable.');
					content.append(button('Open vibeBrowser', () => api.openBrowser()));
				}else if(tab === 'sysinfo'){
					const info = [
						'Version: PuB 2.0 (HTML5)',
						'Platform: ' + navigator.platform,
						'Screen Resolution: ' + screen.width + 'x' + screen.height,
						'Window Resolution: ' + screen.availWidth + 'x' + screen.availHeight,
						'Environment Resolution: ' + innerWidth + 'x' + innerHeight,
						'URL: ' + location.href,
						'User Agent: ' + navigator.userAgent,
					];
					const data = element('div', 'vo-app-settings-env');
					info.forEach(line => data.append(element('p', '', line)));
					content.append(data);
				}else{
					const about = element('div', 'vo-app-settings-about');
					append(about, element('h2', '', 'vibeOS Public Beta'), element('hr'),
						element('p', '', 'vibeOS was created by'));
					['Divide (@vibedivde)', 'Nathan M. (@ctaetcsh)', 'Ryan W. (@LinuxTerm)'].forEach(name => {
						about.append(element('strong', 'vo-app-credit', name));
					});
					about.append(element('p', '', 'with help from'));
					['Eli', 'SexyDuceDuce', 'Cat Lady', 'IStealYourMemes'].forEach(name => {
						about.append(element('strong', 'vo-app-credit', name));
					});
					about.append(element('footer', '', 'Copyright 2020 vibeOS Development Team'));
					about.append(element('footer', '', 'vibeOS is Open Source Software'));
					content.append(about);
				}
			};
			tabs.forEach(([key, label]) => {
				const item = button(label, () => show(key), 'vo-app-tab');
				tabButtons.push(item);
				sidebar.append(item);
			});
			show('general');
				const updateWelcomeToggle = () => {
					const input = content.querySelector<HTMLInputElement>('.vo-app-welcome-toggle input');
					if(input)input.checked = readWelcomeOnBoot();
				};
				window.addEventListener('vibeos:welcome-changed', updateWelcomeToggle);
				return () => window.removeEventListener('vibeos:welcome-changed', updateWelcomeToggle);
		},
	});
}

function openWallpaperPicker(api: DesktopAPI): void {
	api.openWindow({
		title: 'Wallpaper Picker',
		icon: iconUrl('apps/24/preferences-desktop-wallpaper.png'),
		width: 1070,
		height: 240,
		minWidth: 240,
		minHeight: 150,
		render: win => {
			const root = pane(win.content, 'vo-app-wallpapers');
			root.append(element('h2', 'vo-app-wallpaper-heading', 'Wallpapers'));
			const pictures = element('div', 'vo-app-wallpaper-tiles');
			const colors = element('div', 'vo-app-wallpaper-colors');
			let current = api.getWallpaper();
			const tiles: HTMLButtonElement[] = [];
			const updateSelection = (): void => {
				tiles.forEach(tile => {
					const selected = !!tile.dataset.wallpaper && wallpaperValue(tile.dataset.wallpaper).toLowerCase() ===
						wallpaperValue(current).toLowerCase();
					tile.classList.toggle('vo-app-active-wallpaper', !!selected);
					tile.setAttribute('aria-pressed', String(!!selected));
				});
			};
			const choose = (value: string): void => {
				current = wallpaperValue(value);
				api.changeWallpaper(current);
				updateSelection();
			};
			wallpaperImages.forEach(entry => {
				const tile = button('', () => choose(entry.path), 'vo-app-wallpaper-tile');
				tile.dataset.wallpaper = entry.path;
				const preview = element('img');
				preview.src = entry.path;
				preview.alt = '';
				preview.loading = 'lazy';
				append(tile, preview, element('span', '', entry.label));
				pictures.append(tile);
				tiles.push(tile);
			});
			wallpaperColors.forEach(color => {
				const swatch = button(color, () => choose(color), 'vo-app-wallpaper-swatch');
				swatch.dataset.wallpaper = color;
				swatch.style.backgroundColor = color;
				swatch.title = color;
				swatch.setAttribute('aria-label', 'Solid color ' + color);
				colors.append(swatch);
				tiles.push(swatch);
			});
			append(root, pictures, element('h2', 'vo-app-wallpaper-heading', 'Solid Colors'), colors);
			updateSelection();
		},
	});
}

function openTextEditor(api: DesktopAPI): void {
	let filename = 'untitled.txt';
	let saved = '';
	let input: HTMLTextAreaElement | null = null;
	api.openWindow({
		title: 'untitled.txt - Text Editor',
		icon: iconUrl('categories/24/applications-office.png'),
		width: 800,
		height: 600,
		position: 'center',
		minWidth: 460,
		minHeight: 240,
		beforeClose: () => !input || input.value === saved ||
			confirm('Close ' + filename + ' without saving your changes?'),
		render: win => {
			const root = pane(win.content, 'vo-app-editor');
			const toolbar = element('div', 'vo-app-editor-toolbar');
			const body = element('div', 'vo-app-editor-body');
			const numbers = element('div', 'vo-app-editor-numbers');
			numbers.setAttribute('aria-hidden', 'true');
			const text = element('textarea', 'vo-app-editor-text');
			input = text;
			text.setAttribute('aria-label', 'Document content');
			text.spellcheck = false;
			text.wrap = 'soft';
			const preview = element('div', 'vo-app-editor-preview vo-app-markdown');
			const status = element('div', 'vo-app-editor-status');
			const stats = element('span');
			const mode = element('span', '', 'Plain text');
			const richLabel = element('label', 'vo-app-editor-rich');
			const richInput = element('input');
			richInput.type = 'checkbox';
			richInput.setAttribute('aria-label', 'Rich text preview');
			append(richLabel, document.createTextNode('Rich'), richInput);
			append(body, numbers, text, preview);
			append(status, stats, mode);
			append(root, toolbar, body, status);
			const renderStats = (): void => {
				const lines = text.value.split('\n');
				const start = text.selectionStart;
				const before = text.value.slice(0, start).split('\n');
				const words = (text.value.match(/\S+/g) || []).length;
				stats.textContent = 'Ln ' + before.length + ', Col ' + (before[before.length - 1].length + 1) +
					'     ' + words + (words === 1 ? ' word' : ' words') +
					'     ' + lines.length + (lines.length === 1 ? ' line' : ' lines');
				numbers.textContent = lines.map((_, index) => String(index + 1)).join('\n');
				win.setTitle((text.value === saved ? '' : '*') + filename + ' - Text Editor');
				if(richInput.checked){
					preview.replaceChildren(renderMarkdown(text.value, api, location.href));
				}
			};
			const find = (): void => {
				const query = prompt('Find in document', text.value.substring(text.selectionStart, text.selectionEnd));
				if(!query)return;
				let index = text.value.toLowerCase().indexOf(query.toLowerCase(), text.selectionEnd);
				if(index < 0)index = text.value.toLowerCase().indexOf(query.toLowerCase());
				if(index < 0){
					mode.textContent = 'Text not found';
					return;
				}
				text.focus();
				text.setSelectionRange(index, index + query.length);
				renderStats();
			};
			const insert = (before: string, after = '', block = false): void => {
				text.focus();
				const from = text.selectionStart;
				const to = text.selectionEnd;
				if(block){
					const start = text.value.lastIndexOf('\n', from - 1) + 1;
					text.setRangeText(before, start, start, 'end');
				}else{
					const selected = text.value.slice(from, to);
					text.setRangeText(before + selected + after, from, to, 'select');
					text.setSelectionRange(from + before.length, from + before.length + selected.length);
				}
				renderStats();
			};
			const load = (contents: string, name: string): void => {
				text.value = contents;
				filename = name;
				saved = contents;
				richInput.checked = /\.(md|markdown)$/i.test(name);
				showRich();
				renderStats();
				text.focus();
			};
			const canDiscard = (): boolean => text.value === saved ||
				confirm('Discard unsaved changes to ' + filename + '?');
			const picker = element('input');
			picker.type = 'file';
			picker.hidden = true;
			picker.addEventListener('change', async () => {
				const file = picker.files?.[0];
				if(!file)return;
				try{
					load(await file.text(), file.name);
				}catch(error){
					mode.textContent = 'Open failed: ' + String(error);
				}
				picker.value = '';
			});
			const save = (as: boolean): void => {
				if(as){
					const value = prompt('Save as', filename);
					if(value === null || !value.trim())return;
					filename = value.trim();
				}
				download(filename, text.value);
				saved = text.value;
				renderStats();
				mode.textContent = 'Saved ' + filename;
			};
			const showRich = (): void => {
				body.classList.toggle('vo-app-editor-in-rich', richInput.checked);
				mode.textContent = richInput.checked ? 'Rich text (markdown)' : 'Plain text';
				if(filename.startsWith('untitled.'))filename = richInput.checked ? 'untitled.md' : 'untitled.txt';
				renderStats();
			};
			const menus: {name: string; actions: [string, () => void][]}[] = [
				{name: 'File', actions: [
					['New', () => {if(canDiscard())load('', richInput.checked ? 'untitled.md' : 'untitled.txt');}],
					['Open...', () => {if(canDiscard())picker.click();}],
					['Save', () => save(false)],
					['Save as...', () => save(true)],
				]},
				{name: 'Edit', actions: [
					['Undo', () => document.execCommand('undo')],
					['Redo', () => document.execCommand('redo')],
					['Cut', () => document.execCommand('cut')],
					['Copy', () => document.execCommand('copy')],
					['Paste', async () => {
						try{insert(await navigator.clipboard.readText());}
						catch{mode.textContent = 'Use Ctrl+V to paste';}
					}],
					['Select all', () => {text.focus(); text.select();}],
					['Find...', find],
				]},
				{name: 'View', actions: [
					['Rich text', () => {richInput.checked = !richInput.checked; showRich();}],
					['Word wrap', () => {text.wrap = text.wrap === 'off' ? 'soft' : 'off';}],
					['Line numbers', () => numbers.classList.toggle('vo-app-hidden')],
					['Zoom in', () => changeZoom(1)],
					['Zoom out', () => changeZoom(-1)],
					['Normal size', () => changeZoom(0)],
				]},
				{name: 'Format', actions: [
					['Bold', () => insert('**', '**')],
					['Italic', () => insert('*', '*')],
					['Strikethrough', () => insert('~~', '~~')],
					['Code', () => insert(String.fromCharCode(96), String.fromCharCode(96))],
					['Heading 1', () => insert('# ', '', true)],
					['Heading 2', () => insert('## ', '', true)],
					['Heading 3', () => insert('### ', '', true)],
					['Bullet list', () => insert('- ', '', true)],
					['Numbered list', () => insert('1. ', '', true)],
					['Quote', () => insert('> ', '', true)],
				]},
			];
			function changeZoom(delta: number): void {
				const size = delta === 0 ? 14 : Math.min(28, Math.max(10, parseFloat(text.style.fontSize) || 14) + delta);
				text.style.fontSize = size + 'px';
				text.style.lineHeight = Math.round(size * 1.4) + 'px';
				numbers.style.fontSize = size + 'px';
				numbers.style.lineHeight = Math.round(size * 1.4) + 'px';
			}
			menus.forEach(section => {
				const details = element('details', 'vo-app-editor-menu');
				const label = element('summary', '', section.name);
				const items = element('div', 'vo-app-editor-menu-items');
				section.actions.forEach(([name, action]) => {
					items.append(button(name, () => {
						details.open = false;
						action();
						renderStats();
					}, 'vo-app-editor-action'));
				});
				append(details, label, items);
				toolbar.append(details);
			});
			append(toolbar, richLabel, picker);
			richInput.addEventListener('change', showRich);
			text.addEventListener('input', renderStats);
			text.addEventListener('click', renderStats);
			text.addEventListener('keyup', renderStats);
			text.addEventListener('scroll', () => { numbers.scrollTop = text.scrollTop; });
			text.addEventListener('keydown', event => {
				if(event.key === 'Tab'){
					event.preventDefault();
					insert('\t');
				}
				if((event.ctrlKey || event.metaKey) && ['s', 'o', 'f'].includes(event.key.toLowerCase())){
					event.preventDefault();
					const key = event.key.toLowerCase();
					if(key === 's')save(event.shiftKey);
					if(key === 'o' && canDiscard())picker.click();
					if(key === 'f')find();
				}
			});
			renderStats();
			text.focus();
		},
	});
}

function openTerminal(api: DesktopAPI): void {
	api.openWindow({
		title: 'JS Terminal',
		icon: iconUrl('apps/24/bash.png'),
		width: 700,
		height: 300,
		position: 'center',
		minWidth: 360,
		minHeight: 200,
		render: win => {
			const root = pane(win.content, 'vo-app-terminal');
			const log = element('div', 'vo-app-terminal-output');
			log.setAttribute('role', 'log');
			log.setAttribute('aria-live', 'polite');
			const form = element('form', 'vo-app-terminal-form');
			const input = element('input', 'vo-app-terminal-input');
			input.type = 'text';
			input.autocomplete = 'off';
			input.spellcheck = false;
			input.setAttribute('aria-label', 'JavaScript command');
			append(form, input, button('Run', () => form.requestSubmit(), 'vo-app-terminal-run'));
			append(root, log, form);
			const maxLines = 500;
			const write = (line: string): void => {
				const text = element('div', '', line);
				log.append(text);
				while(log.childElementCount > maxLines)log.firstElementChild?.remove();
				log.scrollTop = log.scrollHeight;
			};
			write('vibeOS JavaScript Terminal | Run vsu_help() for commands.');
			const frame = element('iframe');
			frame.sandbox.add('allow-scripts');
			frame.className = 'vo-app-terminal-sandbox';
			frame.setAttribute('aria-hidden', 'true');
			const token = Math.random().toString(36).slice(2) + Date.now();
			let ready = false;
			let sequence = 0;
			const waiting: {id: number; code: string}[] = [];
			const escapedToken = JSON.stringify(token);
			const script = [
				'const token = ' + escapedToken + ';',
				'const send = (type, id, text) => parent.postMessage({scope:"vo-terminal",token,type,id,text},"*");',
				'function vsu_help(){return "Commands: help(), vsu_help(), console.log(), clear() (terminal output clears from host). JavaScript runs in an isolated frame.";}',
				'const help = vsu_help;',
				'addEventListener("message", async event => {',
				' const item = event.data;',
				' if (!item || item.scope !== "vo-terminal" || item.token !== token || item.type !== "run") return;',
				' const old = console.log;',
				' console.log = (...args) => send("print", item.id, args.map(String).join(" "));',
				' try {',
				'  const result = await (0, eval)(item.code);',
				'  send("result", item.id, String(result));',
				' } catch(error) { send("error", item.id, String(error)); }',
				' finally {console.log = old;}',
				'});',
				'send("ready", 0, "");',
			].join('\n');
			// sandbox and CSP keep evaluated scripts out of the desktop origin
			frame.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;unsafe-inline&apos; &apos;unsafe-eval&apos;; connect-src &apos;none&apos;; form-action &apos;none&apos;"><script>' + script + '<' + '/script>';
			root.append(frame);
			const send = (item: {id: number; code: string}): void => {
				frame.contentWindow?.postMessage({scope: 'vo-terminal', token, type: 'run', ...item}, '*');
			};
			const onMessage = (event: MessageEvent): void => {
				const data = event.data;
				if(event.source !== frame.contentWindow || !data || data.scope !== 'vo-terminal' || data.token !== token)return;
				if(data.type === 'ready'){
					ready = true;
					waiting.splice(0).forEach(send);
				}else if(data.type === 'print' || data.type === 'result' || data.type === 'error'){
					write(String(data.text));
				}
			};
			window.addEventListener('message', onMessage);
			const history: string[] = [];
			let historyIndex = 0;
			form.addEventListener('submit', event => {
				event.preventDefault();
				const code = input.value.trim();
				if(!code)return;
				input.value = '';
				history.push(code);
				historyIndex = history.length;
				write('> ' + code);
				if(code === 'clear()' || code === 'clear'){
					log.replaceChildren();
					return;
				}
				const item = { id: ++sequence, code };
				if(ready)send(item);
				else waiting.push(item);
			});
			input.addEventListener('keydown', event => {
				if(event.key === 'ArrowUp' && historyIndex > 0){
					event.preventDefault();
					input.value = history[--historyIndex];
				}else if(event.key === 'ArrowDown' && historyIndex < history.length){
					event.preventDefault();
					input.value = history[++historyIndex] || '';
				}
			});
			input.focus();
			return () => window.removeEventListener('message', onMessage);
		},
	});
}

function markdownInline(parent: HTMLElement, content: string, api: DesktopAPI, base: string): void {
	const marks = ['![', '[', '**', '~~', '*', String.fromCharCode(96)];
	let remaining = content;
	while(remaining){
		let first = remaining.length;
		let marker = '';
		marks.forEach(value => {
			const index = remaining.indexOf(value);
			if(index >= 0 && index < first){
				first = index;
				marker = value;
			}
		});
		if(!marker){
			parent.append(document.createTextNode(remaining));
			break;
		}
		if(first > 0){
			parent.append(document.createTextNode(remaining.slice(0, first)));
			remaining = remaining.slice(first);
		}
		if(marker === '[' || marker === '!['){
			const close = remaining.indexOf('](', marker.length);
			const end = close < 0 ? -1 : remaining.indexOf(')', close + 2);
			if(end >= 0){
				const label = remaining.slice(marker.length, close);
				const href = remaining.slice(close + 2, end);
				try{
					const url = new URL(href, base);
					if(['https:', 'http:'].includes(url.protocol)){
						if(marker === '!['){
							const picture = element('img');
							picture.src = url.href;
							picture.alt = label;
							picture.loading = 'lazy';
							parent.append(picture);
						}else{
							const link = element('a', '', label);
							link.href = url.href;
							link.addEventListener('click', event => {
								event.preventDefault();
								api.openBrowser(url.href);
							});
							parent.append(link);
						}
						remaining = remaining.slice(end + 1);
						continue;
					}
				}catch{ /* invalid markdown link */ }
			}
		}else{
			const end = remaining.indexOf(marker, marker.length);
			if(end > marker.length){
				const value = remaining.slice(marker.length, end);
				const type = marker === '**' ? 'strong' : marker === '~~' ? 's' :
					marker === '*' ? 'em' : 'code';
				parent.append(element(type, '', value));
				remaining = remaining.slice(end + marker.length);
				continue;
			}
		}
		parent.append(document.createTextNode(marker));
		remaining = remaining.slice(marker.length);
	}
}

function renderMarkdown(source: string, api: DesktopAPI, base: string): HTMLElement {
	const article = element('article', 'vo-app-markdown');
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	let code: HTMLElement | null = null;
	const fence = String.fromCharCode(96).repeat(3);
	lines.forEach(line => {
		if(line.trimStart().startsWith(fence)){
			if(code){
				code = null;
			}else{
				const pre = element('pre');
				code = element('code');
				pre.append(code);
				article.append(pre);
			}
			return;
		}
		if(code){
			code.textContent += line + '\n';
			return;
		}
		if(!line.trim()){
			article.append(element('div', 'vo-app-md-space'));
			return;
		}
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if(heading){
			const headingTag = ('h' + heading[1].length) as keyof HTMLElementTagNameMap;
			const node = element(headingTag);
			markdownInline(node, heading[2], api, base);
			article.append(node);
			return;
		}
		if(/^\s*(---+|\*\*\*+)\s*$/.test(line)){
			article.append(element('hr'));
			return;
		}
		const item = /^\s*(?:[-*+] |\d+\. )(.*)$/.exec(line);
		if(item){
			const li = element('div', 'vo-app-md-list-item');
			const checked = /^\[([ xX])\]\s+/.exec(item[1]);
			if(checked){
				const box = element('input');
				box.type = 'checkbox';
				box.checked = checked[1].toLowerCase() === 'x';
				box.disabled = true;
				li.append(box);
				markdownInline(li, item[1].slice(checked[0].length), api, base);
			}else{
				markdownInline(li, item[1], api, base);
			}
			article.append(li);
			return;
		}
		if(/^> ?/.test(line)){
			const quote = element('blockquote');
			markdownInline(quote, line.replace(/^> ?/, ''), api, base);
			article.append(quote);
			return;
		}
		const paragraph = element('p');
		markdownInline(paragraph, line, api, base);
		article.append(paragraph);
	});
	return article;
}

const markdownExample = [
	'# Markdown in vibeOS',
	'',
	'Text can be **bold**, *italic*, ~~struck out~~ or in ' + String.fromCharCode(96) + 'inline code' + String.fromCharCode(96) + '.',
	'Paragraphs wrap to the window. Drag a window edge to see it reflow.',
	'',
	'> Quotes start with a >.',
	'',
	'## Links',
	'[Web links](https://example.com/) open in vibeBrowser.',
	'Local files are also available: [the readme](/README.md) and [the licence](/LICENSE.md).',
	'',
	'## Lists',
	'1. Numbered',
	'2. Lists',
	'- with bullets',
	'- [x] Task lists',
	'- [ ] With open items',
	'',
	'## Code',
	String.fromCharCode(96).repeat(3) + 'js',
	'const greeting = "Hello, vibeOS";',
	'console.log(greeting);',
	String.fromCharCode(96).repeat(3),
	'',
	'---',
	'![The default wallpaper](/tango/wallpapers/c.png)',
].join('\n');

function openMarkdown(api: DesktopAPI, title: string, file?: string, source = ''): void {
	api.openWindow({
		title,
		icon: iconUrl('mimetypes/24/text-x-generic.png'),
		width: 760,
		height: 520,
		minWidth: 300,
		minHeight: 160,
		render: win => {
			const root = pane(win.content, 'vo-app-doc-viewer');
			const status = element('p', '', 'Loading ' + (file || title) + '...');
			root.append(status);
			if(!file){
				root.replaceChildren(renderMarkdown(source, api, location.href));
				return;
			}
			const controller = new AbortController();
			void (async () => {
				try{
					const response = await fetch(file, {signal: controller.signal});
					if(!response.ok)throw new Error('HTTP ' + response.status);
					const content = await response.text();
					if(!controller.signal.aborted)root.replaceChildren(renderMarkdown(content, api, new URL(file, location.href).href));
				}catch(error){
					if(!controller.signal.aborted)status.textContent = 'Could not load ' + file + ': ' + String(error);
				}
			})();
			return () => controller.abort();
		},
	});
}

function openTranscript(api: DesktopAPI): void {
	const lines = [
		'this is a longggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg string',
		'i believe the windows height will change automatically to fit this long ass piece of text',
		'el pogger?',
		...Array.from({length: 10}, () => 'this is a longggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg string'),
		'okay as of finishing this demo it looks like it works so this can be used as a base for other apps',
	];
	api.openWindow({
		title: 'Demo transcript',
		icon: iconUrl('mimetypes/24/text-x-generic.png'),
		width: 700,
		height: 400,
		render: win => {
			const root = pane(win.content, 'vo-app-transcript');
			lines.forEach(line => root.append(element('p', '', line)));
		},
	});
}

function openWindowDemo(api: DesktopAPI): void {
	api.openWindow({
		title: 'spicy!',
		icon: iconUrl('categories/24/package_settings.png'),
		width: 500,
		height: 250,
		render: win => {
			const root = pane(win.content, 'vo-app-demo');
			const heading = element('h2', '', 'Window test');
			const status = message(root, 'This window uses native HTML controls.');
			append(root, heading, button('Click me!', () => {
				status.textContent = 'The button works! ' + new Date().toLocaleTimeString();
			}), button('Close', () => win.close()));
		},
	});
}

function openCatPicture(api: DesktopAPI): void {
	api.openWindow({
		title: 'CPAITC (Internet Cat Picture System)',
		icon: iconUrl('apps/16/pix.png'),
		width: 600,
		height: 450,
		render: win => {
			const root = pane(win.content, 'vo-app-cats');
			const status = message(root, 'Fetching a cat picture...');
			const picture = element('img');
			picture.alt = 'Cat from The Cat API';
			const refresh = button('Another cat', () => {void load();});
			append(root, picture, refresh);
			const controller = new AbortController();
			async function load(): Promise<void> {
				status.textContent = 'Fetching a cat picture...';
				try{
					const response = await fetch('https://api.thecatapi.com/v1/images/search', {signal: controller.signal});
					if(!response.ok)throw new Error('HTTP ' + response.status);
					const data = await response.json() as {url?: string; id?: string}[];
					if(!Array.isArray(data) || !data[0]?.url)throw new Error('No image returned');
					picture.src = data[0].url;
					status.textContent = 'Cat ID: ' + (data[0].id || 'unknown');
				}catch(error){
					if(!controller.signal.aborted)status.textContent = 'Could not fetch a cat: ' + String(error);
				}
			}
			void load();
			return () => controller.abort();
		},
	});
}

const vmGroups: {label: string; entries: [string, string][]}[] = [
	{label: 'Systems', entries: [
		['FreeDOS', 'freedos'], ['MS-DOS 4', 'msdos4'], ['Windows 1.01', 'windows1'],
		['KolibriOS', 'kolibri'], ['Linux 2.6', 'linux'], ['Linux 3', 'linux3'],
	]},
	{label: 'Online', entries: [
		['MS-DOS 6.22', 'msdos622'], ['Windows 3.1', 'windows31'], ['Windows 95', 'windows95'],
		['Windows 98', 'windows98'], ['Windows 2000', 'windows2000'],
	]},
	{label: 'Games', entries: [
		['Floppy Bird', 'floppybird'], ['TetrOS', 'tetros'], ['Invaders', 'invaders'],
		['Pillman', 'pillman'], ['bootRogue', 'bootrogue'], ['dino', 'dino'],
		['BootChess', 'bootchess'], ['DOOF', 'doof'],
	]},
];

function openVmProfiles(api: DesktopAPI): void {
	api.openWindow({
		title: 'Emulator Profiles',
		icon: iconUrl('apps/24/bash.png'),
		width: 600,
		height: 490,
		render: win => {
			const root = pane(win.content, 'vo-app-vm-profiles');
			vmGroups.forEach(group => {
				root.append(element('h2', '', group.label));
				const list = element('div', 'vo-app-profile-grid');
				group.entries.forEach(([name, profile]) => {
					list.append(button(name, () => api.openEmulator(profile)));
				});
				root.append(list);
			});
		},
	});
}

// the desktop accepts absolute HTTP(S) icons after validating their origin and protocol.
function siteIconForMenu(icon: string | undefined, fallback: string): string {
	if(!icon)return fallback;
	if(icon.startsWith('/tango/'))return icon;
	try{
		const value = new URL(icon);
		if(value.username || value.password)return fallback;
		if(value.protocol !== 'https:' && !(value.protocol === 'http:' && location.protocol === 'http:')){
			return fallback;
		}
		return value.href;
	}catch{
		return fallback;
	}
}

const refreshedBuiltins = new Set<string>();
const builtinSites = [
	'https://cojmar.github.io/nsvg/',
	'https://canvas.apps.chrome/',
	'https://duckduckgo.com/',
	'https://bing.com/',
	'/appfiles/2048/index.html',
	'/appfiles/tetris/index.html',
	'/appfiles/breakout/index.html',
];

function refreshBuiltinMetadata(): void {
	for(const value of builtinSites){
		const url = new URL(value, location.origin).href;
		if(refreshedBuiltins.has(url))continue;
		refreshedBuiltins.add(url);
		void inspectSite(url).catch(() => {
			// a proxied page may be readable later even when direct CORS is blocked
		});
	}
}

function webLauncher(api: DesktopAPI, label: string, url: string, fallback: string,
	width: number, height: number, defaultTitle = label): AppEntry {
	const info = cachedSiteInfo(url);
	const icon = siteIconForMenu(info?.icon, fallback);
	return {
		label,
		icon,
		description: info?.description || url,
		action: () => api.openWebApp(info?.title || defaultTitle, info?.startUrl || url, icon, width, height),
	};
}

function launchInstalledApp(api: DesktopAPI, site: InstalledSite): void {
	api.openWebApp(site.title, site.startUrl || site.url, siteIconForMenu(site.icon,
		'mimetypes/16/html.png'), 850, 600);
}

export function openAppManager(api: DesktopAPI): void {
	api.openWindow({
		title: 'App Manager',
		icon: iconUrl('categories/24/package_settings.png'),
		width: 720,
		height: 535,
		minWidth: 400,
		minHeight: 320,
		render: win => {
			const root = pane(win.content, 'vo-app-catalog');
			const intro = element('div', 'vo-app-catalog-header');
			append(intro, element('h2', '', 'Installed Apps'),
				element('p', '', 'STomp apps and PWAs appear in vibeOS. A PWA installed here is a vibeOS launcher, not a browser or device installation.'));
			const form = element('form', 'vo-app-catalog-install');
			const label = element('label', 'vo-app-catalog-field');
			label.append(element('span', '', 'Website URL'));
			const address = element('input', 'vo-app-input');
			address.type = 'url';
			address.placeholder = 'https://example.com/';
			address.required = true;
			address.autocomplete = 'on';
			label.append(address);
			const kindLabel = element('label', 'vo-app-catalog-field vo-app-catalog-kind');
			kindLabel.append(element('span', '', 'Install as'));
			const kind = element('select');
			const stomp = element('option', '', 'STomp App');
			stomp.value = 'stomp';
			const pwa = element('option', '', 'PWA launcher');
			pwa.value = 'pwa';
			kind.append(stomp, pwa);
			kindLabel.append(kind);
			const install = element('button', 'vo-app-button', 'Install');
			install.type = 'submit';
			const progress = element('div', 'vo-app-catalog-status');
			progress.setAttribute('role', 'status');
			append(form, label, kindLabel, install);
			const list = element('div', 'vo-app-catalog-list');
			list.setAttribute('aria-live', 'polite');
			append(root, intro, form, progress, list);
			const updateList = (): void => {
				list.replaceChildren();
				const apps = installedSites().slice().sort((a, b) => a.title.localeCompare(b.title));
				if(!apps.length){
					list.append(element('p', 'vo-app-catalog-empty', 'No apps installed yet. Enter a website URL above or install a site from vibeBrowser.'));
					return;
				}
				apps.forEach(site => {
					const card = element('article', 'vo-app-catalog-card');
					const picture = element('img', 'vo-app-catalog-icon');
					picture.alt = '';
					picture.src = siteIconForMenu(site.icon, '/tango/mimetypes/16/html.png');
					picture.loading = 'lazy';
					picture.addEventListener('error', () => {
						picture.src = '/tango/mimetypes/16/html.png';
					}, {once: true});
					const details = element('div', 'vo-app-catalog-details');
					const heading = element('h3', '', site.title);
					const kindName = element('span', 'vo-app-catalog-type', site.kind === 'stomp' ? 'STomp App' : 'PWA launcher');
					const website = element('div', 'vo-app-catalog-url', site.url);
					website.title = site.url;
					const summary = element('p', '', site.description || 'No description available');
					append(details, heading, kindName, website, summary);
					if(site.manifestUrl)details.append(element('p', 'vo-app-catalog-manifest', 'Manifest: ' + site.manifestUrl));
					const actions = element('div', 'vo-app-catalog-actions');
					append(actions,
						button('Open', () => launchInstalledApp(api, site)),
						button('Uninstall', () => {
							uninstallSite(site.id);
							progress.textContent = 'Uninstalled ' + site.title;
						}, 'vo-app-button vo-app-catalog-remove'),
					);
					append(card, picture, details, actions);
					list.append(card);
				});
			};
			form.addEventListener('submit', async event => {
				event.preventDefault();
				install.disabled = true;
				progress.textContent = 'Reading website metadata...';
				try{
					const installed = await installSite(address.value, kind.value as 'stomp' | 'pwa');
					progress.textContent = 'Installed ' + installed.title + ' as a ' +
						(installed.kind === 'pwa' ? 'vibeOS PWA launcher' : 'STomp app') + '.';
					address.value = '';
					updateList();
				}catch(error){
					progress.textContent = 'Could not install: ' + (error instanceof Error ? error.message : String(error));
				}finally{
					install.disabled = false;
				}
			});
			window.addEventListener('vibeos:apps-changed', updateList);
			updateList();
			return () => window.removeEventListener('vibeos:apps-changed', updateList);
		},
	});
}

export function createApplications(api: DesktopAPI): AppEntry[] {
	refreshBuiltinMetadata();
	const emulatorIcon = 'apps/16/bash.png';
	const gamesIcon = 'categories/16/applications-games.png';
	const docIcon = 'mimetypes/16/text-x-generic.png';
	const webIcon = 'mimetypes/16/html.png';
	const installedIcon = 'mimetypes/16/html.png';
	const installed = installedSites();
	const installedEntries = (kind: 'stomp' | 'pwa'): AppEntry[] => {
		const matching = installed.filter(site => site.kind === kind);
		if(!matching.length)return [{
			label: 'Install an app...',
			icon: 'categories/16/package_settings.png',
			action: () => openAppManager(api),
		}];
		return matching.map(site => ({
			label: site.title,
			icon: siteIconForMenu(site.icon, installedIcon),
			action: () => launchInstalledApp(api, site),
		}));
	};
	const game = (name: string, url: string, width: number, height: number): AppEntry => {
		const info = cachedSiteInfo(new URL(url, location.origin).href);
		const icon = siteIconForMenu(info?.icon, gamesIcon);
		return {
			label: name,
			icon,
			description: info?.description || `Play ${name}`,
			action: () => api.openWebApp(info?.title || name, url, icon, width, height),
		};
	};
	const vmGame = (name: string, profile: string): AppEntry => ({
		label: name, icon: gamesIcon, action: () => api.openEmulator(profile),
	});
	return [
		{label: 'Settings', icon: 'categories/16/configuration_section.png', children: [
			{label: 'vibeOS settings', icon: 'categories/16/package_settings.png', action: () => openSettings(api)},
			{label: 'Wallpaper Picker', icon: 'apps/24/preferences-desktop-wallpaper.png', action: () => openWallpaperPicker(api)},
		]},
		{label: 'Accessories', icon: 'categories/16/applications-accessories.png', children: [
			{label: 'Emulator', icon: emulatorIcon, action: () => api.openEmulator()},
			{label: 'Windows 95', icon: emulatorIcon, action: () => api.openEmulator('windows95')},
		]},
		{label: 'Graphics', icon: 'categories/16/applications-graphics.png', children: [
			webLauncher(api, 'Nsvg', 'https://cojmar.github.io/nsvg/', 'mimetypes/16/svg.png', 1000, 800),
			{label: 'Chrome Canvas',
				icon: siteIconForMenu(cachedSiteInfo('https://canvas.apps.chrome/')?.icon,
					'categories/16/applications-graphics.png'),
				action: () => api.openWebApp('Chrome Canvas', 'https://canvas.apps.chrome/',
					'categories/16/applications-graphics.png', 960, 680)},
		]},
		{label: 'Internet', icon: 'categories/16/applications-internet.png', children: [
			{label: 'vibeBrowser', icon: 'apps/16/internet-web-browser.png', action: () => api.openBrowser()},
			{label: 'CPAITC', icon: 'apps/16/pix.png', action: () => openCatPicture(api)},
		]},
		{label: 'Multimedia', icon: 'categories/16/applications-multimedia.png', children: []},
		{label: 'Office', icon: 'categories/16/applications-office.png', children: [
			{label: 'Text Editor', icon: 'categories/16/applications-office.png', action: () => openTextEditor(api)},
		]},
		{label: 'System', icon: 'categories/16/applications-system.png', children: [
			{label: 'JS Terminal', icon: emulatorIcon, action: () => openTerminal(api)},
		]},
		{label: 'Webviews', icon: webIcon, children: [
			webLauncher(api, 'DuckDuckGo', 'https://duckduckgo.com/', webIcon,
				800, 600, '[Proxied Webapp] DuckDuckGo'),
			webLauncher(api, 'Bing', 'https://bing.com/', webIcon,
				800, 600, '[Proxied Webapp] Bing'),
		]},
		{label: 'Demos', icon: 'mimetypes/16/gnome-package.png', children: [
			{label: 'windowtest1', icon: 'categories/16/package_settings.png', action: () => openWindowDemo(api)},
			{label: 'Transcript', icon: docIcon, action: () => openTranscript(api)},
			{label: 'Markdown', icon: docIcon, action: () => openMarkdown(api, 'Markdown demo', undefined, markdownExample)},
		]},
		{label: 'Games', icon: gamesIcon, children: [
			game('2048', '/appfiles/2048/index.html', 550, 800),
			game('Tetris', '/appfiles/tetris/index.html', 760, 740),
			game('Breakout', '/appfiles/breakout/index.html', 700, 570),
			vmGame('Floppy Bird', 'floppybird'),
			vmGame('TetrOS', 'tetros'),
			vmGame('Invaders', 'invaders'),
			vmGame('Pillman', 'pillman'),
			vmGame('bootRogue', 'bootrogue'),
			vmGame('dino', 'dino'),
			vmGame('BootChess', 'bootchess'),
			vmGame('DOOF', 'doof'),
		]},
		{label: 'System Docs', icon: docIcon, children: [
			{label: 'vibeOS Licence', icon: docIcon, action: () => openMarkdown(api, 'vibeOS Licence', '/LICENSE.md')},
			{label: 'vibeOS Readme', icon: docIcon, action: () => openMarkdown(api, 'vibeOS Readme', '/README.md')},
		]},
		{label: 'Installed Apps', icon: 'categories/16/package_settings.png', children: [
			{label: 'App Manager', icon: 'categories/16/package_settings.png',
				action: () => openAppManager(api)},
			{label: 'STomp Apps', icon: installedIcon, children: installedEntries('stomp')},
			{label: 'PWAs', icon: installedIcon, children: installedEntries('pwa')},
		]},
	];
}
