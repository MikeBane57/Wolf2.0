// ==UserScript==
// @name         URL path tab titles
// @namespace    Wolf 2.0
// @version      1.3.0
// @description  Rename tabs by URL path; manage many rules in-page (add/edit/delete) plus optional prefs
// @match        https://opssuitemain.swacorp.com/*
// @donkeycode-pref {"pathTabTitleUrls":{"type":"string","group":"Tab titles (optional)","label":"URLs or paths","description":"Optional extra rules (same as before). Rules you save in the page list are stored in the browser and take precedence when the path matches.","default":"","placeholder":"https://opssuitemain.swacorp.com/alerts"},"pathTabTitleTitles":{"type":"string","group":"Tab titles (optional)","label":"Tab titles","description":"One title per line, aligned with URLs above.","default":"","placeholder":"🚨 Alerts"},"pathTabTitleShowManager":{"type":"boolean","group":"Tab titles (optional)","label":"Show “Tab titles” button","description":"Floating button to open the rule list on opssuitemain pages.","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/URL%20path%20tab%20titles.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/URL%20path%20tab%20titles.user.js
// ==/UserScript==

(function() {
    'use strict';

    var LS_KEY = 'donkeycode.pathTabTitles.rules.v1';
    var UI_STYLE_ID = 'dc-path-tab-titles-ui-style';
    var BTN_ID = 'dc-path-tab-titles-fab';
    var PANEL_ID = 'dc-path-tab-titles-panel';
    var HOST_ID = 'dc-path-tab-titles-host';

    var baseTitleAtInject = document.title;
    var titleElObserver = null;
    var bodyMo = null;
    var navInterval = null;
    var lastNavKey = '';
    var onPopState = null;
    var onHashChange = null;
    var editingIndex = -1;

    function getPref(key, def) {
        if (typeof donkeycodeGetPref !== 'function') {
            return def;
        }
        var v = donkeycodeGetPref(key);
        if (v === undefined || v === null) {
            return def;
        }
        return v;
    }

    function normalizePrefix(p) {
        var s = String(p || '').trim();
        if (!s.length) {
            return '/';
        }
        if (s[0] !== '/') {
            s = '/' + s;
        }
        if (s.length > 1 && s[s.length - 1] === '/') {
            s = s.slice(0, -1);
        }
        return s;
    }

    function parseLeftToPathPrefix(left) {
        var s = String(left || '').trim();
        if (!s) {
            return null;
        }
        if (/^https?:\/\//i.test(s)) {
            try {
                var u = new URL(s);
                if (u.hostname !== window.location.hostname) {
                    return null;
                }
                return normalizePrefix(u.pathname);
            } catch (e) {
                return null;
            }
        }
        return normalizePrefix(s);
    }

    function splitPrefLines(text) {
        return String(text || '').split(/\r?\n/);
    }

    function parseRulesFromPairedFields() {
        var urlLines = splitPrefLines(getPref('pathTabTitleUrls', ''));
        var titleLines = splitPrefLines(getPref('pathTabTitleTitles', ''));
        var max = Math.max(urlLines.length, titleLines.length);
        var rules = [];
        var i;
        for (i = 0; i < max; i++) {
            var uRaw = (urlLines[i] !== undefined) ? urlLines[i] : '';
            var tRaw = (titleLines[i] !== undefined) ? titleLines[i] : '';
            var u = uRaw.trim();
            var t = tRaw.trim();
            if (!u || u[0] === '#') {
                continue;
            }
            if (!t || t[0] === '#') {
                continue;
            }
            var pathPrefix = parseLeftToPathPrefix(u);
            if (pathPrefix === null) {
                continue;
            }
            rules.push({ pathPrefix: pathPrefix, title: t, url: u });
        }
        return rules;
    }

    function parseRulesFromLines(text) {
        var rules = [];
        var raw = String(text || '');
        var lines = raw.split(/\r?\n/);
        var i;
        for (i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line[0] === '#') {
                continue;
            }
            var pipe = line.indexOf('|');
            if (pipe === -1) {
                continue;
            }
            var left = line.slice(0, pipe).trim();
            var title = line.slice(pipe + 1).trim();
            if (!left || !title) {
                continue;
            }
            var pathPrefix = parseLeftToPathPrefix(left);
            if (pathPrefix === null) {
                continue;
            }
            rules.push({ pathPrefix: pathPrefix, title: title, url: left });
        }
        return rules;
    }

    function parseRulesFromJson(text) {
        var arr = JSON.parse(text);
        if (!Array.isArray(arr)) {
            return [];
        }
        return arr.filter(function(r) {
            return r && typeof r.pathPrefix === 'string' && typeof r.title === 'string';
        }).map(function(r) {
            return {
                pathPrefix: normalizePrefix(r.pathPrefix),
                title: r.title,
                url: r.url || r.pathPrefix
            };
        });
    }

    function parseRulesLegacy() {
        var raw = getPref('pathTabTitleRules', '');
        if (raw !== null && raw !== undefined && typeof raw !== 'string') {
            raw = String(raw);
        }
        var s = String(raw || '').trim();
        if (!s) {
            return [];
        }
        if (s[0] === '[') {
            try {
                return parseRulesFromJson(s);
            } catch (e) {
                return parseRulesFromLines(s);
            }
        }
        return parseRulesFromLines(s);
    }

    function loadStoredRules() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) {
                return [];
            }
            var arr = JSON.parse(raw);
            if (!Array.isArray(arr)) {
                return [];
            }
            var out = [];
            var i;
            for (i = 0; i < arr.length; i++) {
                var x = arr[i];
                if (!x || typeof x.pathPrefix !== 'string' || typeof x.title !== 'string') {
                    continue;
                }
                out.push({
                    pathPrefix: normalizePrefix(x.pathPrefix),
                    title: x.title,
                    url: typeof x.url === 'string' ? x.url : x.pathPrefix
                });
            }
            return out;
        } catch (e) {
            return [];
        }
    }

    function saveStoredRules(rules) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(rules));
        } catch (e) {
            /* ignore */
        }
    }

    function mergeRuleSources() {
        var pref = parseRulesFromPairedFields();
        var leg = parseRulesLegacy();
        var stored = loadStoredRules();
        var map = {};
        var i;
        var arr = [pref, leg, stored];
        for (i = 0; i < arr.length; i++) {
            var j;
            for (j = 0; j < arr[i].length; j++) {
                var r = arr[i][j];
                map[r.pathPrefix] = r;
            }
        }
        var keys = Object.keys(map);
        var out = [];
        for (i = 0; i < keys.length; i++) {
            out.push(map[keys[i]]);
        }
        return out;
    }

    function pathMatches(pathname, prefixNorm) {
        if (prefixNorm === '/') {
            return true;
        }
        return pathname === prefixNorm || pathname.indexOf(prefixNorm + '/') === 0;
    }

    function pickRule(pathname, rules) {
        var candidates = [];
        var i;
        for (i = 0; i < rules.length; i++) {
            var r = rules[i];
            var pn = r.pathPrefix;
            if (pathMatches(pathname, pn)) {
                candidates.push({ rule: r, prefixLen: pn.length });
            }
        }
        if (!candidates.length) {
            return null;
        }
        candidates.sort(function(a, b) {
            return b.prefixLen - a.prefixLen;
        });
        return candidates[0].rule;
    }

    function applyPlaceholders(titleTpl) {
        var t = String(titleTpl);
        var loc = window.location;
        return t
            .split('{pathname}').join(loc.pathname || '')
            .split('{search}').join(loc.search || '')
            .split('{hash}').join(loc.hash || '')
            .split('{host}').join(loc.host || '');
    }

    function titleForCurrentUrl() {
        var rules = mergeRuleSources();
        if (!rules.length) {
            return null;
        }
        var picked = pickRule(window.location.pathname || '/', rules);
        if (!picked) {
            return null;
        }
        var out = applyPlaceholders(picked.title);
        return out.replace(/\s+/g, ' ').trim() || null;
    }

    function applyTitle() {
        var next = titleForCurrentUrl();
        if (next === null) {
            return;
        }
        if (document.title !== next) {
            document.title = next;
        }
    }

    function wireTitleElement() {
        var el = document.querySelector('title');
        if (!el || el.dataset.pathTabTitlesWired) {
            return;
        }
        el.dataset.pathTabTitlesWired = '1';
        titleElObserver = new MutationObserver(function() {
            requestAnimationFrame(function() {
                applyTitle();
            });
        });
        titleElObserver.observe(el, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function navKey() {
        return (window.location.pathname || '') + (window.location.search || '') + (window.location.hash || '');
    }

    function onNavMaybe() {
        var k = navKey();
        if (k !== lastNavKey) {
            lastNavKey = k;
            applyTitle();
        }
    }

    function ensureUiStyles() {
        if (document.getElementById(UI_STYLE_ID)) {
            return;
        }
        var css = [
            '#' + HOST_ID + '{position:fixed;right:12px;bottom:12px;z-index:2147483000;font-family:system-ui,-apple-system,sans-serif;}',
            '#' + BTN_ID + '{cursor:pointer;border:none;border-radius:999px;padding:10px 14px;font-size:13px;font-weight:600;',
            'background:linear-gradient(135deg,#30475e,#1b262c);color:#eee;box-shadow:0 4px 14px rgba(0,0,0,.35);}',
            '#' + BTN_ID + ':hover{filter:brightness(1.08);}',
            '#' + PANEL_ID + '{display:none;position:absolute;right:0;bottom:52px;width:min(96vw,420px);max-height:min(70vh,520px);',
            'background:#1b262c;color:#e8e8ef;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.45);overflow:hidden;flex-direction:column;}',
            '#' + PANEL_ID + '.dc-ptt-open{display:flex !important;}',
            '#' + PANEL_ID + ' .dc-ptt-h{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.12);font-weight:700;font-size:14px;}',
            '#' + PANEL_ID + ' .dc-ptt-scroll{overflow:auto;flex:1;padding:8px;max-height:280px;}',
            '#' + PANEL_ID + ' .dc-ptt-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start;padding:8px 10px;margin-bottom:6px;',
            'background:rgba(255,255,255,.06);border-radius:8px;border:1px solid rgba(255,255,255,.1);}',
            '#' + PANEL_ID + ' .dc-ptt-url{font-size:11px;word-break:break-all;opacity:.85;}',
            '#' + PANEL_ID + ' .dc-ptt-tit{font-size:13px;font-weight:600;margin-top:4px;}',
            '#' + PANEL_ID + ' .dc-ptt-actions{display:flex;flex-direction:column;gap:4px;}',
            '#' + PANEL_ID + ' .dc-ptt-actions button{font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;}',
            '#' + PANEL_ID + ' .dc-ptt-actions button:hover{background:rgba(255,255,255,.18);}',
            '#' + PANEL_ID + ' .dc-ptt-form{padding:10px 14px 14px;border-top:1px solid rgba(255,255,255,.12);}',
            '#' + PANEL_ID + ' .dc-ptt-form label{display:block;font-size:11px;opacity:.8;margin-bottom:4px;}',
            '#' + PANEL_ID + ' .dc-ptt-form input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.2);',
            'background:#0f1419;color:#eee;margin-bottom:8px;font-size:13px;}',
            '#' + PANEL_ID + ' .dc-ptt-form .dc-ptt-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}',
            '#' + PANEL_ID + ' .dc-ptt-form .dc-ptt-btns button{padding:8px 14px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;}',
            '#' + PANEL_ID + ' .dc-ptt-btn-add{background:linear-gradient(135deg,#3282b8,#0f4c75);color:#fff;}',
            '#' + PANEL_ID + ' .dc-ptt-btn-sec{background:rgba(255,255,255,.12);color:#eee;}',
            '#' + PANEL_ID + ' .dc-ptt-hint{font-size:10px;opacity:.65;margin-top:8px;line-height:1.35;}'
        ].join('');
        var st = document.createElement('style');
        st.id = UI_STYLE_ID;
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    function getPanelEls() {
        var panel = document.getElementById(PANEL_ID);
        if (!panel) {
            return null;
        }
        return {
            panel: panel,
            listEl: panel.querySelector('.dc-ptt-scroll'),
            urlIn: panel.querySelector('input[name="dc-ptt-url"]'),
            titleIn: panel.querySelector('input[name="dc-ptt-title"]'),
            addBtn: panel.querySelector('.dc-ptt-btn-add'),
            cancelBtn: panel.querySelector('.dc-ptt-btn-cancel'),
            importBtn: panel.querySelector('.dc-ptt-btn-import')
        };
    }

    function renderRuleList() {
        var els = getPanelEls();
        if (!els || !els.listEl) {
            return;
        }
        var rules = loadStoredRules();
        els.listEl.innerHTML = '';
        if (!rules.length) {
            var empty = document.createElement('div');
            empty.style.cssText = 'padding:16px;text-align:center;opacity:.65;font-size:13px;';
            empty.textContent = 'No saved rules yet. Add a URL and tab title below, or import from DonkeyCODE prefs.';
            els.listEl.appendChild(empty);
            return;
        }
        var i;
        for (i = 0; i < rules.length; i++) {
            (function(idx) {
                var r = rules[idx];
                var row = document.createElement('div');
                row.className = 'dc-ptt-row';
                var left = document.createElement('div');
                var u = document.createElement('div');
                u.className = 'dc-ptt-url';
                u.textContent = r.url || r.pathPrefix;
                var t = document.createElement('div');
                t.className = 'dc-ptt-tit';
                t.textContent = r.title;
                left.appendChild(u);
                left.appendChild(t);
                var actions = document.createElement('div');
                actions.className = 'dc-ptt-actions';
                var ed = document.createElement('button');
                ed.type = 'button';
                ed.textContent = 'Edit';
                ed.addEventListener('click', function(e) {
                    e.preventDefault();
                    startEdit(idx);
                });
                var del = document.createElement('button');
                del.type = 'button';
                del.textContent = 'Delete';
                del.addEventListener('click', function(e) {
                    e.preventDefault();
                    var next = loadStoredRules();
                    next.splice(idx, 1);
                    saveStoredRules(next);
                    editingIndex = -1;
                    resetForm();
                    renderRuleList();
                    applyTitle();
                });
                actions.appendChild(ed);
                actions.appendChild(del);
                row.appendChild(left);
                row.appendChild(actions);
                els.listEl.appendChild(row);
            })(i);
        }
    }

    function resetForm() {
        var els = getPanelEls();
        if (!els) {
            return;
        }
        editingIndex = -1;
        els.urlIn.value = '';
        els.titleIn.value = '';
        els.addBtn.textContent = 'Save rule';
        if (els.cancelBtn) {
            els.cancelBtn.style.display = 'none';
        }
    }

    function startEdit(idx) {
        var rules = loadStoredRules();
        var r = rules[idx];
        if (!r) {
            return;
        }
        var els = getPanelEls();
        if (!els) {
            return;
        }
        editingIndex = idx;
        els.urlIn.value = r.url || '';
        els.titleIn.value = r.title || '';
        els.addBtn.textContent = 'Update rule';
        if (els.cancelBtn) {
            els.cancelBtn.style.display = '';
        }
        els.urlIn.focus();
    }

    function importFromPrefs() {
        var pref = parseRulesFromPairedFields();
        var leg = parseRulesLegacy();
        var map = {};
        var combined = pref.concat(leg);
        var i;
        for (i = 0; i < combined.length; i++) {
            var r = combined[i];
            map[r.pathPrefix] = {
                pathPrefix: r.pathPrefix,
                title: r.title,
                url: r.url || r.pathPrefix
            };
        }
        var stored = loadStoredRules();
        for (i = 0; i < stored.length; i++) {
            var s = stored[i];
            map[s.pathPrefix] = s;
        }
        var out = [];
        var k;
        for (k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) {
                out.push(map[k]);
            }
        }
        saveStoredRules(out);
        renderRuleList();
        applyTitle();
    }

    function saveRuleFromForm() {
        var els = getPanelEls();
        if (!els) {
            return;
        }
        var urlRaw = els.urlIn.value.trim();
        var titleRaw = els.titleIn.value.trim();
        if (!urlRaw || !titleRaw) {
            return;
        }
        var pathPrefix = parseLeftToPathPrefix(urlRaw);
        if (pathPrefix === null) {
            alert('URL must be for this site (' + window.location.hostname + ') or a path like /alerts');
            return;
        }
        var entry = {
            pathPrefix: pathPrefix,
            title: titleRaw,
            url: urlRaw
        };
        var rules = loadStoredRules();
        if (editingIndex >= 0 && editingIndex < rules.length) {
            rules.splice(editingIndex, 1);
        }
        rules = rules.filter(function(x) {
            return x.pathPrefix !== pathPrefix;
        });
        rules.push(entry);
        saveStoredRules(rules);
        editingIndex = -1;
        resetForm();
        renderRuleList();
        applyTitle();
    }

    function togglePanel() {
        var p = document.getElementById(PANEL_ID);
        if (!p) {
            return;
        }
        p.classList.toggle('dc-ptt-open');
    }

    function ensureManagerUi() {
        if (!getPref('pathTabTitleShowManager', true)) {
            return;
        }
        if (document.getElementById(HOST_ID)) {
            return;
        }
        ensureUiStyles();
        var host = document.createElement('div');
        host.id = HOST_ID;

        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Tab title rules');

        var head = document.createElement('div');
        head.className = 'dc-ptt-h';
        head.textContent = 'Tab title rules (saved in this browser)';
        panel.appendChild(head);

        var scroll = document.createElement('div');
        scroll.className = 'dc-ptt-scroll';
        panel.appendChild(scroll);

        var form = document.createElement('div');
        form.className = 'dc-ptt-form';
        var l1 = document.createElement('label');
        l1.textContent = 'URL or path';
        var inUrl = document.createElement('input');
        inUrl.name = 'dc-ptt-url';
        inUrl.type = 'text';
        inUrl.placeholder = 'https://opssuitemain.swacorp.com/alerts or /alerts';
        var l2 = document.createElement('label');
        l2.textContent = 'Tab title';
        var inTitle = document.createElement('input');
        inTitle.name = 'dc-ptt-title';
        inTitle.type = 'text';
        inTitle.placeholder = 'e.g. 🚨 Alerts';
        var btns = document.createElement('div');
        btns.className = 'dc-ptt-btns';
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'dc-ptt-btn-add';
        addBtn.textContent = 'Save rule';
        addBtn.addEventListener('click', function(e) {
            e.preventDefault();
            saveRuleFromForm();
        });
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'dc-ptt-btn-sec dc-ptt-btn-cancel';
        cancelBtn.textContent = 'Cancel edit';
        cancelBtn.style.display = 'none';
        cancelBtn.addEventListener('click', function(e) {
            e.preventDefault();
            resetForm();
        });
        var impBtn = document.createElement('button');
        impBtn.type = 'button';
        impBtn.className = 'dc-ptt-btn-sec dc-ptt-btn-import';
        impBtn.textContent = 'Import from DonkeyCODE prefs';
        impBtn.title = 'Merges URLs/titles from the optional pref fields into this list';
        impBtn.addEventListener('click', function(e) {
            e.preventDefault();
            importFromPrefs();
        });
        btns.appendChild(addBtn);
        btns.appendChild(cancelBtn);
        btns.appendChild(impBtn);
        var hint = document.createElement('div');
        hint.className = 'dc-ptt-hint';
        hint.textContent = 'Rules match by URL path (longest match wins). Optional prefs in DonkeyCODE still apply; this list overrides the same path.';

        form.appendChild(l1);
        form.appendChild(inUrl);
        form.appendChild(l2);
        form.appendChild(inTitle);
        form.appendChild(btns);
        form.appendChild(hint);
        panel.appendChild(form);

        var fab = document.createElement('button');
        fab.id = BTN_ID;
        fab.type = 'button';
        fab.textContent = 'Tab titles';
        fab.addEventListener('click', function(e) {
            e.preventDefault();
            togglePanel();
            if (document.getElementById(PANEL_ID).classList.contains('dc-ptt-open')) {
                renderRuleList();
            }
        });

        host.appendChild(panel);
        host.appendChild(fab);
        document.documentElement.appendChild(host);
        renderRuleList();
    }

    bodyMo = new MutationObserver(function() {
        wireTitleElement();
        applyTitle();
        ensureManagerUi();
    });
    var obsRoot = document.head || document.documentElement;
    bodyMo.observe(obsRoot, { childList: true, subtree: true });

    wireTitleElement();
    lastNavKey = navKey();
    applyTitle();
    ensureManagerUi();

    onPopState = function() {
        onNavMaybe();
    };
    onHashChange = function() {
        onNavMaybe();
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);

    navInterval = window.setInterval(function() {
        onNavMaybe();
        ensureManagerUi();
    }, 2000);

    window.__myScriptCleanup = function() {
        if (navInterval !== null) {
            clearInterval(navInterval);
            navInterval = null;
        }
        if (onPopState) {
            window.removeEventListener('popstate', onPopState);
            onPopState = null;
        }
        if (onHashChange) {
            window.removeEventListener('hashchange', onHashChange);
            onHashChange = null;
        }
        if (bodyMo) {
            bodyMo.disconnect();
            bodyMo = null;
        }
        if (titleElObserver) {
            titleElObserver.disconnect();
            titleElObserver = null;
        }
        var t = document.querySelector('title');
        if (t) {
            delete t.dataset.pathTabTitlesWired;
        }
        var host = document.getElementById(HOST_ID);
        if (host && host.parentNode) {
            host.parentNode.removeChild(host);
        }
        var st = document.getElementById(UI_STYLE_ID);
        if (st && st.parentNode) {
            st.parentNode.removeChild(st);
        }
        document.title = baseTitleAtInject;
        window.__myScriptCleanup = undefined;
    };
})();
