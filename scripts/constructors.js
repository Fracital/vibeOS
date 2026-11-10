var webViewContainer = document.getElementById('webViews');

class webview {
	constructor(baseURL, name){
		this.object = document.createElement('iframe')

		this.baseURL = baseURL;

		// set by proxy(): the Stomp frame driving the iframe, and what went wrong if it could not

		this.frame = null;
		this.proxied = false;
		this.loading = false;
		this.error = '';
		this.closed = false;

		// the picture of the page that is drawn on the desktop while the iframe is hidden
		// (scripts/snapshot.js), and what decides when a new one is due

		this.shot = null;
		this.shotCanvas = document.createElement('canvas');
		this.shooting = false;
		this.shotAt = 0; // when the last picture was started
		this.shotCost = 100; // how long it took, pictures are paced by that
		this.failures = 0;
		this.dirty = true; // the page changed since the last picture
		this.urgent = 0; // when the user last scrolled or resized the hidden page
		this.lively = false; // the page has a canvas or a video, which change without telling anyone
		this.showing = false;
		this.left = 0; // when the iframe was last asked to step aside
		this.sizeKey = '';
		this.watched = null;
		this.observer = null;
		this.gathering = false;
		this.gatherAt = 0;

		overlay.appendChild(this.object);

		if(baseURL != null)this.object.src = this.baseURL

		this.object.setAttribute('class', 'webview');
		this.object.style.visibility = 'hidden';

		// loads a web page through the web proxy (scripts/stomp.js) instead of pointing the iframe at it

		this.proxy = async (url)=>{
			this.proxied = true;
			this.loading = true;
			this.error = '';

			try{
				var controller = await stomp.load();

				if(this.closed)return;

				if(this.frame == null)this.frame = controller.createFrame(this.object);

				await this.frame.go(url);
			}catch(err){
				this.error = err.message;
				console.error(err);
			}

			this.loading = false;
		}

		// what to tell the user when there is neither the page nor a picture of it to show

		this.notice = ()=>{
			if(this.proxied && this.error !== '')return 'Could not load the page: ' + this.error;
			if(this.proxied && this.frame == null)return stomp.message;

			return 'Click the window to use this app';
		}

		// the document in the iframe, when it is one we may look into (same origin, which includes
		// everything behind the web proxy) and it has something in it

		this.page = ()=>{
			try{
				var doc = this.object.contentDocument;

				return doc != null && doc.documentElement != null && doc.body != null ? doc : null;
			}catch(err){
				return null;
			}
		}

		// notices when the page changes, so pictures are only taken when there is something new to see

		this.watch = (doc)=>{
			var mark = ()=>{
					this.dirty = true;
				};

			if(doc === this.watched)return;

			if(this.observer != null)this.observer.disconnect();

			this.watched = doc;
			this.failures = 0;
			this.dirty = true;

			this.observer = new MutationObserver(mark);
			this.observer.observe(doc.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});

			doc.defaultView.addEventListener('scroll', mark, true);
			doc.defaultView.addEventListener('load', mark);
		}

		this.snap = async ()=>{
			var doc = this.page();

			if(doc == null || this.shooting)return;

			this.shooting = true;
			this.dirty = false;
			this.shotAt = Date.now();

			try{
				this.shot = await pageSnapshot(doc, this.shotCanvas);
				this.shotCost = this.shot.cost;
				this.lively = doc.querySelector('canvas, video') != null;
				this.failures = 0;
			}catch(err){
				// some pages cannot be drawn this way (markup that XML will not take, mostly).
				// after a few tries the page is left alone until it turns into another one
				this.failures++;
			}

			this.shooting = false;
		}

		// fonts, icons and backgrounds are fetched ahead of time, while the page is still in use,
		// so the first picture already has them

		this.gather = async (doc)=>{
			if(this.gathering)return;

			this.gathering = true;
			this.gatherAt = Date.now();

			try{
				if(await snapshotGather(doc))this.dirty = true;
			}catch(err){
				console.error(err);
			}

			this.gathering = false;
		}

		// the wheel over a hidden page scrolls the real one, and the picture follows

		this.wheel = (step)=>{
			var doc = this.page();

			if(doc == null)return;

			doc.defaultView.scrollBy(0, step);

			this.urgent = Date.now();
		}

