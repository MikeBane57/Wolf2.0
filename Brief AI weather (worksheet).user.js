// ==UserScript==
// @name         Brief AI weather (worksheet)
// @namespace    Wolf 2.0
// @version      0.1.5
// @description  Worksheet: regional weather brief (METAR-based) — optional LLM (Groq, Gemini, Ollama, etc.); button by WX/WS state.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      aviationweather.gov
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      openrouter.ai
// @connect      localhost
// @connect      127.0.0.1
// @donkeycode-pref {"briefAiProvider":{"type":"select","group":"Brief AI","label":"LLM provider","description":"GitHub Copilot has no public HTTP API for this use. Groq: free key at https://console.groq.com — set Base URL to https://api.groq.com/openai/v1. Ollama: free local (open-source models), set URL to http://127.0.0.1:11434/v1. OpenRouter: https://openrouter.ai","default":"openai_compat","options":[{"val":"openai_compat","label":"OpenAI-compatible (Groq, OpenRouter, many others)"},{"val":"gemini","label":"Google Gemini (AI Studio key)"},{"val":"ollama","label":"Ollama local (http://127.0.0.1:11434/v1)"}]},"briefAiOpenaiBaseUrl":{"type":"string","group":"Brief AI","label":"OpenAI-compat: Base URL","default":"https://api.groq.com/openai/v1","placeholder":"https://api.groq.com/openai/v1"},"briefAiOpenaiKey":{"type":"string","group":"Brief AI","label":"OpenAI-compat: API key","default":"","password":true,"description":"e.g. Groq gs_... or OpenRouter sk-..."},"briefAiOpenaiModel":{"type":"string","group":"Brief AI","label":"OpenAI-compat: model id","default":"llama-3.3-70b-versatile","placeholder":"llama-3.3-70b-versatile"},"briefAiOllamaUrl":{"type":"string","group":"Brief AI","label":"Ollama: base URL (OpenAI path)","default":"http://127.0.0.1:11434/v1","placeholder":"http://127.0.0.1:11434/v1"},"briefAiOllamaModel":{"type":"string","group":"Brief AI","label":"Ollama: model name","default":"llama3.2","placeholder":"llama3.2"},"briefAiGeminiKey":{"type":"string","group":"Brief AI","label":"Gemini: API key","description":"https://aistudio.google.com/apikey","default":"","password":true},"briefAiGeminiModel":{"type":"string","group":"Brief AI","label":"Gemini: model","default":"gemini-2.0-flash","placeholder":"gemini-2.0-flash"},"briefAiExtraStations":{"type":"string","group":"Brief AI","label":"Extra stations of concern","description":"Space- or comma-separated IATA; merged into fetch.","default":"","placeholder":"e.g. OAK ABQ"},"briefAiTemperature":{"type":"number","group":"Brief AI","label":"LLM temperature","description":"Higher = more conversational (0.15–0.8).","default":0.45,"min":0.1,"max":0.95,"step":0.05}}
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

    function llmTemperature() {
        var n = Number(getPref('briefAiTemperature', 0.45));
        if (!Number.isFinite(n)) {
            return 0.45;
        }
        return Math.min(0.95, Math.max(0.1, n));
    }

    function buildBriefPrompts(dataJson) {
        var sys = [
            'You are a Southwest Airlines line operations briefer speaking to a dispatcher or duty manager.',
            'Be conversational and readable: a short lead-in, then by region, like you are giving a quick verbal brief (not a bullet list of raw stats unless helpful).',
            'Cover these regions in order with short section labels on their own line: East, Central, West, and Intl-ETOPS (Hawaii, Alaska, Mexico/Caribbean, and other intl in the data).',
            'Each region: 2-4 short sentences, or if nothing of note, one line like: "East: Nothing jumping out in the current snapshot."',
            'Tie any concern to the JSON: flight categories, wind, convective or wintry flags implied there. If the JSON is thin for a region, say so in plain language.',
            'No markdown headings (no #). No numbered lists unless natural. No claims of authority or TFR-level detail. Plain text only.',
            'The JSON is your only source of "current conditions" — do not invent specific hazards at airports not implied by the data.',
            'Here is the structured summary JSON:',
            dataJson
        ].join('\n\n');
        return { system: sys, user: 'Give the brief now.' };
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
            var pr = buildBriefPrompts(dataJson);
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
        b.title = 'Regional weather brief (METAR + LLM: Groq/Gemini/Ollama in DonkeyCODE prefs)';
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
            helper.style.marginLeft = 'auto';
            helper.style.flexShrink = '0';
        } catch (e2) {}
        try {
            if (
                window.getComputedStyle(fields).display !== 'flex' &&
                window.getComputedStyle(fields).display !== 'inline-flex'
            ) {
                fields.style.display = 'flex';
                fields.style.flexWrap = 'wrap';
                fields.style.alignItems = 'center';
            }
        } catch (e3) {}
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

    function sizeHostToRow(host, refEl) {
        if (!host || !refEl) {
            return;
        }
        try {
            var row = refEl.parentElement;
            if (row) {
                var cs = window.getComputedStyle(row);
                if (cs && cs.display !== 'flex' && cs.display !== 'inline-flex') {
                    row.style.display = 'flex';
                    row.style.alignItems = 'stretch';
                }
            }
            var rowH = Math.max(
                (row && (row.offsetHeight || row.clientHeight)) || 0,
                refEl.offsetHeight || 0,
                refEl.clientHeight || 0
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
        } catch (e) {}
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
        if (host.parentNode) {
            try {
                host.parentNode.removeChild(host);
            } catch (e) {}
        }

        var helper = getOrCreateWorksheetHelperField();
        if (helper) {
            host.style.cssText = '';
            var sh1 = document.getElementById(STATE_HOST_ID);
            try {
                if (sh1 && sh1.parentNode === helper) {
                    helper.insertBefore(host, sh1);
                } else {
                    helper.appendChild(host);
                }
            } catch (e2) {
                try {
                    helper.appendChild(host);
                } catch (e3) {}
            }
            orderWsbInHelper(helper);
            host.querySelectorAll('[' + BTN_ATTR + ']').forEach(function (b) {
                b.style.minHeight = '36px';
                b.style.height = 'auto';
                b.style.alignSelf = 'stretch';
            });
            return;
        }

        var stateHost = document.getElementById(STATE_HOST_ID);
        if (stateHost && stateHost.parentNode) {
            var par0 = stateHost.parentNode;
            try {
                par0.insertBefore(host, stateHost);
            } catch (e4) {
                try {
                    par0.appendChild(host);
                } catch (e5) {}
            }
            sizeHostToRow(host, stateHost);
            return;
        }

        var wx = document.querySelector(WX_SEL);
        var anchor = wx || findGmtClockElement();
        if (anchor && anchor.parentNode) {
            var par = anchor.parentNode;
            try {
                var sh2 = document.getElementById(STATE_HOST_ID);
                if (sh2 && sh2.parentNode === par) {
                    par.insertBefore(host, sh2);
                } else {
                    par.insertBefore(host, anchor.nextSibling);
                }
            } catch (e6) {
                try {
                    par.appendChild(host);
                } catch (e7) {}
            }
            sizeHostToRow(host, anchor);
        } else {
            host.style.cssText =
                'position:fixed!important;right:12px!important;top:48px!important;z-index:2147483000!important;';
            try {
                document.body.appendChild(host);
            } catch (e8) {}
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

    window.__myScriptCleanup = function () {
        if (mountInterval) {
            try {
                clearInterval(mountInterval);
            } catch (e) {}
            mountInterval = null;
        }
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
