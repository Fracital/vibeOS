// Emulator app. The emulator core (libv86.js + v86.wasm), BIOS and disk images are
// vendored from https://copy.sh/v86/ into scripts/v86/ so vibeOS stays fully portable.

var screenRoot = document.createElement('div'),
	screenText = document.createElement('div'),
	screenCanvas = document.createElement('canvas'),
	filePicker = document.createElement('input');

hiddenContainer.appendChild(filePicker);
filePicker.setAttribute('type', 'file');

hiddenContainer.appendChild(screenRoot);
screenRoot.appendChild(screenText);
screenRoot.appendChild(screenCanvas);

var v86Base = 'scripts/v86/',
	v86Image = (file)=>{ return v86Base + 'images/' + file },
	// bigger systems are not vendored; they stream from copy.sh through the wisp relay (scripts/relay.js)
	relayBase = 'https://i.copy.sh/',
	relayImage = (file)=>{ return relayBase + file },
	emulator = null,
	vmWindow = null,
	vmMsg = '',
	vmMenuHeight = 25,
	activeProfile = null,
	savedState = null,
	profileData = {
		wasm_path: v86Base + 'v86.wasm',
		memory_size: 64 * 1024 * 1024,
		vga_memory_size: 8 * 1024 * 1024,
		screen_container: screenRoot,
		screen: {
			use_graphical_text: true, // text mode is rendered into the canvas too, so we only ever blit one canvas
			scale: 1,
		},
		bios: {
			url: v86Base + 'bios/seabios.bin',
		},
		vga_bios: {
			url: v86Base + 'bios/vgabios.bin',
		},
		// guest networking goes through the same wisp relay as the streamed disks (scripts/relay.js)
		network_relay_url: relay.url.replace(/^wss:/, 'wisps:').replace(/^ws:/, 'wisp:'),
		autostart: true,
	},
	profiles = {
		// systems
		freedos: {
			name: 'FreeDOS',
			fda: { url: v86Image('freedos722.img'), size: 737280 },
		},
		msdos4: {
			name: 'MS-DOS 4',
			fda: { url: v86Image('msdos4.img'), size: 1474560 },
		},
		windows1: {
			name: 'Windows 1.01',
			fda: { url: v86Image('windows101.img'), size: 1474560 },
		},
		kolibri: {
			name: 'KolibriOS',
			fda: { url: v86Image('kolibri.img'), size: 1474560 },
		},
		linux: {
			name: 'Linux 2.6',
			cdrom: { url: v86Image('linux.iso'), size: 5666816 },
		},
		linux3: {
			name: 'Linux 3',
			cdrom: { url: v86Image('linux3.iso'), size: 8638464 },
		},
		// streamed over the relay from copy.sh: chunked disks are fetched on demand as the OS reads them
		msdos622: {
			name: 'MS-DOS 6.22',
			streamed: true,
			hda: { url: relayImage('msdos622/.img'), size: 67108864, async: true, fixed_chunk_size: 262144, use_parts: true },
		},
		windows31: {
			name: 'Windows 3.1',
			streamed: true,
			hda: { url: relayImage('win31.img'), size: 34463744, async: false },
		},
		windows95: {
			name: 'Windows 95',
			streamed: true,
			hda: { url: relayImage('windows95-v3/.img'), size: 471859200, async: true, fixed_chunk_size: 262144, use_parts: true },
		},
		windows98: {
			name: 'Windows 98',
			streamed: true,
			preserve_mac_from_state_image: true, // the saved state already has a configured network card
			memory_size: 128 * 1024 * 1024,
			hda: { url: relayImage('windows98/.img'), size: 314572800, async: true, fixed_chunk_size: 262144, use_parts: true },
			initial_state: { url: relayImage('windows98_state-v2.bin.zst') },
		},
		windows2000: {
			name: 'Windows 2000',
			streamed: true,
			preserve_mac_from_state_image: true, // the saved state already has a configured network card
			memory_size: 512 * 1024 * 1024,
			hda: { url: relayImage('windows2k-v2/.img'), size: 2147483648, async: true, fixed_chunk_size: 262144, use_parts: true },
			initial_state: { url: relayImage('windows2k_state-v4.bin.zst') },
		},
		// games (boot floppies from copy.sh/v86)
		floppybird: {
			name: 'Floppy Bird',
			fda: { url: v86Image('floppybird.img'), size: 1474560 },
		},
		tetros: {
			name: 'TetrOS',
			fda: { url: v86Image('tetros.img'), size: 512 },
		},
		invaders: {
			name: 'Invaders',
			fda: { url: v86Image('invaders.img'), size: 512 },
		},
		pillman: {
			name: 'Pillman',
			fda: { url: v86Image('pillman.img'), size: 512 },
		},
		bootrogue: {
			name: 'bootRogue',
			fda: { url: v86Image('bootrogue.img'), size: 512 },
		},
		dino: {
			name: 'dino',
			fda: { url: v86Image('bootdino.img'), size: 512 },
		},
		bootchess: {
			name: 'BootChess',
			fda: { url: v86Image('bootchess.img'), size: 1474560 },
		},
		doof: {
			name: 'DOOF',
			fda: { url: v86Image('doof-1440.img'), size: 1474560 },
		},
	},
	destroyEmulator = async ()=>{
		if(emulator == null)return;

		var old = emulator;
		emulator = null;

		try{ await old.stop(); }catch(err){ console.error(err); }
		try{ old.destroy(); }catch(err){ console.error(err); }
	},
	loadProfile = async (profileName)=>{
		var profile = profiles[profileName];

		if(profile == null){
			vmMsg = 'Unknown profile: ' + profileName;
			return;
		}

		activeProfile = profileName;
		vmMsg = 'Loading ' + profile.name + '..';

		await destroyEmulator();

		if(activeProfile != profileName)return; // another profile was picked while we were stopping

		var options = Object.assign({}, profileData);

		Object.entries(profile).forEach((e,i)=>{
			if(e[0] == 'name' || e[0] == 'streamed' || e[1] == null)return;
			options[e[0]] = e[1];
		});

		if(profile.streamed){
			vmMsg = 'Connecting to relay for ' + profile.name + '..';

			try{
				await relay.load();
			}catch(err){
				vmMsg = 'Relay unavailable, cannot stream ' + profile.name;
				return;
			}

			if(activeProfile != profileName)return;
		}

		if(typeof V86 != 'function'){
			vmMsg = 'libv86.js is missing';
			return;
		}

		emulator = new V86(options);

		emulator.add_listener('download-progress', (e)=>{
			if(e.total)vmMsg = 'Downloading ' + e.file_name + ' ' + Math.round(e.loaded / e.total * 100) + '%';
		});
		emulator.add_listener('download-error', (e)=>{
			vmMsg = 'Failed to download ' + e.file_name;
		});
		emulator.add_listener('emulator-ready', ()=>{
			vmMsg = profile.name + ' ready';
		});
		emulator.add_listener('emulator-started', ()=>{
			vmMsg = 'Running ' + profile.name;
		});
		emulator.add_listener('emulator-stopped', ()=>{
			vmMsg = profile.name + ' stopped';
		});
	},
	restoreVMState = async (buffer)=>{
		if(emulator == null || buffer == null)return;

		try{
			await emulator.stop();
			await emulator.restore_state(buffer);
			emulator.run();
			vmMsg = 'State restored';
		}catch(err){
			vmMsg = 'Restore failed: ' + err.message;
		}
	};

