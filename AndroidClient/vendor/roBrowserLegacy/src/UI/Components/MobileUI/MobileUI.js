/**
 * UI/Components/MobileUI/MobileUI.js
 *
 * Mobile/Touchscreen assist UI
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
+ */

import Context from 'Core/Context.js';
import UIManager from 'UI/UIManager.js';
import GUIComponent from 'UI/GUIComponent.js';
import Preferences from 'Core/Preferences.js';
import Session from 'Engine/SessionStorage.js';
import Renderer from 'Renderer/Renderer.js';
import PACKETVER from 'Network/PacketVerManager.js';
import PACKET from 'Network/PacketStructure.js';
import EntityManager from 'Renderer/EntityManager.js';
import Network from 'Network/NetworkManager.js';
import PathFinding from 'Utils/PathFinding.js';
import Altitude from 'Renderer/Map/Altitude.js';
import Events from 'Core/Events.js';
import htmlText from './MobileUI.html?raw';
import cssText from './MobileUI.css?raw';
import glMatrix from 'Vendors/gl-matrix.js';
import Camera from 'Renderer/Camera.js';
import Client from 'Core/Client.js';
import DB from 'DB/DBManager.js';
import SkillInfo from 'DB/Skills/SkillInfo.js';
import _KEYS from 'Controls/KeyEventHandler.js'; // Currently unused, preserved for future development

const vec2 = glMatrix.vec2;
const mat2 = glMatrix.mat2;

// Object to initialize
const direction = vec2.create();
const rotate = mat2.create();

//Memory
const targetPos = [0, 0];

let movementTimer = null; // Timer for continuous joystick movement

/**
 * Create Component
 */
const MobileUI = new GUIComponent('MobileUI', cssText);

MobileUI.render = () => htmlText;

/**
 * @var {Preferences} window preferences
 */
const _preferences = Preferences.get(
	'MobileUI',
	{
		x: 0,
		y: 0,
		zIndex: 1000,
		width: window.innerWidth,
		height: window.innerHeight,
		show: false
	},
	1.0
);

let showButtons = false;
let autoTargetTimer;

/**
 * Per-player layout for the two thumb clusters (joystick + skill buttons):
 * position (px, top-left anchored) and scale. null position = use the CSS
 * default corner. Persisted so it survives map reloads / relaunch.
 */
const _layout = Preferences.get(
	'MobileUILayout',
	{
		joy: { x: null, y: null, scale: 1 },
		pad: { x: null, y: null, scale: 1 }
	},
	1.0
);
let _editMode = false;

/**
 * F1-F9 skill bindings made from the mobile UI (skill window drop, or
 * dragging a skill between F-buttons). Kept here so bindings survive map
 * reloads and so buttons can be rearranged. index (0-8) -> { skid, level }.
 */
const _fbind = Preferences.get('MobileUIFBinds', {}, 1.0);
const C_AUTOTARGET_DELAY = 500;
const C_TOUCH_CLICK_GUARD = 750;

let centerX, centerY;
let maxDistance = 0;
let normalizedX = 0;
let normalizedY = 0;

// Joystick element references (captured in setupJoystick)
let _joystickBase = null;
let _joystickThumb = null;

/**
 * Helper to bind click+touchstart on an element
 */
