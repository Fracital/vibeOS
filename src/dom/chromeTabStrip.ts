// Chrome Tabs owns tab geometry and rendering. This adapter replaces its
// Draggabilly interaction with one cancellable, pointer-based drag session.
import ChromeTabs from 'chrome-tabs';

interface TabDrag {
	tab: HTMLElement;
	pointerId: number;
	startX: number;
	lastX: number;
	grabOffset: number;
	containerLeft: number;
	containerWidth: number;
	viewportLeft: number;
	viewportRight: number;
	tabWidth: number;
	slotCenters: number[];
	startIndex: number;
	started: boolean;
	position: number;
}

const dragThreshold = 5;
const reorderHysteresis = 7;
const settleDuration = 175;
const edgeScrollZone = 30;
const minReadableTabContent = 64;

export class VibeChromeTabs extends ChromeTabs {
	private drag: TabDrag | null = null;
	private frame = 0;
	private settleAnimation: Animation | null = null;
	private settleTimer = 0;
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	private readonly onResize = () => {
		this.cancelDrag();
		this.layoutTabs();
	};

	private readonly onPointerDown = (event: PointerEvent) => {
		if(event.button !== 0 || !event.isPrimary || this.drag)return;
		if(!(event.target instanceof Element))return;
		if(event.target.closest('.chrome-tab-close, button, a, input'))return;
		const tab = event.target.closest<HTMLElement>('.chrome-tab');
		if(!tab || !this.tabContentEl.contains(tab))return;
		this.interruptSettle();
		const bounds = tab.getBoundingClientRect();
		const container = this.tabContentEl.getBoundingClientRect();
		const viewport = this.el.getBoundingClientRect();
		const tabs = this.tabEls;
		const positions = this.tabPositions;
		this.drag = {
			tab,
			pointerId: event.pointerId,
			startX: event.clientX,
			lastX: event.clientX,
			grabOffset: event.clientX - bounds.left,
			containerLeft: container.left,
			containerWidth: container.width,
			viewportLeft: viewport.left,
			viewportRight: viewport.right,
			tabWidth: bounds.width,
			slotCenters: positions.map((left, index) => left + (tabs[index]?.offsetWidth ?? bounds.width) / 2),
			startIndex: this.tabEls.indexOf(tab),
			started: false,
			position: bounds.left - container.left,
		};
		// Browser tab activation on press should not wait for the click on release.
		if(this.activeTabEl !== tab)this.setCurrentTab(tab);
	};

	private readonly onPointerMove = (event: PointerEvent) => {
		const drag = this.drag;
		if(!drag || drag.pointerId !== event.pointerId)return;
		drag.lastX = event.clientX;
		if(!drag.started){
			if(Math.abs(drag.lastX - drag.startX) < dragThreshold)return;
			drag.started = true;
			this.tabContentEl.setPointerCapture(event.pointerId);
			this.el.classList.add('chrome-tabs-is-sorting');
			drag.tab.classList.add('chrome-tab-is-dragging');
		}
		event.preventDefault();
		if(!this.frame)this.frame = requestAnimationFrame(this.updateDrag);
	};

