// ==UserScript==
// @name         Flight tooltip display options
// @namespace    Wolf 2.0
// @version      0.3.2
// @description  Flight leg tooltip: default, hover-only (no click-open), disabled, optional extra hover delay
// @match        https://opssuitemain.swacorp.com/worksheet*
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"flightTooltipDisplayMode":{"type":"select","group":"Flight tooltip","label":"Display mode","description":"Default = native behavior (hover + click if the app uses it). Hover only = tooltips from hovering pucks only; clicks dismiss any open tooltip. Extra hover delay still applies when set. Disabled = hide flight leg tooltips. Legacy “Click only” is treated as Default.","default":"hover","options":[{"value":"hover","val":"hover","label":"Default"},{"value":"hover_only","val":"hover_only","label":"Hover only (no click-open)"},{"value":"disabled","val":"disabled","label":"Disabled"}]},"flightTooltipHoverDelayMs":{"type":"number","group":"Flight tooltip","label":"Extra hover delay (ms)","description":"Adds this many milliseconds of hover on a flight puck before pointer hover reaches the page (0 = site default).","default":0,"min":0,"max":5000,"step":50},"flightTooltipPassThroughClicks":{"type":"boolean","group":"Flight tooltip","label":"Tooltip: clicks pass through","description":"When ON, the flight tooltip ignores pointer events so clicks and hovers reach cells and pucks underneath. Turn OFF if you need to select or copy text inside the tooltip.","default":false},"flightTooltipDebug":{"type":"boolean","group":"Flight tooltip","label":"Debug logging","description":"Log tooltip display controller events to the browser console.","default":false}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Flight%20tooltip%20display%20options.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Flight%20tooltip%20display%20options.user.js
// ==/UserScript==

