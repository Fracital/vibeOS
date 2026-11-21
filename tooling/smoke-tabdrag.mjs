import assert from 'node:assert/strict';

// Run with the Astro dev server and an existing Chrome remote-debugging port:
// VIBEOS_CDP_PORT=9357 node tooling/smoke-tabdrag.mjs
// The runner opens and closes its own CDP tab, leaving other Chrome tabs alone.

const server = process.env.VIBEOS_TEST_URL || 'http://127.0.0.1:4321/';
const port = Number(process.env.VIBEOS_CDP_PORT || 9357);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tests = [];

class Inspector {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		this.errors = [];
		socket.addEventListener('message', ({data}) => {
			const response = JSON.parse(data);
			if(response.method === 'Runtime.exceptionThrown') {
				this.errors.push(response.params.exceptionDetails.exception?.description || response.params.exceptionDetails.text);
			}
			const pending = this.pending.get(response.id);
			if(!pending)return;
			this.pending.delete(response.id);
			if(response.error)pending.reject(new Error(JSON.stringify(response.error)));
			else pending.resolve(response.result);
		});
	}

	send(method, params = {}) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {resolve, reject});
			this.socket.send(JSON.stringify({id, method, params}));
		});
	}

	async eval(source) {
		const result = await this.send('Runtime.evaluate', {expression: source, returnByValue: true, awaitPromise: true});
		if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
		return result.result.value;
	}

	async eventually(source, predicate, description, timeout = 2000) {
		const deadline = Date.now() + timeout;
		let last;
		do {
			last = await this.eval(source);
			if(predicate(last))return last;
			await sleep(60);
		}while(Date.now() < deadline);
		throw new Error(`${description}: last state ${JSON.stringify(last)}`);
	}
}

const browserRoot = 'document.querySelector(".vo-window:has(.vibe-browser)")';
const browser = `${browserRoot}?.querySelector('.vibe-browser')`;

const browserState = `(() => {
	const window = ${browserRoot};
	const root = ${browser};
	if(!root)return null;
	const tabs = [...root.querySelectorAll('.vibe-browser-tab')];
	const active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true');
	const bookmarks = root.querySelector('.vibe-browser-bookmarks');
	return {
		order: tabs.map(tab => tab.id), active: active?.id ?? null,
		addressFocused: document.activeElement === root.querySelector('.vibe-browser-address'),
		address: root.querySelector('.vibe-browser-address')?.value ?? '',
		bookmarksVisible: !!bookmarks && !bookmarks.hidden && getComputedStyle(bookmarks).display !== 'none' && bookmarks.getBoundingClientRect().height > 0,
		menuVisible: !!root.querySelector('.vibe-browser-menu') && !root.querySelector('.vibe-browser-menu').hidden,
		zoom: [root, ...root.querySelectorAll('.vibe-browser-display, .vibe-browser-panel:not([hidden]), .vibe-browser-home:not([hidden]), .vibe-browser-frame:not([hidden])')].map(node => ({
			className:node.className, zoom:getComputedStyle(node).zoom, transform:getComputedStyle(node).transform,
			inlineZoom:node.style.zoom, inlineTransform:node.style.transform,
			inlineStyle:node.getAttribute('style'), fontSize:getComputedStyle(node).fontSize,
			datasetZoom:node.dataset.zoom || '',
			customZoom:node.style.getPropertyValue('--browser-zoom') || node.style.getPropertyValue('--vibe-browser-zoom'),
		})),
	};
})()`;

const keys = {
	t: ['t', 'KeyT', 84], w: ['w', 'KeyW', 87], b: ['b', 'KeyB', 66], d: ['d', 'KeyD', 68],
	l: ['l', 'KeyL', 76], r: ['r', 'KeyR', 82], tab: ['Tab', 'Tab', 9], escape: ['Escape', 'Escape', 27],
	pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34],
	left: ['ArrowLeft', 'ArrowLeft', 37], right: ['ArrowRight', 'ArrowRight', 39],
	f5: ['F5', 'F5', 116], plus: ['+', 'Equal', 187], minus: ['-', 'Minus', 189],
	zero: ['0', 'Digit0', 48],
};

async function shortcut(tab, combo) {
	const parts = combo.toLowerCase().split('+');
	const shift = parts.includes('shift');
	const ctrl = parts.includes('ctrl');
	const alt = parts.includes('alt');
	const meta = parts.includes('meta');
	const final = parts.at(-1);
	const definition = keys[final] || (/^[1-9]$/.test(final) ? [final, 'Digit' + final, 48 + Number(final)] : null);
	if(!definition)throw new Error('Unknown shortcut ' + combo);
	const [key, code, virtualKey] = definition;
	// Native Ctrl+T / Ctrl+W are consumed by headless Chrome before the app receives them.
	// A trusted CDP mouse event is used for drag tests, while DOM keyboard events exercise
	// the application's document-capture shortcut handlers without browser interception.
	return tab.eval(`(() => {
		const target = document.activeElement || document.body;
		const event = new KeyboardEvent('keydown', {
			key:${JSON.stringify(shift && key.length === 1 && /[a-z]/i.test(key) ? key.toUpperCase() : key)},
			code:${JSON.stringify(code)}, keyCode:${virtualKey}, which:${virtualKey},
			ctrlKey:${ctrl}, shiftKey:${shift}, altKey:${alt}, metaKey:${meta},
			bubbles:true, cancelable:true,
		});
		target.dispatchEvent(event);
		return {prevented:event.defaultPrevented};
	})()`);
}

