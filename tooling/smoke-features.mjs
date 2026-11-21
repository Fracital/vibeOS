import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const server = process.env.VIBEOS_TEST_URL || 'http://127.0.0.1:4321/';
const port = Number(process.env.VIBEOS_CDP_PORT || 9357);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Inspector {
	constructor(ws) {
		this.ws = ws;
		this.pending = new Map();
		this.errors = [];
		this.nextId = 1;
		ws.addEventListener('message', ({data}) => {
			const response = JSON.parse(data);
			if(response.method === 'Runtime.exceptionThrown')this.errors.push(response.params.exceptionDetails.exception?.description || response.params.exceptionDetails.text);
			if(response.method === 'Runtime.consoleAPICalled' && response.params.type === 'error'){
				this.errors.push(response.params.args.map((entry) => entry.value || entry.description).join(' '));
			}
			const pending = this.pending.get(response.id);
			if(!pending)return;
			this.pending.delete(response.id);
			if(response.error)pending.reject(new Error(JSON.stringify(response.error)));
			else pending.resolve(response.result);
		});
	}
	async send(method, params = {}) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {resolve, reject});
			this.ws.send(JSON.stringify({id, method, params}));
		});
	}
	async eval(expression) {
		const result = await this.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
		if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
		return result.result.value;
	}
}

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT'})).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener('open', resolve, {once: true});
	ws.addEventListener('error', reject, {once: true});
});
const tab = new Inspector(ws);

const open = async (category, app) => {
	const code = `(() => {
		const launcher = document.querySelector('.vo-applications');
		const menu = document.querySelector('.vo-application-menu');
		if(menu.hidden)launcher.click();
		const group = [...menu.querySelectorAll(':scope > .vo-menu-entry')]
			.find(item => item.querySelector(':scope > button')?.textContent.trim().startsWith(${JSON.stringify(category)}));
		if(!group)throw Error('Missing category ' + ${JSON.stringify(category)});
		group.querySelector(':scope > button').click();
		const entry = [...group.querySelectorAll(':scope > .vo-submenu > .vo-menu-entry > button')]
			.find(item => item.textContent.trim() === ${JSON.stringify(app)});
		if(!entry)throw Error('Missing app ' + ${JSON.stringify(app)});
		entry.click();
		return {dismissed:menu.hidden, count:document.querySelectorAll('.vo-window').length};
	})()`;
	const result = await tab.eval(code);
	assert.equal(result.dismissed, true, `Application menu stayed open after ${app}`);
	return result;
};

