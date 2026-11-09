// Relay for assets on hosts that do not send CORS headers (the copy.sh disk images).
//
// Requests to the hosts listed below are tunnelled through a wisp relay using libcurl.js
// (https://github.com/ading2210/libcurl.js, LGPL v3, vendored in scripts/net/). Everything else
// keeps using the browser's own XMLHttpRequest untouched. The emulator (libv86.js) loads disk
// images with XMLHttpRequest, which is why the hook lives at that level.

var relay = {
		url: 'wss://holywisp.fracit.al/', // public wisp relay, shared with fracit.al
		wasm: 'scripts/net/libcurl.wasm',
		hosts: ['copy.sh', 'i.copy.sh', 'c.copy.sh'],
		status: 'idle', // idle | loading | ready | failed
		ready: null,

		matches: (url)=>{
			try{
				return relay.hosts.includes(new URL(url, location.href).hostname);
			}catch(err){
				return false;
			}
		},

		load: ()=>{
			if(relay.ready != null)return relay.ready;

			relay.status = 'loading';

			relay.ready = (async ()=>{
				if(typeof libcurl == 'undefined')throw new Error('libcurl.js is not loaded');

				await libcurl.load_wasm(relay.wasm);
				libcurl.set_websocket(relay.url);

				relay.status = 'ready';
			})();

			relay.ready.catch((err)=>{
				relay.status = 'failed';
				console.error('relay: failed to start', err);
			});

			return relay.ready;
		},

		fetch: async (url, options)=>{
			await relay.load();
			return libcurl.fetch(url, options);
		},
	};

(()=>{
	var NativeXHR = window.XMLHttpRequest,
		proto = NativeXHR.prototype,
		define = (obj, props)=>{
			Object.entries(props).forEach((e,i)=>{
				Object.defineProperty(obj, e[0], {value: e[1], configurable: true, writable: true});
			});
		},
		fire = (xhr, name, progress)=>{
			// dispatch through the real XHR object so event.target is set and on* handlers run as usual
			var event = progress ? new ProgressEvent(name, progress) : new Event(name);
			xhr.dispatchEvent(event);
		};

	window.XMLHttpRequest = function(){
		var xhr = new NativeXHR(),
			req = null; // set once open() decides this request goes through the relay

		xhr.open = function(method, url){
			if(!relay.matches(url))return proto.open.apply(xhr, arguments);

			req = {method: (method || 'GET').toUpperCase(), url: new URL(url, location.href).href, headers: {}, controller: new AbortController(), response: null};

			define(xhr, {readyState: 1, status: 0, response: null, responseURL: req.url});
			fire(xhr, 'readystatechange');
		};

		xhr.setRequestHeader = function(name, value){
			if(req == null)return proto.setRequestHeader.apply(xhr, arguments);
			if(name.toLowerCase() == 'x-accept-encoding')return; // browser-only hint, meaningless to curl
			req.headers[name] = value;
		};

		xhr.getResponseHeader = function(name){
			if(req == null)return proto.getResponseHeader.apply(xhr, arguments);
			return req.response ? req.response.headers.get(name) : null;
		};

		xhr.getAllResponseHeaders = function(){
			if(req == null)return proto.getAllResponseHeaders.apply(xhr, arguments);
			if(req.response == null)return '';
			return Array.from(req.response.headers.entries()).map(e=> e[0] + ': ' + e[1]).join('\r\n');
		};

		xhr.abort = function(){
			if(req == null)return proto.abort.apply(xhr, arguments);
			req.controller.abort();
		};

		xhr.send = async function(body){
			if(req == null)return proto.send.apply(xhr, arguments);

			try{
				// ranges must address the raw bytes, so never let the server compress
				var headers = Object.assign({'Accept-Encoding': 'identity'}, req.headers),
					response = await relay.fetch(req.url, {method: req.method, headers: headers, body: body == null ? undefined : body, signal: req.controller.signal});

				req.response = response;

				define(xhr, {readyState: 2, status: response.status, statusText: response.statusText});
				fire(xhr, 'readystatechange');

				// stream the body so big downloads (saved states) report progress

				var total = Number(response.headers.get('Content-Length')) || 0,
					reader = response.body.getReader(),
					chunks = [],
					loaded = 0;

				while(true){
					var chunk = await reader.read();
					if(chunk.done)break;

					chunks.push(chunk.value);
					loaded += chunk.value.byteLength;

					fire(xhr, 'progress', {lengthComputable: total > 0, loaded: loaded, total: total});
				}

				var bytes = new Uint8Array(loaded),
					offset = 0;

				chunks.forEach((c,i)=>{
					bytes.set(c, offset);
					offset += c.byteLength;
				});

				var result = bytes.buffer;

				if(xhr.responseType == 'json')result = JSON.parse(new TextDecoder().decode(bytes))
				else if(xhr.responseType == 'text' || xhr.responseType == '')result = new TextDecoder().decode(bytes);

				define(xhr, {readyState: 4, response: result, responseText: typeof result == 'string' ? result : undefined});

				fire(xhr, 'readystatechange');
				fire(xhr, 'load');
				fire(xhr, 'loadend');
			}catch(err){
				if(req.controller.signal.aborted)return;

				console.error('relay: request failed', req.url, err);

				define(xhr, {readyState: 4, status: 0});

				fire(xhr, 'readystatechange');
				fire(xhr, 'error');
				fire(xhr, 'loadend');
			}
		};

		return xhr;
	};

	window.XMLHttpRequest.prototype = proto;
})();