async function syntheticallyHandled(tab, combo, where = '.vibe-browser-address') {
	const parts = combo.toLowerCase().split('+');
	const def = keys[parts.at(-1)];
	if(!def)throw new Error('Unsupported synthetic shortcut ' + combo);
	return tab.eval(`(() => {
		const target = document.querySelector(${JSON.stringify(where)});
		if(!target)throw Error('Missing shortcut target: ${where}');
		target.focus();
		const event = new KeyboardEvent('keydown', {
			key: ${JSON.stringify(def[0])}, code:${JSON.stringify(def[1])}, bubbles:true, cancelable:true,
			ctrlKey:${parts.includes('ctrl')}, shiftKey:${parts.includes('shift')}, altKey:${parts.includes('alt')},
		});
		target.dispatchEvent(event);
		return event.defaultPrevented;
	})()`);
}

async function check(name, action) {
	try {
		const detail = await action();
		tests.push({name, status:'passed', ...(detail === undefined ? {} : {detail})});
		console.log('PASS ' + name);
	}catch(error) {
		tests.push({name, status:'failed', error:String(error instanceof Error ? error.message : error)});
		console.error('FAIL ' + name + ': ' + String(error instanceof Error ? error.message : error));
	}
}

async function launch(tab) {
	await tab.eval(`(() => {
		const launcher = document.querySelector('.vo-applications');
		const menu = document.querySelector('.vo-application-menu');
		if(menu.hidden)launcher.click();
		const internet = [...menu.querySelectorAll(':scope > .vo-menu-entry')]
			.find(item => item.querySelector(':scope > button')?.textContent.startsWith('Internet'));
		if(!internet)throw Error('Internet menu missing');
		internet.querySelector(':scope > button').click();
		const browser = [...internet.querySelectorAll(':scope > .vo-submenu > .vo-menu-entry > button')]
			.find(item => item.textContent.trim() === 'vibeBrowser');
		if(!browser)throw Error('vibeBrowser entry missing');
		browser.click();
	})()`);
	await tab.eventually(browserState, result => !!result?.active, 'vibeBrowser did not launch');
}

async function focus(tab, selector = '.vibe-browser-address') {
	await tab.eval(`(() => {
		const target = document.querySelector(${JSON.stringify(selector)});
		if(!target)throw Error('Cannot focus ' + ${JSON.stringify(selector)});
		target.focus();
	})()`);
}

async function ensureTabs(tab, count) {
	await tab.eval(`(() => {
		const root = ${browser};
		while(root.querySelectorAll('.vibe-browser-tab').length < ${count}){
			root.querySelector('.vibe-browser-new-tab').click();
		}
	})()`);
	return tab.eventually(browserState, state => state?.order.length >= count, `${count} tabs were not created`);
}

async function point(tab, type, x, y, pressed = false) {
	await tab.send('Input.dispatchMouseEvent', {
		type, x: Math.round(x), y: Math.round(y),
		button: type === 'mousePressed' || type === 'mouseReleased' || pressed ? 'left' : 'none',
		buttons: pressed ? 1 : 0, ...(type === 'mousePressed' || type === 'mouseReleased' ? {clickCount:1} : {}),
	});
}

async function clickGesture(tab, selector, gesture = 'ctrl') {
	const box = await tab.eval(`(() => {
		const root = ${browser};
			const element = root.querySelector('.vibe-browser-panel:not([hidden]) ' + ${JSON.stringify(selector)}) ||
			root.querySelector(${JSON.stringify(selector)});
		if(!element)throw Error('Missing gesture destination: ${selector}');
		element.scrollIntoView({block:'nearest', inline:'nearest'});
		const rect = element.getBoundingClientRect();
		if(!rect.width || !rect.height)throw Error('Gesture destination is hidden: ${selector}');
		return {x:rect.left + rect.width / 2, y:rect.top + rect.height / 2};
	})()`);
	const modifiers = (gesture.includes('ctrl') ? 2 : 0) | (gesture.includes('shift') ? 8 : 0);
	const middle = gesture === 'middle';
	const button = middle ? 'middle' : 'left';
	const buttons = middle ? 4 : 1;
	await tab.send('Input.dispatchMouseEvent', {type:'mouseMoved', ...box});
	await tab.send('Input.dispatchMouseEvent', {type:'mousePressed', ...box,
		button, buttons, modifiers, clickCount:1});
	await tab.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...box,
		button, buttons:0, modifiers, clickCount:1});
}

async function prepareNewTab(tab, selector) {
	await tab.eval(`(() => {
		const root = ${browser};
		root.querySelector('.vibe-browser-new-tab').click();
		root.querySelector('.vibe-browser-tab[aria-selected="true"]').click();
	})()`);
	await tab.eventually(`(() => {
		const root = ${browser};
		const entry = root.querySelector('.vibe-browser-panel:not([hidden]) ' + ${JSON.stringify(selector)}) ||
			root.querySelector(${JSON.stringify(selector)});
		return !!entry && entry.getBoundingClientRect().height > 0;
	})()`, Boolean, 'New tab destination missing: ' + selector);
	return tab.eval(browserState);
}