function bindButton(root, selector, handler) {
	const el = root.querySelector(selector);
	if (el) {
		let touchHandled = false;
		let releaseTimer = null;

		const clearGuard = () => {
			if (releaseTimer !== null) {
				clearTimeout(releaseTimer);
				releaseTimer = null;
			}
		};

		const releaseGuard = () => {
			clearGuard();
			releaseTimer = setTimeout(() => {
				releaseTimer = null;
				touchHandled = false;
			}, C_TOUCH_CLICK_GUARD);
		};

		el.addEventListener('click', event => {
			if (touchHandled) {
				touchHandled = false;
				clearGuard();
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			handler(event);
		});
		el.addEventListener('touchstart', event => {
			touchHandled = true;
			clearGuard();
			handler(event);
		});
		el.addEventListener('touchend', releaseGuard);
		el.addEventListener('touchcancel', releaseGuard);
	}
}

/**
 * Initialize UI
 */
MobileUI.init = function init() {
	const root = MobileUI.getRoot();

	// Wrench: short tap = show/hide the control bars (as before);
	//         long press (~0.6s) = enter "Edit controls" mode.
	setupWrenchButton(root);
	bindButton(root, '#fullscreenButton', e => {
		toggleFullScreen();
		stopPropagation(e);
	});

	// F-key buttons
	const fKeyMap = [
		['#f1Button', 112],
		['#f2Button', 113],
		['#f3Button', 114],
		['#f4Button', 115],
		['#f5Button', 116],
		['#f6Button', 117],
		['#f7Button', 118],
		['#f8Button', 119],
		['#f9Button', 120]
	];

	// Number key buttons
	const nKeyMap = [
		['#n1Button', 49],
		['#n2Button', 50],
		['#n3Button', 51],
		['#n4Button', 52],
		['#n5Button', 53],
		['#n6Button', 54],
		['#n7Button', 55],
		['#n8Button', 56],
		['#n9Button', 57]
	];

	// Letter key buttons
	const letterKeyMap = [
		['#qButton', 81],
		['#wButton', 87],
		['#eButton', 69],
		['#rButton', 82],
		['#tButton', 84],
		['#yButton', 89],
		['#uButton', 85],
		['#iButton', 73],
		['#oButton', 79],
		['#aButton', 65],
		['#sButton', 83],
		['#dButton', 68],
		['#fButton', 70],
		['#gButton', 71],
		['#hButton', 72],
		['#jButton', 74],
		['#kButton', 75],
		['#lButton', 76]
	];

	// F1-F9: cast on a quick TAP only, so a long-press-drag (to rearrange the
	// bound skill) or a slide-off doesn't also fire the skill.
	fKeyMap.forEach(([selector, keyCode]) => {
		bindFKey(root, selector, keyCode);
	});
	[...nKeyMap, ...letterKeyMap].forEach(([selector, keyCode]) => {
		bindButton(root, selector, e => {
			logKeyPress(keyCode);
			stopPropagation(e);
		});
	});

	bindButton(root, '#f10Button', e => {
		logKeyPress(121);
		stopPropagation(e);
	});
	bindButton(root, '#f12Button', e => {
		logKeyPress(123);
		stopPropagation(e);
	});
	bindButton(root, '#insButton', e => {
		logKeyPress(45);
		stopPropagation(e);
	});

	bindButton(root, '#toggleStatusButton', e => {
		toggleStatus();
		stopPropagation(e);
	});
	bindButton(root, '#toggleTargetingButton', e => {
		toggleTouchTargeting();
		stopPropagation(e);
	});
	bindButton(root, '#toggleAutoFollowButton', e => {
		toggleAutoFollow();
		stopPropagation(e);
	});
	bindButton(root, '#toggleAutoTargetButton', e => {
		toggleAutoTargeting();
		stopPropagation(e);
	});

	bindButton(root, '#attackButton', e => {
		attackTargeted();
		stopPropagation(e);
	});

	bindButton(root, '#pickupButton', e => {
		pickUpItem();
		stopPropagation(e);
	});

	bindButton(root, '#switchshorcutButton', e => {
		switchSkillButtons();
		stopPropagation(e);
	});

	// Chat button: open the ChatBox input and raise the Android keyboard.
	// Reuses roBrowser's own Enter-key path (shows .input, focuses .input-chatbox).
	bindButton(root, '#chatButton', e => {
		keyPress(13);
		stopPropagation(e);
	});

	// Press effect for .buttons and .FButton
	root.querySelectorAll('.buttons').forEach(btn => {
		btn.addEventListener('mousedown', e => e.target.classList.add('pressed'));
		btn.addEventListener('touchstart', e => e.target.classList.add('pressed'));
		btn.addEventListener('mouseup', e => e.target.classList.remove('pressed'));
		btn.addEventListener('touchend', e => e.target.classList.remove('pressed'));
	});

	root.querySelectorAll('.FButton').forEach(btn => {
		btn.addEventListener('mousedown', e => e.target.classList.add('pressed'));
		btn.addEventListener('touchstart', e => e.target.classList.add('pressed'));
		btn.addEventListener('mouseup', e => e.target.classList.remove('pressed'));
		btn.addEventListener('touchend', e => e.target.classList.remove('pressed'));
	});

	// Initialize the joystick - MicromeX
	setupJoystick();
	// Initialize the NPC Talk Button - MicromeX
	setupTalkToNpcButton();

	// Mobile: default TouchTargeting ON. This reuses roBrowser's own existing
	// SkillTargetSelection.set() logic (SkillTargetSelection.js) - when it's
	// on and a focus entity already exists (the monster you're already
	// attacking/have selected), an F1-F9 skill fires on it immediately with
	// no crosshair step; only falls back to manual target-tap when nothing
	// is currently targeted. Desktop/other builds are unaffected (default
	// stays false there); this only flips it when this build is mobileUI.
	if (!Session.TouchTargeting) {
		toggleTouchTargeting();
	}

	// Drop a skill dragged out of the Skill window onto an F1-F9 button to
	// bind it there (capture phase so we read window._OBJ_DRAG_ before the
	// SkillList's own touchend handler clears it).
	window.addEventListener('touchend', onSkillDragDrop, true);

	// Make the joystick + skill cluster draggable / scalable in Edit mode.
	setupClusterEditing(root);

	// Long-press a bound F-button and drag it onto another to move/swap it.
	setupFButtonDrag(root);
};

/* =====================================================================
 * "Edit controls" mode: reposition + resize the joystick and the
 * skill-button cluster to wherever the player is comfortable.
 * ===================================================================== */

function setupWrenchButton(root) {
	const wrench = root.querySelector('#toggleUIButton');
	if (!wrench) {
		return;
	}
	let lpTimer = null;
	let longFired = false;
	let moved = false;
	let startX = 0;
	let startY = 0;

	const clearLP = () => {
		if (lpTimer !== null) {
			clearTimeout(lpTimer);
			lpTimer = null;
		}
	};
	const begin = p => {
		longFired = false;
		moved = false;
		startX = p.clientX;
		startY = p.clientY;
		clearLP();
		lpTimer = setTimeout(() => {
			lpTimer = null;
			longFired = true;
			toggleEditMode();
		}, 600);
	};
	const track = p => {
		if (Math.abs(p.clientX - startX) > 10 || Math.abs(p.clientY - startY) > 10) {
			moved = true;
			clearLP();
		}
	};
	const finish = e => {
		clearLP();
		if (!longFired && !moved) {
			// plain tap -> original behaviour
			if (_editMode) {
				toggleEditMode();
			} else {
				toggleButtons();
			}
		}
		stopPropagation(e);
	};

	wrench.addEventListener('touchstart', e => begin(e.touches[0]), { passive: true });
	wrench.addEventListener('touchmove', e => track(e.touches[0]), { passive: true });
	wrench.addEventListener('touchend', finish);
	wrench.addEventListener('touchcancel', clearLP);
	wrench.addEventListener('mousedown', e => begin(e));
	wrench.addEventListener('mousemove', e => track(e));
	wrench.addEventListener('mouseup', finish);
}

function toggleEditMode() {
	_editMode = !_editMode;
	const root = MobileUI.getRoot();
	const host = root.querySelector('#MobileUI');
	if (host) {
		host.classList.toggle('mui-edit', _editMode);
	}
	if (_editMode) {
		ensureEditPanel(root);
	} else {
		_layout.save();
	}
}

function clusterEls(root) {
	return [
		[root.querySelector('#joystickContainer'), _layout.joy],
		[root.querySelector('#buttonContainer'), _layout.pad]
	];
}

/** Apply saved position + scale to both clusters. */
function applyLayout() {
	const root = MobileUI.getRoot();
	clusterEls(root).forEach(([el, cfg]) => {
		if (!el) {
			return;
		}
		if (cfg && cfg.x !== null && cfg.y !== null) {
			el.style.left = cfg.x + 'px';
			el.style.top = cfg.y + 'px';
			el.style.right = 'auto';
			el.style.bottom = 'auto';
		}
		el.style.transformOrigin = 'center center';
		el.style.transform = 'scale(' + (cfg && cfg.scale ? cfg.scale : 1) + ')';
	});
}

function clearLayoutInline(root) {
	clusterEls(root).forEach(([el]) => {
		if (!el) {
			return;
		}
		el.style.left = el.style.top = el.style.right = el.style.bottom = '';
		el.style.transform = '';
	});
}

function setupClusterEditing(root) {
	clusterEls(root).forEach(([el, cfg]) => {
		if (!el) {
			return;
		}
		let dragging = false;
		let sx = 0;
		let sy = 0;
		let ox = 0;
		let oy = 0;

		const down = e => {
			if (!_editMode) {
				return;
			}
			const p = e.touches ? e.touches[0] : e;
			const r = el.getBoundingClientRect();
			ox = r.left;
			oy = r.top;
			el.style.left = ox + 'px';
			el.style.top = oy + 'px';
			el.style.right = 'auto';
			el.style.bottom = 'auto';
			sx = p.clientX;
			sy = p.clientY;
			dragging = true;
			e.preventDefault();
			e.stopImmediatePropagation();
		};
		const move = e => {
			if (!dragging) {
				return;
			}
			const p = e.touches ? e.touches[0] : e;
			el.style.left = ox + (p.clientX - sx) + 'px';
			el.style.top = oy + (p.clientY - sy) + 'px';
			if (e.cancelable) {
				e.preventDefault();
			}
		};
		const up = () => {
			if (!dragging) {
				return;
			}
			dragging = false;
			cfg.x = parseFloat(el.style.left) || 0;
			cfg.y = parseFloat(el.style.top) || 0;
			_layout.save();
		};

		el.addEventListener('touchstart', down, { passive: false, capture: true });
		el.addEventListener('touchmove', move, { passive: false, capture: true });
		el.addEventListener('touchend', up, true);
		el.addEventListener('touchcancel', up, true);
		el.addEventListener('mousedown', down, true);
		document.addEventListener('mousemove', move);
		document.addEventListener('mouseup', up);
	});
}

function ensureEditPanel(root) {
	const host = root.querySelector('#MobileUI');
	if (!host || host.querySelector('#mui-edit-panel')) {
		return;
	}
	const p = document.createElement('div');
	p.id = 'mui-edit-panel';
	p.innerHTML =
		'<span class="mui-ep-title">Edit controls &mdash; drag to move</span>' +
		'<button data-a="joy-">Stick &minus;</button><button data-a="joy+">Stick +</button>' +
		'<button data-a="pad-">Skills &minus;</button><button data-a="pad+">Skills +</button>' +
		'<button data-a="reset">Reset</button><button data-a="done">Done</button>';
	host.appendChild(p);

	function act(a) {
		const clamp = v => Math.max(0.6, Math.min(1.8, Math.round(v * 10) / 10));
		if (a === 'joy-') {
			_layout.joy.scale = clamp((_layout.joy.scale || 1) - 0.1);
		} else if (a === 'joy+') {
			_layout.joy.scale = clamp((_layout.joy.scale || 1) + 0.1);
		} else if (a === 'pad-') {
			_layout.pad.scale = clamp((_layout.pad.scale || 1) - 0.1);
		} else if (a === 'pad+') {
			_layout.pad.scale = clamp((_layout.pad.scale || 1) + 0.1);
		} else if (a === 'reset') {
			_layout.joy = { x: null, y: null, scale: 1 };
			_layout.pad = { x: null, y: null, scale: 1 };
			clearLayoutInline(root);
		}
		applyLayout();
		_layout.save();
		if (a === 'done') {
			toggleEditMode();
		}
	}

	// roBrowser's global touch handlers eat synthesised clicks -> bind touch.
	p.querySelectorAll('button').forEach(btn => {
		muiTap(btn, () => act(btn.getAttribute('data-a')));
	});
}

/** Reliable tap binding for the shadow-DOM buttons (touch + pointer + click, deduped). */
function muiTap(node, fn) {
	if (!node) {
		return;
	}
	let lock = false;
	const h = e => {
		if (lock) {
			return;
		}
		lock = true;
		setTimeout(() => {
			lock = false;
		}, 500);
		if (e.cancelable) {
			e.preventDefault();
		}
		e.stopPropagation();
		fn(e);
	};
	node.addEventListener('touchend', h, true);
	node.addEventListener('pointerup', h, true);
	node.addEventListener('click', h, true);
}

/* =====================================================================
 * Drag a skill from the Skill window onto an on-screen F1-F9 button.
 * ===================================================================== */

function fButtonSlotAt(x, y) {
	const root = MobileUI.getRoot();
	for (let i = 1; i <= 9; i++) {
		const btn = root.querySelector('#f' + i + 'Button');
		if (!btn) {
			continue;
		}
		const r = btn.getBoundingClientRect();
		if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
			return { index: i - 1, btn: btn };
		}
	}
	return null;
}

