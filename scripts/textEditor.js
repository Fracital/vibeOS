// Text Editor. The editing itself is the editor widget (scripts/editor.js). This is the window
// around it: the menu bar, the switch between plain and rich text at its right end, opening and
// saving files, find, and the status bar.
//
// Files are plain text either way. Rich mode shows the text as formatted markdown, so a document
// written in it is a .md file anything else can read too.

var initTextEditor = ()=>{
		var view = new editor(),
			name = 'untitled.txt',
			handle = null, // the file on disk, in browsers that let a page keep hold of one
			saved = '',
			note = '',
			noteUntil = 0,
			finding = false,
			backwards = false,
			counted = null,
			words = 0,
			picker = document.createElement('input'),
			toggle = new cswitch(34, 16, false),
			say = (text)=>{
				// a short message in the status bar
				note = text;
				noteUntil = Date.now() + 4000;
			},
			load = (text, title, file)=>{
				view.setText(text);

				name = title;
				handle = file || null;
				saved = view.text;

				// markdown opens formatted, anything else as it is

				toggle.value = /\.(md|markdown)$/i.test(title);

				view.focus();
			},
			unsaved = (question, then)=>{
				// asks first when there are changes that would be lost
				if(view.text === saved){
					then();
					return;
				}

				new cPrompt('Unsaved changes', question, then, emptyFunction);
			},
			create = ()=>{
				unsaved('Start a new document and lose the changes to ' + name + '?', ()=>{
					load('', toggle.value ? 'untitled.md' : 'untitled.txt');
				});
			},
			open = ()=>{
				unsaved('Open another file and lose the changes to ' + name + '?', async ()=>{
					// the browser's own file dialog where there is one that hands back a file we can
					// save to again, a plain file input everywhere else

					if(globalThis.showOpenFilePicker == null){
						picker.click();
						return;
					}

					try{
						var picked = await globalThis.showOpenFilePicker(),
							file = await picked[0].getFile();

						load(await file.text(), file.name, picked[0]);
					}catch(err){
						if(err.name !== 'AbortError')say('Could not open the file: ' + err.message);
					}
				});
			},
			save = async (as)=>{
				try{
					if(globalThis.showSaveFilePicker != null){
						if(handle == null || as)handle = await globalThis.showSaveFilePicker({suggestedName: name});

						var out = await handle.createWritable();

						await out.write(view.text);
						await out.close();

						name = handle.name;
					}else{
						// no access to files: the document is handed to the browser as a download

						if(as){
							var asked = globalThis.prompt('Save as', name);

							if(asked == null || asked.trim() === '')return;

							name = asked.trim();
						}

						var link = document.createElement('a');

						link.download = name;
						link.href = URL.createObjectURL(new Blob([view.text], {type: 'text/plain'}));
						link.click();
					}

					saved = view.text;

					say('Saved ' + name);
				}catch(err){
					if(err.name !== 'AbortError')say('Could not save: ' + err.message);
				}
			},
			copy = async (cut)=>{
				var text = view.selected();

				if(text === '')return;

				try{
					await navigator.clipboard.writeText(text);

					if(cut)view.insert('', 'edit');
				}catch(err){
					say('The browser kept the clipboard to itself, use Ctrl+C and Ctrl+X');
				}
			},
			paste = async ()=>{
				try{
					view.interactable.paste(await navigator.clipboard.readText());
				}catch(err){
					say('The browser kept the clipboard to itself, use Ctrl+V');
				}
			},
			find = (query, back)=>{
				// the next match after the selection (or the one before it), going round at the ends
				var hay = view.text.toLowerCase(),
					needle = query.toLowerCase(),
					range = view.range(),
					at = -1;

				if(needle === '')return;

				if(back){
					at = range[0] > 0 ? hay.lastIndexOf(needle, range[0] - 1) : -1;

					if(at === -1)at = hay.lastIndexOf(needle);
				}else{
					at = hay.indexOf(needle, range[1]);

					if(at === -1)at = hay.indexOf(needle);
				}

				if(at === -1){
					say('Nothing found for "' + query + '"');
					return;
				}

				view.select(at, at + needle.length);
			},
			findBar = new inputbar(260, 22, 'Find', (key, str)=>{
				// onChange(e.key, this.value);
			},
			(str)=>{
				// onSubmit(this.value);

				find(str, backwards);
			}),
			findKeys = findBar.interactable.keydown,
			showFind = ()=>{
				finding = true;

				// what is selected is what gets looked for

				if(view.selected() !== '' && !view.selected().includes('\n'))findBar.value = view.selected();

				findBar.interactable.selectAll();

				cursor.focus = findBar.interactable.id;
			},
			// menu entries hand the keyboard back to the text when they are done
			then = (action)=>{
				return ()=>{
					view.focus();
					action();
				};
			},
			wrapItem = {value: 'Word wrap', func: then(()=>{ view.wrap = !view.wrap; })},
			numbersItem = {value: 'Line numbers', func: then(()=>{ view.numbers = !view.numbers; })},
			richItem = {value: 'Rich text', func: then(()=>{ toggle.value = !toggle.value; })},
			menu = new windowOptions([
				{
					value: 'File',
					contents: [
						{value: 'New', func: then(create)},
						{value: 'Open...', func: then(open)},
						{value: 'Save', func: then(()=>{ save(false); })},
						{value: 'Save as...', func: then(()=>{ save(true); })},
					],
				},
				{
					value: 'Edit',
					contents: [
						{value: 'Undo', func: then(()=>{ view.undo(); })},
						{value: 'Redo', func: then(()=>{ view.redo(); })},
						{value: 'Cut', func: then(()=>{ copy(true); })},
						{value: 'Copy', func: then(()=>{ copy(false); })},
						{value: 'Paste', func: then(paste)},
						{value: 'Select all', func: then(()=>{ view.interactable.selectAll(); })},
						{value: 'Find...', func: showFind},
					],
				},
				{
					value: 'View',
					contents: [
						richItem,
						wrapItem,
						numbersItem,
						{value: 'Zoom in', func: then(()=>{ view.zoom = Math.min(2.5, view.zoom + 0.1); })},
						{value: 'Zoom out', func: then(()=>{ view.zoom = Math.max(0.6, view.zoom - 0.1); })},
						{value: 'Normal size', func: then(()=>{ view.zoom = 1; })},
					],
				},
				{
					value: 'Format',
					contents: [
						{value: 'Bold', func: then(()=>{ view.mark('**'); })},
						{value: 'Italic', func: then(()=>{ view.mark('*'); })},
						{value: 'Strikethrough', func: then(()=>{ view.mark('~~'); })},
						{value: 'Code', func: then(()=>{ view.mark('`'); })},
						{value: 'Heading 1', func: then(()=>{ view.block('# '); })},
						{value: 'Heading 2', func: then(()=>{ view.block('## '); })},
						{value: 'Heading 3', func: then(()=>{ view.block('### '); })},
						{value: 'Normal text', func: then(()=>{ view.block(''); })},
						{value: 'Bullet list', func: then(()=>{ view.block('- '); })},
						{value: 'Numbered list', func: then(()=>{ view.block('1. '); })},
						{value: 'Quote', func: then(()=>{ view.block('> '); })},
					],
				},
			]),
			window = new cwindow('text-editor', 0, 0, (window)=>{
				var box = window.contentBox,
					barHeight = 25,
					statusHeight = 22,
					findHeight = finding ? 32 : 0,
					bottom = box.y + box.height,
					at = view.position();

				// the switch decides the mode. a document that has no name yet is named after it

				if(toggle.value !== view.rich){
					view.rich = toggle.value;

					if(handle == null && /^untitled\.(txt|md)$/.test(name))name = view.rich ? 'untitled.md' : 'untitled.txt';

					if(cursor.focus == toggle.interactable.id)view.focus();
				}

				window.title = (view.text !== saved ? '*' : '') + name + ' - Text Editor';

				view.render(window, barHeight, statusHeight + findHeight);

				if(finding){
					mctx.fillStyle = '#e4e6e9';
					mctx.fillRect(window.x, bottom - statusHeight - findHeight, window.width, findHeight);

					mctx.fillStyle = '#000';
					mctx.font = '13px Open Sans';
					mctx.fillText('Find', window.x + 12, bottom - statusHeight - 11);
					mctx.fillText('Enter for the next match, Shift+Enter for the one before, Esc to close', window.x + 330, bottom - statusHeight - 11);

					findBar.interactable.index = box.index + 2;
					findBar.interactable.x = window.x + 52;
					findBar.interactable.y = bottom - statusHeight - findHeight + 5;

					findBar.render();
				}

				// status bar: where the caret is, how much there is, and which mode

				if(counted !== view.text){
					counted = view.text;
					words = (view.text.match(/\S+/g) || []).length;
				}

				mctx.fillStyle = '#404040';
				mctx.fillRect(window.x, bottom - statusHeight, window.width, statusHeight);

				mctx.fillStyle = '#fff';
				mctx.font = '12px Open Sans';
				mctx.fillText('Ln ' + at.line + ', Col ' + at.column + '     ' + words + (words === 1 ? ' word' : ' words') + '     ' + view.lines.length + (view.lines.length === 1 ? ' line' : ' lines'), window.x + 12, bottom - 7);

				mctx.textAlign = 'end';
				mctx.fillText(Date.now() < noteUntil ? note : view.rich ? 'Rich text (markdown)' : 'Plain text', window.x + window.width - 22, bottom - 7);
				mctx.textAlign = 'start';

				// the menu goes on last, its lists drop over the text

				wrapItem.value = (view.wrap ? '✓ ' : '') + 'Word wrap';
				numbersItem.value = (view.numbers ? '✓ ' : '') + 'Line numbers';
				richItem.value = (view.rich ? '✓ ' : '') + 'Rich text';

				menu.render(window);

				// the switch between plain and rich text, at the right end of the menu bar

				toggle.interactable.index = box.index + 240;
				toggle.interactable.x = window.x + window.width - toggle.interactable.width - 12;
				toggle.interactable.y = box.y + 4;

				mctx.fillStyle = '#fff';
				mctx.font = 'normal 13px Open Sans';
				mctx.textAlign = 'end';
				mctx.fillText('Rich', toggle.interactable.x - 8, box.y + 17);
				mctx.textAlign = 'start';

				toggle.render();
			});

		// Escape closes the find bar, and Shift+Enter looks backwards

		findBar.interactable.keydown = (e)=>{
			if(e.key === 'Escape'){
				finding = false;

				view.focus();

				e.preventDefault();
				return;
			}

			backwards = e.shiftKey;

			findKeys(e);
		};

		view.onShortcut = (e)=>{
			switch(e.key.toLowerCase()){
				case 's':
					save(e.shiftKey);
					return true;
				case 'o':
					open();
					return true;
				case 'f':
					showFind();
					return true;
			}

			return false;
		};

		picker.setAttribute('type', 'file');

		hiddenContainer.appendChild(picker);

		picker.addEventListener('change', async (e)=>{
			var file = picker.files[0];

			if(file == null)return;

			try{
				load(await file.text(), file.name);
			}catch(err){
				say('Could not open the file: ' + err.message);
			}

			picker.value = '';
		});

		window.title = 'Text Editor';
		window.icon = 'categories/24/applications-office.png';
		window.bgColor = 'white';

		window.width = 800;
		window.height = 600;
		window.minWidth = 460;
		window.minHeight = 240;

		window.x = msize.w / 2 - window.width / 2;
		window.y = msize.h / 2 - window.height / 2;

		// the close button asks before it throws work away

		window.beforeClose = ()=>{
			if(view.text === saved)return true;

			new cPrompt('Unsaved changes', 'Close ' + name + ' without saving?', ()=>{
				window.close();
			}, emptyFunction);

			return false;
		};

		window.closing = ()=>{
			menu.elements.forEach((e,i)=>{
				e.contents.forEach((entry,index)=>{
					entry.interactable.delete();
				});

				e.interactable.delete();
			});

			menu.interactable.delete();
			view.interactable.delete();
			findBar.interactable.delete();
			toggle.interactable.delete();

			if(picker.parentNode != null)picker.parentNode.removeChild(picker);
		};

		view.focus();

		return view;
	};
