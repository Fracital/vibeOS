import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 9357;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sizeOption = process.argv.find(arg => arg.startsWith('--size='))?.slice('--size='.length);
const dimensions = sizeOption == null ? [1366, 768] : sizeOption.split('x').map(Number);
if(dimensions.length !== 2 || dimensions.some(value => !Number.isInteger(value) || value < 320 || value > 4096)){
	throw new Error('Expected --size=WIDTHxHEIGHT with dimensions from 320 to 4096');
}
const [viewportWidth, viewportHeight] = dimensions;
const imageSuffix = sizeOption == null ? '' : '-' + viewportWidth + 'x' + viewportHeight;

class CDP {
	constructor(socket) {
		this.socket = socket;
		this.pending = new Map();
		this.nextId = 1;
		this.errors = [];
		socket.addEventListener('message', event => {
			const result = JSON.parse(event.data);
			if(result.method === 'Runtime.exceptionThrown') {
				this.errors.push(result.params.exceptionDetails.text + ': ' + (result.params.exceptionDetails.exception?.description ?? ''));
			}
			if(result.method === 'Runtime.consoleAPICalled' && result.params.type === 'error') {
				this.errors.push(result.params.args.map(arg => arg.value ?? arg.description).join(' '));
			}
			if(!result.id)return;
			const pending = this.pending.get(result.id);
			if(!pending)return;
			this.pending.delete(result.id);
			if(result.error)pending.reject(new Error(JSON.stringify(result.error)));
			else pending.resolve(result.result);
		});
	}
	static async connect(url) {
		const socket = new WebSocket(url);
		await new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, { once: true });
			socket.addEventListener('error', reject, { once: true });
		});
		return new CDP(socket);
	}
	request(method, params = {}) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error('DevTools timed out: ' + method));
			}, 15000);
			this.pending.set(id, {
				resolve: value => { clearTimeout(timer); resolve(value); },
				reject: error => { clearTimeout(timer); reject(error); },
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}
	async evaluate(expression) {
		const response = await this.request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
		if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));
		return response.result.value;
	}
	async screenshot(path) {
		const screenshot = await this.request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
		await writeFile(path, Buffer.from(screenshot.data, 'base64'));
	}
	async click(x, y) {
		await this.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
		await this.request('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
		await this.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
	}
}