function shortCut() {
	try {
		return UIManager.getComponent('ShortCut');
	} catch (e) {
		return null;
	}
}

/** Bind a skill to F-slot index (0-8): update ShortCut, remember it, paint. */
function bindF(index, skid, level) {
	const SC = shortCut();
	if (SC) {
		try {
			SC.addElement(index, true, skid, level);
			SC.onChange(index, true, skid, level);
		} catch (e) {
			/* ignore */
		}
	}
	_fbind[index] = { skid: skid, level: level };
	_fbind.save();
	paintF(index);
}

/** Clear an F-slot. */
function clearF(index) {
	const cur = _fbind[index];
	const SC = shortCut();
	if (SC && cur) {
		try {
			SC.removeElement(true, cur.skid, Math.floor(index / 9), cur.level);
			SC.onChange(index, 0, 0, 0);
		} catch (e) {
			/* ignore */
		}
	}
	delete _fbind[index];
	_fbind.save();
	paintF(index);
}

/** Redraw one F-button from _fbind (icon if bound, plain "Fn" if not). */
function paintF(index) {
	const root = MobileUI.getRoot();
	const btn = root && root.querySelector('#f' + (index + 1) + 'Button');
	if (!btn) {
		return;
	}
	const b = _fbind[index];
	if (b && SkillInfo[b.skid]) {
		Client.loadFile(
			DB.INTERFACE_PATH + 'item/' + SkillInfo[b.skid].Name + '.bmp',
			url => {
				btn.style.backgroundImage = 'url(' + url + ')';
				btn.style.backgroundSize = 'cover';
				btn.style.backgroundPosition = 'center';
				btn.classList.add('mui-bound');
			},
			() => {}
		);
	} else {
		btn.style.backgroundImage = '';
		btn.classList.remove('mui-bound');
	}
}

