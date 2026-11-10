var mCanvas = document.getElementById('mCanvas'),
	overlay = document.getElementById('overlay'),
	mctx = mCanvas.getContext('2d'),
	msize = {w: mCanvas.width, h: mCanvas.height},
	mfocus = false,
	renq = [],
	highRenq = [],
	above_high_renq = [],
	images = {},
	cursor = {img: 'pointer', grab: {} },
	background = {value : 'wallpapers/a.png'},
	wallpaperBusiness = ()=>{},
	interactables = {},
	interactableSerial = 0,
	frame = 0,
	// every open window, bottom to top across all layers
	cwindows = [],
	windowLayers = [renq, highRenq, above_high_renq],
	// each window owns a band of interactable indices; the shell (taskbar, menus) sits between the
	// normal windows and the ones drawn above it
	bandSize = 1000,
	shellIndex = 1000000,
	taskBarHeight = 26,
	// how far a resize grip reaches past the window frame
	gripReach = 6,
	gripCursors = {l: 'horz', r: 'horz', b: 'vert', lb: 'dgn2', rb: 'dgn1'},
	emptyFunction = ()=>{},
	hiddenContainer=document.createElement('div');

// hidden container for hidden elements!
document.body.appendChild(hiddenContainer);

hiddenContainer.style.display = 'none';
hiddenContainer.style.position = 'absolute';

mctx.imageSmoothingEnabled = true;

function wordWrap(str, maxWidth) {
	if(typeof str != 'string')return '';
    var newLineStr = "\n"; done = false; res = '';
    while (str.length > maxWidth) {
        found = false;
        // Inserts new line at first whitespace of the line
        for (i = maxWidth - 1; i >= 0; i--) {
            if ( new RegExp(/^\s$/).test(str.charAt(i).charAt(0)) ) {
                res = res + [str.slice(0, i), newLineStr].join('');
                str = str.slice(i + 1);
                found = true;
                break;
            }
        }
        // Inserts new line at maxWidth position, the word is too long to wrap
        if (!found) {
            res += [str.slice(0, maxWidth), newLineStr].join('');
            str = str.slice(maxWidth);
        }

    }

    return res + str;
}

CanvasRenderingContext2D.prototype.drawImageURL = function(src, sx , sy, swidth, sheight, width, height){
	if(images[src] == null){
		// add a new image to the array with the url as a key
		images[src] = new Image();
		images[src].src = src;

		images[src].addEventListener('load', ()=>{
			try{
				this.drawImage(images[src], sx, sy, swidth, sheight);
			}catch(err){
				console.error(err, images[src]);
				// this.fillStyle = '#000'
				// this.fillRect(sx, sy, swidth, sheight);
			}
		});

	} else {
		try{
			this.drawImage(images[src], sx, sy, swidth, sheight);
		}catch(err){
			console.error(err, images[src]);
			// this.fillStyle = '#000'
			// this.fillRect(sx, sy, swidth, sheight);
		}
	}

	// image should exist here
}

CanvasRenderingContext2D.prototype.roundRect = function (x,y,width,height,radius) {
    radius = Math.min(Math.max(width-1,1),Math.max(height-1,1),radius);
    var rectX = x;
    var rectY = y;
    var rectWidth = width;
    var rectHeight = height;
    var cornerRadius = radius;
 
    this.lineJoin = "round";
    this.lineWidth = cornerRadius;
    this.strokeRect(rectX+(cornerRadius/2), rectY+(cornerRadius/2), rectWidth-cornerRadius, rectHeight-cornerRadius);
    this.fillRect(rectX+(cornerRadius/2), rectY+(cornerRadius/2), rectWidth-cornerRadius, rectHeight-cornerRadius);
    this.stroke();
    this.fill();
}

CanvasRenderingContext2D.prototype.fillWrapText = function (text, x, y, maxWidth, lineHeight) {
	if(typeof text != 'string')return null;
	var words = text.split(' ');
	var line = '';

	for(var n = 0; n < words.length; n++) {
		var testLine = line + words[n] + ' ';
		var metrics = this.measureText(testLine);
		var testWidth = metrics.width;
		if(testWidth > maxWidth && n > 0) {
			this.fillText(line, x, y);
			line = words[n] + ' ';
			y += lineHeight;
		} else {
			line = testLine;
		}
	}
	this.fillText(line, x, y);
}