async function testDom(cdp, name) {
	const shot = state => cdp.screenshot('.parity/' + name + '-' + state + imageSuffix + '.png');
	const readWindows = () => cdp.evaluate('({windows: [...document.querySelectorAll(".vo-window-title")].map(e => e.textContent), geometry: [...document.querySelectorAll(".vo-window")].map(w => ({x: w.offsetLeft, y: w.offsetTop, width: w.getBoundingClientRect().width, height: w.getBoundingClientRect().height})), failed: !!document.querySelector(".vo-window-error"), iframes: [...document.querySelectorAll(".vo-window iframe")].map(f => ({src: f.src ? new URL(f.src).pathname : null, loaded: !!f.contentDocument?.body?.children.length}))})');
	const closeWindows = () => cdp.evaluate('[...document.querySelectorAll(".vo-window-close")].forEach(b => b.click())');
	const launch = async (category, entry) => {
		const result = await cdp.evaluate('(() => { const buttons = [...document.querySelectorAll(".vo-menu-item")]; const find = text => buttons.find(b => b.textContent.trim().replace(/▸/g, "").trim() === text); document.querySelector(".vo-applications").click(); const category = find(' + JSON.stringify(category) + '); if(!category)return "missing category"; category.click(); const target = find(' + JSON.stringify(entry) + '); if(!target)return "missing entry"; target.click(); return "ok"; })()');
		if(result !== 'ok')throw new Error('DOM menu failed ' + category + '/' + entry + ': ' + result);
	};
	const initial = await cdp.evaluate('({title: document.title, mode: "dom", panel: !!document.querySelector(".vo-panel"), wallpaper: getComputedStyle(document.querySelector(".vo-wallpaper")).backgroundImage, windows: document.querySelectorAll(".vo-window").length, menuCategories: document.querySelectorAll(".vo-application-menu > .vo-menu-entry").length})');
	await shot('desktop');
	await cdp.click(55, 12);
	await delay(200);
	const menuOpen = await cdp.evaluate('!document.querySelector(".vo-application-menu").hidden');
	await shot('menu');
	await cdp.evaluate('(() => {const b=[...document.querySelectorAll(".vo-menu-item")]; b.find(e => e.textContent.includes("Settings")).click();b.find(e => e.textContent.trim()==="vibeOS settings").click()})()');
	await delay(300);
	const settings = await readWindows();
	await shot('settings');
	await closeWindows();
	const scenarios = [];
	for(const [category, entry, key] of [
		['Office', 'Text Editor', 'text-editor'],
		['System', 'JS Terminal', 'js-terminal'],
		['Settings', 'Wallpaper Picker', 'wallpaper-picker'],
		['Games', '2048', '2048'],
		['Games', 'Tetris', 'tetris'],
		['Games', 'Breakout', 'breakout'],
	]) {
		await launch(category, entry);
		await delay(550);
		scenarios.push({entry, ...await readWindows()});
		await shot(key);
		await closeWindows();
	}
	await launch('Webviews', 'DuckDuckGo');
	await delay(900);
	scenarios.push({
		entry: 'Proxied DuckDuckGo webview',
		...await readWindows(),
		status: await cdp.evaluate('document.querySelector(".vo-web-app-status")?.textContent ?? null'),
	});
	await shot('webview');
	await closeWindows();
	await launch('Games', 'Floppy Bird');
	await delay(3500);
	scenarios.push({entry: 'Floppy Bird VM', ...await readWindows(), result: await cdp.evaluate('document.querySelector(".vo-emulator-status")?.textContent ?? null')});
	await shot('vm');
	await closeWindows();
	await launch('Internet', 'vibeBrowser');
	await delay(8000);
	scenarios.push({entry: 'vibeBrowser', ...await readWindows(), proxyNotice: await cdp.evaluate('document.querySelector(".vibe-browser-status")?.textContent ?? null')});
	await shot('browser');
	await closeWindows();
	return {name, initial, menuOpen, settings, scenarios, errors: cdp.errors};
}