/** Skill dragged out of the Skill window and dropped on an F1-F9 button. */
function onSkillDragDrop(event) {
	const drag = window._OBJ_DRAG_;
	if (!drag || drag.type !== 'skill' || !drag.data) {
		return;
	}
	const t = event.changedTouches && event.changedTouches[0];
	if (!t) {
		return;
	}
	const hit = fButtonSlotAt(t.clientX, t.clientY);
	if (!hit) {
		return;
	}
	const sk = drag.data;
	bindF(hit.index, sk.SKID, sk.selectedLevel || sk.level || 1);
	// do NOT stopPropagation - SkillListCommon's touchend still needs to
	// remove its drag ghost + clear _OBJ_DRAG_.
}

/** After a (re)load, re-apply the saved F1-F9 bindings. */
function refreshFButtonIcons() {
	for (let i = 0; i < 9; i++) {
		const b = _fbind[i];
		if (b && b.skid) {
			// re-push into ShortCut (server hotkey sync may not have persisted)
			const SC = shortCut();
			if (SC) {
				try {
					SC.addElement(i, true, b.skid, b.level || 1);
				} catch (e) {
					/* ignore */
				}
			}
			paintF(i);
		} else {
			paintF(i);
		}
	}
}

/* ---- Drag a bound skill from one F-button to another ---- */
const _fdrag = { active: false, from: -1, ghost: null, timer: null, sx: 0, sy: 0 };

function setupFButtonDrag(root) {
	for (let i = 1; i <= 9; i++) {
		const btn = root.querySelector('#f' + i + 'Button');
		if (!btn) {
			continue;
		}
		const slot = i - 1;

		btn.addEventListener(
			'touchstart',
			e => {
				if (_editMode || !_fbind[slot]) {
					return;
				}
				const tt = e.touches[0];
				_fdrag.from = slot;
				_fdrag.sx = tt.clientX;
				_fdrag.sy = tt.clientY;
				_fdrag.active = false;
				clearTimeout(_fdrag.timer);
				_fdrag.timer = setTimeout(() => {
					_fdrag.active = true;
					const g = document.createElement('div');
					g.style.cssText =
						'position:fixed;z-index:2147483000;width:44px;height:44px;border-radius:8px;' +
						'background:' +
						(btn.style.backgroundImage || '#3a3f4b') +
						';background-size:cover;background-position:center;opacity:.85;pointer-events:none;';
					g.style.left = tt.clientX - 22 + 'px';
					g.style.top = tt.clientY - 22 + 'px';
					document.body.appendChild(g);
					_fdrag.ghost = g;
				}, 240);
			},
			{ passive: true }
		);

		btn.addEventListener(
			'touchmove',
			e => {
				if (_fdrag.from < 0) {
					return;
				}
				const tt = e.touches[0];
				if (!_fdrag.active) {
					if (Math.abs(tt.clientX - _fdrag.sx) > 12 || Math.abs(tt.clientY - _fdrag.sy) > 12) {
						clearTimeout(_fdrag.timer);
						if (!_fdrag.ghost) {
							_fdrag.from = -1;
						}
					}
					return;
				}
				if (_fdrag.ghost) {
					_fdrag.ghost.style.left = tt.clientX - 22 + 'px';
					_fdrag.ghost.style.top = tt.clientY - 22 + 'px';
				}
				if (e.cancelable) {
					e.preventDefault();
				}
			},
			{ passive: false }
		);

		btn.addEventListener('touchend', e => {
			clearTimeout(_fdrag.timer);
			if (_fdrag.ghost) {
				_fdrag.ghost.remove();
				_fdrag.ghost = null;
			}
			if (_fdrag.active && _fdrag.from >= 0) {
				const tt = e.changedTouches[0];
				const hit = fButtonSlotAt(tt.clientX, tt.clientY);
				if (hit && hit.index !== _fdrag.from) {
					const src = _fbind[_fdrag.from];
					const dst = _fbind[hit.index];
					bindF(hit.index, src.skid, src.level);
					if (dst) {
						bindF(_fdrag.from, dst.skid, dst.level); // swap
					} else {
						clearF(_fdrag.from); // move
					}
				}
				e.stopPropagation(); // don't also fire the F-key press
			}
			_fdrag.active = false;
			_fdrag.from = -1;
		});

		btn.addEventListener('touchcancel', () => {
			clearTimeout(_fdrag.timer);
			if (_fdrag.ghost) {
				_fdrag.ghost.remove();
				_fdrag.ghost = null;
			}
			_fdrag.active = false;
			_fdrag.from = -1;
		});
	}
}

/**
 * Logs the key press to the console and performs the key press action.
 * @param {number} keyCode - The key code of the pressed key.
 */
function logKeyPress(keyCode) {
	keyPress(keyCode);
}

/**
 * F1-F9 button: fire the F-key on a quick tap; stay quiet during a
 * long-press / drag (used to rearrange the bound skill) or a slide-off.
 */