		// called from the window's render callback: keeps the iframe over the content box, top pixels
		// below the title bar. an iframe covers the canvas and swallows the mouse, so the real page
		// only shows while its window has the focus and is not being moved or resized. the rest of
		// the time a picture of the page is drawn on the canvas instead, where other windows can
		// overlap it like anything else. returns whether the page is on screen in either form

		this.place = (window, top)=>{
			var now = Date.now(),
				focused = cursor.focus != null && windowOf(interactables[cursor.focus]) === window,
				show = focused && !window.titleBar.pressed && !window.resizing && (!this.proxied || this.frame != null),
				pageTop = window.y + 30 + top,
				tall = Math.max(0, window.height - 11 - top),
				style = this.object.style,
				doc = this.page(),
				gap = 0;

			style.left = window.x + 'px';
			style.top = pageTop + 'px';

			style.width = window.width + 'px';
			style.height = tall + 'px';
			style.cursor = 'url("tango/cursor/'+cursor.img+'.cur"), none';

			if(this.sizeKey !== window.width + 'x' + tall){
				this.sizeKey = window.width + 'x' + tall;
				this.dirty = true;
				this.urgent = now;
			}

			if(doc != null && now - this.gatherAt > 1500)this.gather(doc);

			if(show){
				this.showing = true;

				style.visibility = 'visible';
				style.pointerEvents = 'auto';

				return true;
			}

			// stepping aside: the iframe stops taking the mouse at once

			style.pointerEvents = 'none';

			if(doc == null){
				// nothing to take a picture of: a page from another site, or nothing loaded yet
				this.showing = false;

				style.visibility = 'hidden';

				return false;
			}

			this.watch(doc);

			if(this.showing){
				this.showing = false;
				this.left = now;
				this.dirty = true;
				this.urgent = now;
			}

			if(this.lively && now - this.shotAt > 1000)this.dirty = true;

			// pictures are paced by what they cost: quickly while the user scrolls or resizes the
			// page, slowly for a page that just keeps changing on its own

			gap = now - this.urgent < 600 ? Math.max(100, this.shotCost * 2) : Math.max(700, this.shotCost * 8);

			if(this.dirty && !this.shooting && this.failures < 3 && now - this.shotAt > gap)this.snap();

			// the real page stays up for the moment it takes to get a picture of how it looks right
			// now, so the window never blinks when the focus moves away

			if((this.shot == null || this.shot.taken < this.left) && now - this.left < 500 && this.failures < 3){
				style.visibility = 'visible';

				return true;
			}

			style.visibility = 'hidden';

			if(this.shot == null)return false;

			mctx.fillStyle = '#fff';
			mctx.fillRect(window.x, pageTop, window.width, tall);

			mctx.save();
			mctx.beginPath();
			mctx.rect(window.x, pageTop, window.width, tall);
			mctx.clip();
			mctx.beginPath(); // roundRect fills whatever path is left lying around

			// drawn where the page is scrolled to now, which can be ahead of the picture

			mctx.drawImage(this.shot.image, window.x + this.shot.x - doc.defaultView.pageXOffset, pageTop + this.shot.y - doc.defaultView.pageYOffset);

			mctx.restore();

			return true;
		}

		this.destroy = ()=>{
			this.closed = true;

			if(this.observer != null)this.observer.disconnect();

			if(this.object.parentNode != null)this.object.parentNode.removeChild(this.object);
		}
	}
}

// initWebView(title, icon, url, width, height, proxy): proxy false loads the url straight into the
// iframe (files of this site, sites that allow framing). anything else goes through the web proxy.

var initWebView = ((title, icon, url, width, height, proxy)=>{
			var direct = typeof proxy == 'boolean' && proxy == false,
				vWebview = new webview(direct ? url : null, 'webview'),
				window = new cwindow('webview', 50, 50, (window)=>{
					// render business happens here

					if(vWebview.place(window, 0))return;

					mctx.fillStyle='#000';
					mctx.font = '14px Open Sans';
					mctx.fillText(vWebview.notice(), window.x + 15 , window.y + 50);
				});

			window.title = title;
			window.icon = icon;
			window.width = width;
			window.height = height;

			window.closing = ()=>{
				vWebview.destroy();
			}

			window.onWheel = (step)=>{
				vWebview.wheel(step);
			}

			if(!direct)vWebview.proxy(url);
		});

