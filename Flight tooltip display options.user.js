// ==UserScript==
// @name         Flight tooltip display options
// @namespace    Wolf 2.0
// @version      0.2.0
// @description  Choose whether the native flight tooltip shows on hover, click only, or not at all
// @match        https://opssuitemain.swacorp.com/worksheet*
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"flightTooltipDisplayMode":{"type":"select","group":"Flight tooltip","label":"Display mode","description":"Hover = site default. Click = suppress hover and open the flight tooltip after clicking a flight puck. Disabled = hide flight tooltips.","default":"hover","options":[{"value":"hover","val":"hover","label":"Hover (site default)"},{"value":"click","val":"click","label":"Click only"},{"value":"disabled","val":"disabled","label":"Disabled"}]},"flightTooltipDebug":{"type":"boolean","group":"Flight tooltip","label":"Debug logging","description":"Log tooltip display controller events to the browser console.","default":false}}
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
    var allowClickTooltipUntil = 0;
    var observer = null;
    var lastHoverLogAt = 0;

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

    function getMode() {
        var mode = String(getPref('flightTooltipDisplayMode', 'hover') || 'hover').toLowerCase();
        if (mode !== 'click' && mode !== 'disabled') {
            return 'hover';
        }
        return mode;
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
            'html[data-dc-flight-tooltip-mode="click"] ' + TOOLTIP_SELECTOR + ':not([data-dc-flight-tooltip-click-open="1"]){' +
            'display:none!important;visibility:hidden!important;pointer-events:none!important;' +
            '}' +
            'html[data-dc-flight-tooltip-mode="disabled"] ' + TOOLTIP_SELECTOR + '{' +
            'display:none!important;visibility:hidden!important;pointer-events:none!important;' +
            '}';
    }

    function applyModeAttribute() {
        var mode = getMode();
        document.documentElement.setAttribute('data-dc-flight-tooltip-mode', mode);
        if (mode === 'disabled') {
            hideTooltips();
        } else if (mode === 'click') {
            hideNonClickTooltips();
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
        document.querySelectorAll(TOOLTIP_SELECTOR + '[data-dc-flight-tooltip-click-open="1"]').forEach(function(tip) {
            tip.removeAttribute('data-dc-flight-tooltip-click-open');
        });
    }

    function hideNonClickTooltips() {
        document.querySelectorAll(TOOLTIP_SELECTOR).forEach(function(tip) {
            if (tip.getAttribute('data-dc-flight-tooltip-click-open') === '1') {
                return;
            }
            tip.style.display = 'none';
            tip.style.visibility = 'hidden';
            tip.setAttribute('data-dc-flight-tooltip-hidden', '1');
        });
    }

    function markOrHideTooltip(tip) {
        var mode = getMode();
        if (!tip) {
            return;
        }
        if (mode === 'disabled') {
            hideTooltips();
            return;
        }
        if (mode !== 'click') {
            return;
        }
        if (Date.now() <= allowClickTooltipUntil) {
            tip.removeAttribute('data-dc-flight-tooltip-hidden');
            tip.style.display = '';
            tip.style.visibility = '';
            tip.setAttribute('data-dc-flight-tooltip-click-open', '1');
            log('tooltip allowed from click', tip);
            return;
        }
        tip.removeAttribute('data-dc-flight-tooltip-click-open');
        tip.style.display = 'none';
        tip.style.visibility = 'hidden';
        tip.setAttribute('data-dc-flight-tooltip-hidden', '1');
        log('tooltip hidden because it was hover-created', tip);
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
        allowClickTooltipUntil = Date.now() + 1500;
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
        allowClickTooltipUntil = 0;
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
        var now = Date.now();
        if (now - lastHoverLogAt > 1000) {
            lastHoverLogAt = now;
            log('blocked native hover event', e.type, e.target);
        }
        if (getMode() === 'disabled') {
            hideTooltips();
        } else {
            hideNonClickTooltips();
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
            if (getMode() === 'hover') {
                return;
            }
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType !== 1) {
                        return;
                    }
                    if (node.matches && node.matches(TOOLTIP_SELECTOR)) {
                        markOrHideTooltip(node);
                        return;
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll(TOOLTIP_SELECTOR).forEach(markOrHideTooltip);
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    ensureStyle();
    applyModeAttribute();
    observeTooltips();
    log('initialized', { mode: getMode(), href: location.href });

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
