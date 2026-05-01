// ==UserScript==
// @name         Advanced filter saved settings
// @namespace    Wolf 2.0
// @version      0.1.1
// @description  Save and recall named Advanced filter input presets.
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Advanced%20filter%20saved%20settings.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Advanced%20filter%20saved%20settings.user.js
// ==/UserScript==

(function () {
    'use strict';

    var SCRIPT_ID = 'dc-advanced-filter-saved-settings';
    var STYLE_ID = SCRIPT_ID + '-style';
    var BUTTON_CLASS = 'dc-afss-button';
    var PANEL_ID = SCRIPT_ID + '-panel';
    var STORAGE_KEY = 'dc_advanced_filter_saved_settings_v1';
    var TITLE_RE = /^\s*advanced\s+filters?\s*$/i;
    var CONTROL_SELECTOR = 'input, select, textarea';
    var SEMANTIC_DROPDOWN_SELECTOR = '.ui.dropdown[role="combobox"], [role="combobox"].ui.dropdown';

    var observer = null;
    var rescanTimer = 0;
    var activeTitle = null;
    var activePanel = null;
    var outsideClickHandler = null;
    var keydownHandler = null;

    function safeJsonParse(raw, fallback) {
        try {
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function readStore() {
        var store = {};
        try {
            store = safeJsonParse(localStorage.getItem(STORAGE_KEY), {});
        } catch (e) {}
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return {};
        }
        return store;
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store || {}));
            return true;
        } catch (e) {
            return false;
        }
    }

    function pageKey() {
        return location.origin + location.pathname;
    }

    function readPagePresets() {
        var store = readStore();
        var key = pageKey();
        var list = store[key];
        return Array.isArray(list) ? list : [];
    }

    function writePagePresets(list) {
        var store = readStore();
        store[pageKey()] = Array.isArray(list) ? list : [];
        return writeStore(store);
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(String(value));
        }
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function htmlEscape(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function textOf(el) {
        return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    }

    function visible(el) {
        if (!el || !el.isConnected) {
            return false;
        }
        var rects = el.getClientRects();
        if (!rects || !rects.length) {
            return false;
        }
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        return !style || (style.visibility !== 'hidden' && style.display !== 'none');
    }

    function isTitleCandidate(el) {
        if (!el || !visible(el) || el.querySelector('.' + BUTTON_CLASS)) {
            return false;
        }
        if (!TITLE_RE.test(textOf(el))) {
            return false;
        }
        var tag = (el.tagName || '').toLowerCase();
        if (/^h[1-6]$/.test(tag) || tag === 'legend' || tag === 'summary' || tag === 'label') {
            return true;
        }
        return (el.children || []).length <= 2;
    }

    function findAdvancedFilterTitle() {
        var candidates = document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,summary,label,div,span,p');
        var best = null;
        var bestScore = -1;
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (!isTitleCandidate(el)) {
                continue;
            }
            var tag = (el.tagName || '').toLowerCase();
            var score = /^h[1-6]$/.test(tag) ? 30 : tag === 'legend' ? 25 : tag === 'summary' ? 20 : 10;
            if (score > bestScore) {
                best = el;
                bestScore = score;
            }
        }
        return best;
    }

    function controlsIn(root) {
        if (!root || !root.querySelectorAll) {
            return [];
        }
        var out = [];
        var dropdowns = root.querySelectorAll(SEMANTIC_DROPDOWN_SELECTOR);
        var i;
        for (i = 0; i < dropdowns.length; i++) {
            if (shouldTrackSemanticDropdown(dropdowns[i])) {
                out.push(dropdowns[i]);
            }
        }
        var raw = root.querySelectorAll(CONTROL_SELECTOR);
        for (i = 0; i < raw.length; i++) {
            if (shouldTrackControl(raw[i])) {
                out.push(raw[i]);
            }
        }
        return out;
    }

    function findFilterArea(title) {
        if (!title) {
            return null;
        }
        var siblingRoot = title.parentElement;
        if (siblingRoot) {
            var siblings = siblingRoot.children || [];
            var start = -1;
            for (var i = 0; i < siblings.length; i++) {
                if (siblings[i] === title || (siblings[i].contains && siblings[i].contains(title))) {
                    start = i;
                    break;
                }
            }
            for (var j = start + 1; j >= 1 && j < siblings.length && j <= start + 3; j++) {
                if (controlsIn(siblings[j]).length) {
                    return siblings[j];
                }
            }
        }
        var el = title;
        var depth = 0;
        while (el && el !== document.body && depth < 8) {
            var controls = controlsIn(el);
            if (controls.length) {
                return el;
            }
            el = el.parentElement;
            depth++;
        }
        return null;
    }

    function shouldTrackControl(control) {
        if (!control || control.disabled || control.closest('#' + PANEL_ID)) {
            return false;
        }
        if (semanticDropdownRoot(control)) {
            return false;
        }
        if (!visible(control)) {
            return false;
        }
        var tag = (control.tagName || '').toLowerCase();
        if (tag === 'input') {
            var type = String(control.type || 'text').toLowerCase();
            return ['button', 'submit', 'reset', 'image', 'file', 'hidden', 'password'].indexOf(type) === -1;
        }
        return tag === 'select' || tag === 'textarea';
    }

    function semanticDropdownRoot(el) {
        return el && el.closest ? el.closest(SEMANTIC_DROPDOWN_SELECTOR) : null;
    }

    function shouldTrackSemanticDropdown(dropdown) {
        if (!dropdown || dropdown.closest('#' + PANEL_ID) || !visible(dropdown)) {
            return false;
        }
        return !!(
            dropdown.getAttribute('name') ||
            dropdown.getAttribute('data-testid') ||
            dropdown.querySelector('.menu [role="option"], .menu .item') ||
            dropdown.querySelector(':scope > .ui.label, :scope > a.ui.label')
        );
    }

    function isSemanticDropdown(control) {
        return !!(
            control &&
            control.matches &&
            control.matches(SEMANTIC_DROPDOWN_SELECTOR)
        );
    }

    function findControlLabel(control) {
        if (!control) {
            return '';
        }
        if (control.id) {
            var explicit = document.querySelector('label[for="' + cssEscape(control.id) + '"]');
            if (explicit) {
                return textOf(explicit);
            }
        }
        var wrapped = control.closest && control.closest('label');
        if (wrapped) {
            return textOf(wrapped);
        }
        var field = control.closest && control.closest('.field,[class*="field"],[data-testid]');
        if (field) {
            var label = field.querySelector('label');
            if (label) {
                return textOf(label);
            }
        }
        return '';
    }

    function controlIdentity(control, index) {
        if (isSemanticDropdown(control)) {
            return semanticDropdownIdentity(control, index);
        }
        var type = (control.type || '').toLowerCase();
        var options = [];
        if ((control.tagName || '').toLowerCase() === 'select') {
            for (var i = 0; i < control.options.length; i++) {
                options.push(control.options[i].value + ':' + textOf(control.options[i]));
            }
        }
        return {
            index: index,
            tag: (control.tagName || '').toLowerCase(),
            type: type,
            id: control.id || '',
            name: control.name || '',
            testId: control.getAttribute('data-testid') || '',
            aria: control.getAttribute('aria-label') || '',
            placeholder: control.getAttribute('placeholder') || '',
            label: findControlLabel(control),
            options: options.join('|')
        };
    }

    function semanticDropdownIdentity(dropdown, index) {
        return {
            index: index,
            tag: (dropdown.tagName || '').toLowerCase(),
            type: 'semantic-dropdown',
            id: dropdown.id || '',
            name: dropdown.getAttribute('name') || '',
            testId: dropdown.getAttribute('data-testid') || '',
            aria: dropdown.getAttribute('aria-label') || '',
            placeholder: semanticDropdownPlaceholder(dropdown),
            label: findControlLabel(dropdown),
            options: semanticDropdownOptions(dropdown).join('|')
        };
    }

    function readControlValue(control) {
        if (isSemanticDropdown(control)) {
            return readSemanticDropdownValue(control);
        }
        var tag = (control.tagName || '').toLowerCase();
        var type = String(control.type || '').toLowerCase();
        if (tag === 'select' && control.multiple) {
            var values = [];
            for (var i = 0; i < control.options.length; i++) {
                if (control.options[i].selected) {
                    values.push(control.options[i].value);
                }
            }
            return values;
        }
        if (type === 'checkbox' || type === 'radio') {
            return !!control.checked;
        }
        return control.value;
    }

    function semanticDropdownPlaceholder(dropdown) {
        var text =
            dropdown.querySelector('.divider.default.text') ||
            dropdown.querySelector('.divider.text');
        return textOf(text);
    }

    function semanticDropdownOptions(dropdown) {
        var list = dropdown.querySelectorAll('.menu [role="option"], .menu .item');
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var txt = textOf(list[i].querySelector('.text') || list[i]);
            if (txt) {
                out.push(txt);
            }
        }
        return out;
    }

    function directSemanticLabels(dropdown) {
        var labels = [];
        var children = dropdown ? dropdown.children || [] : [];
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (
                child &&
                child.matches &&
                child.matches('.ui.label, a.ui.label, [class~="label"]')
            ) {
                labels.push(child);
            }
        }
        return labels;
    }

    function readSemanticDropdownValue(dropdown) {
        var labels = directSemanticLabels(dropdown);
        var values = [];
        for (var i = 0; i < labels.length; i++) {
            var label = labels[i];
            var val = label.getAttribute('value') || label.getAttribute('data-value') || textOf(label);
            val = String(val || '').replace(/\s+/g, ' ').trim();
            if (val) {
                values.push(val);
            }
        }
        if (dropdown.classList && dropdown.classList.contains('multiple')) {
            return values;
        }
        if (values.length) {
            return values[0];
        }
        var selected =
            dropdown.querySelector('.menu [role="option"][aria-selected="true"] .text') ||
            dropdown.querySelector('.menu .selected.item .text');
        return textOf(selected);
    }

    function snapshotArea(area) {
        var controls = controlsIn(area);
        var items = [];
        for (var i = 0; i < controls.length; i++) {
            items.push({
                identity: controlIdentity(controls[i], i),
                value: readControlValue(controls[i])
            });
        }
        return {
            createdAt: new Date().toISOString(),
            items: items
        };
    }

    function identityScore(want, got) {
        if (!want || !got || want.tag !== got.tag) {
            return -1;
        }
        var score = 0;
        if (want.type && want.type === got.type) {
            score += 2;
        }
        if (want.id && want.id === got.id) {
            score += 12;
        }
        if (want.name && want.name === got.name) {
            score += 10;
        }
        if (want.testId && want.testId === got.testId) {
            score += 10;
        }
        if (want.aria && want.aria === got.aria) {
            score += 6;
        }
        if (want.placeholder && want.placeholder === got.placeholder) {
            score += 5;
        }
        if (want.label && want.label === got.label) {
            score += 5;
        }
        if (want.options && want.options === got.options) {
            score += 4;
        }
        if (want.index === got.index) {
            score += 1;
        }
        return score;
    }

    function setNativeValue(control, prop, value) {
        var proto = control instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : control instanceof HTMLSelectElement
                ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (desc && desc.set) {
            desc.set.call(control, value);
        } else {
            control[prop] = value;
        }
    }

    function dispatchControlEvents(control) {
        try {
            control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        } catch (e) {}
        try {
            control.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } catch (e2) {}
    }

    function applyControlValue(control, value) {
        if (isSemanticDropdown(control)) {
            applySemanticDropdownValue(control, value);
            return;
        }
        var tag = (control.tagName || '').toLowerCase();
        var type = String(control.type || '').toLowerCase();
        if (tag === 'select' && control.multiple && Array.isArray(value)) {
            for (var i = 0; i < control.options.length; i++) {
                control.options[i].selected = value.indexOf(control.options[i].value) >= 0;
            }
            dispatchControlEvents(control);
            return;
        }
        if (type === 'checkbox' || type === 'radio') {
            setNativeValue(control, 'checked', !!value);
            dispatchControlEvents(control);
            return;
        }
        setNativeValue(control, 'value', value == null ? '' : String(value));
        dispatchControlEvents(control);
    }

    function clickLikeUser(el) {
        if (!el) {
            return;
        }
        var opts = { bubbles: true, cancelable: true, view: window };
        try {
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
        } catch (e) {
            try {
                el.click();
            } catch (e2) {}
        }
    }

    function clearSemanticDropdown(dropdown) {
        var labels = directSemanticLabels(dropdown);
        for (var i = labels.length - 1; i >= 0; i--) {
            var del = labels[i].querySelector('.delete.icon, i.delete');
            clickLikeUser(del || labels[i]);
        }
    }

    function findSemanticDropdownOption(dropdown, value) {
        var want = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!want) {
            return null;
        }
        var options = dropdown.querySelectorAll('.menu [role="option"], .menu .item');
        for (var i = 0; i < options.length; i++) {
            var txt = textOf(options[i].querySelector('.text') || options[i]).toLowerCase();
            if (txt === want) {
                return options[i];
            }
        }
        return null;
    }

    function setSemanticSearchValue(dropdown, value) {
        var input = dropdown.querySelector('input.search, input[aria-autocomplete="list"], input[type="text"]');
        if (!input) {
            return;
        }
        setNativeValue(input, 'value', String(value || ''));
        dispatchControlEvents(input);
    }

    function applySemanticDropdownValue(dropdown, value) {
        var values = Array.isArray(value) ? value : value ? [value] : [];
        clearSemanticDropdown(dropdown);
        clickLikeUser(dropdown);
        for (var i = 0; i < values.length; i++) {
            setSemanticSearchValue(dropdown, values[i]);
            var option = findSemanticDropdownOption(dropdown, values[i]);
            if (option) {
                clickLikeUser(option);
            }
        }
        setSemanticSearchValue(dropdown, '');
        dispatchControlEvents(dropdown);
    }

    function applySnapshot(area, snapshot) {
        var current = controlsIn(area);
        var identities = [];
        var used = [];
        var applied = 0;
        for (var i = 0; i < current.length; i++) {
            identities.push(controlIdentity(current[i], i));
            used.push(false);
        }
        var items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
        for (var j = 0; j < items.length; j++) {
            var want = items[j].identity;
            var bestIndex = -1;
            var bestScore = -1;
            for (var k = 0; k < identities.length; k++) {
                if (used[k]) {
                    continue;
                }
                var score = identityScore(want, identities[k]);
                if (score > bestScore) {
                    bestScore = score;
                    bestIndex = k;
                }
            }
            if (bestIndex >= 0 && bestScore >= 1) {
                applyControlValue(current[bestIndex], items[j].value);
                used[bestIndex] = true;
                applied++;
            }
        }
        return applied;
    }

    function presetByName(list, name) {
        var lower = String(name || '').toLowerCase();
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].name || '').toLowerCase() === lower) {
                return { item: list[i], index: i };
            }
        }
        return { item: null, index: -1 };
    }

    function sortPresets(list) {
        list.sort(function (a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
                sensitivity: 'base'
            });
        });
        return list;
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '.' + BUTTON_CLASS + '{margin-left:8px;padding:3px 8px;border:1px solid #5dade2;border-radius:4px;background:#1a1f28;color:#5dade2;font:12px/1.2 system-ui,sans-serif;cursor:pointer;vertical-align:middle;}' +
            '.' + BUTTON_CLASS + ':hover{background:#203044;}' +
            '#' + PANEL_ID + '{position:absolute;z-index:99999;width:300px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:10px;border:1px solid #3d4f66;border-radius:8px;background:rgba(25,31,42,.98);box-shadow:0 8px 24px rgba(0,0,0,.35);color:#e8eef5;font:12px/1.35 system-ui,sans-serif;}' +
            '#' + PANEL_ID + ' .dc-afss-title{font-weight:700;color:#5dade2;margin-bottom:8px;}' +
            '#' + PANEL_ID + ' .dc-afss-row{display:flex;gap:6px;margin-top:6px;align-items:center;}' +
            '#' + PANEL_ID + ' input,#' + PANEL_ID + ' select{flex:1;min-width:0;padding:4px 6px;border:1px solid #555;border-radius:4px;background:#111821;color:#e8eef5;font:12px system-ui,sans-serif;}' +
            '#' + PANEL_ID + ' button{padding:4px 8px;border:1px solid #5dade2;border-radius:4px;background:#1a1f28;color:#e8eef5;font:12px system-ui,sans-serif;cursor:pointer;}' +
            '#' + PANEL_ID + ' button:hover{background:#26364b;}' +
            '#' + PANEL_ID + ' button[data-dc-afss-delete]{border-color:#8a4b4b;}' +
            '#' + PANEL_ID + ' .dc-afss-status{min-height:16px;margin-top:7px;color:#bdc3c7;font-size:11px;}';
        document.head.appendChild(style);
    }

    function panelHtml(list) {
        var options = '<option value="">Choose saved setting...</option>';
        for (var i = 0; i < list.length; i++) {
            options += '<option value="' + htmlEscape(list[i].name) + '">' + htmlEscape(list[i].name) + '</option>';
        }
        return (
            '<div class="dc-afss-title">Advanced filter settings</div>' +
            '<div class="dc-afss-row">' +
            '<input type="text" data-dc-afss-name placeholder="Name this setting" />' +
            '<button type="button" data-dc-afss-save>Save</button>' +
            '</div>' +
            '<div class="dc-afss-row">' +
            '<select data-dc-afss-select>' + options + '</select>' +
            '<button type="button" data-dc-afss-load>Recall</button>' +
            '<button type="button" data-dc-afss-delete>Delete</button>' +
            '</div>' +
            '<div class="dc-afss-status" data-dc-afss-status></div>'
        );
    }

    function setStatus(panel, message) {
        var status = panel && panel.querySelector('[data-dc-afss-status]');
        if (status) {
            status.textContent = message || '';
        }
    }

    function refreshPanelOptions(panel) {
        if (!panel) {
            return;
        }
        var select = panel.querySelector('[data-dc-afss-select]');
        if (!select) {
            return;
        }
        var selected = select.value;
        var list = readPagePresets();
        var html = '<option value="">Choose saved setting...</option>';
        for (var i = 0; i < list.length; i++) {
            html += '<option value="' + htmlEscape(list[i].name) + '">' + htmlEscape(list[i].name) + '</option>';
        }
        select.innerHTML = html;
        select.value = selected;
    }

    function positionPanel(panel, button) {
        var rect = button.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, rect.left + window.scrollX)) + 'px';
        panel.style.top = rect.bottom + window.scrollY + 6 + 'px';
    }

    function closePanel() {
        if (activePanel) {
            activePanel.remove();
            activePanel = null;
        }
        if (outsideClickHandler) {
            document.removeEventListener('mousedown', outsideClickHandler, true);
            outsideClickHandler = null;
        }
        if (keydownHandler) {
            document.removeEventListener('keydown', keydownHandler, true);
            keydownHandler = null;
        }
    }

    function openPanel(button, title) {
        closePanel();
        ensureStyle();
        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = panelHtml(readPagePresets());
        document.body.appendChild(panel);
        positionPanel(panel, button);
        activePanel = panel;
        activeTitle = title;
        bindPanel(panel);
        outsideClickHandler = function (ev) {
            if (panel.contains(ev.target) || button.contains(ev.target)) {
                return;
            }
            closePanel();
        };
        keydownHandler = function (ev) {
            if (ev.key === 'Escape') {
                closePanel();
            }
        };
        document.addEventListener('mousedown', outsideClickHandler, true);
        document.addEventListener('keydown', keydownHandler, true);
        var nameInput = panel.querySelector('[data-dc-afss-name]');
        if (nameInput) {
            nameInput.focus();
        }
    }

    function bindPanel(panel) {
        var nameInput = panel.querySelector('[data-dc-afss-name]');
        var select = panel.querySelector('[data-dc-afss-select]');
        var saveBtn = panel.querySelector('[data-dc-afss-save]');
        var loadBtn = panel.querySelector('[data-dc-afss-load]');
        var deleteBtn = panel.querySelector('[data-dc-afss-delete]');
        if (select && nameInput) {
            select.addEventListener('change', function () {
                if (select.value) {
                    nameInput.value = select.value;
                }
            });
        }
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var title = activeTitle || findAdvancedFilterTitle();
                var area = findFilterArea(title);
                if (!area) {
                    setStatus(panel, 'Could not find the Advanced filter inputs.');
                    return;
                }
                var name = String((nameInput && nameInput.value) || '').replace(/\s+/g, ' ').trim();
                if (!name) {
                    setStatus(panel, 'Enter a name before saving.');
                    return;
                }
                var snap = snapshotArea(area);
                if (!snap.items.length) {
                    setStatus(panel, 'No inputs found to save.');
                    return;
                }
                var list = readPagePresets();
                var found = presetByName(list, name);
                var next = { name: name, snapshot: snap };
                if (found.index >= 0) {
                    list[found.index] = next;
                } else {
                    list.push(next);
                }
                sortPresets(list);
                if (!writePagePresets(list)) {
                    setStatus(panel, 'Could not save setting. Storage may be full.');
                    return;
                }
                refreshPanelOptions(panel);
                if (select) {
                    select.value = name;
                }
                setStatus(panel, 'Saved "' + name + '" with ' + snap.items.length + ' inputs.');
            });
        }
        if (loadBtn) {
            loadBtn.addEventListener('click', function () {
                var title = activeTitle || findAdvancedFilterTitle();
                var area = findFilterArea(title);
                var name = (select && select.value) || (nameInput && nameInput.value) || '';
                var found = presetByName(readPagePresets(), name);
                if (!area) {
                    setStatus(panel, 'Could not find the Advanced filter inputs.');
                    return;
                }
                if (!found.item) {
                    setStatus(panel, 'Choose a saved setting to recall.');
                    return;
                }
                var count = applySnapshot(area, found.item.snapshot);
                setStatus(panel, 'Recalled "' + found.item.name + '" to ' + count + ' inputs.');
            });
        }
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
                var name = (select && select.value) || (nameInput && nameInput.value) || '';
                var found = presetByName(readPagePresets(), name);
                if (!found.item) {
                    setStatus(panel, 'Choose a saved setting to delete.');
                    return;
                }
                var list = readPagePresets();
                list.splice(found.index, 1);
                writePagePresets(list);
                refreshPanelOptions(panel);
                setStatus(panel, 'Deleted "' + found.item.name + '".');
            });
        }
    }

    function mountButton(title) {
        if (!title || title.querySelector('.' + BUTTON_CLASS)) {
            return;
        }
        ensureStyle();
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BUTTON_CLASS;
        btn.textContent = 'Save/Recall';
        btn.title = 'Save or recall named Advanced filter settings';
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            if (activePanel) {
                closePanel();
            } else {
                openPanel(btn, title);
            }
        });
        title.appendChild(btn);
    }

    function scan() {
        rescanTimer = 0;
        var title = findAdvancedFilterTitle();
        if (title) {
            mountButton(title);
        }
    }

    function scheduleScan() {
        if (rescanTimer) {
            return;
        }
        rescanTimer = setTimeout(scan, 150);
    }

    function init() {
        scan();
        observer = new MutationObserver(scheduleScan);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.__myScriptCleanup = function () {
        closePanel();
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (rescanTimer) {
            clearTimeout(rescanTimer);
            rescanTimer = 0;
        }
        var buttons = document.querySelectorAll('.' + BUTTON_CLASS);
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].remove();
        }
        var style = document.getElementById(STYLE_ID);
        if (style) {
            style.remove();
        }
        window.__myScriptCleanup = undefined;
    };
})();
