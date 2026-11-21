import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Check original asset path parity and the native HTML5 desktop produced by Astro.
// --source inspects TypeScript sources without first building Astro.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceOnly = process.argv.includes('--source');
const unknown = process.argv.slice(2).filter((arg) => arg !== '--source');
const maxFileBytes = 25 * 1024 * 1024;
const maxFiles = 20000;
const vendorScripts = [
	'/scripts/net/libcurl.js',
	'/scripts/stomp/Controller.js',
	'/scripts/v86/libv86.js',
];
const domSources = ['desktop.ts', 'types.ts', 'apps.ts', 'browser.ts', 'emulator.ts', 'mouse.ts', 'catalog.ts', 'bookmarks.ts', 'chromeTabStrip.ts', 'chrome-tabs.d.ts'];
const cursorFiles = [
	'left_ptr', 'pointer', 'hand2', 'text', 'grab', 'grabbing', 'wait', 'crosshair',
	'n-resize', 's-resize', 'e-resize', 'w-resize', 'ew-resize', 'ns-resize', 'nwse-resize',
	'nesw-resize', 'not_allowed', 'help', 'move', 'progress', 'pencil', 'all-scroll', 'half-busy',
];
const stompBookmarkIcons = [
	'fracital.svg', 'vibeos.png', 'estrogen.png', 'krunker.png', 'reddit.png',
	'google.png', 'youtube.svg', 'discord.png', 'chromewebstore.png', 'nsvg.png',
];
const staticDirectories = ['tango', 'appfiles', 'scripts/net', 'scripts/stomp', 'scripts/v86'];
const rootAssets = ['favicon.png', 'README.md', 'LICENSE.md'];
const keyAssets = [
	'scripts/net/libcurl.js',
	'scripts/net/libcurl.wasm',
	'scripts/stomp/Controller.js',
	'scripts/stomp/serviceWorker.js',
	'scripts/stomp/transportWorker.js',
	'scripts/stomp/epoxy/index.mjs',
	'scripts/stomp/SOURCE',
	'scripts/v86/libv86.js',
	'scripts/v86/v86.wasm',
	'scripts/v86/bios/seabios.bin',
	'scripts/v86/bios/vgabios.bin',
	'scripts/v86/images/freedos722.img',
	'appfiles/2048/index.html',
	'appfiles/tetris/index.html',
	'appfiles/breakout/index.html',
	'tango/wallpapers/a.png',
	'tango/cursor/pointer.cur',
	'tango/window/close_idle.png',
];
const failures = [];
const report = (message) => failures.push(message);
const publicRoot = join(root, 'public');
// An alternate Astro output path permits parity checks when the source disk
// is busy, without changing the default Cloudflare Pages dist directory.
const distRoot = process.env.VIBEOS_DIST_ROOT ? resolve(process.env.VIBEOS_DIST_ROOT) : join(root, 'dist');
const pathAt = (base, urlPath) => join(base, ...urlPath.split('/'));

const readText = async (path) => {
	try {
		return await readFile(path, 'utf8');
	} catch (err) {
		report(`Cannot read ${relative(root, path)}: ${err.code ?? err.message}`);
		return null;
	}
};

const readJson = async (path) => {
	const value = await readText(path);
	if(value == null)return null;
	try {
		return JSON.parse(value);
	} catch (err) {
		report(`Invalid JSON in ${relative(root, path)}: ${err.message}`);
		return null;
	}
};

const fileInfo = async (path, label) => {
	try {
		const info = await stat(path);
		if(!info.isFile())throw new Error('not a regular file');
		return info;
	} catch (err) {
		report(`${label}: ${err.code ?? err.message}`);
		return null;
	}
};

const digest = async (path) => {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path))hash.update(chunk);
	return hash.digest('hex');
};

const expectedAssetPaths = async () => {
	const all = [...rootAssets];
	const visit = async (dir, prefix) => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (err) {
			report(`Cannot list original assets at ${relative(root, dir)}: ${err.code ?? err.message}`);
			return;
		}
		for(const entry of entries){
			const name = `${prefix}/${entry.name}`;
			if(entry.isDirectory())await visit(join(dir, entry.name), name);
			else if(entry.isFile())all.push(name);
			else report(`Unexpected original asset type: ${name}`);
		}
	};
	for(const dir of staticDirectories)await visit(pathAt(root, dir), dir);
	return all.sort();
};

