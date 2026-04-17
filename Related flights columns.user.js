// ==UserScript==
// @name         Related flights columns
// @namespace    Wolf 2.0
// @version      2.1
// @description  Show/hide and width for related-flights table columns (prefs)
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"rfColCheckbox":{"type":"boolean","group":"Related flights columns","label":"Show Checkbox","default":false},"rfColFlt":{"type":"boolean","group":"Related flights columns","label":"Show FLT","default":true},"rfColLn":{"type":"boolean","group":"Related flights columns","label":"Show LN","default":false},"rfColAc":{"type":"boolean","group":"Related flights columns","label":"Show AC","default":true},"rfColDep":{"type":"boolean","group":"Related flights columns","label":"Show Dep","default":true},"rfColTimeOut":{"type":"boolean","group":"Related flights columns","label":"Show Time Out","default":true},"rfColArr":{"type":"boolean","group":"Related flights columns","label":"Show Arr","default":true},"rfColTimeIn":{"type":"boolean","group":"Related flights columns","label":"Show Time In","default":true},"rfColTurn":{"type":"boolean","group":"Related flights columns","label":"Show Turn","default":true},"rfColPax":{"type":"boolean","group":"Related flights columns","label":"Show PAX","default":true},"rfColLid":{"type":"boolean","group":"Related flights columns","label":"Show LID","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Related%20flights%20columns.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Related%20flights%20columns.user.js
// ==/UserScript==

(function() {
    'use strict';

    var STYLE_ID = 'donkeycode-related-flights-columns-style';

    /** Header label (th text / label attr) -> pref key & default visibility */
    var COL_META = {
        'checkbox': { key: 'rfColCheckbox', defVisible: false, width: '0px' },
        'FLT': { key: 'rfColFlt', defVisible: true, width: '40px' },
        'LN': { key: 'rfColLn', defVisible: false, width: '30px' },
        'AC': { key: 'rfColAc', defVisible: true, width: '40px' },
        'Dep': { key: 'rfColDep', defVisible: true, width: '30px' },
        'Time Out': { key: 'rfColTimeOut', defVisible: true, width: '30px' },
        'Arr': { key: 'rfColArr', defVisible: true, width: '30px' },
        'Time In': { key: 'rfColTimeIn', defVisible: true, width: '30px' },
        'Turn': { key: 'rfColTurn', defVisible: true, width: '30px' },
        'PAX': { key: 'rfColPax', defVisible: true, width: '25px' },
        'LID': { key: 'rfColLid', defVisible: true, width: '25px' }
    };

    function getPref(key, defaultValue) {
        if (typeof donkeycodeGetPref !== 'function') {
            return defaultValue;
        }
        var v = donkeycodeGetPref(key);
        if (v === undefined || v === null || v === '') {
            return defaultValue;
        }
        return v;
    }

    function colVisible(label) {
        var meta = COL_META[label];
        if (!meta) {
            return true;
        }
        return !!getPref(meta.key, meta.defVisible);
    }

    var debounceTimer = null;
    var DEBOUNCE_MS = 150;

    function applyAll() {
        var tables = document.querySelectorAll('table[data-testid="related-flights-table"]');
        if (!tables.length) {
            var orphan = document.getElementById(STYLE_ID);
            if (orphan) {
                orphan.remove();
            }
            return;
        }

        document.querySelectorAll('table[data-testid="related-flights-table"] thead th').forEach(function(th) {
            th.style.width = '';
        });
        document.querySelectorAll('table[data-testid="related-flights-table"] tbody tr td').forEach(function(td) {
            td.style.width = '';
        });

        var cssParts = [];

        tables.forEach(function(table) {
            var headers = table.querySelectorAll('thead th');
            headers.forEach(function(th, idx) {
                var label = th.getAttribute('label') || th.textContent.trim();
                var n = idx + 1;
                var meta = COL_META[label];

                if (meta && !colVisible(label)) {
                    cssParts.push(
                        'table[data-testid="related-flights-table"] th:nth-child(' + n + '),' +
                        'table[data-testid="related-flights-table"] td:nth-child(' + n + '){display:none!important}'
                    );
                } else if (meta) {
                    var w = meta.width;
                    th.style.width = w;
                    table.querySelectorAll('tbody tr td:nth-child(' + n + ')').forEach(function(td) {
                        td.style.width = w;
                    });
                }
            });
        });

        var el = document.getElementById(STYLE_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            document.head.appendChild(el);
        }
        el.textContent = cssParts.join('\n');
    }

    function clearTableStyles() {
        document.querySelectorAll('table[data-testid="related-flights-table"] thead th').forEach(function(th) {
            th.style.width = '';
        });
        document.querySelectorAll('table[data-testid="related-flights-table"] tbody tr td').forEach(function(td) {
            td.style.width = '';
        });
        var el = document.getElementById(STYLE_ID);
        if (el) {
            el.remove();
        }
    }

    function scheduleApplyAll() {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(function() {
            debounceTimer = null;
            applyAll();
        }, DEBOUNCE_MS);
    }

    applyAll();

    var observer = new MutationObserver(function() {
        scheduleApplyAll();
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    window.__myScriptCleanup = function() {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        observer.disconnect();
        clearTableStyles();
    };
})();
