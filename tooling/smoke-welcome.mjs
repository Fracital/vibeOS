import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

const origin = process.env.VIBEOS_TEST_URL ?? 'http://127.0.0.1:4341/';
const port = Number(process.env.VIBEOS_CDP_PORT ?? 9357);
const storageKey = 'vibeos.welcome.showOnBoot.v1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const created = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT'})).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener('open', resolve, {once: true});
	ws.addEventListener('error', reject, {once: true});
});

let nextId = 1;
const pending = new Map();
const errors = [];
ws.addEventListener('message', ({data}) => {
	const message = JSON.parse(data);
	if(message.method === 'Runtime.exceptionThrown'){
		errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
	}
	if(message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error'){
		errors.push(message.params.args.map(arg => arg.description ?? arg.value).join(' '));
	}
	if(!message.id)return;
	const operation = pending.get(message.id);
	if(!operation)return;
	pending.delete(message.id);
	if(message.error)operation.reject(Error(JSON.stringify(message.error)));
	else operation.resolve(message.result);
});

const send = (method, params = {}) => {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {pending.delete(id); reject(Error('CDP timeout: ' + method));}, 15000);
		pending.set(id, {
			resolve: value => {clearTimeout(timer); resolve(value);},
			reject: error => {clearTimeout(timer); reject(error);},
		});
		ws.send(JSON.stringify({id, method, params}));
	});
};
const evaluate = async expression => {
	const answer = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
	if(answer.exceptionDetails)throw Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
	return answer.result.value;
};
const waitFor = async (expression, label) => {
	for(let i = 0; i < 70; i++){
		if(await evaluate(expression))return;
		await pause(150);
	}
	throw Error('Timed out waiting for ' + label);
};
const reload = async () => {
	await send('Page.reload', {ignoreCache: true});
	await waitFor('document.querySelector("#vibeos-root")?.dataset.booted === "true"', 'desktop boot');
	await pause(180);
};