async function geometry(tab, index = 0) {
	return tab.eval(`(() => {
		const tabs = [...${browser}.querySelectorAll('.vibe-browser-tab')];
		const node = tabs[${index}];
		if(!node)throw Error('Missing tab ${index}');
		const box = node.getBoundingClientRect();
		return {id:node.id, x:box.left + box.width / 2, y:box.top + box.height / 2,
			left:box.left, width:box.width, transform:getComputedStyle(node).transform,
			transition:getComputedStyle(node).transitionDuration, className:node.className};
	})()`);
}

async function drag(tab, sourceIndex, targetIndex, captureProgress = true) {
	const before = (await tab.eval(browserState)).order;
	const source = await geometry(tab, sourceIndex);
	const target = await geometry(tab, targetIndex);
	const destinationX = target.x + (targetIndex > sourceIndex ? target.width * 0.3 : -target.width * 0.3);
	await point(tab, 'mouseMoved', source.x, source.y);
	await point(tab, 'mousePressed', source.x, source.y, true);
	let moving;
	try {
		const stops = [0.2, 0.4, 0.65, 0.85, 1];
		for(const fraction of stops) {
			const x = source.x + (destinationX - source.x) * fraction;
			await point(tab, 'mouseMoved', x, source.y, true);
			await sleep(25);
			if(captureProgress && fraction === 0.65) {
				moving = await tab.eval(`(() => {
					const el = document.getElementById(${JSON.stringify(source.id)});
					return {left:el.getBoundingClientRect().left, transform:getComputedStyle(el).transform,
						inline:el.style.transform, className:el.className};
				})()`);
			}
		}
	}finally {
		await point(tab, 'mouseReleased', destinationX, source.y);
	}
	await sleep(250);
	return {before, after:(await tab.eval(browserState)).order, source, target, moving};
}

