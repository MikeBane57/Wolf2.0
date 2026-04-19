// ==UserScript==
// @name         METAR/TAF tracked stations (GMT button)
// @namespace    Wolf 2.0
// @version      2.0.2
// @description  Button near GMT clock: METAR/TAF, D-ATIS, RVR, radar, HRRR hourly, AFD, alerts; new METAR/TAF title highlights
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      tgftp.nws.noaa.gov
// @connect      aviationweather.gov
// @connect      api.weather.gov
// @connect      radar.weather.gov
// @connect      rvr.data.faa.gov
// @connect      atis.info
// @connect      api.open-meteo.com
// @donkeycode-pref {"metarWatchPollMinutes":{"type":"number","group":"METAR watch","label":"Poll every (minutes)","description":"How often to refresh METAR/TAF in the background.","default":5,"min":1,"max":120,"step":1},"metarWatchConcurrentStations":{"type":"number","group":"METAR watch","label":"Parallel station fetches","description":"How many airports to load at the same time (higher = faster refresh, more concurrent requests).","default":10,"min":1,"max":20,"step":1},"metarWatchNotify":{"type":"boolean","group":"METAR watch","label":"Browser notifications","description":"Notify when METAR/TAF changes for a tracked station since you last opened the modal.","default":true},"metarWatchDefaultStations":{"type":"string","group":"METAR watch","label":"Default stations (IATA)","description":"Comma-separated list used until you customize the list (same region as SW tooltip defaults).","default":"ATL,MDW,BWI,OAK,TPA,MCO,DAL,MKE,LAS,PHX,DEN,LAX,SAN,FLL,HOU"}}
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

    function isStationStaleVersusViewed(iata) {
        var icao = icaoFor(iata);
        if (!icao || !cacheByIcao[icao]) {
            return false;
        }
        var c = cacheByIcao[icao];
        var v = viewedSnapshot[icao];
        return !v || c.metar !== v.metar || c.taf !== v.taf;
    }

    /** Milliseconds for newest/oldest sort: first-seen pending time, else last fetch time if still stale. */
    function sortKeyChangeOrFetch(iata) {
        var pt = pendingChangeTime[iata];
        if (typeof pt === 'number' && Number.isFinite(pt) && pt > 0) {
            return pt;
        }
        if (!isStationStaleVersusViewed(iata)) {
            return 0;
        }
        var icao = icaoFor(iata);
        var r = icao && cacheByIcao[icao];
        if (r && typeof r.t === 'number' && Number.isFinite(r.t)) {
            return r.t;
        }
        return 0;
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
                var ka = sortKeyChangeOrFetch(a);
                var kb = sortKeyChangeOrFetch(b);
                if (ka !== kb) {
                    return kb - ka;
                }
                return indexOf[a] - indexOf[b];
            });
            return base;
        }
        if (sortMode === 'oldest') {
            base.sort(function (a, b) {
                var ta = sortKeyChangeOrFetch(a);
                var tb = sortKeyChangeOrFetch(b);
                if (ta === 0 && tb === 0) {
                    return indexOf[a] - indexOf[b];
                }
                if (ta === 0) {
                    return 1;
                }
                if (tb === 0) {
                    return -1;
                }
                if (ta !== tb) {
                    return ta - tb;
                }
                return indexOf[a] - indexOf[b];
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

    /** Inline styles for METAR/TAF section title row when text differs from last-viewed snapshot. */
    function detailTitleHighlightStyle(iata, sectionUnseen) {
        if (!sectionUnseen) {
            return '';
        }
        var age = pendingChangeAgeClass(iata);
        var pad = 'padding:6px 10px;margin-bottom:6px;border-radius:4px;box-sizing:border-box;';
        if (age === 'stale') {
            return (
                pad +
                'background:rgba(231,76,60,0.28);border-left:4px solid #e74c3c;color:#ecf0f1 !important;'
            );
        }
        return (
            pad +
            'background:rgba(241,196,15,0.28);border-left:4px solid #f1c40f;color:#ecf0f1 !important;'
        );
    }

    function metarTafUnseenVersusViewed(iata, r) {
        var icao = icaoFor(iata);
        if (!icao || !r) {
            return { metar: false, taf: false };
        }
        var v = viewedSnapshot[icao];
        var cm = String(r.metar || '');
        var ct = String(r.taf || '');
        if (!v) {
            return { metar: true, taf: true };
        }
        return {
            metar: cm !== String(v.metar || ''),
            taf: ct !== String(v.taf || '')
        };
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
                if (selectedIata) {
                    renderDetail(selectedIata);
                }
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

    function faaRvrUrlForIata(iata, bustCache) {
        var u =
            'https://rvr.data.faa.gov/cgi-bin/rvr-details.pl?content=table&airport=' +
            encodeURIComponent(String(iata || '').toUpperCase());
        if (bustCache) {
            u += '&dc_cb=' + Date.now();
        }
        return u;
    }

    function buildFaaRvrTableHtml(rvr, iata3) {
        if (!rvr || !rvr.rows || !rvr.rows.length) {
            return '';
        }
        var hdr =
            '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#ecf0f1;">' +
            '<thead><tr style="color:#3498db;">' +
            '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #444;">RWY</th>' +
            '<th style="text-align:right;padding:4px 6px;border-bottom:1px solid #444;">TD</th>' +
            '<th style="text-align:right;padding:4px 6px;border-bottom:1px solid #444;">MP</th>' +
            '<th style="text-align:right;padding:4px 6px;border-bottom:1px solid #444;">RO</th>' +
            '<th style="text-align:center;padding:4px 4px;border-bottom:1px solid #444;">E</th>' +
            '<th style="text-align:center;padding:4px 4px;border-bottom:1px solid #444;">C</th>' +
            '</tr></thead><tbody>';
        var body = '';
        var ri;
        for (ri = 0; ri < rvr.rows.length; ri++) {
            var row = rvr.rows[ri];
            body +=
                '<tr>' +
                '<td style="padding:4px 6px;border-bottom:1px solid #2a2a32;">' +
                escapeHtml(row.rwy) +
                '</td>' +
                '<td style="text-align:right;padding:4px 6px;border-bottom:1px solid #2a2a32;">' +
                escapeHtml(row.td) +
                '</td>' +
                '<td style="text-align:right;padding:4px 6px;border-bottom:1px solid #2a2a32;">' +
                escapeHtml(row.mp) +
                '</td>' +
                '<td style="text-align:right;padding:4px 6px;border-bottom:1px solid #2a2a32;">' +
                escapeHtml(row.ro) +
                '</td>' +
                '<td style="text-align:center;padding:4px 4px;border-bottom:1px solid #2a2a32;">' +
                escapeHtml(row.e) +
                '</td>' +
                '<td style="text-align:center;padding:4px 4px;border-bottom:1px solid #2a2a32;">' +
                escapeHtml(row.c) +
                '</td>' +
                '</tr>';
        }
        var sub = '';
        if (rvr.updatedUtc) {
            sub =
                '<div style="font-size:10px;color:#95a5a6;margin-top:8px;font-family:system-ui,sans-serif;">FAA RVR · as of ' +
                escapeHtml(rvr.updatedUtc) +
                ' · <a href="' +
                escapeHtml(
                    'https://rvr.data.faa.gov/cgi-bin/rvr-details.pl?content=table&airport=' +
                        encodeURIComponent(String(iata3 || '').toUpperCase())
                ) +
                '" target="_blank" rel="noopener noreferrer" style="color:#5dade2;">rvr.data.faa.gov</a></div>';
        }
        return hdr + body + '</tbody></table>' + sub;
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

    var WMO_WEATHER_DESC = {
        0: 'Clear',
        1: 'Mainly clear',
        2: 'Partly cloudy',
        3: 'Overcast',
        45: 'Fog',
        48: 'Depositing rime fog',
        51: 'Light drizzle',
        53: 'Drizzle',
        55: 'Heavy drizzle',
        56: 'Freezing drizzle',
        57: 'Heavy freezing drizzle',
        61: 'Slight rain',
        63: 'Rain',
        65: 'Heavy rain',
        66: 'Freezing rain',
        67: 'Heavy freezing rain',
        71: 'Slight snow',
        73: 'Snow',
        75: 'Heavy snow',
        77: 'Snow grains',
        80: 'Rain showers',
        81: 'Rain showers',
        82: 'Violent rain showers',
        85: 'Snow showers',
        86: 'Heavy snow showers',
        95: 'Thunderstorm',
        96: 'Thunderstorm w/ hail',
        99: 'Thunderstorm w/ hail'
    };

    function wmoWeatherLabel(code) {
        var c = Number(code);
        if (!Number.isFinite(c)) {
            return '';
        }
        return WMO_WEATHER_DESC[c] || 'Code ' + c;
    }

    function buildDatisBlockHtml(entries) {
        if (!entries || !entries.length) {
            return '';
        }
        var parts = [];
        var i;
        for (i = 0; i < entries.length; i++) {
            var e = entries[i];
            var lab = escapeHtml(e.label || 'ATIS');
            if (e.code) {
                lab += ' <span style="color:#95a5a6;">' + escapeHtml(String(e.code)) + '</span>';
            }
            parts.push(
                '<div style="margin-bottom:12px;">' +
                '<div style="font-size:11px;color:#3498db;margin-bottom:4px;font-weight:600;">' +
                lab +
                '</div>' +
                '<div style="font-size:11px;line-height:1.45;color:#bdc3c7;white-space:pre-wrap;word-break:break-word;">' +
                escapeHtml(e.text) +
                '</div>' +
                (e.updatedAt
                    ? '<div style="font-size:10px;color:#7f8c8d;margin-top:6px;">Updated ' + escapeHtml(e.updatedAt) + '</div>'
                    : '') +
                '</div>'
            );
        }
        return (
            '<div style="margin-bottom:16px;">' +
            '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">Digital ATIS <span style="font-weight:400;color:#95a5a6;font-size:11px;">(third-party)</span></div>' +
            '<div style="background:#141418;padding:10px;border-radius:6px;max-height:min(40vh,420px);overflow:auto;">' +
            parts.join('') +
            '</div>' +
            '<div style="font-size:10px;color:#7f8c8d;margin-top:6px;font-family:system-ui,sans-serif;">Source: atis.info — not official FAA; verify with ATIS/AWOS.</div>' +
            '</div>'
        );
    }

    function buildHrrrTableHtml(h) {
        if (!h || !h.times || !h.times.length) {
            return '';
        }
        var rows = [];
        var maxRows = 24;
        var i;
        var n = Math.min(h.times.length, maxRows);
        for (i = 0; i < n; i++) {
            var t = h.times[i];
            var tf = h.tempF[i];
            var pop = h.pop[i];
            var wc = h.wcode[i];
            var ws = h.wspd[i];
            var wd = h.wdir[i];
            var wdStr = wd !== undefined && wd !== null && Number.isFinite(Number(wd)) ? Math.round(Number(wd)) + '°' : '—';
            var wlab = wmoWeatherLabel(wc);
            rows.push(
                '<tr>' +
                '<td style="padding:4px 6px;border-bottom:1px solid #2a2a32;white-space:nowrap;">' +
                escapeHtml(String(t).replace('T', ' ').slice(0, 16)) +
                '</td>' +
                '<td style="text-align:right;padding:4px 6px;border-bottom:1px solid #2a2a32;">' +
                (tf !== undefined && tf !== null ? escapeHtml(String(tf)) + ' ' + escapeHtml(h.unitTemp || '°F') : '—') +
                '</td>' +
                '<td style="text-align:right;padding:4px 6px;border-bottom:1px solid #2a2a32;">' +
                (pop !== undefined && pop !== null ? escapeHtml(String(pop)) + '%' : '—') +
                '</td>' +
                '<td style="padding:4px 6px;border-bottom:1px solid #2a2a32;font-size:10px;">' +
                escapeHtml(wlab) +
                '</td>' +
                '<td style="text-align:right;padding:4px 6px;border-bottom:1px solid #2a2a32;white-space:nowrap;">' +
                (ws !== undefined && ws !== null ? escapeHtml(String(ws)) + ' ' + escapeHtml(h.unitWind || 'mph') : '—') +
                ' ' +
                wdStr +
                '</td>' +
                '</tr>'
            );
        }
        return (
            '<div style="margin-bottom:16px;">' +
            '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">HRRR forecast <span style="font-weight:400;color:#95a5a6;font-size:11px;">(hourly, Open-Meteo GFS+HRRR)</span></div>' +
            '<div style="overflow:auto;max-height:min(42vh,480px);background:#141418;padding:10px;border-radius:6px;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#ecf0f1;">' +
            '<thead><tr style="color:#3498db;">' +
            '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #444;">Time (UTC)</th>' +
            '<th style="text-align:right;padding:4px 6px;border-bottom:1px solid #444;">Temp</th>' +
            '<th style="text-align:right;padding:4px 6px;border-bottom:1px solid #444;">PoP</th>' +
            '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #444;">Wx</th>' +
            '<th style="text-align:right;padding:4px 6px;border-bottom:1px solid #444;">Wind</th>' +
            '</tr></thead><tbody>' +
            rows.join('') +
            '</tbody></table></div>' +
            '</div>'
        );
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

    /** Third-party D-ATIS JSON (ICAO), e.g. https://atis.info/api/KDEN */
    function fetchDatisForIcao(icao, cb) {
        fetchText('https://atis.info/api/' + encodeURIComponent(String(icao || '').toUpperCase()), function (txt) {
            if (!txt || txt.charAt(0) !== '[') {
                cb(null);
                return;
            }
            try {
                var arr = JSON.parse(txt);
                if (!Array.isArray(arr) || !arr.length) {
                    cb(null);
                    return;
                }
                var out = [];
                var i;
                for (i = 0; i < arr.length; i++) {
                    var o = arr[i];
                    if (o && o.datis) {
                        var typ = String(o.type || '').toLowerCase();
                        var lab = typ === 'arr' ? 'Arrival' : typ === 'dep' ? 'Departure' : typ === 'combined' ? 'Combined' : typ || 'ATIS';
                        out.push({
                            type: typ,
                            code: o.code || '',
                            label: lab,
                            text: String(o.datis),
                            time: o.time || '',
                            updatedAt: o.updatedAt || ''
                        });
                    }
                }
                cb(out.length ? out : null);
            } catch (e) {
                cb(null);
            }
        });
    }

    /** NOAA HRRR (CONUS) hourly via Open-Meteo GFS+HRRR blend. */
    function fetchHrrrHourlyForecast(lat, lon, cb) {
        var url =
            'https://api.open-meteo.com/v1/gfs?latitude=' +
            encodeURIComponent(lat) +
            '&longitude=' +
            encodeURIComponent(lon) +
            '&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m' +
            '&forecast_hours=36&temperature_unit=fahrenheit&wind_speed_unit=mph';
        fetchText(url, function (txt) {
            if (!txt) {
                cb(null);
                return;
            }
            try {
                var j = JSON.parse(txt);
                var h = j.hourly;
                if (!h || !h.time || !h.time.length) {
                    cb(null);
                    return;
                }
                cb({
                    times: h.time,
                    tempF: h.temperature_2m || [],
                    pop: h.precipitation_probability || [],
                    wcode: h.weather_code || [],
                    wspd: h.wind_speed_10m || [],
                    wdir: h.wind_direction_10m || [],
                    unitTemp: (j.hourly_units && j.hourly_units.temperature_2m) || '°F',
                    unitWind: (j.hourly_units && j.hourly_units.wind_speed_10m) || 'mph'
                });
            } catch (e) {
                cb(null);
            }
        });
    }

    function mergeDetailExtras(icao, iata, datis, hrrr) {
        var cur = cacheByIcao[icao];
        if (!cur || cur.icao !== icao) {
            return;
        }
        cur.datisEntries = datis;
        cur.hrrrHourly = hrrr;
        cacheByIcao[icao] = cur;
        if (modal && modal.style.display === 'flex' && selectedIata === iata) {
            renderDetail(selectedIata);
        }
    }

    function patchDetailExtras(icao, iata) {
        if (!icao || !iata) {
            return;
        }
        fetchJson('https://api.weather.gov/stations/' + encodeURIComponent(icao), function (st) {
            fetchDatisForIcao(icao, function (datis) {
                if (!st || !st.geometry || !st.geometry.coordinates) {
                    mergeDetailExtras(icao, iata, datis, null);
                    return;
                }
                var coords = st.geometry.coordinates;
                var lon = coords[0];
                var lat = coords[1];
                if (typeof lat !== 'number' || typeof lon !== 'number') {
                    mergeDetailExtras(icao, iata, datis, null);
                    return;
                }
                fetchHrrrHourlyForecast(lat, lon, function (hrrr) {
                    mergeDetailExtras(icao, iata, datis, hrrr);
                });
            });
        });
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

    /**
     * FAA RVR Status table from rvr.data.faa.gov (3-letter airport id).
     * Returns null if page unavailable or no runway table.
     */
    function parseFaaRvrHtml(html) {
        if (!html || typeof html !== 'string') {
            return null;
        }
        if (/We're sorry|currently down|site is currently down/i.test(html)) {
            return null;
        }
        var timeUtc = '';
        var mTime = html.match(/<th[^>]*>\s*(\d{1,2}:\d{2}:\d{2}z)\s*<\/th>/i);
        if (mTime) {
            timeUtc = mTime[1];
        }
        var rows = [];
        var trRe = /<tr[^>]*>\s*<th[^>]*>\s*([^<]*?)\s*<\/th>\s*([\s\S]*?)<\/tr>/gi;
        var trm;
        while ((trm = trRe.exec(html)) !== null) {
            var rwyRaw = String(trm[1] || '')
                .replace(/&nbsp;/gi, ' ')
                .replace(/\s+/g, '')
                .trim();
            if (!rwyRaw || /^RWY$/i.test(rwyRaw)) {
                continue;
            }
            if (!/^\d{1,2}[LRC]?$/i.test(rwyRaw) && !/^\d{1,2}\s?$/.test(rwyRaw)) {
                continue;
            }
            var inner = trm[2] || '';
            var cells = [];
            var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
            var tdm;
            while ((tdm = tdRe.exec(inner)) !== null) {
                var cell = String(tdm[1] || '')
                    .replace(/<[^>]+>/g, '')
                    .replace(/&nbsp;/gi, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                cells.push(cell);
            }
            if (cells.length >= 3) {
                rows.push({
                    rwy: rwyRaw,
                    td: cells[0],
                    mp: cells[1],
                    ro: cells[2],
                    e: cells[3] !== undefined ? cells[3] : '',
                    c: cells[4] !== undefined ? cells[4] : ''
                });
            }
        }
        if (!rows.length) {
            if (/Data Not Available/i.test(html)) {
                return { rows: [], updatedUtc: timeUtc, empty: true };
            }
            return null;
        }
        return { rows: rows, updatedUtc: timeUtc, empty: false };
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

    function fetchWeatherForIata(iata, cb, opts) {
        opts = opts || {};
        var deferEnrichment = opts.deferEnrichment === true;

        var icao = icaoFor(iata);
        if (!icao) {
            cb({
                iata: iata.toUpperCase(),
                icao: null,
                metar: 'No ICAO mapping',
                metarLines: [],
                taf: '',
                rvrFaa: null,
                datisEntries: null,
                hrrrHourly: null,
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
        var rvrDone = false;
        var rvrParsed = null;
        var noaaMetarStarted = false;
        var taf = 'N/A';
        var metarLines = [];
        var metar = 'N/A';

        function buildRecFromEnr(enr) {
            var radarGifUrl = '';
            var afdText = '';
            var afdMeta = null;
            if (enr) {
                radarGifUrl = enr.radarGifUrl || '';
                afdText = enr.afdText || '';
                afdMeta = enr.afdMeta || null;
            }
            return {
                iata: iata.toUpperCase(),
                icao: icao,
                metar: metar,
                metarLines: metarLines.slice(),
                taf: taf,
                rvrFaa: rvrParsed,
                datisEntries: null,
                hrrrHourly: null,
                radarGifUrl: radarGifUrl,
                afdText: afdText,
                afdMeta: afdMeta,
                err: false,
                t: Date.now()
            };
        }

        function finalizeRecord() {
            if (deferEnrichment) {
                var recFast = buildRecFromEnr(null);
                cacheByIcao[icao] = recFast;
                cb(recFast);
                fetchNwsEnrichmentCached(icao, false, function (enr) {
                    var cur = cacheByIcao[icao];
                    if (!cur || cur.icao !== icao) {
                        return;
                    }
                    if (enr) {
                        cur.radarGifUrl = enr.radarGifUrl || '';
                        cur.afdText = enr.afdText || '';
                        cur.afdMeta = enr.afdMeta || null;
                    }
                    cacheByIcao[icao] = cur;
                    if (modal && modal.style.display === 'flex' && selectedIata === iata) {
                        renderDetail(selectedIata);
                    }
                });
                patchDetailExtras(icao, iata);
                return;
            }
            fetchNwsEnrichmentCached(icao, false, function (enr) {
                var rec = buildRecFromEnr(enr);
                cacheByIcao[icao] = rec;
                cb(rec);
                patchDetailExtras(icao, iata);
            });
        }

        function tryComplete() {
            if (!tafDone || !awDone || !rvrDone) {
                return;
            }
            if (metarLines.length) {
                metar = metarLines[0];
                finalizeRecord();
                return;
            }
            if (noaaMetarStarted) {
                return;
            }
            noaaMetarStarted = true;
            fetchText(noaaMetarURL, function (mt) {
                metar = parseMetarBody(mt);
                metarLines = metar !== 'N/A' ? [metar] : [];
                finalizeRecord();
            });
        }

        var faaRvrURL = faaRvrUrlForIata(iata, false);
        fetchText(faaRvrURL, function (html) {
            rvrParsed = parseFaaRvrHtml(html);
            rvrDone = true;
            tryComplete();
        });

        fetchText(tafURL, function (tt) {
            taf = parseTafBody(tt);
            tafDone = true;
            tryComplete();
        });
        fetchText(awMetarURL, function (raw) {
            metarLines = parseLastMetarsRaw(raw, 3);
            if (metarLines.length) {
                metar = metarLines[0];
            }
            awDone = true;
            tryComplete();
        });
    }

    function fetchAllStations(list, done, onProgress) {
        if (!list || !list.length) {
            done([]);
            return;
        }
        var concurrency = numPref('metarWatchConcurrentStations', 10, 1, 20);
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
        if (alertsPrimed) {
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

    function refreshRvrOnly() {
        if (!selectedIata) {
            return;
        }
        var icao = icaoFor(selectedIata);
        if (!icao) {
            return;
        }
        setStatusBar('Refreshing RVR ' + stationListLabel(selectedIata) + '…');
        fetchText(faaRvrUrlForIata(selectedIata, true), function (html) {
            var parsed = parseFaaRvrHtml(html);
            var cur = cacheByIcao[icao];
            if (!cur) {
                return;
            }
            cur.rvrFaa = parsed;
            cacheByIcao[icao] = cur;
            if (selectedIata) {
                renderDetail(selectedIata);
                setStatusBar('RVR updated · ' + stationListLabel(selectedIata) + ' · ' + new Date().toLocaleTimeString());
            }
        });
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

    /** Mark one airport as viewed (METAR/TAF snapshot + clear its pending highlight). */
    function markStationViewed(iata) {
        var icao = icaoFor(iata);
        if (!icao || !cacheByIcao[icao]) {
            return;
        }
        var r = cacheByIcao[icao];
        viewedSnapshot[icao] = { metar: r.metar, taf: r.taf };
        saveViewedSnapshot(viewedSnapshot);
        delete pendingChangeTime[iata];
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
            if (selectedIata) {
                markStationViewed(selectedIata);
            }
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
                    markStationViewed(iata);
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
                    markStationViewed(iata);
                    renderDetail(iata);
                }
            });
            return;
        }
        var unseen = metarTafUnseenVersusViewed(iata, r);
        var metarTitleStyle =
            'font-weight:600;margin-bottom:6px;color:#3498db;' + detailTitleHighlightStyle(iata, unseen.metar);
        var tafTitleStyle =
            'font-weight:600;margin-bottom:8px;color:#3498db;' + detailTitleHighlightStyle(iata, unseen.taf);
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
        var rvr = r.rvrFaa;
        var rvrTable = rvr && rvr.rows && rvr.rows.length ? buildFaaRvrTableHtml(rvr, iata) : '';
        var tafRvrRow = '';
        if (rvrTable) {
            tafRvrRow =
                '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:stretch;margin-bottom:16px;">' +
                '<div style="flex:2 1 320px;min-width:0;">' +
                '<div style="' +
                tafTitleStyle +
                '">TAF' +
                (unseen.taf ? ' <span style="font-weight:600;font-size:11px;color:#f1c40f;">NEW</span>' : '') +
                '</div>' +
                '<div style="white-space:pre-wrap;word-break:break-word;">' +
                t +
                '</div></div>' +
                '<div style="flex:1 1 200px;min-width:0;max-width:min(240px,100%);">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
                '<div style="font-weight:600;color:#3498db;">RVR <span style="font-weight:400;color:#95a5a6;font-size:11px;">(FAA)</span></div>' +
                '<button type="button" data-dc-rvr-refresh="1" style="padding:4px 10px;font-size:11px;border-radius:4px;border:1px solid #444;background:#2a2a32;color:#ecf0f1;cursor:pointer;">Refresh RVR</button>' +
                '</div>' +
                '<div style="overflow:auto;max-height:min(48vh,520px);background:#141418;padding:10px;border-radius:6px;">' +
                rvrTable +
                '</div></div></div>';
        } else {
            tafRvrRow =
                '<div style="' +
                tafTitleStyle +
                '">TAF' +
                (unseen.taf ? ' <span style="font-weight:600;font-size:11px;color:#f1c40f;">NEW</span>' : '') +
                '</div>' +
                '<div style="white-space:pre-wrap;word-break:break-word;margin-bottom:16px;">' +
                t +
                '</div>';
        }
        var datisBlock = buildDatisBlockHtml(r.datisEntries);
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
        var hrrrBlock = buildHrrrTableHtml(r.hrrrHourly);
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
            '<div style="' +
            metarTitleStyle +
            '">METAR <span style="font-weight:400;color:#95a5a6;font-size:11px;">(last 3 when available)</span>' +
            (unseen.metar ? ' <span style="font-weight:600;font-size:11px;color:#f1c40f;">NEW</span>' : '') +
            '</div>' +
            '<div style="margin-bottom:12px;">' +
            mBlocks +
            '</div>' +
            tafRvrRow +
            datisBlock +
            radarBlock +
            hrrrBlock +
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
                    markStationViewed(selectedIata);
                }
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
            setStatusBar('Loading ' + stationListLabel(code) + '…');
            fetchWeatherForIata(
                code,
                function () {
                    markStationViewed(code);
                    renderStationList();
                    if (selectedIata === code) {
                        renderDetail(code);
                    }
                    updateRefreshThisLabel();
                    updateAlertState();
                    setStatusBar(stationListLabel(code) + ' · added · ' + new Date().toLocaleTimeString());
                },
                { deferEnrichment: true }
            );
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
        detailEl.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.getAttribute) {
                return;
            }
            if (t.getAttribute('data-dc-rvr-refresh') === '1') {
                e.preventDefault();
                refreshRvrOnly();
            }
        });

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
