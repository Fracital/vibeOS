// v86 virtual machine, using the vendored core, BIOS and images in scripts/v86/.
import './emulator.css';
import type { DesktopAPI, DesktopWindow } from './types';
import { assetUrl } from './types';

type Disk = { url: string; size: number; async?: boolean; fixed_chunk_size?: number; use_parts?: boolean };
type Profile = {
	name: string;
	category: 'Systems' | 'Online' | 'Games';
	streamed?: boolean;
	fda?: Disk;
	hda?: Disk;
	cdrom?: Disk;
	initial_state?: { url: string };
	memory_size?: number;
	preserve_mac_from_state_image?: boolean;
};

type V86Options = {
	wasm_path: string;
	bios: { url: string };
	vga_bios: { url: string };
	screen_container: HTMLElement;
	screen: { use_graphical_text: boolean; scale: number };
	memory_size: number;
	vga_memory_size: number;
	network_relay_url: string;
	autostart: boolean;
} & Partial<Profile>;

interface V86Instance {
	add_listener(name: string, listener: (event: { total?: number; loaded?: number; file_name?: string }) => void): void;
	stop(): void | Promise<void>;
	run(): void;
	restart(): void;
	destroy(): void;
	is_running(): boolean;
	keyboard_set_status(enabled: boolean): void;
	keyboard_send_text(text: string): Promise<void>;
	keyboard_send_scancodes(scancodes: number[]): Promise<void>;
	mouse_set_status(enabled: boolean): void;
	lock_mouse(): void | Promise<void>;
	save_state(): Promise<ArrayBuffer>;
	restore_state(buffer: ArrayBuffer): Promise<void>;
}

type V86Constructor = new (options: V86Options) => V86Instance;
type CurlTransport = {
	load_wasm(path: string): Promise<void>;
	set_websocket(url: string): void;
	fetch(url: string, options?: RequestInit): Promise<Response>;
};

const v86Base = assetUrl('/scripts/v86/');
const disk = (name: string): string => `${v86Base}images/${name}`;
const remote = (name: string): string => `https://i.copy.sh/${name}`;
const wispEndpoint = 'wss://holywisp.fracit.al/';

const profiles: Record<string, Profile> = {
	freedos: { name: 'FreeDOS', category: 'Systems', fda: { url: disk('freedos722.img'), size: 737280 } },
	msdos4: { name: 'MS-DOS 4', category: 'Systems', fda: { url: disk('msdos4.img'), size: 1474560 } },
	windows1: { name: 'Windows 1.01', category: 'Systems', fda: { url: disk('windows101.img'), size: 1474560 } },
	kolibri: { name: 'KolibriOS', category: 'Systems', fda: { url: disk('kolibri.img'), size: 1474560 } },
	linux: { name: 'Linux 2.6', category: 'Systems', cdrom: { url: disk('linux.iso'), size: 5666816 } },
	linux3: { name: 'Linux 3', category: 'Systems', cdrom: { url: disk('linux3.iso'), size: 8638464 } },
	msdos622: { name: 'MS-DOS 6.22', category: 'Online', streamed: true, hda: { url: remote('msdos622/.img'), size: 67108864, async: true, fixed_chunk_size: 262144, use_parts: true } },
	windows31: { name: 'Windows 3.1', category: 'Online', streamed: true, hda: { url: remote('win31.img'), size: 34463744, async: false } },
	windows95: { name: 'Windows 95', category: 'Online', streamed: true, hda: { url: remote('windows95-v3/.img'), size: 471859200, async: true, fixed_chunk_size: 262144, use_parts: true } },
	windows98: { name: 'Windows 98', category: 'Online', streamed: true, preserve_mac_from_state_image: true, memory_size: 128 * 1024 * 1024, hda: { url: remote('windows98/.img'), size: 314572800, async: true, fixed_chunk_size: 262144, use_parts: true }, initial_state: { url: remote('windows98_state-v2.bin.zst') } },
	windows2000: { name: 'Windows 2000', category: 'Online', streamed: true, preserve_mac_from_state_image: true, memory_size: 512 * 1024 * 1024, hda: { url: remote('windows2k-v2/.img'), size: 2147483648, async: true, fixed_chunk_size: 262144, use_parts: true }, initial_state: { url: remote('windows2k_state-v4.bin.zst') } },
	floppybird: { name: 'Floppy Bird', category: 'Games', fda: { url: disk('floppybird.img'), size: 1474560 } },
	tetros: { name: 'TetrOS', category: 'Games', fda: { url: disk('tetros.img'), size: 512 } },
	invaders: { name: 'Invaders', category: 'Games', fda: { url: disk('invaders.img'), size: 512 } },
	pillman: { name: 'Pillman', category: 'Games', fda: { url: disk('pillman.img'), size: 512 } },
	bootrogue: { name: 'bootRogue', category: 'Games', fda: { url: disk('bootrogue.img'), size: 512 } },
	dino: { name: 'dino', category: 'Games', fda: { url: disk('bootdino.img'), size: 512 } },
	bootchess: { name: 'BootChess', category: 'Games', fda: { url: disk('bootchess.img'), size: 1474560 } },
	doof: { name: 'DOOF', category: 'Games', fda: { url: disk('doof-1440.img'), size: 1474560 } },
};

