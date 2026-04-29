// ==UserScript==
// @name         Wifi reset
// @namespace    Wolf 2.0
// @version      1.4.1
// @description  Worksheet: no span highlights + mailto without stopPropagation (fixes blank UI after dblclick). Schedule unchanged. Debug pref wifiResetDebugLog.
// @match        https://opssuitemain.swacorp.com/*
// @grant        none
// @donkeycode-pref {"wifiResetHighlightEnabled":{"type":"boolean","group":"Wifi reset highlight","label":"Highlight allowlisted tails","description":"Color aircraft registrations that are in the wifi email list.","default":true},"wifiResetHighlightColor":{"type":"select","group":"Wifi reset highlight","label":"Tail highlight color","description":"Normal weight — only the color changes.","default":"#87CEFA","options":[{"value":"#87CEFA","label":"Sky blue"},{"value":"#ADD8E6","label":"Light blue"},{"value":"#B0E0E6","label":"Powder blue"},{"value":"#AFEEEE","label":"Pale turquoise"},{"value":"#7EC8E3","label":"Carolina blue"},{"value":"#6BB6FF","label":"Soft sky"},{"value":"#5DADE2","label":"Soft cyan"},{"value":"#48CAE4","label":"Bright sky"},{"value":"#89CFF0","label":"Baby blue"},{"value":"#9DD9F3","label":"Light cyan blue"},{"value":"#00BFFF","label":"Deep sky blue"},{"value":"#40E0D0","label":"Turquoise"}]}}
// @donkeycode-pref {"wifiResetDebugLog":{"type":"boolean","group":"Wifi reset debug","label":"Log to browser console","description":"When ON: prefix [Wifi reset] — init path, double-clicks, highlight/mail errors, window.onerror and unhandledrejection. Default OFF. Use to diagnose white-screen; turn OFF after.","default":false}}
// @donkeycode-pref {"wifiResetEmailTo":{"type":"string","group":"Wifi reset email","label":"To","description":"Full recipient address (include LOM> prefix if your mail uses it).","default":"LOM>NOC@anuvu.com","placeholder":"LOM>NOC@anuvu.com"},"wifiResetSubjectTemplate":{"type":"string","group":"Wifi reset email","label":"Subject template","description":"{tail} = registration. Only tails in the built-in allowlist trigger mail.","default":"Jet {tail} Wifi Reset","placeholder":"Jet {tail} Wifi Reset"},"wifiResetBodyTemplate":{"type":"string","group":"Wifi reset email","label":"Body template","description":"{tail} = aircraft registration.","default":"Hello Anuvu,\n\nPlease reset aircraft {tail}.\n\nThanks,\nDispatch, NOC\nSouthwest Airlines"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Wifi%20reset.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Wifi%20reset.user.js
// ==/UserScript==