class interactable {
	constructor(id, width, height, hoverstart, hoverend, clickstart, clickend, rightclickstart, rightclickend){
		// two widgets asking for the same id used to replace each other in the registry, leaving one of them dead

		if(interactables[id] != null)id = id + '_' + (++interactableSerial);

		this.width = Number(width);

		this.height = Number(height);

		// let the caller define the positions here

		this.x = 0;

		this.y = 0;

		this.index = 0;

		this.hover = false;

		this.pressed = false;

		// widgets that draw themselves stamp the current frame here from render(), and stop taking
		// input once they are no longer drawn (a hidden tab, a closed window). null means the owner
		// switches the interactable on and off by hand through disabled

		this.drawn = null;

		this.delete = ()=>{
			// only ever unregister ourselves, the id may belong to a newer widget by now
			if(interactables[this.id] === this)delete interactables[this.id];
		}

		this.setValue = (key, value) => {
			this[key] = value;
		}

		this.id = id; // for reading it, dont change

		// functions and stuff

		if(typeof hoverstart != 'undefined')this.hoverstart = hoverstart
		else this.hoverstart = emptyFunction;

		if(typeof hoverend != 'undefined')this.hoverend = hoverend
		else this.hoverend = emptyFunction;

		if(typeof clickstart != 'undefined')this.clickstart = clickstart
		else this.clickstart = emptyFunction;

		if(typeof clickend != 'undefined')this.clickend = clickend
		else this.clickend = emptyFunction;

		if(typeof rightclickstart != 'undefined')this.rightclickstart = rightclickstart
		else this.rightclickstart = emptyFunction;

		if(typeof rightclickend != 'undefined')this.rightclickend = rightclickend
		else this.rightclickend = rightclickend;

		// near last

		interactables[id] = this;
	}
}

var layerOf = (w)=>{
		return Math.max(0, windowLayers.indexOf(w.whichRenq));
	},
	windowOf = (entry)=>{
		// a widget belongs to the window whose index band it sits in (contentBox.index + n)
		if(entry == null)return null;

		return cwindows.find((w)=> entry.index >= w.band && entry.index < w.band + bandSize) || null;
	},
	restackWindows = ()=>{
		// hand every window a band that matches the draw order and carry its widgets along,
		// so a raise or a close never leaves anything pointing at a stale index
		var all = Object.values(interactables),
			owned = cwindows.map((w)=> all.filter((entry)=> windowOf(entry) === w)),
			counts = windowLayers.map(()=> 0);

		cwindows.forEach((w,i)=>{
			var layer = layerOf(w),
				band = layer * 2 * shellIndex + (++counts[layer]) * bandSize;

			owned[i].forEach((entry)=>{
				entry.index += band - w.band;
			});

			w.band = band;
		});
	};

