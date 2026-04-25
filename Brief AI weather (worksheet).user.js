// ==UserScript==
// @name         Brief AI weather (worksheet)
// @namespace    Wolf 2.0
// @version      0.3.2
// @description  Worksheet: regional weather brief (METAR-based) — broad, conversational LLM brief; compose modal, stations-of-interest, optional LLM.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      aviationweather.gov
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      openrouter.ai
// @connect      localhost
// @connect      127.0.0.1
// @donkeycode-pref {"worksheetToolbarClickDebug":{"type":"boolean","group":"Brief AI","label":"Log click target (debug)","description":"Same as WS state: log pointerdown/click on worksheet helper.","default":false},"briefAiProvider":{"type":"select","group":"Brief AI","label":"LLM provider","description":"GitHub Copilot has no public HTTP API for this use. Groq: free key at https://console.groq.com — set Base URL to https://api.groq.com/openai/v1. Ollama: free local (open-source models), set URL to http://127.0.0.1:11434/v1. OpenRouter: https://openrouter.ai","default":"openai_compat","options":[{"val":"openai_compat","label":"OpenAI-compatible (Groq, OpenRouter, many others)"},{"val":"gemini","label":"Google Gemini (AI Studio key)"},{"val":"ollama","label":"Ollama local (http://127.0.0.1:11434/v1)"}]},"briefAiOpenaiBaseUrl":{"type":"string","group":"Brief AI","label":"OpenAI-compat: Base URL","default":"https://api.groq.com/openai/v1","placeholder":"https://api.groq.com/openai/v1"},"briefAiOpenaiKey":{"type":"string","group":"Brief AI","label":"OpenAI-compat: API key","default":"","password":true,"description":"e.g. Groq gs_... or OpenRouter sk-..."},"briefAiOpenaiModel":{"type":"string","group":"Brief AI","label":"OpenAI-compat: model id","default":"llama-3.3-70b-versatile","placeholder":"llama-3.3-70b-versatile"},"briefAiOllamaUrl":{"type":"string","group":"Brief AI","label":"Ollama: base URL (OpenAI path)","default":"http://127.0.0.1:11434/v1","placeholder":"http://127.0.0.1:11434/v1"},"briefAiOllamaModel":{"type":"string","group":"Brief AI","label":"Ollama: model name","default":"llama3.2","placeholder":"llama3.2"},"briefAiGeminiKey":{"type":"string","group":"Brief AI","label":"Gemini: API key","description":"https://aistudio.google.com/apikey","default":"","password":true},"briefAiGeminiModel":{"type":"string","group":"Brief AI","label":"Gemini: model","default":"gemini-2.0-flash","placeholder":"gemini-2.0-flash"},"briefAiExtraStations":{"type":"string","group":"Brief AI","label":"Default extra stations (pref)","description":"Also merged into METAR scope and pre-fills the compose dialog. Use the dialog to list what to call out; leave blank in the dialog to use the full WN default lists.","default":"","placeholder":"e.g. OAK ABQ"},"briefAiTemperature":{"type":"number","group":"Brief AI","label":"LLM temperature","description":"Higher = more chatty and varied (0.15–0.8). Suggest ~0.5–0.65 for a looser voice.","default":0.55,"min":0.1,"max":0.95,"step":0.05}}
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
    var onToolbarClickDebug = null;

    function isWorksheetPage() {
        try {
            var p = String(location.pathname || '');
            var h = String(location.hash || '');
            var u = String(location.href || '');
            if (p.indexOf('worksheet') >= 0) {
                return true;
            }
            if (/worksheet/i.test(h)) {
                return true;
            }
            if (/[?&/]worksheet/i.test(u)) {
                return true;
            }
            return p.indexOf('/widgets/worksheet') === 0;
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

    var DEFAULT_REGION_STATIONS = {
        East: DEFAULT_EAST,
        Central: DEFAULT_CENTRAL,
        West: DEFAULT_WEST,
        'Intl/ETOPS': DEFAULT_INTL
    };

    function iataListFromRegionDefaults(regionKey) {
        return parseStationList(
            (DEFAULT_REGION_STATIONS[regionKey] && String(DEFAULT_REGION_STATIONS[regionKey])) || ''
        );
    }

    function regionNameForIata(iata) {
        var u = String(iata || '').toUpperCase();
        if (u.length !== 3) {
            return 'East';
        }
        var r;
        for (r in DEFAULT_REGION_STATIONS) {
            if (!Object.prototype.hasOwnProperty.call(DEFAULT_REGION_STATIONS, r)) {
                continue;
            }
            if (iataListFromRegionDefaults(r).indexOf(u) >= 0) {
                return r;
            }
        }
        return 'East';
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
                m[regionNameForIata(extra[e])].push(extra[e]);
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

    /**
     * @param {string} watchListRaw - space/comma IATA; empty = full defaults (same as buildRegionMap)
     */
    function buildRegionMapForWatchList(watchListRaw) {
        var listed = parseStationList(watchListRaw);
        var fromPref = parseStationList(getPref('briefAiExtraStations', ''));
        if (!listed.length && !fromPref.length) {
            return buildRegionMap();
        }
        var all = dedupeStrings(listed.concat(fromPref));
        if (!all.length) {
            return buildRegionMap();
        }
        var m = { East: [], Central: [], West: [], 'Intl/ETOPS': [] };
        var k;
        for (k = 0; k < all.length; k++) {
            var code = all[k];
            m[regionNameForIata(code)].push(code);
        }
        for (k in m) {
            if (Object.prototype.hasOwnProperty.call(m, k)) {
                m[k] = dedupeStrings(m[k]);
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

    function regionAggregationForLlm(rName, sum) {
        var wx = sum && sum.sample;
        var sc = wx && wx.sc;
        var raw = sc && sc.raw ? String(sc.raw) : '';
        return {
            approxStationsInRegion: sum && typeof sum.total === 'number' ? sum.total : 0,
            sitesWithIfrOrLifr: sum && typeof sum.ifr === 'number' ? sum.ifr : 0,
            sitesWithMvfr: sum && typeof sum.mvfr === 'number' ? sum.mvfr : 0,
            sitesWithNotableHazards: sum && typeof sum.withFlags === 'number' ? sum.withFlags : 0,
            roughConvectiveSignal: sc && /TS|VCTS|VCT|CB|convect|thunder/i.test(
                (raw) + (sc.flt || '')
            )
                ? 'possible in snapshot'
                : 'none called out in snapshot',
            roughWintrySignal: sc && /FZ|SN|PL|ice|FZDZ|FZRA/i.test(raw)
                ? 'possible in snapshot'
                : 'none called out in snapshot',
            generalFlightCategoryTilt: sc && sc.flt
                ? String(sc.flt)
                : 'varied or unknown in snapshot',
            _omitAirportNames: true
        };
    }

    function buildAggregatedBriefForLlm(struct) {
        var r = (struct && struct.regions) || {};
        var out = {
            asOf: (struct && struct.asOf) || new Date().toISOString(),
            dataScope:
                'METAR-based snapshot; counts and themes only—no per-airport identities in this JSON.',
            regions: {}
        };
        var k;
        for (k in r) {
            if (Object.prototype.hasOwnProperty.call(r, k)) {
                out.regions[k] = regionAggregationForLlm(k, r[k]);
            }
        }
        return out;
    }

    function templateParagraphs(struct) {
        var r = struct && struct.regions;
        if (!r) {
            return '**East**\nNo data loaded—check network and try again.\n\n' +
                '**Central**\n(n/a)\n\n' +
                '**West**\n(n/a)\n\n' +
                '**Intl / ETOPS**\n(n/a)';
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
            var title = name === 'Intl/ETOPS' ? 'Intl / ETOPS' : name;
            if (!s || s.total < 1) {
                parts.push('**' + title + '**');
                parts.push(
                    "Nothing in our watch list for this slice—if you are not looking at a specific market here, you can move on."
                );
                continue;
            }
            if (!s.sample) {
                parts.push('**' + title + '**');
                parts.push(
                    "We are thin on a fresh look in the snapshot, so I would not lean on a story here—refresh the picture before you read too much into it."
                );
            } else {
                var sev = (s.ifr || 0) + (s.mvfr || 0);
                parts.push('**' + title + '**');
                if (sev < 1 && (s.withFlags || 0) < 1) {
                    parts.push(
                        "Feels pretty routine from what we are seeing in this pass—nothing that jumps out for network flow."
                    );
                } else {
                    parts.push(
                        "There is a little more 'weather' texture in the mix in this pass—keep an eye on flow if things bunch up, " +
                        "but we are not name-dropping airfields here unless you listed them in the form."
                    );
                }
            }
        }
        return parts.join('\n\n');
    }

    function llmTemperature() {
        var n = Number(getPref('briefAiTemperature', 0.55));
        if (!Number.isFinite(n)) {
            return 0.55;
        }
        return Math.min(0.95, Math.max(0.1, n));
    }

    function buildBriefPrompts(dataJson, userStations, userFocus) {
        var stList = trim(userStations || '');
        var focus = trim(userFocus || '');
        var stationRule = stList
            ? 'The user asked to call out these station codes (IATA) by name when relevant: ' + stList + '. Otherwise do not name specific airports, cities, or navaids—stay regional and thematic.'
            : 'Do not name any specific airport, city, or station code. Speak in broad regional terms only (e.g. "parts of the Southeast", "Gulf side", "upper Midwest").';
        var sys = [
            'You are a Southwest line ops / dispatch colleague giving a quick desk-side read—not a written METAR summary and not a checklist.',
            'Vibe: warm, easy, a little conversational. Use "we", short sentences, natural handoffs between regions. It is fine to use one casual bridge ("Anyway…", "Same story in the…", "Nothing weird jumping out in…", "if anything…") as long as it stays professional.',
            'Keep everything HIGH LEVEL: themes, "where the energy is" or "where it is quieter", and what might matter for flow—never inventory stats, never read IFR/LIFR/MVFR counts, never quote RVR, wind numbers, TAF time groups, or METAR text. Do not sound like a robot reciting the JSON.',
            'OUTPUT — plain text only. In this order, each on its own line: **East** then 2–4 short conversational sentences; blank line; **Central** then 2–4 sentences; blank line; **West** then 2–4 sentences; blank line; **Intl / ETOPS** (Hawaii, Alaska, Mexico & Caribbean, other intl in one bucket) then 2–4 sentences. Put nothing on the same line as the **Region** title—title line only, then body under it. No # markdown headings, no tables, no bullet lists unless it reads totally natural in speech.',
            stationRule,
            focus
                ? 'The user also noted this (weave in lightly if it helps; do not override the data snapshot): ' + focus
                : '',
            'The JSON is background texture only: rough counts and hazard flavour so you are not making things up. If a region is quiet, say that in a relaxed, human one-liner—skip stiff boilerplate.',
            'Aggregated snapshot (no per-airport identities in this object unless the user named stations in your other instructions):',
            dataJson
        ]
            .filter(function (x) {
                return String(x).length > 0;
            })
            .join('\n\n');
        return {
            system: sys,
            user:
                'Write the four-region voice brief now. **East**, **Central**, **West**, **Intl / ETOPS** each get their own line as the section title, then the chatty paragraph under it—no stats dump.'
        };
    }

    function gmXhrOpenAiChat(url, bodyObj, headers) {
        headers = headers || {};
        var h = { 'Content-Type': 'application/json' };
        var k;
        for (k in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, k) && headers[k] != null) {
                h[k] = headers[k];
            }
        }
        return new Promise(function (resolve) {
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: url,
                    headers: h,
                    data: JSON.stringify(bodyObj),
                    onload: function (r) {
                        var code = (r && r.status) || 0;
                        var raw = (r && r.responseText) || '';
                        if (code < 200 || code > 299) {
                            resolve({
                                err: 'HTTP ' + code + (raw ? ': ' + String(raw).slice(0, 300) : '')
                            });
                            return;
                        }
                        try {
                            var o = JSON.parse(raw || '{}');
                            var t =
                                o.choices &&
                                o.choices[0] &&
                                o.choices[0].message &&
                                o.choices[0].message.content;
                            t = t != null ? String(t) : '';
                            t = t.replace(/^\s+|\s+$/g, '');
                            if (t) {
                                resolve({ text: t });
                            } else {
                                resolve({ err: 'empty model response' });
                            }
                        } catch (e) {
                            resolve({ err: 'parse: ' + e });
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

    function callOpenAiCompatible(pr) {
        var prov = getPref('briefAiProvider', 'openai_compat');
        var base = trim(
            getPref('briefAiOpenaiBaseUrl', 'https://api.groq.com/openai/v1')
        );
        if (prov === 'ollama') {
            base = trim(
                getPref('briefAiOllamaUrl', 'http://127.0.0.1:11434/v1')
            );
        }
        if (!base) {
            return Promise.resolve({ skip: 'no base url' });
        }
        if (base.slice(-1) === '/') {
            base = base.replace(/\/+$/, '');
        }
        var key = trim(getPref('briefAiOpenaiKey', ''));
        if (prov === 'ollama') {
            key = '';
        }
        if (prov === 'openai_compat' && !key) {
            return Promise.resolve({ skip: 'no openai key' });
        }
        var model = trim(
            getPref('briefAiOpenaiModel', 'llama-3.3-70b-versatile')
        );
        if (prov === 'ollama') {
            model = trim(getPref('briefAiOllamaModel', 'llama3.2')) || 'llama3.2';
        }
        if (!model) {
            return Promise.resolve({ err: 'no model' });
        }
        var url = base + '/chat/completions';
        var hdrs = key ? { Authorization: 'Bearer ' + key } : {};
        var body = {
            model: model,
            messages: [
                { role: 'system', content: pr.system },
                { role: 'user', content: pr.user }
            ],
            max_tokens: 800,
            temperature: llmTemperature()
        };
        return gmXhrOpenAiChat(url, body, hdrs);
    }

    function callGemini(systemAndUser) {
        var asOne = typeof systemAndUser === 'string' ? systemAndUser : (systemAndUser && systemAndUser.system ? systemAndUser.system + '\n\n' + systemAndUser.user : '');
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
                    parts: [{ text: asOne }]
                }
            ],
            generationConfig: {
                maxOutputTokens: 800,
                temperature: llmTemperature()
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

    function runBrief(userStationsRaw, userFocus) {
        var reg = buildRegionMapForWatchList(userStationsRaw);
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
            var agg = buildAggregatedBriefForLlm(st);
            var dataJson = JSON.stringify(agg, null, 0);
            var pr = buildBriefPrompts(
                dataJson,
                userStationsRaw,
                userFocus
            );
            var prov = getPref('briefAiProvider', 'openai_compat');

            function doFallback(why) {
                if (why) {
                    return '[Template — ' + why + ']\n\n' + templateParagraphs(st);
                }
                return templateParagraphs(st);
            }

            if (prov === 'gemini') {
                return callGemini(
                    pr.system + '\n\n' + pr.user
                ).then(function (g) {
                    if (g.text) {
                        return g.text;
                    }
                    if (g.skip) {
                        return doFallback('Gemini: no API key. Set in Brief AI prefs.');
                    }
                    if (g.err) {
                        return doFallback('Gemini: ' + g.err);
                    }
                    return doFallback('');
                });
            }

            if (prov === 'openai_compat' && !trim(getPref('briefAiOpenaiKey', '')) && trim(getPref('briefAiGeminiKey', ''))) {
                return callGemini(pr.system + '\n\n' + pr.user).then(function (g) {
                    if (g.text) {
                        return g.text;
                    }
                    if (g.err) {
                        return doFallback('Gemini: ' + g.err);
                    }
                    return doFallback('Gemini unavailable.');
                });
            }

            return callOpenAiCompatible(pr).then(function (g) {
                if (g.text) {
                    return g.text;
                }
                if (g.skip) {
                    if (prov === 'ollama') {
                        return doFallback(
                            'Ollama: is it running? URL ' +
                            trim(
                                getPref('briefAiOllamaUrl', 'http://127.0.0.1:11434/v1')
                            )
                        );
                    }
                    return doFallback(
                        'OpenAI-style API: add key and Base URL (e.g. Groq, OpenRouter).'
                    );
                }
                if (g.err) {
                    return doFallback('LLM: ' + g.err);
                }
                return doFallback('');
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
            ',[data-dc-worksheet-helper-buttons="1"]' +
            '{position:relative!important;z-index:2147482000!important;pointer-events:auto!important;}' +
            '#' +
            HOST_ID +
            '{display:inline-flex;align-items:stretch;margin-left:0;vertical-align:middle;}' +
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
            '] .dc-bai-body{padding:14px 16px;overflow:auto;word-break:break-word;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-body--brief{font:15px/1.55 system-ui,Segoe UI,sans-serif;color:#e2e8f0;white-space:normal;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-brief-para{margin:0 0 0.5em;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-region{margin:0 0 10px;border:1px solid #3f4d5c;border-radius:8px;padding:10px 12px 12px;background:#141920;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-region-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-region .dc-bai-brief-title{margin:0;flex:1;min-width:0;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-copy-region{flex-shrink:0;font:600 11px system-ui,sans-serif;padding:4px 8px;border-radius:5px;cursor:pointer;border:1px solid #475569;background:#2a3444;color:#cbd5e1;align-self:flex-start;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-copy-region:hover{background:#3d4b5f;color:#e2e8f0;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-body--brief h4.dc-bai-brief-title{margin:0;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-body--brief h4.dc-bai-brief-title:first-child{margin-top:0;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-brief-title{margin:0;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-brief-title em{font-style:normal;font-weight:700;font-size:0.95em;letter-spacing:.01em;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-compose .dc-bai-field{margin:0 0 10px;display:flex;flex-direction:column;gap:4px;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-compose label{font-size:12px;font-weight:600;color:#94a3b8;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-compose textarea{min-height:64px;resize:vertical;font:13px/1.4 ui-monospace,monospace;box-sizing:border-box;width:100%;padding:8px;border:1px solid #475569;border-radius:6px;background:#0f1419;color:#e2e8f0;}' +
            '[' +
            MODAL_ATTR +
            '] .dc-bai-compose .dc-bai-hint{font-size:11px;color:#64748b;line-height:1.3;}' +
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

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    var REGION_TITLE_RE = /\*\*(East|Central|West|Intl\s*\/\s*ETOPS)\*\*/gi;

    function normalizeBriefTextForDisplay(plain) {
        var t = String(plain == null ? '' : plain)
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
        t = t.replace(REGION_TITLE_RE, function (m) {
            return '\n\n' + m + '\n';
        });
        t = t.replace(/^\s+|\s+$/g, '');
        t = t.replace(/\n{3,}/g, '\n\n');
        return t;
    }

    function formatBriefBodyHtml(plain) {
        var t = normalizeBriefTextForDisplay(plain);
        t = t.replace(/^\s+|\s+$/g, '');
        if (!t) {
            return '<div class="dc-bai-body--brief dc-bai-brief-bulk" data-brief="1"></div>';
        }
        var parts = t.split(/(?:\n\s*){2,}|\n(?=[\t ]*\*\*)/g);
        var out = [];
        var i;
        for (i = 0; i < parts.length; i++) {
            var b = String(parts[i] || '')
                .replace(/^\n+|\n+$/g, '')
                .trim();
            if (!b) {
                continue;
            }
            var m = /^\s*\*\*([^*]+?)\*\*[\s:]*/.exec(b);
            if (m) {
                var rest = String(b)
                    .slice(m[0].length)
                    .replace(/^\n+|\n+$/g, '');
                out.push(
                    '<section class="dc-bai-region" data-dc-bai-brief-section="1">' +
                    '<div class="dc-bai-region-head">' +
                    '<h4 class="dc-bai-brief-title"><em>' +
                    escHtml(m[1]) +
                    '</em></h4>' +
                    '<button type="button" class="dc-bai-copy-region" data-dc-bai-action="copy-region" title="Copy this region" aria-label="Copy this section">Copy</button>' +
                    '</div>' +
                    (rest
                        ? '<p class="dc-bai-brief-para">' +
                        escHtml(rest)
                            .split('\n')
                            .join('<br />') +
                        '</p>'
                        : '<p class="dc-bai-brief-para"></p>') +
                    '</section>'
                );
            } else {
                out.push(
                    '<p class="dc-bai-brief-para dc-bai-brief-lead">' +
                    escHtml(b)
                        .split('\n')
                        .join('<br />') +
                    '</p>'
                );
            }
        }
        if (!out.length) {
            out.push(
                '<p class="dc-bai-brief-para">' +
                escHtml(t)
                    .split('\n')
                    .join('<br />') +
                '</p>'
            );
        }
        return (
            '<div class="dc-bai-body--brief dc-bai-brief-bulk" data-brief="1">' + out.join('') + '</div>'
        );
    }

    function copyTextToClipboard(text) {
        var t = String(text == null ? '' : text);
        t = t.replace(/^\s+|\s+$/g, '');
        if (!t) {
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).catch(function () {});
            return;
        }
        try {
            var ta = document.createElement('textarea');
            ta.value = t;
            ta.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            try {
                ta.remove();
            } catch (e) {}
        } catch (e2) {}
    }

    function plainTextForBriefRegionSection(sec) {
        if (!sec) {
            return '';
        }
        var t = sec.querySelector('.dc-bai-brief-title em');
        var p = sec.querySelector('.dc-bai-brief-para');
        var line = '**' + trim((t && t.textContent) || '') + '**';
        if (p && p.textContent) {
            line += '\n' + trim(p.textContent);
        }
        return line;
    }

    function briefPlainTextFromBulkBody(body) {
        var root = body && body.querySelector('.dc-bai-brief-bulk');
        if (!root) {
            return (body && (body.innerText || body.textContent)) || '';
        }
        var segs = [];
        var c;
        var ch = root.children;
        for (c = 0; c < ch.length; c++) {
            var el = ch[c];
            if (el.getAttribute('data-dc-bai-brief-section') === '1') {
                segs.push(plainTextForBriefRegionSection(el));
            } else if (el.classList && el.classList.contains('dc-bai-brief-para')) {
                segs.push(trim((el && el.textContent) || ''));
            }
        }
        return segs
            .filter(function (s) { return s && s.length; })
            .join('\n\n');
    }

    function wireRegionCopyButtons(body) {
        if (!body) {
            return;
        }
        [].forEach.call(
            body.querySelectorAll('button.dc-bai-copy-region'),
            function (btn) {
                if (btn.getAttribute('data-dc-bai-copy-wired') === '1') {
                    return;
                }
                btn.setAttribute('data-dc-bai-copy-wired', '1');
                var sec = btn.closest && btn.closest('.dc-bai-region');
                if (!sec) {
                    return;
                }
                bindWorksheetToolbarButtonActivate(btn, function () {
                    copyTextToClipboard(plainTextForBriefRegionSection(sec));
                });
            }
        );
    }

    function addFooter(root) {
        var foot = root && root.querySelector('.dc-bai-foot');
        if (!foot) {
            return;
        }
        foot.setAttribute('data-bai-all-copy', '1');
        foot.innerHTML = '';
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.setAttribute('title', 'Copy entire brief');
        copy.setAttribute('data-bai-all-copy', '1');
        copy.textContent = 'Copy all';
        copy.addEventListener('click', function () {
            var body = root.querySelector('.dc-bai-body');
            if (!body) {
                return;
            }
            var t = briefPlainTextFromBulkBody(body);
            if (!t) {
                t = (body.innerText && body.innerText.length
                    ? body.innerText
                    : body.textContent) || '';
                t = t.replace(/Copy\s*$/gmi, '');
            }
            copyTextToClipboard(t);
        });
        var cl = document.createElement('button');
        cl.type = 'button';
        cl.textContent = 'Close';
        cl.addEventListener('click', closeModal);
        foot.appendChild(copy);
        foot.appendChild(cl);
    }

    function openComposeModal() {
        if (modalOpen) {
            return;
        }
        ensureStyle();
        try {
            closeModal();
        } catch (e0) {}
        modalOpen = true;
        var defSt = trim(getPref('briefAiExtraStations', ''));
        var root = document.createElement('div');
        root.setAttribute(MODAL_ATTR, '1');
        root.addEventListener('click', function (e) {
            if (e.target === root) {
                closeModal();
            }
        });
        root.innerHTML =
            '<div class="dc-bai-panel" data-stop-close="1">' +
            '<div class="dc-bai-head"><span>Brief AI</span><button type="button" data-bai-x style="background:transparent;border:0;color:#94a3b8;font:700 20px/1 system-ui;cursor:pointer" aria-label="Close">&times;</button></div>' +
            '<div class="dc-bai-body dc-bai-compose">' +
            '<div class="dc-bai-field">' +
            '<label for="dc-bai-watch-stations">Stations to watch (optional)</label>' +
            '<p class="dc-bai-hint">Space- or comma-separated 3-letter codes. Empty = WN default regional lists. Only codes you list may be named in the brief.</p>' +
            '<textarea id="dc-bai-watch-stations" data-dc-bai-stations="1" rows="2" placeholder="e.g. MCO HOU SJC">' +
            (defSt
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')) +
            '</textarea></div>' +
            '<div class="dc-bai-field">' +
            '<label for="dc-bai-user-focus">Focus (optional)</label>' +
            '<p class="dc-bai-hint">Anything the brief should lean toward (e.g. connections, ETOPS, snow risk).</p>' +
            '<textarea id="dc-bai-user-focus" data-dc-bai-focus="1" rows="3" placeholder=""></textarea></div></div>' +
            '<div class="dc-bai-foot">' +
            '<button type="button" data-bai-run style="background:#1a5270;border-color:#334155;color:#e2e8f0">Run brief</button>' +
            '<button type="button" data-bai-cancel>Cancel</button></div></div>';
        var panel = root.querySelector('.dc-bai-panel');
        if (panel) {
            panel.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        }
        var xbtn = root.querySelector('[data-bai-x]');
        if (xbtn) {
            xbtn.addEventListener('click', function () {
                closeModal();
            });
        }
        var cancel = root.querySelector('[data-bai-cancel]');
        if (cancel) {
            cancel.addEventListener('click', function () {
                closeModal();
            });
        }
        var runB = root.querySelector('[data-bai-run]');
        if (runB) {
            var runFromForm = function () {
                var ta1 = root.querySelector('[data-dc-bai-stations="1"]');
                var ta2 = root.querySelector('[data-dc-bai-focus="1"]');
                var stations = ta1
                    ? trim(
                        (ta1.value == null
                            ? ''
                            : String(ta1.value)
                        )
                    )
                    : '';
                var focus = ta2
                    ? trim(
                        (ta2.value == null
                            ? ''
                            : String(ta2.value)
                        )
                    )
                    : '';
                var root2;
                try {
                    closeModal();
                    root2 = openModalLoading();
                } catch (e1) {
                    try {
                        window.alert('Brief AI: ' + (e1 && e1.message ? e1.message : e1));
                    } catch (e2) {}
                    return;
                }
                runBrief(stations, focus).then(
                    function (text) {
                        var b = root2 && root2.querySelector('.dc-bai-body');
                        if (b) {
                            b.innerHTML = formatBriefBodyHtml(
                                trim(text) || 'Empty brief.'
                            );
                            wireRegionCopyButtons(b);
                        }
                        addFooter(root2);
                    },
                    function (err) {
                        fillModalError(
                            root2,
                            'Error: ' + (err && err.message ? err.message : String(err))
                        );
                    }
                );
            };
            bindWorksheetToolbarButtonActivate(runB, runFromForm);
        }
        try {
            document.body.appendChild(root);
        } catch (e3) {
            modalOpen = false;
            try {
                window.alert('Brief AI: could not open dialog.');
            } catch (e4) {}
        }
    }

    function bindWorksheetToolbarButtonActivate(el, run) {
        if (!el || el.getAttribute('data-dc-toolbar-activate') === '1') {
            return;
        }
        el.setAttribute('data-dc-toolbar-activate', '1');
        var suppressClick = false;
        var tClear = 0;
        el.addEventListener(
            'pointerup',
            function (ev) {
                if (!ev || ev.isTrusted === false) {
                    return;
                }
                if (ev.button != null && ev.button !== 0) {
                    return;
                }
                suppressClick = true;
                if (tClear) {
                    try {
                        clearTimeout(tClear);
                    } catch (e) {}
                }
                tClear = setTimeout(function () {
                    suppressClick = false;
                }, 800);
                try {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (ev.stopImmediatePropagation) {
                        ev.stopImmediatePropagation();
                    }
                } catch (e2) {}
                try {
                    run(ev);
                } catch (e3) {}
            },
            true
        );
        el.addEventListener(
            'click',
            function (ev) {
                if (!ev || ev.isTrusted === false) {
                    return;
                }
                if (ev.button != null && ev.button !== 0) {
                    return;
                }
                if (suppressClick) {
                    suppressClick = false;
                    try {
                        ev.preventDefault();
                        ev.stopPropagation();
                    } catch (e) {}
                    return;
                }
                try {
                    ev.preventDefault();
                    ev.stopPropagation();
                } catch (e2) {}
                try {
                    run(ev);
                } catch (e3) {}
            },
            true
        );
    }

    function makeButton() {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute(BTN_ATTR, '1');
        b.textContent = 'Brief AI';
        b.title = 'Regional weather brief (METAR + LLM: Groq/Gemini/Ollama in DonkeyCODE prefs)';
        bindWorksheetToolbarButtonActivate(b, openComposeModal);
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

    function orderWsbInHelper(helper) {
        if (!helper) {
            return;
        }
        var wxn = helper.querySelector('[data-dc-metar-watch-btn="1"]');
        var br = document.getElementById(HOST_ID);
        var st = document.getElementById(STATE_HOST_ID);
        var i;
        var list = [wxn, br, st];
        for (i = 0; i < list.length; i++) {
            var n = list[i];
            if (n && n.parentNode === helper) {
                try {
                    helper.appendChild(n);
                } catch (e) {}
            }
        }
    }

    function positionWorksheetHelperToRowEnd(fields, helper) {
        if (!fields || !helper) {
            return;
        }
        try {
            fields.appendChild(helper);
        } catch (e) {}
        try {
            helper.style.display = 'inline-flex';
            helper.style.alignItems = 'stretch';
            helper.style.gap = '4px';
            helper.style.marginLeft = '';
        } catch (e2) {}
    }

    function getOrCreateWorksheetHelperField() {
        var fields = findWorksheetFieldsRow();
        if (!fields) {
            return null;
        }
        var helper = fields.querySelector('[data-dc-worksheet-helper-buttons="1"]');
        if (helper) {
            positionWorksheetHelperToRowEnd(fields, helper);
            return helper;
        }
        helper = document.createElement('div');
        helper.className = 'field';
        helper.setAttribute('data-dc-worksheet-helper-buttons', '1');
        helper.style.display = 'inline-flex';
        helper.style.alignItems = 'stretch';
        helper.style.gap = '4px';
        fields.appendChild(helper);
        positionWorksheetHelperToRowEnd(fields, helper);
        return helper;
    }

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
        var si;
        var sj;
        for (si = 0; si < scopes.length; si++) {
            var candidates = scopes[si].querySelectorAll('span,div,button,p,time,li');
            for (sj = 0; sj < candidates.length; sj++) {
                var el = candidates[sj];
                var t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
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

    function elDesc(el) {
        if (!el) {
            return 'null';
        }
        var tag = (el.tagName || '?').toLowerCase();
        var id = (el.getAttribute('id') || el.id) ? ' id="' + (el.getAttribute('id') || el.id) + '"' : '';
        var cls = el.className && String(el.className) ? ' class="' + String(el.className).slice(0, 100) + '"' : '';
        var t = '';
        if (el.getAttribute && el.getAttribute('data-dc-metar-watch-btn')) {
            t += ' [data-dc-metar-watch-btn]';
        }
        if (el.getAttribute && el.getAttribute('data-dc-brief-ai-btn')) {
            t += ' [data-dc-brief-ai-btn]';
        }
        return '<' + tag + id + cls + '>' + t;
    }

    function ensureWorksheetToolbarClickDebug() {
        if (!isWorksheetPage() || onToolbarClickDebug) {
            return;
        }
        if (getPref('worksheetToolbarClickDebug', false) !== true) {
            return;
        }
        onToolbarClickDebug = function (ev) {
            if (!ev) {
                return;
            }
            if (ev.type !== 'pointerdown' && ev.type !== 'click') {
                return;
            }
            if (ev.button != null && ev.button !== 0) {
                return;
            }
            if (!ev.isTrusted) {
                return;
            }
            var t = ev.target;
            if (t && t.nodeType !== 1) {
                t = t.parentElement;
            }
            var hlp = t && t.closest
                ? t.closest('[data-dc-worksheet-helper-buttons="1"]')
                : null;
            if (!hlp) {
                return;
            }
            var pick = t;
            try {
                if (ev.clientX != null && ev.clientY != null) {
                    pick = document.elementFromPoint(ev.clientX, ev.clientY) || t;
                }
            } catch (e) {}
            var pickPath = [pick, t];
            if (hlp) {
                pickPath.push(hlp);
            }
            if (hlp) {
                pickPath.push(
                    hlp.querySelector('[data-dc-metar-watch-btn="1"]') || null
                );
                pickPath.push(document.getElementById(HOST_ID) || null);
                pickPath.push(document.getElementById(STATE_HOST_ID) || null);
            }
            var lines = [
                '[Wolf2.0][Brief AI] toolbar ' + ev.type,
                '  target: ' + elDesc(t),
                '  elementFromPoint: ' + elDesc(pick)
            ];
            var p;
            for (p = 0; p < pickPath.length; p++) {
                if (pickPath[p]) {
                    var x = pickPath[p];
                    try {
                        lines.push(
                            '  layer ' +
                            p +
                            ' z=' +
                            (x.style && x.style.zIndex) +
                            ' pe=' +
                            (x.style && x.style.pointerEvents) +
                            ' ' +
                            elDesc(x)
                        );
                    } catch (e) {}
                }
            }
            try {
                console.log(lines.join('\n'));
            } catch (e) {}
        };
        document.addEventListener('click', onToolbarClickDebug, true);
        try {
            document.addEventListener('pointerdown', onToolbarClickDebug, true);
        } catch (e) {
            document.addEventListener('mousedown', onToolbarClickDebug, true);
        }
    }

    function removeEmptyWorksheetHelperField() {
        var helper = document.querySelector(
            '[data-dc-worksheet-helper-buttons="1"]'
        );
        if (
            helper &&
            !helper.querySelector(
                'button, #dc-ws-state-reload-host, #dc-brief-ai-ws-host, [data-dc-metar-watch-btn="1"]'
            )
        ) {
            try {
                helper.remove();
            } catch (e) {}
        }
    }

    function mount() {
        if (!isWorksheetPage() || !document.body) {
            return;
        }
        ensureStyle();
        ensureWorksheetToolbarClickDebug();
        var host = document.getElementById(HOST_ID);
        if (!host) {
            host = document.createElement('span');
            host.id = HOST_ID;
            host.appendChild(makeButton());
        }
        var helper = getOrCreateWorksheetHelperField();
        var anchor = helper ? null : findGmtClockElement();
        if (helper) {
            host.style.position = '';
            host.style.right = '';
            host.style.top = '';
            host.style.zIndex = '';
            if (host.parentNode !== helper) {
                try {
                    helper.appendChild(host);
                } catch (e) {}
            }
            orderWsbInHelper(helper);
            host.querySelectorAll('[' + BTN_ATTR + ']').forEach(function (b) {
                b.style.minHeight = '36px';
                b.style.height = 'auto';
                b.style.alignSelf = 'stretch';
            });
        } else if (anchor && anchor.parentNode) {
            var parent = anchor.parentNode;
            host.style.position = '';
            host.style.right = '';
            host.style.top = '';
            host.style.zIndex = '';
            if (host.parentNode !== parent) {
                try {
                    parent.appendChild(host);
                } catch (e0) {
                    try {
                        parent.insertBefore(host, anchor.nextSibling);
                    } catch (e1) {}
                }
            } else {
                try {
                    parent.appendChild(host);
                } catch (e2) {}
            }
        } else if (host.parentNode !== document.body) {
            try {
                host.style.position = 'fixed';
                host.style.right = '12px';
                host.style.top = '12px';
                host.style.zIndex = '99999';
                document.body.appendChild(host);
            } catch (e3) {}
        }
        var flo = document.getElementById('dc-worksheet-scripts-float-host');
        if (flo) {
            try {
                flo.remove();
            } catch (e4) {}
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
                if (isWorksheetPage()) {
                    schedule();
                }
            });
        } else {
            setTimeout(function () {
                if (isWorksheetPage()) {
                    schedule();
                }
            }, 0);
        }
        setTimeout(function () {
            if (isWorksheetPage()) {
                schedule();
            }
        }, 400);
        setTimeout(function () {
            if (isWorksheetPage()) {
                schedule();
            }
        }, 2000);
        setTimeout(function () {
            if (isWorksheetPage()) {
                mount();
            }
        }, 5000);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                setTimeout(function () {
                    if (isWorksheetPage()) {
                        schedule();
                    }
                }, 0);
            });
        }
        try {
            window.addEventListener('load', function () {
                if (isWorksheetPage()) {
                    schedule();
                }
            });
        } catch (e) {}
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

    var dcBriefAiCoreCleanup = function () {
        if (onToolbarClickDebug) {
            try {
                document.removeEventListener('click', onToolbarClickDebug, true);
            } catch (e) {}
            try {
                document.removeEventListener('pointerdown', onToolbarClickDebug, true);
            } catch (e1) {}
            try {
                document.removeEventListener('mousedown', onToolbarClickDebug, true);
            } catch (e2) {}
            onToolbarClickDebug = null;
        }
        if (mountInterval) {
            try {
                clearInterval(mountInterval);
            } catch (e3) {}
            mountInterval = null;
        }
        if (mountRaf) {
            try {
                cancelAnimationFrame(mountRaf);
            } catch (e4) {}
            mountRaf = 0;
        }
        if (mountObserver) {
            try {
                mountObserver.disconnect();
            } catch (e5) {}
            mountObserver = null;
        }
        var h = document.getElementById(HOST_ID);
        if (h && h.parentNode) {
            try {
                h.parentNode.removeChild(h);
            } catch (e6) {}
        }
        var st = document.getElementById(STYLE_ID);
        if (st) {
            try {
                st.remove();
            } catch (e7) {}
        }
        try {
            removeEmptyWorksheetHelperField();
        } catch (e8) {}
        var flo2 = document.getElementById('dc-worksheet-scripts-float-host');
        if (flo2) {
            try {
                flo2.remove();
            } catch (e9) {}
        }
        closeModal();
    };
    window.dcBriefAiScriptCleanup = dcBriefAiCoreCleanup;
    window.__myScriptCleanup = function () {
        try {
            dcBriefAiCoreCleanup();
        } catch (e) {}
    };
})();
