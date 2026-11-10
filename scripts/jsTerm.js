var initJsTerm=(async()=>{
		var lines = ['vibeOS JavaScript Terminal | Run vsu_help() for commands.'],
			inputBar = new inputbar(0, 0, 'poggers code', (key, str)=>{
				// onChange(e.key, this.value);
				
			},
			async (str)=>{
				// onSubmit(this.value);
				
				lines.push( '> ' + str );
				
				try{
					// this isnt safe but havent researched into alternatives
					var evaluated = eval(str);
					
					// wordWrap only takes strings, numbers and objects used to print as an empty line
					lines.push(String(evaluated));
					
				}catch(err){
					lines.push( err.toString() );
				}
				
				// bounded scrollback, and follow the newest output

				while(lines.length > maxLines)lines.shift();

				select.clear(); // the lines it pointed at have moved

				window.scrollY = Infinity;

				inputBar.value = '';
			}),
			window=new cwindow('jsTerm', 600 , 250, (window)=>{
				// after render
				
				inputBar.interactable.x = window.x + 10;
				inputBar.interactable.y = window.y + window.height - 15;
				
				inputBar.interactable.width = window.width - 20
				
				var blines=[], // temp
					charWidth = 0;

				lines.forEach((e,i)=>{
					wordWrap(e, (window.width - 12) / 7.2).split('\n').forEach((ee,ii)=>{
						blines.push({text: ee, flow: i});
					});
				});

				// the output can be selected with the mouse and copied (scripts/selection.js). it is handed
				// over as placed pieces of text, one per row, rows of one wrapped line sharing a flow

				mctx.font = textSize+'px Inconsolata';
				charWidth = mctx.measureText('M').width;

				select.items = blines.map((e,i)=> ({x: 15, y: 20 + i*lineHeight, width: e.text.length * charWidth, text: e.text, font: textSize+'px Inconsolata', size: textSize, flow: e.flow}));

				output.index = window.contentBox.index + 1;
				output.x = window.x;
				output.y = window.contentBox.y;
				output.width = window.width - window.scrollBar.width;
				output.height = Math.max(0, window.contentBox.height - 45);

				if(output.hover)cursor.img = 'text';

				if(output.pressed && select.held){
					if(cursor.y < output.y)window.scrollY -= lineHeight
					else if(cursor.y > output.y + output.height)window.scrollY += lineHeight;
				}

				// history scrolls above the input bar instead of being thrown away once the window is full

				window.scrollView(0, 45, 12 + blines.length * lineHeight, (top, viewHeight)=>{
					select.originX = window.x;
					select.originY = top;

					if(output.pressed)select.drag(cursor.x, cursor.y);

					select.paint();

					mctx.fillStyle='#fff';
					mctx.font = textSize+'px Inconsolata';

					blines.forEach((e,i)=>{
						var y = top + 20 + i*lineHeight;

						if(y < window.contentBox.y || y > window.contentBox.y + viewHeight + lineHeight)return; // not on screen

						mctx.fillText(e.text, window.x + 15 , y);
					});
				});

				inputBar.render();
			}),
			select = new selection(),
			output = new interactable('jsTerm_output', 0, 0,
				emptyFunction,
				emptyFunction,
				()=>{
					// click start
					select.press(cursor.x, cursor.y);
				},
				()=>{
					// click end
					select.release();
				}
			),
			textSize = 14,
			lineHeight = 16,
			maxLines = 500;

		output.copy = ()=>{
			return select.text();
		};

		output.selectAll = ()=>{
			select.all();
		};

		// typing after clicking in the output goes to the input bar, as in any terminal

		output.keydown = (e)=>{
			if(e.ctrlKey || e.metaKey)return;

			cursor.focus = inputBar.interactable.id;
			inputBar.interactable.keydown(e);
		};

		window.closing = ()=>{
			output.delete();
			inputBar.interactable.delete();
		};
		
		window.width = 700;
		window.height = 300;
		
		window.x = msize.w / 2 - window.width / 2; // center of screen
		window.y = msize.h / 2 - window.height / 2; // middle of screen
		
		window.icon = 'apps/24/bash.png';
		window.title = 'JS Terminal';
		
		window.bgColor = 'black'
		
		inputBar.interactable.width = 300;
		inputBar.interactable.height = 25;
		
		inputBar.interactable.index = window.contentBox.index + 1;
	});