class cwindow {
	constructor(id, x, y, afterRender, whichRenq){

		// whichRenq should be renq by default unless set

		if(whichRenq == null)this.whichRenq = renq
		else this.whichRenq = whichRenq

		// let the caller define the title, width, and height?

		if(Object.entries(interactables).some((e,i)=> e[0].startsWith(id)))id = id + Date.now()

		this.title = 'New Window';

		this.width = 500;

		this.height = 500;

		this.x = x;

		this.y = y;

		this.postX = x;

		this.postY = y;

		this.closing = emptyFunction; // LET THE CALLER DEFINE THIS, IT IS CALLED WHEN WINDOW GETS CLOSED

		this.closed = false;

		this.icon = 'status/24/image-missing.png'

		this.bgColor = '#ccc';

		// the user can drag the left, right and bottom edges unless the app turns this off
		// (apps that set width or height themselves every frame have to)

		this.resizable = true;

		this.resizing = false;

		this.minWidth = 220;

		this.minHeight = 100;

		// scroll state, driven by scrollView()

		this.scrollY = 0;

		this.scrollMax = 0;

		this.scrollPage = 0;

		this.scrollGrab = 0;

		this.scrollThumb = {y: 0, height: 0};

		// a window without a scrollView can take the wheel itself: onWheel(pixels)

		this.onWheel = null;

		// a new window goes on top of its layer, so the next free band is already the right one

		this.band = layerOf(this) * 2 * shellIndex + (cwindows.filter((w)=> layerOf(w) === layerOf(this)).length + 1) * bandSize;

		this.moveToFront = ()=>{
			if(this.closed)return;

			// look the render function up by identity, its position changes whenever another window closes or is raised

			var layer = this.whichRenq,
				at = layer.indexOf(this.renderFunc);

			if(at !== -1)layer.splice(at, 1);

			layer.push(this.renderFunc);

			cwindows.splice(cwindows.indexOf(this), 1);
			cwindows.push(this);

			restackWindows();
		}

		// the frame is drawn 20px taller than height: a 30px title bar that overlaps the content by 10px

		this.contains = (x, y, reach)=>{
			reach = reach || 0;

			return x >= this.x - reach && x <= this.x + this.width + reach && y >= this.y && y <= this.y + this.height + 20 + reach;
		}

		// keep the window usable: never bigger than the desktop, and the title bar always within reach

		this.fitDesktop = ()=>{
			this.width = Math.min(this.width, msize.w);
			this.height = Math.min(this.height, msize.h - taskBarHeight - 20);

			this.x = Math.min(Math.max(this.x, 60 - this.width), msize.w - 60);
			this.y = Math.min(Math.max(this.y, taskBarHeight), msize.h - this.titleBar.height);
		}

		// raising on click is done for every widget of the window in the mousedown handler

		this.titleBar = new interactable(id + '_titlebar', this.width, 30);

		this.contentBox = new interactable(id + '_contentbox', this.width, this.height);

		this.closeButton = new interactable(id + '_close', 18, 18,
		()=>{ // hover start

		}, ()=>{ // hover end

		}, ()=>{ // click start

		}, ()=>{ // click end
			if(this.closeButton.pressed && this.closeButton.hover){
				this.close();
			}
		});

		this.scrollBar = new interactable(id + '_scrollbar', 12, 0,
		emptyFunction,
		emptyFunction,
		()=>{ // click start
			// hold the thumb where it was caught, a press on the bare track centres the thumb on the pointer

			var onThumb = cursor.y >= this.scrollThumb.y && cursor.y <= this.scrollThumb.y + this.scrollThumb.height;

			this.scrollGrab = onThumb ? cursor.y - this.scrollThumb.y : this.scrollThumb.height / 2;
		});

		this.scrollBar.disabled = true;

		// resize grips: l, r and b are edges, lb and rb the bottom corners. they reach a few pixels
		// past the frame so they can be caught next to an iframe, which swallows the mouse inside it

		this.grips = ['l', 'r', 'b', 'lb', 'rb'].map((edges,i)=>{
			var grip = new interactable(id + '_resize_' + edges, 0, 0,
			emptyFunction,
			emptyFunction,
			()=>{ // click start
				this.resizeFrom = {x: this.x, width: this.width, height: this.height};
			});

			grip.edges = edges;
			grip.reach = gripReach;
			grip.disabled = true;

			// above everything else in the window, corners above edges

			grip.index = this.band + bandSize - (edges.length === 2 ? 1 : 2);

			return grip;
		});

		this.contentBox.index = this.band;
		this.titleBar.index = this.band + 1;
		this.closeButton.index = this.band + 2;
		this.scrollBar.index = this.band + bandSize - 10;

		this.close = ()=>{ // get rid of window nicely
			// closing twice used to remove whichever window had moved into this one's slot

			if(this.closed)return;

			this.closed = true;

			var layer = this.whichRenq,
				at = layer.indexOf(this.renderFunc);

			if(at !== -1)layer.splice(at, 1);

			try{
				this.closing();
			}catch(err){
				console.error(err);
			}

			// everything indexed inside the band is a widget of this window, take it all down
			// so nothing invisible is left to catch clicks

			Object.values(interactables).forEach((entry,i)=>{
				if(windowOf(entry) !== this)return;

				if(cursor.focus === entry.id)cursor.focus = null;

				entry.delete();
			});

			this.contentBox.delete();
			this.closeButton.delete();
			this.titleBar.delete();
			this.scrollBar.delete();

			this.grips.forEach((grip,i)=>{
				grip.delete();
			});

			cwindows.splice(cwindows.indexOf(this), 1);

			restackWindows();
		}

		// scrollable region of the content box, called from the render callback every frame.
		// top and bottom are insets from the content box edges and contentHeight is the full height of
		// what draw paints. draw(y, viewHeight) gets the y its first row belongs at with the scroll
		// already applied. the wheel and the scrollbar are handled here; set scrollY to Infinity to
		// jump to the end.

		this.scrollView = (top, bottom, contentHeight, draw)=>{
			var viewY = this.contentBox.y + top,
				viewHeight = Math.max(0, this.contentBox.height - top - bottom),
				barWidth = this.scrollBar.width,
				thumbHeight = 0,
				travel = 0;

			this.scrollMax = Math.max(0, Math.ceil(contentHeight - viewHeight));
			this.scrollPage = viewHeight;

			// interactables flagged with scrolls only react inside this region

			this.viewTop = viewY;
			this.viewBottom = viewY + viewHeight;

			if(this.scrollMax > 0){
				thumbHeight = Math.min(viewHeight, Math.max(24, viewHeight * viewHeight / contentHeight));
				travel = viewHeight - thumbHeight;

				if(this.scrollBar.pressed && travel > 0)this.scrollY = (cursor.y - this.scrollGrab - viewY) / travel * this.scrollMax;
			}

			this.scrollY = Math.min(Math.max(Number(this.scrollY) || 0, 0), this.scrollMax);

			mctx.save();
			mctx.beginPath();
			mctx.rect(this.x, viewY, this.width, viewHeight);
			mctx.clip();
			mctx.beginPath(); // roundRect fills whatever path is left lying around

			try{
				draw(viewY - this.scrollY, viewHeight);
			}finally{
				mctx.restore();
			}

			if(this.scrollMax <= 0)return;

			this.scrollBar.disabled = false;
			this.scrollBar.x = this.x + this.width - barWidth;
			this.scrollBar.y = viewY;
			this.scrollBar.height = viewHeight;

			this.scrollThumb = {y: viewY + travel * this.scrollY / this.scrollMax, height: thumbHeight};

			mctx.fillStyle = 'rgba(128, 128, 128, 0.25)';
			mctx.fillRect(this.scrollBar.x, viewY, barWidth, viewHeight);

			if(this.scrollBar.pressed)mctx.fillStyle = '#287CD5'
			else if(this.scrollBar.hover)mctx.fillStyle = '#6f6f6f'
			else mctx.fillStyle = '#8a8a8a';

			mctx.fillRect(this.scrollBar.x + 2, this.scrollThumb.y + 2, barWidth - 4, thumbHeight - 4);
		}

		this.renderFunc = ()=>{
			if(this.titleBar.pressed){
				this.x = this.postX + cursor.x - cursor.grab.x;
				this.y = this.postY + cursor.y - cursor.grab.y;
			}

			var held = this.resizable ? this.grips.find((grip)=> grip.pressed) : null,
				hot = this.resizable ? held || this.grips.find((grip)=> grip.hover) : null;

			this.resizing = held != null;

			if(held != null){
				// sizes are worked out from where the drag started, so clamping never drifts

				var from = this.resizeFrom,
					moveX = cursor.x - cursor.grab.x,
					moveY = cursor.y - cursor.grab.y;

				if(held.edges.includes('r'))this.width = Math.max(this.minWidth, from.width + moveX);

				if(held.edges.includes('l')){
					this.width = Math.min(Math.max(this.minWidth, from.width - moveX), msize.w);
					this.x = from.x + from.width - this.width;
				}

				if(held.edges.includes('b'))this.height = Math.max(this.minHeight, from.height + moveY);
			}

			if(hot != null)cursor.img = gripCursors[hot.edges];

			this.fitDesktop();

			if(!this.titleBar.pressed){
				this.postX = this.x;
				this.postY = this.y;
			}

			this.titleBar.x = this.x

			this.titleBar.y = this.y

			this.titleBar.width = this.width

			this.contentBox.x = this.x

			this.contentBox.y = this.y + this.titleBar.height

			// ends where the drawn frame ends, it used to reach 10px below it

			this.contentBox.height = Math.max(0, this.height - 10)

			this.contentBox.width = this.width

			// grips sit 2px inside the frame and gripReach outside of it, corners take the last 12px of an edge

			var frameBottom = this.y + this.height + 20;

			this.grips.forEach((grip,i)=>{
				var corner = grip.edges.length === 2;

				grip.disabled = !this.resizable;

				if(grip.edges.includes('l'))grip.x = this.x - gripReach
				else if(grip.edges.includes('r'))grip.x = this.x + this.width - (corner ? 12 : 2)
				else grip.x = this.x + 12;

				grip.y = corner ? frameBottom - 12 : grip.edges === 'b' ? frameBottom - 2 : this.y + 10;

				grip.width = corner ? 12 + gripReach : grip.edges === 'b' ? this.width - 24 : 2 + gripReach;
				grip.height = corner ? 12 + gripReach : grip.edges === 'b' ? 2 + gripReach : frameBottom - 12 - grip.y;
			});

			// content box

			mctx.fillStyle = '#000';
			mctx.shadowColor = '#000';
			mctx.strokeStyle='#000';
			mctx.shadowBlur = 7;

			mctx.roundRect(this.x, this.y, this.width, this.height + this.titleBar.height / 1.5, 15);

			mctx.shadowBlur = 0;

			mctx.fillStyle=this.bgColor;
			mctx.strokeStyle=this.bgColor;
			mctx.roundRect(this.x, this.y + this.titleBar.height - 10, this.width, this.height, 15);

			// window bar

			mctx.fillStyle='#404040';
			mctx.strokeStyle='#404040';

			mctx.roundRect(this.x, this.y, this.width, this.titleBar.height, 15);
			mctx.fillRect(this.x, this.y + this.titleBar.height/2, this.titleBar.width, 15);

			// title

			mctx.fillStyle='#fff';
			mctx.font = "14px Open Sans";
			mctx.fillText(this.title, this.titleBar.x + 40 , this.titleBar.y +  20 );

			// icon

			mctx.drawImageURL('tango/' + this.icon, this.titleBar.x + 12, this.titleBar.y + 6, 20, 20);

			// close stuff :(

			this.closeButton.x = this.titleBar.x + this.titleBar.width - this.titleBar.height;

			this.closeButton.y = this.titleBar.y + 5;

			if(!this.closeButton.hover && !this.closeButton.pressed){
				mctx.drawImageURL('tango/window/close_idle.png', this.closeButton.x, this.closeButton.y, this.closeButton.width, this.closeButton.height)
			}else if(this.closeButton.hover && !this.closeButton.pressed){
				mctx.drawImageURL('tango/window/close_hover.png', this.closeButton.x, this.closeButton.y, this.closeButton.width, this.closeButton.height)
			}else if(this.closeButton.pressed){
				mctx.drawImageURL('tango/window/close_press.png', this.closeButton.x, this.closeButton.y, this.closeButton.width, this.closeButton.height)
			}

			// scrollView() switches these back on when the app asks for a scroll region this frame

			this.scrollMax = 0;
			this.scrollBar.disabled = true;

			// app content is clipped to the frame and gets its own canvas state, so overflowing text or a
			// leftover textAlign cannot spill onto the rest of the desktop

			mctx.save();
			mctx.beginPath();
			mctx.rect(this.x, this.y, this.width, this.height + 20);
			mctx.clip();
			mctx.beginPath(); // roundRect fills whatever path is left lying around

			try{
				afterRender(this);
			}catch(err){
				// a broken app must not take the taskbar and every window above it down with it

				if(!this.failed)console.error(err);

				this.failed = true;
			}

			mctx.restore();

			// corner mark for windows that can be resized

			if(this.resizable){
				mctx.strokeStyle = 'rgba(128, 128, 128, 0.7)';
				mctx.lineWidth = 1;
				mctx.beginPath();

				[4, 8, 12].forEach((n,i)=>{
					mctx.moveTo(this.x + this.width - 3 - n, frameBottom - 3);
					mctx.lineTo(this.x + this.width - 3, frameBottom - 3 - n);
				});

				mctx.stroke();
				mctx.beginPath(); // roundRect fills whatever path is left lying around
			}
		}

		this.whichRenq.push(this.renderFunc);

		cwindows.push(this);

		// a new window opens on top, so it takes the focus as well

		cursor.focus = this.contentBox.id;
	}
}

