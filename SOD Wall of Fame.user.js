// ==UserScript==
// @name         SOD Wall of Fame
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  FIMS tab: wall of fame accolades; password to edit; optional JSON sync URL
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @donkeycode-pref {"wallOfFameSyncUrl":{"type":"url","group":"Wall of Fame","label":"Cloud JSON URL (optional)","description":"GET loads accolades (JSON array or {entries:[]}). Use Publish after unlock to POST the same URL if your server accepts it. Leave empty for local-only.","default":"","placeholder":"https://…/wall-of-fame.json"},"wallOfFameShowTab":{"type":"boolean","group":"Wall of Fame","label":"Show Wall of Fame tab","description":"Tab next to FIMS / Advisories on the FIMS widget.","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SOD%20Wall%20of%20Fame.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SOD%20Wall%20of%20Fame.user.js
// ==/UserScript==

(function() {
    'use strict';

    var TABLE_ID = 'fims-id';
    var TAB_ID = 'dc-wof-tab';
    var PANEL_ID = 'dc-wof-panel';
    var STYLE_ID = 'dc-wof-style';

    var LS_KEY = 'donkeycode.sodWallOfFame.v1';
    var SESSION_KEY = 'dc_wof_unlocked';
    var EDIT_PASSWORD = 'DonkeyWall';

    var DEFAULT_ENTRIES = [
        {
            id: 'mdw-ground',
            title: 'Most on ground (MDW)',
            holder: 'Mike Bane',
            note: '',
            sortOrder: 1,
            updatedAt: 0
        },
        {
            id: 'den-divert',
            title: 'Most diversions away from an airport (DEN)',
            holder: 'Josh Seiler',
            note: '',
            sortOrder: 2,
            updatedAt: 0
        },
        {
            id: 'atl-ac-ground',
            title: 'Most aircraft on the ground at ATL at one time',
            holder: 'Bill Kalivas',
            note: 'ORF',
            sortOrder: 3,
            updatedAt: 0
        }
    ];

    var rootMo = null;
    var onPopState = null;
    var onHashChange = null;
    var navInterval = null;
    var lastNavKey = '';

    function getPref(key, def) {
        if (typeof donkeycodeGetPref !== 'function') {
            return def;
        }
        var v = donkeycodeGetPref(key);
        if (v === undefined || v === null || v === '') {
            return def;
        }
        return v;
    }

    function getSyncUrl() {
        var u = getPref('wallOfFameSyncUrl', '');
        return typeof u === 'string' ? u.trim() : '';
    }

    function isUnlocked() {
        try {
            return sessionStorage.getItem(SESSION_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function setUnlocked(ok) {
        try {
            if (ok) {
                sessionStorage.setItem(SESSION_KEY, '1');
            } else {
                sessionStorage.removeItem(SESSION_KEY);
            }
        } catch (e) {
            /* ignore */
        }
    }

    function normalizeEntry(e) {
        if (!e || typeof e !== 'object') {
            return null;
        }
        var id = String(e.id || '').trim() || ('wof-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
        return {
            id: id,
            title: String(e.title || '').trim() || 'Accolade',
            holder: String(e.holder || '').trim() || '—',
            note: String(e.note || '').trim(),
            sortOrder: Number.isFinite(Number(e.sortOrder)) ? Number(e.sortOrder) : 0,
            updatedAt: Number.isFinite(Number(e.updatedAt)) ? Number(e.updatedAt) : Date.now()
        };
    }

    function loadLocal() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) {
                return DEFAULT_ENTRIES.map(function(x) {
                    return normalizeEntry(x);
                });
            }
            var parsed = JSON.parse(raw);
            var arr = Array.isArray(parsed) ? parsed : (parsed.entries || []);
            if (!arr.length) {
                return DEFAULT_ENTRIES.map(function(x) {
                    return normalizeEntry(x);
                });
            }
            return arr.map(normalizeEntry).filter(Boolean);
        } catch (err) {
            return DEFAULT_ENTRIES.map(function(x) {
                return normalizeEntry(x);
            });
        }
    }

    function saveLocal(entries) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(entries));
        } catch (e) {
            /* ignore */
        }
    }

    function mergeEntries(a, b) {
        var map = {};
        var i;
        for (i = 0; i < a.length; i++) {
            var ea = normalizeEntry(a[i]);
            if (ea) {
                map[ea.id] = ea;
            }
        }
        for (i = 0; i < b.length; i++) {
            var eb = normalizeEntry(b[i]);
            if (!eb) {
                continue;
            }
            var ex = map[eb.id];
            if (!ex || eb.updatedAt >= (ex.updatedAt || 0)) {
                map[eb.id] = eb;
            }
        }
        var out = [];
        var k;
        for (k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) {
                out.push(map[k]);
            }
        }
        out.sort(function(x, y) {
            return (x.sortOrder || 0) - (y.sortOrder || 0);
        });
        return out;
    }

    function fetchCloud(cb) {
        var url = getSyncUrl();
        if (!url || typeof GM_xmlhttpRequest !== 'function') {
            cb(null);
            return;
        }
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            onload: function(res) {
                try {
                    var text = res.responseText || '';
                    var data = JSON.parse(text);
                    var arr = Array.isArray(data) ? data : (data.entries || []);
                    cb(arr.map(normalizeEntry).filter(Boolean));
                } catch (e) {
                    cb(null);
                }
            },
            onerror: function() {
                cb(null);
            }
        });
    }

    function postCloud(entries, cb) {
        var url = getSyncUrl();
        if (!url || typeof GM_xmlhttpRequest !== 'function') {
            cb(false, 'No sync URL or GM_xmlhttpRequest');
            return;
        }
        var body = JSON.stringify({ entries: entries, updatedAt: Date.now() });
        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            data: body,
            onload: function(res) {
                if (res.status >= 200 && res.status < 300) {
                    cb(true, null);
                } else {
                    cb(false, 'HTTP ' + res.status);
                }
            },
            onerror: function() {
                cb(false, 'Network error');
            }
        });
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var css = [
            '#' + PANEL_ID + '{display:none;padding:0;background:linear-gradient(160deg,#1a1025 0%,#2d1f4a 50%,#1e3a5f 100%);',
            'border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);overflow:hidden;max-height:70vh;}',
            '#' + PANEL_ID + ' .dc-wof-inner{padding:16px 18px;color:#f0e8ff;font-family:system-ui,-apple-system,sans-serif;}',
            '#' + PANEL_ID + ' .dc-wof-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.15);}',
            '#' + PANEL_ID + ' .dc-wof-title{font-weight:800;font-size:1.2rem;background:linear-gradient(90deg,#ffd700,#ff8c00,#da70d6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}',
            '#' + PANEL_ID + ' .dc-wof-sub{font-size:.75rem;opacity:.75;margin-top:4px;color:#c8b8e0;}',
            '#' + PANEL_ID + ' .dc-wof-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;max-height:calc(70vh - 200px);overflow:auto;padding:2px;}',
            '#' + PANEL_ID + ' .dc-wof-card{background:rgba(255,255,255,.08);border:1px solid rgba(255,215,0,.25);border-radius:10px;padding:12px;',
            'min-height:100px;display:flex;flex-direction:column;}',
            '#' + PANEL_ID + ' .dc-wof-card-t{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;opacity:.85;color:#e8d4ff;margin-bottom:6px;}',
            '#' + PANEL_ID + ' .dc-wof-card-h{font-weight:700;font-size:1rem;color:#fff;line-height:1.3;}',
            '#' + PANEL_ID + ' .dc-wof-card-n{margin-top:8px;font-size:.95rem;color:#ffd700;font-weight:600;}',
            '#' + PANEL_ID + ' .dc-wof-card-note{margin-top:4px;font-size:.78rem;opacity:.75;font-style:italic;}',
            '#' + PANEL_ID + ' .dc-wof-edit{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12);}',
            '#' + PANEL_ID + ' .dc-wof-edit label{display:block;font-size:.72rem;opacity:.85;margin-bottom:4px;}',
            '#' + PANEL_ID + ' .dc-wof-edit input,.dc-wof-edit textarea{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:#fff;margin-bottom:8px;font-size:13px;}',
            '#' + PANEL_ID + ' .dc-wof-edit textarea{min-height:52px;resize:vertical;}',
            '#' + PANEL_ID + ' .dc-wof-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;}',
            '#' + PANEL_ID + ' .dc-wof-btns button{padding:8px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;}',
            '#' + PANEL_ID + ' .dc-wof-btn-gold{background:linear-gradient(135deg,#b8860b,#ffd700);color:#2a1a00;}',
            '#' + PANEL_ID + ' .dc-wof-btn-sec{background:rgba(255,255,255,.12);color:#eee;}',
            '#' + PANEL_ID + ' .dc-wof-list{margin:8px 0 0;padding-left:1.1em;font-size:.8rem;opacity:.9;}',
            '#' + PANEL_ID + ' .dc-wof-hint{font-size:.65rem;opacity:.6;margin-top:10px;line-height:1.4;}'
        ].join('');
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    var entriesState = loadLocal();

    function renderCards(container) {
        var grid = container.querySelector('.dc-wof-grid');
        if (!grid) {
            return;
        }
        grid.innerHTML = '';
        var list = entriesState.slice().sort(function(a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
        var i;
        for (i = 0; i < list.length; i++) {
            var e = list[i];
            var card = document.createElement('div');
            card.className = 'dc-wof-card';
            card.dataset.entryId = e.id;
            var t = document.createElement('div');
            t.className = 'dc-wof-card-t';
            t.textContent = 'Accolade';
            var h = document.createElement('div');
            h.className = 'dc-wof-card-h';
            h.textContent = e.title;
            var n = document.createElement('div');
            n.className = 'dc-wof-card-n';
            n.textContent = e.holder;
            card.appendChild(t);
            card.appendChild(h);
            card.appendChild(n);
            if (e.note) {
                var note = document.createElement('div');
                note.className = 'dc-wof-card-note';
                note.textContent = e.note;
                card.appendChild(note);
            }
            grid.appendChild(card);
        }
    }

    function renderEditSection(panel) {
        var wrap = panel.querySelector('.dc-wof-edit');
        if (!wrap) {
            return;
        }
        wrap.innerHTML = '';
        var unlocked = isUnlocked();

        if (!unlocked) {
            var p1 = document.createElement('p');
            p1.style.fontSize = '0.85rem';
            p1.style.opacity = '0.9';
            p1.textContent = 'Enter the editor password to add, edit, or publish accolades.';
            var lab = document.createElement('label');
            lab.textContent = 'Password';
            var inp = document.createElement('input');
            inp.type = 'password';
            inp.autocomplete = 'off';
            inp.placeholder = 'Password';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dc-wof-btn-gold';
            btn.textContent = 'Unlock';
            btn.addEventListener('click', function(ev) {
                ev.preventDefault();
                if (inp.value === EDIT_PASSWORD) {
                    setUnlocked(true);
                    renderEditSection(panel);
                } else {
                    alert('Incorrect password.');
                }
            });
            wrap.appendChild(p1);
            wrap.appendChild(lab);
            wrap.appendChild(inp);
            wrap.appendChild(btn);
            return;
        }

        var lockBtn = document.createElement('button');
        lockBtn.type = 'button';
        lockBtn.className = 'dc-wof-btn-sec';
        lockBtn.textContent = 'Lock editor';
        lockBtn.addEventListener('click', function(ev) {
            ev.preventDefault();
            setUnlocked(false);
            renderEditSection(panel);
        });
        wrap.appendChild(lockBtn);

        var la = document.createElement('label');
        la.textContent = 'Accolade title';
        var ta = document.createElement('input');
        ta.type = 'text';
        ta.placeholder = 'e.g. Most holds (PHX)';
        var lb = document.createElement('label');
        lb.textContent = 'Holder name';
        var tb = document.createElement('input');
        tb.type = 'text';
        tb.placeholder = 'Name';
        var lc = document.createElement('label');
        lc.textContent = 'Note (optional)';
        var tc = document.createElement('input');
        tc.type = 'text';
        tc.placeholder = 'Station, context, etc.';

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'dc-wof-btn-gold';
        addBtn.textContent = 'Add accolade';
        addBtn.addEventListener('click', function(ev) {
            ev.preventDefault();
            var title = ta.value.trim();
            var holder = tb.value.trim();
            if (!title || !holder) {
                alert('Title and holder are required.');
                return;
            }
            var ent = normalizeEntry({
                id: 'wof-' + Date.now(),
                title: title,
                holder: holder,
                note: tc.value.trim(),
                sortOrder: entriesState.length + 1,
                updatedAt: Date.now()
            });
            entriesState.push(ent);
            saveLocal(entriesState);
            ta.value = '';
            tb.value = '';
            tc.value = '';
            renderCards(panel);
            renderEntryList(panel);
        });

        wrap.appendChild(document.createElement('hr'));
        wrap.appendChild(la);
        wrap.appendChild(ta);
        wrap.appendChild(lb);
        wrap.appendChild(tb);
        wrap.appendChild(lc);
        wrap.appendChild(tc);
        wrap.appendChild(addBtn);

        var ul = document.createElement('ul');
        ul.className = 'dc-wof-list';
        wrap.appendChild(ul);
        renderEntryList(panel);

        var pub = document.createElement('button');
        pub.type = 'button';
        pub.className = 'dc-wof-btn-sec';
        pub.textContent = 'Publish to cloud URL';
        pub.title = 'POST JSON to the URL in prefs (server must accept POST)';
        pub.addEventListener('click', function(ev) {
            ev.preventDefault();
            if (!getSyncUrl()) {
                alert('Set Wall of Fame → Cloud JSON URL in DonkeyCODE prefs first.');
                return;
            }
            postCloud(entriesState, function(ok, err) {
                if (ok) {
                    alert('Published.');
                } else {
                    alert('Publish failed: ' + (err || 'unknown'));
                }
            });
        });
        wrap.appendChild(pub);

        var imp = document.createElement('button');
        imp.type = 'button';
        imp.className = 'dc-wof-btn-sec';
        imp.textContent = 'Fetch from cloud now';
        imp.addEventListener('click', function(ev) {
            ev.preventDefault();
            fetchCloud(function(remote) {
                if (remote && remote.length) {
                    entriesState = mergeEntries(entriesState, remote);
                    saveLocal(entriesState);
                    renderCards(panel);
                    renderEntryList(panel);
                    alert('Merged ' + remote.length + ' entries from cloud.');
                } else {
                    alert('No data or could not load.');
                }
            });
        });
        wrap.appendChild(imp);

        var hint = document.createElement('div');
        hint.className = 'dc-wof-hint';
        hint.textContent = 'Cloud: host a JSON file and set the URL in prefs. GET merges on fetch; POST sends { entries, updatedAt }. Raw static hosts often reject POST—use your own endpoint or team shared storage.';
        wrap.appendChild(hint);
    }

    function renderEntryList(panel) {
        var ul = panel.querySelector('.dc-wof-list');
        if (!ul || !isUnlocked()) {
            return;
        }
        ul.innerHTML = '';
        var list = entriesState.slice().sort(function(a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
        var i;
        for (i = 0; i < list.length; i++) {
            (function(ent) {
                var li = document.createElement('li');
                li.style.marginBottom = '6px';
                li.textContent = ent.title + ' — ' + ent.holder + ' ';
                var del = document.createElement('button');
                del.type = 'button';
                del.textContent = 'Remove';
                del.style.fontSize = '11px';
                del.style.marginLeft = '6px';
                del.style.cursor = 'pointer';
                del.addEventListener('click', function(ev) {
                    ev.preventDefault();
                    if (confirm('Remove this entry?')) {
                        entriesState = entriesState.filter(function(x) {
                            return x.id !== ent.id;
                        });
                        saveLocal(entriesState);
                        renderCards(panel);
                        renderEntryList(panel);
                    }
                });
                li.appendChild(del);
                ul.appendChild(li);
            })(list[i]);
        }
    }

    function render(panel) {
        if (!panel) {
            return;
        }
        renderCards(panel);
        renderEditSection(panel);
    }

    function findTabMenu() {
        var menus = document.querySelectorAll('.ui.attached.tabular.menu');
        var i;
        for (i = 0; i < menus.length; i++) {
            var m = menus[i];
            var links = m.querySelectorAll('a.item');
            var j;
            for (j = 0; j < links.length; j++) {
                if ((links[j].textContent || '').indexOf('Advisories') !== -1) {
                    return { menu: m, advisoriesTab: links[j] };
                }
            }
        }
        return null;
    }

    function getSegments(menu) {
        var p = menu.parentElement;
        if (!p) {
            return [];
        }
        var out = [];
        var ch = p.children;
        var i;
        for (i = 0; i < ch.length; i++) {
            var el = ch[i];
            if (el.classList && el.classList.contains('ui') && el.classList.contains('bottom') && el.classList.contains('attached') && el.classList.contains('segment')) {
                out.push(el);
            }
        }
        return out;
    }

    function showFimsTable() {
        var tab = document.getElementById(TAB_ID);
        if (tab) {
            tab.classList.remove('active');
        }
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        var tcp = document.getElementById('dc-fims-top-clickers-panel');
        if (table) {
            table.style.display = '';
        }
        if (panel) {
            panel.style.display = 'none';
        }
        if (tcp) {
            tcp.style.display = 'none';
        }
    }

    function showWallOfFame() {
        var found = findTabMenu();
        var tab = document.getElementById(TAB_ID);
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        if (!found || !tab || !table || !panel) {
            return;
        }
        var menu = found.menu;
        var items = menu.querySelectorAll('a.item');
        var i;
        for (i = 0; i < items.length; i++) {
            items[i].classList.remove('active');
        }
        tab.classList.add('active');
        var segments = getSegments(menu);
        if (segments.length >= 2) {
            segments[0].classList.add('active');
            segments[1].classList.remove('active');
        } else if (segments.length === 1) {
            segments[0].classList.add('active');
        }
        table.style.display = 'none';
        var tcp = document.getElementById('dc-fims-top-clickers-panel');
        if (tcp) {
            tcp.style.display = 'none';
        }
        panel.style.display = 'block';
        render(panel);
    }

    function onWofTabClick(e) {
        e.preventDefault();
        e.stopPropagation();
        showWallOfFame();
    }

    function wireTabs(menu) {
        if (!menu || menu.dataset.dcWofTabWire) {
            return;
        }
        menu.dataset.dcWofTabWire = '1';
        var links = menu.querySelectorAll('a.item');
        var j;
        for (j = 0; j < links.length; j++) {
            var link = links[j];
            if (link.id === TAB_ID) {
                continue;
            }
            var txt = (link.textContent || '').replace(/\s+/g, ' ');
            if (txt.indexOf('FIMS') !== -1 || txt.indexOf('Advisories') !== -1) {
                link.addEventListener('click', showFimsTable);
            }
        }
    }

    function wireTopClickersTabWhenPresent() {
        var tcTab = document.getElementById('dc-fims-top-clickers-host');
        if (tcTab && !tcTab.dataset.dcWofWiredTc) {
            tcTab.dataset.dcWofWiredTc = '1';
            tcTab.addEventListener('click', showFimsTable);
        }
    }

    function ensurePanel() {
        var existing = document.getElementById(PANEL_ID);
        if (existing) {
            return existing;
        }
        ensureStyles();
        var table = document.getElementById(TABLE_ID);
        if (!table || !table.parentNode) {
            return null;
        }
        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.display = 'none';

        var inner = document.createElement('div');
        inner.className = 'dc-wof-inner';

        var head = document.createElement('div');
        head.className = 'dc-wof-h';
        var ht = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'dc-wof-title';
        title.textContent = 'Wall of Fame';
        var sub = document.createElement('div');
        sub.className = 'dc-wof-sub';
        sub.textContent = 'SOD accolades (local + optional cloud URL in prefs)';
        ht.appendChild(title);
        ht.appendChild(sub);
        var em = document.createElement('span');
        em.setAttribute('aria-hidden', 'true');
        em.style.fontSize = '2rem';
        em.textContent = '\u{1F3DB}\u{FE0F}';
        head.appendChild(ht);
        head.appendChild(em);
        inner.appendChild(head);

        var grid = document.createElement('div');
        grid.className = 'dc-wof-grid';
        inner.appendChild(grid);

        var edit = document.createElement('div');
        edit.className = 'dc-wof-edit';
        inner.appendChild(edit);

        panel.appendChild(inner);
        table.parentNode.insertBefore(panel, table);

        entriesState = loadLocal();
        render(panel);

        fetchCloud(function(remote) {
            if (remote && remote.length) {
                entriesState = mergeEntries(entriesState, remote);
                saveLocal(entriesState);
                render(panel);
            }
        });

        return panel;
    }

    function ensureTab() {
        if (!getPref('wallOfFameShowTab', true)) {
            return null;
        }
        var existing = document.getElementById(TAB_ID);
        if (existing) {
            return existing;
        }
        var found = findTabMenu();
        if (!found) {
            return null;
        }
        wireTabs(found.menu);
        wireTopClickersTabWhenPresent();
        var a = document.createElement('a');
        a.id = TAB_ID;
        a.className = 'item';
        a.href = '#';
        a.innerHTML = '<div>\u{1F3DB}\u{FE0F} Wall of Fame</div>';
        a.addEventListener('click', onWofTabClick);
        var insertAfter = document.getElementById('dc-fims-top-clickers-host') || found.advisoriesTab;
        insertAfter.insertAdjacentElement('afterend', a);
        return a;
    }

    function ensureUi() {
        ensureTab();
        ensurePanel();
    }

    function bootScan() {
        var t = document.getElementById(TABLE_ID);
        if (t) {
            ensureUi();
            wireTopClickersTabWhenPresent();
        }
    }

    rootMo = new MutationObserver(function() {
        bootScan();
    });
    rootMo.observe(document.documentElement, { childList: true, subtree: true });
    bootScan();

    function navKey() {
        return (window.location.pathname || '') + (window.location.search || '') + (window.location.hash || '');
    }
    function onNavMaybe() {
        if (navKey() !== lastNavKey) {
            lastNavKey = navKey();
            bootScan();
        }
    }
    lastNavKey = navKey();
    onPopState = onNavMaybe;
    onHashChange = onNavMaybe;
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    navInterval = window.setInterval(onNavMaybe, 2000);

    window.__myScriptCleanup = function() {
        if (navInterval) {
            clearInterval(navInterval);
            navInterval = null;
        }
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('hashchange', onHashChange);
        if (rootMo) {
            rootMo.disconnect();
            rootMo = null;
        }
        var tab = document.getElementById(TAB_ID);
        if (tab && tab.parentNode) {
            tab.parentNode.removeChild(tab);
        }
        var panel = document.getElementById(PANEL_ID);
        if (panel && panel.parentNode) {
            panel.parentNode.removeChild(panel);
        }
        var st = document.getElementById(STYLE_ID);
        if (st && st.parentNode) {
            st.parentNode.removeChild(st);
        }
        var menuInfo = findTabMenu();
        if (menuInfo && menuInfo.menu) {
            delete menuInfo.menu.dataset.dcWofTabWire;
        }
        window.__myScriptCleanup = undefined;
    };
})();