	private readonly updateDrag = () => {
		this.frame = 0;
		const drag = this.drag;
		if(!drag || !drag.started)return;
		if(this.el.scrollWidth > this.el.clientWidth){
			const leftDistance = drag.lastX - drag.viewportLeft;
			const rightDistance = drag.viewportRight - drag.lastX;
			const previousScroll = this.el.scrollLeft;
			if(leftDistance < edgeScrollZone){
				this.el.scrollLeft -= Math.max(2, Math.round((edgeScrollZone - leftDistance) * 0.55));
			}else if(rightDistance < edgeScrollZone){
				this.el.scrollLeft += Math.max(2, Math.round((edgeScrollZone - rightDistance) * 0.55));
			}
			const scrolled = this.el.scrollLeft - previousScroll;
			if(scrolled){
				drag.containerLeft -= scrolled;
				if(!this.frame)this.frame = requestAnimationFrame(this.updateDrag);
			}
		}
		const available = Math.max(0, drag.containerWidth - drag.tabWidth);
		drag.position = Math.max(0, Math.min(available, drag.lastX - drag.containerLeft - drag.grabOffset));
		drag.tab.style.transform = `translate3d(${drag.position}px, 0, 0)`;

		const currentIndex = this.tabEls.indexOf(drag.tab);
		if(currentIndex < 0)return;
		const centers = drag.slotCenters;
		const pointerCenter = drag.position + drag.tabWidth / 2;
		let destination = currentIndex;
		let shortestDistance = Math.abs(pointerCenter - centers[currentIndex]);
		for(let index = 0; index < centers.length; index++){
			const distance = Math.abs(pointerCenter - centers[index]);
			if(distance < shortestDistance){
				shortestDistance = distance;
				destination = index;
			}
		}
		if(destination === currentIndex)return;
		const boundary = (centers[currentIndex] + centers[destination]) / 2;
		if(destination > currentIndex && pointerCenter < boundary + reorderHysteresis)return;
		if(destination < currentIndex && pointerCenter > boundary - reorderHysteresis)return;
		super.animateTabMove(drag.tab, currentIndex, destination);
	};

	private readonly onPointerUp = (event: PointerEvent) => {
		if(this.drag?.pointerId !== event.pointerId)return;
		this.drag.lastX = event.clientX;
		this.finishDrag(false);
	};

	private readonly onPointerCancel = (event: PointerEvent) => {
		if(this.drag?.pointerId !== event.pointerId)return;
		this.finishDrag(true);
	};

	private readonly onCaptureLost = (event: PointerEvent) => {
		if(this.drag?.pointerId === event.pointerId)this.finishDrag(true);
	};

	private readonly onKeyDown = (event: KeyboardEvent) => {
		if(event.key !== 'Escape' || !this.drag)return;
		event.preventDefault();
		this.finishDrag(true);
	};

	private readonly onVisibility = () => {
		if(document.hidden)this.cancelDrag();
	};

	private readonly onWheel = (event: WheelEvent) => {
		if(this.el.scrollWidth <= this.el.clientWidth)return;
		const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
		if(!amount)return;
		const before = this.el.scrollLeft;
		this.el.scrollLeft += amount;
		if(this.el.scrollLeft !== before)event.preventDefault();
	};

	private interruptSettle(): void {
		if(this.settleTimer){
			window.clearTimeout(this.settleTimer);
			this.settleTimer = 0;
		}
		if(this.settleAnimation){
			this.settleAnimation.cancel();
			this.settleAnimation = null;
		}
		this.el.classList.remove('chrome-tabs-is-sorting');
		this.tabEls.forEach((tab) => tab.classList.remove('chrome-tab-is-settling'));
	};

	private finishDrag(restoreOrder: boolean): void {
		const drag = this.drag;
		if(!drag)return;
		if(this.frame){
			cancelAnimationFrame(this.frame);
			this.frame = 0;
		}
		if(drag.started && !restoreOrder)this.updateDrag();
		if(this.frame){
			cancelAnimationFrame(this.frame);
			this.frame = 0;
		}
		this.drag = null;
		if(this.tabContentEl.hasPointerCapture(drag.pointerId))this.tabContentEl.releasePointerCapture(drag.pointerId);
		if(restoreOrder && this.tabEls.indexOf(drag.tab) !== drag.startIndex){
			super.animateTabMove(drag.tab, this.tabEls.indexOf(drag.tab), drag.startIndex);
		}
		drag.tab.classList.remove('chrome-tab-is-dragging');
		if(!drag.started){
			this.el.classList.remove('chrome-tabs-is-sorting');
			return;
		}
		const index = this.tabEls.indexOf(drag.tab);
		const target = this.tabPositions[index] ?? drag.position;
		if(!this.reducedMotion.matches && Math.abs(drag.position - target) > 0.5){
			drag.tab.classList.add('chrome-tab-is-settling');
			this.settleAnimation = drag.tab.animate([
				{transform: `translate3d(${drag.position}px, 0, 0)`},
				{transform: `translate3d(${target}px, 0, 0)`},
			], {duration: settleDuration, easing: 'cubic-bezier(.18, .82, .22, 1)'});
		}
		drag.tab.style.removeProperty('transform');
		const cleanup = () => {
			this.settleTimer = 0;
			this.interruptSettle();
		};
		if(this.reducedMotion.matches){
			cleanup();
		}else{
			this.settleTimer = window.setTimeout(cleanup, settleDuration + 25);
		}
	};