var trackCursor = (e)=>{
		// measured from the overlay so it also works for events that land outside of it
		var box = overlay.getBoundingClientRect();

		cursor.x = e.clientX - box.left;
		cursor.y = e.clientY - box.top;

		cursor.inside = cursor.x >= 0 && cursor.y >= 0 && cursor.x <= msize.w && cursor.y <= msize.h;
	},
	updateHover = ()=>{
		var top = null;

		if(cursor.inside){
			Object.values(interactables).forEach((entry,i)=>{
				if(entry.disabled == true)return; // ignore disabled elements

				if(entry.drawn != null && entry.drawn < frame - 1)return; // a widget that is not being drawn anymore

				if(cursor.x < entry.x || cursor.x > entry.x + entry.width || cursor.y < entry.y || cursor.y > entry.y + entry.height)return;

				// a widget only reacts inside its own window frame, the same area its drawing is clipped to

				var owner = windowOf(entry);

				if(owner != null && !owner.contains(cursor.x, cursor.y, entry.reach))return;

				// part of scrolled content: not while it is scrolled out of its view

				if(owner != null && entry.scrolls == true && (cursor.y < owner.viewTop || cursor.y > owner.viewBottom))return;

				if(top == null || entry.index >= top.index)top = entry;
			});
		}

		Object.values(interactables).forEach((entry,i)=>{
			if(entry === top || !entry.hover)return;

			entry.hover = false;
			entry.hoverend();
		});

		if(top != null && !top.hover){
			top.hover = true;
			top.hoverstart();
		}

		// the interactable under the pointer, or null

		cursor.over = top;
	},
	releasePointer = (click)=>{
		// click is false when the press is abandoned (focus lost, button released out of sight):
		// the widget is let go without running its action
		cursor.down = false;

		Object.values(interactables).forEach((entry,i)=>{
			if(!entry.pressed)return;

			try{
				// pressed stays set during clickend, widgets check it
				if(click)entry.clickend();
			}finally{
				entry.pressed = false;
			}
		});
	},
	mouseMoveHandler = (e)=>{
		trackCursor(e);

		// the button was let go somewhere we never heard about (over an iframe, outside the tab)

		if(cursor.down && e.buttons === 0)releasePointer(false);

		updateHover();
	};