function bindFKey(root, selector, keyCode) {
	const el = root.querySelector(selector);
	if (!el) {
		return;
	}
	let t0 = 0;
	let sx = 0;
	let sy = 0;
	let candidate = false;
	// Dedupe lock: without this, touchend firing keyPress() AND the browser's
	// synthesised ~300ms-later click ALSO firing it sent every tap through
	// twice (a real double-cast/duplicate target-selection per tap, worse on
	// an actual double-tap). Same pattern as muiTap() above.
	let lock = false;
	const unlockSoon = () => {
		setTimeout(() => {
			lock = false;
		}, 500);
	};

	el.addEventListener(
		'touchstart',
		e => {
			const p = e.touches[0];
			t0 = Date.now();
			sx = p.clientX;
			sy = p.clientY;
			candidate = true;
		},
		{ passive: true }
	);
	el.addEventListener(
		'touchmove',
		e => {
			const p = e.touches[0];
			if (Math.abs(p.clientX - sx) > 12 || Math.abs(p.clientY - sy) > 12) {
				candidate = false;
			}
		},
		{ passive: true }
	);
	el.addEventListener('touchend', e => {
		const quick = Date.now() - t0 < 500;
		if (candidate && quick && !_fdrag.active && !_editMode && !lock) {
			lock = true;
			unlockSoon();
			if (e.cancelable) {
				e.preventDefault(); // suppress the ghost click for this tap
			}
			keyPress(keyCode);
		}
		candidate = false;
		stopPropagation(e);
	});
	// mouse fallback (emulator / desktop) - only fires for a real mouse click,
	// never for the touch-synthesised one (that was just preventDefault'd above)
	el.addEventListener('click', e => {
		if (!_fdrag.active && !_editMode && !lock) {
			lock = true;
			unlockSoon();
			keyPress(keyCode);
		}
		stopPropagation(e);
	});
}

/**
 * Toggles full screen display
 */
function toggleFullScreen() {
	if (!Context.isFullScreen()) {
		Context.requestFullScreen();
	} else {
		Context.cancelFullScreen();
	}
}

/**
 * Emulates a keypress event
 *
 * @param {number} keyId
 */
function keyPress(k) {
	const roWindow = window;
	roWindow.document.getElementsByTagName('body')[0].focus();
	roWindow.dispatchEvent(
		new KeyboardEvent('keydown', {
			keyCode: k,
			which: k
		})
	);
}

/**
 * Toggles MobileUI button bars visibility (and thus buttons)
 */
function toggleButtons() {
	const root = MobileUI.getRoot();

	if (showButtons) {
		// Hide all bars and buttons
		[
			'#topBar',
			'#leftBar',
			'#rightBar',
			'#joystickContainer',
			'#buttonContainer',
			'#attackButton',
			'#pickupButton',
			'#talktonpcButton',
			'#switchshorcutButton',
			'#chatButton'
		].forEach(sel => {
			const el = root.querySelector(sel);
			if (el) {
				el.classList.add('disabled');
			}
		});

		// Hide F-key buttons
		for (let i = 1; i <= 9; i++) {
			const fBtn = root.querySelector(`#f${i}Button`);
			if (fBtn) {
				fBtn.classList.add('disabled');
			}
		}

		// Hide number, letter buttons
		['n', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'].forEach(key => {
			const btn =
				root.querySelector(`#${key}Button`) || root.querySelector(`#${key}${key === 'n' ? '' : 'B'}utton`);
			if (btn) {
				btn.classList.add('disabled');
			}
		});

		// Hide number buttons specifically
		for (let i = 1; i <= 9; i++) {
			const nBtn = root.querySelector(`#n${i}Button`);
			if (nBtn) {
				nBtn.classList.add('disabled');
			}
		}

		// Hide letter buttons
		['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'].forEach(key => {
			const btn = root.querySelector(`#${key}Button`);
			if (btn) {
				btn.classList.add('disabled');
			}
		});

		if (Session.TouchTargeting) {
			toggleTouchTargeting();
		}

		showButtons = false;
	} else {
		[
			'#topBar',
			'#leftBar',
			'#rightBar',
			'#joystickContainer',
			'#buttonContainer',
			'#attackButton',
			'#pickupButton',
			'#talktonpcButton',
			'#switchshorcutButton',
			'#chatButton'
		].forEach(sel => {
			const el = root.querySelector(sel);
			if (el) {
				el.classList.remove('disabled');
			}
		});

		for (let i = 1; i <= 9; i++) {
			const fBtn = root.querySelector(`#f${i}Button`);
			if (fBtn) {
				fBtn.classList.remove('disabled');
			}
		}

		showButtons = true;
	}
}

/**
 * Reveal the persistent mobile controls (joystick, attack, chat, quick buttons)
 * without needing the player to tap the wrench toggle first. Safe to call
 * repeatedly - it only shows, never hides.
 */
function revealCoreControls() {
	if (!showButtons) {
		toggleButtons();
	}
	// belt-and-suspenders: make sure the joystick + attack are visible even if
	// showButtons was already true but a prior toggle left them hidden.
	const root = MobileUI.getRoot();
	['#joystickContainer', '#buttonContainer', '#attackButton', '#chatButton'].forEach(sel => {
		const el = root && root.querySelector(sel);
		if (el) {
			el.classList.remove('disabled');
		}
	});
}

/**
 * Toggles switch skill
 */
function switchSkillButtons() {
	const root = MobileUI.getRoot();

	const skillSets = [
		[
			'#f1Button',
			'#f2Button',
			'#f3Button',
			'#f4Button',
			'#f5Button',
			'#f6Button',
			'#f7Button',
			'#f8Button',
			'#f9Button'
		],
		[
			'#n1Button',
			'#n2Button',
			'#n3Button',
			'#n4Button',
			'#n5Button',
			'#n6Button',
			'#n7Button',
			'#n8Button',
			'#n9Button'
		],
		['#qButton', '#wButton', '#eButton', '#rButton', '#tButton', '#yButton', '#uButton', '#iButton', '#oButton'],
		['#aButton', '#sButton', '#dButton', '#fButton', '#gButton', '#hButton', '#jButton', '#kButton', '#lButton']
	];

	const currentSetIndex = switchSkillButtons.currentSetIndex || 0;
	const nextSetIndex = (currentSetIndex + 1) % skillSets.length;

	// Hide all skill sets
	skillSets.flat().forEach(selector => {
		const el = root.querySelector(selector);
		if (el) {
			el.classList.add('disabled');
		}
	});

	// Show only the next set
	skillSets[nextSetIndex].forEach(selector => {
		const el = root.querySelector(selector);
		if (el) {
			el.classList.remove('disabled');
		}
	});

	switchSkillButtons.currentSetIndex = nextSetIndex;
}