let previousValue = null;
let savedValue = false;
try {
	await send('Page.enable');
	await send('Runtime.enable');
	await send('Emulation.setDeviceMetricsOverride', {width: 1024, height: 768, deviceScaleFactor: 1, mobile: false});
	await send('Page.navigate', {url: origin});
	await waitFor('document.querySelector("#vibeos-root")?.dataset.booted === "true"', 'initial boot');
	previousValue = await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`);
	savedValue = true;
	await evaluate(`localStorage.removeItem(${JSON.stringify(storageKey)})`);
	await reload();
	assert.equal(await evaluate('document.querySelectorAll(".vo-welcome").length'), 1, 'Welcome is missing at first boot');
	assert.equal(await evaluate('document.querySelector(".vo-welcome-startup input")?.checked'), true);
	assert.equal(await evaluate('document.querySelector(".vo-welcome-nav")?.children.length'), 4);
	const windowGeometry = await evaluate('(() => {const r=document.querySelector(".vo-welcome").closest(".vo-window").getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,top:r.top}})()');
	assert.ok(windowGeometry.width <= 600 && windowGeometry.height <= 420, 'Welcome is too large');
	await mkdir('.parity', {recursive: true});
	const screenshot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
	await writeFile('.parity/welcome-startup.png', Buffer.from(screenshot.data, 'base64'));
	await send('Emulation.setDeviceMetricsOverride', {width: 360, height: 540, deviceScaleFactor: 1, mobile: false});
	await pause(100);
	const small = await evaluate('(() => {const window=document.querySelector(".vo-welcome").closest(".vo-window").getBoundingClientRect();const footer=document.querySelector(".vo-welcome-footer").getBoundingClientRect();return {left:window.left,right:window.right,top:window.top,bottom:window.bottom,footerBottom:footer.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight};})()');
	assert.ok(small.left >= 0 && small.right <= small.viewportWidth, 'Welcome extends outside a narrow viewport horizontally');
	assert.ok(small.top >= 26 && small.bottom <= small.viewportHeight, 'Welcome extends outside a narrow viewport vertically: ' + JSON.stringify(small));
	assert.ok(small.footerBottom <= small.viewportHeight, 'Welcome footer is clipped on a narrow viewport');
	const mobileScreenshot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
	await writeFile('.parity/welcome-narrow.png', Buffer.from(mobileScreenshot.data, 'base64'));
	await send('Emulation.setDeviceMetricsOverride', {width: 1024, height: 768, deviceScaleFactor: 1, mobile: false});
	await evaluate('document.querySelectorAll(".vo-welcome-nav-item")[1].click()');
	assert.equal(await evaluate('document.querySelector(".vo-welcome-panel h2")?.textContent'), 'Browse the Web');
	await evaluate('document.querySelector(".vo-welcome-actions button").click()');
	assert.equal(await evaluate('document.querySelectorAll(".vo-welcome").length'), 0);
	assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`), 'false');
	await reload();
	assert.equal(await evaluate('document.querySelectorAll(".vo-welcome").length'), 0, 'Welcome reappeared despite Never show again');

	const openSettings = `(() => {
		const launcher = document.querySelector('.vo-applications');
		launcher.click();
		const settings = [...document.querySelectorAll('.vo-application-menu > .vo-menu-entry')]
			.find(item => item.querySelector(':scope > button')?.textContent.startsWith('Settings'));
		settings.querySelector(':scope > button').click();
		const item = [...settings.querySelectorAll(':scope > .vo-submenu .vo-menu-entry > button')]
			.find(button => button.textContent.trim() === 'vibeOS settings');
		item.click();
		return !!document.querySelector('.vo-app-settings');
	})()`;
	assert.equal(await evaluate(openSettings), true, 'Settings menu could not open');
	assert.equal(await evaluate('document.querySelector(".vo-app-welcome-toggle input")?.checked'), false);
	await evaluate('(() => {const input=document.querySelector(".vo-app-welcome-toggle input");input.checked=true;input.dispatchEvent(new Event("change",{bubbles:true}));})()');
	assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`), 'true');
	await reload();
	assert.equal(await evaluate('document.querySelectorAll(".vo-welcome").length'), 1, 'Settings failed to re-enable welcome');
	await evaluate('document.querySelector(".vo-welcome .vo-welcome-button.vo-welcome-primary").click()');
	assert.equal(await evaluate('document.querySelectorAll(".vo-welcome").length'), 0);
	assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`), 'true', 'Close should leave the preference enabled');
	assert.equal(await evaluate(openSettings), true);
	await evaluate('document.querySelector(".vo-app-welcome-setting button").click()');
	assert.equal(await evaluate('document.querySelectorAll(".vo-welcome").length'), 1, 'Settings Open Welcome button failed');
	await evaluate('document.querySelector(".vo-app-welcome-setting button").click()');
	assert.equal(await evaluate('document.querySelectorAll(".vo-welcome").length'), 1, 'Opening welcome twice created a duplicate');
	await evaluate('document.querySelectorAll(".vo-welcome-nav-item")[2].click()');
	await evaluate('document.querySelector(".vo-welcome-link").click()');
	assert.equal(await evaluate('document.querySelectorAll(".vo-app-catalog").length'), 1, 'Onboarding App Manager quick action failed');
	await evaluate('document.querySelector(".vo-welcome-startup input").click()');
	assert.equal(await evaluate('document.querySelector(".vo-app-welcome-toggle input")?.checked'), false, 'Settings did not synchronize with welcome');
	assert.ok(errors.length === 0, 'Runtime console errors: ' + errors.join('\n'));
	console.log('Welcome smoke passed: boot, navigation, window size, Never show again, reload, Settings re-enable, Open Welcome, singleton, App Manager quick action, synchronized checkbox and console');
} finally {
	if(savedValue){
		try {
			await evaluate(previousValue === null
				? `localStorage.removeItem(${JSON.stringify(storageKey)})`
				: `localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(previousValue)})`);
		} catch { /* page may have closed during a failed assertion */ }
	}
	ws.close();
	await fetch(`http://127.0.0.1:${port}/json/close/${created.id}`).catch(() => {});
}