let active: { window: DesktopWindow; load(profile: string): void } | null = null;
let v86ScriptPromise: Promise<void> | null = null;
let curlScriptPromise: Promise<void> | null = null;
let curlPromise: Promise<CurlTransport> | null = null;
let relayInstalled = false;

function getV86(): V86Constructor | undefined {
	return (window as Window & { V86?: V86Constructor }).V86;
}

function getCurl(): CurlTransport | undefined {
	return (window as Window & { libcurl?: CurlTransport }).libcurl;
}

function appendScript(url: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = url;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`Could not load ${url}`));
		document.head.appendChild(script);
	});
}

async function ensureV86(): Promise<V86Constructor> {
	if (!getV86()) {
		v86ScriptPromise ??= appendScript(`${v86Base}libv86.js`).catch((error: unknown) => {
			v86ScriptPromise = null;
			throw error;
		});
		await v86ScriptPromise;
	}
	const constructor = getV86();
	if (!constructor) throw new Error('The v86 emulator core is missing');
	return constructor;
}

async function ensureCurl(): Promise<CurlTransport> {
	if (curlPromise) return curlPromise;
	curlPromise = (async () => {
		if (!getCurl()) {
			curlScriptPromise ??= appendScript(assetUrl('/scripts/net/libcurl.js')).catch((error: unknown) => {
				curlScriptPromise = null;
				throw error;
			});
			await curlScriptPromise;
		}
		const curl = getCurl();
		if (!curl) throw new Error('libcurl transport is missing');
		await curl.load_wasm(assetUrl('/scripts/net/libcurl.wasm'));
		curl.set_websocket(wispEndpoint);
		return curl;
	})().catch((error: unknown) => {
		curlPromise = null;
		throw error;
	});
	return curlPromise;
}