(function() {
    'use strict';

    var TAIL_RE = /\b(N[0-9A-Z]{4,6})\b/g;

    /** Southwest wifi-reset fleet allowlist (640 tails). */
    var WIFI_RESET_ALLOWLIST = {
        N1801U:1,N1802U:1,N1803U:1,N1804U:1,N1805U:1,N1806U:1,N1807U:1,N1808U:1,N1809U:1,N1810U:1,
        N1811U:1,N200WN:1,N201LV:1,N203WN:1,N204WN:1,N205WN:1,N206WN:1,N207WN:1,N208WN:1,N209WN:1,
        N210WN:1,N211WN:1,N212WN:1,N213WN:1,N214WN:1,N215WN:1,N216WR:1,N217JC:1,N218WN:1,N219WN:1,
        N220WN:1,N221WN:1,N222WN:1,N224WN:1,N225WN:1,N226WN:1,N227WN:1,N228WN:1,N229WN:1,N231WN:1,
        N232WN:1,N234WN:1,N236WN:1,N240WN:1,N241WN:1,N242WN:1,N243WN:1,N244WN:1,N245WN:1,N246LV:1,
        N247WN:1,N248WN:1,N249WN:1,N250WN:1,N251WN:1,N252WN:1,N253WN:1,N254WN:1,N255WN:1,N256WN:1,
        N257WN:1,N258WN:1,N259WN:1,N260WN:1,N261WN:1,N262WN:1,N263WN:1,N264LV:1,N265WN:1,N266WN:1,
        N267WN:1,N268WN:1,N269WN:1,N272WN:1,N273WN:1,N274WN:1,N275WN:1,N276WN:1,N277WN:1,N278WN:1,
        N279WN:1,N280WN:1,N281WN:1,N282WN:1,N283WN:1,N284WN:1,N285WN:1,N286WN:1,N287WN:1,N288WN:1,
        N289CT:1,N290WN:1,N291WN:1,N292WN:1,N293WN:1,N294WN:1,N295WN:1,N296WN:1,N297WN:1,N298WN:1,
        N299WN:1,N428WN:1,N429WN:1,N431WN:1,N435WN:1,N436WN:1,N437WN:1,N438WN:1,N439WN:1,N440LV:1,
        N441WN:1,N442WN:1,N443WN:1,N444WN:1,N445WN:1,N446WN:1,N447WN:1,N448WN:1,N449WN:1,N451WN:1,
        N452WN:1,N453WN:1,N454WN:1,N455WN:1,N456WN:1,N457WN:1,N458WN:1,N459WN:1,N460WN:1,N461WN:1,
        N462WN:1,N463WN:1,N464WN:1,N465WN:1,N467WN:1,N468WN:1,N469WN:1,N470WN:1,N472WN:1,N473WN:1,
        N474WN:1,N475WN:1,N476WN:1,N477WN:1,N478WN:1,N479WN:1,N480WN:1,N481WN:1,N482WN:1,N483WN:1,
        N485WN:1,N486WN:1,N487WN:1,N488WN:1,N489WN:1,N491WN:1,N494WN:1,N495WN:1,N497WN:1,N498WN:1,
        N499WN:1,N500WR:1,N555LV:1,N556WN:1,N561WN:1,N563WN:1,N566WN:1,N567WN:1,N569WN:1,N570WN:1,
        N7702A:1,N7704B:1,N7713A:1,N7715E:1,N7721E:1,N7723E:1,N7724A:1,N7729A:1,N7731A:1,N7732A:1,
        N7733B:1,N7734H:1,N7735A:1,N7736A:1,N7737E:1,N7738A:1,N7739A:1,N7740A:1,N7741C:1,N7742B:1,
        N7743B:1,N7744A:1,N7745A:1,N7746C:1,N7747C:1,N7748A:1,N7749B:1,N7750A:1,N7751A:1,N7752B:1,
        N7815L:1,N7820L:1,N7821L:1,N7823A:1,N7825A:1,N7826B:1,N7827A:1,N7828A:1,N7831B:1,N7832A:1,
        N7833A:1,N7843A:1,N7844A:1,N7847A:1,N7848A:1,N7852A:1,N7854B:1,N7855A:1,N7857B:1,N7858A:1,
        N7860A:1,N7861J:1,N7862A:1,N7868K:1,N7869A:1,N7873A:1,N7874B:1,N7875A:1,N7876A:1,N7877H:1,
        N7878A:1,N7879A:1,N7880D:1,N7881A:1,N7885A:1,N7886A:1,N7887A:1,N7888A:1,N7889A:1,N8301J:1,
        N8302F:1,N8303R:1,N8305E:1,N8306H:1,N8307K:1,N8308K:1,N8309C:1,N8310C:1,N8311Q:1,N8312C:1,
        N8313F:1,N8314L:1,N8315C:1,N8316H:1,N8317M:1,N8318F:1,N8319F:1,N8320J:1,N8321D:1,N8322X:1,
        N8323C:1,N8324A:1,N8325D:1,N8326F:1,N8327A:1,N8328A:1,N8329B:1,N8501V:1,N8502Z:1,N8503A:1,
        N8504G:1,N8507C:1,N8508W:1,N8509U:1,N8510E:1,N8511K:1,N8512U:1,N8513F:1,N8514F:1,N8515X:1,
        N8517F:1,N8518R:1,N8519R:1,N8520Q:1,N8522P:1,N8523W:1,N8524Z:1,N8525S:1,N8526W:1,N8527Q:1,
        N8528Q:1,N8529Z:1,N8530W:1,N8531Q:1,N8532S:1,N8533S:1,N8534Z:1,N8535S:1,N8536Z:1,N8537Z:1,
        N8538V:1,N8539V:1,N8540V:1,N8541W:1,N8542Z:1,N8543Z:1,N8544Z:1,N8545V:1,N8546V:1,N8547V:1,
        N8548P:1,N8549Z:1,N8550Q:1,N8551Q:1,N8552Z:1,N8553W:1,N8554X:1,N8555Z:1,N8556Z:1,N8557Q:1,
        N8558Z:1,N8559Q:1,N8560Z:1,N8561Z:1,N8562Z:1,N8563Z:1,N8564Z:1,N8565Z:1,N8566Z:1,N8567Z:1,
        N8568Z:1,N8569Z:1,N8570W:1,N8571Z:1,N8572X:1,N8573Z:1,N8574Z:1,N8575Z:1,N8576Z:1,N8577Z:1,
        N8578Q:1,N8579Z:1,N8580Z:1,N8581Z:1,N8582Z:1,N8583Z:1,N8584Z:1,N8600F:1,N8602F:1,N8603F:1,
        N8605E:1,N8606C:1,N8607M:1,N8608N:1,N8609A:1,N8610A:1,N8611F:1,N8612K:1,N8613K:1,N8614M:1,
        N8619F:1,N8623F:1,N8626B:1,N8628A:1,N8629A:1,N8630B:1,N8631A:1,N8632A:1,N8633A:1,N8635F:1,
        N8637A:1,N8638A:1,N8639B:1,N8640D:1,N8641B:1,N8643A:1,N8644C:1,N8645A:1,N8646B:1,N8647A:1,
        N8648A:1,N8649A:1,N8650F:1,N8651A:1,N8652B:1,N8653A:1,N8654B:1,N8655D:1,N8656B:1,N8657B:1,
        N8658A:1,N8659D:1,N8660A:1,N8661A:1,N8662F:1,N8663A:1,N8664J:1,N8665D:1,N8667D:1,N8668A:1,
        N8669B:1,N8670A:1,N8671D:1,N8672F:1,N8673F:1,N8674B:1,N8675A:1,N8676A:1,N8677A:1,N8678E:1,
        N8679A:1,N8680C:1,N8681M:1,N8682B:1,N8683D:1,N8684F:1,N8685B:1,N8686A:1,N8687A:1,N8688J:1,
        N8689C:1,N8690A:1,N8691A:1,N8692F:1,N8693A:1,N8694E:1,N8695D:1,N8696E:1,N8697C:1,N8698B:1,
        N8699A:1,N8702L:1,N8704Q:1,N8705Q:1,N8706W:1,N8707P:1,N8708Q:1,N8709Q:1,N8710M:1,N8711Q:1,
        N8712L:1,N8713M:1,N8714Q:1,N8715Q:1,N8716B:1,N8717M:1,N8718Q:1,N8719Q:1,N871HK:1,N8720L:1,
        N8721J:1,N8722L:1,N8723Q:1,N8724J:1,N8725L:1,N8726H:1,N8727M:1,N8728Q:1,N8729H:1,N872CB:1,
        N8730Q:1,N8731J:1,N8732S:1,N8733M:1,N8734Q:1,N8735L:1,N8736J:1,N8737L:1,N8738K:1,N8739L:1,
        N8740A:1,N8741L:1,N8742M:1,N8743K:1,N8744B:1,N8745K:1,N8746Q:1,N8747Q:1,N8748Q:1,N8749Q:1,
        N8750Q:1,N8751R:1,N8752Q:1,N8753Q:1,N8754S:1,N8755L:1,N8756S:1,N8757L:1,N8758L:1,N8759Q:1,
        N8760L:1,N8761L:1,N8762Q:1,N8763L:1,N8764Q:1,N8765Q:1,N8766T:1,N8767M:1,N8768Q:1,N8769Q:1,
        N8770Q:1,N8771D:1,N8772M:1,N8773Q:1,N8774Q:1,N8775Q:1,N8776L:1,N8777Q:1,N8778Q:1,N8779Q:1,
        N8780Q:1,N8781Q:1,N8782Q:1,N8783L:1,N8784Q:1,N8785L:1,N8786Q:1,N8787K:1,N8788L:1,N8789Q:1,
        N8790Q:1,N8791D:1,N8792Q:1,N8793Q:1,N8794Q:1,N8795L:1,N8796L:1,N8797Q:1,N8798Q:1,N8800L:1,
        N8801Q:1,N8802Q:1,N8803L:1,N8804L:1,N8805L:1,N8806Q:1,N8807L:1,N8808Q:1,N8809L:1,N8810L:1,
        N8811L:1,N8812Q:1,N8813Q:1,N8814K:1,N8815L:1,N8816Q:1,N8817L:1,N8818Q:1,N8819L:1,N8820L:1,
        N8821S:1,N8822Q:1,N8823Q:1,N8824Q:1,N8825Q:1,N8826Q:1,N8827Q:1,N8828L:1,N8829Q:1,N8830Q:1,
        N8831L:1,N8832H:1,N8833L:1,N8834L:1,N8835Q:1,N8836Q:1,N8837Q:1,N8838Q:1,N8839Q:1,N8840Q:1,
        N8841L:1,N8842L:1,N8843S:1,N8844Q:1,N8845L:1,N8846Q:1,N8847Q:1,N8848Q:1,N900WN:1,N901WN:1,
        N902WN:1,N903WN:1,N904WN:1,N906WN:1,N907WN:1,N908WN:1,N909WN:1,N910WN:1,N912WN:1,N913WN:1,
        N914WN:1,N915WN:1,N917WN:1,N919WN:1,N920WN:1,N922WN:1,N923WN:1,N924WN:1,N925WN:1,N926WN:1,
        N927WN:1,N928WN:1,N929WN:1,N930WN:1,N931WN:1,N932WN:1,N936WN:1,N937WN:1,N938WN:1,N939WN:1,
        N940WN:1,N941WN:1,N942WN:1,N943WN:1,N944WN:1,N945WN:1,N946WN:1,N947WN:1,N948WN:1,N949WN:1,
        N950WN:1,N951WN:1,N952WN:1,N953WN:1,N954WN:1,N955WN:1,N956WN:1,N957WN:1,N958WN:1,N959WN:1,
        N960WN:1,N961WN:1,N962WN:1,N963WN:1,N964WN:1,N965WN:1,N966WN:1,N967WN:1,N968WN:1,N969WN:1
    };

    /** Same leg-puck notion as Turns W&B Launcher — do not steal dblclick here (capture runs first). */
    var FLIGHT_PUCK_SELECTOR =
        '[data-qe-id="as-flight-leg-puck"], [data-testid="puck-context-menu"], [class*="CScizp4RisE="]';

    var HIGHLIGHT_CLASS = 'dc-wifi-reset-tail';

    var onDblClickCapture = null;
    var highlightMo = null;
    var highlightDebounce = null;
    var wifiDebugGlobalHooksInstalled = false;
    /** Same phase flag used for removeEventListener in cleanup. */
    var dblClickListenersUseCapture = true;

    function wifiDebugEnabled() {
        var v = getPref('wifiResetDebugLog', false);
        return v === true || v === 'true';
    }

    function wifiDbg(msg, detail) {
        if (!wifiDebugEnabled()) {
            return;
        }
        try {
            if (detail !== undefined) {
                console.info('[Wifi reset]', msg, detail);
            } else {
                console.info('[Wifi reset]', msg);
            }
        } catch (e) {}
    }

    function installWifiDebugGlobalHooks() {
        if (!wifiDebugEnabled() || wifiDebugGlobalHooksInstalled) {
            return;
        }
        wifiDebugGlobalHooksInstalled = true;
        var onErr = function (ev) {
            wifiDbg('window error event', {
                message: ev.message,
                source: ev.filename,
                line: ev.lineno,
                col: ev.colno,
                err: ev.error && ev.error.stack ? String(ev.error.stack) : ev.error
            });
        };
        var onRej = function (ev) {
            wifiDbg('unhandledrejection', ev.reason);
        };
        window.__wifiResetErrorHook = onErr;
        window.__wifiResetRejectionHook = onRej;
        window.addEventListener('error', onErr, true);
        window.addEventListener('unhandledrejection', onRej);
    }

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

    function isWorksheetPath() {
        return (location.pathname || '').indexOf('/widgets/worksheet') === 0;
    }

    /** Splitting text into spans breaks React on worksheet; mail still resolves from text without wrappers. */
    function allowHighlightMutation() {
        return !isWorksheetPath();
    }

    function findAllowlistedTailFromEventTarget(target) {
        if (!target) {
            return null;
        }
        var el = target.nodeType === 3 ? target.parentElement : target;
        if (!el || el.nodeType !== 1) {
            return null;
        }
        var hop;
        for (hop = 0; hop < 14 && el; hop++) {
            var text = el.textContent || '';
            TAIL_RE.lastIndex = 0;
            var m;
            while ((m = TAIL_RE.exec(text)) !== null) {
                var t = String(m[1]).toUpperCase();
                if (WIFI_RESET_ALLOWLIST[t]) {
                    return t;
                }
            }
            el = el.parentElement;
        }
        return null;
    }

    function highlightEnabled() {
        return getPref('wifiResetHighlightEnabled', true) !== false;
    }

    function highlightColor() {
        var c = String(getPref('wifiResetHighlightColor', '#87CEFA') || '#87CEFA').trim();
        if (/^#[0-9A-Fa-f]{3,8}$/.test(c)) {
            return c;
        }
        return '#87CEFA';
    }

    function unwrapHighlights() {
        var nodes = document.querySelectorAll('span.' + HIGHLIGHT_CLASS);
        var i;
        for (i = 0; i < nodes.length; i++) {
            var sp = nodes[i];
            var parent = sp.parentNode;
            if (!parent) {
                continue;
            }
            var txt = document.createTextNode(sp.textContent || '');
            parent.replaceChild(txt, sp);
        }
    }

    /**
     * Split text nodes so allowlisted N-numbers are wrapped in colored spans.
     */
    function highlightAllowlistedTailsInTextNode(textNode) {
        try {
            if (!textNode || textNode.nodeType !== 3) {
                return;
            }
            var parent = textNode.parentNode;
            if (!parent) {
                return;
            }
            if (parent.closest && parent.closest('.' + HIGHLIGHT_CLASS)) {
                return;
            }
            var tag = parent.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') {
                return;
            }

            var text = textNode.nodeValue;
            if (!text || (text.indexOf('N') === -1 && text.indexOf('n') === -1)) {
                return;
            }

            TAIL_RE.lastIndex = 0;
            var segments = [];
            var lastIndex = 0;
            var m;
            var anyHit = false;
            while ((m = TAIL_RE.exec(text)) !== null) {
                if (m.index > lastIndex) {
                    segments.push({ kind: 'plain', value: text.slice(lastIndex, m.index) });
                }
                var tail = String(m[1]).toUpperCase();
                if (WIFI_RESET_ALLOWLIST[tail]) {
                    segments.push({ kind: 'hit', value: tail });
                    anyHit = true;
                } else {
                    segments.push({ kind: 'plain', value: m[0] });
                }
                lastIndex = m.index + m[0].length;
            }
            if (lastIndex < text.length) {
                segments.push({ kind: 'plain', value: text.slice(lastIndex) });
            }
            if (!anyHit) {
                return;
            }

            var frag = document.createDocumentFragment();
            var col = highlightColor();
            var si;
            for (si = 0; si < segments.length; si++) {
                var seg = segments[si];
                if (seg.kind === 'plain') {
                    frag.appendChild(document.createTextNode(seg.value));
                } else {
                    var span = document.createElement('span');
                    span.className = HIGHLIGHT_CLASS;
                    span.setAttribute('data-dc-wifi-tail', seg.value);
                    span.textContent = seg.value;
                    span.style.color = col;
                    frag.appendChild(span);
                }
            }
            parent.replaceChild(frag, textNode);
        } catch (err) {
            wifiDbg('highlightAllowlistedTailsInTextNode threw', err && err.stack ? err.stack : String(err));
        }
    }

    function walkForHighlight(node) {
        try {
            if (!allowHighlightMutation()) {
                return;
            }
            if (!node) {
                return;
            }
            if (node.nodeType === 3) {
                highlightAllowlistedTailsInTextNode(node);
                return;
            }
            if (node.nodeType !== 1) {
                return;
            }
            if (node.classList && node.classList.contains(HIGHLIGHT_CLASS)) {
                return;
            }
            var tn = node.tagName;
            if (tn === 'SCRIPT' || tn === 'STYLE' || tn === 'NOSCRIPT' || tn === 'TEXTAREA') {
                return;
            }

            var snapshot = [];
            var ci;
            for (ci = 0; ci < node.childNodes.length; ci++) {
                snapshot.push(node.childNodes[ci]);
            }
            for (ci = 0; ci < snapshot.length; ci++) {
                walkForHighlight(snapshot[ci]);
            }
        } catch (err) {
            wifiDbg('walkForHighlight threw', err && err.stack ? err.stack : String(err));
        }
    }

    function applyTailHighlights() {
        if (!highlightEnabled() || !allowHighlightMutation()) {
            unwrapHighlights();
            return;
        }
        if (document.body) {
            walkForHighlight(document.body);
        }
    }

    function scheduleHighlight() {
        if (!highlightEnabled() || !allowHighlightMutation()) {
            unwrapHighlights();
            return;
        }
        if (highlightDebounce) {
            clearTimeout(highlightDebounce);
        }
        highlightDebounce = setTimeout(function() {
            highlightDebounce = null;
            unwrapHighlights();
            applyTailHighlights();
        }, 280);
    }

    function applyTemplate(tpl, tail) {
        return String(tpl || '')
            .split('{tail}').join(tail)
            .replace(/\r\n/g, '\n');
    }

    function openMailtoForTail(tail) {
        try {
            var to = String(getPref('wifiResetEmailTo', 'LOM>NOC@anuvu.com') || 'LOM>NOC@anuvu.com').trim();
            var subject = applyTemplate(
                getPref('wifiResetSubjectTemplate', 'Jet {tail} Wifi Reset'),
                tail
            );
            var body = applyTemplate(
                getPref('wifiResetBodyTemplate', 'Hello Anuvu,\n\nPlease reset aircraft {tail}.\n\nThanks,\nDispatch, NOC\nSouthwest Airlines'),
                tail
            );
            var href =
                'mailto:' +
                encodeURIComponent(to) +
                '?subject=' +
                encodeURIComponent(subject) +
                '&body=' +
                encodeURIComponent(body);
            var a = document.createElement('a');
            a.href = href;
            a.style.cssText = 'position:fixed;left:-9999px;top:0;';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            wifiDbg('openMailtoForTail done', tail);
        } catch (err) {
            wifiDbg('openMailtoForTail threw', err && err.stack ? err.stack : String(err));
        }
    }

    function init() {
        installWifiDebugGlobalHooks();
        wifiDbg('init', {
            path: location.pathname,
            href: location.href.split('?')[0],
            highlight: highlightEnabled(),
            worksheetSkipsDomHighlight: isWorksheetPath(),
            debug: wifiDebugEnabled()
        });

        scheduleHighlight();
        if (allowHighlightMutation()) {
            highlightMo = new MutationObserver(function () {
                scheduleHighlight();
            });
            if (document.documentElement) {
                highlightMo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
            }
        }

        dblClickListenersUseCapture = !isWorksheetPath();
        onDblClickCapture = function (e) {
            try {
                if (e.button !== 0) {
                    return;
                }
                var tgt = e.target;
                var tag = tgt && tgt.nodeType === 1 ? tgt.tagName : '';
                var sample =
                    tgt && tgt.nodeType === 1 && typeof tgt.className === 'string'
                        ? String(tgt.className).slice(0, 80)
                        : '';
                wifiDbg('dblclick', {
                    phase: isWorksheetPath() ? 'bubble-worksheet' : 'capture-schedule',
                    path: location.pathname,
                    tag: tag,
                    class: sample,
                    onPuck: !!(tgt && typeof tgt.closest === 'function' && tgt.closest(FLIGHT_PUCK_SELECTOR))
                });
                if (tgt && typeof tgt.closest === 'function' && tgt.closest(FLIGHT_PUCK_SELECTOR)) {
                    return;
                }
                var tail = findAllowlistedTailFromEventTarget(tgt);
                wifiDbg('resolved tail', tail || '(none)');
                if (!tail) {
                    return;
                }
                if (isWorksheetPath()) {
                    /** Let React receive the full native dblclick; mailto next tick (no stopPropagation). */
                    var t = tail;
                    setTimeout(function () {
                        wifiDbg('opening mailto (deferred)', t);
                        openMailtoForTail(t);
                    }, 0);
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                wifiDbg('opening mailto', tail);
                openMailtoForTail(tail);
            } catch (err) {
                wifiDbg('dblclick handler threw', err && err.stack ? err.stack : String(err));
            }
        };
        document.addEventListener('dblclick', onDblClickCapture, dblClickListenersUseCapture);
    }

    init();

    window.__myScriptCleanup = function() {
        if (window.__wifiResetErrorHook) {
            try {
                window.removeEventListener('error', window.__wifiResetErrorHook, true);
            } catch (e) {}
            window.__wifiResetErrorHook = null;
        }
        if (window.__wifiResetRejectionHook) {
            try {
                window.removeEventListener('unhandledrejection', window.__wifiResetRejectionHook);
            } catch (e2) {}
            window.__wifiResetRejectionHook = null;
        }
        if (highlightDebounce) {
            clearTimeout(highlightDebounce);
            highlightDebounce = null;
        }
        if (highlightMo) {
            highlightMo.disconnect();
            highlightMo = null;
        }
        unwrapHighlights();
        if (onDblClickCapture) {
            document.removeEventListener('dblclick', onDblClickCapture, dblClickListenersUseCapture);
            onDblClickCapture = null;
        }
        window.__myScriptCleanup = undefined;
    };
})();