/**
 * Toggles status view
 */
function toggleStatus() {
	// StatusIcons is a separate component outside this shadow DOM
	const statusIcons = document.querySelector('#StatusIcons');
	if (statusIcons) {
		statusIcons.style.display = statusIcons.style.display === 'none' ? '' : 'none';
	}
}

/**
 * Toggles touch targeting
 */
function toggleTouchTargeting() {
	const root = MobileUI.getRoot();

	if (Session.TouchTargeting) {
		root.querySelector('#toggleTargetingButton').classList.remove('active');
		root.querySelector('#toggleAutoFollowButton').classList.add('disabled');
		root.querySelector('#toggleAutoTargetButton').classList.add('disabled');

		if (Session.AutoTargeting) {
			toggleAutoTargeting();
		}

		Session.TouchTargeting = false;
	} else {
		root.querySelector('#toggleTargetingButton').classList.add('active');
		root.querySelector('#toggleAutoFollowButton').classList.remove('disabled');
		root.querySelector('#toggleAutoTargetButton').classList.remove('disabled');

		Session.TouchTargeting = true;
	}
}

/**
 * Toggles automatic targeting
 */
function toggleAutoTargeting() {
	const root = MobileUI.getRoot();

	if (Session.AutoTargeting) {
		root.querySelector('#toggleAutoTargetButton').classList.remove('active');
		Session.AutoTargeting = false;
	} else {
		root.querySelector('#toggleAutoTargetButton').classList.add('active');
		Session.AutoTargeting = true;
		autoTarget();
	}
}

/**
 * Toggles auto follow
 */
function toggleAutoFollow() {
	const root = MobileUI.getRoot();

	if (Session.autoFollow) {
		root.querySelector('#toggleAutoFollowButton').classList.remove('active');
		Session.autoFollow = false;
	} else {
		const entityFocus = EntityManager.getFocusEntity();
		if (entityFocus) {
			root.querySelector('#toggleAutoFollowButton').classList.add('active');
			Session.autoFollow = true;
			Session.autoFollowTarget = entityFocus;
			onAutoFollow();
		}
	}
}

/**
 * Attacks a targeted enemy (if present)
 */
function attackTargeted() {
	const main = Session.Entity;
	let pkt;

	let entityFocus = EntityManager.getFocusEntity();

	if (!entityFocus || entityFocus.action === entityFocus.ACTION.DIE) {
		autoTarget();
		entityFocus = EntityManager.getFocusEntity();
	}

	if (entityFocus) {
		const out = [];
		const count = PathFinding.search(
			main.position[0] | 0,
			main.position[1] | 0,
			entityFocus.position[0] | 0,
			entityFocus.position[1] | 0,
			main.attack_range + 1,
			out
		);

		if (!count) {
			return true;
		}

		if (PACKETVER.value >= 20180307) {
			pkt = new PACKET.CZ.REQUEST_ACT2();
		} else {
			pkt = new PACKET.CZ.REQUEST_ACT();
		}
		pkt.action = 7;
		pkt.targetGID = entityFocus.GID;

		if (count < 2) {
			Network.sendPacket(pkt);
			return true;
		}

		Session.moveAction = pkt;

		if (PACKETVER.value >= 20180307) {
			pkt = new PACKET.CZ.REQUEST_MOVE2();
		} else {
			pkt = new PACKET.CZ.REQUEST_MOVE();
		}
		pkt.dest[0] = out[(count - 1) * 2 + 0];
		pkt.dest[1] = out[(count - 1) * 2 + 1];
		Network.sendPacket(pkt);
	}
}

/**
 * Automatically targeting the closest enemy
 */
function autoTarget() {
	const Player = Session.Entity;

	const entityFocus = EntityManager.getFocusEntity();

	const closestEntity = EntityManager.getClosestEntity(Player, Session.Entity.constructor.TYPE_MOB);

	if (closestEntity) {
		if (entityFocus && closestEntity.GID !== entityFocus.GID) {
			entityFocus.onFocusEnd();
			EntityManager.setFocusEntity(null);

			closestEntity.onFocus();
			EntityManager.setFocusEntity(closestEntity);
		} else if (!entityFocus) {
			closestEntity.onFocus();
			EntityManager.setFocusEntity(closestEntity);
		}
	}

	if (Session.AutoTargeting && Session.Playing) {
		startAutoTarget();
	}
}

/**
 * Starting automatic targeting cycle
 */
function startAutoTarget() {
	autoTargetTimer = window.setTimeout(autoTarget, C_AUTOTARGET_DELAY);
}

/**
 * Stopping automatic targeting cycle
 * Currently unused, preserved for future development
 */
function _stopAutoTarget() {
	window.clearTimeout(autoTargetTimer);
}

/**
 * Stop event propagation
 */
function stopPropagation(event) {
	if (event && typeof event.preventDefault === 'function') {
		event.preventDefault();
	}
	event.stopImmediatePropagation();
	return false;
}

/**
 * Auto follow logic
 */
function onAutoFollow() {
	const root = MobileUI.getRoot();

	if (Session.autoFollow) {
		const player = Session.Entity;
		const target = Session.autoFollowTarget;

		const dx = Math.abs(player.position[0] - target.position[0]);
		const dy = Math.abs(player.position[1] - target.position[1]);

		if (dx > 1 || dy > 1) {
			const dest = [0, 0];

			if (checkFreeCell(Math.round(target.position[0]), Math.round(target.position[1]), 1, dest)) {
				let pkt;
				if (PACKETVER.value >= 20180307) {
					pkt = new PACKET.CZ.REQUEST_MOVE2();
				} else {
					pkt = new PACKET.CZ.REQUEST_MOVE();
				}
				pkt.dest = dest;
				Network.sendPacket(pkt);
			}
		}

		Events.setTimeout(onAutoFollow, 500);
	} else {
		root.querySelector('#toggleAutoFollowButton').classList.remove('active');
	}
}

/**
 * Picks up the nearest item - MicromeX
 */
