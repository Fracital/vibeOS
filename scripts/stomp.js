// Web proxy behind the browser and the proxied webviews. Stomp (https://github.com/Fracital/powerMouse,
// GPL-3.0, vendored in scripts/stomp/) rewrites pages inside a service worker and sends their
// traffic through the wisp relay from scripts/relay.js with the epoxy transport (AGPL-3.0,
// vendored in scripts/stomp/epoxy/). Proxied pages are shown in iframes, see webview.proxy().
//
// This is Stomp's same-origin mode: proxied pages share the origin of vibeOS. Stomp hides the
// desktop from them, but that is not a security boundary. A service worker also needs the site
// to be served over https or from localhost, so none of this works from a local file.

var stomp = {
		directory: new URL('scripts/stomp/', location.href).pathname,
		status: 'idle', // idle | loading | ready | failed
		message: '',
		controller: null,
		ready: null,

		load: ()=>{
			if(stomp.ready != null)return stomp.ready;

			stomp.status = 'loading';
			stomp.message = 'Starting the web proxy..';

			stomp.ready = (async ()=>{
				if(typeof StompController != 'function')throw new Error('scripts/stomp/Controller.js is missing');

				if(!window.isSecureContext || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)){
					throw new Error('vibeOS has to be served over https or from localhost');
				}

				var registration = await StompController.register(stomp.directory);

				stomp.controller = new StompController({
					serviceworker: registration,
					// epoxy runs in Stomp's transport worker and tunnels through the same relay as the emulator
					transport: {module: stomp.directory + 'epoxy/index.mjs', options: [{wisp: relay.url}]},
					directory: stomp.directory,
					codec: 'xor',
					// a page asked for a new tab: it gets a browser window of its own
					onOpen: (url)=>{
						initBrowser(url);
					},
				});

				await stomp.controller.wait();

				stomp.status = 'ready';
				stomp.message = '';

				return stomp.controller;
			})();

			stomp.ready.catch((err)=>{
				stomp.status = 'failed';
				stomp.message = 'The web proxy is unavailable: ' + err.message;
				stomp.ready = null; // the next window gets to try again

				console.error('stomp: failed to start', err);
			});

			return stomp.ready;
		},
	};