let inspector;
let target;
let originalBookmarks;
try {
	const sourceResponse = await fetch(server);
	assert.ok(sourceResponse.ok, `Astro dev server returned HTTP ${sourceResponse.status}`);
	const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'});
	assert.ok(response.ok, `Chrome CDP endpoint returned HTTP ${response.status}`);
	target = await response.json();
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, {once:true});
		socket.addEventListener('error', reject, {once:true});
	});
	inspector = new Inspector(socket);
	await inspector.send('Page.enable');
	await inspector.send('Runtime.enable');
	await inspector.send('Emulation.setDeviceMetricsOverride', {width:1280, height:800, deviceScaleFactor:1, mobile:false});
	await inspector.send('Page.navigate', {url:server});
	await inspector.eventually(`(() => ({
		boot:document.querySelector('#vibeos-root')?.dataset.booted,
		launcher:!!document.querySelector('.vo-applications'),
		menu:!!document.querySelector('.vo-application-menu'),
	}))()`, state => state?.boot === 'true' && state.launcher && state.menu,
	'Desktop did not finish booting', 10000);
	originalBookmarks = await inspector.eval(`(() => ({v1:localStorage.getItem('vibeos.browser.bookmarks.v1'),v2:localStorage.getItem('vibeos.browser.bookmarks.v2')}))()`);
	await launch(inspector);
	await focus(inspector);

	await check('Ctrl+T creates an active tab', async () => {
		const prior = await inspector.eval(browserState);
		await shortcut(inspector, 'ctrl+t');
		const next = await inspector.eventually(browserState, s => s?.order.length === prior.order.length + 1, 'Ctrl+T did not open a tab');
		assert.equal(next.active, next.order.at(-1));
	});

	await check('Ctrl+W closes active tab', async () => {
		const prior = await inspector.eval(browserState);
		await shortcut(inspector, 'ctrl+w');
		const next = await inspector.eventually(browserState, s => s?.order.length === prior.order.length - 1, 'Ctrl+W did not close active tab');
		assert.ok(!next.order.includes(prior.active), 'Closed tab remained in tablist');
	});

	await check('Ctrl+Shift+T restores a closed URL tab', async () => {
		await ensureTabs(inspector, 3);
		await inspector.eval(`(() => {
			const address = document.querySelector('.vibe-browser-address');
			address.value = 'https://example.org/browser-test';
			address.closest('form').requestSubmit();
		})()`);
		await inspector.eventually(browserState, s => s?.address.includes('example.org/browser-test'), 'URL tab not created');
		const count = (await inspector.eval(browserState)).order.length;
		await shortcut(inspector, 'ctrl+w');
		await inspector.eventually(browserState, s => s?.order.length === count - 1, 'URL tab not closed');
		await shortcut(inspector, 'ctrl+shift+t');
		const current = await inspector.eventually(browserState, s => s?.order.length === count, 'Closed tab was not restored');
		assert.ok(current.address.includes('example.org/browser-test'), 'Restored tab lost its URL');
	});

	await check('Ctrl+Tab and Ctrl+Shift+Tab cycle tab selection', async () => {
		await ensureTabs(inspector, 4);
		const start = await inspector.eval(browserState);
		await shortcut(inspector, 'ctrl+tab');
		const next = await inspector.eval(browserState);
		assert.equal(next.active, start.order[(start.order.indexOf(start.active) + 1) % start.order.length]);
		await shortcut(inspector, 'ctrl+shift+tab');
		assert.equal((await inspector.eval(browserState)).active, start.active);
	});

	await check('Ctrl+1, Ctrl+8 and Ctrl+9 select tab positions', async () => {
		const initial = await ensureTabs(inspector, 9);
		await shortcut(inspector, 'ctrl+1');
		assert.equal((await inspector.eval(browserState)).active, initial.order[0]);
		await shortcut(inspector, 'ctrl+8');
		assert.equal((await inspector.eval(browserState)).active, initial.order[7]);
		await shortcut(inspector, 'ctrl+9');
		assert.equal((await inspector.eval(browserState)).active, initial.order.at(-1));
	});

	await check('Ctrl+L and Alt+D focus the address bar', async () => {
		await focus(inspector, '.vibe-browser-tab[aria-selected="true"]');
		await shortcut(inspector, 'ctrl+l');
		assert.equal((await inspector.eval(browserState)).addressFocused, true, 'Ctrl+L missed address');
		await focus(inspector, '.vibe-browser-tab[aria-selected="true"]');
		await shortcut(inspector, 'alt+d');
		assert.equal((await inspector.eval(browserState)).addressFocused, true, 'Alt+D missed address');
	});

	await check('Ctrl+R, Ctrl+Shift+R and F5 are intercepted by browser', async () => {
		for(const combo of ['ctrl+r', 'ctrl+shift+r', 'f5']) {
			const handled = await syntheticallyHandled(inspector, combo);
			assert.equal(handled, true, `${combo} was not intercepted`);
		}
	});

	await check('Alt+Left / Alt+Right handle browser history', async () => {
		for(const combo of ['alt+left', 'alt+right']) {
			assert.equal(await syntheticallyHandled(inspector, combo), true, combo + ' was not intercepted');
		}
	});

	await check('Ctrl+D adds or toggles a bookmark', async () => {
		const before = await inspector.eval(`document.querySelectorAll('.vibe-browser-bookmark').length`);
		await inspector.eval(`(() => {
			const address = document.querySelector('.vibe-browser-address');
			address.value = 'https://example.org/shortcut-bookmark';
			address.closest('form').requestSubmit();
		})()`);
		await inspector.eventually(browserState, s => s?.address.includes('/shortcut-bookmark'), 'Bookmark destination not selected');
		await shortcut(inspector, 'ctrl+d');
		await inspector.eventually(`document.querySelectorAll('.vibe-browser-bookmark').length`, count => count === before + 1, 'Ctrl+D did not add bookmark');
		await shortcut(inspector, 'ctrl+d');
		await inspector.eventually(`document.querySelectorAll('.vibe-browser-bookmark').length`, count => count === before, 'Ctrl+D did not remove bookmark');
	});

	await check('Ctrl+Shift+B toggles bookmarks bar', async () => {
		const first = await inspector.eval(browserState);
		await shortcut(inspector, 'ctrl+shift+b');
		const second = await inspector.eval(browserState);
		assert.notEqual(second.bookmarksVisible, first.bookmarksVisible, 'Bookmark visibility did not change');
		await shortcut(inspector, 'ctrl+shift+b');
		assert.equal((await inspector.eval(browserState)).bookmarksVisible, first.bookmarksVisible);
	});

	await check('Ctrl++ / Ctrl+- / Ctrl+0 update and reset zoom', async () => {
		await inspector.eval(`document.querySelector('.vibe-browser-new-tab').click()`);
		const initial = (await inspector.eval(browserState)).zoom;
		await shortcut(inspector, 'ctrl+shift+plus');
		const enlarged = (await inspector.eval(browserState)).zoom;
		assert.notDeepEqual(enlarged, initial, 'Zoom in did not change the content zoom');
		await shortcut(inspector, 'ctrl+minus');
		await shortcut(inspector, 'ctrl+zero');
		assert.deepEqual((await inspector.eval(browserState)).zoom, initial, 'Zoom reset did not restore defaults');
	});

	await check('Ctrl+Shift+PageUp / PageDown reorder selected tab', async () => {
		await inspector.eval(`(() => {
			const tabs = document.querySelectorAll('.vibe-browser-tab');
			tabs[3].click();
		})()`);
		const start = await inspector.eval(browserState);
		await shortcut(inspector, 'ctrl+shift+pageup');
		const moved = await inspector.eval(browserState);
		assert.equal(moved.order[2], start.order[3], 'PageUp did not move tab left');
		await shortcut(inspector, 'ctrl+shift+pagedown');
		assert.deepEqual((await inspector.eval(browserState)).order, start.order, 'PageDown did not restore order');
	});

	await check('Escape dismisses browser menu', async () => {
		await inspector.eval(`document.querySelector('.vibe-browser-menu-toggle').click()`);
		assert.equal((await inspector.eval(browserState)).menuVisible, true, 'Browser menu did not open');
		await shortcut(inspector, 'escape');
		assert.equal((await inspector.eval(browserState)).menuVisible, false, 'Escape left browser menu open');
	});

	await check('Keyboard shortcuts are scoped to active window', async () => {
		const count = (await inspector.eval(browserState)).order.length;
		await inspector.eval(`(() => {
			const launcher = document.querySelector('.vo-applications');
			const menu = document.querySelector('.vo-application-menu');
			if(menu.hidden)launcher.click();
			const row = [...menu.querySelectorAll(':scope > .vo-menu-entry')]
				.find(entry => entry.querySelector(':scope > button').textContent.startsWith('System'));
			row.querySelector(':scope > button').click();
			const entry = [...row.querySelectorAll(':scope > .vo-submenu > .vo-menu-entry > button')]
				.find(item => item.textContent.trim() === 'JS Terminal');
			entry.click();
			const terminal = document.querySelector('.vo-window:has(.vo-app-terminal)');
			terminal.querySelector('input').focus();
		})()`);
		await shortcut(inspector, 'ctrl+t');
		assert.equal((await inspector.eval(browserState)).order.length, count, 'Background browser received Ctrl+T');
		await inspector.eval(`document.querySelector('.vo-window:has(.vo-app-terminal) .vo-window-close')?.click()`);
		await focus(inspector);
	});

	for(const [destination, selector] of [
		['Apps tiles', '.vibe-browser-app-tile'],
		['bookmarks', '.vibe-browser-bookmark'],
	]) {
		await check(destination + ': Ctrl-click and middle-click open background tabs', async () => {
			for(const gesture of ['ctrl', 'middle']) {
				const before = await prepareNewTab(inspector, selector);
				await clickGesture(inspector, selector, gesture);
				const after = await inspector.eventually(browserState,
					state => state?.order.length === before.order.length + 1,
					destination + ' ' + gesture + '-click did not open a new tab');
				assert.equal(after.active, before.active, destination + ' ' + gesture + '-click stole focus');
			}
		});

		await check(destination + ': Ctrl+Shift-click selects a new tab', async () => {
			const before = await prepareNewTab(inspector, selector);
			await clickGesture(inspector, selector, 'ctrl+shift');
			const after = await inspector.eventually(browserState,
				state => state?.order.length === before.order.length + 1,
				destination + ' Ctrl+Shift-click did not open a tab');
			assert.equal(after.active, after.order.at(-1), destination + ' Ctrl+Shift-click did not focus new tab');
		});

		await check(destination + ': Shift-click opens a new browser window', async () => {
			await prepareNewTab(inspector, selector);
			const before = await inspector.eval(`document.querySelectorAll('.vo-window-chrome').length`);
			await clickGesture(inspector, selector, 'shift');
			await inspector.eventually(`document.querySelectorAll('.vo-window-chrome').length`,
				count => count === before + 1, destination + ' Shift-click did not open browser window');
			await inspector.eval(`[...document.querySelectorAll('.vo-window-chrome')].at(-1)
				.querySelector('.vo-window-close').click()`);
		});
	}

	await check('Same-origin iframe keyboard shortcuts work', async () => {
		await inspector.eval(`document.querySelector('.vibe-browser-new-tab').click()`);
		const before = (await inspector.eval(browserState)).order.length;
		await inspector.eval(`(() => {
			const frame = ${browser}.querySelector('.vibe-browser-panel:not([hidden]) iframe');
			frame.srcdoc = '<!doctype html><title>Test keyboard relay</title><input id="iframe-test-input">';
		})()`);
		const available = await inspector.eventually(`(() => {
			const frame = ${browser}.querySelector('.vibe-browser-panel:not([hidden]) iframe');
			try {return !!frame.contentDocument?.querySelector('#iframe-test-input');}
			catch {return false;}
		})()`, Boolean, 'Could not load isolated iframe keyboard fixture');
		if(!available)return {skipped:'The browser blocked a same-origin iframe fixture'};
		await sleep(120);
		const result = await inspector.eval(`(() => {
			const root = ${browser};
			const frame = root.querySelector('.vibe-browser-panel:not([hidden]) iframe');
			try {
				const doc = frame?.contentDocument;
				if(!doc || !doc.querySelector('#iframe-test-input'))return {available:false};
				doc.querySelector('#iframe-test-input').focus();
				const event = new KeyboardEvent('keydown', {
					key:'t', code:'KeyT', ctrlKey:true, bubbles:true, cancelable:true,
				});
				doc.activeElement.dispatchEvent(event);
				return {available:true, prevented:event.defaultPrevented};
			}catch {return {available:false};}
		})()`);
		if(!result.available)return {skipped:'No accessible iframe document; STomp proxy may be offline'};
		assert.equal(result.prevented, true, 'Ctrl+T was not handled in the iframe document');
		assert.equal((await inspector.eval(browserState)).order.length, before + 1);
	});

	await check('Same-origin iframe Ctrl-click intercepts a link in capture phase', async () => {
		await inspector.eval(`(() => {
			const root = ${browser};
			root.querySelector('.vibe-browser-new-tab').click();
			const panel = root.querySelector('.vibe-browser-panel:not([hidden])');
			panel.querySelector('.vibe-browser-home').hidden = true;
			const frame = panel.querySelector('iframe');
			frame.hidden = false;
			frame.srcdoc = '<!doctype html><title>Link gesture fixture</title><a id="gesture-link" href="https://example.org/frame-link" style="display:block;padding:35px">Open</a>';
		})()`);
		await inspector.eventually(`(() => {
			const frame = ${browser}.querySelector('.vibe-browser-panel:not([hidden]) iframe');
			try{return !!frame.contentDocument?.getElementById('gesture-link');}
			catch{return false;}
		})()`, Boolean, 'Could not load iframe link fixture');
		await sleep(120);
		const before = await inspector.eval(browserState);
		const link = await inspector.eval(`(() => {
			const frame = ${browser}.querySelector('.vibe-browser-panel:not([hidden]) iframe');
			const frameBox = frame.getBoundingClientRect();
			const linkBox = frame.contentDocument.getElementById('gesture-link').getBoundingClientRect();
			return {x:frameBox.left + linkBox.left + linkBox.width / 2,
				y:frameBox.top + linkBox.top + linkBox.height / 2};
		})()`);
		await inspector.send('Input.dispatchMouseEvent', {type:'mouseMoved', ...link});
		await inspector.send('Input.dispatchMouseEvent', {type:'mousePressed', ...link,
			button:'left', buttons:1, modifiers:2, clickCount:1});
		await inspector.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...link,
			button:'left', buttons:0, modifiers:2, clickCount:1});
		const after = await inspector.eventually(browserState,
			state => state?.order.length === before.order.length + 1,
			'Ctrl-click from same-origin iframe did not open browser tab');
		assert.equal(after.active, before.active, 'Iframe Ctrl-click should keep source tab active');
	});

	await check('Pointer drag shows moving tab before reorder', async () => {
		await inspector.eval(`(() => {
			const root = ${browser};
			while(root.querySelectorAll('.vibe-browser-tab').length > 4){
				const item = root.querySelector('.vibe-browser-tab:last-child .vibe-browser-tab-close');
				item.click();
			}
		})()`);
		await ensureTabs(inspector, 4);
		const outcome = await drag(inspector, 0, 2);
		assert.ok(outcome.moving, 'No in-flight pointer position was captured');
		assert.ok(Math.abs(outcome.moving.left - outcome.source.left) > 8 ||
			outcome.moving.transform !== outcome.source.transform,
			'Dragged tab did not move visibly during pointer motion');
		assert.notDeepEqual(outcome.after, outcome.before, 'Pointer release did not reorder tabs');
		assert.equal(outcome.after.indexOf(outcome.before[0]), 2, 'Dragged tab landed in wrong position');
		return {initialOrder:outcome.before,finalOrder:outcome.after,transform:outcome.moving.transform};
	});

	await check('Tab drag stays horizontal and inside the tab list', async () => {
		await ensureTabs(inspector, 4);
		// Chrome Tabs settles the previous drag with a short transform animation.
		await sleep(240);
		const start = await geometry(inspector, 1);
		const strip = await inspector.eval(`(() => {
			const rect = ${browser}.querySelector('.vibe-browser-tablist').getBoundingClientRect();
			return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
		})()`);
		const position = () => inspector.eval(`(() => {
			const rect = document.getElementById(${JSON.stringify(start.id)}).getBoundingClientRect();
			return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
		})()`);
		await point(inspector, 'mouseMoved', start.x, start.y);
		await point(inspector, 'mousePressed', start.x, start.y, true);
		try {
			await point(inspector, 'mouseMoved', start.x, strip.bottom + 85, true);
			await sleep(40);
			const vertical = await position();
			// The cursor's vertical displacement must never change the tab's Y.
			assert.ok(Math.abs(vertical.top - (start.y - 15)) < 1, 'Vertical pointer motion moved the tab off its row');
			await point(inspector, 'mouseMoved', Math.max(0, strip.left - 40), strip.bottom + 85, true);
			await sleep(40);
			const left = await position();
			assert.ok(left.left >= strip.left - 1, 'Dragged tab escaped the left edge of the tab list');
			assert.ok(Math.abs(left.top - vertical.top) < 1, 'Dragged tab moved vertically toward the pointer');
			await point(inspector, 'mouseMoved', strip.right + 60, strip.top - 70, true);
			await sleep(40);
			const right = await position();
			assert.ok(right.right <= strip.right + 1, 'Dragged tab escaped the right edge of the tab list');
			assert.ok(Math.abs(right.top - vertical.top) < 1, 'Dragged tab moved vertically above the list');
		} finally {
			await point(inspector, 'mouseReleased', strip.right + 60, strip.top - 70);
		}
	});

	await check('Tab strip has no fake browser icon and retains native controls', async () => {
		await sleep(230);
		const state = await inspector.eval(`(() => {
			const root = ${browser};
			const strip = root.querySelector('.vibe-browser-tabstrip');
			const controls = strip.querySelector('.vo-window-controls');
			const first = root.querySelector('.chrome-tab');
			return {
				pseudo:getComputedStyle(strip, '::before').content,
				controls:controls?.querySelectorAll('button').length,
				fake:!!strip.querySelector('.vibe-browser-window-controls'),
				gap:first.getBoundingClientRect().left - strip.getBoundingClientRect().left,
			};
		})()`);
		assert.ok(['none', 'normal'].includes(state.pseudo), 'Fake browser icon is still rendered');
		assert.equal(state.controls, 3, 'Native window buttons left the tab bar');
		assert.equal(state.fake, false, 'Duplicate window buttons are present');
		assert.ok(state.gap < 24, 'The browser icon still reserves empty space: ' + JSON.stringify(state));
	});

	await check('Small movement remains a click, not a drag', async () => {
		await ensureTabs(inspector, 4);
		await sleep(230);
		const before = await inspector.eval(browserState);
		const source = await geometry(inspector, 1);
		await point(inspector, 'mouseMoved', source.x, source.y);
		await point(inspector, 'mousePressed', source.x, source.y, true);
		await point(inspector, 'mouseMoved', source.x + 2, source.y + 23, true);
		await point(inspector, 'mouseReleased', source.x + 2, source.y + 23);
		await sleep(40);
		const after = await inspector.eval(browserState);
		assert.deepEqual(after.order, before.order, 'Small pointer motion reordered a tab: ' + JSON.stringify({source, before, after}));
		assert.equal(after.active, source.id, 'Pointer-down did not activate the tab');
	});

	await check('Escape cancels drag and restores original tab order', async () => {
		await ensureTabs(inspector, 4);
		const before = (await inspector.eval(browserState)).order;
		const source = await geometry(inspector, 0);
		const target = await geometry(inspector, 3);
		await point(inspector, 'mouseMoved', source.x, source.y);
		await point(inspector, 'mousePressed', source.x, source.y, true);
		try {
			await point(inspector, 'mouseMoved', target.x + 55, source.y, true);
			await sleep(55);
			const moving = (await inspector.eval(browserState)).order;
			assert.notDeepEqual(moving, before, 'Tab did not start dragging before Escape');
			await shortcut(inspector, 'escape');
		} finally {
			await point(inspector, 'mouseReleased', target.x + 55, source.y);
		}
		await sleep(240);
		const after = (await inspector.eval(browserState)).order;
		assert.deepEqual(after, before, 'Escape failed to restore the original order');
	});

	await check('Rapid left/right reversals end cleanly', async () => {
		await ensureTabs(inspector, 4);
		const source = await geometry(inspector, 1);
		const left = await geometry(inspector, 0);
		const right = await geometry(inspector, 3);
		await point(inspector, 'mouseMoved', source.x, source.y);
		await point(inspector, 'mousePressed', source.x, source.y, true);
		try {
			for(const fraction of [1, 0, 1, 0, 1]){
				await point(inspector, 'mouseMoved', fraction ? right.x + 30 : left.x - 25, source.y + 40, true);
				await sleep(26);
			}
		} finally {
			await point(inspector, 'mouseReleased', right.x + 30, source.y + 40);
		}
		await sleep(240);
		const state = await inspector.eval(`(() => {
			const root = ${browser};
			return {sorting:root.querySelector('.chrome-tabs').classList.contains('chrome-tabs-is-sorting'),
				moving:root.querySelectorAll('.chrome-tab-is-dragging, .chrome-tab-is-settling').length,
				inline:[...root.querySelectorAll('.chrome-tab')].filter(tab => tab.style.transform).length,
				order:[...root.querySelectorAll('.chrome-tab')].map(tab => tab.id)};
		})()`);
		assert.equal(state.sorting, false, 'Tab strip remained in sorting mode: ' + JSON.stringify(state));
		assert.equal(state.moving, 0, 'A tab kept its dragging/settling class');
		assert.equal(state.inline, 0, 'A tab retained a stale inline transform');
		assert.equal(new Set(state.order).size, state.order.length, 'Tab order contains duplicates');
	});

	await check('Blur cancels an active drag without leaving state behind', async () => {
		const before = (await inspector.eval(browserState)).order;
		const source = await geometry(inspector, 1);
		const target = await geometry(inspector, 3);
		await point(inspector, 'mouseMoved', source.x, source.y);
		await point(inspector, 'mousePressed', source.x, source.y, true);
		try {
			await point(inspector, 'mouseMoved', target.x + 30, source.y, true);
			await sleep(45);
			await inspector.eval('window.dispatchEvent(new Event("blur"))');
		} finally {
			await point(inspector, 'mouseReleased', target.x + 30, source.y);
		}
		await sleep(230);
		const after = await inspector.eval(browserState);
		assert.deepEqual(after.order, before, 'Blur did not cancel the drag: ' + JSON.stringify({source, before, after}));
	});

	await check('Closing a tab during drag safely releases the session', async () => {
		await ensureTabs(inspector, 4);
		const before = (await inspector.eval(browserState)).order;
		const source = await geometry(inspector, 1);
		const target = await geometry(inspector, 3);
		await point(inspector, 'mouseMoved', source.x, source.y);
		await point(inspector, 'mousePressed', source.x, source.y, true);
		try {
			await point(inspector, 'mouseMoved', target.x, source.y, true);
			await sleep(42);
			await inspector.eval(`document.getElementById(${JSON.stringify(source.id)})?.querySelector('.chrome-tab-close')?.click()`);
		} finally {
			await point(inspector, 'mouseReleased', target.x, source.y);
		}
		await sleep(220);
		const after = (await inspector.eval(browserState)).order;
		assert.equal(after.length, before.length - 1, 'Tab close did not complete');
		assert.ok(!after.includes(source.id), 'Closed tab remains in the model');
		await ensureTabs(inspector, 4);
	});

	await check('Reduced-motion still reorders without tab animation', async () => {
		await inspector.send('Emulation.setEmulatedMedia', {
			features:[{name:'prefers-reduced-motion', value:'reduce'}],
		});
		try {
			// Upstream Chrome Tabs completes its previous drag in nested frames.
			await sleep(240);
			const browserTabsAreNativeDraggable = await inspector.eval(`[...${browser}.querySelectorAll('.vibe-browser-tab')].some(tab => tab.draggable)`);
			assert.equal(browserTabsAreNativeDraggable, false,
				'Tab drag still depends on native HTML draggable elements');
			const before = await geometry(inspector, 1);
			const result = await drag(inspector, 1, 2, false);
			assert.notDeepEqual(result.before, result.after, 'Reduced-motion prevented pointer reordering');
			const after = await geometry(inspector, 1);
			const times = after.transition.split(',').map(value => parseFloat(value));
			assert.ok(times.every(time => Number.isFinite(time) && time <= 0.001),
				`Reduced-motion transition remains ${after.transition} (before: ${before.transition})`);
		}finally {
			await inspector.send('Emulation.setEmulatedMedia', {features:[]});
		}
	});

	await check('Pointercancel restores order and clears drag state', async () => {
		const before = (await inspector.eval(browserState)).order;
		const source = await geometry(inspector, 0);
		const target = await geometry(inspector, 2);
		await inspector.eval(`(() => {
			const strip = ${browser}.querySelector('.chrome-tabs');
			strip.addEventListener('pointerdown', event => {
				strip.dataset.smokePointerId = String(event.pointerId);
			}, {capture:true, once:true});
		})()`);
		await point(inspector, 'mouseMoved', source.x, source.y);
		await point(inspector, 'mousePressed', source.x, source.y, true);
		try {
			await point(inspector, 'mouseMoved', target.x + 25, source.y, true);
			await sleep(42);
			await inspector.eval(`(() => {
				const strip = ${browser}.querySelector('.chrome-tabs');
				const pointerId = Number(strip.dataset.smokePointerId);
				strip.querySelector('.chrome-tabs-content').dispatchEvent(new PointerEvent('pointercancel', {
					pointerId, bubbles:true, cancelable:true,
				}));
			})()`);
		} finally {
			await point(inspector, 'mouseReleased', target.x + 25, source.y);
		}
		await sleep(225);
		assert.deepEqual((await inspector.eval(browserState)).order, before, 'Pointercancel did not restore tab order');
	});

	await check('Overflowed tabs scroll into view without losing keyboard navigation', async () => {
		const originalWidth = await inspector.eval(`(() => {
			const window = ${browserRoot};
			const previous = window.style.width;
			window.style.width = '395px';
			return previous;
		})()`);
		try {
			await sleep(75);
			await ensureTabs(inspector, 16);
			await sleep(125);
			const last = await inspector.eval(`(() => {
				const root = ${browser};
				const list = root.querySelector('.chrome-tabs');
				const viewport = list.getBoundingClientRect();
				const tab = [...root.querySelectorAll('.chrome-tab')].at(-1).getBoundingClientRect();
				return {clientWidth:list.clientWidth, scrollWidth:list.scrollWidth, scrollLeft:list.scrollLeft,
					tabRight:tab.right, viewportRight:viewport.right};
			})()`);
			assert.ok(last.scrollWidth > last.clientWidth, 'Overcrowded tabs did not become scrollable');
			assert.ok(last.scrollLeft > 0, 'Last active tab did not scroll into view');
			assert.ok(last.tabRight <= last.viewportRight + 1, 'Last tab is clipped after selection');
			const selectionShortcut = await shortcut(inspector, 'ctrl+1');
			await sleep(35);
			const first = await inspector.eval(`(() => {
				const root = ${browser};
				const list = root.querySelector('.chrome-tabs');
				const tab = root.querySelector('.chrome-tab').getBoundingClientRect();
				return {left:tab.left, viewportLeft:list.getBoundingClientRect().left, scrollLeft:list.scrollLeft};
			})()`);
			assert.equal(selectionShortcut.prevented, true, 'Ctrl+1 was not handled');
			assert.ok(first.scrollLeft <= 8, 'Ctrl+1 did not scroll back to the first tab');
			assert.ok(first.left >= first.viewportLeft - 1, 'First tab remained clipped');
			const source = await geometry(inspector, 0);
			const edge = await inspector.eval(`${browser}.querySelector('.chrome-tabs').getBoundingClientRect().right - 5`);
			await point(inspector, 'mouseMoved', source.x, source.y);
			await point(inspector, 'mousePressed', source.x, source.y, true);
			try {
				await point(inspector, 'mouseMoved', edge, source.y, true);
				await sleep(160);
				const scrolled = await inspector.eval(`${browser}.querySelector('.chrome-tabs').scrollLeft`);
				assert.ok(scrolled > 0, 'Dragging at the right edge did not auto-scroll hidden tabs');
			} finally {
				await point(inspector, 'mouseReleased', edge, source.y);
			}
		} finally {
			await inspector.eval(`${browserRoot}.style.width = ${JSON.stringify(originalWidth)}`);
			await sleep(85);
		}
	});

	const failures = tests.filter(test => test.status === 'failed');
	console.log(JSON.stringify({passed:tests.length - failures.length, failed:failures.length, tests,
		runtimeErrors:inspector.errors}, null, 2));
	if(failures.length)process.exitCode = 1;
}catch(error) {
	console.error('Browser interaction smoke could not start:', error);
	process.exitCode = 1;
}finally {
	if(inspector && originalBookmarks){
		try {
			await inspector.eval(`(() => {
				for(const [key, value] of Object.entries(${JSON.stringify(originalBookmarks)})){
					const storageKey = 'vibeos.browser.bookmarks.' + key;
					if(value === null)localStorage.removeItem(storageKey);
					else localStorage.setItem(storageKey, value);
				}
			})()`);
		}catch(error){console.error('Could not restore bookmark test state:', error);}
	}
	inspector?.socket.close();
	if(target)await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
}