function installCopyShRelay(): void {
	if (relayInstalled) return;
	const NativeXHR = window.XMLHttpRequest;
	const matches = (url: string): boolean => {
		try {
			return ['copy.sh', 'i.copy.sh', 'c.copy.sh'].includes(new URL(url, location.href).hostname);
		} catch {
			return false;
		}
	};
	const setState = (xhr: XMLHttpRequest, values: Record<string, unknown>) => {
		for (const [name, value] of Object.entries(values)) {
			Object.defineProperty(xhr, name, { value, configurable: true, writable: true });
		}
	};
	const trigger = (xhr: XMLHttpRequest, name: string, progress?: ProgressEventInit) => {
		xhr.dispatchEvent(progress ? new ProgressEvent(name, progress) : new Event(name));
	};
	const PatchedXHR = function (): XMLHttpRequest {
		const xhr = new NativeXHR();
		const originalOpen = xhr.open.bind(xhr) as (...args: unknown[]) => void;
		const originalHeader = xhr.setRequestHeader.bind(xhr);
		const originalSend = xhr.send.bind(xhr);
		const originalAbort = xhr.abort.bind(xhr);
		const originalResponseHeader = xhr.getResponseHeader.bind(xhr);
		const originalResponseHeaders = xhr.getAllResponseHeaders.bind(xhr);
		let request: { method: string; url: string; headers: Record<string, string>; abort: AbortController; response?: Response } | null = null;
		(xhr as XMLHttpRequest & { open: (...args: unknown[]) => void }).open = (method: unknown, url: unknown, ...args: unknown[]) => {
			if (!matches(String(url))) {
				request = null;
				originalOpen(method, url, ...args);
				return;
			}
			if (args[0] === false) throw new Error('Synchronous requests are unavailable for streamed VM disks');
			request = { method: String(method).toUpperCase(), url: new URL(String(url), location.href).href, headers: {}, abort: new AbortController() };
			setState(xhr, { readyState: 1, status: 0, response: null, responseURL: request.url });
			trigger(xhr, 'readystatechange');
		};
		xhr.setRequestHeader = (name, value) => {
			if (!request) return originalHeader(name, value);
			if (name.toLowerCase() !== 'x-accept-encoding') request.headers[name] = value;
		};
		xhr.getResponseHeader = (name) => request ? request.response?.headers.get(name) ?? null : originalResponseHeader(name);
		xhr.getAllResponseHeaders = () => request ? [...(request.response?.headers.entries() ?? [])].map(([key, value]) => `${key}: ${value}`).join('\r\n') : originalResponseHeaders();
		xhr.abort = () => {
			if (!request) return originalAbort();
			request.abort.abort();
			trigger(xhr, 'abort');
			trigger(xhr, 'loadend');
		};
		xhr.send = (body) => {
			if (!request) return originalSend(body);
			const item = request;
			void (async () => {
				try {
					const curl = await ensureCurl();
					if (item.abort.signal.aborted) return;
					const requestBody = body instanceof Document ? new XMLSerializer().serializeToString(body) : body;
					const response = await curl.fetch(item.url, { method: item.method, headers: { 'Accept-Encoding': 'identity', ...item.headers }, body: requestBody ?? undefined, signal: item.abort.signal });
					item.response = response;
					setState(xhr, { readyState: 2, status: response.status, statusText: response.statusText });
					trigger(xhr, 'readystatechange');
					const total = Number(response.headers.get('content-length')) || 0;
					const chunks: Uint8Array[] = [];
					let loaded = 0;
					if (response.body) {
						const reader = response.body.getReader();
						for (;;) {
							const part = await reader.read();
							if (part.done) break;
							chunks.push(part.value);
							loaded += part.value.byteLength;
							trigger(xhr, 'progress', { lengthComputable: total > 0, loaded, total });
						}
					}
					if (item.abort.signal.aborted) return;
					const bytes = new Uint8Array(loaded);
					let offset = 0;
					for (const chunk of chunks) {
						bytes.set(chunk, offset);
						offset += chunk.byteLength;
					}
					const text = () => new TextDecoder().decode(bytes);
					const result: unknown = xhr.responseType === 'json' ? JSON.parse(text()) : xhr.responseType === 'text' || xhr.responseType === '' ? text() : xhr.responseType === 'blob' ? new Blob([bytes]) : bytes.buffer;
					setState(xhr, { readyState: 4, response: result, responseText: typeof result === 'string' ? result : undefined });
					trigger(xhr, 'readystatechange');
					trigger(xhr, 'load');
					trigger(xhr, 'loadend');
				} catch (error) {
					if (item.abort.signal.aborted) return;
					console.error('v86 disk relay:', item.url, error);
					setState(xhr, { readyState: 4, status: 0 });
					trigger(xhr, 'readystatechange');
					trigger(xhr, 'error');
					trigger(xhr, 'loadend');
				}
			})();
		};
		return xhr;
	} as unknown as typeof XMLHttpRequest;
	PatchedXHR.prototype = NativeXHR.prototype;
	window.XMLHttpRequest = PatchedXHR;
	relayInstalled = true;
}

function labeledButton(label: string, title?: string): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = label;
	if (title) button.title = title;
	return button;
}