class inputbar {
	constructor(width, height, placeholder, onChange, onSubmit){ // caller needs to set interactable index to get anything working as intended
		this.index = 12;

		this.interactable = new interactable('inputbar' + Date.now(), width, height,
		()=>{
			// hoverstart
		},
		()=>{
			// hoverend
		},
		(e)=>{
			// click start: put the caret under the pointer. shift keeps the other end where it was,
			// and a second click right after the first selects everything

			if(Date.now() - this.lastPress < 400){
				this.anchor = 0;
				this.caret = this.value.length;
				this.dragging = false;
			}else{
				this.caret = this.at(cursor.x);
				this.dragging = true;

				if(e == null || !e.shiftKey)this.anchor = this.caret;
			}

			this.lastPress = Date.now();
		}
		);

		this.interactable.drawn = 0; // takes input only while render() is being called

		this.value = '';
		this.preValue = '';

		// caret is where typing goes and anchor is the other end of the selection (the same spot
		// when nothing is selected). scroll is how far long text is shifted to keep the caret in view

		this.caret = 0;
		this.anchor = 0;
		this.scroll = 0;
		this.dragging = false;
		this.lastPress = 0;
		this.font = '14px Open Sans';

		if(placeholder != null)this.placeholder = placeholder
		else this.placeholder = 'Input field'

		this.range = ()=>{
			// the value can be replaced from outside at any time, so both ends are kept inside it
			this.caret = Math.min(this.caret, this.value.length);
			this.anchor = Math.min(this.anchor, this.value.length);

			return [Math.min(this.caret, this.anchor), Math.max(this.caret, this.anchor)];
		}

		this.selected = ()=>{
			var range = this.range();

			return this.value.slice(range[0], range[1]);
		}

		// replaces the selection (or goes in at the caret when there is none)

		this.insert = (text)=>{
			var range = this.range();

			this.value = this.value.slice(0, range[0]) + text + this.value.slice(range[1]);

			this.caret = range[0] + text.length;
			this.anchor = this.caret;
		}

		this.textWidth = (count)=>{
			mctx.font = this.font;

			return mctx.measureText(this.value.slice(0, count)).width;
		}

		// the caret position under a point on screen

		this.at = (x)=>{
			var want = x - (this.interactable.x + 10) + this.scroll,
				n = 0;

			while(n < this.value.length && (this.textWidth(n) + this.textWidth(n + 1)) / 2 < want)n++;

			return n;
		}

		// keys and the clipboard arrive here while this bar has the focus (see main.js)

		this.interactable.keydown = (e)=>{
			var range = this.range(),
				shift = e.shiftKey,
				submitted = '';

			if(e.ctrlKey || e.metaKey)return; // shortcuts are not text, copy and paste come in through their own hooks

			switch(e.key){
				case 'Backspace':
					if(range[0] === range[1])this.anchor = Math.max(0, this.caret - 1);
					this.insert('');
					break
				case 'Delete':
					if(range[0] === range[1])this.anchor = Math.min(this.value.length, this.caret + 1);
					this.insert('');
					break
				case 'ArrowLeft':
					this.caret = shift || range[0] === range[1] ? Math.max(0, this.caret - 1) : range[0];
					if(!shift)this.anchor = this.caret;
					break
				case 'ArrowRight':
					this.caret = shift || range[0] === range[1] ? Math.min(this.value.length, this.caret + 1) : range[1];
					if(!shift)this.anchor = this.caret;
					break
				case 'Home':
					this.caret = 0;
					if(!shift)this.anchor = this.caret;
					break
				case 'End':
					this.caret = this.value.length;
					if(!shift)this.anchor = this.caret;
					break
				case 'ArrowUp': // up arrow brings the last submitted value back
					this.value = this.preValue;
					this.caret = this.value.length;
					this.anchor = this.caret;
					break
				case 'Enter':
					// kept before the callback runs, which is free to clear the bar

					submitted = this.value;

					onSubmit(submitted);

					this.preValue = submitted; // set previous value for uparrow presses
					this.caret = this.value.length;
					this.anchor = this.caret;
					break
				default:
					if(e.key.length !== 1)return; // not a character (F keys, Tab, Escape..)

					this.insert(e.key);

					onChange(e.key, this.value);
					break
			}

			e.preventDefault();
		}

		this.interactable.copy = ()=>{
			return this.selected();
		}

		this.interactable.cut = ()=>{
			var text = this.selected();

			if(text !== '')this.insert('');

			return text;
		}

		this.interactable.paste = (text)=>{
			this.insert(text.replace(/[\r\n]+/g, ' '));

			onChange('', this.value);
		}

		this.interactable.selectAll = ()=>{
			this.anchor = 0;
			this.caret = this.value.length;
		}

		this.render = ()=>{ // let the caller do this part because we absolutely should not push to the renderq on our own
			var box = this.interactable,
				focused = cursor.focus == box.id,
				textX = box.x + 10,
				range = [],
				caretX = 0;

			box.drawn = frame;

			if(box.pressed && this.dragging)this.caret = this.at(cursor.x);

			range = this.range();

			if(focused){
				mctx.fillStyle='#fff';
			}else if(box.hover){
				mctx.fillStyle='#bdbdbd';
			}else{
				mctx.fillStyle='#8a8a8a';
			}

			mctx.fillRect(box.x, box.y, box.width, box.height);

			mctx.fillStyle='#000';
			mctx.fillRect(box.x+2, box.y+2, box.width-4, box.height-4);

			// long text scrolls sideways so the caret stays inside the bar, and never draws past it

			caretX = this.textWidth(this.caret);

			if(!focused)this.scroll = 0
			else this.scroll = Math.max(caretX - (box.width - 20), Math.min(this.scroll, caretX));

			mctx.save();
			mctx.beginPath();
			mctx.rect(box.x + 4, box.y + 2, box.width - 8, box.height - 4);
			mctx.clip();
			mctx.beginPath(); // roundRect fills whatever path is left lying around

			if(focused && range[0] !== range[1]){
				mctx.fillStyle = '#2D557F';
				mctx.fillRect(textX - this.scroll + this.textWidth(range[0]), box.y + 4, this.textWidth(range[1]) - this.textWidth(range[0]), box.height - 8);
			}

			mctx.font = this.font;
			mctx.fillStyle = focused ? '#fff' : '#8c8c8c';
			mctx.fillText(this.value, textX - this.scroll, box.y + box.height/2 + 5);

			// the caret blinks off the clock, a timer per input bar kept running after its window closed

			if(focused && Math.floor(Date.now() / 500) % 2 === 0)mctx.fillRect(textX - this.scroll + caretX, box.y + 5, 1, box.height - 10);

			mctx.restore();

			if(box.hover)cursor.img = 'text';
		}
	}
}

