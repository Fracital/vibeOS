/*
	The Wallpaper Picker app has been mostly completed as of July 25.
	The plan is to incorperate a link to it in the settings app and move
	onto other peojects until such time to revisit this to add additional
	functionality. 

	- ctaetcsh
*/

var wallpapers={
		solids : [
			{
				value: '#FF8C00'
			},
			{
				
				value: '#E81123'
			},
			{
				value: '#9A0089'
			},
			{
				value: '#10893E'
			},
			{
				value: '#018574'
			},
			{
				value: '#2D7D9A'
			},
			{
				value: '#0063B1'
			},
			{
				value: '#4A5459'
			}
		],
		images : [
			{
				value: 'wallpapers/a.png',
				name: 'Default'
			},
			{
				value: 'wallpapers/b.png',
				name: 'Wave'
			},
			{
				value: 'wallpapers/c.png',
				name: 'Test Background'
			},
			{
				value: 'wallpapers/GardenTilesCT.png',
				name: 'Garden Tiles (CT)'
			},
			{
				value: 'wallpapers/SysYABranded.png',
				name: 'SysYA_Branded'
			},
			{
				value: 'wallpapers/SysYA.png',
				name: 'SysYA'
			},
			{
				value: 'wallpapers/SysYADark.png',
				name: 'SysYA_Dark'
			},
		],
	},
	wallpaperThumbs = {},
	loadWallpaperThumb = async (value)=>{
		// a small copy is made once per session. the picker used to scale every full size
		// wallpaper down again on every frame, which is what made it crawl
		var full = new Image(),
			thumb = new Image();

		wallpaperThumbs[value] = thumb;

		full.src = 'tango/' + value;

		try{
			thumb.src = await downscale(full, 128, 72, {imageType: 'png'});
		}catch(err){
			console.error(err);
		}
	},
	initWallpaperPicker = ()=>{
		var tileWidth = 128,
			tileHeight = 72,
			swatch = 44,
			pad = 20,
			window = new cwindow('wallpaper-picker', 50, 50, (ele)=>{
				// on render: both groups wrap to the window width, and scroll when it is too small for them

				var usable = ele.width - pad * 2 - ele.scrollBar.width,
					perRow = Math.max(1, Math.floor((usable + 20) / (tileWidth + 20))),
					swatchPerRow = Math.max(1, Math.floor((usable + 2) / (swatch + 2))),
					imagesTop = 30,
					solidsTop = imagesTop + Math.ceil(wallpapers.images.length / perRow) * (tileHeight + 34) + 22,
					contentHeight = solidsTop + Math.ceil(wallpapers.solids.length / swatchPerRow) * (swatch + 2) + pad;

				ele.scrollView(0, 0, contentHeight, (top)=>{
					mctx.font = '13px Open Sans';
					mctx.fillStyle = '#000';

					mctx.fillText('Wallpapers', ele.x + pad, top + 20); // wallpapers label
					mctx.fillText('Solid Colors', ele.x + pad, top + solidsTop - 10); // solid colors label

					tiles.forEach((tile,i)=>{
						var box = tile.interactable,
							n = tile.solid ? i - wallpapers.images.length : i,
							thumb = wallpaperThumbs[tile.entry.value];

						box.index = ele.contentBox.index + 1;

						if(tile.solid){
							box.width = swatch;
							box.height = swatch;
							box.x = ele.x + pad + (n % swatchPerRow) * (swatch + 2);
							box.y = top + solidsTop + Math.floor(n / swatchPerRow) * (swatch + 2);

							mctx.fillStyle = tile.entry.value;
							mctx.fillRect(box.x, box.y, box.width, box.height);
						}else{
							box.width = tileWidth;
							box.height = tileHeight;
							box.x = ele.x + pad + (n % perRow) * (tileWidth + 20);
							box.y = top + imagesTop + Math.floor(n / perRow) * (tileHeight + 34);

							if(thumb == null)loadWallpaperThumb(tile.entry.value);

							if(thumb != null && thumb.complete && thumb.naturalWidth > 0){
								mctx.drawImage(thumb, box.x, box.y, box.width, box.height);
							}else{
								// still loading
								mctx.fillStyle = '#9a9a9a';
								mctx.fillRect(box.x, box.y, box.width, box.height);
							}

							mctx.fillStyle = '#000';
							mctx.textAlign = 'center';
							mctx.fillText(tile.entry.name, box.x + box.width / 2, box.y + box.height + 17);
							mctx.textAlign = 'start';
						}

						mctx.lineJoin = 'miter';
						mctx.lineWidth = 2;

						if(box.hover){
							mctx.strokeStyle = '#fff';
							mctx.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
						}

						if(tile.entry.value == background.value){
							mctx.strokeStyle = '#000';
							mctx.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
						}
					});
				});
			}),
			// every picker window gets its own tiles. they used to be stored on the shared wallpaper
			// list, so a second picker took them from the first and closing either one broke the other
			tiles = wallpapers.images.concat(wallpapers.solids).map((entry,i)=>{
				var tile = {
						entry: entry,
						solid: i >= wallpapers.images.length,
						interactable: new interactable('wallpaper-picker_tile_' + entry.value.toLowerCase().trim(), tileWidth, tileHeight,
							emptyFunction,
							emptyFunction,
							()=>{
								// click start

								background.value = entry.value;
							}
						),
					};

				// only reacts inside the scroll view, not while scrolled out under the title bar
				tile.interactable.scrolls = true;

				return tile;
			});

		window.closing = ()=>{
			tiles.forEach((tile,i)=>{
				tile.interactable.delete();
			});
		}

		window.title = 'Wallpaper Picker'
		window.icon = 'apps/24/preferences-desktop-wallpaper.png'
		window.width = 1070
		window.height = 240
		window.minWidth = 240
		window.minHeight = 150
	}
