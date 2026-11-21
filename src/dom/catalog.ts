// Site metadata and vibeOS-installed web applications. A browser-origin PWA install
// cannot be initiated silently from inside an iframe, so the PWA entries here are
// installed into the vibeOS application launcher, not the host operating system.

import { assetUrl } from './types';

// a host that embeds the desktop shows sites through its proxy only: a request of the host's
// own page to another site would bypass it, so metadata then comes from the documents alone
let directFetch = true;
export const setDirectFetch = (enabled: boolean): void => { directFetch = enabled; };
const mayFetch = (url: string): boolean => {
	try { return directFetch || new URL(url, location.href).origin === location.origin; } catch { return false; }
};

export interface SiteInfo {
	url: string;
	title: string;
	description: string;
	icon: string;
	manifestUrl?: string;
	startUrl?: string;
}

export interface InstalledSite extends SiteInfo {
	id: string;
	kind: 'stomp' | 'pwa';
	installedAt: number;
}

const siteCacheKey = 'vibeos.sites.v1';
const installsKey = 'vibeos.installed-apps.v1';
const tangoFallback = assetUrl('/tango/mimetypes/16/html.png');
const cacheAge = 7 * 24 * 3600 * 1000;
const maxApps = 80;
const memoryStorage = new Map<string, string>();

const readJson = (key: string): unknown => {
	try {
		const text = localStorage.getItem(key) ?? memoryStorage.get(key);
		return text == null ? null : JSON.parse(text);
	}catch {
		try { return JSON.parse(memoryStorage.get(key) || 'null'); } catch { return null; }
	}
};

const store = (key: string, value: unknown): void => {
	const text = JSON.stringify(value);
	memoryStorage.set(key, text);
	try { localStorage.setItem(key, text); } catch { /* private browsing */ }
};

const trim = (value: unknown, limit: number): string => typeof value === 'string' ?
	value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';

export const normalizedSiteUrl = (value: string): string => {
	if(typeof value !== 'string')throw new Error('Enter a valid web URL');
	const raw = value.trim();
	if(!raw || raw.length > 2048 || /[\x00-\x1f\x7f\\]/.test(raw) || /^[/?#]/.test(raw)){
		throw new Error('Enter a valid web URL');
	}
	let url: URL;
	try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : 'https://' + raw); }
	catch { throw new Error('Enter a valid web URL'); }
	if(!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password){
		throw new Error('Only HTTP and HTTPS websites can be installed');
	}
	url.hash = '';
	if(url.href.length > 2048)throw new Error('Website URL is too long');
	return url.href;
};

const safeResource = (value: unknown, base: string, sameOrigin = false): string | undefined => {
	if(typeof value !== 'string' || !value.trim() || value.length > 2048 ||
		/[\x00-\x1f\x7f\\]/.test(value))return undefined;
	try {
		const url = new URL(value, base);
		const original = new URL(base);
		if(!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)return;
		if(original.protocol === 'https:' && url.protocol !== 'https:')return;
		if(sameOrigin && original.origin !== url.origin)return;
		url.hash = '';
		if(url.href.length > 2048)return;
		return url.href;
	} catch { return undefined; }
};

const textContent = (doc: Document, ...selectors: string[]): string => {
	for(const selector of selectors) {
		const element = doc.querySelector(selector);
		if(!element)continue;
		const value = trim(element.getAttribute('content') ?? element.textContent, 300);
		if(value)return value;
	}
	return '';
};

const linkValue = (doc: Document, rel: string, base: string): string | undefined => {
	const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel][href]')];
	const matches = links.filter((node) => {
		const tokens = node.rel.toLowerCase().split(/\s+/);
		return tokens.includes(rel) || (rel === 'apple-touch-icon' &&
			tokens.some(token => token.startsWith('apple-touch-icon-')));
	});
	const preferred = rel === 'icon' ? matches.sort((a, b) => {
		const size = (link: HTMLLinkElement) => Number(/\d+/.exec(link.sizes?.value || '')?.[0] ?? 0);
		return size(b) - size(a);
	}) : matches;
	for(const node of preferred) {
		const href = safeResource(node.getAttribute('href'), base, rel === 'manifest');
		if(href)return href;
	}
	return undefined;
};