filePicker.addEventListener('change', e=>{
	var file = filePicker.files[0];

	if(file == null)return;

	var filereader = new FileReader();

	filereader.addEventListener('load', e=>{
		restoreVMState(e.target.result);
	});

	filereader.readAsArrayBuffer(file);
	filePicker.value = '';
});

// initLinuxVM() opens the emulator window; initLinuxVM('floppybird') opens it on a given profile.
// If the window is already open the profile is swapped in place.

var initLinuxVM = (profileName)=>{
		if(typeof profileName != 'string')profileName = 'freedos';

		if(vmWindow != null){
			loadProfile(profileName);
			vmWindow.moveToFront();
			return;
		}

		loadProfile(profileName);

		var profileEntries = (names)=>{
				return names.map((name)=>{
					return {
						value: profiles[name].name,
						func: ()=>{
							loadProfile(name);
						},
					};
				});
			},
			wino = new windowOptions([
				{
					value: 'VM',
					contents: [
						{
							value: 'Run',
							func: ()=>{
								if(emulator)emulator.run();
							},
						},
						{
							value: 'Pause',
							func: ()=>{
								if(emulator)emulator.stop();
							},
						},
						{
							value: 'Reboot',
							func: ()=>{
								if(emulator)emulator.restart();
							},
						},
						{
							value: 'Lock cursor',
							func: ()=>{
								if(emulator == null)return;
								emulator.mouse_set_status(true);
								emulator.lock_mouse();
							},
						},
					]
				},
				{
					value: 'State',
					contents: [
						{
							value: 'Save',
							func: async ()=>{
								if(emulator == null)return;
								try{
									savedState = await emulator.save_state();
									vmMsg = 'Saved state (' + Math.round(savedState.byteLength / 1024) + ' KB)';
								}catch(err){
									vmMsg = 'Save failed: ' + err.message;
								}
							},
						},
						{
							value: 'Load',
							func: ()=>{
								if(savedState == null){
									vmMsg = 'Nothing saved yet';
									return;
								}
								restoreVMState(savedState);
							},
						},
						{
							value: 'Save File',
							func: async ()=>{
								if(emulator == null)return;
								try{
									savedState = await emulator.save_state();

									var a = document.createElement('a');
									a.download = 'v86state.bin';
									a.href = window.URL.createObjectURL(new Blob([savedState]));
									a.click();

									vmMsg = 'Saved state (' + Math.round(savedState.byteLength / 1024) + ' KB)';
								}catch(err){
									vmMsg = 'Save failed: ' + err.message;
								}
							},
						},
						{
							value: 'Load File',
							func: ()=>{
								filePicker.click();
							},
						},
					]
				},
				{
					value: 'Systems',
					contents: profileEntries(['freedos', 'msdos4', 'windows1', 'kolibri', 'linux', 'linux3']),
				},
				{
					value: 'Online',
					contents: profileEntries(['msdos622', 'windows31', 'windows95', 'windows98', 'windows2000']),
				},
				{
					value: 'Games',
					contents: profileEntries(['floppybird', 'tetros', 'invaders', 'pillman', 'bootrogue', 'dino', 'bootchess', 'doof']),
				},
			]);

		vmWindow = new cwindow('vm-linux', 50, 50, (window)=>{
			var running = emulator != null && emulator.is_running(),
				statusIcon = {x: window.titleBar.x + window.titleBar.width - 60, y: window.titleBar.y + 2};

			mctx.drawImageURL(running ? './tango/actions/24/player_pause.png' : './tango/actions/24/player_play.png', statusIcon.x, statusIcon.y, 24, 24);

			// the VM only gets the keyboard while the pointer is over its screen

			if(emulator != null)emulator.keyboard_set_status(running && window.contentBox.hover);

			// screen: size the window to the VM display, scaled down when it would not fit on the desktop

			var sw = screenCanvas.width,
				sh = screenCanvas.height,
				maxW = msize.w - 20,
				maxH = msize.h - 26 - window.titleBar.height - vmMenuHeight - 20,
				scale = 1;

			if(sw > 0 && sh > 0){
				// small modes (320x200 games and the like) are doubled, anything else is shown 1:1 or shrunk to fit
				scale = Math.min(sw <= 400 && sh <= 300 ? 2 : 1, maxW / sw, maxH / sh);

				var drawW = Math.round(sw * scale),
					drawH = Math.round(sh * scale);

				window.width = Math.max(640, drawW);
				window.height = drawH + vmMenuHeight + 10;

				mctx.drawImage(screenCanvas, window.contentBox.x + (window.width - drawW) / 2, window.contentBox.y + vmMenuHeight, drawW, drawH);
			}else{
				window.width = 640;
				window.height = 400 + vmMenuHeight + 10;
			}

			wino.render(window);
			wino.interactable.index = 30;

			// status message after the menu so it sits on top of the menu bar

			mctx.fillStyle = '#fff';
			mctx.font = 'normal 13px Open Sans';
			mctx.textAlign = 'end';
			mctx.fillText(vmMsg, window.titleBar.x + window.titleBar.width - 12, window.titleBar.y + window.titleBar.height + 17);
			mctx.textAlign = 'start';
		});

		vmWindow.title = 'Emulator';
		vmWindow.width = 640;
		vmWindow.height = 400 + vmMenuHeight + 10;
		vmWindow.bgColor = 'black';
		vmWindow.icon = 'apps/24/bash.png';
		vmWindow.y = 26;

		vmWindow.closing = ()=>{
			destroyEmulator();

			wino.elements.forEach((e,i)=>{
				e.contents.forEach((entry,index)=>{
					entry.interactable.delete();
				});
				e.interactable.delete();
			});
			wino.interactable.delete();

			vmWindow = null;
		};
	};
