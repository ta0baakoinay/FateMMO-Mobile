/**
 * UI/Components/SkillDescription/SkillDescription.js
 *
 * Skill Information
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */

import DB from 'DB/DBManager.js';
import Renderer from 'Renderer/Renderer.js';
import KEYS from 'Controls/KeyEventHandler.js';
import Mouse from 'Controls/MouseEventHandler.js';
import UIManager from 'UI/UIManager.js';
import GUIComponent from 'UI/GUIComponent.js';
import htmlText from './SkillDescription.html?raw';
import cssText from './SkillDescription.css?raw';

/**
 * Whitelist of allowed HTML tags in skill descriptions
 */
const _allowedTags = new Set(['font', 'i', 'b']);

/**
 * skilldescript.lub's first line is authored as "<Korean name>(<English name>)"
 * for every skill checked so far (e.g. "그림투스(Grimtooth)", "인베넘(Envenom)") -
 * a real bilingual field baked into the source data itself, not something we're
 * inventing. Extract just the English part for the title; there is no
 * equivalent English text anywhere else in this string (the body - MAX Lv,
 * requirements, category, per-level effects - is Korean-only in every skill
 * checked, and the server has no separate English skill data file at all,
 * unlike items). Returns null if the first line doesn't match (so the caller
 * can fall back to showing the raw line unchanged rather than hiding it).
 */
function _extractEnglishSkillName(rawDescription) {
	const firstLine = String(rawDescription).split('\n')[0] || '';
	const match = firstLine.match(/\(([A-Za-z][A-Za-z0-9 '\-]*)\)\s*$/);
	return match ? match[1].trim() : null;
}

/**
 * Sanitize and format RO text with ^rrggbb color codes, ^nItemID^NNN
 * item name substitution, and newline conversion.
 *
 * @param {string} value - raw skill description text
 * @returns {string} safe HTML string
 */
function _formatROText(value) {
	const tmp = document.createElement('div');
	tmp.innerHTML = String(value);

	tmp.querySelectorAll('*').forEach(el => {
		if (!_allowedTags.has(el.tagName.toLowerCase())) {
			el.replaceWith(...el.childNodes);
		}
	});

	let txt = tmp.innerHTML;

	let result;
	const colorReg = /\^([a-fA-F0-9]{6})/;
	while ((result = colorReg.exec(txt))) {
		txt = txt.replace(result[0], `<span style="color:#${result[1]}">`) + '</span>';
	}

	const itemReg = /\^nItemID\^(\d+)/g;
	while ((result = itemReg.exec(txt))) {
		txt = txt.replace(result[0], DB.getItemInfo(result[1]).identifiedDisplayName);
	}

	txt = txt.replace(/\n/g, '<br/>');

	return txt;
}

/**
 * Create Component
 */
const SkillDescription = new GUIComponent('SkillDescription', cssText);

SkillDescription.render = () => htmlText;

/**
 * SkillDescription unique id
 */
SkillDescription.uid = -1;

/**
 * Possible to exit using ESCAPE
 */
SkillDescription.onKeyDown = function onKeyDown(event) {
	if ((event.which === KEYS.ESCAPE || event.key === 'Escape') && this._host.style.display !== 'none') {
		this.remove();
	}
};

/**
 * Once removed
 */
SkillDescription.onRemove = function onRemove() {
	this.uid = -1;
};

/**
 * Initialize UI
 */
SkillDescription.init = function init() {
	const root = this.getRoot();

	const closeBtn = root.querySelector('.close');
	if (closeBtn) {
		closeBtn.addEventListener('mousedown', e => e.stopImmediatePropagation());
		closeBtn.addEventListener('click', () => SkillDescription.remove());
	}

	// Explicit alternative to SkillListCommon.js's drag-to-hotbar gesture
	// (a 300ms hold + <10px movement tolerance, easy to miss on a real
	// touchscreen) - reuses the same real functions the desktop shortcut
	// bar / F-keys already call, just from a tap instead of a drag/keypress.
	const useBtn = root.querySelector('.action-use');
	if (useBtn) {
		useBtn.addEventListener('mousedown', e => e.stopImmediatePropagation());
		useBtn.addEventListener('click', () => {
			if (SkillDescription.uid < 0) {
				return;
			}
			try {
				UIManager.getComponent('ShortCut').useSkill(SkillDescription.uid, SkillDescription._level || 1);
			} catch (e) {
				/* ShortCut not available (e.g. desktop-only build variant) */
			}
		});
	}

	const hotkeyBtn = root.querySelector('.action-hotkey');
	if (hotkeyBtn) {
		hotkeyBtn.addEventListener('mousedown', e => e.stopImmediatePropagation());
		hotkeyBtn.addEventListener('click', () => {
			if (SkillDescription.uid < 0) {
				return;
			}
			try {
				UIManager.getComponent('MobileUI').beginHotkeyPick(SkillDescription.uid, SkillDescription._level || 1);
			} catch (e) {
				/* MobileUI not available (desktop-only build variant) */
			}
			SkillDescription.remove();
		});
	}

	this.draggable();
};

/**
 * Add content to the box
 *
 * @param {number} skill id
 */
SkillDescription.setSkill = function setSkill(id) {
	this.uid = id;
	this._level = 1;
	try {
		const skill = UIManager.getComponent('SkillList').getSkillById(id);
		this._level = (skill && (skill.selectedLevel || skill.level)) || 1;
	} catch (e) {
		/* SkillList not available yet - fall back to level 1 */
	}

	const root = this.getRoot();
	const raw = DB.getSkillDescription(id);
	const lines = String(raw).split('\n');
	const englishName = _extractEnglishSkillName(raw);

	const titleEl = root.querySelector('.title');
	if (titleEl) {
		// Real data, not invented: skilldescript.lub's first line is authored
		// as "<Korean name>(<English name>)" - use the English part as the
		// title. If a skill's first line doesn't match that pattern (none
		// seen so far, but not guaranteed for every skill), fall back to
		// showing that first line as-is rather than silently dropping it.
		titleEl.textContent = englishName || lines[0] || '';
	}

	const content = root.querySelector('.content');
	if (content) {
		// Body (MAX Lv, requirements, category, full description, per-level
		// effects) has no English anywhere in this data - confirmed both by
		// inspecting every line here and by an exhaustive server-side search
		// for a separate English skill file (none exists, unlike items).
		// Left as-is rather than inventing a translation.
		content.innerHTML = _formatROText(lines.slice(1).join('\n'));
	}

	const hostWidth = this._host.getBoundingClientRect().width;
	const hostHeight = this._host.getBoundingClientRect().height;

	this._host.style.top = `${Math.min(Mouse.screen.y + 10, Renderer.height - hostHeight)}px`;
	this._host.style.left = `${Math.min(Mouse.screen.x + 10, Renderer.width - hostWidth)}px`;
};

/**
 * Create component and export it
 */
export default UIManager.addComponent(SkillDescription);