// moves and releases are followed on the whole page: a drag that leaves the desktop keeps
// tracking and always ends, instead of leaving the window stuck to the pointer

window.addEventListener('mousemove', mouseMoveHandler);

document.documentElement.addEventListener('mouseleave', e=>{
	cursor.inside = false;
});

overlay.addEventListener('mousedown', e=>{
	e.preventDefault();

	mouseMoveHandler(e); // incase some business happened

	// keys go to whichever document has focus, so take it back from an iframe when the desktop is clicked
	// (preventDefault above stops the browser from doing that for us)

	if(document.activeElement != null && document.activeElement.tagName === 'IFRAME')document.activeElement.blur();

	cursor.down = true;

	cursor.grab.x = cursor.x
	cursor.grab.y = cursor.y

	var entry = cursor.over,
		owner = windowOf(entry);

	if(entry == null)return;

	// a click anywhere in a window raises it. this happens before clickstart so a window opened
	// by the click still ends up on top

	if(owner != null)owner.moveToFront();

	entry.pressed = true;

	cursor.focus = entry.id;

	if(e.which == 3){ // right click
		// do right click business here
		// return
	}

	entry.clickstart(e);
});

window.addEventListener('mouseup', e=>{
	trackCursor(e);
	updateHover();

	releasePointer(true);
});

