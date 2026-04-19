// ==UserScript==
// @name         METAR/TAF tracked stations (GMT button)
// @namespace    Wolf 2.0
// @version      1.7.0
// @description  Button near GMT clock: METAR/TAF, NWS radar loop + AFD when available, alerts on change, optional notifications
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      tgftp.nws.noaa.gov
// @connect      aviationweather.gov
// @connect      api.weather.gov
// @connect      radar.weather.gov
// @donkeycode-pref {"metarWatchPollMinutes":{"type":"number","group":"METAR watch","label":"Poll every (minutes)","description":"How often to refresh METAR/TAF in the background.","default":5,"min":1,"max":120,"step":1},"metarWatchConcurrentStations":{"type":"number","group":"METAR watch","label":"Parallel station fetches","description":"How many airports to load at the same time (higher = faster refresh, more concurrent requests).","default":6,"min":1,"max":20,"step":1},"metarWatchNotify":{"type":"boolean","group":"METAR watch","label":"Browser notifications","description":"Notify when METAR/TAF changes for a tracked station since you last opened the modal.","default":true},"metarWatchDefaultStations":{"type":"string","group":"METAR watch","label":"Default stations (IATA)","description":"Comma-separated list used until you customize the list (same region as SW tooltip defaults).","default":"ATL,MDW,BWI,OAK,TPA,MCO,DAL,MKE,LAS,PHX,DEN,LAX,SAN,FLL,HOU"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/METAR-TAF%20tracked%20stations%20(GMT%20button).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/METAR-TAF%20tracked%20stations%20(GMT%20button).user.js
// ==/UserScript==

