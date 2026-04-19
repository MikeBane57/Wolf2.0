// ==UserScript==
// @name         METAR/TAF tracked stations (GMT button)
// @namespace    Wolf 2.0
// @version      1.4.0
// @description  Button near GMT clock: modal with last 3 METARs + TAF for tracked stations, alerts when text changes since you last viewed, optional notifications
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      tgftp.nws.noaa.gov
// @connect      aviationweather.gov
// @donkeycode-pref {"metarWatchPollMinutes":{"type":"number","group":"METAR watch","label":"Poll every (minutes)","description":"How often to refresh METAR/TAF in the background.","default":5,"min":1,"max":120,"step":1},"metarWatchConcurrentStations":{"type":"number","group":"METAR watch","label":"Parallel station fetches","description":"How many airports to load at the same time (higher = faster refresh, more concurrent requests).","default":6,"min":1,"max":20,"step":1},"metarWatchNotify":{"type":"boolean","group":"METAR watch","label":"Browser notifications","description":"Notify when METAR/TAF changes for a tracked station since you last opened the modal.","default":true},"metarWatchDefaultStations":{"type":"string","group":"METAR watch","label":"Default stations (IATA)","description":"Comma-separated list used until you customize the list (same region as SW tooltip defaults).","default":"ATL,MDW,BWI,OAK,TPA,MCO,DAL,MKE,LAS,PHX,DEN,LAX,SAN,FLL,HOU"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/METAR-TAF%20tracked%20stations%20(GMT%20button).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/METAR-TAF%20tracked%20stations%20(GMT%20button).user.js
// ==/UserScript==

(function () {
    'use strict';

    var STORAGE_STATIONS = 'dc-metar-watch-stations-v1';
    var STORAGE_VIEWED = 'dc-metar-watch-viewed-snapshot-v1';

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

    var stationList = loadStationList();
    var viewedSnapshot = loadViewedSnapshot();
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

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    function fetchText(url, cb) {
        function finish(txt) {
            cb(typeof txt === 'string' ? txt : '');
        }
        function fallback() {
            fetchTextViaPageFetch(url, finish);
        }
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
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
            });
            return;
        }
        fallback();
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
            cb({ iata: iata.toUpperCase(), icao: null, metar: 'No ICAO mapping', metarLines: [], taf: '', err: true });
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
            var rec = {
                iata: iata.toUpperCase(),
                icao: icao,
                metar: metar,
                metarLines: metarLines.slice(),
                taf: taf,
                err: false,
                t: Date.now()
            };
            cacheByIcao[icao] = rec;
            cb(rec);
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

    function fetchAllStations(list, done) {
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
                    fetchWeatherForIata(list[index], function (rec) {
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

    function runPoll() {
        fetchAllStations(stationList, function (results) {
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
            }
        });
    }

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
        updateAlertState();
    }

    function renderStationList() {
        listEl.innerHTML = '';
        var i;
        for (i = 0; i < stationList.length; i++) {
            (function (iata) {
                var row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.justifyContent = 'space-between';
                row.style.padding = '6px 8px';
                row.style.cursor = 'pointer';
                row.style.borderRadius = '4px';
                row.style.marginBottom = '4px';
                if (selectedIata === iata) {
                    row.style.background = 'rgba(52,152,219,0.25)';
                }
                var label = document.createElement('span');
                label.textContent = stationListLabel(iata);
                label.style.fontFamily = 'system-ui, sans-serif';
                label.style.fontSize = '13px';
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
                x.style.padding = '0 4px';
                x.addEventListener('click', function (e) {
                    e.stopPropagation();
                    stationList = stationList.filter(function (s) {
                        return s !== iata;
                    });
                    saveStationList(stationList);
                    if (selectedIata === iata) {
                        selectedIata = stationList[0] || null;
                    }
                    renderStationList();
                    runPoll();
                });
                row.addEventListener('click', function () {
                    selectedIata = iata;
                    renderStationList();
                    renderDetail(iata);
                });
                row.appendChild(label);
                row.appendChild(x);
                listEl.appendChild(row);
            })(stationList[i]);
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
                    (isLast ? '0' : '10px') +
                    ';padding-bottom:' +
                    (isLast ? '0' : '10px') +
                    ';border-bottom:' +
                    (isLast ? 'none' : '1px solid #2c2c34') +
                    ';white-space:pre-wrap;word-break:break-word;">' +
                    '<span style="color:#7f8c8d;font-size:11px;margin-right:6px;">' +
                    (mj + 1) +
                    '.</span>' +
                    escapeHtml(metarDisplay[mj]).replace(/\n/g, '<br>') +
                    '</div>';
            }
        } else {
            mBlocks = '<div style="color:#95a5a6;">N/A</div>';
        }
        var t = escapeHtml(r.taf).replace(/\n/g, '<br>');
        detailEl.innerHTML =
            '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;color:#ecf0f1;min-height:120px;">' +
            '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">METAR <span style="font-weight:400;color:#95a5a6;font-size:11px;">(last 3 when available)</span></div>' +
            '<div style="margin-bottom:16px;">' +
            mBlocks +
            '</div>' +
            '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">TAF</div>' +
            '<div style="white-space:pre-wrap;word-break:break-word;">' + t + '</div>' +
            '</div>';
    }

    function openModal() {
        modal.style.display = 'flex';
        backdrop.style.display = 'block';
        selectedIata = stationList[0] || null;
        renderStationList();
        if (selectedIata) {
            renderDetail(selectedIata);
        }
        fetchAllStations(stationList, function () {
            renderStationList();
            if (selectedIata) {
                renderDetail(selectedIata);
            }
            markViewedFromCache();
        });
    }

    function closeModal() {
        modal.style.display = 'none';
        backdrop.style.display = 'none';
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
        modal.style.width = 'min(920px, calc(100vw - 32px))';
        modal.style.height = 'min(640px, calc(100vh - 48px))';
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

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

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
        window.__myScriptCleanup = undefined;
    };
})();
