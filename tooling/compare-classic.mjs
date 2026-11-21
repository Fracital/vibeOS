import {mkdir, writeFile} from 'node:fs/promises';

// Side-by-side screenshots with both application menus dismissed and both
// desktops in the same viewport. Reuses the existing CDP browser.
const port = Number(process.env.VIBEOS_CDP_PORT ?? 9357);
const originalUrl = process.env.VIBEOS_ORIGINAL_URL ?? 'http://127.0.0.1:4322/';
const nativeUrl = process.env.VIBEOS_TEST_URL ?? 'http://127.0.0.1:4341/';
const [width, height] = (process.argv.find(value => value.startsWith('--size='))?.slice(7) ?? '1366x768').split('x').map(Number);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cases = [
	['desktop', null, null, null, 150],
	['settings', 'initSettings()', 'Settings', 'vibeOS settings', 250],
	['editor', 'initTextEditor()', 'Office', 'Text Editor', 250],
	['terminal', 'initJsTerm()', 'System', 'JS Terminal', 400],
	['wallpaper', 'initWallpaperPicker()', 'Settings', 'Wallpaper Picker', 250],
	['floppybird', 'initLinuxVM("floppybird")', 'Games', 'Floppy Bird', 2400],
];

class CDP {
	constructor(ws) {
		this.ws = ws;
		this.id = 1;
		this.pending = new Map();
		this.errors = [];
		ws.addEventListener('message', ({data}) => {
			const message = JSON.parse(data);
			if(message.method === 'Runtime.exceptionThrown'){
				this.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
			}
			if(!message.id)return;
			const operation = this.pending.get(message.id);
			if(!operation)return;
			this.pending.delete(message.id);
			if(message.error)operation.reject(Error(JSON.stringify(message.error)));
			else operation.resolve(message.result);
		});
	}
	static async connect(url) {
		const ws = new WebSocket(url);
		await new Promise((resolve,reject) => {
			ws.addEventListener('open',resolve,{once:true});
			ws.addEventListener('error',reject,{once:true});
		});
		return new CDP(ws);
	}
	send(method, params={}) {
		const id = this.id++;
		return new Promise((resolve,reject) => {
			const timer = setTimeout(() => {this.pending.delete(id);reject(Error('CDP timeout ' + method));},15000);
			this.pending.set(id, {
				resolve: value => {clearTimeout(timer);resolve(value);},
				reject: error => {clearTimeout(timer);reject(error);},
			});
			this.ws.send(JSON.stringify({id,method,params}));
		});
	}
	async eval(expression) {
		const value = await this.send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true});
		if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
		return value.result.value;
	}
	async capture(filename) {
		const data = await this.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
		await writeFile(filename, Buffer.from(data.data,'base64'));
	}
}

if(!Number.isFinite(width) || !Number.isFinite(height))throw Error('Invalid --size argument');
await mkdir('.parity',{recursive:true});
const records=[];
for(const [variant,url] of [['original',originalUrl],['native',nativeUrl]]) {
	const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
	const browser = await CDP.connect(target.webSocketDebuggerUrl);
	try {
		await browser.send('Page.enable');
		await browser.send('Runtime.enable');
		await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
		for(const [name,originalCall,category,app,wait] of cases) {
			await browser.send('Page.navigate',{url});
			let ready=false;
			for(let attempt=0;attempt<65;attempt++) {
				ready = await browser.eval(variant==='original'
					? 'typeof cwindows !== "undefined" && typeof initSettings === "function"'
					: 'document.querySelector("#vibeos-root")?.dataset.booted === "true"');
				if(ready)break;
				await delay(120);
			}
			if(!ready)throw Error(variant + ' did not boot for ' + name);
			await browser.eval('document.fonts.ready');
			if(variant==='native'){
				await browser.eval('document.querySelector(".vo-welcome .vo-welcome-primary")?.click()');
			}
			if(variant==='original' && originalCall)await browser.eval(originalCall);
			if(variant==='native' && category) {
				const action = `(() => {
					const launcher=document.querySelector('.vo-applications');
					launcher.click();
					const group=[...document.querySelectorAll('.vo-application-menu > .vo-menu-entry')].find(e=>e.querySelector(':scope > button')?.textContent.trim().startsWith(${JSON.stringify(category)}));
					if(!group)throw Error('Missing category');
					group.querySelector(':scope > button').click();
					const entry=[...group.querySelectorAll(':scope > .vo-submenu > .vo-menu-entry > button')].find(e=>e.textContent.trim()===${JSON.stringify(app)});
					if(!entry)throw Error('Missing entry');
					entry.click();
				})()`;
				await browser.eval(action);
			}
			await delay(wait);
			const file = `.parity/classic-${variant}-${name}-${width}x${height}.png`;
			await browser.capture(file);
			records.push({variant,name,file,errors:browser.errors.splice(0)});
		}
	}finally{
		browser.ws.close();
		await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(()=>{});
	}
}
await writeFile(`.parity/classic-results-${width}x${height}.json`,JSON.stringify(records,null,2)+'\n');
console.log(JSON.stringify(records,null,2));
if(records.some(record => record.errors.length))process.exitCode=1;