// keys and the clipboard go to the interactable that has the focus. it takes part by defining
// keydown(e), copy(), cut(), paste(text) or selectAll(). while an iframe has the focus none of
// this fires here, and the page inside it handles its own

var focusedEntry = ()=>{
		return cursor.focus != null ? interactables[cursor.focus] || null : null;
	},
	clipboardOut = (hook)=>{
		return (e)=>{
			var entry = focusedEntry(),
				text = entry != null && entry[hook] != null ? entry[hook]() : '';

			if(!text)return;

			e.clipboardData.setData('text/plain', text);
			e.preventDefault();
		};
	};

window.addEventListener('keydown', e=>{
	var entry = focusedEntry();

	if(entry == null)return;

	if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && entry.selectAll != null){
		entry.selectAll();
		e.preventDefault();
		return;
	}

	if(entry.keydown != null)entry.keydown(e);
});

window.addEventListener('copy', clipboardOut('copy'));

window.addEventListener('cut', clipboardOut('cut'));

window.addEventListener('paste', e=>{
	var entry = focusedEntry();

	if(entry == null || entry.paste == null)return;

	entry.paste(e.clipboardData.getData('text'));
	e.preventDefault();
});

overlay.addEventListener('contextmenu', e=>{
	e.preventDefault();

});

