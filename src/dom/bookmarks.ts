// The initial bookmarks match Fracital/powerMouse's STomp demo, pinned to
// 058c7e729c67f1a2f31b09ed3919652572aa315c (2026-11-21).
// The icons are locally vendored in public/stomp-bookmarks/icons/ with hashes.
// Existing vibeBrowser bookmarks are imported before seeding these defaults.

import { assetUrl } from './types';

export interface BrowserBookmark {
	url: string;
	title: string;
	icon: string;
	description?: string;
	color?: string;
}

const storageKey = 'vibeos.browser.bookmarks.v2';
const legacyKey = 'vibeos.browser.bookmarks.v1';
const upstreamKey = 'stomp-demo:bookmarks';
const icon = (name: string): string => assetUrl(`/stomp-bookmarks/icons/${name}`);
const fallbackIcon = assetUrl('/tango/apps/16/internet-web-browser.png');

export const defaultStompBookmarks: readonly BrowserBookmark[] = [
	{title: 'Fracital', url: 'https://fracit.al/', icon: icon('fracital.svg'), color: '#fb74fe'},
	{title: 'vibeOS', url: 'https://vibeos.fracit.al/', icon: icon('vibeos.png'), color: '#3465a4'},
	{title: 'estrogen', url: 'https://estro.help/', icon: icon('estrogen.png'), color: '#000', description: 'Estrogen transforms your JavaScript to be more fun for internet crawlers. Running @sysce/estrogen in WASM.'},
	{title: 'Krunk', url: 'https://krunk.io/', icon: icon('krunker.png'), color: '#ffd95c', description: 'Play Krunker Box Office: the Krunker FPS rebuilt as a native engine. Free fast-paced multiplayer in your browser or as a desktop client. No download required.'},
	{title: 'Flying Gorilla', url: 'https://pages.eli.gift/fg/', icon: icon('flyinggorilla.png'), color: '#1b7f3b', description: 'Flying Gorilla - swing, fling and glide as far as you can.'},
	{title: 'Reddit', url: 'https://www.reddit.com/', icon: icon('reddit.png'), color: '#d2612a'},
	{title: 'Google', url: 'https://www.google.com/', icon: icon('google.png'), color: '#ffffff'},
	{title: 'YouTube', url: 'https://www.youtube.com/', icon: icon('youtube.svg'), color: '#ff0000', description: 'Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube.'},
	{title: 'Discord', url: 'https://discord.com/login', icon: icon('discord.png'), color: '#2a4cd2', description: 'Discord is great for playing games and chilling with friends, or even building a worldwide community. Customize your own space to talk, play, and hang out.'},
	{title: 'Chrome Web Store', url: 'https://chromewebstore.google.com/', icon: icon('chromewebstore.png'), color: '#4989f4', description: 'Add new features to your browser and personalize your browsing experience.'},
	{title: 'N SVG', url: 'https://cojmar.github.io/nsvg/', icon: icon('nsvg.png'), color: '#4e9a06'},
];

const read = (key: string): unknown => {
	try {
		const value = localStorage.getItem(key);
		return value === null ? null : JSON.parse(value);
	} catch {
		return null;
	}
};

const safeUrl = (value: unknown): string | null => {
	if(typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f\\]/.test(value))return null;
	try {
		const url = new URL(value);
		if(!['http:', 'https:'].includes(url.protocol) || url.username || url.password)return null;
		return url.href;
	} catch { return null; }
};

const safeIcon = (value: unknown): string => {
	if(typeof value !== 'string' || value.length > 140_000)return fallbackIcon;
	if(/^\/pm\/icons\/[\w.-]+\.(?:png|svg)$/.test(value))return assetUrl(value.replace('/pm/icons/', '/stomp-bookmarks/icons/'));
	if(/^\/stomp-bookmarks\/icons\/[\w.-]+\.(?:png|svg)$/.test(value))return value;
	if(/^\/tango\/[\w/.-]+\.(?:png|cur)$/.test(value))return value;
	if(/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(value))return value;
	return safeUrl(value) ?? fallbackIcon;
};

const sanitize = (value: unknown): BrowserBookmark | null => {
	if(!value || typeof value !== 'object' || Array.isArray(value))return null;
	const item = value as Record<string, unknown>;
	const url = safeUrl(item.url);
	if(!url)return null;
	const title = typeof item.title === 'string' ? item.title.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120) : '';
	const description = typeof item.description === 'string' ? item.description.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 300) : '';
	const color = typeof item.color === 'string' && /^#[a-f\d]{3,8}$/i.test(item.color) ? item.color : undefined;
	return {url, title: title || new URL(url).hostname, icon: safeIcon(item.icon), ...(description ? {description} : {}), ...(color ? {color} : {})};
};

const normalize = (value: unknown): BrowserBookmark[] => {
	if(!Array.isArray(value))return [];
	const seen = new Set<string>();
	const results: BrowserBookmark[] = [];
	for(const raw of value.slice(0, 300)) {
		const entry = sanitize(raw);
		if(!entry || seen.has(entry.url))continue;
		seen.add(entry.url);
		results.push(entry);
	}
	return results;
};

export const loadBrowserBookmarks = (): BrowserBookmark[] => {
	const saved = read(storageKey);
	if(Array.isArray(saved))return normalize(saved);
	const upstream = read(upstreamKey);
	const legacy = read(legacyKey);
	// A STomp demo copy on this origin takes precedence, otherwise import the
	// older vibeBrowser format; never overwrite either existing list on boot.
	const existed = Array.isArray(upstream) ? upstream : Array.isArray(legacy) ? legacy : null;
	if(existed === null)return defaultStompBookmarks.map((item) => ({...item}));
	if(existed.length === 0)return [];
	const existing = normalize(existed);
	const seen = new Set(existing.map((item) => item.url));
	const filled = [...existing];
	for(const entry of defaultStompBookmarks) {
		if(!seen.has(entry.url))filled.push({...entry});
	}
	return filled;
};

export const saveBrowserBookmarks = (values: BrowserBookmark[]): void => {
	const cleaned = normalize(values);
	try { localStorage.setItem(storageKey, JSON.stringify(cleaned)); } catch { /* storage may be disabled */ }
	window.dispatchEvent(new Event('vibeos:bookmarks-changed'));
};
