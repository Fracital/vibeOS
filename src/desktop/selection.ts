// Text selection for anything that draws its text on the canvas. The owner hands over the pieces
// of text it draws (in reading order, positioned relative to an origin it sets every frame) and
// forwards the mouse; it gets the highlight and the selected text back. The markdown widget and
// the JS terminal both work this way. Copy and select-all reach the owner through the copy and
// selectAll hooks on its interactable (see the clipboard listeners in main.js).

class selection {
	constructor(){
		// items are {x, y, width, text, font, size, flow, hard, tight}: y is the baseline, pieces with
		// the same flow are one run of wrapped text, hard marks a piece that follows a forced line
		// break, and tight pieces (table cells) never get a blank line between them when copied

		this.items = [];

		this.originX = 0;

		this.originY = 0;

		// both ends as {item, char}, the anchor is where the mouse went down

		this.anchor = null;

		this.head = null;

		this.held = false;

		this.lastPress = 0;

		this.color = 'rgba(40, 124, 213, 0.35)';

		this.clear = ()=>{
			this.anchor = null;
			this.head = null;
			this.held = false;
		}

		this.setItems = (items)=>{
			// new text: positions in the old one mean nothing anymore
			this.items = items;
			this.clear();
		}

		this.measure = (item, count)=>{
			var font = mctx.font,
				wide = 0;

			mctx.font = item.font;
			wide = mctx.measureText(item.text.slice(0, count)).width;
			mctx.font = font;

			return wide;
		}

		// the position in the text closest to a point on screen, exact says the point is on the text itself

		this.locate = (x, y)=>{
			var best = null,
				score = 0,
				low = 0,
				high = 0,
				mid = 0;

			x -= this.originX;
			y -= this.originY;

			this.items.forEach((item,i)=>{
				var top = item.y - item.size,
					bottom = item.y + item.size * 0.45,
					offY = y < top ? top - y : y > bottom ? y - bottom : 0,
					offX = x < item.x ? item.x - x : x > item.x + item.width ? x - item.x - item.width : 0;

				// the nearest line wins, then the nearest piece on it

				if(best == null || offY * 1000 + offX < score){
					best = i;
					score = offY * 1000 + offX;
				}
			});

			if(best == null)return null;

			var item = this.items[best];

			if(x <= item.x)return {item: best, char: 0, exact: score === 0};
			if(x >= item.x + item.width)return {item: best, char: item.text.length, exact: score === 0};

			// the last character boundary left of the point, then round to the nearer side of that character

			high = item.text.length;

			while(low < high){
				mid = Math.ceil((low + high) / 2);

				if(this.measure(item, mid) <= x - item.x)low = mid
				else high = mid - 1;
			}

			if(low < item.text.length && x - item.x - this.measure(item, low) > (this.measure(item, low + 1) - this.measure(item, low)) / 2)low++;

			return {item: best, char: low, exact: score === 0};
		}

		// the two ends in reading order, or null while nothing is selected

		this.ordered = ()=>{
			var a = this.anchor,
				b = this.head;

			if(a == null || b == null || (a.item === b.item && a.char === b.char))return null;
			if(a.item >= this.items.length || b.item >= this.items.length)return null;

			return a.item < b.item || (a.item === b.item && a.char < b.char) ? [a, b] : [b, a];
		}

		// mouse down, mouse held (call every frame) and mouse up

		this.press = (x, y)=>{
			var at = this.locate(x, y),
				again = at != null && this.anchor != null && Date.now() - this.lastPress < 400 && at.item === this.anchor.item && Math.abs(at.char - this.anchor.char) <= 1,
				text = '',
				from = 0,
				to = 0;

			this.lastPress = Date.now();

			if(!again || !at.exact){
				this.anchor = at;
				this.head = at;
				this.held = at != null;
				return;
			}

			// a second press on the same spot picks the word under it

			text = this.items[at.item].text;
			from = at.char;
			to = at.char;

			while(from > 0 && /\S/.test(text[from - 1]))from--;
			while(to < text.length && /\S/.test(text[to]))to++;

			this.anchor = {item: at.item, char: from};
			this.head = {item: at.item, char: to};
			this.held = false;
		}

		this.drag = (x, y)=>{
			if(!this.held)return;

			var at = this.locate(x, y);

			if(at != null)this.head = at;
		}

		this.release = ()=>{
			this.held = false;
		}

		this.all = ()=>{
			if(this.items.length === 0)return;

			this.anchor = {item: 0, char: 0};
			this.head = {item: this.items.length - 1, char: this.items[this.items.length - 1].text.length};
			this.held = false;
		}

		this.text = ()=>{
			var range = this.ordered(),
				out = '',
				prev = null,
				i = 0;

			if(range == null)return '';

			for(i = range[0].item; i <= range[1].item; i++){
				var item = this.items[i],
					gap = prev == null ? 0 : item.x - (prev.x + prev.width);

				if(prev != null){
					// pieces on one line are joined by a space (a tab across a wide gap, as between
					// table cells), a wrapped run of text flows on, and anything else starts a new line

					if(Math.abs(item.y - prev.y) < 3)out += gap > 24 ? '\t' : gap > 1 ? ' ' : ''
					else if(item.flow === prev.flow && !item.hard)out += ' '
					else out += !(item.tight && prev.tight) && item.y - prev.y > Math.min(prev.size, item.size) * 2.2 ? '\n\n' : '\n';
				}

				out += item.text.slice(i === range[0].item ? range[0].char : 0, i === range[1].item ? range[1].char : item.text.length);

				prev = item;
			}

			return out;
		}

		// draws the highlight, call it before drawing the text

		this.paint = ()=>{
			var range = this.ordered(),
				i = 0;

			if(range == null)return;

			mctx.fillStyle = this.color;

			for(i = range[0].item; i <= range[1].item; i++){
				var item = this.items[i],
					from = i === range[0].item ? this.measure(item, range[0].char) : 0,
					to = i === range[1].item ? this.measure(item, range[1].char) : item.width;

				mctx.fillRect(this.originX + item.x + from, this.originY + item.y - item.size, to - from, Math.round(item.size * 1.4));
			}
		}
	}
}