(function() {
    'use strict';

    var PUCK_SELECTOR = [
        '[data-qe-id="as-flight-leg-puck"]',
        '[data-testid="puck-context-menu"]',
        '[class*="CScizp4RisE="]',
        '[data-linked-hover-id]'
    ].join(', ');
    var TOOLTIP_SELECTOR = '[data-testid="flight-leg-tooltip"]';
    var STYLE_ID = 'dc-flight-tooltip-display-options-style';

    var observer = null;
    var lastHoverLogAt = 0;
    var prefPollTimer = null;
    var lastPollSig = null;

    /** While waiting for extra hover delay (ms > 0). */
    var dwellTimerId = null;
    var dwellPuck = null;
    /** Last pointer position while dwelling (for synthetic events). */
    var dwellClientX = 0;
    var dwellClientY = 0;
    var dwellScreenX = 0;
    var dwellScreenY = 0;
    /** Puck we already released hover to (site receives real events until leave). */
    var releasedHoverPuck = null;
    var lastAppliedMode = null;

    function getPref(key, defaultValue) {
        var prefFn = typeof donkeycodeGetPref === 'function'
            ? donkeycodeGetPref
            : (typeof globalThis !== 'undefined' && typeof globalThis.donkeycodeGetPref === 'function'
                ? globalThis.donkeycodeGetPref
                : null);
        if (!prefFn) {
            return defaultValue;
        }
        var v = prefFn(key);
        if (v === undefined || v === null || v === '') {
            return defaultValue;
        }
        return v;
    }

    function boolPref(key, defaultValue) {
        var v = getPref(key, defaultValue);
        if (v === true || v === false) {
            return v;
        }
        if (v === 'true' || v === '1') {
            return true;
        }
        if (v === 'false' || v === '0') {
            return false;
        }
        return defaultValue;
    }

    function numPref(key, defaultValue, min, max) {
        var raw = getPref(key, defaultValue);
        var n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/[^\d.-]/g, ''), 10);
        if (!Number.isFinite(n)) {
            n = defaultValue;
        }
        if (Number.isFinite(min) && n < min) {
            n = min;
        }
        if (Number.isFinite(max) && n > max) {
            n = max;
        }
        return n;
    }

    function getMode() {
        var mode = String(getPref('flightTooltipDisplayMode', 'hover') || 'hover').toLowerCase();
        if (mode === 'click') {
            return 'hover';
        }
        if (mode === 'disabled') {
            return 'disabled';
        }
        if (mode === 'hover_only') {
            return 'hover_only';
        }
        return 'hover';
    }

    function hoverExtraDelayMs() {
        return numPref('flightTooltipHoverDelayMs', 0, 0, 5000);
    }

    function passThroughClicksEnabled() {
        return boolPref('flightTooltipPassThroughClicks', false);
    }

    function syncPassThroughAttribute() {
        var on = passThroughClicksEnabled();
        document.documentElement.setAttribute('data-dc-flight-tooltip-pass-through', on ? '1' : '0');
    }

    function pollSignature() {
        return getMode() + '|' + hoverExtraDelayMs() + '|' + (passThroughClicksEnabled() ? '1' : '0');
    }

    function log() {
        if (!boolPref('flightTooltipDebug', false)) {
            return;
        }
        console.log.apply(console, ['%c[Flight tooltip]', 'color:#f9a825'].concat([].slice.call(arguments)));
    }

    function closestPuck(el) {
        if (!el || el.nodeType !== 1 || !el.closest) {
            return null;
        }
        return el.closest(PUCK_SELECTOR);
    }

    function isFlightTooltip(el) {
        return !!(el && el.nodeType === 1 && el.closest && el.closest(TOOLTIP_SELECTOR));
    }

    function ensureStyle() {
        var style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }
        style.textContent =
            'html[data-dc-flight-tooltip-mode="disabled"] ' + TOOLTIP_SELECTOR + '{' +
            'display:none!important;visibility:hidden!important;pointer-events:none!important;' +
            '}' +
            'html[data-dc-flight-tooltip-pass-through="1"] ' + TOOLTIP_SELECTOR + '{' +
            'pointer-events:none!important;' +
            '}';
    }

    function applyModeAttribute() {
        var mode = getMode();
        document.documentElement.setAttribute('data-dc-flight-tooltip-mode', mode);
        if (mode === 'disabled') {
            hideTooltips();
        } else if (mode === 'hover_only' && lastAppliedMode !== 'hover_only') {
            hideTooltips();
        }
        lastAppliedMode = mode;
    }

    function hideTooltips() {
        document.querySelectorAll(TOOLTIP_SELECTOR).forEach(function(tip) {
            tip.style.display = 'none';
            tip.style.visibility = 'hidden';
            tip.setAttribute('data-dc-flight-tooltip-hidden', '1');
        });
    }

    function restoreTooltips() {
        document.querySelectorAll(TOOLTIP_SELECTOR + '[data-dc-flight-tooltip-hidden="1"]').forEach(function(tip) {
            tip.style.display = '';
            tip.style.visibility = '';
            tip.removeAttribute('data-dc-flight-tooltip-hidden');
        });
    }

    /** Keep only the newest flight tooltip node (last in document order); remove older duplicates from the DOM. */
    function pruneStaleFlightTooltips() {
        if (getMode() === 'disabled') {
            return;
        }
        var nodes = document.querySelectorAll(TOOLTIP_SELECTOR);
        if (nodes.length <= 1) {
            return;
        }
        var keep = nodes[nodes.length - 1];
        for (var i = 0; i < nodes.length - 1; i++) {
            if (nodes[i] !== keep) {
                nodes[i].remove();
            }
        }
        log('pruned stale flight tooltips', nodes.length - 1);
    }

    function clearDwell(reason) {
        if (dwellTimerId) {
            clearTimeout(dwellTimerId);
            dwellTimerId = null;
        }
        dwellPuck = null;
        if (reason) {
            log('dwell cleared', reason);
        }
    }

    function dispatchPointerLike(type, target, clientX, clientY, screenX, screenY, relatedTarget) {
        var init = {
            bubbles: type.indexOf('enter') === -1 && type.indexOf('leave') === -1,
            cancelable: true,
            composed: true,
            view: window,
            clientX: Number.isFinite(clientX) ? clientX : 0,
            clientY: Number.isFinite(clientY) ? clientY : 0,
            screenX: Number.isFinite(screenX) ? screenX : 0,
            screenY: Number.isFinite(screenY) ? screenY : 0,
            relatedTarget: relatedTarget || null
        };
        var ev;
        try {
            if (type.indexOf('pointer') === 0 && typeof PointerEvent === 'function') {
                ev = new PointerEvent(type, init);
            } else {
                ev = new MouseEvent(type, init);
            }
        } catch (e) {
            ev = document.createEvent('MouseEvents');
            ev.initMouseEvent(
                type,
                init.bubbles,
                init.cancelable,
                window,
                0,
                init.screenX,
                init.screenY,
                init.clientX,
                init.clientY,
                false,
                false,
                false,
                false,
                0,
                relatedTarget || null
            );
        }
        target.dispatchEvent(ev);
    }

    function releaseHoverToPuck(puck) {
        if (!puck) {
            return;
        }
        releasedHoverPuck = puck;
        clearDwell('release');
        pruneStaleFlightTooltips();
        ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'].forEach(function(type) {
            dispatchPointerLike(type, puck, dwellClientX, dwellClientY, dwellScreenX, dwellScreenY, null);
        });
        log('hover released after dwell', puck);
    }

    function startOrResetDwell(puck, e) {
        if (!puck || hoverExtraDelayMs() <= 0) {
            return;
        }
        dwellClientX = e.clientX;
        dwellClientY = e.clientY;
        dwellScreenX = e.screenX;
        dwellScreenY = e.screenY;
        if (dwellPuck === puck && dwellTimerId) {
            return;
        }
        clearDwell('puck change');
        dwellPuck = puck;
        dwellTimerId = setTimeout(function() {
            dwellTimerId = null;
            if (dwellPuck === puck) {
                releaseHoverToPuck(puck);
            }
        }, hoverExtraDelayMs());
        log('dwell started', hoverExtraDelayMs() + 'ms', puck);
    }

    /** After paint so the app can finish click handling before we hide click-opened tooltips. */
    function scheduleHideTooltipsForHoverOnlyMode() {
        if (getMode() !== 'hover_only') {
            return;
        }
        var raf = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : function(fn) { return setTimeout(fn, 16); };
        raf(function() {
            raf(function() {
                if (getMode() !== 'hover_only') {
                    return;
                }
                hideTooltips();
                pruneStaleFlightTooltips();
                log('hover-only: hid tooltips after click');
            });
        });
    }

    function onClickCaptureHoverOnly(e) {
        if (getMode() !== 'hover_only') {
            return;
        }
        if (closestPuck(e.target) || isFlightTooltip(e.target)) {
            scheduleHideTooltipsForHoverOnlyMode();
        }
    }

    function isLeaveType(type) {
        return type === 'pointerout' || type === 'pointerleave' ||
            type === 'mouseout' || type === 'mouseleave';
    }

    function onPointerHoverGateCapture(e) {
        var mode = getMode();
        if (mode === 'disabled') {
            if (!closestPuck(e.target)) {
                return;
            }
            e.stopImmediatePropagation();
            var now = Date.now();
            if (now - lastHoverLogAt > 1000) {
                lastHoverLogAt = now;
                log('blocked hover (disabled)', e.type, e.target);
            }
            hideTooltips();
            clearDwell('disabled');
            releasedHoverPuck = null;
            return;
        }

        if (hoverExtraDelayMs() <= 0) {
            releasedHoverPuck = null;
            clearDwell('delay off');
            return;
        }

        var puck = closestPuck(e.target);

        if (puck && puck === releasedHoverPuck && !isLeaveType(e.type)) {
            return;
        }

        if (isLeaveType(e.type)) {
            var stillOnReleased = releasedHoverPuck && e.relatedTarget &&
                e.relatedTarget.nodeType === 1 && releasedHoverPuck.contains(e.relatedTarget);
            if (releasedHoverPuck && e.target && releasedHoverPuck.contains(e.target) && !stillOnReleased) {
                releasedHoverPuck = null;
                clearDwell('leave released puck');
            }
            if (dwellPuck && e.target && dwellPuck.contains(e.target)) {
                var stillOnDwell = e.relatedTarget && dwellPuck.contains(e.relatedTarget);
                if (!stillOnDwell) {
                    clearDwell('leave dwell puck');
                }
            }
            return;
        }

        if (!puck) {
            return;
        }

        if (releasedHoverPuck && puck !== releasedHoverPuck) {
            ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'].forEach(function(type) {
                dispatchPointerLike(
                    type,
                    releasedHoverPuck,
                    e.clientX,
                    e.clientY,
                    e.screenX,
                    e.screenY,
                    document.body
                );
            });
            releasedHoverPuck = null;
            pruneStaleFlightTooltips();
        }

        e.stopImmediatePropagation();
        dwellClientX = e.clientX;
        dwellClientY = e.clientY;
        dwellScreenX = e.screenX;
        dwellScreenY = e.screenY;
        startOrResetDwell(puck, e);
    }

    function observeTooltips() {
        observer = new MutationObserver(function(mutations) {
            if (getMode() === 'disabled') {
                document.querySelectorAll(TOOLTIP_SELECTOR).forEach(function(tip) {
                    if (tip.getAttribute('data-dc-flight-tooltip-hidden') !== '1') {
                        tip.style.display = 'none';
                        tip.style.visibility = 'hidden';
                        tip.setAttribute('data-dc-flight-tooltip-hidden', '1');
                    }
                });
                return;
            }
            var needPrune = false;
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) {
                        return;
                    }
                    if (node.matches && node.matches(TOOLTIP_SELECTOR)) {
                        needPrune = true;
                        return;
                    }
                    if (node.querySelector && node.querySelector(TOOLTIP_SELECTOR)) {
                        needPrune = true;
                    }
                });
            });
            if (needPrune) {
                pruneStaleFlightTooltips();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function syntheticLeaveReleasedPuck() {
        if (!releasedHoverPuck) {
            return;
        }
        var t = releasedHoverPuck;
        ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'].forEach(function(type) {
            dispatchPointerLike(type, t, dwellClientX, dwellClientY, dwellScreenX, dwellScreenY, document.body);
        });
        releasedHoverPuck = null;
    }

    function syncFromPrefs() {
        ensureStyle();
        applyModeAttribute();
        syncPassThroughAttribute();
        var sig = pollSignature();
        if (getMode() === 'disabled') {
            syntheticLeaveReleasedPuck();
            clearDwell('prefs disabled');
        }
        if (hoverExtraDelayMs() <= 0) {
            syntheticLeaveReleasedPuck();
            clearDwell('prefs delay 0');
        }
        if (sig !== lastPollSig) {
            lastPollSig = sig;
            log('prefs', { mode: getMode(), hoverDelayMs: hoverExtraDelayMs(), passThrough: passThroughClicksEnabled() });
        }
    }

    ensureStyle();
    applyModeAttribute();
    syncPassThroughAttribute();
    lastPollSig = pollSignature();
    prefPollTimer = setInterval(function() {
        syncFromPrefs();
    }, 600);
    observeTooltips();
    if (getMode() !== 'disabled') {
        pruneStaleFlightTooltips();
    }
    log('initialized', { mode: getMode(), hoverDelayMs: hoverExtraDelayMs(), passThrough: passThroughClicksEnabled(), href: location.href });

    [
        'pointerover',
        'pointerenter',
        'pointermove',
        'pointerout',
        'pointerleave',
        'mouseover',
        'mouseenter',
        'mousemove',
        'mouseout',
        'mouseleave'
    ].forEach(function(type) {
        window.addEventListener(type, onPointerHoverGateCapture, true);
    });
    window.addEventListener('click', onClickCaptureHoverOnly, true);

    window.__myScriptCleanup = function() {
        if (prefPollTimer) {
            clearInterval(prefPollTimer);
            prefPollTimer = null;
        }
        clearDwell('cleanup');
        releasedHoverPuck = null;
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        [
            'pointerover',
            'pointerenter',
            'pointermove',
            'pointerout',
            'pointerleave',
            'mouseover',
            'mouseenter',
            'mousemove',
            'mouseout',
            'mouseleave'
        ].forEach(function(type) {
        window.removeEventListener(type, onPointerHoverGateCapture, true);
    });
        window.removeEventListener('click', onClickCaptureHoverOnly, true);
        restoreTooltips();
        document.documentElement.removeAttribute('data-dc-flight-tooltip-mode');
        document.documentElement.removeAttribute('data-dc-flight-tooltip-pass-through');
        var style = document.getElementById(STYLE_ID);
        if (style) {
            style.remove();
        }
        window.__myScriptCleanup = undefined;
    };
})();
