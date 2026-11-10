// Multi-line text editing on the canvas: the editor widget. One buffer of text with a caret, a
// selection, undo and the clipboard, drawn in one of two ways. Plain mode shows the text as it
// is, in a fixed-width font with line numbers. Rich mode reads the same text as markdown and
// shows it formatted (headings, bold, lists, quotes, code), with the markup hidden everywhere
// except on the line being edited. The text itself never changes between the two, so what is
// saved is always plain text. scripts/textEditor.js is the app built around it.

var editorFonts = 0,
	editorSizes = [28, 23, 19, 16, 15, 14],
	editorColors = {
		text: '#1f2328',
		muted: '#57606a',
		dim: '#a0a6ad',
		link: '#0969da',
		code: '#eef0f2',
		line: '#d0d7de',
		gutter: '#f3f4f6',
		select: 'rgba(40, 124, 213, 0.35)',
	},
	editorInline = (text, base, style, out)=>{
		// splits a line into pieces of one style each. every piece knows where it sits in the text
		// (from), and the markup characters come out as pieces of their own, flagged marker
		var i = 0,
			plain = 0,
			m = null,
			rest = '',
			open = 0,
			wordStart = false,
			piece = (from, to, extra)=>{
				if(to > from)out.push(Object.assign({}, style, extra, {from: base + from, text: text.slice(from, to)}));
			};

		while(i < text.length){
			if(!'`*_~['.includes(text[i])){
				i++;
				continue;
			}

			rest = text.slice(i);
			wordStart = i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]);

			if((m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))){
				open = m[1].length;

				piece(plain, i);
				piece(i, i + open, {marker: true});
				piece(i + open, i + open + m[2].length, {code: true});
				piece(i + open + m[2].length, i + m[0].length, {marker: true});
			}else if((m = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest))){
				piece(plain, i);
				piece(i, i + 1, {marker: true});

				editorInline(m[1], base + i + 1, Object.assign({}, style, {link: m[2]}), out);

				piece(i + 1 + m[1].length, i + m[0].length, {marker: true});
			}else if((m = /^(\*\*\*|\*\*|\*|~~)(?=\S)([\s\S]*?[^\s*~])\1(?![*~])/.exec(rest)) || (wordStart && (m = /^(__|_)(?=\S)([\s\S]*?[^\s_])\1(?![A-Za-z0-9_])/.exec(rest)))){
				open = m[1].length;

				piece(plain, i);
				piece(i, i + open, {marker: true});

				editorInline(m[2], base + i + open, Object.assign({}, style, {
					bold: style.bold || (m[1][0] !== '~' && open >= 2),
					italic: style.italic || (m[1][0] !== '~' && open % 2 === 1),
					strike: style.strike || m[1][0] === '~',
				}), out);

				piece(i + open + m[2].length, i + m[0].length, {marker: true});
			}else{
				i++;
				continue;
			}

			i += m[0].length;
			plain = i;
		}

		piece(plain, text.length);
	},
	editorLine = (text, fenced)=>{
		// what kind of markdown line this is, and how many characters of markup it starts with (lead)
		var m = null;

		if(/^\s*(```|~~~)/.test(text))return {type: 'fence'};
		if(fenced)return {type: 'code'};

		if((m = /^(#{1,6})\s+/.exec(text)))return {type: 'heading', level: m[1].length, lead: m[0].length};

		if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(text))return {type: 'rule'};

		if((m = /^(?:>\s?)+/.exec(text)))return {type: 'quote', level: m[0].split('>').length - 1, lead: m[0].length};

		if((m = /^(\s*)[-*+]\s+(\[([ xX])\]\s+)?/.exec(text))){
			return {type: m[2] != null ? 'task' : 'bullet', indent: m[1].length, lead: m[0].length, checked: m[3] != null && m[3] !== ' '};
		}

		if((m = /^(\s*)\d{1,9}[.)]\s+/.exec(text)))return {type: 'ordered', indent: m[1].length, lead: m[0].length};

		return {type: 'text'};
	};

if(document.fonts != null){
	document.fonts.addEventListener('loadingdone', ()=>{
		editorFonts++;
	});
}

class editor {
	constructor(){
		this.text = '';

		// caret is where typing goes, anchor is the other end of the selection (the same when nothing is selected)

		this.caret = 0;
		this.anchor = 0;

		this.rich = false;
		this.wrap = true; // plain mode only, rich text always wraps
		this.numbers = true; // line numbers, plain mode only
		this.zoom = 1;

		// the app's own shortcuts: onShortcut(event) returns true when it has dealt with the key

		this.onShortcut = null;

		this.undoStack = [];
		this.redoStack = [];
		this.lastKind = '';
		this.lastEdit = 0;
		this.runCaret = -1; // where the last change left the caret

		this.goal = null; // the column the caret keeps to while moving up and down
		this.reveal = false; // scroll the caret into view on the next frame
		this.moved = 0;
		this.dragging = false;
		this.lastPress = 0;
		this.pressAt = 0;
		this.presses = 0;
		this.hit = null;

		// the text broken into lines, and the lines laid out as rows on screen

		this.lines = [''];
		this.starts = [0];
		this.linesOf = '';
		this.shapes = new Map();
		this.rows = [];
		this.first = [];
		this.height = 0;
		this.stamp = '';
		this.stale = true;
		this.active = -1;

		this.padding = 12;
		this.width = 400;
		this.gutter = 0;
		this.scrollX = 0;
		this.originX = 0;
		this.originY = 0;
		this.viewHeight = 0;

		this.interactable = new interactable('editor', 0, 0,
			emptyFunction,
			emptyFunction,
			(e)=>{
				// click start: one click places the caret (shift keeps the other end), two pick the
				// word, three the line. ctrl and a click follows a link

				var at = this.offsetAt(cursor.x, cursor.y),
					line = 0,
					word = [];

				this.presses = Date.now() - this.lastPress < 400 && Math.abs(at - this.pressAt) <= 1 ? this.presses + 1 : 1;
				this.lastPress = Date.now();
				this.pressAt = at;
				this.goal = null;
				this.moved = Date.now();

				if(e != null && (e.ctrlKey || e.metaKey) && this.hit != null && this.hit.span.link != null){
					openLink(this.hit.span.link);
					return;
				}

				if(this.presses === 2){
					word = this.wordAround(at);

					this.anchor = word[0];
					this.caret = word[1];
					this.dragging = false;
				}else if(this.presses >= 3){
					line = this.lineOf(at);

					this.anchor = this.starts[line];
					this.caret = this.starts[line] + this.lines[line].length;
					this.dragging = false;
				}else{
					this.caret = at;
					this.dragging = true;

					if(e == null || !e.shiftKey)this.anchor = at;
				}
			},
			()=>{
				// click end
				this.dragging = false;
			}
		);

		this.interactable.drawn = 0; // takes input only while render() is being called

		this.measure = (text, font)=>{
			mctx.font = font;

			return mctx.measureText(text).width;
		}

		this.range = ()=>{
			this.caret = Math.min(Math.max(this.caret, 0), this.text.length);
			this.anchor = Math.min(Math.max(this.anchor, 0), this.text.length);

			return [Math.min(this.caret, this.anchor), Math.max(this.caret, this.anchor)];
		}

		this.selected = ()=>{
			var range = this.range();

			return this.text.slice(range[0], range[1]);
		}

		this.select = (from, to)=>{
			this.anchor = from;
			this.caret = to;
			this.goal = null;
			this.reveal = true;
		}

		this.focus = ()=>{
			cursor.focus = this.interactable.id;
		}

		// lines and where each one starts, redone only when the text has changed

		this.sync = ()=>{
			var at = 0;

			if(this.linesOf === this.text)return;

			this.lines = this.text.split('\n');

			this.starts = this.lines.map((line)=>{
				var start = at;

				at += line.length + 1;

				return start;
			});

			this.linesOf = this.text;
		}

		this.lineOf = (offset)=>{
			var low = 0,
				high = 0,
				mid = 0;

			this.sync();

			high = this.starts.length - 1;

			while(low < high){
				mid = Math.ceil((low + high) / 2);

				if(this.starts[mid] <= offset)low = mid
				else high = mid - 1;
			}

			return low;
		}

		// line and column of the caret, counted from one

		this.position = ()=>{
			var line = this.lineOf(this.caret);

			return {line: line + 1, column: this.caret - this.starts[line] + 1};
		}

		// ---- changing the text

		this.remember = (kind)=>{
			// one step back takes a whole run of typing (or of deleting), not a single letter. it only
			// counts as a run while it carries on right where the last change ended, with nothing selected
			var run = kind === this.lastKind && (kind === 'type' || kind === 'delete') && Date.now() - this.lastEdit < 1000 && this.caret === this.runCaret && (kind === 'delete' || this.anchor === this.caret);

			if(!run){
				this.undoStack.push({text: this.text, caret: this.caret, anchor: this.anchor});

				if(this.undoStack.length > 300)this.undoStack.shift();
			}

			this.redoStack = [];
			this.lastKind = kind;
			this.lastEdit = Date.now();
		}

		// every change to the text goes through here

		this.replace = (from, to, insert, kind)=>{
			this.remember(kind);

			this.text = this.text.slice(0, from) + insert + this.text.slice(to);

			this.caret = from + insert.length;
			this.anchor = this.caret;
			this.runCaret = this.caret;
			this.goal = null;
			this.reveal = true;
			this.stale = true;
			this.moved = Date.now();
		}

		// replaces the selection, or goes in at the caret when there is none

		this.insert = (text, kind)=>{
			var range = this.range();

			this.replace(range[0], range[1], text, kind || 'edit');
		}

		this.restore = (step, other)=>{
			if(step == null)return;

			other.push({text: this.text, caret: this.caret, anchor: this.anchor});

			this.text = step.text;
			this.caret = step.caret;
			this.anchor = step.anchor;
			this.lastKind = '';
			this.goal = null;
			this.reveal = true;
			this.stale = true;
		}

		this.undo = ()=>{
			this.restore(this.undoStack.pop(), this.redoStack);
		}

		this.redo = ()=>{
			this.restore(this.redoStack.pop(), this.undoStack);
		}

		this.setText = (text)=>{
			this.text = String(text).replace(/\r\n?/g, '\n');
			this.caret = 0;
			this.anchor = 0;
			this.undoStack = [];
			this.redoStack = [];
			this.lastKind = '';
			this.goal = null;
			this.reveal = true;
			this.stale = true;
		}

		// ---- words, and the markdown the format commands write

		this.wordAround = (at)=>{
			var from = at,
				to = at;

			while(from > 0 && /\w/.test(this.text[from - 1]))from--;
			while(to < this.text.length && /\w/.test(this.text[to]))to++;

			return [from, to];
		}

		this.wordLeft = (at)=>{
			var text = this.text;

			while(at > 0 && /\s/.test(text[at - 1]))at--;

			if(at > 0 && /\w/.test(text[at - 1])){
				while(at > 0 && /\w/.test(text[at - 1]))at--;
			}else{
				while(at > 0 && /[^\w\s]/.test(text[at - 1]))at--;
			}

			return at;
		}

		this.wordRight = (at)=>{
			var text = this.text;

			while(at < text.length && /\s/.test(text[at]))at++;

			if(at < text.length && /\w/.test(text[at])){
				while(at < text.length && /\w/.test(text[at]))at++;
			}else{
				while(at < text.length && /[^\w\s]/.test(text[at]))at++;
			}

			return at;
		}

		// puts a pair of marks (** for bold, * for italic, ~~, `) around the selection or the word
		// under the caret, or takes them off again when they are already there

		this.mark = (sign)=>{
			var range = this.range(),
				size = sign.length,
				text = this.text,
				stars = 0,
				has = false;

			if(range[0] === range[1])range = this.wordAround(range[0]);

			if(range[0] === range[1]){
				// nothing to put them around: an empty pair with the caret inside
				this.replace(range[0], range[1], sign + sign, 'format');
				this.caret = range[0] + size;
				this.anchor = this.caret;
				return;
			}

			if(sign[0] === '*'){
				// one star is italic, two bold, three both
				while(text[range[0] - 1 - stars] === '*')stars++;

				has = (size === 1 ? stars % 2 === 1 : stars >= 2) && text.slice(range[1], range[1] + size) === sign;
			}else{
				has = text.slice(range[0] - size, range[0]) === sign && text.slice(range[1], range[1] + size) === sign;
			}

			if(has){
				this.replace(range[0] - size, range[1] + size, text.slice(range[0], range[1]), 'format');
				this.anchor = range[0] - size;
				this.caret = range[1] - size;
			}else{
				this.replace(range[0], range[1], sign + text.slice(range[0], range[1]) + sign, 'format');
				this.anchor = range[0] + size;
				this.caret = range[1] + size;
			}
		}

		// gives every selected line the same start: '# ' for a heading, '- ' for a list, '1. ' for a
		// numbered one, '> ' for a quote, '' for plain text. asking for what is already there removes it

		this.block = (prefix)=>{
			var range = this.range(),
				first = this.lineOf(range[0]),
				last = this.lineOf(range[1]),
				strip = /^(\s*)(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+|(?:>\s?)+)?/,
				want = (i)=> prefix === '1. ' ? (i + 1) + '. ' : prefix,
				part = this.lines.slice(first, last + 1),
				same = prefix !== '' && part.every((line,i)=> line.replace(/^\s*/, '').startsWith(want(i)));

			part = part.map((line,i)=>{
				var m = strip.exec(line);

				return m[1] + (same ? '' : want(i)) + line.slice(m[0].length);
			});

			this.replace(this.starts[first], this.starts[last] + this.lines[last].length, part.join('\n'), 'format');

			this.anchor = this.starts[first];
			this.caret = this.starts[first] + part.join('\n').length;
		}

		this.newline = ()=>{
			// the new line starts like the one before it: the same indent, and in rich mode the next
			// list item or the quote going on. Enter on an empty item ends the list instead
			var range = this.range(),
				line = this.lineOf(range[0]),
				before = this.text.slice(this.starts[line], range[0]),
				m = /^(\s*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d{1,9})([.)])\s+|((?:>\s?)+))?/.exec(before),
				lead = m[1];

			if(this.rich && m[0].length > m[1].length){
				if(range[0] === range[1] && before.length === m[0].length && this.lines[line].length === before.length){
					this.replace(this.starts[line], range[0], '', 'edit');
					return;
				}

				if(m[2] != null)lead = m[1] + m[2] + ' ' + (m[3] != null ? '[ ] ' : '')
				else if(m[4] != null)lead = m[1] + (parseInt(m[4], 10) + 1) + m[5] + ' '
				else lead = m[6];
			}

			this.insert('\n' + lead, 'edit');
		}

		this.outdent = ()=>{
			var line = this.lineOf(this.caret),
				m = /^(\t| {1,4})/.exec(this.lines[line]),
				caret = this.caret;

			if(m == null)return;

			this.replace(this.starts[line], this.starts[line] + m[0].length, '', 'edit');

			this.caret = Math.max(this.starts[line], caret - m[0].length);
			this.anchor = this.caret;
		}

		// ---- layout: lines into rows of positioned pieces

		this.shape = (text, info, active, width)=>{
			// one line of text as the rows it takes on screen. offsets in here count from the start of the line
			var colors = editorColors,
				size = Math.round((this.rich ? 15 : 14) * this.zoom),
				lead = info.lead || 0,
				deco = {},
				base = {},
				spans = [],
				inline = [],
				rows = [],
				row = null,
				indent = 0,
				hang = 0,
				x = 0,
				limit = this.rich || this.wrap ? Math.max(80, width) : Infinity,
				lineHeight = 0,
				dress = (span)=>{
					span.size = span.code ? size - 1 : size;
					span.font = (span.italic ? 'italic ' : '') + (span.bold ? 'bold ' : '') + span.size + 'px ' + (span.code || span.mono ? 'Roboto Mono' : 'Open Sans');
					span.color = span.marker ? colors.dim : span.link != null ? colors.link : base.color || colors.text;

					if(span.length == null)span.length = span.text.length;

					return span;
				},
				open = (from)=>{
					row = {from: from, to: from, end: from, start: x, segs: [], height: lineHeight, size: size, deco: deco};

					rows.push(row);
				},
				put = (span, at, text, wide, whole)=>{
					var last = row.segs[row.segs.length - 1];

					// pieces of one span that follow each other are drawn as a single piece of text

					if(!whole && last != null && last.span === span && !last.whole && last.from + last.length === span.from + at){
						last.text += text;
						last.length += text.length;
						last.width += wide;
					}else{
						row.segs.push({span: span, from: span.from + at, length: whole ? whole : text.length, text: text, x: x, width: wide, whole: whole != null});
					}

					x += wide;
					row.to = span.from + at + (whole ? whole : text.length);

					if(whole || /\S/.test(text))row.end = span.from + at + (whole ? whole : text.replace(/ +$/, '').length);
				};

			if(!this.rich){
				spans.push(dress({from: 0, text: text, mono: true}));
			}else if(info.type === 'code' || info.type === 'fence'){
				deco.code = true;

				spans.push(dress({from: 0, text: text, mono: true, marker: info.type === 'fence'}));
			}else{
				if(info.type === 'heading'){
					size = Math.round(editorSizes[info.level - 1] * this.zoom);
					base.bold = true;
				}

				if(info.type === 'quote'){
					indent = 18 * info.level;
					deco.quote = info.level;
					base.color = colors.muted;
				}

				if(info.type === 'rule' && !active){
					// a line across instead of the dashes
					deco.rule = true;
				}else if(info.type === 'rule'){
					spans.push(dress({from: 0, text: text, marker: true}));
				}else{
					// the markup a line starts with. on the line being edited it is shown as typed,
					// elsewhere headings and quotes drop it, and list items get a bullet or a box for it

					if(lead > 0 && (active || info.type === 'ordered')){
						spans.push(dress({from: 0, text: text.slice(0, lead), marker: info.type !== 'ordered', hang: info.type !== 'heading' && info.type !== 'quote'}));
					}else if(info.type === 'bullet' || info.type === 'task'){
						if(info.indent > 0)spans.push(dress({from: 0, text: text.slice(0, info.indent)}));

						if(info.type === 'bullet')spans.push(dress({from: info.indent, length: lead - info.indent, text: '•  ', whole: true, hang: true}))
						else spans.push(dress({from: info.indent, length: lead - info.indent, text: '', whole: true, box: true, checked: info.checked, wide: Math.round(size * 1.5), hang: true}));
					}

					editorInline(text.slice(lead), lead, base, inline);

					inline.forEach((span,i)=>{
						// markup inside the line only shows while the line is being edited
						if(span.marker && !active)return;

						spans.push(dress(span));
					});
				}
			}

			lineHeight = Math.round(size * (this.rich ? 1.6 : 1.45));
			x = indent;

			open(0);

			spans.forEach((span,i)=>{
				var cell = span.mono ? this.measure('M', span.font) : 0,
					pattern = /\t|[^\t ]+ *| +/g,
					widths = (text)=>{
						// the width of a word with and without the spaces that trail it
						var solid = text.replace(/ +$/, '');

						if(cell > 0)return [text.length * cell, solid.length * cell];

						return [this.measure(text, span.font), solid.length === text.length ? this.measure(text, span.font) : this.measure(solid, span.font)];
					},
					m = null,
					chunk = '',
					at = 0,
					wide = [],
					fit = 0,
					stop = 0;

				if(span.whole){
					stop = span.wide || this.measure(span.text, span.font);

					put(span, 0, span.text, stop, span.length);

					if(span.hang)hang = x;

					return;
				}

				while((m = pattern.exec(span.text))){
					chunk = m[0];
					at = m.index;

					if(chunk === '\t'){
						// a tab runs on to the next multiple of four characters
						stop = (cell || this.measure(' ', span.font)) * 4;

						put(span, at, '', stop - ((x - indent) % stop), 1);
						continue;
					}

					wide = widths(chunk);

					if(x + wide[1] > limit && x > row.start){
						x = hang || indent;
						open(span.from + at);
					}

					// a single word wider than the whole row is cut wherever it has to be

					while(x + wide[1] > limit && chunk.replace(/ +$/, '').length > 1){
						fit = cell > 0 ? Math.floor((limit - x) / cell) : Math.floor(chunk.length * (limit - x) / wide[1]);

						while(cell === 0 && fit > 1 && this.measure(chunk.slice(0, fit), span.font) > limit - x)fit--;

						fit = Math.max(1, Math.min(fit, chunk.replace(/ +$/, '').length - 1));

						put(span, at, chunk.slice(0, fit), widths(chunk.slice(0, fit))[0]);

						chunk = chunk.slice(fit);
						at += fit;

						x = hang || indent;
						open(span.from + at);

						wide = widths(chunk);
					}

					put(span, at, chunk, wide[0]);
				}

				if(span.hang)hang = x;
			});

			// the last row answers for everything up to the end of the line, hidden markup included

			row.to = text.length;
			row.end = text.length;

			return rows;
		}

		this.layout = (width)=>{
			var mono = Math.round(14 * this.zoom) + 'px Roboto Mono',
				active = -1,
				stamp = '',
				inner = 0,
				fenced = false,
				y = 0;

			this.sync();

			if(this.rich && cursor.focus == this.interactable.id)active = this.lineOf(this.caret);

			this.gutter = !this.rich && this.numbers ? Math.ceil(this.measure('0', mono) * (String(this.lines.length).length + 2)) : 0;

			inner = width - this.gutter - this.padding * 2;

			// anything that changes how a line is shaped throws the shaped lines away

			stamp = [this.rich, this.wrap, this.zoom, inner, editorFonts].join('|');

			if(stamp !== this.stamp){
				this.shapes.clear();
				this.stamp = stamp;
				this.stale = true;
			}

			if(!this.stale && active === this.active)return;

			this.rows = [];
			this.first = [];

			this.lines.forEach((text,i)=>{
				var info = this.rich ? editorLine(text, fenced) : {type: 'text'},
					key = (i === active ? 'a' : 'i') + (fenced ? 'f' : 'n') + text,
					shape = this.shapes.get(key);

				if(info.type === 'fence')fenced = !fenced;

				// lines are shaped once and looked up by what they say, so typing in one line does not
				// measure all the others again

				if(shape == null){
					if(this.shapes.size > 20000)this.shapes.clear();

					shape = this.shape(text, info, i === active, inner);

					this.shapes.set(key, shape);
				}

				this.first.push(this.rows.length);

				shape.forEach((row,ii)=>{
					this.rows.push({y: y, line: i, base: this.starts[i], shape: row});

					y += row.height;
				});
			});

			this.height = y;
			this.active = active;
			this.stale = false;
		}

		this.rowAt = (y)=>{
			var low = 0,
				high = this.rows.length - 1,
				mid = 0;

			while(low < high){
				mid = Math.ceil((low + high) / 2);

				if(this.rows[mid].y <= y)low = mid
				else high = mid - 1;
			}

			return low;
		}

		// where inside a piece a position falls, in pixels from the left of the piece

		this.within = (seg, count)=>{
			if(seg.whole)return count <= 0 ? 0 : seg.width;

			return this.measure(seg.text.slice(0, count), seg.span.font);
		}

		// the row and the pixel position of a place in the text

		this.place = (offset)=>{
			var line = 0,
				rel = 0,
				i = 0,
				last = 0,
				shape = null,
				x = 0;

			// several keys can arrive between two frames, the rows have to match the text they are asked about

			if(this.stale)this.layout(this.width);

			line = this.lineOf(offset);
			rel = offset - this.starts[line];
			i = this.first[line];
			last = line + 1 < this.first.length ? this.first[line + 1] - 1 : this.rows.length - 1;

			// in a wrapped line the caret at a break belongs to the start of the next row

			while(i < last && rel >= this.rows[i + 1].shape.from)i++;

			shape = this.rows[i].shape;
			x = shape.start;

			shape.segs.some((seg,ii)=>{
				if(rel < seg.from){
					x = seg.x;
					return true;
				}

				x = seg.x + this.within(seg, Math.min(rel - seg.from, seg.length));

				return rel <= seg.from + seg.length;
			});

			return {index: i, x: x, y: this.rows[i].y, height: shape.height};
		}

		// the place in a row closest to a pixel position

		this.relAt = (row, x)=>{
			var shape = row.shape,
				rel = shape.end,
				low = 0,
				high = 0,
				mid = 0;

			this.hit = null;

			shape.segs.some((seg,i)=>{
				if(x < seg.x){
					rel = seg.from;
					return true;
				}

				if(x >= seg.x + seg.width)return false;

				this.hit = seg;

				if(seg.whole){
					rel = x < seg.x + seg.width / 2 ? seg.from : seg.from + seg.length;
					return true;
				}

				// the last character boundary left of the point, then round to the nearer side

				high = seg.text.length;

				while(low < high){
					mid = Math.ceil((low + high) / 2);

					if(this.within(seg, mid) <= x - seg.x)low = mid
					else high = mid - 1;
				}

				if(low < seg.text.length && x - seg.x - this.within(seg, low) > (this.within(seg, low + 1) - this.within(seg, low)) / 2)low++;

				rel = seg.from + low;

				return true;
			});

			return rel;
		}

		this.offsetAt = (x, y)=>{
			var row = null;

			if(this.stale)this.layout(this.width);

			row = this.rows[this.rowAt(y - this.originY)];

			if(row == null)return 0;

			return row.base + this.relAt(row, x - this.originX);
		}

		// the caret some rows up or down, keeping to the column it started from

		this.vertical = (rows)=>{
			var from = this.place(this.caret),
				to = Math.min(this.rows.length - 1, Math.max(0, from.index + rows));

			if(this.goal == null)this.goal = from.x;

			if(to === from.index)return rows < 0 ? 0 : this.text.length;

			return this.rows[to].base + this.relAt(this.rows[to], this.goal);
		}

		// ---- keys and the clipboard arrive here while the editor has the focus (see main.js)

		this.interactable.keydown = (e)=>{
			var ctrl = e.ctrlKey || e.metaKey,
				shift = e.shiftKey,
				range = this.range(),
				here = null,
				to = null,
				keep = false;

			this.sync();

			if(ctrl){
				switch(e.key.toLowerCase()){
					case 'z':
						if(shift)this.redo()
						else this.undo();
						break
					case 'y':
						this.redo();
						break
					case 'b':
						this.mark('**');
						break
					case 'i':
						this.mark('*');
						break
					case 'arrowleft':
						to = this.wordLeft(this.caret);
						break
					case 'arrowright':
						to = this.wordRight(this.caret);
						break
					case 'home':
						to = 0;
						break
					case 'end':
						to = this.text.length;
						break
					case 'backspace':
						if(range[0] === range[1])this.anchor = this.wordLeft(this.caret);
						this.insert('', 'edit');
						break
					case 'delete':
						if(range[0] === range[1])this.anchor = this.wordRight(this.caret);
						this.insert('', 'edit');
						break
					default:
						// saving, opening and finding belong to the app. copy, cut and paste are not
						// handled here at all: they come in through their own hooks below

						if(this.onShortcut == null || !this.onShortcut(e))return;
				}
			}else{
				switch(e.key){
					case 'ArrowLeft':
						to = shift || range[0] === range[1] ? Math.max(0, this.caret - 1) : range[0];
						break
					case 'ArrowRight':
						to = shift || range[0] === range[1] ? Math.min(this.text.length, this.caret + 1) : range[1];
						break
					case 'ArrowUp':
						to = this.vertical(-1);
						keep = true;
						break
					case 'ArrowDown':
						to = this.vertical(1);
						keep = true;
						break
					case 'PageUp':
						to = this.vertical(-Math.max(1, Math.floor(this.viewHeight / 22) - 1));
						keep = true;
						break
					case 'PageDown':
						to = this.vertical(Math.max(1, Math.floor(this.viewHeight / 22) - 1));
						keep = true;
						break
					case 'Home':
						here = this.rows[this.place(this.caret).index];
						to = here.base + here.shape.from;
						break
					case 'End':
						here = this.rows[this.place(this.caret).index];
						to = here.base + here.shape.end;
						break
					case 'Backspace':
						// single characters in a row are one step back, a deleted selection is a step of its own

						if(range[0] === range[1]){
							this.anchor = Math.max(0, this.caret - 1);
							this.insert('', 'delete');
						}else{
							this.insert('', 'edit');
						}
						break
					case 'Delete':
						if(range[0] === range[1]){
							this.anchor = Math.min(this.text.length, this.caret + 1);
							this.insert('', 'delete');
						}else{
							this.insert('', 'edit');
						}
						break
					case 'Enter':
						this.newline();
						break
					case 'Tab':
						if(shift)this.outdent()
						else this.insert('\t', 'type');
						break
					case 'Escape':
						this.anchor = this.caret;
						break
					default:
						if(e.key.length !== 1)return; // not a character (F keys and the like)

						this.insert(e.key, 'type');
						break
				}
			}

			if(to != null){
				this.caret = to;

				if(!shift)this.anchor = to;

				if(!keep)this.goal = null;

				this.reveal = true;
				this.moved = Date.now();
			}

			e.preventDefault();
		}

		this.interactable.copy = ()=>{
			return this.selected();
		}

		this.interactable.cut = ()=>{
			var text = this.selected();

			if(text !== '')this.insert('', 'edit');

			return text;
		}

		this.interactable.paste = (text)=>{
			this.insert(text.replace(/\r\n?/g, '\n'), 'edit');
		}

		this.interactable.selectAll = ()=>{
			this.anchor = 0;
			this.caret = this.text.length;
		}

		// ---- drawing. the caller renders, like the other widgets: top and bottom are how much of
		// the window's content box is taken by its own bars

		this.render = (window, top, bottom)=>{
			var colors = editorColors,
				box = this.interactable,
				focused = cursor.focus == box.id,
				width = window.width - window.scrollBar.width,
				viewTop = 0,
				range = this.range(),
				spot = null,
				inner = 0;

			top = top || 0;
			bottom = bottom || 0;

			viewTop = window.contentBox.y + top;

			this.width = width;
			this.viewHeight = Math.max(0, window.contentBox.height - top - bottom);

			box.drawn = frame;
			box.index = window.contentBox.index + 1;
			box.x = window.x;
			box.y = viewTop;
			box.width = width;
			box.height = this.viewHeight;

			if(box.hover)cursor.img = 'text';

			this.layout(width);

			inner = width - this.gutter - this.padding * 2;

			// a drag moves the caret with the pointer, and scrolls when it leaves the view

			if(box.pressed && this.dragging){
				this.caret = this.offsetAt(cursor.x, cursor.y);

				if(cursor.y < viewTop)window.scrollY -= 14
				else if(cursor.y > viewTop + this.viewHeight)window.scrollY += 14;

				this.layout(width);

				range = this.range();
			}

			spot = this.place(this.caret);

			if(this.reveal){
				if(spot.y < window.scrollY)window.scrollY = spot.y
				else if(spot.y + spot.height + this.padding * 2 > window.scrollY + this.viewHeight)window.scrollY = spot.y + spot.height + this.padding * 2 - this.viewHeight;

				this.reveal = false;
			}

			// without wrapping a long line runs off to the right, and the view follows the caret along it

			if(this.rich || this.wrap)this.scrollX = 0
			else this.scrollX = Math.max(spot.x - inner + 20, Math.min(this.scrollX, spot.x));

			window.scrollView(top, bottom, this.height + this.padding * 2, (y, viewHeight)=>{
				var left = window.x + this.gutter + this.padding,
					i = this.rowAt(window.scrollY - this.padding),
					row = null,
					shape = null,
					rowY = 0,
					baseline = 0,
					start = 0,
					last = false;

				this.originX = left - this.scrollX;
				this.originY = y + this.padding;

				mctx.save();
				mctx.beginPath();
				mctx.rect(window.x + this.gutter, viewTop, width - this.gutter, viewHeight);
				mctx.clip();
				mctx.beginPath(); // roundRect fills whatever path is left lying around

				for(; i < this.rows.length; i++){
					row = this.rows[i];
					shape = row.shape;
					rowY = this.originY + row.y;
					baseline = rowY + Math.round(shape.height / 2 + shape.size * 0.36);
					start = row.base + shape.from;
					last = shape.to === this.lines[row.line].length;

					if(rowY > viewTop + viewHeight)break;

					// what belongs to the kind of line: the block behind code, the bars of a quote, the line of a rule

					if(shape.deco.code){
						mctx.fillStyle = colors.code;
						mctx.fillRect(left - 6, rowY, inner + 12, shape.height);
					}

					if(shape.deco.quote){
						mctx.fillStyle = colors.line;

						for(var n = 0; n < shape.deco.quote; n++)mctx.fillRect(left + n * 18, rowY, 4, shape.height);
					}

					if(shape.deco.rule){
						mctx.fillStyle = colors.line;
						mctx.fillRect(left, rowY + Math.round(shape.height / 2) - 1, inner, 2);
					}

					// the selected part of the row, and a sliver past its end when the line break is selected too

					if(range[0] !== range[1] && range[1] > start && range[0] <= row.base + shape.to){
						mctx.fillStyle = colors.select;

						shape.segs.forEach((seg,ii)=>{
							var from = Math.max(range[0], row.base + seg.from) - row.base - seg.from,
								to = Math.min(range[1], row.base + seg.from + seg.length) - row.base - seg.from;

							if(from >= to)return;

							mctx.fillRect(this.originX + seg.x + this.within(seg, from), rowY, this.within(seg, to) - this.within(seg, from), shape.height);
						});

						if(last && range[1] > row.base + shape.to && range[0] <= row.base + shape.to){
							mctx.fillRect(this.originX + (shape.segs.length > 0 ? shape.segs[shape.segs.length - 1].x + shape.segs[shape.segs.length - 1].width : shape.start), rowY, 6, shape.height);
						}
					}

					shape.segs.forEach((seg,ii)=>{
						var span = seg.span,
							px = this.originX + seg.x;

						if(span.box){
							// the box of a task
							mctx.fillStyle = colors.muted;
							mctx.fillRect(px, baseline - 11, 13, 13);
							mctx.fillStyle = '#fff';
							mctx.fillRect(px + 1, baseline - 10, 11, 11);

							if(span.checked){
								mctx.fillStyle = colors.link;
								mctx.fillRect(px + 3, baseline - 8, 7, 7);
							}

							return;
						}

						if(seg.text === '')return;

						if(span.code && !span.mono){
							mctx.fillStyle = colors.code;
							mctx.fillRect(px - 2, baseline - span.size, seg.width + 4, span.size + 6);
						}

						mctx.font = span.font;
						mctx.fillStyle = span.color;
						mctx.fillText(seg.text, px, baseline);

						if(span.link != null && !span.marker)mctx.fillRect(px, baseline + 2, seg.width, 1);

						if(span.strike && !span.marker)mctx.fillRect(px, baseline - Math.round(span.size * 0.3), seg.width, 1);
					});
				}

				// the caret, steady right after it moved and blinking once it rests

				if(focused && (Date.now() - this.moved) % 1000 < 500){
					mctx.fillStyle = colors.text;
					mctx.fillRect(Math.round(this.originX + spot.x), this.originY + spot.y + 2, 1.5, spot.height - 4);
				}

				mctx.restore();

				if(this.gutter === 0)return;

				// line numbers, one for the first row of each line

				mctx.fillStyle = colors.gutter;
				mctx.fillRect(window.x, viewTop, this.gutter, viewHeight);

				mctx.font = Math.round(13 * this.zoom) + 'px Roboto Mono';
				mctx.textAlign = 'end';

				for(i = this.rowAt(window.scrollY - this.padding); i < this.rows.length; i++){
					row = this.rows[i];
					rowY = this.originY + row.y;

					if(rowY > viewTop + viewHeight)break;

					if(row.shape.from !== 0)continue;

					mctx.fillStyle = row.line === this.lineOf(this.caret) ? colors.text : colors.dim;
					mctx.fillText(row.line + 1, window.x + this.gutter - 8, rowY + Math.round(row.shape.height / 2 + row.shape.size * 0.36));
				}

				mctx.textAlign = 'start';
			});
		}
	}
}