class button {
	constructor(text, width, height){
		this.interactable = new interactable('button' + Object.entries(interactables).length , width, height,
			()=>{
				// hoverstart
			},
			()=>{
				// hoverend
			},
			()=>{
				// clickstart
			},
			()=>{
				// clickend
			}
		);
		
		// let interactable index be set by caller and perhaps contentbox  index +1
		
		this.interactable.drawn = 0; // takes input only while render() is being called

		this.text = text;
		
		this.this = ()=>{
			return this
		}
		
		this.render = ()=>{ // make caller render the button
			this.interactable.drawn = frame;

			// border
			
			mctx.fillStyle = 'transparent';
			mctx.strokeStyle = '#c95528';
			
			mctx.roundRect(this.interactable.x, this.interactable.y, this.interactable.width, this.interactable.height, 15);
			
			// content
			
			this.grad = mctx.createLinearGradient(this.interactable.x, this.interactable.y, this.interactable.x, this.interactable.y + this.interactable.height);
			
			if(this.interactable.pressed){
				this.grad.addColorStop(0, '#d2692a');
			}else if(this.interactable.hover){
				this.grad.addColorStop(0, '#de985b');
				this.grad.addColorStop(0.8, '#d2612a');
				this.grad.addColorStop(1, '#d2612a');
			}else{
				this.grad.addColorStop(0, '#de985b');
				this.grad.addColorStop(1, '#d2612a');
			}
			
			// this.grad.addColorStop(0, '#fff');
			// this.grad.addColorStop(1, '#000');
			
			mctx.fillStyle = this.grad;
			mctx.strokeStyle = this.grad;
			
			mctx.roundRect(this.interactable.x + 1, this.interactable.y + 1, this.interactable.width - 2, this.interactable.height - 2, 15);
			
			mctx.fillStyle = '#fff'
			mctx.font = '14px Open Sans';
			mctx.textAlign = 'center'; 
			
			mctx.fillText(this.text, this.interactable.x + this.interactable.width / 2, this.interactable.y + this.interactable.height / 2  + 4);
			
			mctx.textAlign = 'start'; 
		}
	}
}

