// vibeBrowser. Pages load in an iframe through the web proxy (scripts/stomp.js). While the window
// has the focus the iframe itself is on screen, the real page with everything a browser does.
// The rest of the time the page is drawn on the canvas like the rest of the desktop, from pictures
// the browser's own renderer makes of it (scripts/snapshot.js), so it keeps its place among the
// other windows. initBrowser() opens an empty window, initBrowser('https://example.org') opens it
// on a page (links in documents do that).

var browserSearch = 'https://duckduckgo.com/?q=%s',
	browserAddress = (text)=>{
		// what was typed is an address, a host name, or something to search for
		text = text.trim();

		if(/^https?:\/\//i.test(text))return text;
		if(/^[^\s\/]+\.[^\s]+$/.test(text) || /^localhost(:\d+)?(\/|$)/.test(text))return 'https://' + text;

		return browserSearch.replace('%s', encodeURIComponent(text));
	},
	initBrowser = (url)=>{
		var toolbar = 36,
			shown = null,
			view = new webview(null, 'browser'),
			go = (text)=>{
				if(text.trim() === '')return;

				address.value = browserAddress(text);

				view.proxy(address.value);
			},
			address = new inputbar(0, 24, 'Search or enter an address', (key, str)=>{
				// onChange(e.key, this.value);
			},
			(str)=>{
				// onSubmit(this.value);

				go(str);
			}),
			tools = [
				{icon: 'actions/16/go-previous.png', run: ()=>{ if(view.frame != null)view.frame.back(); }},
				{icon: 'actions/16/go-next.png', run: ()=>{ if(view.frame != null)view.frame.forward(); }},
				{icon: 'actions/16/view-refresh.png', run: ()=>{ if(view.frame != null)view.frame.reload(); }},
			],
			window = new cwindow('browser', 0, 0, (window)=>{
				// after render

				var top = window.contentBox.y,
					typing = cursor.focus == address.interactable.id,
					page = view.frame != null ? view.frame.url : null,
					title = view.frame != null ? view.frame.title : null;

				// the address bar follows the page (links, redirects, history) unless it is being typed in

				if(page != null && page !== shown){
					shown = page;

					if(!typing)address.value = page;
				}

				window.title = title ? title.slice(0, 70) + ' - vibeBrowser' : 'vibeBrowser';

				// toolbar

				mctx.fillStyle = '#404040';
				mctx.fillRect(window.x, top, window.width, toolbar);

				tools.forEach((tool,i)=>{
					var box = tool.interactable;

					box.index = window.contentBox.index + 1;
					box.x = window.x + 8 + i * 28;
					box.y = top + 5;

					if(box.hover){
						mctx.fillStyle = box.pressed ? '#2D557F' : '#287CD5';
						mctx.fillRect(box.x, box.y, box.width, box.height);
					}

					mctx.drawImageURL('tango/' + tool.icon, box.x + 5, box.y + 5, 16, 16);
				});

				address.interactable.index = window.contentBox.index + 1;
				address.interactable.x = window.x + 8 + tools.length * 28 + 6;
				address.interactable.y = top + 6;
				address.interactable.width = Math.max(40, window.x + window.width - 8 - address.interactable.x);

				address.render();

				// a page on its way

				if(view.loading){
					mctx.fillStyle = 'rgba(40, 124, 213, ' + (0.45 + 0.4 * Math.sin(Date.now() / 150)) + ')';
					mctx.fillRect(window.x, top + toolbar - 2, window.width, 2);
				}

				if(view.place(window, toolbar))return;

				// the page is not showing: say why

				mctx.fillStyle = '#000';
				mctx.font = '14px Open Sans';
				mctx.fillText(view.proxied ? view.notice() : 'Type an address or a search above and press Enter', window.x + 15, top + toolbar + 26);
			});

		tools.forEach((tool,i)=>{
			tool.interactable = new interactable('browser_tool', 26, 26,
				emptyFunction,
				emptyFunction,
				emptyFunction,
				()=>{
					// click end
					if(tool.interactable.hover)tool.run();
				}
			);
		});

		window.width = 900;
		window.height = 600;
		window.minWidth = 360;
		window.minHeight = 200;

		window.x = msize.w / 2 - window.width / 2; // center of screen
		window.y = msize.h / 2 - window.height / 2; // middle of screen

		window.icon = 'apps/24/internet-web-browser.png';
		window.title = 'vibeBrowser';
		window.bgColor = 'white';

		window.onWheel = (step)=>{
			view.wheel(step);
		};

		window.closing = ()=>{
			view.destroy();

			address.interactable.delete();

			tools.forEach((tool,i)=>{
				tool.interactable.delete();
			});
		};

		// the proxy starts with the window so it is ready by the time an address is typed

		stomp.load().catch(emptyFunction);

		if(typeof url == 'string')go(url)
		else cursor.focus = address.interactable.id; // ready to type
	};
