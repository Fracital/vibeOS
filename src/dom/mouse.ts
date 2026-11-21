import type { DesktopAPI } from './types';
import './mouse.css';

export type MouseTheme = 'kittydog' | 'tango' | 'system';

export interface MouseSettings {
	theme: MouseTheme;
	sensitivity: number;
}

const storageKey = 'vibeos.mouse.settings';
const themes: Array<{id: MouseTheme; name: string; note: string; preview: string}> = [
	{id: 'kittydog', name: 'Kittydog Crystal', note: 'Colorful crystal pointer', preview: '/cursors/kittydog/left_ptr.png'},
	{id: 'tango', name: 'Tango Classic', note: 'Original vibeOS cursors', preview: '/cursors/tango/pointer.png'},
	{id: 'system', name: 'System Default', note: 'Use your browser pointer', preview: '/tango/devices/32/input-mouse.png'},
];

export const readMouseSettings = (): MouseSettings => {
	const defaults: MouseSettings = {theme: 'kittydog', sensitivity: 1};
	try {
		const value: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null');
		if(value === null || typeof value !== 'object')return defaults;
		const record = value as Record<string, unknown>;
		const theme = themes.some((item) => item.id === record.theme) ? record.theme as MouseTheme : defaults.theme;
		const sensitivity = typeof record.sensitivity === 'number' && Number.isFinite(record.sensitivity)
			? Math.min(2, Math.max(0.5, record.sensitivity)) : defaults.sensitivity;
		return {theme, sensitivity};
	} catch {
		return defaults;
	}
};

export const saveMouseSettings = (settings: MouseSettings): void => {
	try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* storage unavailable */ }
	window.dispatchEvent(new CustomEvent<MouseSettings>('vibeos:mouse-changed', {detail: settings}));
};

export const applyMouseSettings = (root: HTMLElement, settings: MouseSettings): void => {
	root.dataset.cursorTheme = settings.theme;
	root.style.setProperty('--vo-drag-response', String(settings.sensitivity));
};

const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag);
	if(className)node.className = className;
	if(text)node.textContent = text;
	return node;
};

export function openMouseSettings(api: DesktopAPI): void {
	api.openWindow({
		title: 'Mouse and Touchpad',
		icon: 'devices/24/input-mouse.png',
		width: 490,
		height: 390,
		minWidth: 380,
		minHeight: 320,
		render(win) {
			const settings = readMouseSettings();
			const root = create('div', 'vo-mouse-settings');
			const heading = create('h2', '', 'Pointer theme');
			const cards = create('div', 'vo-mouse-theme-list');
			const selected: HTMLInputElement[] = [];
			const previews: HTMLImageElement[] = [];
			for(const item of themes) {
				const card = create('label', 'vo-mouse-theme-card');
				const input = create('input');
				input.type = 'radio';
				input.name = 'vibeos-mouse-theme-' + win.element.dataset.windowId;
				input.value = item.id;
				input.checked = settings.theme === item.id;
				const preview = create('img', 'vo-mouse-theme-icon');
				preview.src = item.preview;
				preview.alt = `${item.name} mouse pointer`;
				const name = create('span', 'vo-mouse-theme-label', item.name);
				name.append(create('small', '', item.note));
				card.append(input, preview, name);
				input.addEventListener('change', () => {
					if(!input.checked)return;
					settings.theme = item.id;
					saveMouseSettings(settings);
					updatePreview();
				});
				cards.append(card);
				selected.push(input);
				previews.push(preview);
			}
			const previewArea = create('div', 'vo-mouse-preview');
			previewArea.setAttribute('tabindex', '0');
			previewArea.setAttribute('aria-label', 'Test the selected mouse pointer here');
			const previewIcon = create('img', 'vo-mouse-preview-icon');
			const previewText = create('div', '', 'Move your pointer over this area to preview the selected theme');
			previewArea.append(previewIcon, previewText);
			const speedRow = create('div', 'vo-mouse-speed');
			const speedLabel = create('label', 'vo-mouse-speed-label', 'Pointer acceleration');
			const speedRange = create('input');
			speedRange.type = 'range';
			speedRange.min = '50';
			speedRange.max = '200';
			speedRange.step = '5';
			speedRange.value = String(Math.round(settings.sensitivity * 100));
			speedRange.id = `vo-mouse-speed-${win.element.dataset.windowId}`;
			speedLabel.htmlFor = speedRange.id;
			const speedValue = create('output', 'vo-mouse-speed-value');
			const updateSpeed = () => {
				settings.sensitivity = Number(speedRange.value) / 100;
				speedValue.textContent = `${settings.sensitivity.toFixed(2)}×`;
				saveMouseSettings(settings);
			};
			speedRange.addEventListener('input', updateSpeed);
			speedValue.textContent = `${settings.sensitivity.toFixed(2)}×`;
			speedRow.append(speedLabel, speedRange, speedValue);
			const note = create('p', 'vo-mouse-limitation', 'Pointer response applies to vibeOS window dragging. Browser security does not allow a website to change your operating system mouse acceleration.');
			const reset = create('button', 'vo-mouse-reset', 'Restore defaults');
			reset.type = 'button';
			reset.addEventListener('click', () => {
				settings.theme = 'kittydog';
				settings.sensitivity = 1;
				speedRange.value = '100';
				speedValue.textContent = '1.00×';
				saveMouseSettings(settings);
				updatePreview();
			});
			const updatePreview = () => {
				for(const input of selected)input.checked = input.value === settings.theme;
				previewArea.dataset.cursorTheme = settings.theme;
				previewIcon.src = themes.find((item) => item.id === settings.theme)?.preview ?? themes[0].preview;
			};
			root.append(heading, cards, create('h2', '', 'Preview'), previewArea, speedRow, note, reset);
			win.content.append(root);
			updatePreview();
		},
	});
}