class cswitch {
	constructor(width, height, value){
		this.value = value; // starting value
		
		this.split = 2
		
		this.interactable = new interactable('button' + Object.entries(interactables).length , width, height,
			()=>{
				// hoverstart
			},
			()=>{
				// hoverend
			},
			()=>{
				// clickstart
			},
			()=>{
				// clickend
				this.value = !this.value
			}
		);
		
		this.this = ()=>{
			return this
		}
		
		this.width = width
		
		this.interactable.drawn = 0; // takes input only while render() is being called

		this.render = ()=>{ // never push to renq in a constructor
			
			this.interactable.drawn = frame;

			// content
			
			this.grad = mctx.createLinearGradient(this.interactable.x, this.interactable.y, this.interactable.x, this.interactable.y + this.interactable.height)
			
			this.bgGrad = mctx.createLinearGradient(this.interactable.x, this.interactable.y, this.interactable.x, this.interactable.y + this.interactable.height)
			
			if(this.interactable.pressed){
				this.grad.addColorStop(0, '#d2692a');
			}else if(this.interactable.hover){
				this.grad.addColorStop(0, '#de985b');
				this.grad.addColorStop(0.8, '#d2612a');
				this.grad.addColorStop(1, '#d2612a');
			}else{
				this.grad.addColorStop(0, '#de985b');
				this.grad.addColorStop(1, '#d2612a');
			}
			
			this.bgGrad.addColorStop(0, '#DDDDDD');
			this.bgGrad.addColorStop(1, '#D1D1D1');
			
			this.switchX = (this.value ? (this.interactable.x + this.interactable.width - this.interactable.width / this.split) : this.interactable.x)
			
			// background border
			
			mctx.fillStyle = 'transparent';
			mctx.strokeStyle = '#A8A8A8';
			
			mctx.roundRect(this.interactable.x, this.interactable.y, this.interactable.width, this.interactable.height, 15);
			
			// background
			
			mctx.fillStyle = this.bgGrad;
			mctx.strokeStyle = this.bgGrad;
			mctx.roundRect(this.interactable.x + 1, this.interactable.y + 1, this.interactable.width - 2, this.interactable.height - 2, 15);
			
			// border
			
			mctx.fillStyle = 'transparent';
			mctx.strokeStyle = '#c95528';
			
			mctx.roundRect(this.switchX, this.interactable.y, this.interactable.width / this.split, this.interactable.height, 15);
			
			// content 
			
			mctx.fillStyle = this.grad;
			mctx.strokeStyle = this.grad;
			mctx.roundRect(this.switchX + 1, this.interactable.y + 1, (this.interactable.width - 2) / this.split, this.interactable.height - 2, 15);
			
			if(this.value){ // enabled

			}else{ //probably disabled
				
			}
			/*
			mctx.fillStyle = '#fff'
			mctx.font = '14px Open Sans';
			mctx.textAlign = 'center'; 
			
			mctx.fillText(this.text, this.interactable.x + this.interactable.width / 2, this.interactable.y + this.interactable.height / 2  + 4);
			
			mctx.textAlign = 'start'; 
			*/
		}
	}
}

