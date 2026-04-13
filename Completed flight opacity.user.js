// ==UserScript==
// @name         Completed flight opacity
// @namespace    Wolf 2.0
// @version      2.0
// @description  Set opacity for completed-flight leg styling (and matching sched bar) on the ops map
// @match        https://opssuitemain.swacorp.com/*
// @donkeycode-pref {"completedFlightOpacity":{"type":"number","group":"Opacity","label":"Completed flight opacity","description":"0 = invisible, 1 = fully opaque. Applied to completed leg and sched block elements.","default":0.4,"min":0,"max":1,"step":0.05}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Completed%20flight%20opacity.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Completed%20flight%20opacity.user.js
// ==/UserScript==

(function() {
    'use strict';

    var SELECTORS = ['.OV3PKcjpyxw\\=', '.vVzbj3J5m70\\='];

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

    function clamp(n, lo, hi) {
        return Math.min(hi, Math.max(lo, n));
    }

    function getOpacity() {
        var x = Number(getPref('completedFlightOpacity', 0.4));
        if (!Number.isFinite(x)) {
            return 0.4;
        }
        return clamp(x, 0, 1);
    }

    function updateOpacity(root) {
        var op = getOpacity();
        for (var i = 0; i < SELECTORS.length; i++) {
            var elements = root.querySelectorAll(SELECTORS[i]);
            for (var j = 0; j < elements.length; j++) {
                elements[j].style.opacity = String(op);
            }
        }
    }

    updateOpacity(document);

    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) {
                    updateOpacity(node);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.__myScriptCleanup = function() {
        observer.disconnect();
        SELECTORS.forEach(function(sel) {
            document.querySelectorAll(sel).forEach(function(el) {
                el.style.opacity = '';
            });
        });
    };
})();
