// Markdown on the canvas. markdownParse() turns text into blocks, markdownLayout() measures and
// places them for a given width, and the markdown widget draws that inside a window's scrollView
// and follows clicks on links. initMarkdownViewer() is the app built on top of it.
//
// Supported: headings (# and underlined), paragraphs, bold, italic, strikethrough, inline code,
// fenced code blocks, > quotes (nested), bullet, numbered and task lists (nested), tables with
// column alignment, horizontal rules, images, links, bare URLs and <autolinks>.

var markdownColors = {
		text: '#24292f',
		muted: '#57606a',
		link: '#0969da',
		code: '#eef0f2',
		line: '#d0d7de',
		head: '#f6f8fa',
	},
	markdownEntities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' '},
	// counts web fonts arriving: text measured before its font had loaded has the wrong width
	markdownFonts = 0,
	markdownPatterns = {
		fence: /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/,
		heading: /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/,
		rule: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
		quote: /^ {0,3}>\s?/,
		item: /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/,
		tableRule: /^ *\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/,
	},
	markdownSlug = (text)=>{
		// the same anchors GitHub makes, so #links written for it work here
		return text.toLowerCase().trim().replace(/[^\w\- ]+/g, '').replace(/ /g, '-');
	},
	markdownInline = (text, style)=>{
		var runs = [],
			plain = '',
			i = 0,
			m = null,
			rest = '',
			wordStart = false,
			flush = ()=>{
				if(plain !== '')runs.push(Object.assign({}, style, {text: plain}));
				plain = '';
			},
			nest = (inner, extra)=>{
				flush();

				markdownInline(inner, Object.assign({}, style, extra)).forEach((run,ii)=>{
					runs.push(run);
				});
			};

		style = style || {};

		while(i < text.length){
			// most characters are plain text, only these can start something

			if(!'\\`![<*_~&h \n'.includes(text[i])){
				plain += text[i];
				i++;
				continue;
			}

			rest = text.slice(i);
			wordStart = i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]);

			if((m = /^\\([!-\/:-@\[-`{-~])/.exec(rest))){
				plain += m[1];
			}else if((m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))){
				flush();
				runs.push(Object.assign({}, style, {text: m[2].replace(/\n/g, ' ').trim(), code: true}));
			}else if((m = /^!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/.exec(rest))){
				flush();
				runs.push({image: m[2], alt: m[1], href: style.href});
			}else if((m = /^\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?([^\s)>]*)>?(?:\s+["'][^"']*["'])?\s*\)/.exec(rest))){
				nest(m[1], {href: m[2]});
			}else if((m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(rest))){
				flush();
				runs.push(Object.assign({}, style, {text: m[1].replace(/^mailto:/, ''), href: m[1]}));
			}else if((m = /^<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/.exec(rest))){
				flush();
				runs.push(Object.assign({}, style, {text: m[1], href: 'mailto:' + m[1]}));
			}else if(style.href == null && wordStart && (m = /^https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/.exec(rest))){
				flush();
				runs.push(Object.assign({}, style, {text: m[0], href: m[0]}));
			}else if((m = /^<br\s*\/?>/i.exec(rest)) || (m = /^(?: {2,}|\\)\n/.exec(rest))){
				flush();
				runs.push({br: true});
			}else if((m = /^\*\*\*(?=\S)([\s\S]*?[^\s*])\*\*\*/.exec(rest))){
				nest(m[1], {bold: true, italic: true});
			}else if((m = /^\*\*(?=\S)([\s\S]*?[^\s*])\*\*(?!\*)/.exec(rest))){
				nest(m[1], {bold: true});
			}else if((m = /^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/.exec(rest))){
				nest(m[1], {italic: true});
			}else if(wordStart && (m = /^__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9])/.exec(rest))){
				nest(m[1], {bold: true});
			}else if(wordStart && (m = /^_(?=[^\s_])([\s\S]*?[^\s_])_(?![A-Za-z0-9_])/.exec(rest))){
				nest(m[1], {italic: true});
			}else if((m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))){
				nest(m[1], {strike: true});
			}else if((m = /^&(#x[0-9a-f]+|#\d+|[a-z]+);/i.exec(rest)) && (m[1][0] === '#' || markdownEntities[m[1].toLowerCase()] != null)){
				if(m[1][0] !== '#')plain += markdownEntities[m[1].toLowerCase()]
				else plain += String.fromCodePoint(/^#x/i.test(m[1]) ? parseInt(m[1].slice(2), 16) : parseInt(m[1].slice(1), 10));
			}else{
				// a line break inside a paragraph is just a space
				plain += text[i] === '\n' ? ' ' : text[i];
				i++;
				continue;
			}

			i += m[0].length;
		}

		flush();

		return runs;
	},
	markdownCells = (line)=>{
		// one table row into its cells, the outer pipes are optional
		var cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);

		return cells.map((cell)=> cell.replace(/\\\|/g, '|').trim());
	},
	markdownParse = (source)=>{
		var lines = String(source).replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'),
			pat = markdownPatterns,
			blocks = [],
			i = 0,
			m = null,
			body = [],
			startsBlock = (line)=>{
				// what may cut a paragraph short without a blank line in between
				return pat.fence.test(line) || pat.heading.test(line) || pat.rule.test(line) || pat.quote.test(line) || (pat.item.test(line) && pat.item.exec(line)[4] !== '');
			};

		while(i < lines.length){
			var line = lines[i];

			if(line.trim() === ''){
				i++;
				continue;
			}

			if((m = pat.fence.exec(line))){
				var fence = m[1],
					lang = m[2];

				body = [];
				i++;

				while(i < lines.length && !new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[i])){
					body.push(lines[i]);
					i++;
				}

				i++; // the closing fence

				blocks.push({type: 'code', lang: lang, text: body.join('\n')});
				continue;
			}

			if((m = pat.heading.exec(line))){
				blocks.push({type: 'heading', level: m[1].length, runs: markdownInline(m[2] || '')});
				i++;
				continue;
			}

			if(pat.rule.test(line)){
				blocks.push({type: 'rule'});
				i++;
				continue;
			}

			if(pat.quote.test(line)){
				body = [];

				// following lines without a > still belong to the quote while its paragraph runs on

				while(i < lines.length && lines[i].trim() !== '' && (pat.quote.test(lines[i]) || !startsBlock(lines[i]))){
					body.push(lines[i].replace(pat.quote, ''));
					i++;
				}

				blocks.push({type: 'quote', blocks: markdownParse(body.join('\n'))});
				continue;
			}

			if((m = pat.item.exec(line))){
				var indent = m[1].length,
					ordered = /\d/.test(m[2]),
					list = {type: 'list', ordered: ordered, start: ordered ? parseInt(m[2], 10) : 1, loose: false, items: []};

				while(i < lines.length && (m = pat.item.exec(lines[i])) && m[1].length >= indent && m[1].length <= indent + 1 && /\d/.test(m[2]) === ordered && !pat.rule.test(lines[i])){
					var inner = m[1].length + m[2].length + 1,
						task = /^\[([ xX])\]\s+/.exec(m[4]),
						gap = false;

					body = [task ? m[4].slice(task[0].length) : m[4]];
					i++;

					while(i < lines.length){
						if(lines[i].trim() === ''){
							gap = true;
							body.push('');
							i++;
							continue;
						}

						var depth = /^ */.exec(lines[i])[0].length;

						// indented under the item: part of it. flush left right after its text: the paragraph running on

						if(depth >= inner || depth >= indent + 2)body.push(lines[i].slice(Math.min(depth, inner)))
						else if(!gap && !startsBlock(lines[i]))body.push(lines[i].trim())
						else break;

						gap = false;
						i++;
					}

					// a blank line between two items of this list spreads the whole list out

					if(gap && i < lines.length && (m = pat.item.exec(lines[i])) && m[1].length >= indent && m[1].length <= indent + 1 && /\d/.test(m[2]) === ordered)list.loose = true;

					list.items.push({task: task ? task[1] !== ' ' : null, blocks: markdownParse(body.join('\n'))});
				}

				blocks.push(list);
				continue;
			}

			if(line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && pat.tableRule.test(lines[i + 1]) && markdownCells(lines[i + 1]).length === markdownCells(line).length){
				var table = {
						type: 'table',
						header: markdownCells(line).map((cell)=> markdownInline(cell)),
						align: markdownCells(lines[i + 1]).map((cell)=> /^:-+:$/.test(cell) ? 'center' : /-:$/.test(cell) ? 'right' : 'left'),
						rows: [],
					};

				i += 2;

				while(i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')){
					var cells = markdownCells(lines[i]);

					table.rows.push(table.header.map((head,n)=> markdownInline(cells[n] || '')));
					i++;
				}

				blocks.push(table);
				continue;
			}

			// a paragraph, or a heading underlined with === or ---

			body = [];

			while(i < lines.length && lines[i].trim() !== '' && (body.length === 0 || !startsBlock(lines[i]))){
				if(body.length > 0 && /^ {0,3}(=+|-+)\s*$/.test(lines[i]))break;

				body.push(lines[i].replace(/^ +/, ''));
				i++;
			}

			if(i < lines.length && body.length > 0 && /^ {0,3}(=+|-+)\s*$/.test(lines[i])){
				blocks.push({type: 'heading', level: lines[i].trim()[0] === '=' ? 1 : 2, runs: markdownInline(body.join('\n').trim())});
				i++;
				continue;
			}

			blocks.push({type: 'paragraph', runs: markdownInline(body.join('\n').trim())});
		}

		return blocks;
	},
	markdownLayout = (blocks, width, resolve)=>{
		// everything is placed relative to the top left of the document; the widget adds the
		// window position and the scroll offset when it draws
		var colors = markdownColors,
			out = {width: width, fonts: markdownFonts, height: 0, flows: 0, items: [], links: [], anchors: {}, waiting: []},
			fontOf = (run, size, bold)=>{
				return (run.italic ? 'italic ' : '') + (run.bold || bold ? 'bold ' : '') + (run.code ? (size - 1) + 'px Roboto Mono' : size + 'px Open Sans');
			},
			measure = (text, font)=>{
				mctx.font = font;

				return mctx.measureText(text).width;
			},
			flow = (runs, x, width, y, opt)=>{
				// wraps runs of mixed styles into lines inside [x, x + width], returns the y under the last line
				var size = opt.size || 14,
					lineHeight = Math.round(size * 1.45),
					line = [],
					lineWidth = 0,
					space = false,
					id = ++out.flows,
					hard = false,
					finish = (force)=>{
						var shift = opt.align === 'center' ? (width - lineWidth) / 2 : opt.align === 'right' ? width - lineWidth : 0;

						line.forEach((seg,i)=>{
							seg.x += x + Math.max(0, shift);
							seg.y = y + Math.round(lineHeight / 2 + size * 0.36);

							out.items.push(seg);

							if(seg.href != null)out.links.push({x: seg.x, y: y, width: seg.width, height: lineHeight, href: seg.href});
						});

						out.reach = Math.max(out.reach || 0, lineWidth);

						if(line.length > 0 || force)y += lineHeight;

						// what comes after a forced break starts a new line when the text is copied

						if(force)hard = true;

						line = [];
						lineWidth = 0;
						space = false;
					},
					add = (word, run)=>{
						var font = fontOf(run, size, opt.bold),
							wide = measure(word, font),
							gap = space && line.length > 0 ? measure(' ', font) : 0,
							last = line[line.length - 1],
							cut = 0;

						if(line.length > 0 && lineWidth + gap + wide > width){
							finish();
							gap = 0;
							last = null;
						}

						// a single word wider than the whole line is broken wherever it has to be

						while(wide > width && word.length > 1){
							cut = Math.max(1, Math.floor(word.length * width / wide));

							while(cut > 1 && measure(word.slice(0, cut), font) > width)cut--;

							line.push({type: 'text', x: 0, text: word.slice(0, cut), font: font, size: size, width: measure(word.slice(0, cut), font), color: run.href != null ? colors.link : opt.color, code: run.code, strike: run.strike, href: run.href, run: run, flow: id});
							lineWidth = width;

							finish();

							word = word.slice(cut);
							wide = measure(word, font);
						}

						// words of one run on one line are drawn as a single piece of text

						if(last != null && last.run === run && gap > 0){
							last.text += ' ' + word;
							last.width += gap + wide;
						}else{
							line.push({type: 'text', x: lineWidth + gap, text: word, font: font, size: size, width: wide, color: run.href != null ? colors.link : opt.color, code: run.code, strike: run.strike, href: run.href, run: run, flow: id, hard: hard, tight: opt.tight});
							hard = false;
						}

						lineWidth += gap + wide;
						space = false;
					};

				runs.forEach((run,i)=>{
					if(run.br){
						finish(true);
						return;
					}

					if(run.image != null){
						var src = resolve(run.image),
							img = images[src],
							wide = 0,
							tall = 0;

						if(img == null){
							img = images[src] = new Image();
							img.src = src;
						}

						if(img.complete && img.naturalWidth > 0){
							finish();

							wide = Math.min(img.naturalWidth, width);
							tall = Math.round(img.naturalHeight * wide / img.naturalWidth);

							out.items.push({type: 'image', img: img, x: x, y: y, width: wide, height: tall});

							if(run.href != null)out.links.push({x: x, y: y, width: wide, height: tall, href: run.href});

							out.reach = Math.max(out.reach || 0, wide);

							y += tall + 6;
							return;
						}

						// not here yet (or broken): its description stands in, and the layout is redone once it loads

						if(!img.complete)out.waiting.push(img);

						add('[' + (run.alt || 'image') + ']', {italic: true, href: run.href});
						return;
					}

					run.text.split(/(\s+)/).forEach((word,ii)=>{
						if(word === '')return;

						if(/^\s+$/.test(word))space = true
						else add(word, run);
					});
				});

				finish();

				return y;
			},
			natural = (runs, opt)=>{
				// how wide the runs would be on a single line, measured by laying them out off to the side
				var keep = out,
					reach = 0;

				out = {flows: 0, items: [], links: [], anchors: {}, waiting: [], reach: 0};

				flow(runs, 0, 100000, 0, opt);

				reach = out.reach;
				out = keep;

				return Math.ceil(reach);
			},
			stack = (list, x, width, y, ctx)=>{
				list.forEach((b,i)=>{
					if(i > 0)y += ctx.gap != null ? ctx.gap : 12;

					y = block(b, x, width, y, ctx);
				});

				return y;
			},
			block = (b, x, width, y, ctx)=>{
				if(b.type === 'heading'){
					var size = [26, 21, 17, 15, 14, 13][b.level - 1];

					if(y > 0)y += b.level <= 2 ? 8 : 4;

					out.anchors[markdownSlug(b.runs.map((run)=> run.text || '').join(''))] = y;

					y = flow(b.runs, x, width, y, {size: size, bold: true, color: b.level === 6 ? colors.muted : ctx.color});

					if(b.level <= 2){
						out.items.push({type: 'rect', x: x, y: y + 5, width: width, height: 1, color: colors.line});
						y += 6;
					}

					return y;
				}

				if(b.type === 'paragraph')return flow(b.runs, x, width, y, {size: 14, color: ctx.color});

				if(b.type === 'code'){
					var font = '13px Roboto Mono',
						fit = Math.max(8, Math.floor((width - 20) / measure('M', font))),
						rows = [];

					// long lines wrap, there is no sideways scrolling

					b.text.split('\n').forEach((row,i)=>{
						do{
							rows.push(row.slice(0, fit));
							row = row.slice(fit);
						}while(row.length > 0);
					});

					out.items.push({type: 'rect', x: x, y: y, width: width, height: rows.length * 18 + 16, color: colors.code});

					rows.forEach((row,i)=>{
						out.items.push({type: 'text', x: x + 10, y: y + 8 + i * 18 + 13, text: row, font: font, size: 13, width: measure(row, font), color: colors.text, flow: ++out.flows});
					});

					return y + rows.length * 18 + 16;
				}

				if(b.type === 'quote'){
					var top = y;

					y = stack(b.blocks, x + 16, width - 16, y + 2, {color: colors.muted}) + 2;

					out.items.push({type: 'rect', x: x, y: top, width: 4, height: y - top, color: colors.line});

					return y;
				}

				if(b.type === 'list'){
					b.items.forEach((item,i)=>{
						if(i > 0)y += b.loose ? 10 : 4;

						if(item.task != null){
							out.items.push({type: 'rect', x: x + 6, y: y + 4, width: 12, height: 12, color: colors.muted});
							out.items.push({type: 'rect', x: x + 7, y: y + 5, width: 10, height: 10, color: '#fff'});

							if(item.task)out.items.push({type: 'rect', x: x + 9, y: y + 7, width: 6, height: 6, color: colors.link});
						}else{
							var mark = b.ordered ? (b.start + i) + '.' : '•';

							out.items.push({type: 'text', x: x + 20 - measure(mark, '14px Open Sans'), y: y + 15, text: mark, font: '14px Open Sans', size: 14, width: measure(mark, '14px Open Sans'), color: ctx.color, flow: ++out.flows});
						}

						// in a list written without blank lines the parts of an item stay close together too

						y = item.blocks.length > 0 ? stack(item.blocks, x + 26, width - 26, y, {color: ctx.color, gap: b.loose ? 12 : 4}) : y + 20;
					});

					return y;
				}

				if(b.type === 'rule'){
					out.items.push({type: 'rect', x: x, y: y + 6, width: width, height: 2, color: colors.line});

					return y + 14;
				}

				if(b.type === 'table'){
					var pad = 8,
						all = [b.header].concat(b.rows),
						room = width - 1 - b.header.length * (pad * 2 + 1),
						wide = b.header.map((head,c)=> Math.max(24, ...all.map((row,r)=> natural(row[c], {size: 14, bold: r === 0})))),
						total = wide.reduce((sum, w)=> sum + w, 0),
						top = y,
						edges = [];

					// columns get the width of their widest cell, and shrink in proportion when the table is too wide

					if(total > room)wide = wide.map((w)=> Math.max(30, Math.floor(w * room / total)));

					all.forEach((row,r)=>{
						var at = out.items.length,
							cx = x + 1,
							bottom = y;

						row.forEach((cell,c)=>{
							bottom = Math.max(bottom, flow(cell, cx + pad, wide[c], y + 6, {size: 14, bold: r === 0, color: ctx.color, align: b.align[c], tight: true}));
							cx += wide[c] + pad * 2 + 1;
						});

						bottom += 6;

						// backgrounds go under the text that was just placed

						if(r === 0)out.items.splice(at, 0, {type: 'rect', x: x, y: y, width: cx - x, height: bottom - y, color: colors.head});

						edges.push(y);
						y = bottom;
					});

					edges.push(y);

					edges.forEach((edge,i)=>{
						out.items.push({type: 'rect', x: x, y: edge, width: wide.reduce((sum, w)=> sum + w + pad * 2 + 1, 1), height: 1, color: colors.line});
					});

					wide.concat([0]).reduce((cx, w)=>{
						out.items.push({type: 'rect', x: cx, y: top, width: 1, height: y - top + 1, color: colors.line});

						return cx + w + pad * 2 + 1;
					}, x);

					return y + 1;
				}

				return y;
			},
			font = mctx.font;

		out.height = stack(blocks, 0, width, 0, {color: colors.text});

		// the text on its own, in reading order, for selecting and copying

		out.texts = out.items.filter((item)=> item.type === 'text');

		mctx.font = font;

		return out;
	},
	openLink = (url, view)=>{
		var target = null;

		try{
			target = new URL(url, location.href);
		}catch(err){
			return;
		}

		// markdown files of this site open in the viewer, other files of this site in a plain webview,
		// web pages in the vibeOS browser, and anything else (mailto and friends) is the real browser's business

		if(target.origin === location.origin && /\.(md|markdown)$/i.test(target.pathname)){
			if(view != null)view.load(target.href)
			else initMarkdownViewer(decodeURIComponent(target.pathname.split('/').pop()), {url: target.href});
		}else if(target.origin === location.origin){
			initWebView(decodeURIComponent(target.pathname.split('/').pop()), 'mimetypes/16/html.png', target.href, 800, 600, false);
		}else if(target.protocol === 'http:' || target.protocol === 'https:'){
			initBrowser(target.href);
		}else{
			window.open(target.href);
		}
	};

if(document.fonts != null){
	document.fonts.addEventListener('loadingdone', ()=>{
		markdownFonts++;
	});
}

class markdown {
	constructor(source, base){
		this.padding = 20;

		this.window = null;

		this.originX = 0;

		this.originY = 0;

		// text can be selected with the mouse and copied (scripts/selection.js)

		this.select = new selection();

		// one interactable over the whole view, links are looked up by position when it is clicked

		this.interactable = new interactable('markdown', 0, 0,
			emptyFunction,
			emptyFunction,
			()=>{
				// click start
				this.select.press(cursor.x, cursor.y);
			},
			()=>{
				// click end: a link is followed when the button comes up on it, unless text was dragged over
				var link = this.linkAt(cursor.x, cursor.y);

				this.select.release();

				if(this.interactable.hover && link != null && this.select.ordered() == null)this.follow(link.href);
			}
		);

		this.interactable.drawn = 0; // takes input only while render() is being called

		this.interactable.copy = ()=>{
			return this.select.text();
		}

		this.interactable.selectAll = ()=>{
			this.select.all();
		}

		this.setSource = (source, base)=>{
			this.source = String(source);
			this.base = base || location.href;
			this.blocks = markdownParse(this.source);
			this.layout = null;
		}

		this.resolve = (href)=>{
			try{
				return new URL(href, this.base).href;
			}catch(err){
				return href;
			}
		}

		this.load = async (url, fallback)=>{
			var target = this.resolve(url);

			try{
				var response = await fetch(target);

				if(!response.ok)throw new Error(response.status + ' ' + response.statusText);

				this.setSource(await response.text(), target);
			}catch(err){
				// the page was opened as a local file, or the document is not there
				this.setSource(fallback != null ? fallback : 'Could not load `' + url + '` (' + err.message + ')', this.base);
			}

			if(this.window != null)this.window.scrollY = 0;
		}

		this.linkAt = (x, y)=>{
			if(this.layout == null)return null;

			x -= this.originX;
			y -= this.originY;

			return this.layout.links.find((link)=> x >= link.x && x <= link.x + link.width && y >= link.y && y <= link.y + link.height) || null;
		}

		this.follow = (href)=>{
			if(href[0] !== '#'){
				openLink(this.resolve(href), this);
				return;
			}

			// a link to a heading of this document

			var at = this.layout.anchors[markdownSlug(decodeURIComponent(href.slice(1)))];

			if(at != null && this.window != null)this.window.scrollY = at;
		}

		this.render = (window, top, bottom)=>{ // the caller renders, like the other widgets
			var width = Math.max(120, window.width - this.padding * 2 - window.scrollBar.width),
				box = this.interactable;

			top = top || 0;
			bottom = bottom || 0;

			this.window = window;

			// measured again only when the width changes, or a font or an image it was waiting for has arrived

			if(this.layout == null || this.layout.width !== width || this.layout.fonts !== markdownFonts || this.layout.waiting.some((img)=> img.complete)){
				this.layout = markdownLayout(this.blocks, width, this.resolve);
				this.select.setItems(this.layout.texts);
			}

			// dragging a selection past the top or bottom edge scrolls the document along

			if(box.pressed && this.select.held){
				if(cursor.y < window.contentBox.y + top)window.scrollY -= 12
				else if(cursor.y > window.contentBox.y + window.contentBox.height - bottom)window.scrollY += 12;
			}

			window.scrollView(top, bottom, this.layout.height + this.padding * 2, (y, viewHeight)=>{
				var viewTop = window.contentBox.y + top;

				this.originX = window.x + this.padding;
				this.originY = y + this.padding;

				this.select.originX = this.originX;
				this.select.originY = this.originY;

				if(box.pressed)this.select.drag(cursor.x, cursor.y);

				this.select.paint();

				this.layout.items.forEach((item,i)=>{
					var px = this.originX + item.x,
						py = this.originY + item.y;

					if(item.type === 'text'){
						if(py < viewTop - 40 || py > viewTop + viewHeight + 40)return; // not on screen

						if(item.code){
							mctx.fillStyle = markdownColors.code;
							mctx.fillRect(px - 3, py - item.size, item.width + 6, item.size + 6);
						}

						mctx.font = item.font;
						mctx.fillStyle = item.color;
						mctx.fillText(item.text, px, py);

						if(item.href != null)mctx.fillRect(px, py + 2, item.width, 1);

						if(item.strike)mctx.fillRect(px, py - Math.round(item.size * 0.3), item.width, 1);

						return;
					}

					if(py + item.height < viewTop || py > viewTop + viewHeight)return; // not on screen

					if(item.type === 'rect'){
						mctx.fillStyle = item.color;
						mctx.fillRect(px, py, item.width, item.height);
					}else if(item.type === 'image'){
						mctx.drawImage(item.img, px, py, item.width, item.height);
					}
				});
			});

			box.drawn = frame;
			box.index = window.contentBox.index + 1;
			box.x = window.x;
			box.y = window.contentBox.y + top;
			box.width = window.width - window.scrollBar.width;
			box.height = Math.max(0, window.contentBox.height - top - bottom);

			if(!box.hover)return;

			if(this.linkAt(cursor.x, cursor.y) != null)cursor.img = 'link'
			else if((this.select.locate(cursor.x, cursor.y) || {}).exact)cursor.img = 'text';
		}

		this.setSource(source == null ? '' : source, base);
	}
}

// initMarkdownViewer('Title', '# markdown text') shows text, initMarkdownViewer('Title', {url: 'README.md',
// fallback: 'text'}) loads a file and shows the fallback when it cannot be fetched (opened as a local file).

var initMarkdownViewer = (title, source, icon)=>{
		var view = new markdown('', location.href),
			window = new cwindow('markdown-viewer', 0, 0, (window)=>{
				view.render(window, 0, 0);
			});

		window.title = title;
		window.icon = icon || 'mimetypes/24/text-x-generic.png';
		window.bgColor = 'white';

		window.width = 760;
		window.height = 520;
		window.minWidth = 300;
		window.minHeight = 160;

		window.x = msize.w / 2 - window.width / 2;
		window.y = msize.h / 2 - window.height / 2;

		window.closing = ()=>{
			view.interactable.delete();
		};

		if(typeof source == 'string')view.setSource(source)
		else view.load(source.url, source.fallback);

		return view;
	},
	initMarkdownDemo = ()=>{
		initMarkdownViewer('Markdown demo', [
			'# Markdown in vibeOS',
			'',
			'Text can be **bold**, *italic*, ***both***, ~~struck out~~ or `inline code`, and long',
			'paragraphs wrap to the window. Drag a window edge to see it reflow.',
			'',
			'> Quotes start with a `>`.',
			'>',
			'> > They can be nested, and hold **other** things:',
			'> > - like lists',
			'',
			'## Links',
			'',
			'[Web links](https://example.com/) open in the vibeOS browser, and so do bare ones like',
			'https://copy.sh/v86/. Links to documents of this site open right here: [the readme](README.md),',
			'[the licence](LICENSE.md). [Jump to the table](#tables).',
			'',
			'## Lists',
			'',
			'1. Numbered',
			'2. Lists',
			'   - with nested bullets',
			'   - and more bullets',
			'3. Keep counting',
			'',
			'- [x] Task lists',
			'- [ ] With open items',
			'',
			'## Code',
			'',
			'```js',
			'var demo = new cwindow(\'demo\', 50, 50, (window)=>{',
			'\tview.render(window, 0, 0);',
			'});',
			'```',
			'',
			'## Tables',
			'',
			'| Feature | Syntax | Aligned |',
			'|:--------|:------:|--------:|',
			'| Quote | `> text` | right |',
			'| Link | `[text](url)` | **1** |',
			'| Image | `![alt](src)` | 22 |',
			'',
			'---',
			'',
			'![The default wallpaper](tango/wallpapers/c.png)',
			'*Images scale down to the width of the window.*',
		].join('\n'), 'mimetypes/24/text-x-generic.png');
	};