const pageInfo = (url: string, doc: Document): SiteInfo => {
	const parsed = new URL(url);
	const originName = parsed.hostname.replace(/^www\./, '');
	const title = textContent(doc, 'meta[property="og:title"]', 'meta[name="twitter:title"]', 'title') || originName;
	const description = textContent(doc, 'meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]');
	const icon = linkValue(doc, 'apple-touch-icon', url) || linkValue(doc, 'icon', url) ||
		safeResource(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), url) ||
		tangoFallback;
	const manifestUrl = linkValue(doc, 'manifest', url);
	return {url, title: trim(title, 120), description: trim(description, 280), icon, ...(manifestUrl ? {manifestUrl} : {})};
};

const isSiteInfo = (input: unknown): input is SiteInfo => {
	if(input === null || typeof input !== 'object' || Array.isArray(input))return false;
	const item = input as Record<string, unknown>;
	return typeof item.url === 'string' && typeof item.title === 'string' && typeof item.description === 'string' && typeof item.icon === 'string';
};

const cleanSiteInfo = (input: SiteInfo): SiteInfo | null => {
	try {
		const url = normalizedSiteUrl(input.url);
		const host = new URL(url).hostname;
		const manifestUrl = safeResource(input.manifestUrl, url, true);
		const startUrl = safeResource(input.startUrl, url, true);
		return {
			url,
			title: trim(input.title, 120) || host,
			description: trim(input.description, 280),
			icon: input.icon === tangoFallback ? tangoFallback : safeResource(input.icon, url) ?? tangoFallback,
			...(manifestUrl ? {manifestUrl} : {}),
			...(startUrl ? {startUrl} : {}),
		};
	} catch { return null; }
};

type CachedEntry = {site: SiteInfo; updatedAt: number};

const readCache = (): Record<string, CachedEntry> => {
	const data = readJson(siteCacheKey);
	if(!data || typeof data !== 'object' || Array.isArray(data))return {};
	const entries: Record<string, CachedEntry> = Object.create(null);
	for(const value of Object.values(data).slice(0, 160)) {
		if(!value || typeof value !== 'object')continue;
		const entry = value as Record<string, unknown>;
		if(!isSiteInfo(entry.site) || typeof entry.updatedAt !== 'number' ||
			!Number.isFinite(entry.updatedAt) || entry.updatedAt < 0 ||
			entry.updatedAt > Date.now() + 86_400_000)continue;
		const site = cleanSiteInfo(entry.site);
		if(site)entries[site.url] = {site, updatedAt: entry.updatedAt};
	}
	return entries;
};

export const cachedSiteInfo = (value: string): SiteInfo | null => {
	try {
		const url = normalizedSiteUrl(value);
		return readCache()[url]?.site ?? null;
	} catch { return null; }
};

const saveSite = (site: SiteInfo) => {
	const cache = readCache();
	const previous = cache[site.url];
	cache[site.url] = {site, updatedAt: Date.now()};
	const newest = Object.entries(cache).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 100);
	store(siteCacheKey, Object.fromEntries(newest));
	if(!previous || JSON.stringify(previous.site) !== JSON.stringify(site)){
		dispatchAppsChanged();
	}
};

const dispatchAppsChanged = (): void => {
	if(typeof window !== 'undefined' && typeof Event !== 'undefined'){
		window.dispatchEvent(new Event('vibeos:apps-changed'));
	}
};

const inspectManifest = async (site: SiteInfo): Promise<SiteInfo> => {
	if(!site.manifestUrl)return site;
	try {
		const signal = AbortSignal.timeout(4000);
		if(!mayFetch(site.manifestUrl))return site;
		const response = await fetch(site.manifestUrl, {signal, credentials: 'omit', redirect: 'follow'});
		if(!response.ok || Number(response.headers.get('content-length') || 0) > 256_000)return site;
		const source = await response.text();
		if(source.length > 256_000)return site;
		const json: unknown = JSON.parse(source);
		if(!json || typeof json !== 'object' || Array.isArray(json))return site;
		const manifest = json as Record<string, unknown>;
		const resolvedStart = safeResource(manifest.start_url, site.manifestUrl);
		const startUrl = resolvedStart && new URL(resolvedStart).origin === new URL(site.url).origin ?
			resolvedStart : undefined;
		const title = trim(manifest.name, 120) || trim(manifest.short_name, 120) || site.title;
		const description = trim(manifest.description, 280) || site.description;
		let icon = site.icon;
		if(icon === tangoFallback && Array.isArray(manifest.icons)){
			const icons = manifest.icons.filter((item): item is Record<string, unknown> =>
				item !== null && typeof item === 'object' && !Array.isArray(item));
			const ranked = icons.map(item => {
				const value = safeResource(item.src, site.manifestUrl!);
				const size = typeof item.sizes === 'string' ? item.sizes : '';
				const widest = [...size.matchAll(/(\d+)x(\d+)/g)]
					.reduce((max, match) => Math.max(max, Math.min(Number(match[1]), Number(match[2]))), 0);
				return {value, rank: -Math.abs(widest - 192)};
			}).filter(item => !!item.value).sort((a, b) => b.rank - a.rank);
			icon = ranked[0]?.value ?? icon;
		}
		return {...site, title, description, icon, ...(startUrl ? {startUrl} : {})};
	} catch { return site; }
};