export function launchEmulator(api: DesktopAPI, profile = 'freedos'): void {
	if (active) {
		if (profiles[profile]) active.load(profile);
		active.window.focus();
		return;
	}
	const initial = profiles[profile] ? profile : 'freedos';
	api.openWindow({
		title: 'Emulator',
		icon: 'apps/24/bash.png',
			width: 640,
			height: 435,
		y: 26,
		minWidth: 380,
		minHeight: 260,
			resizable: false,
		render: (win) => {
			const root = document.createElement('div');
			root.className = 'vibe-emulator';
				const statusIcon = document.createElement('img');
				statusIcon.className = 'vibe-emulator-player-status';
				statusIcon.src = assetUrl('/tango/actions/24/player_play.png');
				statusIcon.alt = '';
				statusIcon.setAttribute('aria-hidden', 'true');
				win.element.querySelector('.vo-titlebar')?.append(statusIcon);
				win.controls.querySelector<HTMLElement>('.vo-window-minimize')?.style.setProperty('display', 'none');
				win.controls.querySelector<HTMLElement>('.vo-window-maximize')?.style.setProperty('display', 'none');
			const toolbar = document.createElement('div');
			toolbar.className = 'vibe-emulator-toolbar';
			const selector = document.createElement('select');
			selector.className = 'vibe-emulator-profile';
			selector.setAttribute('aria-label', 'Operating system or game');
			for (const category of ['Systems', 'Online', 'Games'] as const) {
				const group = document.createElement('optgroup');
				group.label = category;
				for (const [key, item] of Object.entries(profiles)) {
					if (item.category !== category) continue;
					const option = document.createElement('option');
					option.value = key;
					option.textContent = item.name;
					group.appendChild(option);
				}
				selector.appendChild(group);
			}
			selector.value = initial;
			const run = labeledButton('Run');
			const pause = labeledButton('Pause');
			const reboot = labeledButton('Reboot');
			const lock = labeledButton('Lock cursor');
			const save = labeledButton('Save state');
			const load = labeledButton('Load state');
				const saveFile = labeledButton('Save File');
				const loadFile = labeledButton('Load File');
				const keyboard = labeledButton('Keyboard Input...');
			const stateFile = document.createElement('input');
			stateFile.type = 'file';
			stateFile.accept = '.bin,application/octet-stream';
			stateFile.hidden = true;
				selector.hidden = true;
				const menus: HTMLDetailsElement[] = [];
				const createMenu = (name: string, actions: HTMLButtonElement[]): HTMLDetailsElement => {
					const menu = document.createElement('details');
					menu.className = 'vibe-emulator-menu';
					const summary = document.createElement('summary');
					summary.textContent = name;
					const popup = document.createElement('div');
					popup.className = 'vibe-emulator-menu-popup';
					for(const action of actions){
						action.classList.add('vibe-emulator-menu-item');
						action.addEventListener('click', () => {menu.open = false;});
						popup.append(action);
					}
					menu.append(summary, popup);
					menu.addEventListener('toggle', () => {
						if(menu.open)for(const other of menus)if(other !== menu)other.open = false;
					});
					menus.push(menu);
					return menu;
				};
				const profileMenu = (category: Profile['category']): HTMLDetailsElement => {
					const entries = Object.entries(profiles).filter(([, item]) => item.category === category);
					return createMenu(category, entries.map(([key, item]) => {
						const action = labeledButton(item.name);
						action.addEventListener('click', () => loadProfile(key));
						return action;
					}));
				};
				toolbar.append(
					selector,
					createMenu('VM', [run, pause, reboot, lock, keyboard]),
					createMenu('State', [save, load, saveFile, loadFile]),
					profileMenu('Systems'),
					profileMenu('Online'),
					profileMenu('Games'),
					stateFile,
				);
			const viewport = document.createElement('div');
			viewport.className = 'vibe-emulator-viewport';
			const screen = document.createElement('div');
			screen.className = 'vibe-emulator-screen';
			screen.tabIndex = 0;
			screen.setAttribute('aria-label', 'Emulator display. Click to type into the guest.');
			viewport.appendChild(screen);
			const footer = document.createElement('div');
			footer.className = 'vibe-emulator-footer';
			const status = document.createElement('span');
			status.className = 'vibe-emulator-status';
			status.setAttribute('role', 'status');
			const keyText = document.createElement('input');
			keyText.type = 'text';
			keyText.className = 'vibe-emulator-text';
			keyText.placeholder = 'Type text into VM';
			keyText.setAttribute('aria-label', 'Text to send to emulator');
			const send = labeledButton('Send');
			const ctrlAltDel = labeledButton('Ctrl+Alt+Del');
				footer.append(keyText, send, ctrlAltDel);
				toolbar.append(status);
			root.append(toolbar, viewport, footer);
			win.content.appendChild(root);

			let instance: V86Instance | null = null;
			let closed = false;
			let generation = 0;
			let operation = Promise.resolve();
				const tell = (text: string) => {
					if(closed)return;
					status.textContent = text;
					statusIcon.src = text.startsWith('Running ') || instance?.is_running() ?
						assetUrl('/tango/actions/24/player_pause.png') : assetUrl('/tango/actions/24/player_play.png');
				};
			const enableKeys = () => {
				if (instance) instance.keyboard_set_status(document.activeElement === screen && instance.is_running());
			};
			const resetScreen = () => {
				const text = document.createElement('div');
				text.className = 'vibe-emulator-text-screen';
				const canvas = document.createElement('canvas');
				canvas.width = 640;
				canvas.height = 400;
				screen.replaceChildren(text, canvas);
			};
				const resizeToScreen = () => {
					if(closed)return;
					const canvas = screen.querySelector('canvas');
					if(!canvas)return;
					const sw = canvas.width || 640;
					const sh = canvas.height || 400;
					const maxW = Math.max(1, window.innerWidth - 20);
					const maxH = Math.max(1, window.innerHeight - 26 - 30 - 25 - 20);
					const scale = Math.min(sw <= 400 && sh <= 300 ? 2 : 1, maxW / sw, maxH / sh);
					const drawW = Math.max(1, Math.round(sw * scale));
					const drawH = Math.max(1, Math.round(sh * scale));
					win.setSize(Math.max(640, drawW), drawH + 25 + 10 + 20);
				};
				const screenObserver = new MutationObserver(resizeToScreen);
				screenObserver.observe(screen, {attributes: true, attributeFilter: ['width', 'height'], childList: true, subtree: true});
				const onViewportResize = () => resizeToScreen();
				window.addEventListener('resize', onViewportResize);
			const destroy = async () => {
				const old = instance;
				instance = null;
				if (!old) return;
				try { await old.stop(); } catch (error) { console.error('v86 stop:', error); }
				try { old.destroy(); } catch (error) { console.error('v86 destroy:', error); }
			};
			const loadProfile = (selected: string) => {
				const item = profiles[selected];
				if (!item) return;
				selector.value = selected;
				const sequence = ++generation;
				operation = operation.catch(() => {}).then(async () => {
					await destroy();
					if (closed || sequence !== generation) return;
					tell(`Loading ${item.name}...`);
					try {
						if (item.streamed) {
							tell(`Connecting to relay for ${item.name}...`);
							await ensureCurl();
							installCopyShRelay();
						}
						const Constructor = await ensureV86();
						if (closed || sequence !== generation) return;
						resetScreen();
							resizeToScreen();
						const { name: _name, category: _category, streamed: _streamed, ...options } = item;
						const vm = new Constructor({
							wasm_path: `${v86Base}v86.wasm`,
							bios: { url: `${v86Base}bios/seabios.bin` },
							vga_bios: { url: `${v86Base}bios/vgabios.bin` },
							screen_container: screen,
							screen: { use_graphical_text: true, scale: 1 },
							memory_size: 64 * 1024 * 1024,
							vga_memory_size: 8 * 1024 * 1024,
							network_relay_url: wispEndpoint.replace(/^wss:/, 'wisps:').replace(/^ws:/, 'wisp:'),
							autostart: true,
							...options,
						});
						instance = vm;
						vm.add_listener('download-progress', (event) => {
							if (generation === sequence && event.total) tell(`Downloading ${event.file_name ?? 'disk'} ${Math.round((event.loaded ?? 0) / event.total * 100)}%`);
						});
						vm.add_listener('download-error', (event) => { if (generation === sequence) tell(`Failed to download ${event.file_name ?? 'disk'}`); });
						vm.add_listener('emulator-ready', () => { if (generation === sequence) tell(`${item.name} ready`); });
						vm.add_listener('emulator-started', () => { if (generation === sequence) tell(`Running ${item.name}`); });
						vm.add_listener('emulator-stopped', () => { if (generation === sequence) tell(`${item.name} stopped`); });
					} catch (error) {
						if (generation === sequence && !closed) tell(`Cannot start ${item.name}: ${String(error instanceof Error ? error.message : error)}`);
					}
				});
			};
			active = { window: win, load: loadProfile };
			selector.addEventListener('change', () => loadProfile(selector.value));
			run.addEventListener('click', () => { if (instance) instance.run(); else loadProfile(selector.value); });
			pause.addEventListener('click', () => { if (instance) instance.stop(); });
			reboot.addEventListener('click', () => { if (instance) instance.restart(); });
			lock.addEventListener('click', () => { if (instance) { instance.mouse_set_status(true); void instance.lock_mouse(); } });
			screen.addEventListener('pointerdown', () => { screen.focus(); enableKeys(); });
			screen.addEventListener('focus', enableKeys);
			screen.addEventListener('blur', () => { if (instance) instance.keyboard_set_status(false); });
			const sendText = async () => {
				if (!instance || !keyText.value) return;
				try { await instance.keyboard_send_text(keyText.value); keyText.value = ''; } catch (error) { tell(`Keyboard input failed: ${String(error)}`); }
			};
			send.addEventListener('click', () => void sendText());
			keyText.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void sendText(); } });
			ctrlAltDel.addEventListener('click', () => {
				if (instance) void instance.keyboard_send_scancodes([0x1d, 0x38, 0x53, 0xd3, 0xb8, 0x9d]);
			});
			let savedState: ArrayBuffer | null = null;
			save.addEventListener('click', async () => {
				if(!instance)return;
				try{
					savedState = await instance.save_state();
					tell('Saved state (' + Math.round(savedState.byteLength / 1024) + ' KB)');
				}catch(error){tell('Save failed: ' + String(error));}
			});
			load.addEventListener('click', async () => {
				if(!instance || !savedState){tell('Nothing saved yet');return;}
				try{
					await instance.stop();
					await instance.restore_state(savedState);
					instance.run();
					tell('State restored');
				}catch(error){tell('Restore failed: ' + String(error));}
			});
			saveFile.addEventListener('click', async () => {
				if (!instance) return;
				try {
					const data = await instance.save_state();
					if (closed) return;
					const objectURL = URL.createObjectURL(new Blob([data]));
					const anchor = document.createElement('a');
					anchor.href = objectURL;
					anchor.download = `${selector.value}.v86state.bin`;
					anchor.click();
					URL.revokeObjectURL(objectURL);
					tell('State saved');
				} catch (error) { tell(`Save failed: ${String(error)}`); }
			});
			loadFile.addEventListener('click', () => stateFile.click());
			keyboard.addEventListener('click', () => root.classList.toggle('vibe-emulator-keyboard-open'));
			stateFile.addEventListener('change', async () => {
					const file = stateFile.files?.[0];
					stateFile.value = '';
					if (!file || !instance) return;
					const vm = instance;
					try {
						const data = await file.arrayBuffer();
						if (vm !== instance || closed) return;
						await vm.stop();
						await vm.restore_state(data);
						vm.run();
						tell('State restored');
					} catch (error) { tell(`Restore failed: ${String(error)}`); }
			});
			resetScreen();
			resizeToScreen();
			loadProfile(initial);
			return () => {
				closed = true;
				screenObserver.disconnect();
				window.removeEventListener('resize', onViewportResize);
				generation++;
				if (active?.window === win) active = null;
				void operation.then(destroy, destroy);
			};
		},
	});
}
