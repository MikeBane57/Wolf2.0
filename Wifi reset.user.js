// ==UserScript==
// @name         Wifi reset
// @namespace    Wolf 2.0
// @version      1.6.3
// @description  Default wifi-reset To: LOM.NOC@anuvu.com. Debug → extension only. Flowsheet/worksheet mailto; context menu.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @donkeycode-pref {"wifiResetDebugLog":{"type":"boolean","group":"Wifi reset debug","label":"Log to extension inspector","description":"When ON: debug lines post to DonkeyCODE service worker (DONKEYCODE_PAGE_LOG), not the page console. Default OFF.","default":false}}
// @donkeycode-pref {"wifiResetMailtoIframeWorksheet":{"type":"boolean","group":"Wifi reset mailto","label":"Flowsheet/worksheet: avoid anchor mailto","description":"ON (default): if hidden iframe mailto fails, retry iframe (don’t use a main-document link — can blank React on flowsheet/worksheet). OFF: allow anchor fallback on worksheet.","default":true}}
// @donkeycode-pref {"wifiResetContextMenuSchedule":{"type":"boolean","group":"Wifi reset schedule","label":"Right-click menu: Wifi reset","description":"On schedule, when the AC/aircraft context menu opens, add “Wifi reset” for allowlisted tails. Default ON.","default":true},"wifiResetContextMenuWorksheet":{"type":"boolean","group":"Wifi reset worksheet","label":"Right-click menu: Wifi reset","description":"On worksheet AC right-click (same targets as Send AC to WS), add “Wifi reset” for allowlisted N-numbers. Default ON.","default":true},"wifiResetWorksheetDblclick":{"type":"boolean","group":"Wifi reset worksheet","label":"Worksheet: double-click mailto","description":"OFF by default — use right-click menu. When ON, bubble dblclick + mailto on allowlisted tail.","default":false}}
// @donkeycode-pref {"wifiResetEmailTo":{"type":"string","group":"Wifi reset email","label":"To","description":"Full recipient address.","default":"LOM.NOC@anuvu.com","placeholder":"LOM.NOC@anuvu.com"},"wifiResetSubjectTemplate":{"type":"string","group":"Wifi reset email","label":"Subject template","description":"{tail} = registration. Only tails in the built-in allowlist trigger mail.","default":"Jet {tail} Wifi Reset","placeholder":"Jet {tail} Wifi Reset"},"wifiResetBodyTemplate":{"type":"string","group":"Wifi reset email","label":"Body template","description":"{tail} = aircraft registration.","default":"Hello Anuvu,\n\nPlease reset aircraft {tail}.\n\nThanks,\nDispatch, NOC\nSouthwest Airlines"}}
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

    var onDblClickCapture = null;
    var wifiDebugGlobalHooksInstalled = false;
    /** Same phase flag used for removeEventListener in cleanup. */
    var dblClickListenersUseCapture = true;

    /** AC context menu “Wifi reset” (worksheet + schedule; same discovery as Send AC to WS on worksheet). */
    var wsCtxMenuObserver = null;
    var acOnCtx = null;
    var wsLastContextRoot = null;
    var acLastExtractedTail = '';

    /** Context-menu mailto can fire twice in quick succession; debounce both schedule and worksheet. */
    var lastCtxMailtoKey = '';
    var lastCtxMailtoAt = 0;

    var RE_WS_N_NUMBER = /N\d{1,5}[A-Z]?/i;
    var RE_WS_TAIL_ALT = /\b([A-Z]{1,2}\d{1,5}[A-Z]{0,2})\b/;
    var RE_WS_LINE_ID = /^[A-Z0-9]{2,7}$/i;

    function wifiDebugEnabled() {
        var v = getPref('wifiResetDebugLog', false);
        return v === true || v === 'true';
    }

    function wifiDbg(msg, detail) {
        if (!wifiDebugEnabled()) {
            return;
        }
        try {
            var extra = '';
            if (detail !== undefined) {
                if (typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean') {
                    extra = ' ' + String(detail);
                } else {
                    try {
                        extra = ' ' + JSON.stringify(detail);
                    } catch (e) {
                        extra = ' ' + String(detail);
                    }
                }
            }
            donkeycodePageLog('[Wifi reset] ' + msg + extra, 'info');
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

    /** Page → DonkeyCODE extension service worker (not the site DevTools console). */
    function donkeycodePageLog(message, level) {
        var s = String(message == null ? '' : message);
        var lv = level || 'log';
        if (typeof window !== 'undefined' && window.top) {
            try {
                window.top.postMessage(
                    { type: 'DONKEYCODE_PAGE_LOG', message: s, level: lv },
                    '*'
                );
            } catch (e) {}
        }
    }

    function isWorksheetPath() {
        return (location.pathname || '').indexOf('/widgets/worksheet') === 0;
    }

    function isFlowsheetPath() {
        var p = (location.pathname || '').toLowerCase();
        var q = (location.search || '').toLowerCase();
        var h = (location.hash || '').toLowerCase();
        return (
            p.indexOf('flowsheet') >= 0 ||
            q.indexOf('flowsheet') >= 0 ||
            h.indexOf('flowsheet') >= 0
        );
    }

    function isSchedulePath() {
        return !isWorksheetPath();
    }

    /** Flowsheet + worksheet: never navigate mailto via anchor on main document (React white-screen). */
    function mailtoAvoidAnchorOnMainDoc() {
        if (isFlowsheetPath()) {
            return true;
        }
        if (isWorksheetPath()) {
            return (
                getPref('wifiResetMailtoIframeWorksheet', true) !== false &&
                getPref('wifiResetMailtoIframeWorksheet', true) !== 'false'
            );
        }
        return false;
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

    function extractAllowlistedTailFromText(s) {
        if (!s) {
            return null;
        }
        TAIL_RE.lastIndex = 0;
        var m;
        while ((m = TAIL_RE.exec(String(s))) !== null) {
            var t = String(m[1]).toUpperCase();
            if (WIFI_RESET_ALLOWLIST[t]) {
                return t;
            }
        }
        return null;
    }

    function wsTextOneLine(el) {
        if (!el) {
            return '';
        }
        return String(el.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function wsTailFromPlainLine(s) {
        if (!s) {
            return '';
        }
        s = String(s).replace(/\s+/g, ' ').trim();
        if (s.length < 2 || s.length > 35) {
            return '';
        }
        if (/^[A-Z]{3}$/i.test(s)) {
            return '';
        }
        if (s.indexOf('#') === 0) {
            return '';
        }
        var m = s.match(RE_WS_N_NUMBER);
        if (m) {
            return m[0].toUpperCase();
        }
        m = s.match(RE_WS_TAIL_ALT);
        if (m) {
            return m[1].toUpperCase();
        }
        if (RE_WS_LINE_ID.test(s) && !/^\d+$/.test(s)) {
            return s.toUpperCase();
        }
        return '';
    }

    function wsExtractTailFromAcBlock(root) {
        if (!root || !root.querySelector) {
            return '';
        }
        var tryEls = [];
        var sels = ['div[class*="opUU"]', 'div[class*="o8Cnb"]', 'div[class*="AId8"]'];
        var q;
        for (q = 0; q < sels.length; q++) {
            var n = root.querySelector(sels[q]);
            if (n) {
                tryEls.push(n);
            }
        }
        for (q = 0; q < tryEls.length; q++) {
            var t0 = wsTailFromPlainLine(wsTextOneLine(tryEls[q]));
            if (t0) {
                return t0;
            }
        }
        var cand = tryEls[0] || null;
        var t = cand ? wsTextOneLine(cand) : wsTextOneLine(root);
        if (!t) {
            return '';
        }
        var m = t.match(RE_WS_N_NUMBER);
        if (m) {
            return m[0].toUpperCase();
        }
        m = t.match(RE_WS_TAIL_ALT);
        if (m) {
            return m[1].toUpperCase();
        }
        var kids = root.querySelectorAll('div');
        var i;
        for (i = 0; i < kids.length; i++) {
            var t1 = wsTailFromPlainLine(wsTextOneLine(kids[i]));
            if (t1) {
                return t1;
            }
        }
        t = wsTextOneLine(root);
        m = t.match(RE_WS_N_NUMBER);
        if (m) {
            return m[0].toUpperCase();
        }
        m = t.match(RE_WS_TAIL_ALT);
        if (m) {
            return m[1].toUpperCase();
        }
        return wsTailFromPlainLine(t);
    }

    function wsExtractTailFromIataTypeInRoot(root) {
        if (!root || !root.querySelector) {
            return '';
        }
        var el =
            root.querySelector('[data-testid="iata-tooltip-type"], [data-testid="iata-display-type"]') || null;
        if (!el) {
            return '';
        }
        var raw = wsTextOneLine(el);
        if (!raw) {
            return '';
        }
        var parts = raw.split(/\s+/);
        var i;
        for (i = parts.length - 1; i >= 0; i--) {
            var t0 = wsTailFromPlainLine(parts[i]);
            if (t0) {
                return t0;
            }
        }
        return wsTailFromPlainLine(raw);
    }

    function wsEnsureTailForPopup(popup, preferFromPopup) {
        if (preferFromPopup) {
            var t0 = wsExtractTailFromIataTypeInRoot(popup) || wsExtractTailFromAcBlock(popup);
            if (t0) {
                acLastExtractedTail = t0;
                wifiDbg('ctx tail (popup)', t0);
                return t0;
            }
        }
        var t = String(acLastExtractedTail || '').trim();
        if (t) {
            return t;
        }
        t = wsExtractTailFromIataTypeInRoot(popup) || wsExtractTailFromAcBlock(popup);
        if (t) {
            acLastExtractedTail = t;
        }
        return String(acLastExtractedTail || '').trim();
    }

    function wsIsLikelyAcContextMenuPopup(popup) {
        if (!popup || !popup.querySelector || !popup.classList) {
            return false;
        }
        var c = (popup.getAttribute('class') || '') + ' ';
        if (c.indexOf('popup') < 0) {
            return false;
        }
        var menu = popup.querySelector('.ui.vertical.menu, [class*="menu"]');
        if (!menu) {
            return false;
        }
        var a = menu.querySelector('a.item');
        var tx = a ? a.textContent || '' : '';
        tx = tx.replace(/\s+/g, ' ').toLowerCase();
        return tx.indexOf('aircraft') >= 0;
    }

    function wsIsLikelyAcInfoOrLockPopup(popup) {
        if (!popup || !popup.querySelector || !popup.classList) {
            return false;
        }
        var c = (popup.getAttribute('class') || '') + ' ';
        if (c.indexOf('popup') < 0) {
            return false;
        }
        if (popup.getAttribute('data-testid') === 'lock-tooltip') {
            return true;
        }
        if (!popup.querySelector('[data-testid="iata-tooltip-type"]')) {
            return false;
        }
        var tx = String(popup.textContent || '').replace(/\s+/g, ' ');
        return /cycles|hours|line\s+cycles/i.test(tx);
    }

    function wireWifiResetContextMenuItem(popup, opts) {
        if (popup.getAttribute('data-dc-wifi-reset-wired') === '1') {
            return;
        }
        if (isWorksheetPath() && getPref('wifiResetContextMenuWorksheet', true) === false) {
            return;
        }
        if (isSchedulePath() && getPref('wifiResetContextMenuSchedule', true) === false) {
            return;
        }
        opts = opts || {};
        var menu = opts.menu;
        if (!menu) {
            menu = popup.querySelector('div.ui.vertical.menu');
        }
        if (!menu) {
            menu = popup.querySelector('div[class*="Bw0ugF5aVzw"]');
        }
        if (!menu) {
            menu = popup.querySelector('div[class*="menu"]');
        }
        var firstItem = menu && menu.querySelector('a') ? menu.querySelector('a') : null;
        var appendParent = opts.appendParent || menu;
        if (!appendParent) {
            return;
        }
        var rawTail = wsEnsureTailForPopup(popup, opts.standalone);
        var wifiTail = extractAllowlistedTailFromText(rawTail);
        if (!wifiTail && rawTail) {
            wifiTail = extractAllowlistedTailFromText(popup.textContent || '');
        }
        popup.setAttribute('data-dc-wifi-reset-wired', '1');

        var item = document.createElement('a');
        item.setAttribute('role', 'menuitem');
        item.setAttribute('data-dc-wifi-reset-item', '1');
        item.className = (firstItem && firstItem.className) ? firstItem.className : 'item';
        item.href = '#';
        item.textContent = 'Wifi reset';
        if (!wifiTail) {
            item.style.cssText =
                (item.style.cssText || '') + 'opacity:.45!important;pointer-events:none!important;';
            item.title = 'No aircraft on the wifi-reset allowlist found in this context.';
        }
        function activate(ev) {
            if (!wifiTail) {
                return;
            }
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            var wt = wifiTail;
            wifiDbg('context menu Wifi reset → mailto', wt);
            /** Synchronous mailto in user gesture (no setTimeout — keeps window.open unblocked; avoids double mailto from mousedown+click). */
            openMailtoForTail(wt, { userGesture: true });
        }
        item.addEventListener('click', activate, true);

        if (opts.standalone) {
            item.style.cssText =
                (item.style.cssText || '') +
                'display:block!important;padding:.65em 1.15em!important;border-top:1px solid rgba(34,36,38,.12)!important;margin-top:.3em!important;';
        }
        try {
            appendParent.appendChild(item);
        } catch (e) {
            wifiDbg('append Wifi reset menu item failed', e);
        }
    }

    function wsScheduleRescanForPopups() {
        var delays = [0, 32, 120, 400];
        var d;
        for (d = 0; d < delays.length; d++) {
            setTimeout(wsScanForContextMenus, delays[d]);
        }
    }

    function wsScanForContextMenus() {
        var list = document.querySelectorAll('div.ui.popup, div[class*="popup"]');
        var i;
        for (i = 0; i < list.length; i++) {
            var p = list[i];
            if (!p.querySelector) {
                continue;
            }
            if (!/visible/.test(p.getAttribute('class') || '')) {
                continue;
            }
            if (wsIsLikelyAcContextMenuPopup(p)) {
                wireWifiResetContextMenuItem(p);
            } else if (wsIsLikelyAcInfoOrLockPopup(p)) {
                wireWifiResetContextMenuItem(p, { standalone: true, appendParent: p });
            }
        }
    }

    function wsOnContextMenu(e) {
        if (!isWorksheetPath()) {
            return;
        }
        if (getPref('wifiResetContextMenuWorksheet', true) === false) {
            return;
        }
        var t = e.target;
        if (!t) {
            return;
        }
        var el = t.nodeType === 1 ? t : t.parentElement;
        if (!el) {
            return;
        }
        var hasType = el.closest ? el.closest('[data-testid="iata-display-type"]') : null;
        var hasTooltipType = el.closest ? el.closest('[data-testid="iata-tooltip-type"]') : null;
        var inBlock =
            (el.closest &&
                el.closest(
                    'div.AoJn2gDrLWo, [class*="AoJn2gDrLWo"], [class*="XrjX-V8q874"], [class*="XrjX"]'
                )) ||
            null;
        if (inBlock) {
            wsLastContextRoot = inBlock;
        } else if (hasType) {
            wsLastContextRoot = hasType.closest('div') || hasType;
        } else if (hasTooltipType) {
            wsLastContextRoot = hasTooltipType.closest('div') || hasTooltipType;
        } else {
            return;
        }
        var extracted =
            wsExtractTailFromIataTypeInRoot(wsLastContextRoot) || wsExtractTailFromAcBlock(wsLastContextRoot);
        if (extracted) {
            acLastExtractedTail = extracted;
            wifiDbg('worksheet contextmenu tail', acLastExtractedTail);
        }
        wsScheduleRescanForPopups();
    }

    function scheduleOnContextMenu(e) {
        if (!isSchedulePath()) {
            return;
        }
        if (getPref('wifiResetContextMenuSchedule', true) === false) {
            return;
        }
        var t = e.target;
        if (!t) {
            return;
        }
        var el = t.nodeType === 1 ? t : t.parentElement;
        var tail = el ? findAllowlistedTailFromEventTarget(el) : null;
        if (tail) {
            acLastExtractedTail = tail;
            wifiDbg('schedule contextmenu tail', tail);
        }
        wsScheduleRescanForPopups();
    }

    function acOnContextMenu(e) {
        if (isWorksheetPath()) {
            wsOnContextMenu(e);
        } else {
            scheduleOnContextMenu(e);
        }
    }

    function initAcContextMenu() {
        if (
            getPref('wifiResetContextMenuWorksheet', true) === false &&
            getPref('wifiResetContextMenuSchedule', true) === false
        ) {
            return;
        }
        acOnCtx = acOnContextMenu;
        document.addEventListener('contextmenu', acOnCtx, true);
        wsCtxMenuObserver = new MutationObserver(function () {
            wsScanForContextMenus();
        });
        try {
            wsCtxMenuObserver.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {
            wsCtxMenuObserver = null;
        }
        wifiDbg('AC context menu listener installed');
    }

    function applyTemplate(tpl, tail) {
        return String(tpl || '')
            .split('{tail}').join(tail)
            .replace(/\r\n/g, '\n');
    }

    function mailtoHrefForTail(tail) {
        var to = String(getPref('wifiResetEmailTo', 'LOM.NOC@anuvu.com') || 'LOM.NOC@anuvu.com').trim();
        var subject = applyTemplate(
            getPref('wifiResetSubjectTemplate', 'Jet {tail} Wifi Reset'),
            tail
        );
        var body = applyTemplate(
            getPref('wifiResetBodyTemplate', 'Hello Anuvu,\n\nPlease reset aircraft {tail}.\n\nThanks,\nDispatch, NOC\nSouthwest Airlines'),
            tail
        );
        return (
            'mailto:' +
            encodeURIComponent(to) +
            '?subject=' +
            encodeURIComponent(subject) +
            '&body=' +
            encodeURIComponent(body)
        );
    }

    /**
     * Programmatic link click on main document — OK on schedule; on worksheet + external mail handler
     * some Chromium builds blank the SPA after launching mailto.
     */
    function openMailtoViaAnchorClick(href) {
        var a = document.createElement('a');
        a.href = href;
        a.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    /**
     * Hidden iframe navigation — keeps mailto off the main frame (often fixes React white-screen).
     */
    function openMailtoViaHiddenIframe(href) {
        var iframe = document.createElement('iframe');
        iframe.style.cssText =
            'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.src = href;
        document.body.appendChild(iframe);
        setTimeout(function () {
            try {
                iframe.remove();
            } catch (e) {}
        }, 8000);
    }

    function contextMenuMailtoShouldDebounce(tail) {
        var now = Date.now();
        var key = String(tail || '');
        if (key === lastCtxMailtoKey && now - lastCtxMailtoAt < 900) {
            wifiDbg('mailto debounced (duplicate)', tail);
            return true;
        }
        lastCtxMailtoKey = key;
        lastCtxMailtoAt = now;
        return false;
    }

    /**
     * @param {string} tail
     * @param {{ userGesture?: boolean }} [opts] — context menu: hidden iframe only (no window.open — avoids tab flash; isolates mailto from React main frame).
     */
    function openMailtoForTail(tail, opts) {
        opts = opts || {};
        try {
            var href = mailtoHrefForTail(tail);
            if (opts.userGesture && contextMenuMailtoShouldDebounce(tail)) {
                return;
            }
            /** Right-click menu: always use hidden iframe synchronously (schedule/flowsheet + worksheet). */
            if (opts.userGesture) {
                try {
                    openMailtoViaHiddenIframe(href);
                    wifiDbg('openMailto: context menu iframe', tail);
                } catch (errIframe) {
                    wifiDbg('context menu iframe mailto failed', errIframe);
                    if (mailtoAvoidAnchorOnMainDoc()) {
                        setTimeout(function () {
                            try {
                                openMailtoViaHiddenIframe(href);
                            } catch (e2) {
                                wifiDbg('mailto iframe retry failed', e2);
                            }
                        }, 280);
                    } else {
                        openMailtoViaAnchorClick(href);
                    }
                }
                return;
            }
            if (
                mailtoAvoidAnchorOnMainDoc()
            ) {
                wifiDbg('openMailto: deferred iframe (flowsheet/worksheet safe path)', tail);
                setTimeout(function () {
                    try {
                        openMailtoViaHiddenIframe(href);
                        wifiDbg('openMailto worksheet: iframe src set', tail);
                    } catch (err2) {
                        wifiDbg('iframe mailto failed, anchor fallback', err2);
                        if (!mailtoAvoidAnchorOnMainDoc()) {
                            openMailtoViaAnchorClick(href);
                        }
                    }
                }, 280);
                return;
            }
            if (!mailtoAvoidAnchorOnMainDoc()) {
                openMailtoViaAnchorClick(href);
                wifiDbg('openMailtoForTail done', tail);
            }
        } catch (err) {
            wifiDbg('openMailtoForTail threw', err && err.stack ? err.stack : String(err));
        }
    }

    function init() {
        installWifiDebugGlobalHooks();
        wifiDbg('init', {
            path: location.pathname,
            href: location.href.split('?')[0],
            flowsheet: isFlowsheetPath(),
            contextMenuSchedule:
                isSchedulePath() && getPref('wifiResetContextMenuSchedule', true) !== false,
            contextMenuWorksheet:
                isWorksheetPath() && getPref('wifiResetContextMenuWorksheet', true) !== false,
            worksheetDblclick:
                isWorksheetPath() &&
                (getPref('wifiResetWorksheetDblclick', false) === true ||
                    getPref('wifiResetWorksheetDblclick', false) === 'true'),
            debug: wifiDebugEnabled()
        });

        initAcContextMenu();

        if (
            isWorksheetPath() &&
            (getPref('wifiResetWorksheetDblclick', false) === true ||
                getPref('wifiResetWorksheetDblclick', false) === 'true')
        ) {
            dblClickListenersUseCapture = false;
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
                        phase: 'bubble-worksheet',
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
                    var t = tail;
                    setTimeout(function () {
                        wifiDbg('opening mailto (deferred)', t);
                        openMailtoForTail(t);
                    }, 0);
                } catch (err) {
                    wifiDbg('dblclick handler threw', err && err.stack ? err.stack : String(err));
                }
            };
            document.addEventListener('dblclick', onDblClickCapture, dblClickListenersUseCapture);
        }
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
        if (acOnCtx) {
            try {
                document.removeEventListener('contextmenu', acOnCtx, true);
            } catch (ec) {}
            acOnCtx = null;
        }
        if (wsCtxMenuObserver) {
            try {
                wsCtxMenuObserver.disconnect();
            } catch (ec2) {}
            wsCtxMenuObserver = null;
        }
        try {
            document.querySelectorAll('[data-dc-wifi-reset-wired]').forEach(function (n) {
                n.removeAttribute('data-dc-wifi-reset-wired');
            });
            document.querySelectorAll('[data-dc-wifi-reset-item]').forEach(function (n) {
                n.remove();
            });
        } catch (ec3) {}
        if (onDblClickCapture) {
            document.removeEventListener('dblclick', onDblClickCapture, dblClickListenersUseCapture);
            onDblClickCapture = null;
        }
        window.__myScriptCleanup = undefined;
    };
})();