export async function inspectSite(value: string, doc?: Document | null): Promise<SiteInfo> {
	const url = normalizedSiteUrl(value);
	const previous = readCache()[url];
	if(!doc && previous && Date.now() - previous.updatedAt < cacheAge)return previous.site;
	let page: Document | null = doc ?? null;
	if(!page && mayFetch(url)) {
		try {
			const response = await fetch(url, {credentials: 'omit', signal: AbortSignal.timeout(4500), redirect: 'follow'});
			const type = response.headers.get('content-type') || '';
			if(response.ok && (!type || /html|xml/i.test(type)) &&
				Number(response.headers.get('content-length') || 0) < 500_000) {
				const html = await response.text();
				if(html.length < 500_000)page = new DOMParser().parseFromString(html, 'text/html');
			}
		} catch { /* Most remote sites do not expose CORS metadata; the STomp frame can. */ }
	}
	let site = page ? pageInfo(url, page) : previous?.site ?? {
		url, title: new URL(url).hostname.replace(/^www\./, ''), description: '', icon: tangoFallback,
	};
	site = await inspectManifest(site);
	const cleaned = cleanSiteInfo(site);
	if(!cleaned)throw new Error('Site metadata is not a valid HTTP or HTTPS page');
	saveSite(cleaned);
	return cleaned;
}

const isInstalled = (input: unknown): input is InstalledSite => {
	if(!isSiteInfo(input))return false;
	const item = input as unknown as Record<string, unknown>;
	return typeof item.id === 'string' && item.id.length >= 8 && item.id.length <= 250 &&
		typeof item.installedAt === 'number' && Number.isFinite(item.installedAt) &&
		item.installedAt >= 0 && item.installedAt <= Date.now() + 86_400_000 &&
		(item.kind === 'stomp' || item.kind === 'pwa');
};

export const installedSites = (): InstalledSite[] => {
	const values = readJson(installsKey);
	if(!Array.isArray(values))return [];
	const seen = new Set<string>();
	const usedIds = new Set<string>();
	return values.filter(isInstalled).slice(0, maxApps * 3).flatMap((value) => {
		const site = cleanSiteInfo(value);
		if(!site)return [];
		const key = value.kind + ':' + site.url;
		if(seen.has(key) || usedIds.has(value.id))return [];
		seen.add(key);
		usedIds.add(value.id);
		return [{...site, id: value.id, kind: value.kind, installedAt: value.installedAt}];
	}).slice(0, maxApps);
};

export async function installSite(value: string, kind: 'stomp' | 'pwa', doc?: Document | null): Promise<InstalledSite> {
	if(kind !== 'stomp' && kind !== 'pwa')throw new Error('Unknown web application type');
	const url = normalizedSiteUrl(value);
	const site = await inspectSite(value, doc);
	const previous = installedSites();
	const current = previous.find(entry => entry.kind === kind && entry.url === url);
	if(!current && previous.length >= maxApps)throw new Error('Installed app limit reached');
	const id = current?.id ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ?
		crypto.randomUUID() : 'app-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
	const app: InstalledSite = {...site, id, kind, installedAt: current?.installedAt ?? Date.now()};
	store(installsKey, [...previous.filter((entry) => entry.id !== id), app].slice(-maxApps));
	dispatchAppsChanged();
	return app;
}

export const uninstallSite = (id: string): void => {
	const current = installedSites();
	const next = current.filter(entry => entry.id !== id);
	if(next.length === current.length)return;
	store(installsKey, next);
	dispatchAppsChanged();
};