overlay.addEventListener('wheel', e=>{
	e.preventDefault();

	var owner = windowOf(cursor.over),
		step = e.deltaY;

	if(owner == null)return;

	// deltaMode 1 counts lines and 2 counts pages, turn both into pixels

	if(e.deltaMode === 1)step *= 20
	else if(e.deltaMode === 2)step *= owner.scrollPage || owner.height;

	if(owner.scrollMax > 0)owner.scrollY = Math.min(Math.max(owner.scrollY + step, 0), owner.scrollMax)
	else if(owner.onWheel != null)owner.onWheel(step);
}, {passive: false});

window.addEventListener('focus', e=>{
	mfocus = true;
});

window.addEventListener('blur', e=>{
	mfocus = false;

	// focus went to an iframe or another program, so the mouseup may never reach us
	releasePointer(false);
});

if(localStorage.getItem('background') != null){
	background = JSON.parse(localStorage.getItem('background'));
}else{
	localStorage.setItem('background', JSON.stringify(background, null, '\t') )
}

var renderFrame = ()=>{
	// one frame per screen refresh. the next one is requested first so an error below cannot stop the loop

	requestAnimationFrame(renderFrame);

	// compare the stored text, comparing the parsed object never matched and wrote to storage every frame

	if(localStorage.getItem('background') !== JSON.stringify(background)){
		localStorage.setItem('background', JSON.stringify(background));
	}

	// windows open, close and scroll under a resting pointer, so hover is resolved every frame

	frame++;

	updateHover();

	// whoever wants another pointer image (resize grips, links) sets it again while drawing

	cursor.img = 'pointer';

	if(mCanvas.getAttribute('width') != msize.w){
		mCanvas.setAttribute('width', msize.w);
		mCanvas.style.width = msize.w + 'px';
		mCanvas.style.height = msize.h + 'px';

		overlay.setAttribute('width', msize.w);
		overlay.style.width = msize.w + 'px';
		overlay.style.height = msize.h + 'px';
	}

	if(mCanvas.getAttribute('height') != msize.h){
		mCanvas.setAttribute('height', msize.h);
	}
	
	try{
		wallpaperBusiness();
	}catch(err){
		mctx.drawImageURL('tango/wallpapers/a.png', 0, 0, msize.w, msize.h);
	}
	
	if(window.innerWidth < msize.w || window.innerHeight < msize.h){ // window is smaller than the current resolution
		mctx.fillStyle = '#fff';
		mctx.fillRect(0, 0, msize.w, msize.h);

		// center text

		mctx.textAlign = 'center';

		mctx.fillStyle = '#000';
		mctx.font = '14px Open Sans';

		mctx.fillText(`Your browser window is smaller than the minimum size of ${msize.w}x${msize.h}! (the window is ${window.innerWidth}x${window.innerHeight})`, window.innerWidth / 2, window.innerHeight / 2 - 14);

		mctx.textAlign = 'start';
	}else{
		// the queues are copied so a window may close or raise itself from inside its render callback

		renq.slice().forEach((e,i)=>{
			e(); // run all render operations in order
		});

		highRenq.slice().forEach((e,i)=>{ // desktop and stuff
			e();
		});
	}

	above_high_renq.slice().forEach((e,i)=>{ // super high stuff like above display level
		e();
	});

	// RENDER CURSOR OR SET IT AFTER GOING THROUGH THE RENQ

	if(!mfocus){
		mctx.drawImageURL('tango/cursor/'+cursor.img+'.cur', cursor.x - 3, cursor.y - 4, 32, 32);
		overlay.style.cursor = 'none';
	}else{
		overlay.style.cursor = 'url("tango/cursor/'+cursor.img+'.cur"), none';
	}

};

requestAnimationFrame(renderFrame);
