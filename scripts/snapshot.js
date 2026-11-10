// Pictures of live pages. pageSnapshot() draws the document inside a same-origin iframe (a web
// game, a page behind the web proxy) into a canvas, so a webview can keep showing its page on
// the desktop while the iframe itself is hidden. An iframe sits above the canvas and takes the
// mouse, so only the focused window may show a real one (see webview.place()).
//
// The drawing is done by the browser's own renderer: a copy of the page's DOM goes into an SVG
// image as a <foreignObject>, with the page's style rules written into it, and that image is
// painted like any other. An SVG image may not load anything, so pictures, canvases and video
// frames are put in as data URLs, and so are the fonts, icons and backgrounds the style rules
// use (snapshotGather() fetches those ahead of time). What it cannot reproduce: what is inside
// nested frames and shadow trees, and how far inner scrolling boxes are scrolled.

var snapshotBlank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
	snapshotScratch = document.createElement('canvas'),
	snapshotPictures = new Map(),
	snapshotStyles = new WeakMap(),
	// what style rules point at, fetched by snapshotGather(): address to data URL, null when it could not be had
	snapshotResources = new Map(),
	snapshotSpent = new WeakMap(),
	snapshotVersion = 0,
	// stylesheet files as written: address to text, null when it could not be fetched
	snapshotSources = new Map(),
	snapshotSourced = 0,
	// a picture is a still: every animation is shown as it ends up, not at its first frame
	snapshotStill = '*,*::before,*::after{animation-delay:-999999s!important;animation-iteration-count:1!important;transition:none!important}',
	snapshotEmpty = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E',

	// the page is always touched through this window's own DOM prototypes: the web proxy wraps the
	// methods a proxied page sees, and those wrappers rewrite what goes through them

	snapshotDom = {
		query: (root, selector)=> Array.from(Element.prototype.querySelectorAll.call(root, selector)),
		get: (el, name)=> Element.prototype.getAttribute.call(el, name),
		set: (el, name, value)=> Element.prototype.setAttribute.call(el, name, value),
		drop: (el, name)=> Element.prototype.removeAttribute.call(el, name),
		box: (el)=> Element.prototype.getBoundingClientRect.call(el),
		style: (el, extra)=>{
			Element.prototype.setAttribute.call(el, 'style', (Element.prototype.getAttribute.call(el, 'style') || '') + ';' + extra);
		},
	},
	snapshotAbsolute = (text, base, urls)=>{
		// addresses in style text are relative to the sheet they were written in. they are made
		// absolute, and collected so snapshotGather() knows what the rules point at
		if(!text.includes('url('))return text;

		return text.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g, (all, a, b, c)=>{
			var url = a || b || c || '';

			if(url === '' || /^(data:|blob:|about:|#)/i.test(url))return all;

			try{
				url = new URL(url, base).href;
			}catch(err){
				return all;
			}

			urls.add(url);

			return 'url("' + url + '")';
		});
	},
	snapshotImports = (text, base, wanted, urls, depth)=>{
		// @import only counts at the very top of a sheet, so imported sheets are written out in its place
		if(!text.includes('@import'))return text;

		return text.replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/gi, (all, url, media)=>{
			var inner = null;

			try{
				url = new URL(url, base).href;
			}catch(err){
				return '';
			}

			inner = snapshotWritten(url, wanted, urls, depth + 1);

			if(inner == null)return '';

			return media.trim() !== '' ? '@media ' + media.trim() + '{' + inner + '}' : inner;
		});
	},
	snapshotWritten = (url, wanted, urls, depth)=>{
		// a stylesheet file as its author wrote it, ready to go into a picture. null while its text
		// has not been fetched, which is then asked for
		var text = snapshotSources.get(url);

		if(text === undefined)wanted.add(url);

		if(text == null || depth > 3)return null;

		return snapshotAbsolute(snapshotImports(text, url, wanted, urls, depth), url, urls);
	},
	snapshotSheet = (doc)=>{
		// every style rule that applies to the page as one text, with what it points at listed.
		// it is kept until the page adds or drops rules, or more stylesheet text has been fetched
		var sheets = Array.from(doc.styleSheets).concat(Array.from(doc.adoptedStyleSheets || [])),
			counts = sheets.map((sheet)=>{
				try{
					return sheet.cssRules.length;
				}catch(err){
					return -1;
				}
			}).join(','),
			known = snapshotStyles.get(doc),
			parts = [],
			urls = new Set(),
			wanted = new Set(),
			walk = (sheet, out)=>{
				var rules = null,
					base = sheet.href || doc.baseURI;

				try{
					rules = sheet.cssRules;
				}catch(err){
					return; // a sheet from another site keeps its rules to itself
				}

				Array.from(rules).forEach((rule,i)=>{
					if(rule.type === 3){
						if(rule.styleSheet != null)walk(rule.styleSheet, out);
						return;
					}

					out.push(snapshotAbsolute(rule.cssText, base, urls));
				});
			};

		if(known != null && known.counts === counts && known.sourced === snapshotSourced)return known;

		sheets.forEach((sheet,i)=>{
			var out = [],
				media = sheet.media != null ? sheet.media.mediaText : '',
				node = sheet.ownerNode,
				written = null;

			if(sheet.disabled)return;

			// the text as it was written is used wherever there is one. asking the rules for their text
			// is the fallback (rules added by script have no other): the browser gives shorthands that
			// use var() back as empty longhands, which loses borders and backgrounds

			if(sheet.href)written = snapshotWritten(sheet.href, wanted, urls, 0)
			else if(node != null && node.textContent.trim() !== '')written = snapshotAbsolute(snapshotImports(node.textContent, doc.baseURI, wanted, urls, 0), doc.baseURI, urls);

			if(written == null){
				walk(sheet, out);
				written = out.join('\n');
			}

			parts.push(media !== '' && media !== 'all' ? '@media ' + media + '{' + written + '}' : written);
		});

		known = {
			counts: counts,
			sourced: snapshotSourced,
			// the copied <html> is not the root of the picture's document, so :root has to become html
			text: parts.join('\n').replace(/([\w\])*-]):root\b/g, '$1').replace(/:root\b/g, 'html'),
			urls: Array.from(urls),
			wanted: Array.from(wanted),
			version: -1,
			css: '',
		};

		snapshotStyles.set(doc, known);

		return known;
	},
	snapshotCSS = (doc)=>{
		// the rules with everything snapshotGather() has fetched so far written into them
		var sheet = snapshotSheet(doc);

		if(sheet.version === snapshotVersion)return sheet.css;

		// a mask whose image is missing leaves a solid block, so until it arrives it masks everything away

		sheet.css = sheet.text.replace(/((?:-webkit-)?mask(?:-image)?\s*:\s*)url\("([^"]*)"\)/g, (all, lead, url)=>{
			return lead + 'url("' + (snapshotResources.get(url) || (url.startsWith('data:') ? url : snapshotEmpty)) + '")';
		}).replace(/url\("([^"]*)"\)/g, (all, url)=>{
			var data = snapshotResources.get(url);

			return data != null ? 'url("' + data + '")' : all;
		});

		sheet.version = snapshotVersion;

		return sheet.css;
	},
	snapshotDataURL = (blob)=>{
		return new Promise((resolve, reject)=>{
			var reader = new FileReader();

			reader.onload = ()=> resolve(reader.result);
			reader.onerror = ()=> reject(reader.error);

			reader.readAsDataURL(blob);
		});
	},
	snapshotGather = async (doc)=>{
		// fetches what the picture cannot load by itself: the text of the page's stylesheets, and what
		// their rules point at (fonts, icons, background images). only what the page has loaded on its
		// own, through the page's own fetch (for a proxied page that is the proxy), and within a
		// budget. resolves true when something new has arrived, which the next picture will carry
		var view = doc.defaultView,
			sheet = snapshotSheet(doc),
			clean = (url)=>{
				try{
					return new URL(url).href.replace(/#.*$/, '');
				}catch(err){
					return url;
				}
			},
			loaded = null,
			pending = [],
			round = 0,
			spent = snapshotSpent.get(doc) || 0,
			news = false;

		if(snapshotResources.size > 400)snapshotResources.clear();
		if(snapshotSources.size > 100)snapshotSources.clear();

		// a stylesheet can import others, which only shows once its own text is in: a few rounds

		for(round = 0; round < 4; round++){
			pending = sheet.wanted.filter((url)=> !snapshotSources.has(url)).slice(0, 20);

			if(pending.length === 0)break;

			await Promise.all(pending.map(async (url)=>{
				snapshotSources.set(url, null); // one try each

				try{
					var response = await view.fetch(url),
						text = '';

					if(!response.ok)return;

					text = await response.text();

					if(text.length > 2000000)return;

					snapshotSources.set(url, text);
					snapshotSourced++;

					news = true;
				}catch(err){
					// not readable from here: its rules are taken from the browser instead
				}
			}));

			// with more stylesheet text in, the list of what the rules point at grows

			sheet = snapshotSheet(doc);
		}

		loaded = new Set(view.performance.getEntriesByType('resource').map((entry)=> clean(entry.name)));

		await Promise.all(sheet.urls.filter((url)=> !snapshotResources.has(url) && loaded.has(clean(url))).slice(0, 40).map(async (url)=>{
			snapshotResources.set(url, null); // one try each

			try{
				var response = await view.fetch(url),
					blob = null;

				if(!response.ok)return;

				blob = await response.blob();

				if(blob.size > 400000 || spent + blob.size > 3000000)return;

				spent += blob.size;

				snapshotResources.set(url, await snapshotDataURL(blob));

				news = true;
			}catch(err){
				// gone, blocked, or not readable from here: the picture does without it
			}
		}));

		snapshotSpent.set(doc, spent);

		if(news)snapshotVersion++;

		return news;
	},
	snapshotPixels = (el, tag, shown)=>{
		// what an image, a canvas or a video shows right now, as a data URL
		var wide = tag === 'img' ? el.naturalWidth : tag === 'video' ? el.videoWidth : el.width,
			tall = tag === 'img' ? el.naturalHeight : tag === 'video' ? el.videoHeight : el.height,
			scale = 1,
			key = null,
			data = null;

		if(!wide || !tall || (tag === 'img' && !el.complete))return null;

		// no bigger than it is shown, big originals are slow to encode

		scale = Math.min(1, Math.min(1600, Math.max(64, shown * 1.5)) / Math.max(wide, tall));

		wide = Math.max(1, Math.round(wide * scale));
		tall = Math.max(1, Math.round(tall * scale));

		// an image is encoded once, a canvas or a video changes all the time

		if(tag === 'img')key = el.currentSrc + '|' + wide + 'x' + tall;

		if(key != null && snapshotPictures.has(key))return snapshotPictures.get(key);

		try{
			snapshotScratch.width = wide;
			snapshotScratch.height = tall;
			snapshotScratch.getContext('2d').drawImage(el, 0, 0, wide, tall);

			data = snapshotScratch.toDataURL('image/webp', 0.85);
		}catch(err){
			return null; // pixels that came from another site cannot be read back
		}

		if(key != null){
			if(snapshotPictures.size > 300)snapshotPictures.clear();

			snapshotPictures.set(key, data);
		}

		return data;
	},
	snapshotSticky = (doc, live, copy, wide, tall)=>{
		// nothing scrolls inside the picture, so an element held at the top by position: sticky would
		// show where it started out. the ones in view are found by looking under a few points, and
		// their copies are pushed down to where the originals really are
		var view = doc.defaultView,
			seen = new Set(),
			stuck = [];

		[0.1, 0.5, 0.9].forEach((across,i)=>{
			[4, 40, tall / 2].forEach((down,ii)=>{
				doc.elementsFromPoint(wide * across, down).slice(0, 12).forEach((el,iii)=>{
					while(el != null && el !== live && !seen.has(el)){
						seen.add(el);

						if(view.getComputedStyle(el).position === 'sticky')stuck.push(el);

						el = el.parentElement;
					}
				});
			});
		});

		stuck.forEach((el,i)=>{
			var box = snapshotDom.box(el),
				before = el.previousElementSibling,
				start = before != null ? snapshotDom.box(before).bottom : snapshotDom.box(el.parentElement).top,
				shift = Math.round(box.top - start),
				path = [],
				node = el,
				twin = copy;

			// only when it is actually being held at its sticking point, away from where it would lie

			if(shift < 2 || Math.abs(box.top - (parseFloat(view.getComputedStyle(el).top) || 0)) > 2)return;

			// its copy is at the same place in the tree

			while(node !== live){
				path.unshift(Array.prototype.indexOf.call(node.parentNode.children, node));
				node = node.parentNode;
			}

			path.forEach((n,ii)=>{
				twin = twin != null ? twin.children[n] : null;
			});

			if(twin != null)snapshotDom.style(twin, 'position:relative!important;top:' + shift + 'px!important');
		});
	},
	pageSnapshot = async (doc, canvas)=>{
		var dom = snapshotDom,
			view = doc.defaultView,
			live = doc.documentElement,
			wide = live.clientWidth,
			tall = live.clientHeight,
			left = Math.round(view.pageXOffset),
			top = Math.round(view.pageYOffset),
			started = Date.now(),
			kinds = 'img, canvas, video, input, textarea, select',
			originals = [],
			copies = [],
			copy = null,
			ground = '',
			markup = '',
			svg = '',
			address = '',
			image = new Image();

		if(wide < 1 || tall < 1 || doc.body == null)throw new Error('the page has nothing to show yet');

		copy = Node.prototype.cloneNode.call(live, true);

		originals = dom.query(live, kinds);
		copies = dom.query(copy, kinds);

		if(top > 0)snapshotSticky(doc, live, copy, wide, tall);

		// what the markup does not say: typed text, ticked boxes, and every kind of pixels

		originals.forEach((el,i)=>{
			var twin = copies[i],
				tag = el.tagName.toLowerCase(),
				box = dom.box(el),
				near = box.width > 0 && box.height > 0 && box.bottom > -tall / 2 && box.top < tall * 1.5 && box.right > -wide / 2 && box.left < wide * 1.5,
				data = null;

			if(twin == null)return;

			if(tag === 'input'){
				if(el.type === 'checkbox' || el.type === 'radio'){
					if(el.checked)dom.set(twin, 'checked', '')
					else dom.drop(twin, 'checked');
				}else if(el.type !== 'file'){
					dom.set(twin, 'value', el.value);
				}

				return;
			}

			if(tag === 'textarea'){
				Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').set.call(twin, el.value);
				return;
			}

			if(tag === 'select'){
				Array.from(el.options).forEach((option,n)=>{
					if(twin.options[n] == null)return;

					if(option.selected)dom.set(twin.options[n], 'selected', '')
					else dom.drop(twin.options[n], 'selected');
				});

				return;
			}

			// only what is in or near the view is worth encoding, the rest just keeps its place

			if(near)data = snapshotPixels(el, tag, Math.max(box.width, box.height));

			if(tag === 'img'){
				dom.set(twin, 'src', data || snapshotBlank);
				dom.drop(twin, 'srcset');
				dom.drop(twin, 'sizes');
				dom.drop(twin, 'loading');
			}else if(data != null){
				dom.style(twin, 'background:url(' + data + ') center/100% 100% no-repeat!important');
			}

			// the size it has on the page, whatever the stand-in pixels would have made of it

			if(box.width > 0 && box.height > 0)dom.style(twin, 'width:' + box.width + 'px!important;height:' + box.height + 'px!important');
		});

		// nothing in here can run or load, and all the style rules go in as one sheet below

		dom.query(copy, 'script, noscript, link, style, base, source, track, template, meta').forEach((el,i)=>{
			Node.prototype.removeChild.call(el.parentNode, el);
		});

		// XML is stricter about attribute names than HTML is, and a single bad one spoils the picture

		dom.query(copy, '*').concat([copy]).forEach((el,i)=>{
			Element.prototype.getAttributeNames.call(el).forEach((name,ii)=>{
				var node = Element.prototype.getAttributeNode.call(el, name);

				if(node == null || node.namespaceURI != null)return; // xlink:href and the like on inline SVG are fine

				if(!/^[A-Za-z_][\w.\-]*$/.test(name) || /^on/i.test(name) || /^xmlns$/i.test(name))dom.drop(el, name);
			});
		});

		// the scroll position becomes a negative margin. unlike a transform that leaves
		// position: fixed elements where they belong, against the edges of the picture

		dom.style(copy, 'display:block!important;margin:' + (-top) + 'px 0 0 ' + (-left) + 'px!important');

		// a page's background fills its whole viewport, not just the box of its body

		ground = view.getComputedStyle(doc.body).backgroundColor;

		if(ground === 'rgba(0, 0, 0, 0)' || ground === 'transparent')ground = view.getComputedStyle(live).backgroundColor;
		if(ground === 'rgba(0, 0, 0, 0)' || ground === 'transparent')ground = '#fff';

		markup = new XMLSerializer().serializeToString(copy);

		markup = markup.replace(/^<html[^>]*>/, (open)=> open + '<style>' + (snapshotCSS(doc) + snapshotStill).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</style>');

		// characters XML has no place for

		markup = markup.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');

		svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + wide + '" height="' + tall + '">'
			+ '<foreignObject x="0" y="0" width="' + wide + '" height="' + tall + '">'
			+ '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + wide + 'px;height:' + tall + 'px;overflow:hidden;background:' + ground + '">'
			+ markup
			+ '</div></foreignObject></svg>';

		try{
			address = encodeURIComponent(svg);
		}catch(err){
			// half of a character pair somewhere in the page text
			address = encodeURIComponent(svg.replace(/[\ud800-\udfff]/g, ''));
		}

		// a data: address on purpose: an SVG image loaded from a blob: address marks every canvas it touches as unreadable

		image.src = 'data:image/svg+xml;charset=utf-8,' + address;

		await image.decode();

		// kept as plain pixels, so drawing it every frame costs nothing no matter how complex the page is

		canvas.width = wide;
		canvas.height = tall;
		canvas.getContext('2d').drawImage(image, 0, 0);

		return {image: canvas, x: left, y: top, width: wide, height: tall, taken: started, cost: Date.now() - started};
	};
