import { mkdir, writeFile } from 'node:fs/promises';

// Reuse the already-running vibeOS parity Chrome, never start or terminate a browser.
const debugPort = Number(process.env.VIBEOS_CDP_PORT ?? 9357);
const url = process.env.VIBEOS_TEST_URL ?? 'http://127.0.0.1:4321/';
const sizes = process.argv.includes('--small') ? [[800, 600]] : [[1366, 768], [800, 600]];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class BrowserConnection {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		this.errors = [];
		socket.addEventListener('message', event => {
			const data = JSON.parse(event.data);
			if(data.method === 'Runtime.exceptionThrown')this.errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
			if(data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error')this.errors.push(data.params.args.map(a => a.value ?? a.description).join(' '));
			if(!data.id || !this.pending.has(data.id))return;
			const callback = this.pending.get(data.id);
			this.pending.delete(data.id);
			if(data.error)callback.reject(Error(JSON.stringify(data.error)));
			else callback.resolve(data.result);
		});
	}
	static async open(url) {
		const ws = new WebSocket(url);
		await new Promise((resolve, reject) => {
			ws.addEventListener('open', resolve, { once: true });
			ws.addEventListener('error', reject, { once: true });
		});
		return new BrowserConnection(ws);
	}
	request(method, params = {}) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP timed out: ' + method)); }, 15000);
			this.pending.set(id, {
				resolve: value => { clearTimeout(timer); resolve(value); },
				reject: error => { clearTimeout(timer); reject(error); },
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}
	async eval(expression) {
		const data = await this.request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
		if(data.exceptionDetails)throw Error(data.exceptionDetails.exception?.description ?? data.exceptionDetails.text);
		return data.result.value;
	}
	async click(x, y) {
		await this.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
		await this.request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', x, y, clickCount: 1 });
		await this.request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', x, y, clickCount: 1 });
	}
	async snap(filename) {
		const data = await this.request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
		await writeFile(filename, Buffer.from(data.data, 'base64'));
	}
}

await mkdir('.parity', { recursive: true });
const summary = [];
for(const [width, height] of sizes) {
	const created = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
	const browser = await BrowserConnection.open(created.webSocketDebuggerUrl);
	const suffix = width === 1366 ? '' : `-${width}x${height}`;
	try {
		await browser.request('Page.enable');
		await browser.request('Runtime.enable');
		await browser.request('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
		await browser.request('Page.navigate', { url });
		await sleep(1500);
		await browser.eval('document.fonts.ready');
			// compare the historical shell underneath the optional new first-boot welcome
			await browser.eval('document.querySelector(".vo-welcome .vo-welcome-primary")?.click()');
		const state = await browser.eval('({ready:document.getElementById("vibeos-root")?.dataset.booted, canvas:document.querySelectorAll("canvas").length, title:document.title, menuRows:document.querySelectorAll(".vo-application-menu > .vo-menu-entry").length, background:getComputedStyle(document.querySelector(".vo-wallpaper")).backgroundImage, client:[innerWidth,innerHeight]})');
		await browser.snap(`.parity/native-desktop${suffix}.png`);
		await browser.click(55, 12);
		await sleep(150);
		const menu = await browser.eval('({shown:!document.querySelector(".vo-application-menu").hidden, labels:[...document.querySelectorAll(".vo-application-menu > .vo-menu-entry > button")].map(e=>e.textContent.trim())})');
		await browser.snap(`.parity/native-menu${suffix}.png`);
		await browser.click(58, 38);
		await browser.click(200, 38);
		await sleep(250);
		const settings = await browser.eval('({windows:[...document.querySelectorAll(".vo-window-title")].map(e=>e.textContent), settings:!!document.querySelector(".vo-app-settings"), dimensions:[...document.querySelectorAll(".vo-window")].map(e=>[e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight])})');
		await browser.snap(`.parity/native-settings${suffix}.png`);
		const open = async (category, app) => browser.eval(`(() => {for(const w of [...document.querySelectorAll('.vo-window-close')])w.click();const launcher=document.querySelector('.vo-applications');if(document.querySelector('.vo-application-menu').hidden)launcher.click();const row=[...document.querySelectorAll('.vo-application-menu > .vo-menu-entry')].find(e=>e.querySelector(':scope > button')?.textContent.trim().startsWith(${JSON.stringify(category)}));if(!row)throw Error('Category not found: ${category}');row.querySelector(':scope > button').click();const item=[...row.querySelectorAll(':scope > .vo-submenu > .vo-menu-entry > button')].find(e=>e.textContent.trim()===${JSON.stringify(app)});if(!item)throw Error('App not found: ${app}');item.click();return true;})()`);
		const scenarios = [];
		for(const [category, app, wait] of [['Office','Text Editor',300],['System','JS Terminal',500],['Settings','Wallpaper Picker',300],['Games','2048',800],['Games','Tetris',800],['Games','Breakout',800],['Internet','vibeBrowser',1500],['Graphics','Chrome Canvas',500],['Accessories','Emulator',5000]]) {
			try {
				await open(category, app);
				await sleep(wait);
				const result = await browser.eval('({windows:[...document.querySelectorAll(".vo-window-title")].map(e=>e.textContent), frames:[...document.querySelectorAll(".vo-window iframe")].map(e=>({url:e.src,loaded:e.contentDocument?.body?.children.length??null})),canvas:document.querySelectorAll("canvas").length, vmStatus:document.querySelector(".vibe-emulator-status")?.textContent})');
				if(app === 'JS Terminal'){
					await browser.eval('(() => {const input=document.querySelector(".vo-app-terminal-input");input.value="6*7";input.closest("form").requestSubmit();})()');
					await sleep(250);
					result.terminalOutput = await browser.eval('document.querySelector(".vo-app-terminal-output")?.textContent');
					if(!result.terminalOutput?.includes('42'))throw Error('Isolated terminal failed to evaluate 6*7');
				}
				if(app === 'Wallpaper Picker'){
					await browser.eval('document.querySelectorAll(".vo-app-wallpaper-tile")[1].click()');
					result.changedWallpaper = await browser.eval('getComputedStyle(document.querySelector(".vo-wallpaper")).backgroundImage');
					if(!result.changedWallpaper?.includes('/b.png'))throw Error('Wallpaper change did not take effect');
					await browser.eval('document.querySelectorAll(".vo-app-wallpaper-tile")[0].click()');
				}
				if(app === 'Chrome Canvas'){
					result.webAppLayout = await browser.eval(`(() => {
						const content = [...document.querySelectorAll('.vo-web-app')].at(-1);
						const frame = content?.querySelector('.vo-web-app-frame');
						return {toolbar:!!content?.querySelector('.vo-web-app-bar, .vo-open-external'),
							topGap:frame && content ? Math.round(frame.getBoundingClientRect().top - content.getBoundingClientRect().top) : null};
					})()`);
					if(result.webAppLayout.toolbar || result.webAppLayout.topGap !== 0)throw Error('Chrome Canvas has a URL toolbar or its iframe is not flush with the window');
				}
				if(app === 'Emulator' && !result.vmStatus?.includes('FreeDOS'))throw Error('v86 emulator did not boot FreeDOS');
				scenarios.push({app,...result});
				if(['Text Editor','JS Terminal','Wallpaper Picker','2048','Tetris','Breakout','vibeBrowser','Chrome Canvas','Emulator'].includes(app))await browser.snap(`.parity/native-${app.toLowerCase().replaceAll(' ','-')}${suffix}.png`);
			} catch(error) {scenarios.push({app,error:String(error)});}
		}
		summary.push({width,height,state,menu,settings,scenarios,errors:browser.errors});
	} finally {
		browser.socket.close();
		await fetch(`http://127.0.0.1:${debugPort}/json/close/${created.id}`).catch(() => {});
	}
}
await writeFile('.parity/native-results.json', JSON.stringify(summary,null,2) + '\n');
console.log(JSON.stringify(summary,null,2));
if(summary.some(s => !s.state.ready || s.state.canvas || s.settings.settings !== true || s.errors.length || s.scenarios.some(c=>c.error)))process.exitCode = 1;