class cradio {
	constructor(label, wh, value){
		this.value = value; // starting value
		
		this.split = 2
		
		this.label = label
		
		this.interactable = new interactable('buttonveee' + Date.now() + Object.entries(interactables).length , wh, wh,
			()=>{
				// hoverstart
			},
			()=>{
				// hoverend
			},
			()=>{
				// clickstart
			},
			()=>{
				// clickend
				this.value = !this.value
			}
		);
		
		this.this = ()=>{
			return this
		}
		
		this.interactable.drawn = 0; // takes input only while render() is being called

		this.render = ()=>{ // never push to renq in a constructor
			
			this.interactable.drawn = frame;

			// content
			
			this.grad = mctx.createLinearGradient(this.interactable.x, this.interactable.y, this.interactable.x, this.interactable.y + this.interactable.height)
			
			this.bgGrad = mctx.createLinearGradient(this.interactable.x, this.interactable.y, this.interactable.x, this.interactable.y + this.interactable.height)
			
			if(this.interactable.pressed){
				this.grad.addColorStop(0, '#d2692a');
			}else if(this.interactable.hover){
				this.grad.addColorStop(0, '#de985b');
				this.grad.addColorStop(0.8, '#d2612a');
				this.grad.addColorStop(1, '#d2612a');
			}else{
				this.grad.addColorStop(0, '#de985b');
				this.grad.addColorStop(1, '#d2612a');
			}
			
			this.bgGrad.addColorStop(0, '#DDDDDD');
			this.bgGrad.addColorStop(1, '#D1D1D1');
			
			// background border
			
			mctx.fillStyle = 'transparent'
			mctx.strokeStyle = '#A8A8A8'
			
			mctx.roundRect(this.interactable.x, this.interactable.y, this.interactable.width, this.interactable.height, 50);
			
			// background
			
			mctx.fillStyle = 'transparent'
			mctx.strokeStyle = this.bgGrad
			
			mctx.roundRect(this.interactable.x + 1, this.interactable.y + 1, this.interactable.width - 2, this.interactable.height - 2, 40);
			
			// content 
			
			if(this.value){ // enabled
				mctx.fillStyle = this.grad
				mctx.strokeStyle = this.grad
				
				mctx.roundRect(
					this.interactable.x + this.interactable.width / 4,
					this.interactable.y + this.interactable.width / 4,
					this.interactable.width / 2,
					this.interactable.height / 2,
					40
				);
			}else{ //probably disabled
				
			}
			
			mctx.fillStyle='#000';
			mctx.font = "14px Open Sans";
			mctx.fillText(this.label, this.interactable.x + this.interactable.width + 8, this.interactable.y + this.interactable.height - 8);
			
		}
	}
}

class cPrompt {
	constructor(title, value, onTrue, onFalse, onRender, whichRenq){
		if(whichRenq == null)this.whichRenq = highRenq
		else this.whichRenq = whichRenq
		
		if(title == null)this.title = 'Prompt'
		else this.title = title;
		
		if(value == null)this.value = 'Undefined'
		else this.value = value;
		
		this.onRender = (onRender == null ? emptyFunction : onRender);
		
		this.buttons = [
			[ new button('Yes', 100, 50), onTrue ],
			[ new button('No', 100, 50), onFalse ],
		]
		
		this.closed = false;
		
		this.buttons.forEach((entry, index)=>{
			entry[0].interactable.clickend = ()=>{
				if(this.closed == true)return;
				
				if(entry[0].interactable.hover != true)return; // user has moved cursor off button but released 
				entry[1](); // run callback
				
				this.window.close();
				this.closed = true;
				entry[0].interactable.delete();
			}
		});
		
		if(this.value.length > 161){
			this.value = this.value.substr(0,156) + '...'
		}
		
		this.window = new cwindow(this.title, 200, 50, (window)=>{ // on render
			window.title = this.title
			
			// description of window
			
			mctx.fillStyle = '#000'
			mctx.font = '15px Open Sans';
			
			mctx.fillWrapText(this.value, this.window.x + 8, this.window.contentBox.y + 16, this.window.contentBox.width - 8, 18);
			
			// button crap
			
			this.buttons.forEach((entry,index)=>{
				entry[0].interactable.x = this.window.x + this.window.width - entry[0].interactable.width - 10 - index * 120
				
				entry[0].interactable.y = this.window.y + this.window.height - 40
		
				entry[0].interactable.index = this.window.contentBox.index + 5
				
				entry[0].render();
			});
			
			this.onRender(this);
		},
		whichRenq);
		
		this.window.width = 325
		this.window.height = 150
		this.window.resizable = false
		
		this.window.x = (msize.w / 2) - this.window.width / 2
		this.window.y = (msize.h / 2) - this.window.height / 2
	}
}

