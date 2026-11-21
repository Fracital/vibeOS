// The v86 emulator's files (https://github.com/copy/v86, BSD 2-Clause) for a desktop embedded in a
// host page (src/dom/embed.ts), which carries none of them. Each comes from a pinned upstream
// source the first time an emulator needs it, through the host's proxy (BrowserHost.fetch: the
// page never asks another site itself), and is used only when its SHA-256 is the one named here.
// It is kept in Cache Storage under its source's URL, so a later launch reads it locally, and is
// checked again each time it is read. The standalone site serves the same files from scripts/v86/
// (scripts/v86/UPSTREAM names them).
import type { HostFetchInit } from './types';

export type HostFetch = (url: string, init?: HostFetchInit) => Promise<Response>;
export interface PinnedFile {
	url: string;
	sha256: string;
	size: number;
}

// All from jsDelivr, which serves an npm version's files and a GitHub commit's files as they are
// published, one site for the host's proxy to ask. v86 0.5.473 as npm publishes it (the
// package's build/ files)
const release = 'https://cdn.jsdelivr.net/npm/v86@0.5.473/build/';
// the BIOS of the commit that release was built from (315b2b0), as the v86 repository holds it
const bios = 'https://cdn.jsdelivr.net/gh/copy/v86@315b2b0b758703ef0e6cc7b4088d6068f83f3c20/bios/';
// the disk images vibeOS carries, at a commit of its own (copy.sh's copies change under their names)
const images =
	'https://cdn.jsdelivr.net/gh/Fracital/vibeOS@f3ee384f53c51f88390985fc3efd97ebbd0ae644/scripts/v86/images/';

export const v86Core = {
	script: {
		url: `${release}libv86.js`,
		sha256: 'e257912c4a1129e36a86c1e2df69904ab969d87bffd24aa6676e84d6ddffc1c6',
		size: 359857,
	},
	wasm: {
		url: `${release}v86.wasm`,
		sha256: '2f0c4150f266415b754a84a32e6f8e4c975a1d3abb94c78b047fa30027db1ef1',
		size: 2007347,
	},
	bios: {
		url: `${bios}seabios.bin`,
		sha256: '73e3f359102e3a9982c35fce98eb7cd08f18303ac7f1ba6ebfbe6cdc1c244d98',
		size: 131072,
	},
	vgaBios: {
		url: `${bios}vgabios.bin`,
		sha256: 'a4bc0d80cc3ca028c73dafa8fee396b8d054ce87ebd8abfbd31b06b437607880',
		size: 36352,
	},
} satisfies Record<string, PinnedFile>;

const image = (name: string, sha256: string, size: number): [string, PinnedFile] => [
	name,
	{ url: images + name, sha256, size },
];
export const v86Images: Readonly<Record<string, PinnedFile>> = Object.fromEntries([
	image('bootchess.img', '04cd453801433b51e8684814977b30dfc0367315706ce792438601eaf1da88a1', 1474560),
	image('bootdino.img', '16181cacc35919c8c7a9e6f71320c06f2ea13a8a0a9319fb67f1a106e97c890a', 512),
	image('bootrogue.img', 'fa2fe4eb87c6cbc3e36b969eb2dc8ff1acdaebbbff75bd442e45b2d1a6499c3f', 512),
	image('doof-1440.img', '8eeb13c4401f3b68305ba4f0519a840da56a2866e063fe0f84d3a88225bb52f8', 1474560),
	image('floppybird.img', '5db1b469e25e9eda7b8c0f666d6b655bab083c85618a9453ee72f1201cca840f', 1474560),
	image('freedos722.img', '6c7b3c62823d538e20797fecae6dc55d2572455791a573a7de2cdba0b583f6be', 737280),
	image('invaders.img', '417d2efe987427af42dcc5b225293dcdb8229337dcc677d0a094c9f5f8f5f03d', 512),
	image('kolibri.img', '98eba957ea7a36e6784a171c5f1cb3f977dfecd615edbb0e28c4411cc1392481', 1474560),
	image('linux3.iso', '2094c93d095a5c356b17420a9372610ff74d50c46dbdde8265699d8f3940cc20', 8638464),
	image('linux.iso', 'b311d065b9acc17e5bf1dd4d12f06e70efaf2f0d8b2c7be3bbbb25076f494885', 5666816),
	image('msdos4.img', 'b5b2664c21ba7f2b4557564376c0cc47a7ae0c9c6bf0703de4660529f4f1e0b2', 1474560),
	image('pillman.img', '3f944db287ecd8beca93c65cd4986ba0a3c155025c9e15cc05372038c3a8e98c', 512),
	image('tetros.img', 'fb9c23e1ffbe25ee35e2dd5a4f60c7e79710d0319ffa83da89fe0dd8a79f293c', 512),
	image('windows101.img', 'bcf92b918e6c6fecb7a8cc8faa418746cc675fc349b16ba45f4ff1cc5f993f0d', 1474560),
]);

// named for what it holds, not for the host: the host's own caches are its business
const cacheName = 'vibeos-v86-0.5.473';
const loading = new Map<string, Promise<ArrayBuffer>>();

const sha256 = async (bytes: ArrayBuffer): Promise<string> =>
	Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');

const fileName = (file: PinnedFile): string => file.url.slice(file.url.lastIndexOf('/') + 1);

// (a page whose origin keeps no caches still runs the emulator, fetching each time)
async function openCache(): Promise<Cache | null> {
	try {
		return await caches.open(cacheName);
	} catch {
		return null;
	}
}

async function fetchPinned(file: PinnedFile, network: HostFetch): Promise<ArrayBuffer> {
	const cache = await openCache();
	const kept = await cache?.match(file.url).catch(() => undefined);
	if (kept) {
		const bytes = await kept.arrayBuffer();
		if (bytes.byteLength === file.size && (await sha256(bytes)) === file.sha256) return bytes;
		await cache?.delete(file.url).catch(() => false);
	}
	const response = await network(file.url, { headers: { 'Accept-Encoding': 'identity' } });
	if (!response.ok) throw new Error(`${fileName(file)}: its source answered ${response.status}`);
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength !== file.size || (await sha256(bytes)) !== file.sha256)
		throw new Error(`${fileName(file)} is not the pinned file (its SHA-256 differs)`);
	await cache
		?.put(file.url, new Response(bytes.slice(0), { headers: { 'content-type': 'application/octet-stream' } }))
		.catch(() => {});
	return bytes;
}

// the file's bytes, a copy of its own for each caller (a disk image is written to as the guest runs)
export async function pinnedFile(file: PinnedFile, network: HostFetch): Promise<ArrayBuffer> {
	let pending = loading.get(file.url);
	if (!pending) {
		pending = fetchPinned(file, network).finally(() => loading.delete(file.url));
		loading.set(file.url, pending);
	}
	return (await pending).slice(0);
}