(function () {
    'use strict';

    var STORAGE_STATIONS = 'dc-metar-watch-stations-v1';
    var STORAGE_VIEWED = 'dc-metar-watch-viewed-snapshot-v1';
    var STORAGE_SORT = 'dc-metar-watch-sort-v1';

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

    function numPref(key, def, min, max) {
        var n = Number(getPref(key, def));
        if (!Number.isFinite(n)) {
            return def;
        }
        return Math.min(max, Math.max(min, n));
    }

    function boolPref(key, def) {
        var v = getPref(key, def);
        if (v === true || v === false) {
            return v;
        }
        if (v === 'true' || v === '1') {
            return true;
        }
        if (v === 'false' || v === '0') {
            return false;
        }
        return def;
    }

    function pollMs() {
        return numPref('metarWatchPollMinutes', 5, 1, 120) * 60 * 1000;
    }

    /** Same mapping as SW Airport METAR/TAF Tooltip (subset used for lookups). */
    var IATA_TO_ICAO = {
        ABQ: 'KABQ', ALB: 'KALB', ATL: 'KATL', AUS: 'KAUS', BDL: 'KBDL', BHM: 'KBHM', BNA: 'KBNA',
        BOS: 'KBOS', BOI: 'KBOI', BUF: 'KBUF', BUR: 'KBUR', BWI: 'KBWI', CUN: 'MMUN', CHS: 'KCHS',
        CMH: 'KCMH', COS: 'KCOS', CRP: 'KCRP', CVG: 'KCVG', DAL: 'KDAL', DCA: 'KDCA', DEN: 'KDEN',
        DTW: 'KDTW', ECP: 'KECP', ELP: 'KELP', FAT: 'KFAT', FLL: 'KFLL', GCM: 'MWCR', GEG: 'KGEG',
        GRR: 'KGRR', GSP: 'KGSP', HOU: 'KHOU', HNL: 'PHNL', IAD: 'KIAD', MTJ: 'KMTJ', BZN: 'KBZN',
        IND: 'KIND', ISP: 'KISP', JAN: 'KJAN', JAX: 'KJAX', KOA: 'PHKO', LAS: 'KLAS', HDN: 'KHDN',
        LAX: 'KLAX', LGB: 'KLGB', LIH: 'PHLI', LIR: 'MRLB', MAF: 'KMAF', MBJ: 'MKJP', MCO: 'KMCO',
        MDW: 'KMDW', MEM: 'KMEM', MHT: 'KMHT', MIA: 'KMIA', MSP: 'KMSP', MSY: 'KMSY', OAK: 'KOAK',
        OKC: 'KOKC', OMA: 'KOMA', ONT: 'KONT', ORF: 'KORF', OGG: 'PHOG', PDX: 'KPDX', PHL: 'KPHL',
        PHX: 'KPHX', PIT: 'KPIT', PNS: 'KPNS', PVR: 'MMPR', RDU: 'KRDU', RNO: 'KRNO', RSW: 'KRSW',
        SAN: 'KSAN', SAT: 'KSAT', SBA: 'KSBA', SEA: 'KSEA', SFO: 'KSFO', SJC: 'KSJC', SMF: 'KSMF',
        SNA: 'KSNA', TPA: 'KTPA', TUL: 'KTUL', TUS: 'KTUS', VPS: 'KVPS', AUA: 'TNCA', SLC: 'KSLC',
        NAS: 'MYNN', BZE: 'MZBZ', SJD: 'MMSD', PUJ: 'MDPC', SJO: 'MROC', SJU: 'TJSJ', STT: 'TIST',
        EUG: 'KEUG', PSP: 'KPSP', AMA: 'KAMA', LBB: 'KLBB', ICT: 'KICT', MCI: 'KMCI', STL: 'KSTL',
        DSM: 'KDSM', ORD: 'KORD', MKE: 'KMKE', CLE: 'KCLE', ROC: 'KROC', PWM: 'KPWM', PVD: 'KPVD',
        LGA: 'KLGA', RIC: 'KRIC', CLT: 'KCLT', SAV: 'KSAV', MYR: 'KMYR', SRQ: 'KSRQ', PBI: 'KPBI',
        HAV: 'MUHA', PLS: 'MBPV', ITO: 'PHTO', ANC: 'PANC', LIT: 'KLIT', SDF: 'KSDF', TYS: 'KTYS'
    };

    function parseDefaultStations() {
        var raw = String(getPref('metarWatchDefaultStations', 'ATL,MDW,BWI,OAK,TPA,MCO,DAL,MKE,LAS,PHX,DEN,LAX,SAN,FLL,HOU') || '');
        return raw.split(/[,;\s]+/).map(function (s) {
            return s.trim().toUpperCase();
        }).filter(function (s) {
            return /^[A-Z]{3}$/.test(s);
        });
    }

    function loadStationList() {
        try {
            var parsed = JSON.parse(localStorage.getItem(STORAGE_STATIONS) || 'null');
            if (Array.isArray(parsed) && parsed.length) {
                return parsed.map(function (s) {
                    return String(s).toUpperCase();
                }).filter(function (s) {
                    return /^[A-Z]{3}$/.test(s);
                });
            }
        } catch (e) {}
        return parseDefaultStations();
    }

    function saveStationList(arr) {
        localStorage.setItem(STORAGE_STATIONS, JSON.stringify(arr));
    }

    function loadViewedSnapshot() {
        try {
            var o = JSON.parse(localStorage.getItem(STORAGE_VIEWED) || '{}');
            return o && typeof o === 'object' ? o : {};
        } catch (e) {
            return {};
        }
    }

    function saveViewedSnapshot(obj) {
        localStorage.setItem(STORAGE_VIEWED, JSON.stringify(obj));
    }

    function loadSortMode() {
        try {
            var v = localStorage.getItem(STORAGE_SORT);
            if (v === 'icao_az' || v === 'list' || v === 'newest' || v === 'oldest') {
                return v;
            }
            if (v === 'change') {
                return 'newest';
            }
        } catch (e) {}
        return 'list';
    }

    function saveSortMode(mode) {
        try {
            localStorage.setItem(STORAGE_SORT, mode);
        } catch (e) {}
    }

    var stationList = loadStationList();
    var sortMode = loadSortMode();
    /**
     * IATA → epoch ms when we first detected unseen METAR/TAF change vs last viewed snapshot.
     * Cleared when user views the row or marks modal viewed.
     */
    var pendingChangeTime = {};
    var viewedSnapshot = loadViewedSnapshot();

    var btn = null;
    var badge = null;
    var modal = null;
    var backdrop = null;
    var listEl = null;
    var detailEl = null;
    var addInput = null;
    var selectedIata = null;
    var anchorRetryTimer = null;
    var mountScheduled = false;
    var onDocKey = null;
    var refreshThisBtn = null;
    var refreshAllBtn = null;
    var statusBarEl = null;
    var sortSelect = null;
    var listColorTimer = null;
    var cacheByIcao = {};
    var pollTimer = null;
    var domObserver = null;
    var notifyShownForCurrent = {};
    /** After first successful fetch this session, baseline is set — then we alert only on later changes. */
    var alertsPrimed = false;

    function icaoFor(iata) {
        return IATA_TO_ICAO[iata.toUpperCase()] || null;
    }

    function iataFromIcao(icao) {
        if (!icao || icao.length !== 4) {
            return null;
        }
        var u = icao.toUpperCase();
        var k;
        for (k in IATA_TO_ICAO) {
            if (Object.prototype.hasOwnProperty.call(IATA_TO_ICAO, k) && IATA_TO_ICAO[k] === u) {
                return k;
            }
        }
        return null;
    }

    /** List label: prefer 4-letter ICAO. */
    function stationListLabel(iata) {
        return icaoFor(iata) || String(iata || '').toUpperCase();
    }

    function pendingChangeTs(iata) {
        var t = pendingChangeTime[iata];
        return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    }

    function displayStationOrder() {
        var base = stationList.slice();
        var indexOf = {};
        var ix;
        for (ix = 0; ix < base.length; ix++) {
            indexOf[base[ix]] = ix;
        }
        if (sortMode === 'icao_az') {
            base.sort(function (a, b) {
                var ia = icaoFor(a) || a;
                var ib = icaoFor(b) || b;
                return ia.localeCompare(ib);
            });
            return base;
        }
        if (sortMode === 'newest') {
            base.sort(function (a, b) {
                return pendingChangeTs(b) - pendingChangeTs(a);
            });
            return base;
        }
        if (sortMode === 'oldest') {
            base.sort(function (a, b) {
                var ta = pendingChangeTs(a);
                var tb = pendingChangeTs(b);
                if (ta === 0 && tb === 0) {
                    return indexOf[a] - indexOf[b];
                }
                if (ta === 0) {
                    return 1;
                }
                if (tb === 0) {
                    return -1;
                }
                return ta - tb;
            });
            return base;
        }
        return base;
    }

    /** Yellow: change within 5 min; red: older than 5 min (still unseen). */
    function pendingChangeAgeClass(iata) {
        var t = pendingChangeTime[iata];
        if (typeof t !== 'number' || !Number.isFinite(t)) {
            return null;
        }
        var age = Date.now() - t;
        if (age <= 5 * 60 * 1000) {
            return 'fresh';
        }
        return 'stale';
    }

    function normalizePendingChangeTimes() {
        var next = {};
        var i;
        for (i = 0; i < stationList.length; i++) {
            var code = stationList[i];
            if (pendingChangeTime[code]) {
                next[code] = pendingChangeTime[code];
            }
        }
        pendingChangeTime = next;
    }

    function startListColorTimer() {
        if (listColorTimer) {
            clearInterval(listColorTimer);
        }
        listColorTimer = setInterval(function () {
            if (modal && modal.style.display === 'flex') {
                renderStationList();
            }
        }, 15000);
    }

    function stopListColorTimer() {
        if (listColorTimer) {
            clearInterval(listColorTimer);
            listColorTimer = null;
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function cacheBustUrl(url) {
        if (!url) {
            return '';
        }
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dc_cb=' + Date.now();
    }

    function afdMetaLine(meta) {
        if (!meta || !meta.cwa) {
            return '';
        }
        var parts = ['WFO ' + String(meta.cwa).toUpperCase()];
        if (meta.issuanceTime) {
            parts.push(meta.issuanceTime);
        }
        return parts.join(' · ');
    }

    function xhrResponseText(resp) {
        if (!resp) {
            return '';
        }
        var t = resp.responseText;
        if (typeof t === 'string' && t.length) {
            return t;
        }
        t = resp.response;
        if (typeof t === 'string' && t.length) {
            return t;
        }
        if (t && typeof ArrayBuffer !== 'undefined' && t instanceof ArrayBuffer && typeof TextDecoder !== 'undefined') {
            try {
                return new TextDecoder('utf-8').decode(t);
            } catch (e) {}
        }
        return '';
    }

    function xhrStatusOk(resp) {
        if (!resp || resp.status === undefined || resp.status === null) {
            return true;
        }
        var s = Number(resp.status);
        if (!Number.isFinite(s)) {
            return true;
        }
        return (s >= 200 && s < 300) || s === 304;
    }

    function fetchTextViaPageFetch(url, cb) {
        if (typeof fetch !== 'function') {
            cb('');
            return;
        }
        fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' })
            .then(function (res) {
                return res.text();
            })
            .then(function (t) {
                cb(typeof t === 'string' ? t : '');
            })
            .catch(function () {
                cb('');
            });
    }

    function nwsApiUserAgent() {
        return 'Wolf2.0-METAR-watch/1.0 (https://github.com/MikeBane57/Wolf2.0)';
    }

    function fetchText(url, cb, opts) {
        var headers = opts && opts.headers ? opts.headers : null;
        function finish(txt) {
            cb(typeof txt === 'string' ? txt : '');
        }
        function fallback() {
            if (typeof fetch !== 'function') {
                finish('');
                return;
            }
            var init = { credentials: 'omit', cache: 'no-store', mode: 'cors' };
            if (headers) {
                init.headers = headers;
            }
            fetch(url, init)
                .then(function (res) {
                    return res.text();
                })
                .then(function (t) {
                    finish(typeof t === 'string' ? t : '');
                })
                .catch(function () {
                    finish('');
                });
        }
        if (typeof GM_xmlhttpRequest === 'function') {
            var details = {
                method: 'GET',
                url: url,
                onload: function (resp) {
                    var txt = xhrResponseText(resp);
                    if (txt && xhrStatusOk(resp)) {
                        finish(txt);
                        return;
                    }
                    fallback();
                },
                onerror: fallback,
                ontimeout: fallback
            };
            if (headers) {
                details.headers = headers;
            }
            GM_xmlhttpRequest(details);
            return;
        }
        fallback();
    }

    function fetchJson(url, cb) {
        var hdr = {
            Accept: 'application/geo+json, application/json',
            'User-Agent': nwsApiUserAgent()
        };
        fetchText(
            url,
            function (txt) {
                if (!txt) {
                    cb(null);
                    return;
                }
                try {
                    cb(JSON.parse(txt));
                } catch (e) {
                    cb(null);
                }
            },
            { headers: hdr }
        );
    }

    /**
     * Nearest NWS radar loop GIF + Area Forecast Discussion for the WFO (cwa) covering this station.
     */
    var nwsEnrichCache = {};

    function fetchNwsEnrichmentCached(icao, bustCache, cb) {
        if (typeof bustCache === 'function') {
            cb = bustCache;
            bustCache = false;
        }
        if (!icao || icao.length !== 4) {
            cb(null);
            return;
        }
        if (bustCache) {
            delete nwsEnrichCache[icao];
        }
        var now = Date.now();
        var ttlMs = 20 * 60 * 1000;
        var ent = nwsEnrichCache[icao];
        if (ent && now - ent.t < ttlMs) {
            cb(ent.data);
            return;
        }
        fetchNwsEnrichment(icao, function (data) {
            nwsEnrichCache[icao] = { t: now, data: data };
            cb(data);
        });
    }

    function fetchNwsEnrichment(icao, cb) {
        if (!icao || icao.length !== 4) {
            cb(null);
            return;
        }
        fetchJson('https://api.weather.gov/stations/' + encodeURIComponent(icao), function (st) {
            if (!st || !st.geometry || !st.geometry.coordinates) {
                cb(null);
                return;
            }
            var coords = st.geometry.coordinates;
            var lon = coords[0];
            var lat = coords[1];
            if (typeof lat !== 'number' || typeof lon !== 'number') {
                cb(null);
                return;
            }
            fetchJson(
                'https://api.weather.gov/points/' + encodeURIComponent(lat) + ',' + encodeURIComponent(lon),
                function (pt) {
                    if (!pt || !pt.properties) {
                        cb(null);
                        return;
                    }
                    var p = pt.properties;
                    var cwa = p.cwa || '';
                    var radar = p.radarStation || '';
                    var radarGifUrl = '';
                    if (radar && /^K[A-Z0-9]{3}$/i.test(radar)) {
                        radarGifUrl =
                            'https://radar.weather.gov/ridge/standard/' +
                            radar.toUpperCase() +
                            '_loop.gif';
                    }
                    if (!cwa) {
                        cb({ radarGifUrl: radarGifUrl, afdText: '', afdMeta: null });
                        return;
                    }
                    fetchJson(
                        'https://api.weather.gov/products/types/AFD/locations/' + encodeURIComponent(cwa),
                        function (list) {
                            var graph = (list && (list['@graph'] || list.graph)) || [];
                            var first = graph[0];
                            if (!first || !first.id) {
                                cb({ radarGifUrl: radarGifUrl, afdText: '', afdMeta: { cwa: cwa } });
                                return;
                            }
                            var productUrl = first.id.indexOf('http') === 0 ? first.id : 'https://api.weather.gov' + first.id;
                            fetchJson(productUrl, function (prod) {
                                var text = (prod && prod.productText) || '';
                                var meta = {
                                    cwa: cwa,
                                    issuanceTime: prod && prod.issuanceTime ? prod.issuanceTime : '',
                                    issuingOffice: prod && prod.issuingOffice ? prod.issuingOffice : ''
                                };
                                cb({
                                    radarGifUrl: radarGifUrl,
                                    afdText: text,
                                    afdMeta: meta
                                });
                            });
                        }
                    );
                }
            );
        });
    }

    function parseMetarBody(txt) {
        try {
            var lines = String(txt || '').split(/\r?\n/).filter(function (ln) {
                return ln.trim().length;
            });
            if (!lines.length) {
                return 'N/A';
            }
            var joined = lines.length > 1 ? lines.slice(1).join(' ').trim() : lines[0].trim();
            return joined || 'N/A';
        } catch (e) {
            return 'N/A';
        }
    }

    function parseTafBody(txt) {
        try {
            var lines = String(txt || '').split(/\r?\n/).filter(function (ln) {
                return ln.trim().length;
            });
            if (!lines.length) {
                return 'N/A';
            }
            var joined = lines.length > 1 ? lines.slice(1).join('\n').trim() : lines.join('\n').trim();
            return joined || 'N/A';
        } catch (e) {
            return 'N/A';
        }
    }

    /** Up to `max` most recent METAR/SPECI lines from Aviation Weather raw API (newest first in response). */
    function parseLastMetarsRaw(txt, max) {
        var limit = max || 3;
        var lines = String(txt || '').split(/\r?\n/);
        var out = [];
        var i;
        for (i = 0; i < lines.length && out.length < limit; i++) {
            var line = lines[i].replace(/\s*\$\s*$/, '').trim();
            if (!line.length) {
                continue;
            }
            if (/^(METAR|SPECI)\s/i.test(line)) {
                out.push(line);
            }
        }
        return out;
    }

    function fetchWeatherForIata(iata, cb) {
        var icao = icaoFor(iata);
        if (!icao) {
            cb({
                iata: iata.toUpperCase(),
                icao: null,
                metar: 'No ICAO mapping',
                metarLines: [],
                taf: '',
                radarGifUrl: '',
                afdText: '',
                afdMeta: null,
                err: true
            });
            return;
        }
        var noaaMetarURL = 'https://tgftp.nws.noaa.gov/data/observations/metar/stations/' + icao + '.TXT';
        var tafURL = 'https://tgftp.nws.noaa.gov/data/forecasts/taf/stations/' + icao + '.TXT';
        var awMetarURL =
            'https://aviationweather.gov/api/data/metar?ids=' +
            encodeURIComponent(icao) +
            '&format=raw&hours=24';

        var tafDone = false;
        var awDone = false;
        var taf = 'N/A';
        var metarLines = [];
        var metar = 'N/A';

        function finalizeRecord() {
            fetchNwsEnrichmentCached(icao, false, function (enr) {
                var radarGifUrl = '';
                var afdText = '';
                var afdMeta = null;
                if (enr) {
                    radarGifUrl = enr.radarGifUrl || '';
                    afdText = enr.afdText || '';
                    afdMeta = enr.afdMeta || null;
                }
                var rec = {
                    iata: iata.toUpperCase(),
                    icao: icao,
                    metar: metar,
                    metarLines: metarLines.slice(),
                    taf: taf,
                    radarGifUrl: radarGifUrl,
                    afdText: afdText,
                    afdMeta: afdMeta,
                    err: false,
                    t: Date.now()
                };
                cacheByIcao[icao] = rec;
                cb(rec);
            });
        }

        function afterAwAndTaf() {
            if (!tafDone || !awDone) {
                return;
            }
            if (metarLines.length) {
                metar = metarLines[0];
                finalizeRecord();
                return;
            }
            fetchText(noaaMetarURL, function (mt) {
                metar = parseMetarBody(mt);
                metarLines = metar !== 'N/A' ? [metar] : [];
                finalizeRecord();
            });
        }

        fetchText(tafURL, function (tt) {
            taf = parseTafBody(tt);
            tafDone = true;
            afterAwAndTaf();
        });
        fetchText(awMetarURL, function (raw) {
            metarLines = parseLastMetarsRaw(raw, 3);
            if (metarLines.length) {
                metar = metarLines[0];
            }
            awDone = true;
            afterAwAndTaf();
        });
    }

    function fetchAllStations(list, done, onProgress) {
        if (!list || !list.length) {
            done([]);
            return;
        }
        var concurrency = numPref('metarWatchConcurrentStations', 6, 1, 20);
        var results = new Array(list.length);
        var next = 0;
        var active = 0;
        var completed = 0;
        var total = list.length;

        function finishOne(rec, index) {
            results[index] = rec;
            active--;
            completed++;
            if (typeof onProgress === 'function') {
                try {
                    onProgress(list[index], rec, completed, total);
                } catch (e) {}
            }
            if (completed === total) {
                done(results);
            } else {
                pump();
            }
        }

        function pump() {
            while (active < concurrency && next < total) {
                (function (index) {
                    active++;
                    var iata = list[index];
                    if (typeof onProgress === 'function') {
                        try {
                            onProgress(iata, null, completed, total);
                        } catch (e) {}
                    }
                    fetchWeatherForIata(iata, function (rec) {
                        finishOne(rec, index);
                    });
                })(next);
                next++;
            }
        }

        pump();
    }

    function snapshotFromResults(results) {
        var snap = {};
        var i;
        for (i = 0; i < results.length; i++) {
            var r = results[i];
            if (r.icao) {
                snap[r.icao] = { metar: r.metar, taf: r.taf };
            }
        }
        return snap;
    }

    function snapshotsDiffer(current, viewed) {
        var keys = Object.keys(current);
        var j;
        for (j = 0; j < keys.length; j++) {
            var icao = keys[j];
            var c = current[icao];
            var v = viewed[icao];
            if (!v) {
                return true;
            }
            if (c.metar !== v.metar || c.taf !== v.taf) {
                return true;
            }
        }
        return false;
    }

    function maybeNotify(staleIcaoSet) {
        if (!boolPref('metarWatchNotify', true)) {
            return;
        }
        if (!staleIcaoSet || !staleIcaoSet.length) {
            return;
        }
        if (!('Notification' in window)) {
            return;
        }
        if (Notification.permission === 'default') {
            return;
        }
        if (Notification.permission !== 'granted') {
            return;
        }
        var k;
        for (k = 0; k < staleIcaoSet.length; k++) {
            var icao = staleIcaoSet[k];
            if (notifyShownForCurrent[icao]) {
                continue;
            }
            notifyShownForCurrent[icao] = true;
            try {
                var title = 'METAR/TAF update';
                var body = icao + ': new weather text since you last checked.';
                new Notification(title, { body: body, tag: 'dc-metar-watch-' + icao });
            } catch (e) {}
        }
    }

    function updateAlertState() {
        if (!btn) {
            return;
        }
        if (!alertsPrimed) {
            btn.style.background = '#2c3e50';
            btn.style.color = '#ecf0f1';
            btn.removeAttribute('data-dc-metar-alert');
            badge.style.display = 'none';
            return;
        }
        var results = [];
        var i;
        for (i = 0; i < stationList.length; i++) {
            var icao = icaoFor(stationList[i]);
            if (icao && cacheByIcao[icao]) {
                results.push(cacheByIcao[icao]);
            }
        }
        var snap = snapshotFromResults(results);
        var stale = [];
        var keys = Object.keys(snap);
        var j;
        for (j = 0; j < keys.length; j++) {
            var ic = keys[j];
            var c = snap[ic];
            var v = viewedSnapshot[ic];
            if (!v || c.metar !== v.metar || c.taf !== v.taf) {
                stale.push(ic);
            }
        }
        if (stale.length) {
            btn.style.background = '#c0392b';
            btn.style.color = '#fff';
            btn.setAttribute('data-dc-metar-alert', '1');
            badge.style.display = 'inline-block';
            maybeNotify(stale);
        } else {
            btn.style.background = '#2c3e50';
            btn.style.color = '#ecf0f1';
            btn.removeAttribute('data-dc-metar-alert');
            badge.style.display = 'none';
        }
        if (alertsPrimed && (!modal || modal.style.display !== 'flex')) {
            var nowTs = Date.now();
            var si;
            for (si = 0; si < stale.length; si++) {
                var ic = stale[si];
                var idx;
                for (idx = 0; idx < stationList.length; idx++) {
                    if (icaoFor(stationList[idx]) === ic) {
                        var iataK = stationList[idx];
                        if (!pendingChangeTime[iataK]) {
                            pendingChangeTime[iataK] = nowTs;
                        }
                        break;
                    }
                }
            }
            var k;
            for (k in pendingChangeTime) {
                if (Object.prototype.hasOwnProperty.call(pendingChangeTime, k)) {
                    var still = false;
                    var sj;
                    for (sj = 0; sj < stale.length; sj++) {
                        if (icaoFor(k) === stale[sj]) {
                            still = true;
                            break;
                        }
                    }
                    if (!still) {
                        delete pendingChangeTime[k];
                    }
                }
            }
        }
    }

    function primeAlertsBaseline(results) {
        if (alertsPrimed) {
            return;
        }
        if (!stationList.length) {
            alertsPrimed = true;
            return;
        }
        var snap = snapshotFromResults(results);
        viewedSnapshot = snap;
        saveViewedSnapshot(viewedSnapshot);
        notifyShownForCurrent = {};
        alertsPrimed = true;
    }

    function setStatusBar(msg) {
        if (statusBarEl) {
            statusBarEl.textContent = msg || '';
        }
    }

    function updateRefreshThisLabel() {
        if (!refreshThisBtn) {
            return;
        }
        if (!selectedIata) {
            refreshThisBtn.textContent = 'Refresh';
            refreshThisBtn.disabled = true;
            return;
        }
        refreshThisBtn.disabled = false;
        refreshThisBtn.textContent = 'Refresh ' + stationListLabel(selectedIata);
    }

    function runPoll() {
        if (modal && modal.style.display === 'flex') {
            setStatusBar('Background refresh…');
        }
        fetchAllStations(
            stationList,
            function (results) {
                var i;
                for (i = 0; i < results.length; i++) {
                    var r = results[i];
                    if (r.icao) {
                        cacheByIcao[r.icao] = r;
                    }
                }
                primeAlertsBaseline(results);
                updateAlertState();
                if (modal && modal.style.display === 'flex' && selectedIata) {
                    renderDetail(selectedIata);
                    renderStationList();
                    setStatusBar('Background refresh done · ' + new Date().toLocaleTimeString());
                }
            },
            function (iata, rec, done, total) {
                if (modal && modal.style.display === 'flex') {
                    if (rec) {
                        setStatusBar('Background: ' + stationListLabel(iata) + ' · ' + done + '/' + total);
                    } else {
                        setStatusBar('Background: loading ' + stationListLabel(iata) + '…');
                    }
                }
            }
        );
    }

    function markViewedFromCache() {
        var snap = {};
        var i;
        for (i = 0; i < stationList.length; i++) {
            var icao = icaoFor(stationList[i]);
            if (icao && cacheByIcao[icao]) {
                var r = cacheByIcao[icao];
                snap[icao] = { metar: r.metar, taf: r.taf };
            }
        }
        viewedSnapshot = snap;
        saveViewedSnapshot(viewedSnapshot);
        notifyShownForCurrent = {};
        pendingChangeTime = {};
        updateAlertState();
    }

    function refreshCurrentStation() {
        if (!selectedIata) {
            return;
        }
        if (refreshThisBtn) {
            refreshThisBtn.disabled = true;
        }
        setStatusBar('Loading ' + stationListLabel(selectedIata) + '…');
        fetchNwsEnrichmentCached(icaoFor(selectedIata), true, function () {});
        fetchWeatherForIata(selectedIata, function () {
            if (refreshThisBtn) {
                refreshThisBtn.disabled = false;
            }
            setStatusBar(stationListLabel(selectedIata) + ' · updated ' + new Date().toLocaleTimeString());
            renderStationList();
            if (selectedIata) {
                renderDetail(selectedIata);
            }
            updateRefreshThisLabel();
            updateAlertState();
        });
    }

    function refreshAllStationsManual() {
        if (refreshAllBtn) {
            refreshAllBtn.disabled = true;
        }
        nwsEnrichCache = {};
        setStatusBar('Refreshing all stations…');
        fetchAllStations(
            stationList,
            function () {
                if (refreshAllBtn) {
                    refreshAllBtn.disabled = false;
                }
                setStatusBar('All stations updated · ' + new Date().toLocaleTimeString());
                renderStationList();
                if (selectedIata) {
                    renderDetail(selectedIata);
                }
                updateRefreshThisLabel();
                updateAlertState();
            },
            function (iata, rec, done, total) {
                if (rec) {
                    setStatusBar(stationListLabel(iata) + ' · ' + done + '/' + total);
                } else {
                    setStatusBar('Loading ' + stationListLabel(iata) + '…');
                }
            }
        );
    }

    function renderStationList() {
        listEl.innerHTML = '';
        var order = displayStationOrder();
        var i;
        for (i = 0; i < order.length; i++) {
            (function (iata) {
                var row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '4px';
                row.style.padding = '6px 6px';
                row.style.cursor = 'pointer';
                row.style.borderRadius = '4px';
                row.style.marginBottom = '4px';
                if (selectedIata === iata) {
                    row.style.background = 'rgba(52,152,219,0.25)';
                    row.style.border = '';
                } else {
                    var ageCls = pendingChangeAgeClass(iata);
                    if (ageCls === 'fresh') {
                        row.style.background = 'rgba(241,196,15,0.35)';
                        row.style.border = '1px solid rgba(241,196,15,0.55)';
                    } else if (ageCls === 'stale') {
                        row.style.background = 'rgba(192,57,43,0.4)';
                        row.style.border = '1px solid rgba(231,76,60,0.55)';
                    } else {
                        row.style.background = '';
                        row.style.border = '';
                    }
                }
                var label = document.createElement('span');
                label.textContent = stationListLabel(iata);
                label.style.fontFamily = 'system-ui, sans-serif';
                label.style.fontSize = '13px';
                label.style.flex = '1';
                label.style.minWidth = '0';
                label.style.overflow = 'hidden';
                label.style.textOverflow = 'ellipsis';
                label.style.whiteSpace = 'nowrap';
                var ageCls2 = pendingChangeAgeClass(iata);
                if (ageCls2 === 'fresh') {
                    label.style.color = '#2c2c2c';
                    label.style.fontWeight = '600';
                } else if (ageCls2 === 'stale') {
                    label.style.color = '#fadbd8';
                    label.style.fontWeight = '600';
                } else {
                    label.style.color = '';
                    label.style.fontWeight = '';
                }
                var x = document.createElement('button');
                x.type = 'button';
                x.textContent = '×';
                x.title = 'Remove ' + iata;
                x.style.border = 'none';
                x.style.background = 'transparent';
                x.style.color = '#e74c3c';
                x.style.fontSize = '18px';
                x.style.lineHeight = '1';
                x.style.cursor = 'pointer';
                x.style.padding = '0 2px';
                x.style.flexShrink = '0';
                x.style.marginLeft = '0';
                x.addEventListener('click', function (e) {
                    e.stopPropagation();
                    stationList = stationList.filter(function (s) {
                        return s !== iata;
                    });
                    delete pendingChangeTime[iata];
                    saveStationList(stationList);
                    if (selectedIata === iata) {
                        selectedIata = stationList[0] || null;
                    }
                    renderStationList();
                    runPoll();
                });
                row.addEventListener('click', function () {
                    selectedIata = iata;
                    delete pendingChangeTime[iata];
                    renderStationList();
                    renderDetail(iata);
                });
                row.appendChild(label);
                row.appendChild(x);
                listEl.appendChild(row);
            })(order[i]);
        }
        if (sortSelect && sortSelect.value !== sortMode) {
            sortSelect.value = sortMode;
        }
        updateRefreshThisLabel();
        var hasP = false;
        var pk;
        for (pk in pendingChangeTime) {
            if (Object.prototype.hasOwnProperty.call(pendingChangeTime, pk) && pendingChangeTime[pk]) {
                hasP = true;
                break;
            }
        }
        if (hasP && sortMode === 'newest' && listEl) {
            try {
                listEl.scrollTop = 0;
            } catch (e) {}
        }
    }

    function renderDetail(iata) {
        if (!iata) {
            detailEl.innerHTML = '<div style="color:#95a5a6;font-family:system-ui,sans-serif;">Select a station.</div>';
            return;
        }
        var r = cacheByIcao[icaoFor(iata)];
        if (!r) {
            detailEl.innerHTML = '<div style="color:#95a5a6;font-family:system-ui,sans-serif;">Loading…</div>';
            fetchWeatherForIata(iata, function () {
                if (selectedIata === iata) {
                    renderDetail(iata);
                }
            });
            return;
        }
        var metarDisplay = [];
        if (r.metarLines && r.metarLines.length) {
            var mi;
            for (mi = 0; mi < r.metarLines.length && mi < 3; mi++) {
                metarDisplay.push(r.metarLines[mi]);
            }
        } else if (r.metar && r.metar !== 'N/A') {
            metarDisplay.push(r.metar);
        }
        var mBlocks = '';
        if (metarDisplay.length) {
            var mj;
            for (mj = 0; mj < metarDisplay.length; mj++) {
                var isLast = mj === metarDisplay.length - 1;
                mBlocks +=
                    '<div style="margin-bottom:' +
                    (isLast ? '0' : '4px') +
                    ';white-space:pre-wrap;word-break:break-word;">' +
                    escapeHtml(metarDisplay[mj]).replace(/\n/g, '<br>') +
                    '</div>';
            }
        } else {
            mBlocks = '<div style="color:#95a5a6;">N/A</div>';
        }
        var t = escapeHtml(r.taf).replace(/\n/g, '<br>');
        var radarBlock = '';
        if (r.radarGifUrl) {
            radarBlock =
                '<div style="margin-bottom:16px;">' +
                '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">Radar <span style="font-weight:400;color:#95a5a6;font-size:11px;">(NWS site nearest the airport)</span></div>' +
                '<div style="max-width:100%;overflow:auto;background:#111;border-radius:6px;padding:8px;">' +
                '<img src="' +
                escapeHtml(cacheBustUrl(r.radarGifUrl)) +
                '" alt="Radar loop" style="max-width:100%;height:auto;display:block;" />' +
                '</div>' +
                '</div>';
        }
        var afdBlock = '';
        if (r.afdText && String(r.afdText).trim()) {
            var afdEsc = escapeHtml(r.afdText);
            var metaStr = afdMetaLine(r.afdMeta);
            afdBlock =
                '<div style="margin-bottom:16px;">' +
                '<div style="font-weight:600;margin-bottom:6px;color:#3498db;">Area Forecast Discussion</div>' +
                (metaStr
                    ? '<div style="font-size:11px;color:#95a5a6;margin-bottom:8px;font-family:system-ui,sans-serif;">' +
                      escapeHtml(metaStr) +
                      '</div>'
                    : '') +
                '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.4;color:#bdc3c7;white-space:pre-wrap;word-break:break-word;max-height:min(52vh,720px);overflow:auto;background:#141418;padding:10px;border-radius:6px;">' +
                afdEsc +
                '</div>' +
                '</div>';
        }
        detailEl.innerHTML =
            '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;color:#ecf0f1;min-height:120px;">' +
            '<div style="font-weight:600;margin-bottom:6px;color:#3498db;">METAR <span style="font-weight:400;color:#95a5a6;font-size:11px;">(last 3 when available)</span></div>' +
            '<div style="margin-bottom:12px;">' +
            mBlocks +
            '</div>' +
            '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">TAF</div>' +
            '<div style="white-space:pre-wrap;word-break:break-word;margin-bottom:16px;">' + t + '</div>' +
            radarBlock +
            afdBlock +
            '</div>';
    }

    function openModal() {
        modal.style.display = 'flex';
        backdrop.style.display = 'block';
        selectedIata = stationList[0] || null;
        normalizePendingChangeTimes();
        startListColorTimer();
        setStatusBar('Loading…');
        renderStationList();
        if (selectedIata) {
            renderDetail(selectedIata);
        }
        fetchAllStations(
            stationList,
            function () {
                renderStationList();
                if (selectedIata) {
                    renderDetail(selectedIata);
                }
                markViewedFromCache();
                setStatusBar('Ready · ' + new Date().toLocaleTimeString());
            },
            function (iata, rec, done, total) {
                if (rec) {
                    setStatusBar(stationListLabel(iata) + ' · ' + done + '/' + total);
                } else {
                    setStatusBar('Loading ' + stationListLabel(iata) + '…');
                }
            }
        );
    }

    function closeModal() {
        modal.style.display = 'none';
        backdrop.style.display = 'none';
        stopListColorTimer();
    }

    function findGmtClockElement() {
        var scopes = [];
        var h = document.querySelector('header');
        if (h) {
            scopes.push(h);
        }
        var tb = document.querySelector('[class*="toolbar"],[class*="Toolbar"],[class*="topbar"],[class*="TopBar"],[class*="app-bar"]');
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
                var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (t.length > 120) {
                    continue;
                }
                if (!/\d{1,2}:\d{2}/.test(t)) {
                    continue;
                }
                if (/GMT|Zulu|\bUTC\b|\(Z\)/i.test(t)) {
                    return el;
                }
            }
        }
        return null;
    }

    function scheduleMountButton() {
        if (mountScheduled) {
            return;
        }
        mountScheduled = true;
        requestAnimationFrame(function () {
            mountScheduled = false;
            mountButtonNearClock();
        });
    }

    function mountButtonNearClock() {
        var anchor = findGmtClockElement();
        var host = anchor && anchor.parentElement ? anchor.parentElement : document.body;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'WX';
            btn.title = 'Tracked METAR/TAF (click to view)';
            btn.style.marginLeft = '8px';
            btn.style.padding = '0 10px';
            btn.style.fontSize = '14px';
            btn.style.fontWeight = '600';
            btn.style.border = 'none';
            btn.style.borderRadius = '4px';
            btn.style.cursor = 'pointer';
            btn.style.verticalAlign = 'middle';
            btn.style.position = 'relative';
            btn.style.boxSizing = 'border-box';
            btn.style.display = 'inline-flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.background = '#2c3e50';
            btn.style.color = '#ecf0f1';
            btn.setAttribute('data-dc-metar-watch-btn', '1');
            badge = document.createElement('span');
            badge.textContent = '!';
            badge.style.display = 'none';
            badge.style.position = 'absolute';
            badge.style.top = '-6px';
            badge.style.right = '-6px';
            badge.style.background = '#f1c40f';
            badge.style.color = '#000';
            badge.style.fontSize = '10px';
            badge.style.fontWeight = '800';
            badge.style.borderRadius = '8px';
            badge.style.minWidth = '16px';
            badge.style.height = '16px';
            badge.style.lineHeight = '16px';
            badge.style.textAlign = 'center';
            btn.appendChild(badge);
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (Notification && Notification.permission === 'default' && boolPref('metarWatchNotify', true)) {
                    Notification.requestPermission();
                }
                openModal();
            });
        }
        if (anchor && anchor.parentNode) {
            if (btn.parentNode !== anchor.parentNode || btn.previousSibling !== anchor) {
                anchor.parentNode.insertBefore(btn, anchor.nextSibling);
            }
            var row = anchor.parentElement;
            var rowH = 0;
            try {
                rowH = Math.max(row.offsetHeight || 0, row.clientHeight || 0, anchor.offsetHeight || 0);
            } catch (e) {}
            if (rowH < 24) {
                rowH = 36;
            }
            btn.style.minHeight = rowH + 'px';
            btn.style.height = 'auto';
            btn.style.alignSelf = 'stretch';
            var cs = null;
            try {
                cs = row ? window.getComputedStyle(row) : null;
            } catch (e2) {}
            if (cs && (cs.display === 'flex' || cs.display === 'inline-flex')) {
                btn.style.alignSelf = 'stretch';
            } else if (row) {
                try {
                    row.style.display = 'flex';
                    row.style.alignItems = 'stretch';
                } catch (e3) {}
            }
        } else {
            btn.style.minHeight = '';
            btn.style.alignSelf = '';
            if (btn.parentNode !== host) {
                host.appendChild(btn);
            }
        }
    }

    function buildModal() {
        backdrop = document.createElement('div');
        backdrop.style.display = 'none';
        backdrop.style.position = 'fixed';
        backdrop.style.left = '0';
        backdrop.style.top = '0';
        backdrop.style.right = '0';
        backdrop.style.bottom = '0';
        backdrop.style.background = 'rgba(0,0,0,0.45)';
        backdrop.style.zIndex = '10000000';
        backdrop.addEventListener('click', function () {
            markViewedFromCache();
            closeModal();
        });

        modal = document.createElement('div');
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.left = '50%';
        modal.style.top = '50%';
        modal.style.transform = 'translate(-50%,-50%)';
        modal.style.width = 'min(960px, calc((100vw - 20px) * 0.6))';
        modal.style.height = 'calc((100vh - 24px) * 0.7)';
        modal.style.maxHeight = 'calc((100vh - 24px) * 0.7)';
        modal.style.background = '#1a1a1e';
        modal.style.borderRadius = '10px';
        modal.style.boxShadow = '0 12px 48px rgba(0,0,0,0.55)';
        modal.style.zIndex = '10000001';
        modal.style.flexDirection = 'column';
        modal.style.overflow = 'hidden';
        modal.addEventListener('click', function (e) {
            e.stopPropagation();
        });

        var header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.padding = '12px 16px';
        header.style.background = '#25252c';
        header.style.color = '#ecf0f1';
        header.style.fontFamily = 'system-ui, sans-serif';
        header.style.fontSize = '15px';
        header.style.fontWeight = '600';

        var headerTitle = document.createElement('span');
        headerTitle.textContent = 'Tracked stations — METAR / TAF';

        refreshThisBtn = document.createElement('button');
        refreshThisBtn.type = 'button';
        refreshThisBtn.textContent = 'Refresh';
        refreshThisBtn.title = 'Reload METAR/TAF, radar, and AFD for the selected airport';
        refreshThisBtn.style.marginRight = '8px';
        refreshThisBtn.style.padding = '6px 10px';
        refreshThisBtn.style.fontSize = '12px';
        refreshThisBtn.style.borderRadius = '4px';
        refreshThisBtn.style.border = '1px solid #444';
        refreshThisBtn.style.background = '#2a2a32';
        refreshThisBtn.style.color = '#ecf0f1';
        refreshThisBtn.style.cursor = 'pointer';
        refreshThisBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            refreshCurrentStation();
        });

        refreshAllBtn = document.createElement('button');
        refreshAllBtn.type = 'button';
        refreshAllBtn.textContent = 'Refresh all';
        refreshAllBtn.title = 'Reload weather for every station in the list';
        refreshAllBtn.style.marginRight = '12px';
        refreshAllBtn.style.padding = '6px 10px';
        refreshAllBtn.style.fontSize = '12px';
        refreshAllBtn.style.borderRadius = '4px';
        refreshAllBtn.style.border = '1px solid #444';
        refreshAllBtn.style.background = '#2a2a32';
        refreshAllBtn.style.color = '#ecf0f1';
        refreshAllBtn.style.cursor = 'pointer';
        refreshAllBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            refreshAllStationsManual();
        });

        var closeB = document.createElement('button');
        closeB.type = 'button';
        closeB.textContent = '×';
        closeB.style.border = 'none';
        closeB.style.background = 'transparent';
        closeB.style.color = '#bdc3c7';
        closeB.style.fontSize = '24px';
        closeB.style.cursor = 'pointer';
        closeB.style.lineHeight = '1';
        closeB.addEventListener('click', function () {
            markViewedFromCache();
            closeModal();
        });
        header.appendChild(headerTitle);
        header.appendChild(refreshThisBtn);
        header.appendChild(refreshAllBtn);
        header.appendChild(closeB);
        header.style.flexShrink = '0';

        var body = document.createElement('div');
        body.style.display = 'flex';
        body.style.flex = '1';
        body.style.minHeight = '0';
        body.style.flexBasis = '0';
        body.style.overflow = 'hidden';

        var left = document.createElement('div');
        left.style.width = '165px';
        left.style.minWidth = '140px';
        left.style.maxWidth = '200px';
        left.style.flexShrink = '0';
        left.style.borderRight = '1px solid #333';
        left.style.padding = '12px';
        left.style.display = 'flex';
        left.style.flexDirection = 'column';
        left.style.minHeight = '0';
        left.style.background = '#202028';

        var sortRow = document.createElement('div');
        sortRow.style.display = 'flex';
        sortRow.style.alignItems = 'center';
        sortRow.style.gap = '6px';
        sortRow.style.marginBottom = '8px';
        sortRow.style.flexShrink = '0';
        var sortLab = document.createElement('label');
        sortLab.textContent = 'Sort';
        sortLab.style.fontSize = '11px';
        sortLab.style.color = '#95a5a6';
        sortLab.style.fontFamily = 'system-ui, sans-serif';
        sortSelect = document.createElement('select');
        sortSelect.style.flex = '1';
        sortSelect.style.minWidth = '0';
        sortSelect.style.fontSize = '11px';
        sortSelect.style.padding = '4px 6px';
        sortSelect.style.borderRadius = '4px';
        sortSelect.style.border = '1px solid #444';
        sortSelect.style.background = '#2a2a32';
        sortSelect.style.color = '#ecf0f1';
        var sortOpts = [
            ['list', 'List order'],
            ['icao_az', 'ICAO A–Z'],
            ['newest', 'Newest change'],
            ['oldest', 'Oldest change']
        ];
        var so;
        for (so = 0; so < sortOpts.length; so++) {
            var o = document.createElement('option');
            o.value = sortOpts[so][0];
            o.textContent = sortOpts[so][1];
            sortSelect.appendChild(o);
        }
        sortSelect.value = sortMode;
        sortSelect.addEventListener('change', function () {
            sortMode = sortSelect.value;
            saveSortMode(sortMode);
            renderStationList();
        });
        sortRow.appendChild(sortLab);
        sortRow.appendChild(sortSelect);

        listEl = document.createElement('div');
        listEl.style.flex = '1';
        listEl.style.minHeight = '0';
        listEl.style.overflow = 'auto';

        var addRow = document.createElement('div');
        addRow.style.marginTop = '10px';
        addRow.style.flexShrink = '0';
        addRow.style.display = 'flex';
        addRow.style.flexDirection = 'column';
        addRow.style.gap = '8px';
        addInput = document.createElement('input');
        addInput.type = 'text';
        addInput.placeholder = 'KDEN or DEN';
        addInput.maxLength = 8;
        addInput.style.width = '100%';
        addInput.style.minWidth = '0';
        addInput.style.boxSizing = 'border-box';
        addInput.style.padding = '6px 8px';
        addInput.style.borderRadius = '4px';
        addInput.style.border = '1px solid #444';
        addInput.style.background = '#2a2a32';
        addInput.style.color = '#ecf0f1';
        addInput.style.fontSize = '12px';
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = 'Add station';
        addBtn.style.width = '100%';
        addBtn.style.boxSizing = 'border-box';
        addBtn.style.padding = '8px 10px';
        addBtn.style.border = 'none';
        addBtn.style.borderRadius = '4px';
        addBtn.style.background = '#2980b9';
        addBtn.style.color = '#fff';
        addBtn.style.cursor = 'pointer';
        addBtn.style.fontSize = '13px';
        addBtn.style.flexShrink = '0';

        function tryAddStation() {
            var raw = String(addInput.value || '').trim().toUpperCase();
            var code = raw;
            if (/^[A-Z]{4}$/.test(raw)) {
                var fromIcao = iataFromIcao(raw);
                if (!fromIcao) {
                    return;
                }
                code = fromIcao;
            }
            if (!/^[A-Z]{3}$/.test(code)) {
                return;
            }
            if (stationList.indexOf(code) >= 0) {
                addInput.value = '';
                return;
            }
            stationList.push(code);
            saveStationList(stationList);
            normalizePendingChangeTimes();
            selectedIata = code;
            addInput.value = '';
            renderStationList();
            renderDetail(selectedIata);
            runPoll();
        }

        addBtn.addEventListener('click', tryAddStation);
        addInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                tryAddStation();
            }
        });
        addRow.appendChild(addInput);
        addRow.appendChild(addBtn);

        left.appendChild(sortRow);
        left.appendChild(listEl);
        left.appendChild(addRow);

        detailEl = document.createElement('div');
        detailEl.style.flex = '1';
        detailEl.style.minWidth = '0';
        detailEl.style.minHeight = '0';
        detailEl.style.overflow = 'auto';
        detailEl.style.padding = '16px';
        detailEl.style.background = '#1a1a1e';
        detailEl.style.color = '#ecf0f1';

        body.appendChild(left);
        body.appendChild(detailEl);

        modal.appendChild(header);
        modal.appendChild(body);

        statusBarEl = document.createElement('div');
        statusBarEl.style.flexShrink = '0';
        statusBarEl.style.padding = '8px 14px';
        statusBarEl.style.fontSize = '11px';
        statusBarEl.style.fontFamily = 'system-ui, sans-serif';
        statusBarEl.style.color = '#bdc3c7';
        statusBarEl.style.background = '#1e1e24';
        statusBarEl.style.borderTop = '1px solid #333';
        statusBarEl.textContent = '';
        modal.appendChild(statusBarEl);

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        updateRefreshThisLabel();

        onDocKey = function (e) {
            if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
                markViewedFromCache();
                closeModal();
            }
        };
        document.addEventListener('keydown', onDocKey);
    }

    function init() {
        buildModal();
        mountButtonNearClock();
        runPoll();
        pollTimer = setInterval(runPoll, pollMs());
        domObserver = new MutationObserver(function () {
            scheduleMountButton();
        });
        domObserver.observe(document.documentElement, { childList: true, subtree: true });
        anchorRetryTimer = setInterval(scheduleMountButton, 4000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.__myScriptCleanup = function () {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (listColorTimer) {
            clearInterval(listColorTimer);
            listColorTimer = null;
        }
        if (anchorRetryTimer) {
            clearInterval(anchorRetryTimer);
            anchorRetryTimer = null;
        }
        if (domObserver) {
            domObserver.disconnect();
            domObserver = null;
        }
        try {
            if (backdrop) {
                backdrop.remove();
            }
        } catch (e) {}
        try {
            if (modal) {
                modal.remove();
            }
        } catch (e) {}
        try {
            if (btn) {
                btn.remove();
            }
        } catch (e) {}
        if (onDocKey) {
            document.removeEventListener('keydown', onDocKey);
            onDocKey = null;
        }
        btn = null;
        badge = null;
        modal = null;
        backdrop = null;
        refreshThisBtn = null;
        refreshAllBtn = null;
        statusBarEl = null;
        sortSelect = null;
        window.__myScriptCleanup = undefined;
    };
})();