const chrome = spawn('google-chrome', [
	'--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
	'--remote-debugging-port=' + port, '--remote-allow-origins=*',
	'--user-data-dir=/tmp/vibeos-parity-chrome', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

try {
	await mkdir('.parity', { recursive: true });
	let ready = false;
	for(let attempt = 0; attempt < 80; attempt++) {
		try {
			const response = await fetch('http://127.0.0.1:' + port + '/json/version');
			if(response.ok) {
				ready = true;
				break;
			}
		} catch {}
		await delay(150);
	}
	if(!ready)throw new Error('Chrome debugging endpoint unavailable');

	const only = process.argv.find(arg => arg.startsWith('--only='))?.split('=')[1];
	const targets = [
		['original', 'http://127.0.0.1:4322/'],
		['astro', 'http://127.0.0.1:4321/'],
	].filter(([name]) => only == null || name === only);
	if(targets.length === 0)throw new Error('Unknown --only target: ' + only);
	const snapshots = [];
	for(const [name, url] of targets) {
		const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
		const cdp = await CDP.connect(target.webSocketDebuggerUrl);
		await cdp.request('Page.enable');
		await cdp.request('Runtime.enable');
		await cdp.request('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
		await cdp.request('Page.navigate', { url });
		let booted = false;
		for(let check = 0; check < 100; check++){
			if(await cdp.evaluate('(typeof cwindows !== "undefined" && typeof startEntries !== "undefined" && typeof frame === "number" && frame > 5) || !!document.querySelector(".vo-panel")')){
				booted = true;
				break;
			}
			await delay(200);
		}
		if(!booted){
			const info = await cdp.evaluate('({href: location.href, readyState: document.readyState, title: document.title, markup: document.body?.innerHTML.slice(0, 600), scripts: [...document.scripts].map(s => s.src), panel: !!document.querySelector(".vo-panel")})');
			throw new Error(name + ' failed to initialize: ' + JSON.stringify({info, errors: cdp.errors}));
		}
		await delay(500);
		if(await cdp.evaluate('!!document.querySelector(".vo-panel")')){
			snapshots.push(await testDom(cdp, name));
			cdp.socket.close();
			continue;
		}
		const initial = await cdp.evaluate('({title: document.title, canvas: !!document.getElementById("mCanvas"), size: typeof msize === "undefined" ? null : msize, frames: typeof frame === "undefined" ? null : frame, windows: typeof cwindows === "undefined" ? null : cwindows.length, entries: typeof startEntries === "undefined" ? null : startEntries.length, wallpaper: typeof background === "undefined" ? null : background.value, boot: typeof initLinuxVM, browser: typeof initBrowser})');
		await cdp.screenshot('.parity/' + name + '-desktop' + imageSuffix + '.png');
		await cdp.click(55, 12);
		await delay(200);
		const menuOpen = await cdp.evaluate('typeof startOpen === "undefined" ? null : startOpen');
		await cdp.screenshot('.parity/' + name + '-menu' + imageSuffix + '.png');
		await cdp.click(58, 38);
		await cdp.click(190, 39);
		await delay(300);
		const settings = await cdp.evaluate('({count: typeof cwindows === "undefined" ? null : cwindows.length, titles: typeof cwindows === "undefined" ? [] : cwindows.map(w => w.title)})');
		await cdp.screenshot('.parity/' + name + '-settings' + imageSuffix + '.png');
		const scenarios = [];
		const closeWindows = () => cdp.evaluate('cwindows.slice().forEach(w => w.close())');
		const launch = (category, entry) => cdp.evaluate('startEntries.find(e => e.value === ' + JSON.stringify(category) + ').entries.find(e => e.value === ' + JSON.stringify(entry) + ').func()');
		await closeWindows();
		for(const [category, entry] of [
			['Office', 'Text Editor'],
			['System', 'JS Terminal'],
			['Settings', 'Wallpaper Picker'],
		]) {
			await launch(category, entry);
			await delay(400);
			const result = await cdp.evaluate('({windows: cwindows.map(w => w.title), failed: cwindows.some(w => !!w.failed)})');
			scenarios.push({ entry, ...result });
			await cdp.screenshot('.parity/' + name + '-' + entry.toLowerCase().replace(/\s+/g, '-') + imageSuffix + '.png');
			await closeWindows();
		}
		for(const entry of ['2048', 'Tetris', 'Breakout']) {
			await launch('Games', entry);
			await delay(1000);
			const result = await cdp.evaluate('({windows: cwindows.map(w => w.title), iframes: [...document.querySelectorAll("iframe.webview")].map(f => ({src: new URL(f.src).pathname, loaded: !!f.contentDocument?.body?.children.length})), failed: cwindows.some(w => !!w.failed)})');
			scenarios.push({ entry, ...result });
			await cdp.screenshot('.parity/' + name + '-' + entry.toLowerCase() + imageSuffix + '.png');
			await closeWindows();
		}
		await cdp.evaluate('initLinuxVM("floppybird")');
		await delay(3500);
		scenarios.push({ entry: 'Floppy Bird VM', ...await cdp.evaluate('({windows: cwindows.map(w => w.title), profile: activeProfile, running: !!emulator, message: vmMsg, screenWidth: screenCanvas.width, screenHeight: screenCanvas.height, failed: cwindows.some(w => !!w.failed)})') });
		await cdp.screenshot('.parity/' + name + '-vm' + imageSuffix + '.png');
		await closeWindows();
		await cdp.evaluate('initBrowser()');
		await delay(8000);
		scenarios.push({ entry: 'vibeBrowser', ...await cdp.evaluate('({windows: cwindows.map(w => w.title), proxyStatus: stomp.status, proxyMessage: stomp.message, failed: cwindows.some(w => !!w.failed)})') });
		await cdp.screenshot('.parity/' + name + '-browser' + imageSuffix + '.png');
		const errors = cdp.errors;
		snapshots.push({ name, initial, menuOpen, settings, scenarios, errors });
		await closeWindows();
		cdp.socket.close();
	}
	await writeFile('.parity/results' + imageSuffix + '.json', JSON.stringify(snapshots, null, 2) + '\n');
	console.log(JSON.stringify(snapshots, null, 2));
} finally {
	chrome.kill('SIGTERM');
}
