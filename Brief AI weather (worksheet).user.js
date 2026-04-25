// ==UserScript==
// @name         Brief AI weather (worksheet)
// @namespace    Wolf 2.0
// @version      0.1.1
// @description  Worksheet: regional weather brief (METAR-based) with optional free-tier Gemini; button left of WS state, right of WX.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @grant        GM_xmlhttpRequest
// @connect      aviationweather.gov
// @connect      generativelanguage.googleapis.com
// @donkeycode-pref {"briefAiGeminiKey":{"type":"string","group":"Brief AI","label":"Gemini API key (optional)","description":"Get a free key at https://aistudio.google.com/apikey — if blank, a template brief is used (no LLM).","default":"","placeholder":"AIza...","password":true},"briefAiExtraStations":{"type":"string","group":"Brief AI","label":"Extra stations of concern","description":"Space- or comma-separated IATA codes merged into the fetch (all regions).","default":"","placeholder":"e.g. OAK ABQ"},"briefAiGeminiModel":{"type":"string","group":"Brief AI","label":"Gemini model","default":"gemini-2.0-flash","placeholder":"gemini-2.0-flash"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Brief%20AI%20weather%20(worksheet).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Brief%20AI%20weather%20(worksheet).user.js
// ==/UserScript==

(function () {
    'use strict';

    var HOST_ID = 'dc-brief-ai-ws-host';
    var BTN_ATTR = 'data-dc-brief-ai-btn';
    var MODAL_ATTR = 'data-dc-brief-ai-modal';
    var STYLE_ID = 'dc-brief-ai-ws-style';
    var WX_SEL = '[data-dc-metar-watch-btn="1"]';
    var STATE_HOST_ID = 'dc-ws-state-reload-host';

    /** Default WN regions (IATA). Duplicates in source lists are de-duped at runtime. */
    var DEFAULT_EAST =
        'PWM MHT BOS PVD BDL ALB ISP LGA PHL BWI DCA IAD ROC BUF PIT RIC ORF RDU CLT GSP ATL MYR CHS SAV JAC MCO PBI FLL MIA RSW TPA RSQ ECP PNS VPS MSY MEM BNA TYS';
    var DEFAULT_CENTRAL =
        'CLE DTW GRR MKE MDW MSP DSM OMA MCI STL IND SDF CVG CMH ICT TUL OKC LIT JAN DAL HOU AUS SAT CRP HRL LBB AMA MAF';
    var DEFAULT_WEST =
        'DEN COS MTJ HDN ABQ ELP TUS SAN PSP ONT SNA BUR LAX LGB FAT STS SMF RNO LAS SLC PHX OAK SFO SJC EUG PDX SEA GEG BOI BZN';
    var DEFAULT_INTL =
        'LIH HNL OGG KOA ITO ANC SJO PVR SJD BZE CUN LIR MBJ GCM AUA SJU STT PLS HAV NAS PUJ SXM';

    /** 3-letter IATA → 4-letter ICAO where not K+3 (US) or C+3 (rare). */
    var IATA_TO_ICAO = {
        // Hawaii
        LIH: 'PHLI',
        HNL: 'PHNL',
        OGG: 'PHOG',
        KOA: 'PHKO',
        ITO: 'PHTO',
        // Alaska
        ANC: 'PANC',
        // Selected international / Caribbean
        SJO: 'MROC',
        PVR: 'MMPR',
        SJD: 'MMSD',
        BZE: 'MZBZ',
        CUN: 'MMUN',
        LIR: 'MRLB',
        MBJ: 'MKJS',
        GCM: 'MWCR',
        AUA: 'TNCA',
        SJU: 'TJSJ',
        STT: 'TIST',
        PLS: 'MMBT',
        HAV: 'MUHA',
        NAS: 'MYNN',
        PUJ: 'MDPC',
        SXM: 'TNCM'
    };

    var mountRaf = 0;
    var mountObserver = null;
    var modalOpen = false;
    var mountInterval = null;

    function isWorksheetPage() {
        try {
            return String(location.pathname || '').indexOf('/widgets/worksheet') === 0;
        } catch (e) {
            return false;
        }
    }

    function trim(s) {
        return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
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

    function parseStationList(s) {
        if (!s) {
            return [];
        }
        var parts = String(s).split(/[\s,]+/);
        var out = [];
        var seen = Object.create(null);
        var i;
        for (i = 0; i < parts.length; i++) {
            var t = trim(parts[i]).toUpperCase();
            if (t.length !== 3 || !/^[A-Z]{3}$/.test(t)) {
                continue;
            }
            if (seen[t]) {
                continue;
            }
            seen[t] = 1;
            out.push(t);
        }
        return out;
    }

    function icaoForIata(iata) {
        var u = String(iata || '').toUpperCase();
        if (u.length !== 3) {
            return null;
        }
        if (IATA_TO_ICAO[u]) {
            return IATA_TO_ICAO[u];
        }
        return 'K' + u;
    }

    function buildRegionMap() {
        var extra = parseStationList(getPref('briefAiExtraStations', ''));
        var m = {
            East: parseStationList(DEFAULT_EAST),
            Central: parseStationList(DEFAULT_CENTRAL),
            West: parseStationList(DEFAULT_WEST),
            'Intl/ETOPS': parseStationList(DEFAULT_INTL)
        };
        if (extra.length) {
            var e;
            for (e = 0; e < extra.length; e++) {
                m.East.push(extra[e]);
            }
        }
        var r;
        for (r in m) {
            if (Object.prototype.hasOwnProperty.call(m, r)) {
                m[r] = dedupeStrings(m[r]);
            }
        }
        return m;
    }

    function dedupeStrings(arr) {
        var out = [];
        var seen = Object.create(null);
        var i;
        for (i = 0; i < arr.length; i++) {
            if (!arr[i] || seen[arr[i]]) {
                continue;
            }
            seen[arr[i]] = 1;
            out.push(arr[i]);
        }
        return out;
    }

    function gmXhrJson(method, url, body) {
        return new Promise(function (resolve) {
            try {
                GM_xmlhttpRequest({
                    method: method,
                    url: url,
                    headers: { Accept: 'application/json' },
                    data: body || null,
                    onload: function (r) {
                        var code = (r && r.status) || 0;
                        if (code < 200 || code > 299) {
                            resolve({ err: 'HTTP ' + code });
                            return;
                        }
                        try {
                            var j = JSON.parse((r && r.responseText) || 'null');
                            resolve({ data: j });
                        } catch (e) {
                            resolve({ err: 'bad JSON' });
                        }
                    },
                    onerror: function () {
                        resolve({ err: 'network' });
                    },
                    ontimeout: function () {
                        resolve({ err: 'timeout' });
                    }
                });
            } catch (e) {
                resolve({ err: String(e) });
            }
        });
    }

    var BATCH = 50;

    function fetchMetarBatch(icaoList) {
        if (!icaoList.length) {
            return Promise.resolve([]);
        }
        var ids = icaoList.join(',');
        var u =
            'https://aviationweather.gov/api/data/metar?ids=' +
            encodeURIComponent(ids) +
            '&format=json&hours=2';
        return gmXhrJson('GET', u, null).then(function (p) {
            if (p.err) {
                return [];
            }
            return Array.isArray(p.data) ? p.data : [];
        });
    }

    function allIcaoForRegionList(iatas) {
        var icaos = [];
        var i;
        for (i = 0; i < iatas.length; i++) {
            var ic = icaoForIata(iatas[i]);
            if (ic) {
                icaos.push(ic);
            }
        }
        return dedupeStrings(icaos);
    }

    function fltOrder(cat) {
        var c = String(cat || 'UNK').toUpperCase();
        if (c === 'LIFR') {
            return 0;
        }
        if (c === 'IFR') {
            return 1;
        }
        if (c === 'MVFR') {
            return 2;
        }
        if (c === 'VFR') {
            return 3;
        }
        return 2;
    }

    function scoreStation(rec) {
        if (!rec) {
            return { score: 0, reasons: [] };
        }
        var w = 0;
        var reasons = [];
        var raw = (rec.rawOb || rec.text || rec.rawob || rec.raw || '') + '';
        var f = String(rec.fltCat || 'UNK').toUpperCase();
        w += 4 * Math.max(0, 3 - fltOrder(f));
        if (/IFR|LIFR|MVFR/.test(f)) {
            reasons.push('flt ' + f);
        }
        var wspd = rec.wspd;
        if (wspd != null && wspd >= 30) {
            w += 3;
            reasons.push('wind ' + wspd + ' kt');
        }
        var wgst = rec.wgst || rec.windGustKts;
        if (typeof wgst === 'number' && wgst >= 25) {
            w += 2;
        }
        var wxs = (rec.wxString || rec.wx_string || rec.weatherString || '') + '';
        if (/TS|FZDZ|FZRA|PL|SN|GR|\/\/|BR|UP/.test(wxs) || /TS|FZ|SN|GR|RA|DZ|SG/.test(raw)) {
            w += 2;
            if (/TS|VCTS|VCT/.test(wxs + raw)) {
                reasons.push('thunder');
            }
        }
        if (/\+RA|\+SN|\+TS/.test(wxs) || /\+[A-Z]{2}/.test(raw)) {
            w += 1;
        }
        if (/LOW VIS|1\/4|1\/2 SM|M1\/2/.test(raw)) {
            w += 1;
        }
        return { score: w, reasons: reasons, flt: f, raw: raw, icao: rec.icaoId || rec.icao || '' };
    }

    function summarizeRegion(iatas, recByIcao) {
        var worst = null;
        var ifrC = 0;
        var mvfrC = 0;
        var wCount = 0;
        var i;
        for (i = 0; i < iatas.length; i++) {
            var icao = icaoForIata(iatas[i]);
            if (!icao) {
                continue;
            }
            var rec = recByIcao[icao];
            if (!rec) {
                continue;
            }
            var sc = scoreStation(rec);
            if (sc.flt === 'IFR' || sc.flt === 'LIFR') {
                ifrC += 1;
            }
            if (sc.flt === 'MVFR') {
                mvfrC += 1;
            }
            if (sc.score >= 2) {
                wCount += 1;
            }
            if (!worst || sc.score > worst.score) {
                worst = { iata: iatas[i], icao: icao, sc: sc };
            }
        }
        return {
            total: iatas.length,
            ifr: ifrC,
            mvfr: mvfrC,
            withFlags: wCount,
            sample: worst
        };
    }

    function buildStructuredBrief(regionMap, recByIcao) {
        var out = { regions: {}, asOf: new Date().toISOString() };
        var k;
        for (k in regionMap) {
            if (!Object.prototype.hasOwnProperty.call(regionMap, k)) {
                continue;
            }
            var sum = summarizeRegion(regionMap[k], recByIcao);
            out.regions[k] = sum;
        }
        return out;
    }

    function templateParagraphs(struct) {
        var r = struct && struct.regions;
        if (!r) {
            return 'No regional data could be loaded. Check network or try again.';
        }
        var order = [
            'East',
            'Central',
            'West',
            'Intl/ETOPS'
        ];
        var parts = [];
        var i;
        for (i = 0; i < order.length; i++) {
            var name = order[i];
            var s = r[name];
            if (!s) {
                continue;
            }
            var line = name.toUpperCase() + ': ';
            if (s.total < 1) {
                line += 'No station list for this region.';
            } else if (!s.sample) {
                line +=
                    'No operational concerns foreseen: no METARs returned (fetch gap or all stations without recent obs).';
            } else {
                var sev = s.ifr + s.mvfr;
                if (sev < 1 && s.withFlags < 1) {
                    line += 'No operational concerns foreseen based on current DECODED sample.';
                } else {
                    var wx = s.sample;
                    var reas =
                        wx.sc && wx.sc.reasons && wx.sc.reasons.length
                            ? ' — ' + wx.sc.reasons.join(', ')
                            : '';
                    line +=
                        s.ifr +
                        ' site(s) IFR/LIFR, ' +
                        s.mvfr +
                        ' MVFR of ' +
                        s.total +
                        ' monitored. Highest-visibility concern ' +
                        wx.iata +
                        ' (' +
                        (wx.sc && (wx.sc.flt || 'UNK')) +
                        reas +
                        ').';
                }
            }
            parts.push(line);
        }
        return parts.join('\n\n');
    }

    function callGemini(prompt) {
        var key = trim(getPref('briefAiGeminiKey', ''));
        if (!key) {
            return Promise.resolve({ skip: 'no key' });
        }
        var model = trim(
            getPref('briefAiGeminiModel', 'gemini-2.0-flash') || 'gemini-2.0-flash'
        );
        var url =
            'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(model) +
            ':generateContent?key=' +
            encodeURIComponent(key);
        var body = JSON.stringify({
            contents: [
                {
                    parts: [{ text: prompt }]
                }
            ],
            generationConfig: {
                maxOutputTokens: 512,
                temperature: 0.25
            }
        });
        return new Promise(function (resolve) {
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: url,
                    headers: { 'Content-Type': 'application/json' },
                    data: body,
                    onload: function (r) {
                        var code = (r && r.status) || 0;
                        if (code < 200 || code > 299) {
                            resolve({
                                err:
                                    'Gemini HTTP ' +
                                    code +
                                    (r.responseText
                                        ? ': ' + (r.responseText + '').slice(0, 200)
                                        : '')
                            });
                            return;
                        }
                        try {
                            var o = JSON.parse((r && r.responseText) || '{}');
                            var t =
                                o.candidates &&
                                o.candidates[0] &&
                                o.candidates[0].content &&
                                o.candidates[0].content.parts &&
                                o.candidates[0].content.parts[0] &&
                                o.candidates[0].content.parts[0].text;
                            if (t) {
                                resolve({ text: t });
                            } else {
                                resolve({ err: 'empty Gemini response' });
                            }
                        } catch (e) {
                            resolve({ err: 'parse ' + e });
                        }
                    },
                    onerror: function () {
                        resolve({ err: 'Gemini network' });
                    },
                    ontimeout: function () {
                        resolve({ err: 'Gemini timeout' });
                    }
                });
            } catch (e) {
                resolve({ err: String(e) });
            }
        });
    }

    function runBrief() {
        var reg = buildRegionMap();
        var allIata = [].concat(
            reg['East'] || [],
            reg['Central'] || [],
            reg['West'] || [],
            reg['Intl/ETOPS'] || []
        );
        allIata = dedupeStrings(allIata);
        var allIcao = allIcaoForRegionList(allIata);
        var chunks = [];
        var c;
        for (c = 0; c < allIcao.length; c += BATCH) {
            chunks.push(allIcao.slice(c, c + BATCH));
        }
        if (!chunks.length) {
            return Promise.resolve('No station list.');
        }
        return Promise.all(chunks.map(function (ch) {
            return fetchMetarBatch(ch);
        })).then(function (arrays) {
            var flat = [].concat.apply([], arrays);
            var byIc = Object.create(null);
            var j;
            for (j = 0; j < flat.length; j++) {
                var o = flat[j];
                if (!o) {
                    continue;
                }
                var id = String(
                    o.icaoId || o.icao || o.stationId || ''
                ).toUpperCase();
                if (id) {
                    byIc[id] = o;
                }
            }
            var st = buildStructuredBrief(reg, byIc);
            var dataJson = JSON.stringify(st, null, 0);
            var sys = [
                'You are a Southwest Airlines operations-aware assistant.',
                'Write a concise professional weather brief: operational impacts of current and near-term (next ~6 hours implied by METAR/TAF context) conditions.',
                'Four regions, each 2-4 sentences MAX, or a single short sentence "No operational concerns are foreseen for this region based on the supplied summary" when appropriate.',
                'Region names: East, Central, West, Intl-ETOPS (Hawaii, Alaska, Mexico/Caribbean, international/ETOPS stations in the data).',
                'Do not invent specific airport hazards not implied by the JSON. Do not claim FAA or dispatch authority. Neutral professional tone.',
                'Output plain text only (no markdown, no bullet symbols).',
                'Structured JSON (counts and worst station per region):',
                dataJson
            ].join('\n');
            return callGemini(sys).then(function (g) {
                if (g.text) {
                    return g.text;
                }
                if (g.skip || g.err) {
                    return (
                        (g.err ? '[Template — Gemini unavailable: ' + g.err + ']\n\n' : '') +
                        templateParagraphs(st)
                    );
                }
                return templateParagraphs(st);
            });
        });
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent =
            '#' +
            HOST_ID +
            '{display:inline-flex;align-items:stretch;margin-left:4px;vertical-align:middle;}' +
            '[' +
            BTN_ATTR +
            ']{font:600 13px system-ui,Segoe UI,sans-serif;border:none;border-radius:4px;box-sizing:border-box;' +
            'background:#1a5270;color:#ecf0f1;padding:0 9px;min-height:32px;max-height:50px;display:inline-flex;' +
            'align-items:center;justify-content:center;cursor:pointer;white-space:nowrap;}' +
            '[' +
            BTN_ATTR +
            ']:hover{background:#21618c;}' +
            '[' +
            MODAL_ATTR +
            ']{position:fixed;inset:0;z-index:10000050;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-panel{width:min(700px,calc(100vw - 28px));max-height:min(80vh,720px);display:flex;flex-direction:column;' +
            'background:#1a1f28;color:#e8ecef;border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,.5);' +
            'font:14px/1.45 system-ui,Segoe UI,sans-serif;overflow:hidden;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid #334155;background:#0f1419;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-body{padding:14px 16px;overflow:auto;white-space:pre-wrap;word-break:break-word;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-foot{padding:10px 16px;border-top:1px solid #334155;display:flex;flex-wrap:wrap;gap:8px;align-items:center;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-foot button{font:600 12px system-ui,sans-serif;padding:6px 12px;border-radius:5px;cursor:pointer;border:1px solid #475569;background:#2d3748;color:#e2e8f0;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-foot button:hover{background:#3d4a5c;}';
        document.head.appendChild(st);
    }

    function closeModal() {
        var m = document.querySelector('[' + MODAL_ATTR + '="1"]');
        if (m && m.parentNode) {
            m.parentNode.removeChild(m);
        }
        modalOpen = false;
    }

    function openModalLoading() {
        closeModal();
        modalOpen = true;
        var root = document.createElement('div');
        root.setAttribute(MODAL_ATTR, '1');
        root.addEventListener('click', function (e) {
            if (e.target === root) {
                closeModal();
            }
        });
        root.innerHTML =
            '<div class="dc-bai-panel" data-stop-close="1">' +
            '<div class="dc-bai-head"><span>Regional weather brief</span><button type="button" data-bai-x style="background:transparent;border:0;color:#94a3b8;font:700 20px/1 system-ui;cursor:pointer">&times;</button></div>' +
            '<div class="dc-bai-body">Loading METARs and building brief…</div>' +
            '<div class="dc-bai-foot"></div></div>';
        var panel = root.querySelector('.dc-bai-panel');
        if (panel) {
            panel.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        }
        var bx = root.querySelector('[data-bai-x]');
        if (bx) {
            bx.addEventListener('click', function () {
                closeModal();
            });
        }
        document.body.appendChild(root);
        return root;
    }

    function fillModalError(root, text) {
        var body = root && root.querySelector('.dc-bai-body');
        if (body) {
            body.textContent = text;
        }
        addFooter(root);
    }

    function addFooter(root) {
        var foot = root && root.querySelector('.dc-bai-foot');
        if (!foot) {
            return;
        }
        foot.innerHTML = '';
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy';
        copy.addEventListener('click', function () {
            var body = root.querySelector('.dc-bai-body');
            var t = (body && body.textContent) || '';
            if (t && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(t).catch(function () {});
            }
        });
        var cl = document.createElement('button');
        cl.type = 'button';
        cl.textContent = 'Close';
        cl.addEventListener('click', closeModal);
        foot.appendChild(copy);
        foot.appendChild(cl);
    }

    function startBrief() {
        if (modalOpen) {
            return;
        }
        var root = openModalLoading();
        runBrief().then(
            function (text) {
                var body = root && root.querySelector('.dc-bai-body');
                if (body) {
                    body.textContent = trim(text) || 'Empty brief.';
                }
                addFooter(root);
            },
            function (err) {
                fillModalError(
                    root,
                    'Error: ' + (err && err.message ? err.message : String(err))
                );
            }
        );
    }

    function makeButton() {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute(BTN_ATTR, '1');
        b.textContent = 'Brief AI';
        b.title = 'AI-assisted regional weather brief (METAR-based; optional Gemini key)';
        b.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            startBrief();
        });
        return b;
    }


    function textLabel(el) {
        return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    }

    function findWorksheetFieldsRow() {
        var buttons = document.querySelectorAll('button');
        var i;
        for (i = 0; i < buttons.length; i++) {
            if (/^Clear WS$/i.test(textLabel(buttons[i]))) {
                var fields = buttons[i].closest && buttons[i].closest('.fields');
                if (fields) {
                    return fields;
                }
            }
        }
        var sorted = document.querySelector('div[name="sortedBy"]');
        return sorted && sorted.closest ? sorted.closest('.fields') : null;
    }

    function getOrCreateWorksheetHelperField() {
        var fields = findWorksheetFieldsRow();
        if (!fields) {
            return null;
        }
        var helper = fields.querySelector('[data-dc-worksheet-helper-buttons="1"]');
        if (helper) {
            return helper;
        }
        helper = document.createElement('div');
        helper.className = 'field';
        helper.setAttribute('data-dc-worksheet-helper-buttons', '1');
        helper.style.display = 'inline-flex';
        helper.style.alignItems = 'stretch';
        helper.style.gap = '4px';
        var clearButton = null;
        var buttons = fields.querySelectorAll('button');
        var i;
        for (i = 0; i < buttons.length; i++) {
            if (/^Clear WS$/i.test(textLabel(buttons[i]))) {
                clearButton = buttons[i];
                break;
            }
        }
        var clearField = clearButton && clearButton.closest ? clearButton.closest('.field') : null;
        if (clearField && clearField.parentNode === fields) {
            fields.insertBefore(helper, clearField.nextSibling);
        } else {
            fields.appendChild(helper);
        }
        return helper;
    }

    function removeEmptyWorksheetHelperField() {
        var helper = document.querySelector('[data-dc-worksheet-helper-buttons="1"]');
        if (helper && !helper.querySelector('button,#' + STATE_HOST_ID)) {
            try {
                helper.remove();
            } catch (e) {}
        }
    }

    /**
     * Same logic as WS state-reload / METAR: header + toolbar scan, time + GMT/Zulu.
     */
    function findGmtClockElement() {
        var scopes = [];
        var h = document.querySelector('header');
        if (h) {
            scopes.push(h);
        }
        var tb = document.querySelector(
            '[class*="toolbar"],[class*="Toolbar"],[class*="topbar"],[class*="TopBar"],[class*="app-bar"]'
        );
        if (tb) {
            scopes.push(tb);
        }
        if (!scopes.length) {
            scopes.push(document.body);
        }
        var si, sj;
        for (si = 0; si < scopes.length; si++) {
            var candidates = scopes[si].querySelectorAll(
                'span,div,button,p,time,li'
            );
            for (sj = 0; sj < candidates.length; sj++) {
                var el = candidates[sj];
                var t = trim(el.textContent || '');
                if (t.length > 120 || !/\d{1,2}:\d{2}/.test(t)) {
                    continue;
                }
                if (/GMT|Zulu|\bUTC\b|\(Z\)/i.test(t)) {
                    return el;
                }
            }
        }
        return null;
    }

    function mount() {
        if (!isWorksheetPage() || !document.body) {
            return;
        }
        ensureStyle();
        var host = document.getElementById(HOST_ID);
        if (!host) {
            host = document.createElement('span');
            host.id = HOST_ID;
            host.appendChild(makeButton());
        }
        var helper = getOrCreateWorksheetHelperField();
        if (helper) {
            host.style.cssText = '';
            var stateHost = document.getElementById(STATE_HOST_ID);
            try {
                if (stateHost && stateHost.parentNode === helper && host.parentNode !== helper) {
                    helper.insertBefore(host, stateHost);
                } else if (host.parentNode !== helper) {
                    helper.appendChild(host);
                }
            } catch (e) {
                try {
                    helper.appendChild(host);
                } catch (e2) {}
            }
            host.querySelectorAll('[' + BTN_ATTR + ']').forEach(function (b) {
                b.style.minHeight = '36px';
                b.style.height = 'auto';
                b.style.alignSelf = 'stretch';
            });
            return;
        }
        var wx = document.querySelector(WX_SEL);
        var anchor = wx || findGmtClockElement();
        if (anchor && anchor.parentNode) {
            var par = anchor.parentNode;
            if (host.parentNode) {
                try {
                    host.parentNode.removeChild(host);
                } catch (e3) {}
            }
            var stateHost2 = document.getElementById(STATE_HOST_ID);
            try {
                if (stateHost2 && stateHost2.parentNode === par) {
                    par.insertBefore(host, stateHost2);
                } else {
                    par.insertBefore(host, anchor.nextSibling);
                }
            } catch (e4) {
                try {
                    par.appendChild(host);
                } catch (e5) {}
            }
            try {
                var row = anchor.parentElement;
                if (row) {
                    var cs = window.getComputedStyle(row);
                    if (cs && cs.display !== 'flex' && cs.display !== 'inline-flex') {
                        row.style.display = 'flex';
                        row.style.alignItems = 'stretch';
                    }
                }
                var rowH = Math.max(
                    (row && (row.offsetHeight || row.clientHeight)) || 0,
                    anchor.offsetHeight || 0,
                    anchor.clientHeight || 0
                );
                if (rowH < 24) {
                    rowH = 36;
                }
                rowH = Math.min(rowH, 50);
                host.querySelectorAll('[' + BTN_ATTR + ']').forEach(function (b) {
                    b.style.minHeight = rowH + 'px';
                    b.style.height = 'auto';
                    b.style.alignSelf = 'stretch';
                });
            } catch (e6) {}
        } else {
            host.style.cssText =
                'position:fixed!important;right:12px!important;top:12px!important;z-index:100001!important;';
            try {
                document.body.appendChild(host);
            } catch (e7) {}
        }
    }

    function schedule() {
        if (mountRaf) {
            return;
        }
        mountRaf = requestAnimationFrame(function () {
            mountRaf = 0;
            mount();
        });
    }

    function startObservers() {
        if (isWorksheetPage() && document.body) {
            schedule();
        }
        if (typeof window.requestIdleCallback === 'function') {
            requestIdleCallback(function () {
                schedule();
            });
        } else {
            setTimeout(schedule, 0);
        }
        setTimeout(schedule, 400);
        setTimeout(schedule, 2000);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                setTimeout(schedule, 0);
            });
        }
    }
    startObservers();
    mountObserver = new MutationObserver(function () {
        schedule();
    });
    try {
        mountObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    } catch (e) {
        mountObserver = null;
    }
    mountInterval = setInterval(function () {
        if (isWorksheetPage()) {
            mount();
        }
    }, 2000);

    window.__myScriptCleanup = function () {
        if (mountObserver) {
            try {
                mountObserver.disconnect();
            } catch (e) {}
            mountObserver = null;
        }
        var h = document.getElementById(HOST_ID);
        if (h && h.parentNode) {
            try {
                h.parentNode.removeChild(h);
            } catch (e) {}
        }
        closeModal();
    };
})();