function pickUpItem() {
	const player = Session.Entity;

	if (!player) {
		return;
	}

	const closestItem = EntityManager.getClosestEntity(player, Session.Entity.constructor.TYPE_ITEM);

	if (!closestItem) {
		return;
	}

	let dx = Math.abs(player.position[0] - closestItem.position[0]);
	let dy = Math.abs(player.position[1] - closestItem.position[1]);
	if (dx < 0) {
		dx = -dx;
	}
	if (dy < 0) {
		dy = -dy;
	}

	if ((dx < dy ? dy : dx) > 2) {
		const dest = [0, 0];

		if (checkFreeCell(Math.round(closestItem.position[0]), Math.round(closestItem.position[1]), 1, dest)) {
			let pkt;
			if (PACKETVER.value >= 20180307) {
				pkt = new PACKET.CZ.REQUEST_MOVE2();
			} else {
				pkt = new PACKET.CZ.REQUEST_MOVE();
			}
			pkt.dest = dest;
			Network.sendPacket(pkt);
		}
	}

	let pickUpPacket;

	if (PACKETVER.value >= 20180307) {
		pickUpPacket = new PACKET.CZ.ITEM_PICKUP2();
	} else {
		pickUpPacket = new PACKET.CZ.ITEM_PICKUP();
	}

	pickUpPacket.ITAID = closestItem.GID;

	Network.sendPacket(pickUpPacket);
}

/**
 * Joystick handling for both mouse and touch input.
 *
 * Multi-touch aware: the joystick locks onto the exact pointer (touch identifier
 * or "mouse") that started on it, and ignores every other pointer. This lets the
 * left thumb drive the joystick while the right thumb taps skills without the
 * stick jumping to the skill touch.
 */
let _joyPointerId = null; // touch.identifier of the finger driving the joystick, or 'mouse'

function setupJoystick() {
	const root = MobileUI.getRoot();
	_joystickBase = root.querySelector('#joystickBase');
	_joystickThumb = root.querySelector('#joystickThumb');

	maxDistance = (_joystickBase.getBoundingClientRect().width || _joystickBase.offsetWidth) / 2;

	// Accept the touch anywhere on the joystick zone, not only the small thumb.
	const zone = root.querySelector('#joystickContainer') || _joystickBase;
	zone.addEventListener('mousedown', startDrag);
	zone.addEventListener('touchstart', startDrag, { passive: false });
}

/** Pick the pointer we are tracking out of a touch event, or null. */
function pickJoyTouch(event) {
	if (!event.changedTouches && !event.touches) {
		return event; // mouse
	}
	const list = event.touches && event.touches.length ? event.touches : event.changedTouches;
	for (let i = 0; i < list.length; ++i) {
		if (list[i].identifier === _joyPointerId) {
			return list[i];
		}
	}
	return null;
}

function startDrag(event) {
	// In "Edit controls" mode the joystick is being repositioned, not used.
	if (_editMode) {
		return;
	}
	// Already tracking a pointer? ignore additional presses on the zone.
	if (_joyPointerId !== null) {
		return;
	}
	event.preventDefault();

	let pointer;
	if (event.changedTouches && event.changedTouches.length) {
		pointer = event.changedTouches[0];
		_joyPointerId = pointer.identifier;
	} else {
		pointer = event;
		_joyPointerId = 'mouse';
	}

	const rect = _joystickBase.getBoundingClientRect();
	if (rect.width) {
		maxDistance = rect.width / 2;
	}
	centerX = rect.left + rect.width / 2;
	centerY = rect.top + rect.height / 2;

	document.addEventListener('mousemove', moveJoystick);
	document.addEventListener('mouseup', stopDrag);
	document.addEventListener('touchmove', moveJoystick, { passive: false });
	document.addEventListener('touchend', stopDrag);
	document.addEventListener('touchcancel', stopDrag);

	updateJoystick(pointer);
	startMovement();
}

function moveJoystick(event) {
	const pointer = pickJoyTouch(event);
	if (!pointer) {
		return; // this event is for a different finger
	}
	if (event.cancelable) {
		event.preventDefault();
	}
	updateJoystick(pointer);
}

function updateJoystick(pointer) {
	const deadZone = 12;

	const deltaX = pointer.clientX - centerX;
	const deltaY = pointer.clientY - centerY;

	const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);
	const angle = Math.atan2(deltaY, deltaX);

	const offsetX = Math.cos(angle) * distance;
	const offsetY = Math.sin(angle) * distance;

	_joystickThumb.style.transform = `translate(${offsetX}px, ${offsetY}px)`;

	if (distance < deadZone) {
		normalizedX = 0;
		normalizedY = 0;
		return;
	}

	// analog magnitude beyond the dead zone, renormalised to 0..1
	const mag = (distance - deadZone) / (maxDistance - deadZone);
	normalizedX = Math.cos(angle) * mag;
	normalizedY = -Math.sin(angle) * mag;
}

function stopDrag(event) {
	// For touch, only release when OUR finger lifted.
	if (event && event.changedTouches) {
		let ours = false;
		for (let i = 0; i < event.changedTouches.length; ++i) {
			if (event.changedTouches[i].identifier === _joyPointerId) {
				ours = true;
				break;
			}
		}
		if (!ours) {
			return;
		}
	}

	_joyPointerId = null;
	_joystickThumb.style.transform = 'translate(0, 0)';
	normalizedX = 0;
	normalizedY = 0;

	stopMovement();

	document.removeEventListener('mousemove', moveJoystick);
	document.removeEventListener('mouseup', stopDrag);
	document.removeEventListener('touchmove', moveJoystick);
	document.removeEventListener('touchend', stopDrag);
	document.removeEventListener('touchcancel', stopDrag);
}

function startMovement() {
	const tileSize = 3;

	if (movementTimer) {
		clearInterval(movementTimer);
	}

	const executeMove = () => {
		if (normalizedX !== 0 || normalizedY !== 0) {
			moveCharacter(normalizedX, normalizedY, tileSize);
		}
	};

	executeMove();

	movementTimer = setInterval(executeMove, 100);
}

function stopMovement() {
	if (movementTimer) {
		clearInterval(movementTimer);
		movementTimer = null;
	}
}

