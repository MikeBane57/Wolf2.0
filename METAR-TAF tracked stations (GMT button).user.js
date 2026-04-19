// ==UserScript==
// @name         METAR/TAF tracked stations (GMT button)
// @namespace    Wolf 2.0
// @version      1.0.0
// @description  Button near GMT clock: modal with full METAR/TAF for tracked stations, alerts when text changes since you last viewed, optional notifications
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      tgftp.nws.noaa.gov
// @donkeycode-pref {"metarWatchPollMinutes":{"type":"number","group":"METAR watch","label":"Poll every (minutes)","description":"How often to refresh METAR/TAF in the background.","default":5,"min":1,"max":120,"step":1},"metarWatchNotify":{"type":"boolean","group":"METAR watch","label":"Browser notifications","description":"Notify when METAR/TAF changes for a tracked station since you last opened the modal.","default":true},"metarWatchDefaultStations":{"type":"string","group":"METAR watch","label":"Default stations (IATA)","description":"Comma-separated list used until you customize the list (same region as SW tooltip defaults).","default":"ATL,MDW,BWI,OAK,TPA,MCO,DAL,MKE,LAS,PHX,DEN,LAX,SAN,FLL,HOU"}}
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

    function icaoFor(iata) {
        return IATA_TO_ICAO[iata.toUpperCase()] || null;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fetchText(url, cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb('');
            return;
        }
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            onload: function (r) {
                try {
                    cb(typeof r.responseText === 'string' ? r.responseText : '');
                } catch (e) {
                    cb('');
                }
            },
            onerror: function () {
                cb('');
            }
        });
    }

    function parseMetarBody(txt) {
        try {
            var lines = txt.split('\n');
            return lines.slice(1).join(' ').trim() || 'N/A';
        } catch (e) {
            return 'N/A';
        }
    }

    function parseTafBody(txt) {
        try {
            var lines = txt.split('\n');
            return lines.slice(1).join('\n').trim() || 'N/A';
        } catch (e) {
            return 'N/A';
        }
    }

    function fetchWeatherForIata(iata, cb) {
        var icao = icaoFor(iata);
        if (!icao) {
            cb({ iata: iata.toUpperCase(), icao: null, metar: 'No ICAO mapping', taf: '', err: true });
            return;
        }
        var metarURL = 'https://tgftp.nws.noaa.gov/data/observations/metar/stations/' + icao + '.TXT';
        var tafURL = 'https://tgftp.nws.noaa.gov/data/forecasts/taf/stations/' + icao + '.TXT';
        fetchText(metarURL, function (mt) {
            var metar = parseMetarBody(mt);
            fetchText(tafURL, function (tt) {
                var taf = parseTafBody(tt);
                var rec = { iata: iata.toUpperCase(), icao: icao, metar: metar, taf: taf, err: false, t: Date.now() };
                cacheByIcao[icao] = rec;
                cb(rec);
            });
        });
    }

    function fetchAllSequential(list, idx, out, done) {
        if (!list || idx >= list.length) {
            done(out);
            return;
        }
        fetchWeatherForIata(list[idx], function (rec) {
            out.push(rec);
            fetchAllSequential(list, idx + 1, out, done);
        });
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

    var bootstrappedViewed = false;

    function runPoll() {
        fetchAllSequential(stationList, 0, [], function (results) {
            var i;
            for (i = 0; i < results.length; i++) {
                var r = results[i];
                if (r.icao) {
                    cacheByIcao[r.icao] = r;
                }
            }
            if (!bootstrappedViewed) {
                try {
                    var raw = localStorage.getItem(STORAGE_VIEWED);
                    if (!raw || raw === '{}') {
                        viewedSnapshot = snapshotFromResults(results);
                        saveViewedSnapshot(viewedSnapshot);
                    }
                } catch (e) {}
                bootstrappedViewed = true;
            }
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
                label.textContent = iata + (icaoFor(iata) ? ' (' + icaoFor(iata) + ')' : '');
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
            fetchWeatherForIata(iata, function (rec) {
                if (selectedIata === iata) {
                    renderDetail(iata);
                }
            });
            return;
        }
        var m = escapeHtml(rec.metar).replace(/\n/g, '<br>');
        var t = escapeHtml(rec.taf).replace(/\n/g, '<br>');
        detailEl.innerHTML =
            '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;color:#ecf0f1;">' +
            '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">METAR</div>' +
            '<div style="margin-bottom:16px;white-space:pre-wrap;">' + m + '</div>' +
            '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">TAF</div>' +
            '<div style="white-space:pre-wrap;">' + t + '</div>' +
            '</div>';
    }

    function openModal() {
        modal.style.display = 'flex';
        backdrop.style.display = 'block';
        selectedIata = stationList[0] || null;
        renderStationList();
        fetchAllSequential(stationList, 0, [], function () {
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
        if (btn && btn.parentNode) {
            return;
        }
        var anchor = findGmtClockElement();
        var host = anchor && anchor.parentElement ? anchor.parentElement : document.body;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'WX';
            btn.title = 'Tracked METAR/TAF (click to view)';
            btn.style.marginLeft = '8px';
            btn.style.padding = '2px 8px';
            btn.style.fontSize = '12px';
            btn.style.fontWeight = '600';
            btn.style.border = 'none';
            btn.style.borderRadius = '4px';
            btn.style.cursor = 'pointer';
            btn.style.verticalAlign = 'middle';
            btn.style.position = 'relative';
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
        } else {
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
        modal.style.display = 'none';
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

        var body = document.createElement('div');
        body.style.display = 'flex';
        body.style.flex = '1';
        body.style.minHeight = '0';
        body.style.overflow = 'hidden';

        var left = document.createElement('div');
        left.style.width = '220px';
        left.style.flexShrink = '0';
        left.style.borderRight = '1px solid #333';
        left.style.padding = '12px';
        left.style.display = 'flex';
        left.style.flexDirection = 'column';
        left.style.background = '#202028';

        listEl = document.createElement('div');
        listEl.style.flex = '1';
        listEl.style.minHeight = '0';
        listEl.style.overflow = 'auto';

        var addRow = document.createElement('div');
        addRow.style.marginTop = '10px';
        addRow.style.display = 'flex';
        addRow.style.gap = '6px';
        addInput = document.createElement('input');
        addInput.type = 'text';
        addInput.placeholder = 'IATA (e.g. DEN)';
        addInput.maxLength = 4;
        addInput.style.flex = '1';
        addInput.style.padding = '6px 8px';
        addInput.style.borderRadius = '4px';
        addInput.style.border = '1px solid #444';
        addInput.style.background = '#2a2a32';
        addInput.style.color = '#ecf0f1';
        addInput.style.fontSize = '13px';
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = 'Add';
        addBtn.style.padding = '6px 10px';
        addBtn.style.border = 'none';
        addBtn.style.borderRadius = '4px';
        addBtn.style.background = '#2980b9';
        addBtn.style.color = '#fff';
        addBtn.style.cursor = 'pointer';
        addBtn.style.fontSize = '13px';
        addBtn.addEventListener('click', function () {
            var code = String(addInput.value || '').trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(code)) {
                return;
            }
            if (stationList.indexOf(code) >= 0) {
                addInput.value = '';
                return;
            }
            stationList.push(code);
            saveStationList(stationList);
            addInput.value = '';
            renderStationList();
            runPoll();
        });
        addRow.appendChild(addInput);
        addRow.appendChild(addBtn);

        left.appendChild(listEl);
        left.appendChild(addRow);

        detailEl = document.createElement('div');
        detailEl.style.flex = '1';
        detailEl.style.minWidth = '0';
        detailEl.style.overflow = 'auto';
        detailEl.style.padding = '16px';
        detailEl.style.background = '#1a1a1e';

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