	setupEvents(): void {
		window.addEventListener('resize', this.onResize);
		this.el.addEventListener('pointerdown', this.onPointerDown, true);
		window.addEventListener('pointermove', this.onPointerMove, true);
		window.addEventListener('pointerup', this.onPointerUp, true);
		window.addEventListener('pointercancel', this.onPointerCancel, true);
		this.tabContentEl.addEventListener('lostpointercapture', this.onCaptureLost);
		window.addEventListener('keydown', this.onKeyDown, true);
		window.addEventListener('blur', this.cancelDrag);
		document.addEventListener('visibilitychange', this.onVisibility);
		this.el.addEventListener('wheel', this.onWheel, {passive:false});
	}

	// This replaces upstream Draggabilly event handlers, not Chrome Tabs layout.
	setupDraggabilly(): void {}

	layoutTabs(): void {
		// Avoid the package's 24px minimum, which leaves almost no safe drag
		// surface beside the close button. Scroll rather than crush tab targets.
		const count = this.tabEls.length;
		this.tabContentEl.style.minWidth = count ? `${count * (minReadableTabContent - 1) + 19}px` : '';
		super.layoutTabs();
	}

	setCurrentTab(tab: HTMLElement): void {
		super.setCurrentTab(tab);
		if(this.drag)return;
		const index = this.tabEls.indexOf(tab);
		if(index < 0)return;
		const left = this.tabPositions[index];
		const right = left + tab.offsetWidth;
		const scrollLeft = this.el.scrollLeft;
		const inset = 8;
		if(left < scrollLeft + inset){
			this.el.scrollLeft = Math.max(0, left - inset);
		}else if(right > scrollLeft + this.el.clientWidth - inset){
			this.el.scrollLeft = right - this.el.clientWidth + inset;
		}
	}

	animateTabMove(tab: HTMLElement, from: number, to: number): void {
		this.cancelDrag();
		this.interruptSettle();
		if(!this.reducedMotion.matches)this.el.classList.add('chrome-tabs-is-sorting');
		super.animateTabMove(tab, from, to);
		if(!this.reducedMotion.matches){
			this.settleTimer = window.setTimeout(() => this.interruptSettle(), settleDuration + 25);
		}
	}

	addTab(properties?: {id?: string; title?: string; favicon?: string | false}, options?: {animate?: boolean; background?: boolean}): void {
		this.cancelDrag();
		super.addTab(properties, options);
	}

	removeTab(tab: HTMLElement): void {
		this.cancelDrag();
		super.removeTab(tab);
	}

	cancelDrag = (): void => {
		this.finishDrag(true);
	};

	dispose(): void {
		this.cancelDrag();
		this.interruptSettle();
		window.removeEventListener('resize', this.onResize);
		this.el.removeEventListener('pointerdown', this.onPointerDown, true);
		window.removeEventListener('pointermove', this.onPointerMove, true);
		window.removeEventListener('pointerup', this.onPointerUp, true);
		window.removeEventListener('pointercancel', this.onPointerCancel, true);
		this.tabContentEl.removeEventListener('lostpointercapture', this.onCaptureLost);
		window.removeEventListener('keydown', this.onKeyDown, true);
		window.removeEventListener('blur', this.cancelDrag);
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.el.removeEventListener('wheel', this.onWheel);
		this.styleEl?.remove();
	}
}