/**
 * Moves the character to a new tile and waits for the movement to complete.
 * @param {number} x - Normalized x-axis input (-1 to 1)
 * @param {number} y - Normalized y-axis input (-1 to 1)
 * @param {number} tileSize - The size of each tile in the game world
 */
function moveCharacter(x, y, tileSize) {
	const player = Session.Entity;

	if (!player) {
		return;
	}

	direction[0] = x;
	direction[1] = y;

	mat2.identity(rotate);
	mat2.rotate(rotate, rotate, ((-Camera.direction * 45) / 180) * Math.PI);

	vec2.transformMat2(direction, direction, rotate);

	const newPos = [
		Math.round(player.position[0] + direction[0] * tileSize),
		Math.round(player.position[1] + direction[1] * tileSize)
	];

	const dest = [0, 0];

	if (checkFreeCell(newPos[0], newPos[1], 5, dest)) {
		if (targetPos[0] !== dest[0] || targetPos[1] !== dest[1]) {
			targetPos[0] = dest[0];
			targetPos[1] = dest[1];

			let movePacket;
			if (PACKETVER.value >= 20180307) {
				movePacket = new PACKET.CZ.REQUEST_MOVE2();
			} else {
				movePacket = new PACKET.CZ.REQUEST_MOVE();
			}

			movePacket.dest[0] = dest[0];
			movePacket.dest[1] = dest[1];

			Network.sendPacket(movePacket);
		}
	}
}

/**
 * Talk to NPC Button Function - MicromeX
 */
function setupTalkToNpcButton() {
	const root = MobileUI.getRoot();
	const talkButton = root.querySelector('#talktonpcButton');

	function findNearestNpc() {
		const player = Session.Entity;

		if (!player) {
			return null;
		}

		let nearestNpc = null;
		let minDistance = 3;

		EntityManager.forEach(entity => {
			if (entity.objecttype === entity.constructor.TYPE_NPC) {
				const dx = entity.position[0] - player.position[0];
				const dy = entity.position[1] - player.position[1];
				const distance = Math.sqrt(dx ** 2 + dy ** 2);

				if (distance <= minDistance) {
					minDistance = distance;
					nearestNpc = entity;
				}
			}
		});

		return nearestNpc;
	}

	function talkToNearestNpc() {
		const nearestNpc = findNearestNpc();

		if (!nearestNpc) {
			return;
		}

		const talkPacket = new PACKET.CZ.CONTACTNPC();
		talkPacket.NAID = nearestNpc.GID;

		Network.sendPacket(talkPacket);
	}

	talkButton.addEventListener('click', talkToNearestNpc);
}

/**
 * Search free cells around a position
 *
 * @param {number} x
 * @param {number} y
 * @param {number} range
 * @param {array} out
 */
function checkFreeCell(x, y, range, out) {
	let _x, _y, r;
	const d_x = Session.Entity.position[0] < x ? -1 : 1;
	const d_y = Session.Entity.position[1] < y ? -1 : 1;

	for (r = 0; r <= range; ++r) {
		for (_x = -r; _x <= r; ++_x) {
			for (_y = -r; _y <= r; ++_y) {
				if (isFreeCell(x + _x * d_x, y + _y * d_y)) {
					out[0] = x + _x * d_x;
					out[1] = y + _y * d_y;
					return true;
				}
			}
		}
	}

	return false;
}

/**
 * Does a cell is free (walkable, and no entity on)
 *
 * @param {number} x
 * @param {number} y
 * @param {returns} is free
 */
function isFreeCell(x, y) {
	if (!(Altitude.getCellType(x, y) & Altitude.TYPE.WALKABLE)) {
		return false;
	}

	let free = true;

	EntityManager.forEach(entity => {
		if (
			entity.objecttype !== entity.constructor.TYPE_EFFECT &&
			entity.objecttype !== entity.constructor.TYPE_UNIT &&
			entity.objecttype !== entity.constructor.TYPE_TRAP &&
			Math.round(entity.position[0]) === x &&
			Math.round(entity.position[1]) === y
		) {
			free = false;
			return false;
		}

		return true;
	});

	return free;
}

/**
 * Apply preferences once append to body
 */
MobileUI.onAppend = function onAppend() {
	if (Session.isTouchDevice) {
		this._host.style.display = 'block';
		// The controls must be usable the instant the player is in the map -
		// no wrench tap, no gesture. This runs on every map (re)load.
		revealCoreControls();
		// Re-apply the player's custom joystick / skill-cluster placement,
		// and mirror the current F1-F9 shortcut bindings onto the buttons.
		applyLayout();
		refreshFButtonIcons();
		setTimeout(refreshFButtonIcons, 2500);
	} else {
		this._host.style.display = 'none';
	}

	this._host.style.top = '0px';
	this._host.style.left = '0px';
	this._host.style.zIndex = '1000';
	// Width/height handled by CSS :host { width:100%; height:100% }
	// so the overlay always matches the viewport on resize/rotate.
};

/**
 * Process shortcut
 *
 * @param {object} key
 */
MobileUI.onShortCut = function onShortCut(key) {
	switch (key.cmd) {
		case 'SHOW':
			Session.isTouchDevice = true;
			this.show();
			break;
		case 'TOGGLE':
			toggleButtons();
			break;
		case 'TG':
			toggleTouchTargeting();
			break;
		case 'AT':
			toggleAutoTargeting();
			break;
		case 'ATK':
			attackTargeted();
			break;
	}
};

/**
 * Removes MobileUI
 */
MobileUI.onRemove = function onRemove() {
	_preferences.y = 0;
	_preferences.x = 0;
	_preferences.zIndex = 1000;
	_preferences.width = Renderer.width;
	_preferences.height = Renderer.height;
	_preferences.save();

	if (Session.AutoTargeting) {
		toggleAutoTargeting();
	}
};

/**
 * Shows MobileUI
 */
MobileUI.show = function show() {
	Session.isTouchDevice = true;
	this._host.style.display = 'block';
	revealCoreControls();
};

/**
 * Create component and export it
 */
export default UIManager.addComponent(MobileUI);