let originalBookmarkStorage = null;
try {
	await tab.send('Page.enable');
	await tab.send('Runtime.enable');
	await tab.send('Emulation.setDeviceMetricsOverride', {width: 800, height: 600, deviceScaleFactor: 1, mobile: false});
	await tab.send('Page.navigate', {url: server});
	await sleep(1000);
	assert.equal(await tab.eval('document.querySelector("#vibeos-root")?.dataset.booted'), 'true');
	assert.equal(await tab.eval('document.querySelectorAll("canvas").length'), 0, 'Desktop must be DOM based');
	assert.equal(await tab.eval('document.querySelector("#vibeos-root").dataset.cursorTheme'), 'kittydog');
	const menuCategoryCheck = await tab.eval(`(() => {
		const button = document.querySelector('.vo-applications');
		button.click();
		const all = [...document.querySelectorAll('.vo-application-menu > .vo-menu-entry')];
		const choose = (prefix) => {
			const row = all.find(entry => entry.querySelector(':scope > button')?.textContent.startsWith(prefix));
			if(!row)throw Error('Missing ' + prefix);
			row.querySelector(':scope > button').click();
			return row;
		};
		const graphics = choose('Graphics');
		graphics.querySelector(':scope > button').focus();
		const settings = choose('Settings');
		const visible = all.filter(entry => {
			const menu = entry.querySelector(':scope > .vo-submenu');
			return menu && getComputedStyle(menu).display !== 'none';
		}).map(entry => entry.querySelector(':scope > button').textContent.trim());
		const expanded = all.filter(entry => entry.classList.contains('vo-expanded')).length;
		const selectability = getComputedStyle(settings.querySelector(':scope > button')).userSelect;
		button.click();
		return {visible, expanded, selectability, closed:document.querySelector('.vo-application-menu').hidden};
	})()`);
	assert.deepEqual(menuCategoryCheck.visible, ['Settings▸'], 'Two application categories remained open');
	assert.equal(menuCategoryCheck.expanded, 1);
	assert.equal(menuCategoryCheck.selectability, 'none', 'Button labels can be selected');
	assert.equal(menuCategoryCheck.closed, true);

	// Outside pointer events immediately dismiss the launcher, even without a click.
	await tab.eval('document.querySelector(".vo-applications").click()');
	assert.equal(await tab.eval('document.querySelector(".vo-application-menu").hidden'), false);
	await tab.eval('document.querySelector(".vo-wallpaper").dispatchEvent(new PointerEvent("pointerdown", {bubbles:true}))');
	assert.equal(await tab.eval('document.querySelector(".vo-application-menu").hidden'), true);

	await open('Settings', 'Mouse and Touchpad');
	const screenshot = await tab.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
	await writeFile('.parity/native-mouse-settings-800x600.png', Buffer.from(screenshot.data, 'base64'));
	const mouse = await tab.eval(`(() => {
		const tango = document.querySelector('.vo-mouse-theme-card input[value="tango"]');
		tango.checked = true;
		tango.dispatchEvent(new Event('change', {bubbles:true}));
		const speed = document.querySelector('.vo-mouse-speed input');
		speed.value = '175';
		speed.dispatchEvent(new Event('input', {bubbles:true}));
		const selected = {
			theme:document.querySelector('#vibeos-root').dataset.cursorTheme,
			response:getComputedStyle(document.querySelector('#vibeos-root')).getPropertyValue('--vo-drag-response').trim(),
			preview:document.querySelector('.vo-mouse-preview-icon').getAttribute('src')
		};
		document.querySelector('.vo-mouse-reset').click();
		return selected;
	})()`);
	assert.equal(mouse.theme, 'tango');
	assert.equal(mouse.response, '1.75');
	assert.equal(mouse.preview, '/cursors/tango/pointer.png');
	assert.equal(await tab.eval('document.querySelector("#vibeos-root").dataset.cursorTheme'), 'kittydog');

	await tab.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 740, y: 13});
	const tooltip = await tab.eval('getComputedStyle(document.querySelector(".vo-clock"), "::after").content');
	assert.ok(tooltip !== 'none' && tooltip.includes('2026'), 'Clock hover tooltip missing');

	await open('Games', '2048');
	await sleep(350);
	await open('System', 'JS Terminal');
	const stacking = await tab.eval(`(() => {
		const all = [...document.querySelectorAll('.vo-window')];
		const game = all.find(win => win.getAttribute('aria-label') === '2048');
		const terminal = all.find(win => win.getAttribute('aria-label') === 'JS Terminal');
		const before = Number(game.style.zIndex) < Number(terminal.style.zIndex);
		game.querySelector('iframe').focus();
		const after = Number(game.style.zIndex) > Number(terminal.style.zIndex);
		return {before,after};
	})()`);
	assert.ok(stacking.before && stacking.after, 'Focusing an iframe must raise its window');

		// Exercise the upstream defaults independently of older user bookmarks in this Chrome profile.
		originalBookmarkStorage = await tab.eval(`(() => ({
			v1:localStorage.getItem('vibeos.browser.bookmarks.v1'),
			v2:localStorage.getItem('vibeos.browser.bookmarks.v2'),
			upstream:localStorage.getItem('stomp-demo:bookmarks'),
		}))()`);
		await tab.eval(`(() => {
			localStorage.removeItem('vibeos.browser.bookmarks.v1');
			localStorage.removeItem('vibeos.browser.bookmarks.v2');
			localStorage.removeItem('stomp-demo:bookmarks');
		})()`);
		await open('Internet', 'vibeBrowser');
	await sleep(600);
	await tab.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 450, y: 250});
		if(process.argv.includes('--capture')) {
			const chromeScreenshot = await tab.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
			await writeFile('.parity/native-chrome-tabs-800x600.png', Buffer.from(chromeScreenshot.data, 'base64'));
		}
		const appsPage = await tab.eval(`(() => {
			const browser = [...document.querySelectorAll('.vibe-browser')].at(-1);
			const home = browser.querySelector('.vibe-browser-panel:not([hidden]) .vibe-browser-home');
			const bookmarkButtons = [...browser.querySelectorAll('.vibe-browser-bookmarks button')];
			return {
				heading:home.querySelector('.vibe-browser-apps-header h1')?.textContent,
				tiles:home.querySelectorAll('.vibe-browser-app-tile').length,
				appsBookmarkButton:bookmarkButtons.some(button => button.textContent.trim() === 'Apps'),
			};
		})()`);
		assert.equal(appsPage.heading, 'Apps', 'New Tab must open directly to Apps');
		assert.ok(appsPage.tiles >= 10, 'New Tab is missing the ten built-in STomp app tiles');
		assert.equal(appsPage.appsBookmarkButton, false, 'Redundant Apps bookmark button remains');
	const tabs = await tab.eval(`(() => {
		const browser = [...document.querySelectorAll('.vibe-browser')].at(-1);
		const count = () => browser.querySelectorAll('.vibe-browser-tab').length;
		const initial = count();
		browser.querySelector('.vibe-browser-new-tab').click();
		const added = count();
		browser.querySelectorAll('.vibe-browser-tab-close')[1].click();
		return {initial,added,remaining:count()};
	})()`);
	assert.deepEqual(tabs, {initial:1, added:2, remaining:1});
	const chrome = await tab.eval(`(() => {
		const browser = [...document.querySelectorAll('.vibe-browser')].at(-1);
		const window = browser.closest('.vo-window');
		const originalStorage = localStorage.getItem('vibeos.browser.bookmarks.v2');
		const bookmarks = [...browser.querySelectorAll('.vibe-browser-bookmark')];
		const names = bookmarks.map(button => button.textContent.trim());
		const colors = bookmarks.map(button => button.querySelector('img')?.src);
		const source = bookmarks[0];
		const target = bookmarks[bookmarks.length - 1];
		const transfer = new DataTransfer();
		source.dispatchEvent(new DragEvent('dragstart', {bubbles:true, cancelable:true, dataTransfer:transfer}));
		const box = target.getBoundingClientRect();
		target.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer:transfer, clientX:box.right - 1}));
		target.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:transfer, clientX:box.right - 1}));
		const afterBookmarks = [...browser.querySelectorAll('.vibe-browser-bookmark')].map(button => button.textContent.trim());
		const storedBookmarks = JSON.parse(localStorage.getItem('vibeos.browser.bookmarks.v2') || '[]').map(bookmark => bookmark.title);
		if(originalStorage === null)localStorage.removeItem('vibeos.browser.bookmarks.v2');
		else localStorage.setItem('vibeos.browser.bookmarks.v2', originalStorage);
		globalThis.dispatchEvent(new Event('vibeos:bookmarks-changed'));
		const originalTab = browser.querySelector('.vibe-browser-tab');
		browser.querySelector('.vibe-browser-new-tab').click();
		browser.querySelector('.vibe-browser-new-tab').click();
		const beforeTabs = [...browser.querySelectorAll('.vibe-browser-tab')].map(item => item.id);
		const noTitlebar = getComputedStyle(window.querySelector('.vo-titlebar')).display === 'none';
		const nativeControls = browser.querySelector('.vo-window-controls');
		const topButtons = nativeControls?.querySelectorAll('button').length ?? 0;
		const reusedControls = nativeControls?.parentElement?.classList.contains('vibe-browser-tabstrip') &&
			!browser.querySelector('.vibe-browser-window-controls') && !!browser.querySelector('.chrome-tabs .chrome-tabs-content');
		browser.querySelector('.vo-window-minimize').click();
		const minimized = window.hidden && document.querySelectorAll('.vo-task-entry').length > 0;
		document.querySelector('.vo-task-entry').click();
		const restored = !window.hidden && window.classList.contains('vo-active');
		browser.querySelector('.vo-window-maximize').click();
		const maximized = window.classList.contains('vo-maximized') && window.offsetLeft === 0;
		browser.querySelector('.vo-window-maximize').click();
		const unmaximized = !window.classList.contains('vo-maximized');
			return {names,colors,afterBookmarks,storedBookmarks,beforeTabs,noTitlebar,topButtons,reusedControls,minimized,restored,maximized,unmaximized};
	})()`);
	assert.deepEqual(chrome.names, ['Fracital','vibeOS','estrogen','Krunk','Reddit','Google','YouTube','Discord','Chrome Web Store','N SVG'], 'STomp bookmark defaults differ');
		assert.ok(chrome.colors.every((icon, index) => index === 6 ?
			icon.endsWith('/icons/youtube.svg') : icon.includes('/stomp-bookmarks/icons/')),
			'STomp curated icons differ (YouTube intentionally uses the repaired /icons/youtube.svg)');
	assert.equal(chrome.afterBookmarks.at(-1), 'Fracital', 'Bookmark drag did not change order');
	assert.equal(chrome.storedBookmarks.at(-1), 'Fracital', 'Bookmark reordering was not persisted');
		const dragPoints = await tab.eval(`(() => {
			const tabs = [...document.querySelectorAll('.vibe-browser-tab')];
			const first = tabs[0].getBoundingClientRect();
			const last = tabs[tabs.length - 1].getBoundingClientRect();
			return {
				x:first.left + first.width / 2, y:first.top + first.height / 2,
				target:last.right - 8, firstId:tabs[0].id, initialLeft:first.left,
			};
		})()`);
		await tab.send('Input.dispatchMouseEvent', {type:'mouseMoved', x:dragPoints.x, y:dragPoints.y});
		await tab.send('Input.dispatchMouseEvent', {
			type:'mousePressed', x:dragPoints.x, y:dragPoints.y, button:'left', buttons:1, clickCount:1,
		});
		let dragMoving;
		try {
			for(const amount of [0.20, 0.40, 0.65, 0.85, 1]) {
				await tab.send('Input.dispatchMouseEvent', {
					type:'mouseMoved', x:dragPoints.x + (dragPoints.target - dragPoints.x) * amount,
					y:dragPoints.y, button:'left', buttons:1,
				});
				await sleep(25);
				if(amount === 0.65) {
					dragMoving = await tab.eval(`(() => {
						const item = document.getElementById(${JSON.stringify(dragPoints.firstId)});
						return {left:item.getBoundingClientRect().left, transform:getComputedStyle(item).transform};
					})()`);
				}
			}
		}finally {
			await tab.send('Input.dispatchMouseEvent', {
				type:'mouseReleased', x:dragPoints.target, y:dragPoints.y, button:'left', buttons:0, clickCount:1,
			});
		}
		await sleep(250);
		const afterTabs = await tab.eval(`(() => {
			const browser = [...document.querySelectorAll('.vibe-browser')].at(-1);
			const order = [...browser.querySelectorAll('.vibe-browser-tab')].map(item => item.id);
			const closeTarget = browser.querySelector('.vibe-browser-tab');
			closeTarget.dispatchEvent(new MouseEvent('auxclick', {bubbles:true,cancelable:true,button:1}));
			const afterMiddleClick = [...browser.querySelectorAll('.vibe-browser-tab')].map(item => item.id);
			return {order, afterMiddleClick};
		})()`);
		assert.ok(Math.abs(dragMoving.left - dragPoints.initialLeft) > 8 || dragMoving.transform !== 'none',
			'Pointer drag did not visibly move the tab before release');
		assert.notEqual(afterTabs.order[0], chrome.beforeTabs[0], 'Pointer tab drag did not change order');
		assert.equal(afterTabs.afterMiddleClick.length, afterTabs.order.length - 1, 'Middle-click did not close the tab');
		chrome.afterTabs = afterTabs.order;
		chrome.afterMiddleClick = afterTabs.afterMiddleClick;
	assert.ok(chrome.noTitlebar && chrome.topButtons === 3 && chrome.reusedControls, 'Native vibeOS controls were not reused in the Chrome Tabs strip');
	assert.ok(chrome.minimized && chrome.restored && chrome.maximized && chrome.unmaximized, 'Window minimize/maximize/restore failed');

	await open('Installed Apps', 'App Manager');
	const appManagerInitial = await tab.eval(`(() => {
		const root = document.querySelector('.vo-app-catalog');
		return {exists:!!root, input:!!root?.querySelector('.vo-app-catalog-install input'), status:!!root?.querySelector('[role="status"]')};
	})()`);
	assert.ok(appManagerInitial.exists && appManagerInitial.input && appManagerInitial.status, 'Installed app manager did not render');
	await tab.eval(`(() => {
		const form = document.querySelector('.vo-app-catalog-install');
		form.querySelector('input').value = ${JSON.stringify(server + 'appfiles/2048/index.html')};
		form.querySelector('select').value = 'stomp';
		form.requestSubmit();
	})()`);
	await sleep(1200);
	const installed = await tab.eval(`(() => ({
		status:document.querySelector('.vo-app-catalog-status')?.textContent,
		items:[...document.querySelectorAll('.vo-app-catalog-card')].map(card => card.textContent),
		menu:[...document.querySelectorAll('.vo-application-menu > .vo-menu-entry > button')].map(item => item.textContent.trim()),
	}))()`);
	assert.ok(installed.status?.includes('Installed') && installed.items.length >= 1, 'Installing an STomp app from App Manager failed');
	assert.ok(installed.menu.some((label) => label.startsWith('Installed Apps')), 'App menu did not refresh after installation');
	await tab.eval(`(() => {
		const card = [...document.querySelectorAll('.vo-app-catalog-card')].find(card => card.textContent.includes('2048'));
		if(!card)throw Error('2048 app not found in manager');
		const remove = [...card.querySelectorAll('button')].find(button => button.textContent === 'Uninstall');
		remove.click();
	})()`);
	const uninstalled = await tab.eval('document.querySelector(".vo-app-catalog-status")?.textContent');
	assert.ok(uninstalled.includes('Uninstalled'), 'Uninstall did not complete');

	await open('Accessories', 'Emulator');
	await sleep(3500);
	const vm = await tab.eval(`(() => {
		const viewport = document.querySelector('.vibe-emulator-viewport');
		const screen = document.querySelector('.vibe-emulator-screen canvas');
		const rect = screen.getBoundingClientRect();
		const area = viewport.getBoundingClientRect();
		return {
			status:document.querySelector('.vibe-emulator-status')?.textContent,
			width:[rect.width,area.width], height:[rect.height,area.height],
			overflow:getComputedStyle(viewport).overflowX,
		};
	})()`);
	assert.ok(vm.status?.includes('FreeDOS'), 'Emulator did not boot');
	assert.equal(vm.overflow, 'hidden', 'VM viewport is still scrollable');
	assert.ok(vm.width[0] <= vm.width[1] + 1 && vm.height[0] <= vm.height[1] + 1, 'VM canvas spills outside available window');
		const emulatorMenus = await tab.eval('[...document.querySelectorAll(".vibe-emulator-menu > summary")].map(item => item.textContent)');
		assert.deepEqual(emulatorMenus, ['VM', 'State', 'Systems', 'Online', 'Games'], 'Original-style emulator menus are missing');
		await tab.eval(`(() => {
			const games = [...document.querySelectorAll('.vibe-emulator-menu')].find(menu => menu.querySelector('summary')?.textContent === 'Games');
			games.querySelector('summary').click();
			[...games.querySelectorAll('button')].find(item => item.textContent === 'Floppy Bird').click();
		})()`);
		await sleep(2500);
		const vmGame = await tab.eval(`(() => {
			const canvas = document.querySelector('.vibe-emulator-screen canvas');
			const rect = canvas.getBoundingClientRect();
			const outer = canvas.closest('.vo-window').getBoundingClientRect();
			return {status:document.querySelector('.vibe-emulator-status')?.textContent,
				canvas:[canvas.width,canvas.height], rendered:[rect.width,rect.height],
				window:[outer.width,outer.height], titleStatus:document.querySelector('.vibe-emulator-player-status')?.getAttribute('src')};
		})()`);
		assert.ok(vmGame.status?.includes('Floppy Bird'), 'Emulator did not load Floppy Bird from the Games menu');
		assert.deepEqual(vmGame.canvas, [320, 200], 'Floppy Bird framebuffer dimensions differ');
		assert.deepEqual(vmGame.rendered, [640, 400], 'Floppy Bird should render at 2x pixel scale');
		assert.ok(vmGame.titleStatus?.includes('player_pause.png'), 'Running VM icon does not show pause');
		if(process.argv.includes('--capture')) {
			const image = await tab.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
			await writeFile('.parity/native-floppy-bird.png', Buffer.from(image.data, 'base64'));
		}
		await tab.eval(`(() => {
			const vm = [...document.querySelectorAll('.vibe-emulator-menu')].find(menu => menu.querySelector('summary')?.textContent === 'VM');
			vm.querySelector('summary').click();
			[...vm.querySelectorAll('button')].find(item => item.textContent === 'Keyboard Input...').click();
		})()`);
		assert.equal(await tab.eval('getComputedStyle(document.querySelector(".vibe-emulator-footer")).display'), 'flex', 'Keyboard input menu does not reveal advanced controls');
	let remoteStomp;
	if(process.argv.includes('--remote-stomp')) {
		await open('Graphics', 'Chrome Canvas');
		await sleep(5500);
		remoteStomp = await tab.eval(`(() => {
			const app = [...document.querySelectorAll('.vo-window')]
				.filter(element => element.querySelector('.vo-web-app-frame')).at(-1);
			const frame = app?.querySelector('.vo-web-app-frame');
			const content = app?.querySelector('.vo-window-content');
			return {
				title:app?.getAttribute('aria-label'),
				iframeSrc:frame?.src,
				status:app?.querySelector('.vo-web-app-status')?.textContent || null,
				extraToolbar:!!app?.querySelector('.vo-web-app-bar, .vo-open-external, .vo-web-app-address'),
				topGap:frame && content ? Math.round(frame.getBoundingClientRect().top - content.getBoundingClientRect().top) : null,
			};
		})()`);
		assert.ok(remoteStomp.iframeSrc?.includes('/scripts/stomp/'), 'Chrome Canvas did not use STomp');
		assert.equal(remoteStomp.extraToolbar, false, 'Chrome Canvas still has a URL or external browser bar');
		assert.equal(remoteStomp.topGap, 0, 'Chrome Canvas iframe does not fill the window from the top');
	}
	assert.equal(tab.errors.length, 0, `Browser errors: ${tab.errors.join('; ')}`);
			console.log(JSON.stringify({ok: true, menuCategoryCheck, mouse, tooltip, stacking, appsPage, tabs, chrome, installed, uninstalled, vm, vmGame, ...(remoteStomp ? {remoteStomp} : {}), errors: tab.errors}, null, 2));
} finally {
	if(originalBookmarkStorage !== null) {
		try {
			await tab.eval(`(() => {
				const saved = ${JSON.stringify(originalBookmarkStorage)};
				for(const [name, key] of [
					['v1','vibeos.browser.bookmarks.v1'],
					['v2','vibeos.browser.bookmarks.v2'],
					['upstream','stomp-demo:bookmarks'],
				]) {
					if(saved[name] === null)localStorage.removeItem(key);
					else localStorage.setItem(key, saved[name]);
				}
			})()`);
		}catch(error){console.error('Could not restore bookmark test storage:', error);}
	}
	ws.close();
	await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
}