class windowOptions {
	constructor(elements){
		this.interactable = new interactable('windowOptions' + Object.entries(interactables).length , 250, 20,
			()=>{
				// hoverstart
			},
			()=>{
				// hoverend
			},
			()=>{
				// clickstart
			},
			()=>{
				// clickend
			}
		);
		
		this.elements = elements;
		
		this.elements.forEach((e,i)=>{ // add interactable elements
			e.interactable = new interactable('windowOptions' + Object.entries(interactables).length , 50, 24,
				()=>{
					// hoverstart
				},
				()=>{
					// hoverend
				},
				()=>{
					// clickstart
				},
				()=>{
					// clickend
					e.open = !e.open
				}
			);
			
			e.contents.forEach((entry,index)=>{
				entry.interactable = new interactable('windowOptions_contents_' + Object.entries(interactables).length, e.value.length * 18, 24,
					()=>{
						// hoverstart
					},
					()=>{
						// hoverend
					},
					()=>{
						// clickstart
					},
					()=>{
						// clickend
						entry.func(); // run callback
					}
				);
				entry.interactable.disabled = true
			});
		});
		
		this.render = (window)=>{
			this.interactable.index = window.contentBox.index + 231
			this.interactable.width = window.width
			this.interactable.height = 25
			this.interactable.x = window.x
			this.interactable.y = window.y + 30
			
			mctx.fillStyle = '#404040'
			mctx.fillRect(this.interactable.x, this.interactable.y, this.interactable.width, this.interactable.height);
			
			// draw elements
			
			this.elements.forEach((e,i)=>{
				e.interactable.index = window.contentBox.index + 232
				
				e.interactable.x = this.interactable.x + 10 + i * e.interactable.width - 4
				e.interactable.y = this.interactable.y
		
				// border
			
				if(e.interactable.hover){
					mctx.fillStyle = '#2D557F';
					mctx.fillRect(e.interactable.x, e.interactable.y, e.interactable.width, e.interactable.height);
					
					mctx.fillStyle = '#4890DA';
					mctx.fillRect(e.interactable.x + 1, e.interactable.y + 1, e.interactable.width - 1, e.interactable.height - 2);
					
					mctx.fillStyle = '#287CD5';
					mctx.fillRect(e.interactable.x + 2, e.interactable.y + 2, e.interactable.width - 3, e.interactable.height - 4);
				
				}else{
					mctx.fillStyle = 'transparent';
					mctx.fillRect(e.interactable.x, e.interactable.y, e.interactable.width, e.interactable.height);
				}
				
				mctx.fillStyle = '#fff'
				mctx.textAlign = 'center'
				
				mctx.font = 'normal 13px Open Sans'
				
				mctx.fillText(e.value, e.interactable.x + e.interactable.width / 2, e.interactable.y + 16);
				
				mctx.textAlign = 'start'
				
				if(cursor.down && cursor.focus != e.interactable.id)e.open = false;
				
				if(e.open){
					e.contents.forEach((entry,index)=>{
						entry.interactable.disabled = false
						
						entry.interactable.index = window.contentBox.index + 233
						
						entry.interactable.width = 125 // e.interactable.width
						
						entry.interactable.x = e.interactable.x
						entry.interactable.y = e.interactable.y + (index+1) * entry.interactable.height
				
						// border
					
						if(entry.interactable.hover){
							mctx.fillStyle = '#2D557F';
							mctx.fillRect(entry.interactable.x, entry.interactable.y, entry.interactable.width, entry.interactable.height);
							
							mctx.fillStyle = '#4890DA';
							mctx.fillRect(entry.interactable.x + 1, entry.interactable.y + 1, entry.interactable.width - 1, entry.interactable.height - 2);
							
							mctx.fillStyle = '#287CD5';
							mctx.fillRect(entry.interactable.x + 2, entry.interactable.y + 2, entry.interactable.width - 4, entry.interactable.height - 4);
						
						}else{
							mctx.fillStyle = '#404040';
							mctx.fillRect(entry.interactable.x, entry.interactable.y, entry.interactable.width, entry.interactable.height);
						}
						
						mctx.fillStyle = '#fff'
						mctx.textAlign = 'center'
						
						mctx.font = 'normal 13px Open Sans'
						
						mctx.fillText(entry.value, entry.interactable.x + entry.interactable.width / 2, entry.interactable.y + 16);
						
						mctx.textAlign = 'start'					
					});
				}else{
					e.contents.forEach((entry,index)=>{
						entry.interactable.disabled = true
					});
				}
			});
		}
	}
}