const checkHtml = async (path, label) => {
	const html = await readText(path);
	if(html == null)return;
	if(!/<div\b[^>]*\bid=["']vibeos-root["']/i.test(html))report(`${label}: missing native HTML desktop #vibeos-root`);
	if(/<canvas\b/i.test(html))report(`${label}: desktop must not render on canvas`);
	if(/\bid=["'](?:mCanvas|overlay|webViews)["']/i.test(html))report(`${label}: legacy canvas DOM detected`);
	const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => {
		const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[1]);
		return src?.[1] ?? '(inline script)';
	});
	const foundVendor = scripts.filter((src) => src.startsWith('/scripts/'));
	if(JSON.stringify(foundVendor) !== JSON.stringify(vendorScripts)){
		report(`${label}: vendor script order expected ${vendorScripts.join(' -> ')}, got ${foundVendor.join(' -> ')}`);
	}
	for(const asset of vendorScripts){
		const local = pathAt(sourceOnly ? publicRoot : distRoot, asset.slice(1));
		await fileInfo(local, `${label}: script ${asset}`);
	}
	if(!scripts.some((script) => script === '(inline script)' || script.startsWith('/_astro/'))){
		report(`${label}: missing native TypeScript module bootstrap`);
	}
};

const checkSources = async () => {
	const config = await readJson(join(root, 'tsconfig.dom.json'));
	const packageJson = await readJson(join(root, 'package.json'));
	const entry = await readText(join(root, 'src/pages/index.astro'));
	if(config == null || entry == null || packageJson == null)return;
	if(packageJson.dependencies?.['chrome-tabs'] !== '5.4.0'){
		report('Native browser must use the pinned chrome-tabs@5.4.0 dependency');
	}
	if(config.compilerOptions?.strict !== true || config.compilerOptions?.noEmit !== true){
		report('tsconfig.dom.json must strictly typecheck the native desktop without emitting legacy scripts');
	}
	if(!entry.includes("import { bootDesktop } from '../dom/desktop'")){
		report('Astro entry must boot the native TypeScript desktop');
	}
	for(const name of domSources)await fileInfo(join(root, 'src/dom', name), `Native TypeScript source src/dom/${name}`);
	for(const name of ['desktop.css', 'apps.css', 'browser.css', 'emulator.css', 'mouse.css', 'catalog.css']){
		await fileInfo(join(root, 'src/dom', name), `Native desktop stylesheet src/dom/${name}`);
	}
	for(const name of ['chrome-tabs.txt', 'draggabilly.txt']){
		const source = pathAt(publicRoot, `licenses/${name}`);
		const info = await fileInfo(source, `MIT license notice ${name}`);
		if(sourceOnly || !info)continue;
		const dist = pathAt(distRoot, `licenses/${name}`);
		const copy = await fileInfo(dist, `Built MIT license notice ${name}`);
		if(copy && (copy.size !== info.size || await digest(source) !== await digest(dist))){
			report(`Built MIT license notice ${name} does not match its source`);
		}
	}
};

const checkRuntime = async () => {
	if(sourceOnly)return;
	const jsFiles = [];
	const visit = async (directory) => {
		for(const item of await readdir(directory, {withFileTypes: true})){
			const filename = join(directory, item.name);
			if(item.isDirectory())await visit(filename);
			else if(item.isFile() && item.name.endsWith('.js'))jsFiles.push(filename);
		}
	};
	try { await visit(join(distRoot, '_astro')); } catch(err) {
		report(`Cannot inspect native runtime dist/_astro/: ${err.code ?? err.message}`);
		return;
	}
	if(!jsFiles.length)report('Astro did not emit a JavaScript module for the native desktop');
	const js = (await Promise.all(jsFiles.map((path) => readText(path)))).filter(Boolean).join('\n');
	for(const marker of ['vo-applications', 'vo-window', 'vo-wallpaper', 'vibeos.wallpaper', 'vibe-browser-tabstrip', 'vibeos.mouse.settings', 'vibeos.installed-apps.v1']){
		if(!js.includes(marker))report(`Bundled native desktop runtime missing ${marker}`);
	}
	try {
		await stat(join(distRoot, 'vibeos.js'));
		report('Old canvas-based dist/vibeos.js is still deployed');
	} catch(err) { if(err.code !== 'ENOENT')report(`Checking legacy bundle: ${err.message}`); }
};

const checkFallback = async (base, label) => {
	const redirects = await readText(join(base, '_redirects'));
	if(redirects == null)return;
	const rules = redirects.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
	if(!rules.some((line) => /^\/\*\s+\/index\.html\s+200(?:\s|$)/.test(line))){
		report(`${label}: _redirects needs an SPA fallback: /* /index.html 200`);
	}
};

const checkAssetParity = async (paths, base, label) => {
	let matched = 0;
	for(const item of paths){
		const originalPath = pathAt(root, item);
		const copiedPath = pathAt(base, item);
		const original = await fileInfo(originalPath, `Original asset ${item}`);
		const copied = await fileInfo(copiedPath, `${label}: missing original URL /${item}`);
		if(original == null || copied == null)continue;
		if(original.size !== copied.size){
			report(`${label}: size mismatch /${item} (${copied.size} vs ${original.size} bytes)`);
			continue;
		}
		try {
			if(await digest(originalPath) !== await digest(copiedPath)){
				report(`${label}: SHA256 mismatch /${item}`);
				continue;
			}
			matched++;
		} catch (err) {
			report(`${label}: cannot hash /${item}: ${err.code ?? err.message}`);
		}
	}
	return matched;
};

const checkMouseTheme = async () => {
	for(const name of cursorFiles){
		const filename = `cursors/kittydog/${name}.png`;
		const source = pathAt(publicRoot, filename);
		const info = await fileInfo(source, `Kittydog Crystal pointer ${name}`);
		if(info && (info.size < 100 || info.size > 100000))report(`Kittydog pointer ${name} has an unexpected size`);
		if(sourceOnly)continue;
		const copied = pathAt(distRoot, filename);
		const dist = await fileInfo(copied, `Built Kittydog Crystal pointer ${name}`);
		if(info && dist && (info.size !== dist.size || await digest(source) !== await digest(copied))){
			report(`Kittydog pointer /${filename} does not match source SHA256`);
		}
	}
	const manifest = await readJson(pathAt(publicRoot, 'cursors/kittydog/hotspots.json'));
	if(!manifest || cursorFiles.some((name) => !Array.isArray(manifest[name]) || manifest[name].length !== 2)){
		report('Kittydog cursor hotspots manifest is incomplete');
	}
};

const checkBookmarkIcons = async () => {
	const source = await readText(pathAt(publicRoot, 'stomp-bookmarks/SOURCE'));
	if(source == null)return;
	if(!source.includes('058c7e729c67f1a2f31b09ed3919652572aa315c')){
		report('STomp bookmarks must document a pinned upstream revision');
	}
	for(const filename of stompBookmarkIcons){
		const relativePath = `stomp-bookmarks/icons/${filename}`;
		const path = pathAt(publicRoot, relativePath);
		const expected = new RegExp(`([a-f0-9]{64})\\s+icons/${filename.replace('.', '\\.')}`).exec(source)?.[1];
		const info = await fileInfo(path, `Curated STomp bookmark icon ${filename}`);
		if(!expected)report(`Missing upstream SHA-256 for STomp bookmark icon ${filename}`);
		if(info && expected && await digest(path) !== expected)report(`Curated bookmark icon ${filename} differs from pinned upstream source`);
		if(sourceOnly)continue;
		const target = pathAt(distRoot, relativePath);
		const built = await fileInfo(target, `Built STomp bookmark icon ${filename}`);
		if(info && built && (info.size !== built.size || await digest(path) !== await digest(target))){
			report(`Dist STomp bookmark icon ${filename} differs from source SHA-256`);
		}
	}
};

const checkDistLimits = async () => {
	let files = 0;
	let largest = {path: '', bytes: 0};
	const visit = async (dir) => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (err) {
			report(`Cannot inspect dist: ${err.code ?? err.message}`);
			return;
		}
		for(const entry of entries){
			const path = join(dir, entry.name);
			const name = relative(distRoot, path).split(sep).join('/');
			if(entry.isDirectory())await visit(path);
			else if(entry.isFile()){
				files++;
				const info = await lstat(path);
				if(info.size > largest.bytes)largest = {path: name, bytes: info.size};
				if(info.size > maxFileBytes)report(`Cloudflare Pages file limit exceeded: /${name} (${info.size} bytes)`);
			}else report(`dist contains a non-file or symlink: /${name}`);
		}
	};
	await visit(distRoot);
	if(files >= maxFiles)report(`Cloudflare Pages file count exceeded: ${files} (limit below ${maxFiles})`);
	return {files, largest};
};

if(unknown.length)report(`Unexpected arguments: ${unknown.join(' ')}`);
const sourceHtml = join(root, 'src/pages/index.astro');
await checkHtml(sourceHtml, 'Astro source');
await checkSources();
await checkRuntime();
await checkFallback(publicRoot, 'public');
await checkMouseTheme();
await checkBookmarkIcons();
const assets = await expectedAssetPaths();
for(const key of keyAssets)if(!assets.includes(key))report(`Key original asset missing: ${key}`);
const publicMatched = await checkAssetParity(assets, publicRoot, 'public');

let distMatched = 0;
let limits = null;
if(!sourceOnly){
	await checkHtml(join(distRoot, 'index.html'), 'Astro dist');
	await checkFallback(distRoot, 'dist');
	distMatched = await checkAssetParity(assets, distRoot, 'dist');
	limits = await checkDistLimits();
}

console.log(`Asset parity: public ${publicMatched}/${assets.length} SHA256 matches${sourceOnly ? '' : `, dist ${distMatched}/${assets.length} SHA256 matches`}`);
if(limits != null)console.log(`Cloudflare Pages: ${limits.files} files (limit < ${maxFiles}), largest /${limits.largest.path} (${(limits.largest.bytes / 1024 / 1024).toFixed(2)} MiB; limit 25 MiB)`);
if(failures.length){
	for(const message of failures.slice(0, 40))console.error(`FAIL: ${message}`);
	if(failures.length > 40)console.error(`... ${failures.length - 40} more failures`);
	console.error(`Build checks failed: ${failures.length} problem(s).`);
	process.exitCode = 1;
}else{
	console.log(`Build checks passed (${sourceOnly ? 'source' : 'dist'}).`);
}
