// ==UserScript==
// @name         Flight tooltip display options
// @namespace    Wolf 2.0
// @version      0.1.0
// @description  Choose whether the native flight tooltip shows on hover, click only, or not at all
// @match        https://opssuitemain.swacorp.com/worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"flightTooltipDisplayMode":{"type":"select","group":"Flight tooltip","label":"Display mode","description":"Hover = site default. Click = suppress hover and open the flight tooltip after clicking a flight puck. Disabled = hide flight tooltips.","default":"hover","options":[{"value":"hover","label":"Hover (site default)"},{"value":"click","label":"Click only"},{"value":"disabled","label":"Disabled"}]},"flightTooltipDebug":{"type":"boolean","group":"Flight tooltip","label":"Debug logging","description":"Log tooltip display controller events to the browser console.","default":false}}
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

    var clickOpenedPuck = null;
    var allowNativeHoverUntil = 0;
    var observer = null;

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

    function getMode() {
        var mode = String(getPref('flightTooltipDisplayMode', 'hover') || 'hover').toLowerCase();
        if (mode !== 'click' && mode !== 'disabled') {
            return 'hover';
        }
        return mode;
    }

    function log() {
        if (!getPref('flightTooltipDebug', false)) {
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
            '}';
    }

    function applyModeAttribute() {
        var mode = getMode();
        document.documentElement.setAttribute('data-dc-flight-tooltip-mode', mode);
        if (mode === 'disabled') {
            hideTooltips();
        }
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

    function dispatchPointerLike(type, target, originalEvent, relatedTarget) {
        var init = {
            bubbles: type.indexOf('enter') === -1 && type.indexOf('leave') === -1,
            cancelable: true,
            composed: true,
            view: window,
            clientX: originalEvent && Number.isFinite(originalEvent.clientX) ? originalEvent.clientX : 0,
            clientY: originalEvent && Number.isFinite(originalEvent.clientY) ? originalEvent.clientY : 0,
            screenX: originalEvent && Number.isFinite(originalEvent.screenX) ? originalEvent.screenX : 0,
            screenY: originalEvent && Number.isFinite(originalEvent.screenY) ? originalEvent.screenY : 0,
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

    function triggerNativeTooltip(puck, originalEvent) {
        if (!puck) {
            return;
        }
        clickOpenedPuck = puck;
        allowNativeHoverUntil = Date.now() + 250;
        ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'].forEach(function(type) {
            dispatchPointerLike(type, puck, originalEvent, null);
        });
        setTimeout(function() {
            allowNativeHoverUntil = 0;
        }, 260);
        log('click-open', puck);
    }

    function closeNativeTooltip(originalEvent) {
        if (!clickOpenedPuck) {
            hideTooltips();
            return;
        }
        var puck = clickOpenedPuck;
        clickOpenedPuck = null;
        allowNativeHoverUntil = Date.now() + 250;
        ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'].forEach(function(type) {
            dispatchPointerLike(type, puck, originalEvent, document.body);
        });
        setTimeout(function() {
            allowNativeHoverUntil = 0;
        }, 260);
        log('close');
    }

    function shouldBlockHover(e) {
        var mode = getMode();
        if (mode === 'hover') {
            return false;
        }
        if (Date.now() < allowNativeHoverUntil) {
            return false;
        }
        return !!closestPuck(e.target);
    }

    function onNativeTooltipPointerCapture(e) {
        if (!shouldBlockHover(e)) {
            return;
        }
        e.stopImmediatePropagation();
        if (getMode() === 'disabled') {
            hideTooltips();
        }
    }

    function onPointerDownCapture(e) {
        var mode = getMode();
        if (mode === 'hover') {
            return;
        }
        var puck = closestPuck(e.target);
        if (mode === 'disabled') {
            if (puck) {
                hideTooltips();
            }
            return;
        }
        if (!puck && !isFlightTooltip(e.target)) {
            closeNativeTooltip(e);
        }
    }

    function onClickCapture(e) {
        if (getMode() !== 'click') {
            return;
        }
        var puck = closestPuck(e.target);
        if (!puck) {
            return;
        }
        setTimeout(function() {
            triggerNativeTooltip(puck, e);
        }, 0);
    }

    function observeTooltips() {
        observer = new MutationObserver(function(mutations) {
            if (getMode() !== 'disabled') {
                return;
            }
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) {
                        return;
                    }
                    if (node.matches && node.matches(TOOLTIP_SELECTOR)) {
                        hideTooltips();
                        return;
                    }
                    if (node.querySelector && node.querySelector(TOOLTIP_SELECTOR)) {
                        hideTooltips();
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    ensureStyle();
    applyModeAttribute();
    observeTooltips();

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
        window.addEventListener(type, onNativeTooltipPointerCapture, true);
    });
    window.addEventListener('pointerdown', onPointerDownCapture, true);
    window.addEventListener('click', onClickCapture, true);

    window.__myScriptCleanup = function() {
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
            window.removeEventListener(type, onNativeTooltipPointerCapture, true);
        });
        window.removeEventListener('pointerdown', onPointerDownCapture, true);
        window.removeEventListener('click', onClickCapture, true);
        restoreTooltips();
        document.documentElement.removeAttribute('data-dc-flight-tooltip-mode');
        var style = document.getElementById(STYLE_ID);
        if (style) {
            style.remove();
        }
        window.__myScriptCleanup = undefined;
    };
})();
