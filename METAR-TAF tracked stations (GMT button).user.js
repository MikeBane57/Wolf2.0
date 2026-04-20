// ==UserScript==
// @name         METAR/TAF tracked stations (GMT button)
// @namespace    Wolf 2.0
// @version      2.0.22
// @description  Button near GMT clock: METAR/TAF, D-ATIS, RVR, radar, hourly chart (NOAA or Open-Meteo), COD loop (cached), cross-tab poll + alert/view sync, collapsible AFD
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      tgftp.nws.noaa.gov
// @connect      aviationweather.gov
// @connect      api.weather.gov
// @connect      radar.weather.gov
// @connect      rvr.data.faa.gov
// @connect      atis.info
// @connect      api.open-meteo.com
// @connect      weather.cod.edu
// @donkeycode-pref {"metarWatchPollMinutes":{"type":"number","group":"METAR watch","label":"Poll every (minutes)","description":"How often to refresh METAR/TAF in the background.","default":5,"min":1,"max":120,"step":1},"metarWatchConcurrentStations":{"type":"number","group":"METAR watch","label":"Parallel station fetches","description":"How many airports to load at the same time (higher = faster refresh, more concurrent requests).","default":10,"min":1,"max":20,"step":1},"metarWatchNotify":{"type":"boolean","group":"METAR watch","label":"Browser notifications","description":"Notify when METAR/TAF changes for a tracked station since you last opened the modal.","default":true},"metarWatchDefaultStations":{"type":"string","group":"METAR watch","label":"Default stations (IATA)","description":"Comma-separated list used until you customize the list (same region as SW tooltip defaults).","default":"ATL,MDW,BWI,OAK,TPA,MCO,DAL,MKE,LAS,PHX,DEN,LAX,SAN,FLL,HOU"},"metarWatchShowRvr":{"type":"boolean","group":"METAR watch · panels","label":"Show FAA RVR","description":"Runway visual range. Turn off to hide the panel and stop FAA RVR requests.","default":true},"metarWatchFetchRvrInPoll":{"type":"boolean","group":"METAR watch · panels","label":"Fetch RVR during background poll","description":"When off (recommended if rvr.data.faa.gov blocks you), RVR loads only when the modal is open or you tap Refresh RVR.","default":false},"metarWatchShowDatis":{"type":"boolean","group":"METAR watch · panels","label":"Show Digital ATIS","description":"D-ATIS block (atis.info).","default":true},"metarWatchShowRadar":{"type":"boolean","group":"METAR watch · panels","label":"Show NWS radar loop","description":"Radar GIF from the nearest NWS site.","default":true},"metarWatchShowHrrr":{"type":"boolean","group":"METAR watch · panels","label":"Show hourly chart","description":"Temperature + PoP bars (source chosen below).","default":true},"metarWatchHrrrHourlySource":{"type":"select","group":"METAR watch · panels","label":"Hourly chart data source","description":"NOAA uses api.weather.gov grid hourly forecast at the airport. Open-Meteo uses a GFS blend (not pure HRRR).","default":"noaa","options":[{"value":"noaa","label":"NOAA (weather.gov hourly)"},{"value":"openmeteo","label":"Open-Meteo (GFS blend)"}]},"metarWatchShowAfd":{"type":"boolean","group":"METAR watch · panels","label":"Show Area Forecast Discussion","description":"AFD text from weather.gov for the airport WFO.","default":true},"metarWatchShowCodModelLoop":{"type":"boolean","group":"METAR watch · panels","label":"College of DuPage model loop","description":"Animated PNG loop from weather.cod.edu NEXLAB (public API). Default parms = RAP CONUS simulated reflectivity.","default":true},"metarWatchCodAutoSector":{"type":"boolean","group":"METAR watch · panels","label":"COD loop: auto region","description":"Pick nearest NEXLAB sector from airport lat/lon (HRRR). Turn off to use manual parms below.","default":true},"metarWatchCodLoopModel":{"type":"select","group":"METAR watch · panels","label":"COD loop model","description":"Used with auto region.","default":"HRRR","options":[{"value":"HRRR","label":"HRRR"},{"value":"RAP","label":"RAP"}]},"metarWatchCodModelParms":{"type":"string","group":"METAR watch · panels","label":"COD loop parms (manual)","description":"When auto region is off: full dash parms for get-files.php, e.g. current-HRRR-MW-prec-radar-1-0-100","default":"current-HRRR-MW-prec-radar-1-0-100"},"metarWatchCodLoopLoadTrigger":{"type":"select","group":"METAR watch · panels","label":"COD loop: when to load","description":"On station: fetch frames when you select an airport (no reload on 15s list refresh). Manual: only after you click Load (fastest modal).","default":"on_station","options":[{"value":"on_station","label":"When viewing a station"},{"value":"manual","label":"Manual (Load button)"}]},"metarWatchCodCachePollMinutes":{"type":"number","group":"METAR watch · panels","label":"COD cache: check new run (min)","description":"0 = only when you load the loop. Otherwise periodic JSON check; images re-download only when COD serves a new run.","default":3,"min":0,"max":60,"step":1},"metarWatchSharedPoll":{"type":"boolean","group":"METAR watch","label":"Share poll across tabs","description":"One browser tab leads background METAR/TAF polls and broadcasts results to other Ops Suite tabs; reduces duplicate API traffic. Best with the same station list in each tab.","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/METAR-TAF%20tracked%20stations%20(GMT%20button).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/METAR-TAF%20tracked%20stations%20(GMT%20button).user.js
// ==/UserScript==

(function () {
    'use strict';

    var STORAGE_STATIONS = 'dc-metar-watch-stations-v1';
    var STORAGE_VIEWED = 'dc-metar-watch-viewed-snapshot-v1';
    /** Per-airport METAR/TAF text last acknowledged in the modal detail (NEW badges / title tint). Separate from viewedSnapshot, which is also used for first-poll alert baseline. */
    var STORAGE_DETAIL_SEEN = 'dc-metar-watch-detail-seen-v1';
    var STORAGE_SORT = 'dc-metar-watch-sort-v1';
    var LS_POLL_LEADER = 'dc-metar-watch-poll-leader-v1';
    var BC_POLL_NAME = 'dc-metar-watch-poll-sync';
    /** Shared METAR/TAF text (tgftp-equivalent) for SW tooltip + METAR watch — same origin localStorage + BroadcastChannel. */
    var LS_METAR_TAF_SHARED = 'dc-metar-taf-shared-v1';
    var BC_METAR_TAF_SHARED = 'dc-metar-taf-shared';
    var BC_VIEWED_SYNC = 'dc-metar-watch-viewed-sync';
    var LS_NOTIFY_DEDUPE = 'dc-metar-watch-notify-dedupe-v1';
    var SHARED_METAR_TAF_TTL_MS = 8 * 60 * 1000;
    var metarTafSharedChannel = null;
    var viewedSyncChannel = null;
    var onStorageMetarTaf = null;
    var onStorageViewedSync = null;
    var tabInstanceId = 't' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
    var pollBroadcastChannel = null;
    var leaderHeartbeatTimer = null;
    var leaderElectTimer = null;
    var onStorageLeader = null;
    var onPageHidePoll = null;

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

    function sharedPollEnabled() {
        return boolPref('metarWatchSharedPoll', true);
    }

    function readPollLeaderRecord() {
        try {
            var raw = localStorage.getItem(LS_POLL_LEADER);
            if (!raw) {
                return null;
            }
            var o = JSON.parse(raw);
            if (!o || typeof o.tabId !== 'string' || typeof o.ts !== 'number') {
                return null;
            }
            return o;
        } catch (e) {
            return null;
        }
    }

    function isPollLeaderTab() {
        if (!sharedPollEnabled()) {
            return true;
        }
        var o = readPollLeaderRecord();
        var now = Date.now();
        if (!o || now - o.ts > 8000) {
            return true;
        }
        return o.tabId === tabInstanceId;
    }

    function writePollLeaderHeartbeat() {
        if (!sharedPollEnabled()) {
            return;
        }
        try {
            var o = readPollLeaderRecord();
            var now = Date.now();
            if (!o || now - o.ts > 8000 || o.tabId === tabInstanceId) {
                localStorage.setItem(LS_POLL_LEADER, JSON.stringify({ tabId: tabInstanceId, ts: now }));
            }
        } catch (e) {}
    }

    function tryClaimPollLeadership() {
        if (!sharedPollEnabled()) {
            return;
        }
        var o = readPollLeaderRecord();
        var now = Date.now();
        if (!o || now - o.ts > 8000) {
            try {
                localStorage.setItem(LS_POLL_LEADER, JSON.stringify({ tabId: tabInstanceId, ts: now }));
            } catch (e) {}
        }
    }

    function releasePollLeadership() {
        try {
            var o = readPollLeaderRecord();
            if (o && o.tabId === tabInstanceId) {
                localStorage.removeItem(LS_POLL_LEADER);
            }
        } catch (e) {}
    }

    function broadcastPollResults(results) {
        if (!sharedPollEnabled() || !results || !pollBroadcastChannel) {
            return;
        }
        try {
            pollBroadcastChannel.postMessage({
                type: 'poll-results',
                tabId: tabInstanceId,
                results: results,
                stationSig: stationList.slice().sort().join(',')
            });
        } catch (e) {}
    }

    function applySharedPollResults(results, remoteSig) {
        if (!results || !results.length) {
            return;
        }
        var localSig = stationList.slice().sort().join(',');
        var i;
        for (i = 0; i < results.length; i++) {
            var r = results[i];
            if (r && r.icao) {
                cacheByIcao[r.icao] = r;
                publishMetarTafShared(r.icao, r.metar, r.taf);
            }
        }
        primeAlertsBaseline(results);
        updateAlertState();
        if (remoteSig && remoteSig !== localSig) {
            var got = {};
            for (i = 0; i < results.length; i++) {
                if (results[i] && results[i].icao) {
                    got[results[i].icao] = true;
                }
            }
            var sj;
            for (sj = 0; sj < stationList.length; sj++) {
                var iata = stationList[sj];
                var ic = icaoFor(iata);
                if (ic && !got[ic]) {
                    fetchWeatherForIata(iata, function () {
                        renderStationList();
                        if (selectedIata) {
                            renderDetail(selectedIata, { skipCodLoop: true });
                        }
                        updateAlertState();
                    });
                }
            }
        }
        if (modal && modal.style.display === 'flex' && selectedIata) {
            renderDetail(selectedIata, { skipCodLoop: true });
            renderStationList();
            setStatusBar('Updated from another tab · ' + new Date().toLocaleTimeString());
        } else {
            renderStationList();
        }
    }

    function initCrossTabPollSync() {
        if (!sharedPollEnabled()) {
            return;
        }
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                pollBroadcastChannel = new BroadcastChannel(BC_POLL_NAME);
                pollBroadcastChannel.onmessage = function (ev) {
                    var d = ev && ev.data;
                    if (!d || d.type !== 'poll-results' || !d.results) {
                        return;
                    }
                    if (d.tabId === tabInstanceId) {
                        return;
                    }
                    applySharedPollResults(d.results, d.stationSig);
                };
            } catch (e) {
                pollBroadcastChannel = null;
            }
        }
        tryClaimPollLeadership();
        leaderHeartbeatTimer = setInterval(function () {
            if (isPollLeaderTab()) {
                writePollLeaderHeartbeat();
            }
        }, 2000);
        leaderElectTimer = setInterval(function () {
            tryClaimPollLeadership();
        }, 4000);
        onStorageLeader = function (e) {
            if (e && e.key === LS_POLL_LEADER) {
                tryClaimPollLeadership();
            }
        };
        window.addEventListener('storage', onStorageLeader);
        onPageHidePoll = function () {
            releasePollLeadership();
        };
        window.addEventListener('pagehide', onPageHidePoll);
    }

    function stopCrossTabPollSync() {
        if (onPageHidePoll) {
            window.removeEventListener('pagehide', onPageHidePoll);
            onPageHidePoll = null;
        }
        if (leaderHeartbeatTimer) {
            clearInterval(leaderHeartbeatTimer);
            leaderHeartbeatTimer = null;
        }
        if (leaderElectTimer) {
            clearInterval(leaderElectTimer);
            leaderElectTimer = null;
        }
        if (onStorageLeader) {
            window.removeEventListener('storage', onStorageLeader);
            onStorageLeader = null;
        }
        if (pollBroadcastChannel) {
            try {
                pollBroadcastChannel.close();
            } catch (e) {}
            pollBroadcastChannel = null;
        }
        releasePollLeadership();
    }

    function readSharedMetarTafStore() {
        try {
            var raw = localStorage.getItem(LS_METAR_TAF_SHARED);
            if (!raw) {
                return {};
            }
            var o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : {};
        } catch (e) {
            return {};
        }
    }

    function writeSharedMetarTafEntry(icao, metar, taf) {
        if (!icao) {
            return;
        }
        var store = readSharedMetarTafStore();
        store[icao] = { metar: String(metar || ''), taf: String(taf || ''), t: Date.now() };
        try {
            localStorage.setItem(LS_METAR_TAF_SHARED, JSON.stringify(store));
        } catch (e) {}
    }

    function broadcastSharedMetarTaf(icao, metar, taf) {
        if (!metarTafSharedChannel) {
            return;
        }
        try {
            metarTafSharedChannel.postMessage({
                type: 'metar-taf',
                icao: icao,
                metar: metar,
                taf: taf,
                t: Date.now()
            });
        } catch (e) {}
    }

    function publishMetarTafShared(icao, metar, taf) {
        if (!icao) {
            return;
        }
        writeSharedMetarTafEntry(icao, metar, taf);
        broadcastSharedMetarTaf(icao, metar, taf);
    }

    /**
     * FAA RVR: optional. Background poll skips RVR unless "Fetch RVR during background poll".
     * With modal open, only the selected row hits rvr.data.faa.gov (avoids N requests per open).
     * forceFetchRvr: refresh-all loads RVR for every station.
     */
    function shouldFetchFaaRvr(opts) {
        opts = opts || {};
        if (!boolPref('metarWatchShowRvr', true)) {
            return false;
        }
        if (opts.forceFetchRvr === true || opts.fetchRvrNow === true) {
            return true;
        }
        if (boolPref('metarWatchFetchRvrInPoll', false)) {
            return true;
        }
        try {
            if (modal && modal.style.display === 'flex' && opts.iataForFetch && selectedIata) {
                return opts.iataForFetch.toUpperCase() === selectedIata.toUpperCase();
            }
        } catch (e) {}
        return false;
    }

    function showRadarPanel() {
        return boolPref('metarWatchShowRadar', true);
    }

    function showAfdPanel() {
        return boolPref('metarWatchShowAfd', true);
    }

    function needNwsEnrichmentFetch() {
        return showRadarPanel() || showAfdPanel();
    }

    function showDatisPanel() {
        return boolPref('metarWatchShowDatis', true);
    }

    function showHrrrPanel() {
        return boolPref('metarWatchShowHrrr', true);
    }

    /** Hourly temp/PoP chart: NOAA grid (default) vs Open-Meteo GFS blend. */
    function hrrrHourlySource() {
        var v = String(getPref('metarWatchHrrrHourlySource', 'noaa') || 'noaa').toLowerCase();
        if (v === 'openmeteo' || v === 'open-meteo') {
            return 'openmeteo';
        }
        return 'noaa';
    }

    function showCodModelLoopPanel() {
        return boolPref('metarWatchShowCodModelLoop', true);
    }

    /** `on_station`: load when you select an airport (not on 15s highlight refresh). `manual`: Load button only. */
    function codLoopLoadTrigger() {
        var v = String(getPref('metarWatchCodLoopLoadTrigger', 'on_station') || 'on_station').toLowerCase();
        return v === 'manual' ? 'manual' : 'on_station';
    }

    function codAutoSectorPref() {
        return boolPref('metarWatchCodAutoSector', true);
    }

    function codLoopModelPref() {
        var v = String(getPref('metarWatchCodLoopModel', 'HRRR') || 'HRRR').toUpperCase();
        return v === 'RAP' ? 'RAP' : 'HRRR';
    }

    /** Manual COD get-files.php parms when auto region is off. */
    function codModelParmsManual() {
        var d = 'current-HRRR-MW-prec-radar-1-0-100';
        var r = String(getPref('metarWatchCodModelParms', d) || d).trim();
        if (!r) {
            return d;
        }
        return r.replace(/[^a-zA-Z0-9._-]/g, '');
    }

    /**
     * NEXLAB sector bounding boxes [minLon, minLat, maxLon, maxLat] (College of DuPage).
     * Used to pick nearest regional sector from airport coordinates.
     */
    var COD_SECTOR_BB = {
        US: [-128, 20, -65, 57],
        NA: [-165, 8.5, -48, 78],
        NE: [-84.1, 38.7, -66, 49.3],
        MA: [-90.5, 31.6, -69.5, 44],
        SE: [-98.5, 24.5, -77.5, 36.92],
        NGP: [-110.4, 41.7, -89.2, 54.1],
        GL: [-95.5, 39.58, -74.5, 52.0],
        NIL: [-93.98, 38.13, -83.9, 44.05],
        MW: [-101, 34.55, -80, 47],
        CGP: [-111.7, 34.5, -90.5, 47],
        SGP: [-109, 25.5, -85, 39.7],
        NW: [-126.8, 40.3, -105.5, 52.9],
        GBSN: [-129.5, 31.9, -106.5, 45.5],
        SW: [-123.1, 29.9, -101.7, 42.5],
        DEN: [-106, 38.8, -101, 42.05],
        OKC: [-102.5, 33.2, -94, 38.2],
        CHI: [-93, 39.5, -86, 43.6],
        DPG: [-114.8, 38.7, -108.8, 42.2]
    };

    var COD_SECTORS_BY_MODEL = {
        HRRR: ['DEN', 'OKC', 'CHI', 'NIL', 'MW', 'CGP', 'SGP', 'SE', 'MA', 'NE', 'NGP', 'GL', 'NW', 'GBSN', 'SW', 'US'],
        RAP: ['DEN', 'OKC', 'CHI', 'NIL', 'MW', 'CGP', 'SGP', 'SE', 'MA', 'NE', 'NGP', 'GL', 'NW', 'GBSN', 'SW', 'US', 'NA']
    };

    function codSectorCenter(bb) {
        if (!bb || bb.length < 4) {
            return null;
        }
        return { lat: (bb[1] + bb[3]) / 2, lon: (bb[0] + bb[2]) / 2 };
    }

    function codDist2(lat, lon, c) {
        var dlat = lat - c.lat;
        var dlon = lon - c.lon;
        return dlat * dlat + dlon * dlon;
    }

    /**
     * Closest NEXLAB sector to (lat,lon) by distance to sector center.
     * Bounding boxes are approximate; previously airports in gaps (e.g. ATL vs SE/MW) fell through to CONUS.
     */
    function codPickSectorForLatLon(lat, lon, model) {
        var mod = model === 'RAP' ? 'RAP' : 'HRRR';
        var list = COD_SECTORS_BY_MODEL[mod] || COD_SECTORS_BY_MODEL.HRRR;
        var bestRegional = 'US';
        var bestDRegional = Infinity;
        var bestConus = 'US';
        var bestDConus = Infinity;
        var bi;
        for (bi = 0; bi < list.length; bi++) {
            var id = list[bi];
            var bb = COD_SECTOR_BB[id];
            if (!bb) {
                continue;
            }
            var cen = codSectorCenter(bb);
            if (!cen) {
                continue;
            }
            var d = codDist2(lat, lon, cen);
            if (id === 'US' || id === 'NA') {
                if (d < bestDConus) {
                    bestDConus = d;
                    bestConus = id;
                }
                continue;
            }
            if (d < bestDRegional) {
                bestDRegional = d;
                bestRegional = id;
            }
        }
        return bestDRegional < Infinity ? bestRegional : bestConus;
    }

    function codBuildParms(model, sector) {
        return 'current-' + model + '-' + sector + '-prec-radar-1-0-100';
    }

    var COD_BASE = 'https://weather.cod.edu/forecast';
    var codLoopTimer = null;
    var codLoopGen = 0;
    /** JSON poll only (light); full image fetch when run fingerprint changes. */
    var codCacheCheckTimer = null;
    /** parms string → { runKey, blobUrls: string[], fileUrls: string[] } */
    var codCacheByParms = {};
    var codDisplayedParms = null;

    function codCachePollMs() {
        return numPref('metarWatchCodCachePollMinutes', 3, 0, 60) * 60 * 1000;
    }

    function codRunFingerprint(fileUrls) {
        if (!fileUrls || !fileUrls.length) {
            return '';
        }
        var n = fileUrls.length;
        var first = String(fileUrls[0] || '');
        var last = String(fileUrls[n - 1] || '');
        return n + '|' + first + '|' + last;
    }

    function codRevokeCacheEntry(parms) {
        var ent = codCacheByParms[parms];
        if (!ent || !ent.blobUrls) {
            return;
        }
        var i;
        for (i = 0; i < ent.blobUrls.length; i++) {
            try {
                if (ent.blobUrls[i] && String(ent.blobUrls[i]).indexOf('blob:') === 0) {
                    URL.revokeObjectURL(ent.blobUrls[i]);
                }
            } catch (e) {}
        }
        delete codCacheByParms[parms];
    }

    function codClearCachePoll() {
        if (codCacheCheckTimer) {
            clearInterval(codCacheCheckTimer);
            codCacheCheckTimer = null;
        }
    }

    function codFetchImageBlobUrl(httpUrl, cb) {
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: httpUrl,
                responseType: 'arraybuffer',
                onload: function (resp) {
                    var buf = resp.response;
                    if (!buf) {
                        cb(null);
                        return;
                    }
                    try {
                        var blob = new Blob([buf], { type: 'image/png' });
                        cb(URL.createObjectURL(blob));
                    } catch (e) {
                        cb(null);
                    }
                },
                onerror: function () {
                    cb(null);
                },
                ontimeout: function () {
                    cb(null);
                }
            });
            return;
        }
        if (typeof fetch === 'function') {
            fetch(httpUrl, { credentials: 'omit', cache: 'no-store', mode: 'cors' })
                .then(function (r) {
                    return r.blob();
                })
                .then(function (blob) {
                    cb(URL.createObjectURL(blob));
                })
                .catch(function () {
                    cb(null);
                });
            return;
        }
        cb(null);
    }

    /**
     * Download all frames into blob URLs and replace cache for this product.
     * Sequential to avoid hammering COD.
     */
    function codFillCacheFromHttpFiles(parms, fileUrls, cb) {
        if (!fileUrls || !fileUrls.length) {
            cb(false);
            return;
        }
        var runKey = codRunFingerprint(fileUrls);
        var existing = codCacheByParms[parms];
        if (existing && existing.runKey === runKey && existing.blobUrls && existing.blobUrls.length === fileUrls.length) {
            cb(true);
            return;
        }
        codRevokeCacheEntry(parms);
        var blobUrls = [];
        var idx = 0;
        function next() {
            if (idx >= fileUrls.length) {
                codCacheByParms[parms] = {
                    runKey: runKey,
                    fileUrls: fileUrls.slice(),
                    blobUrls: blobUrls
                };
                cb(true);
                return;
            }
            codFetchImageBlobUrl(fileUrls[idx], function (u) {
                if (!u) {
                    codRevokeCacheEntry(parms);
                    var bi;
                    for (bi = 0; bi < blobUrls.length; bi++) {
                        try {
                            URL.revokeObjectURL(blobUrls[bi]);
                        } catch (e2) {}
                    }
                    cb(false);
                    return;
                }
                blobUrls.push(u);
                idx++;
                next();
            });
        }
        next();
    }

    function codMetaHtmlLine(parms, tag, sub, cacheNote) {
        var note = cacheNote ? ' · <span style="color:#7f8c8d;">' + escapeHtml(cacheNote) + '</span>' : '';
        return (
            'Parms: <code style="color:#bdc3c7;">' +
            escapeHtml(parms) +
            '</code> · Region: <code style="color:#bdc3c7;">' +
            escapeHtml(String(tag)) +
            '</code> · ' +
            escapeHtml(sub) +
            ' · <a href="' +
            escapeHtml(COD_BASE + '/') +
            '" target="_blank" rel="noopener noreferrer" style="color:#5dade2;">NEXLAB</a>' +
            note
        );
    }

    /**
     * Start double-buffered loop; urls may be https: or blob: (cached).
     * cacheNote e.g. "ready (cached)" or empty after fresh download into cache.
     */
    function codStartLoopFromUrls(urls, myGen, parms, tag, sub, cacheNote) {
        if (!urls || !urls.length || !codLoopImgA || !codLoopImgB || !codLoopWrapEl) {
            return;
        }
        var subTxt =
            typeof sub === 'string'
                ? sub
                : Array.isArray(sub) && sub.length >= 3
                  ? String(sub[1]) + ' · ' + String(sub[2]) + ' · simulated reflectivity'
                  : 'COD NEXLAB';
        if (codLoopMetaEl) {
            codLoopMetaEl.innerHTML = codMetaHtmlLine(parms, tag, subTxt, cacheNote || '');
        }
        codLoopWrapEl.style.visibility = 'hidden';
        codLoopWrapEl.style.minHeight = '200px';
        codLoopImgA.removeAttribute('src');
        codLoopImgB.removeAttribute('src');
        codLoopImgA.style.opacity = '0';
        codLoopImgB.style.opacity = '0';
        var first = new Image();
        first.onload = function () {
            if (myGen !== codLoopGen) {
                return;
            }
            codLoopImgA.src = urls[0];
            codLoopImgA.style.opacity = '1';
            codLoopImgA.style.zIndex = '2';
            codLoopImgB.style.opacity = '0';
            codLoopImgB.style.zIndex = '1';
            codLoopWrapEl.style.visibility = 'visible';
            codLoopWrapEl.style.minHeight = '';
            setCodLoadButtonState(false);
            if (codLoadBtn) {
                codLoadBtn.style.display = 'none';
            }
            var idx = 0;
            var showA = true;
            codLoopTimer = setInterval(function () {
                if (myGen !== codLoopGen) {
                    return;
                }
                idx = (idx + 1) % urls.length;
                var nextUrl = urls[idx];
                var front = showA ? codLoopImgA : codLoopImgB;
                var back = showA ? codLoopImgB : codLoopImgA;
                back.onload = function () {
                    if (myGen !== codLoopGen) {
                        return;
                    }
                    back.style.opacity = '1';
                    back.style.zIndex = '2';
                    front.style.opacity = '0';
                    front.style.zIndex = '1';
                    showA = !showA;
                };
                back.src = nextUrl;
            }, 700);
        };
        first.onerror = function () {
            if (myGen !== codLoopGen) {
                return;
            }
            if (codLoopMetaEl) {
                codLoopMetaEl.textContent = 'COD: first frame failed to load.';
            }
            setCodLoadButtonState(false);
        };
        first.src = urls[0];
    }

    function codScheduleCachePoll(parms) {
        codClearCachePoll();
        var ms = codCachePollMs();
        if (ms <= 0 || !parms) {
            return;
        }
        codCacheCheckTimer = setInterval(function () {
            if (!showCodModelLoopPanel()) {
                return;
            }
            var apiUrl = COD_BASE + '/assets/php/scripts/get-files.php?parms=' + encodeURIComponent(parms);
            fetchText(apiUrl, function (txt) {
                if (!txt) {
                    return;
                }
                var j;
                try {
                    j = JSON.parse(txt);
                } catch (e1) {
                    return;
                }
                if (!j || j.err !== 'false' || !j.files || !j.files.length) {
                    return;
                }
                var files = j.files;
                var newKey = codRunFingerprint(files);
                var cur = codCacheByParms[parms];
                if (cur && cur.runKey === newKey) {
                    return;
                }
                codFillCacheFromHttpFiles(parms, files, function (ok) {
                    if (!ok) {
                        return;
                    }
                    if (codDisplayedParms === parms && modal && modal.style.display === 'flex' && selectedIata) {
                        var myGen = ++codLoopGen;
                        var tag = 'updated';
                        var m = j.parms;
                        var sub =
                            Array.isArray(m) && m.length >= 3
                                ? String(m[1]) + ' · ' + String(m[2]) + ' · simulated reflectivity'
                                : 'COD NEXLAB';
                        codStartLoopFromUrls(
                            codCacheByParms[parms].blobUrls,
                            myGen,
                            parms,
                            tag,
                            sub,
                            'new run (cached)'
                        );
                    }
                });
            });
        }, ms);
    }

    function stopCodModelLoop() {
        if (codLoopTimer) {
            clearInterval(codLoopTimer);
            codLoopTimer = null;
        }
        codClearCachePoll();
        codDisplayedParms = null;
        codLoopGen++;
        lastCodLoopIata = null;
        if (codLoopWrapEl) {
            codLoopWrapEl.style.visibility = 'hidden';
            codLoopWrapEl.style.minHeight = '';
        }
        if (codLoopImgA) {
            try {
                codLoopImgA.removeAttribute('src');
            } catch (e) {}
            codLoopImgA.style.opacity = '0';
        }
        if (codLoopImgB) {
            try {
                codLoopImgB.removeAttribute('src');
            } catch (e) {}
            codLoopImgB.style.opacity = '0';
        }
    }

    function setCodLoadButtonState(loading) {
        if (!codLoadBtn) {
            return;
        }
        codLoadBtn.disabled = loading === true;
        codLoadBtn.textContent = loading ? 'Loading…' : 'Load model loop';
    }

    function codLoopParmsForStation(iata, cb) {
        if (!codAutoSectorPref()) {
            cb(codModelParmsManual(), 'manual');
            return;
        }
        var icao = icaoFor(iata);
        var model = codLoopModelPref();
        if (!icao) {
            cb(codBuildParms(model, 'US'), 'fallback');
            return;
        }
        fetchJson('https://api.weather.gov/stations/' + encodeURIComponent(icao), function (st) {
            if (!st || !st.geometry || !st.geometry.coordinates) {
                cb(codBuildParms(model, 'US'), 'fallback');
                return;
            }
            var coords = st.geometry.coordinates;
            var lon = coords[0];
            var lat = coords[1];
            if (typeof lat !== 'number' || typeof lon !== 'number') {
                cb(codBuildParms(model, 'US'), 'fallback');
                return;
            }
            var sec = codPickSectorForLatLon(lat, lon, model);
            cb(codBuildParms(model, sec), sec);
        });
    }

    /**
     * Resolve product parms, JSON list, then use cache (blob URLs) or fill cache; then loop.
     * Lightweight JSON check later updates cache only when run fingerprint changes.
     */
    function runCodModelLoopFetch(myGen) {
        if (myGen !== codLoopGen || !selectedIata) {
            return;
        }
        if (!codLoopImgA || !codLoopImgB || !codLoopWrapEl) {
            return;
        }
        if (codLoopMetaEl) {
            codLoopMetaEl.textContent = 'Resolving region and loading frame list…';
        }
        setCodLoadButtonState(true);
        codLoopParmsForStation(selectedIata, function (parms, tag) {
            if (myGen !== codLoopGen) {
                return;
            }
            codDisplayedParms = parms;
            var apiUrl = COD_BASE + '/assets/php/scripts/get-files.php?parms=' + encodeURIComponent(parms);
            fetchText(apiUrl, function (txt) {
                if (myGen !== codLoopGen) {
                    return;
                }
                if (!txt) {
                    if (codLoopMetaEl) {
                        codLoopMetaEl.textContent = 'COD: could not load frame list.';
                    }
                    setCodLoadButtonState(false);
                    return;
                }
                var j;
                try {
                    j = JSON.parse(txt);
                } catch (e1) {
                    if (codLoopMetaEl) {
                        codLoopMetaEl.textContent = 'COD: invalid JSON.';
                    }
                    setCodLoadButtonState(false);
                    return;
                }
                if (!j || j.err !== 'false' || !j.files || !j.files.length) {
                    if (codLoopMetaEl) {
                        codLoopMetaEl.textContent = 'COD: no frames for ' + parms + '.';
                    }
                    setCodLoadButtonState(false);
                    return;
                }
                var files = j.files;
                var m = j.parms;
                var sub =
                    Array.isArray(m) && m.length >= 3
                        ? String(m[1]) + ' · ' + String(m[2]) + ' · simulated reflectivity'
                        : 'COD NEXLAB';
                var newKey = codRunFingerprint(files);
                var cached = codCacheByParms[parms];
                if (cached && cached.runKey === newKey && cached.blobUrls && cached.blobUrls.length === files.length) {
                    codStartLoopFromUrls(cached.blobUrls, myGen, parms, tag, sub, 'ready (cached)');
                    codScheduleCachePoll(parms);
                    return;
                }
                if (codLoopMetaEl) {
                    codLoopMetaEl.textContent = 'Downloading frames into cache…';
                }
                codFillCacheFromHttpFiles(parms, files, function (ok) {
                    if (myGen !== codLoopGen) {
                        return;
                    }
                    if (!ok) {
                        if (codLoopMetaEl) {
                            codLoopMetaEl.textContent = 'COD: failed to cache frames.';
                        }
                        setCodLoadButtonState(false);
                        return;
                    }
                    codStartLoopFromUrls(
                        codCacheByParms[parms].blobUrls,
                        myGen,
                        parms,
                        tag,
                        sub,
                        ''
                    );
                    codScheduleCachePoll(parms);
                });
            });
        });
    }

    function startCodModelLoopFromDetail() {
        stopCodModelLoop();
        if (!showCodModelLoopPanel() || !codLoopHostEl) {
            if (codLoopHostEl) {
                codLoopHostEl.style.display = 'none';
            }
            return;
        }
        if (!detailEl || !modal || modal.style.display !== 'flex' || !selectedIata) {
            if (codLoopHostEl) {
                codLoopHostEl.style.display = 'none';
            }
            return;
        }
        codLoopHostEl.style.display = 'block';
        var myGen = ++codLoopGen;
        if (!codLoopImgA || !codLoopImgB) {
            return;
        }
        lastCodLoopIata = selectedIata;
        if (codLoopLoadTrigger() === 'manual') {
            if (codLoopWrapEl) {
                codLoopWrapEl.style.visibility = 'hidden';
                codLoopWrapEl.style.minHeight = '';
            }
            codLoopImgA.removeAttribute('src');
            codLoopImgB.removeAttribute('src');
            if (codLoadBtn) {
                codLoadBtn.style.display = 'inline-block';
            }
            if (codLoopMetaEl) {
                codLoopMetaEl.textContent =
                    'Model loop is not loaded until you tap Load — avoids downloading frames in the background.';
            }
            setCodLoadButtonState(false);
            return;
        }
        if (codLoadBtn) {
            codLoadBtn.style.display = 'none';
        }
        runCodModelLoopFetch(myGen);
    }

    function ensureDetailStructure() {
        if (!detailEl) {
            return;
        }
        if (detailContentEl && detailContentEl.parentNode !== detailEl) {
            try {
                detailEl.appendChild(detailContentEl);
            } catch (e) {}
        }
    }

    /** Detach COD host before overwriting detail HTML so it is not destroyed. */
    function detachCodLoopHost() {
        if (codLoopHostEl && codLoopHostEl.parentNode) {
            try {
                codLoopHostEl.parentNode.removeChild(codLoopHostEl);
            } catch (e) {}
        }
    }

    /** Insert COD block after hourly chart, before AFD (placeholder in HTML). */
    function attachCodLoopHostAfterRender() {
        if (!detailContentEl || !codLoopHostEl || !showCodModelLoopPanel()) {
            return;
        }
        var slot = detailContentEl.querySelector('[data-dc-cod-slot="1"]');
        if (slot && slot.parentNode) {
            try {
                slot.parentNode.replaceChild(codLoopHostEl, slot);
            } catch (e) {
                detailContentEl.appendChild(codLoopHostEl);
            }
        }
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

    function applySharedMetarTafToCache(icao, metar, taf, ts) {
        if (!icao) {
            return;
        }
        var tUse = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now();
        var cur = cacheByIcao[icao];
        if (cur && typeof cur.t === 'number' && cur.t > tUse + 500) {
            return;
        }
        if (!cur) {
            var iataGuess = '';
            var k;
            for (k in IATA_TO_ICAO) {
                if (Object.prototype.hasOwnProperty.call(IATA_TO_ICAO, k) && IATA_TO_ICAO[k] === icao) {
                    iataGuess = k;
                    break;
                }
            }
            cur = {
                iata: iataGuess,
                icao: icao,
                metar: metar,
                metarLines: metar && metar !== 'N/A' ? [metar] : [],
                taf: taf,
                rvrFaa: null,
                rvrNotFetched: true,
                datisEntries: null,
                hrrrHourly: null,
                radarGifUrl: '',
                afdText: '',
                afdMeta: null,
                err: false,
                t: tUse
            };
        } else {
            cur.metar = metar;
            cur.taf = taf;
            cur.metarLines = metar && metar !== 'N/A' ? [metar] : [];
            cur.t = tUse;
        }
        cacheByIcao[icao] = cur;
        try {
            if (modal && modal.style.display === 'flex' && selectedIata && icaoFor(selectedIata) === icao) {
                renderDetail(selectedIata, { skipCodLoop: true });
            }
            renderStationList();
            updateAlertState();
        } catch (e2) {}
    }

    function initMetarTafSharedSync() {
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                metarTafSharedChannel = new BroadcastChannel(BC_METAR_TAF_SHARED);
                metarTafSharedChannel.onmessage = function (ev) {
                    var d = ev && ev.data;
                    if (!d || d.type !== 'metar-taf' || !d.icao) {
                        return;
                    }
                    applySharedMetarTafToCache(d.icao, d.metar, d.taf, d.t);
                };
            } catch (e) {
                metarTafSharedChannel = null;
            }
        }
        onStorageMetarTaf = function (e) {
            if (!e || e.key !== LS_METAR_TAF_SHARED || !e.newValue) {
                return;
            }
            try {
                var store = JSON.parse(e.newValue);
                if (!store || typeof store !== 'object') {
                    return;
                }
                var keys = Object.keys(store);
                var i;
                for (i = 0; i < keys.length; i++) {
                    var ic = keys[i];
                    var ent = store[ic];
                    if (ent && ent.metar !== undefined && ent.taf !== undefined) {
                        applySharedMetarTafToCache(ic, ent.metar, ent.taf, ent.t);
                    }
                }
            } catch (e2) {}
        };
        window.addEventListener('storage', onStorageMetarTaf);
    }

    function stopMetarTafSharedSync() {
        if (onStorageMetarTaf) {
            window.removeEventListener('storage', onStorageMetarTaf);
            onStorageMetarTaf = null;
        }
        if (metarTafSharedChannel) {
            try {
                metarTafSharedChannel.close();
            } catch (e) {}
            metarTafSharedChannel = null;
        }
    }

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

    function loadDetailSeenSnapshot() {
        try {
            var o = JSON.parse(localStorage.getItem(STORAGE_DETAIL_SEEN) || '{}');
            o = o && typeof o === 'object' ? o : {};
            if (!Object.keys(o).length) {
                try {
                    var legacy = JSON.parse(localStorage.getItem(STORAGE_VIEWED) || '{}');
                    if (legacy && typeof legacy === 'object' && Object.keys(legacy).length) {
                        o = legacy;
                        localStorage.setItem(STORAGE_DETAIL_SEEN, JSON.stringify(o));
                    }
                } catch (e2) {}
            }
            return o;
        } catch (e) {
            return {};
        }
    }

    function saveDetailSeenSnapshot(obj) {
        localStorage.setItem(STORAGE_DETAIL_SEEN, JSON.stringify(obj));
    }

    function notifyContentKey(metar, taf) {
        return String(metar || '') + '\u0000' + String(taf || '');
    }

    function loadNotifyDedupeMap() {
        try {
            var o = JSON.parse(localStorage.getItem(LS_NOTIFY_DEDUPE) || '{}');
            return o && typeof o === 'object' ? o : {};
        } catch (e) {
            return {};
        }
    }

    function saveNotifyDedupeMap(obj) {
        try {
            localStorage.setItem(LS_NOTIFY_DEDUPE, JSON.stringify(obj));
        } catch (e) {}
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
    var detailSeenSnapshot = loadDetailSeenSnapshot();
    var notifyDedupeMap = loadNotifyDedupeMap();

    function reloadViewedSnapshotsFromStorage() {
        viewedSnapshot = loadViewedSnapshot();
        detailSeenSnapshot = loadDetailSeenSnapshot();
    }

    function applyViewedSyncFromOtherTab(icao) {
        reloadViewedSnapshotsFromStorage();
        notifyDedupeMap = loadNotifyDedupeMap();
        if (icao) {
            var idx;
            for (idx = 0; idx < stationList.length; idx++) {
                if (icaoFor(stationList[idx]) === icao) {
                    delete pendingChangeTime[stationList[idx]];
                    break;
                }
            }
        }
        updateAlertState();
        try {
            renderStationList();
            if (modal && modal.style.display === 'flex' && selectedIata) {
                renderDetail(selectedIata, { skipCodLoop: true });
            }
        } catch (e) {}
    }

    function initViewedSync() {
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                viewedSyncChannel = new BroadcastChannel(BC_VIEWED_SYNC);
                viewedSyncChannel.onmessage = function (ev) {
                    var d = ev && ev.data;
                    if (!d || d.type !== 'viewed-read' || !d.icao) {
                        return;
                    }
                    if (d.tabId === tabInstanceId) {
                        return;
                    }
                    applyViewedSyncFromOtherTab(d.icao);
                };
            } catch (e) {
                viewedSyncChannel = null;
            }
        }
        onStorageViewedSync = function (e) {
            if (!e || !e.key) {
                return;
            }
            if (e.key === STORAGE_VIEWED || e.key === STORAGE_DETAIL_SEEN) {
                applyViewedSyncFromOtherTab(null);
            }
            if (e.key === LS_NOTIFY_DEDUPE && e.newValue) {
                try {
                    notifyDedupeMap = JSON.parse(e.newValue) || {};
                } catch (e2) {}
            }
        };
        window.addEventListener('storage', onStorageViewedSync);
    }

    function stopViewedSync() {
        if (onStorageViewedSync) {
            window.removeEventListener('storage', onStorageViewedSync);
            onStorageViewedSync = null;
        }
        if (viewedSyncChannel) {
            try {
                viewedSyncChannel.close();
            } catch (e) {}
            viewedSyncChannel = null;
        }
    }

    function broadcastViewedRead(icao) {
        if (!icao || !viewedSyncChannel) {
            return;
        }
        try {
            viewedSyncChannel.postMessage({
                type: 'viewed-read',
                tabId: tabInstanceId,
                icao: icao
            });
        } catch (e) {}
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
    var refreshThisBtn = null;
    var refreshAllBtn = null;
    var statusBarEl = null;
    var sortSelect = null;
    var listColorTimer = null;
    /** Persistent COD loop UI (survives detailEl.innerHTML updates). */
    /** Main detail HTML (METAR…AFD); COD loop is a sibling so innerHTML does not kill the animation. */
    var detailContentEl = null;
    var codLoopHostEl = null;
    var codLoopWrapEl = null;
    var codLoopMetaEl = null;
    var codLoopImgA = null;
    var codLoopImgB = null;
    var codLoadBtn = null;
    /** Last station we started the COD loop for (avoid restart on timer-only detail refresh). */
    var lastCodLoopIata = null;
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
        var v = detailSeenSnapshot[icao];
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
                    renderDetail(selectedIata, { skipCodLoop: true });
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

    function buildDatisBlockHtml(entries) {
        var parts = [];
        var i;
        var inner = '';
        if (entries === undefined || entries === null) {
            inner =
                '<div style="font-size:11px;color:#95a5a6;font-family:system-ui,sans-serif;">D-ATIS not loaded yet — use Refresh or wait for background load.</div>';
        } else if (!entries.length) {
            inner =
                '<div style="font-size:11px;color:#95a5a6;font-family:system-ui,sans-serif;">No D-ATIS returned for this airport. Try Refresh.</div>';
        } else {
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
            inner = parts.join('');
        }
        return (
            '<div style="margin-bottom:16px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
            '<div style="font-weight:600;color:#3498db;">Digital ATIS <span style="font-weight:400;color:#95a5a6;font-size:11px;">(third-party)</span></div>' +
            '<button type="button" data-dc-datis-refresh="1" style="padding:4px 10px;font-size:11px;border-radius:4px;border:1px solid #444;background:#2a2a32;color:#ecf0f1;cursor:pointer;">Refresh D-ATIS</button>' +
            '</div>' +
            '<div style="background:#141418;padding:10px;border-radius:6px;max-height:min(40vh,420px);overflow:auto;">' +
            inner +
            '</div>' +
            '<div style="font-size:10px;color:#7f8c8d;margin-top:6px;font-family:system-ui,sans-serif;">Source: atis.info — not official FAA; verify with ATIS/AWOS.</div>' +
            '</div>'
        );
    }

    /** SVG combo chart: temperature (line) + PoP (bars). Data from NOAA hourly or Open-Meteo. */
    function buildHrrrChartHtml(h) {
        if (!h || !h.times || !h.times.length) {
            return '';
        }
        var chartSub = h.chartSubtitle || 'Hourly forecast';
        var maxPts = 24;
        var n = Math.min(h.times.length, maxPts);
        var W = 800;
        var H = 260;
        var pl = 52;
        var pr = 16;
        var pt = 28;
        var pb = 44;
        var pw = W - pl - pr;
        var ph = H - pt - pb;
        var tempTop = pt;
        var tempBot = pt + Math.floor(ph * 0.58);
        var popTop = tempBot + 6;
        var popBot = pt + ph;
        var i;
        var temps = [];
        var pops = [];
        for (i = 0; i < n; i++) {
            var tf = h.tempF[i];
            temps.push(tf !== undefined && tf !== null && Number.isFinite(Number(tf)) ? Number(tf) : null);
            var pp = h.pop[i];
            pops.push(pp !== undefined && pp !== null && Number.isFinite(Number(pp)) ? Math.max(0, Math.min(100, Number(pp))) : 0);
        }
        var minT = null;
        var maxT = null;
        for (i = 0; i < temps.length; i++) {
            if (temps[i] === null) {
                continue;
            }
            if (minT === null || temps[i] < minT) {
                minT = temps[i];
            }
            if (maxT === null || temps[i] > maxT) {
                maxT = temps[i];
            }
        }
        if (minT === null) {
            minT = 0;
            maxT = 1;
        }
        if (maxT - minT < 1) {
            minT -= 1;
            maxT += 1;
        }
        var padT = (maxT - minT) * 0.08;
        minT -= padT;
        maxT += padT;
        function xAt(idx) {
            if (n <= 1) {
                return pl + pw / 2;
            }
            return pl + (pw * idx) / (n - 1);
        }
        var linePts = [];
        for (i = 0; i < n; i++) {
            if (temps[i] === null) {
                continue;
            }
            var tx = xAt(i);
            var ty = tempBot - ((temps[i] - minT) / (maxT - minT)) * (tempBot - tempTop);
            linePts.push(Math.round(tx * 10) / 10 + ',' + Math.round(ty * 10) / 10);
        }
        var polyline =
            linePts.length >= 2
                ? '<polyline fill="none" stroke="#5dade2" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' +
                  linePts.join(' ') +
                  '" />'
                : '';
        var circles = '';
        for (i = 0; i < n; i++) {
            if (temps[i] === null) {
                continue;
            }
            var cx = xAt(i);
            var cy = tempBot - ((temps[i] - minT) / (maxT - minT)) * (tempBot - tempTop);
            circles +=
                '<circle cx="' +
                cx +
                '" cy="' +
                cy +
                '" r="3" fill="#1a5276" stroke="#85c1e9" stroke-width="1" />';
        }
        var barW = n > 0 ? Math.min(18, (pw / n) * 0.55) : 0;
        var bars = '';
        for (i = 0; i < n; i++) {
            var bx = xAt(i) - barW / 2;
            var bh = ((popBot - popTop) * pops[i]) / 100;
            var by = popBot - bh;
            bars +=
                '<rect x="' +
                bx +
                '" y="' +
                by +
                '" width="' +
                barW +
                '" height="' +
                bh +
                '" fill="rgba(52,152,219,0.45)" stroke="none" rx="1" />';
        }
        var xAxis = '';
        var step = n > 12 ? 3 : n > 8 ? 2 : 1;
        for (i = 0; i < n; i += step) {
            var iso = String(h.times[i] || '');
            var lab = iso.replace('T', ' ').slice(5, 16);
            if (!lab) {
                lab = String(i);
            }
            var lx = xAt(i);
            xAxis +=
                '<text x="' +
                lx +
                '" y="' +
                (H - 12) +
                '" text-anchor="middle" fill="#95a5a6" font-size="10" font-family="system-ui,sans-serif">' +
                escapeHtml(lab) +
                '</text>';
        }
        var yLbl =
            '<text x="' +
            (pl - 6) +
            '" y="' +
            (tempTop + 4) +
            '" text-anchor="end" fill="#5dade2" font-size="10" font-family="system-ui,sans-serif">' +
            escapeHtml(String(Math.round(maxT))) +
            '°</text>' +
            '<text x="' +
            (pl - 6) +
            '" y="' +
            (tempBot - 2) +
            '" text-anchor="end" fill="#5dade2" font-size="10" font-family="system-ui,sans-serif">' +
            escapeHtml(String(Math.round(minT))) +
            '°</text>' +
            '<text x="' +
            (pl - 6) +
            '" y="' +
            (popTop + 12) +
            '" text-anchor="end" fill="#7f8c8d" font-size="10" font-family="system-ui,sans-serif">100%</text>' +
            '<text x="' +
            (pl - 6) +
            '" y="' +
            (popBot - 2) +
            '" text-anchor="end" fill="#7f8c8d" font-size="10" font-family="system-ui,sans-serif">0%</text>';
        var grid =
            '<line x1="' +
            pl +
            '" y1="' +
            tempTop +
            '" x2="' +
            (pl + pw) +
            '" y2="' +
            tempTop +
            '" stroke="#333" stroke-dasharray="4 4" />' +
            '<line x1="' +
            pl +
            '" y1="' +
            tempBot +
            '" x2="' +
            (pl + pw) +
            '" y2="' +
            tempBot +
            '" stroke="#444" />' +
            '<line x1="' +
            pl +
            '" y1="' +
            popTop +
            '" x2="' +
            (pl + pw) +
            '" y2="' +
            popTop +
            '" stroke="#333" />' +
            '<line x1="' +
            pl +
            '" y1="' +
            popBot +
            '" x2="' +
            (pl + pw) +
            '" y2="' +
            popBot +
            '" stroke="#444" />';
        var legend =
            '<text x="' +
            (pl + pw - 4) +
            '" y="' +
            (pt - 8) +
            '" text-anchor="end" fill="#bdc3c7" font-size="10" font-family="system-ui,sans-serif">' +
            '── Temp (' +
            escapeHtml(h.unitTemp || '°F') +
            ')  ▌ PoP</text>';
        return (
            '<div style="margin-bottom:16px;">' +
            '<div style="font-weight:600;margin-bottom:8px;color:#3498db;">Hourly forecast <span style="font-weight:400;color:#95a5a6;font-size:11px;">(' +
            escapeHtml(chartSub) +
            ')</span></div>' +
            '<div style="max-width:100%;overflow:auto;background:#141418;padding:10px;border-radius:6px;">' +
            '<svg viewBox="0 0 ' +
            W +
            ' ' +
            H +
            '" width="100%" height="260" preserveAspectRatio="xMidYMid meet" style="display:block;min-width:280px;">' +
            '<rect x="0" y="0" width="' +
            W +
            '" height="' +
            H +
            '" fill="transparent" />' +
            grid +
            yLbl +
            bars +
            polyline +
            circles +
            xAxis +
            legend +
            '</svg></div></div>'
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

    /** Open-Meteo GFS blend (optional; not official NWS grid). */
    function fetchHrrrHourlyOpenMeteo(lat, lon, cb) {
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
                    unitWind: (j.hourly_units && j.hourly_units.wind_speed_10m) || 'mph',
                    chartSubtitle: 'Open-Meteo GFS blend'
                });
            } catch (e) {
                cb(null);
            }
        });
    }

    /** NOAA api.weather.gov grid hourly forecast at lat/lon (official NWS product). */
    function fetchNwsGridHourlyForecast(lat, lon, cb) {
        fetchJson(
            'https://api.weather.gov/points/' + encodeURIComponent(lat) + ',' + encodeURIComponent(lon),
            function (ptFeat) {
                if (!ptFeat || !ptFeat.properties) {
                    cb(null);
                    return;
                }
                var hourlyUrl = ptFeat.properties.forecastHourly;
                if (!hourlyUrl || typeof hourlyUrl !== 'string') {
                    cb(null);
                    return;
                }
                fetchJson(hourlyUrl, function (hourlyFeat) {
                    if (!hourlyFeat || !hourlyFeat.properties || !hourlyFeat.properties.periods) {
                        cb(null);
                        return;
                    }
                    var periods = hourlyFeat.properties.periods;
                    var times = [];
                    var tempF = [];
                    var pop = [];
                    var pi;
                    for (pi = 0; pi < periods.length; pi++) {
                        var p = periods[pi];
                        if (!p) {
                            continue;
                        }
                        if (p.startTime) {
                            times.push(p.startTime);
                        }
                        var t = p.temperature;
                        var tu = String(p.temperatureUnit || 'F').toUpperCase();
                        if (tu === 'C' && typeof t === 'number' && Number.isFinite(t)) {
                            t = (t * 9) / 5 + 32;
                        }
                        tempF.push(typeof t === 'number' && Number.isFinite(t) ? t : null);
                        var popv = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value;
                        pop.push(
                            typeof popv === 'number' && Number.isFinite(popv)
                                ? Math.max(0, Math.min(100, popv))
                                : 0
                        );
                    }
                    if (!times.length) {
                        cb(null);
                        return;
                    }
                    cb({
                        times: times,
                        tempF: tempF,
                        pop: pop,
                        wcode: [],
                        wspd: [],
                        wdir: [],
                        unitTemp: '°F',
                        unitWind: 'mph',
                        chartSubtitle: 'NOAA grid hourly · weather.gov'
                    });
                });
            }
        );
    }

    function fetchHourlyForecastChart(lat, lon, cb) {
        if (hrrrHourlySource() === 'openmeteo') {
            fetchHrrrHourlyOpenMeteo(lat, lon, cb);
        } else {
            fetchNwsGridHourlyForecast(lat, lon, cb);
        }
    }

    /** Pass `undefined` for datis or hrrr to leave that field unchanged (partial refresh). */
    function mergeDetailExtras(icao, iata, datis, hrrr) {
        var cur = cacheByIcao[icao];
        if (!cur || cur.icao !== icao) {
            return;
        }
        if (datis !== undefined) {
            cur.datisEntries = datis;
        }
        if (hrrr !== undefined) {
            cur.hrrrHourly = hrrr;
        }
        cacheByIcao[icao] = cur;
        if (modal && modal.style.display === 'flex' && selectedIata === iata) {
            renderDetail(selectedIata);
        }
    }

    function mergeDatisOnly(icao, iata, datis) {
        var cur = cacheByIcao[icao];
        if (!cur || cur.icao !== icao) {
            return;
        }
        cur.datisEntries = datis;
        cacheByIcao[icao] = cur;
        if (modal && modal.style.display === 'flex' && selectedIata === iata) {
            renderDetail(selectedIata);
        }
    }

    function refreshDatisOnly() {
        if (!showDatisPanel()) {
            return;
        }
        if (!selectedIata) {
            return;
        }
        var iata = selectedIata;
        var icao = icaoFor(iata);
        if (!icao) {
            return;
        }
        setStatusBar('Refreshing D-ATIS ' + stationListLabel(iata) + '…');
        fetchDatisForIcao(icao, function (datis) {
            mergeDatisOnly(icao, iata, datis);
            if (selectedIata === iata) {
                setStatusBar('D-ATIS updated · ' + stationListLabel(iata) + ' · ' + new Date().toLocaleTimeString());
            }
        });
    }

    function patchDetailExtras(icao, iata) {
        if (!icao || !iata) {
            return;
        }
        if (!showDatisPanel() && !showHrrrPanel()) {
            return;
        }
        fetchJson('https://api.weather.gov/stations/' + encodeURIComponent(icao), function (st) {
            var lat = null;
            var lon = null;
            if (st && st.geometry && st.geometry.coordinates) {
                var coords = st.geometry.coordinates;
                lon = coords[0];
                lat = coords[1];
            }
            function maybeHrrrAfterDatis(datis) {
                var dArg = showDatisPanel() ? datis : undefined;
                if (!showHrrrPanel()) {
                    mergeDetailExtras(icao, iata, dArg, undefined);
                    return;
                }
                if (typeof lat !== 'number' || typeof lon !== 'number') {
                    mergeDetailExtras(icao, iata, dArg, null);
                    return;
                }
                fetchHourlyForecastChart(lat, lon, function (hrrr) {
                    mergeDetailExtras(icao, iata, dArg, hrrr);
                });
            }
            if (showDatisPanel()) {
                fetchDatisForIcao(icao, function (datis) {
                    maybeHrrrAfterDatis(datis);
                });
            } else {
                maybeHrrrAfterDatis(null);
            }
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
        var wantRadar = showRadarPanel();
        var wantAfd = showAfdPanel();
        if (!wantRadar && !wantAfd) {
            cb({ radarGifUrl: '', afdText: '', afdMeta: null });
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
                    if (wantRadar && radar && /^K[A-Z0-9]{3}$/i.test(radar)) {
                        radarGifUrl =
                            'https://radar.weather.gov/ridge/standard/' +
                            radar.toUpperCase() +
                            '_loop.gif';
                    }
                    if (!wantAfd) {
                        cb({ radarGifUrl: radarGifUrl, afdText: '', afdMeta: cwa ? { cwa: cwa } : null });
                        return;
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
                            if (!first) {
                                cb({ radarGifUrl: radarGifUrl, afdText: '', afdMeta: { cwa: cwa } });
                                return;
                            }
                            var productUrl = first['@id'] || first.id;
                            if (!productUrl || typeof productUrl !== 'string') {
                                cb({ radarGifUrl: radarGifUrl, afdText: '', afdMeta: { cwa: cwa } });
                                return;
                            }
                            if (productUrl.indexOf('http') !== 0) {
                                productUrl = 'https://api.weather.gov/products/' + encodeURIComponent(String(productUrl));
                            }
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
        if (
            /access denied|forbidden|\b403\b|blocked|rate limit|too many requests|We're sorry|currently down|site is currently down/i.test(
                html
            )
        ) {
            return { rows: [], updatedUtc: '', empty: true, blocked: true };
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
        var fetchRvr = shouldFetchFaaRvr({
            fetchRvrNow: opts.fetchRvrNow,
            forceFetchRvr: opts.forceFetchRvr,
            iataForFetch: iata
        });

        var icao = icaoFor(iata);
        if (!icao) {
            cb({
                iata: iata.toUpperCase(),
                icao: null,
                metar: 'No ICAO mapping',
                metarLines: [],
                taf: '',
                rvrFaa: null,
                rvrNotFetched: false,
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
        var rvrDone = !fetchRvr;
        var rvrParsed = null;
        var noaaMetarStarted = false;
        var taf = 'N/A';
        var metarLines = [];
        var metar = 'N/A';

        function buildRecFromEnr(enr) {
            var radarGifUrl = '';
            var afdText = '';
            var afdMeta = null;
            if (needNwsEnrichmentFetch() && enr) {
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
                rvrNotFetched: !fetchRvr,
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
                publishMetarTafShared(icao, recFast.metar, recFast.taf);
                cb(recFast);
                if (needNwsEnrichmentFetch()) {
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
                }
                patchDetailExtras(icao, iata);
                return;
            }
            if (needNwsEnrichmentFetch()) {
                fetchNwsEnrichmentCached(icao, false, function (enr) {
                    var rec = buildRecFromEnr(enr);
                    cacheByIcao[icao] = rec;
                    publishMetarTafShared(icao, rec.metar, rec.taf);
                    cb(rec);
                    patchDetailExtras(icao, iata);
                });
            } else {
                var recNoNws = buildRecFromEnr(null);
                cacheByIcao[icao] = recNoNws;
                publishMetarTafShared(icao, recNoNws.metar, recNoNws.taf);
                cb(recNoNws);
                patchDetailExtras(icao, iata);
            }
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

        if (fetchRvr) {
            fetchText(faaRvrUrlForIata(iata, false), function (html) {
                rvrParsed = parseFaaRvrHtml(html);
                rvrDone = true;
                tryComplete();
            });
        }

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

    function fetchAllStations(list, done, onProgress, fetchOpts) {
        if (!list || !list.length) {
            done([]);
            return;
        }
        fetchOpts = fetchOpts || {};
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
                    fetchWeatherForIata(
                        iata,
                        function (rec) {
                            finishOne(rec, index);
                        },
                        fetchOpts
                    );
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
            var rec = cacheByIcao[icao];
            var ck = rec ? notifyContentKey(rec.metar, rec.taf) : '';
            if (ck && notifyDedupeMap[icao] === ck) {
                notifyShownForCurrent[icao] = true;
                continue;
            }
            notifyShownForCurrent[icao] = true;
            if (ck) {
                notifyDedupeMap[icao] = ck;
                saveNotifyDedupeMap(notifyDedupeMap);
            }
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
                            /* +si so newest/oldest sort differs when many go stale in one poll (same millisecond). */
                            pendingChangeTime[iataK] = nowTs + si;
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
        /** Merge: keep existing per-airport viewed baselines; only add ICAOs from first poll that we have not seen yet. */
        var merged = {};
        var k;
        for (k in viewedSnapshot) {
            if (Object.prototype.hasOwnProperty.call(viewedSnapshot, k)) {
                merged[k] = viewedSnapshot[k];
            }
        }
        var sk;
        for (sk in snap) {
            if (Object.prototype.hasOwnProperty.call(snap, sk) && !Object.prototype.hasOwnProperty.call(merged, sk)) {
                merged[sk] = snap[sk];
            }
        }
        viewedSnapshot = merged;
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

    function ensureFaaRvrLoaded(iata) {
        if (!boolPref('metarWatchShowRvr', true)) {
            return;
        }
        var icao = icaoFor(iata);
        if (!icao) {
            return;
        }
        var cur = cacheByIcao[icao];
        if (!cur || !cur.rvrNotFetched) {
            return;
        }
        fetchText(faaRvrUrlForIata(iata, false), function (html) {
            var cur2 = cacheByIcao[icao];
            if (!cur2 || selectedIata !== iata) {
                return;
            }
            cur2.rvrFaa = parseFaaRvrHtml(html);
            cur2.rvrNotFetched = false;
            cacheByIcao[icao] = cur2;
            if (modal && modal.style.display === 'flex' && selectedIata === iata) {
                renderDetail(selectedIata);
            }
        });
    }

    function refreshRvrOnly() {
        if (!selectedIata) {
            return;
        }
        if (!boolPref('metarWatchShowRvr', true)) {
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
            cur.rvrNotFetched = false;
            cacheByIcao[icao] = cur;
            if (selectedIata) {
                renderDetail(selectedIata);
                setStatusBar('RVR updated · ' + stationListLabel(selectedIata) + ' · ' + new Date().toLocaleTimeString());
            }
        });
    }

    function runPoll() {
        if (sharedPollEnabled() && pollBroadcastChannel && !isPollLeaderTab()) {
            return;
        }
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
                broadcastPollResults(results);
                if (modal && modal.style.display === 'flex' && selectedIata) {
                    renderDetail(selectedIata);
                    renderStationList();
                    setStatusBar('Background refresh done · ' + new Date().toLocaleTimeString());
                } else {
                    renderStationList();
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
        var snap = { metar: r.metar, taf: r.taf };
        viewedSnapshot[icao] = snap;
        saveViewedSnapshot(viewedSnapshot);
        detailSeenSnapshot[icao] = snap;
        saveDetailSeenSnapshot(detailSeenSnapshot);
        try {
            if (notifyDedupeMap[icao]) {
                delete notifyDedupeMap[icao];
                saveNotifyDedupeMap(notifyDedupeMap);
            }
        } catch (e) {}
        delete pendingChangeTime[iata];
        broadcastViewedRead(icao);
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
        fetchWeatherForIata(
            selectedIata,
            function () {
                if (refreshThisBtn) {
                    refreshThisBtn.disabled = false;
                }
                setStatusBar(stationListLabel(selectedIata) + ' · updated ' + new Date().toLocaleTimeString());
                renderStationList();
                if (selectedIata) {
                    renderDetail(selectedIata, { markViewedAfter: true });
                }
                updateRefreshThisLabel();
                updateAlertState();
            },
            { fetchRvrNow: true }
        );
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
            },
            { forceFetchRvr: true }
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
                    renderStationList();
                    renderDetail(iata, { markViewedAfter: true });
                    ensureFaaRvrLoaded(iata);
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
        if (hasP && (sortMode === 'newest' || sortMode === 'oldest') && listEl) {
            try {
                listEl.scrollTop = 0;
            } catch (e) {}
        }
    }

    function renderDetail(iata, opts) {
        opts = opts || {};
        var skipCodLoop = opts.skipCodLoop === true;
        var markViewedAfter = opts.markViewedAfter === true;
        ensureDetailStructure();
        if (!detailContentEl) {
            return;
        }
        if (!iata) {
            stopCodModelLoop();
            detachCodLoopHost();
            if (codLoopHostEl) {
                codLoopHostEl.style.display = 'none';
            }
            detailContentEl.innerHTML =
                '<div style="color:#95a5a6;font-family:system-ui,sans-serif;">Select a station.</div>';
            return;
        }
        var r = cacheByIcao[icaoFor(iata)];
        if (!r) {
            stopCodModelLoop();
            detachCodLoopHost();
            if (codLoopHostEl) {
                codLoopHostEl.style.display = 'none';
            }
            detailContentEl.innerHTML = '<div style="color:#95a5a6;font-family:system-ui,sans-serif;">Loading…</div>';
            fetchWeatherForIata(
                iata,
                function () {
                    if (selectedIata === iata) {
                        renderDetail(iata, { markViewedAfter: true });
                        ensureFaaRvrLoaded(iata);
                    }
                },
                { fetchRvrNow: true }
            );
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
        var showRvrPref = boolPref('metarWatchShowRvr', true);
        var rvr = r.rvrFaa;
        var rvrTable = rvr && rvr.rows && rvr.rows.length ? buildFaaRvrTableHtml(rvr, iata) : '';
        var rvrColInner = '';
        if (showRvrPref) {
            if (rvrTable) {
                rvrColInner = rvrTable;
            } else if (r.rvrNotFetched) {
                rvrColInner =
                    '<div style="color:#95a5a6;font-size:11px;font-family:system-ui,sans-serif;">Loading RVR…</div>';
            } else if (rvr && rvr.blocked) {
                rvrColInner =
                    '<div style="color:#e74c3c;font-size:11px;line-height:1.45;font-family:system-ui,sans-serif;">FAA RVR site blocked or unavailable. Try again later, turn off <strong>Fetch RVR during background poll</strong>, or disable the RVR panel.</div>';
            } else if (rvr && rvr.empty) {
                rvrColInner =
                    '<div style="color:#95a5a6;font-size:11px;font-family:system-ui,sans-serif;">No RVR table for this airport.</div>';
            } else {
                rvrColInner =
                    '<div style="color:#95a5a6;font-size:11px;font-family:system-ui,sans-serif;">No RVR data.</div>';
            }
        }
        var tafRvrRow = '';
        if (showRvrPref && rvrColInner) {
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
                rvrColInner +
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
        var datisBlock = showDatisPanel() ? buildDatisBlockHtml(r.datisEntries) : '';
        var radarBlock = '';
        if (showRadarPanel() && r.radarGifUrl) {
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
        var hrrrBlock = showHrrrPanel() ? buildHrrrChartHtml(r.hrrrHourly) : '';
        var codSlot =
            showCodModelLoopPanel() ? '<div data-dc-cod-slot="1" style="display:none;"></div>' : '';
        var afdBlock = '';
        if (showAfdPanel()) {
            if (r.afdText && String(r.afdText).trim()) {
                var afdEsc = escapeHtml(r.afdText);
                var metaStr = afdMetaLine(r.afdMeta);
                afdBlock =
                    '<details style="margin-bottom:16px;">' +
                    '<summary style="cursor:pointer;font-weight:600;color:#3498db;font-family:system-ui,sans-serif;list-style-position:outside;padding:4px 0;">Area Forecast Discussion <span style="font-weight:400;color:#95a5a6;font-size:11px;">(click to expand)</span></summary>' +
                    (metaStr
                        ? '<div style="font-size:11px;color:#95a5a6;margin:8px 0 8px 0;font-family:system-ui,sans-serif;">' +
                          escapeHtml(metaStr) +
                          '</div>'
                        : '') +
                    '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.4;color:#bdc3c7;white-space:pre-wrap;word-break:break-word;max-height:min(52vh,720px);overflow:auto;background:#141418;padding:10px;border-radius:6px;">' +
                    afdEsc +
                    '</div>' +
                    '</details>';
            } else {
                afdBlock =
                    '<details style="margin-bottom:16px;">' +
                    '<summary style="cursor:pointer;font-weight:600;color:#3498db;font-family:system-ui,sans-serif;list-style-position:outside;padding:4px 0;">Area Forecast Discussion</summary>' +
                    '<div style="font-size:11px;color:#95a5a6;font-family:system-ui,sans-serif;line-height:1.45;margin-top:8px;">No AFD text loaded yet, or weather.gov returned empty. Try <strong>Refresh</strong> for this airport; if it persists, the NWS product list may be unavailable.</div>' +
                    '</details>';
            }
        }
        detachCodLoopHost();
        detailContentEl.innerHTML =
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
            codSlot +
            afdBlock +
            '</div>';
        attachCodLoopHostAfterRender();
        if (showCodModelLoopPanel()) {
            var shouldStartCod = true;
            if (skipCodLoop && selectedIata && lastCodLoopIata === selectedIata) {
                shouldStartCod = false;
            }
            if (shouldStartCod) {
                startCodModelLoopFromDetail();
            }
        } else {
            stopCodModelLoop();
            if (codLoopHostEl) {
                codLoopHostEl.style.display = 'none';
            }
        }
        if (markViewedAfter && iata && selectedIata === iata) {
            markStationViewed(iata);
        }
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
                    ensureFaaRvrLoaded(selectedIata);
                }
                updateAlertState();
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
        stopCodModelLoop();
        if (codLoopHostEl) {
            codLoopHostEl.style.display = 'none';
        }
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
            btn.style.maxHeight = '50px';
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
            rowH = Math.min(rowH, 50);
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
            btn.style.maxHeight = '50px';
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
        modal.style.width = 'min(1152px, calc((100vw - 20px) * 0.72))';
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
        detailContentEl = document.createElement('div');
        detailContentEl.setAttribute('data-dc-detail-content', '1');
        detailEl.appendChild(detailContentEl);
        detailEl.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.getAttribute) {
                return;
            }
            if (t.getAttribute('data-dc-rvr-refresh') === '1') {
                e.preventDefault();
                refreshRvrOnly();
            }
            if (t.getAttribute('data-dc-datis-refresh') === '1') {
                e.preventDefault();
                refreshDatisOnly();
            }
            if (t.getAttribute('data-dc-cod-load') === '1') {
                e.preventDefault();
                if (codLoopLoadTrigger() === 'manual' && showCodModelLoopPanel() && selectedIata) {
                    stopCodModelLoop();
                    lastCodLoopIata = selectedIata;
                    runCodModelLoopFetch(codLoopGen);
                }
            }
        });

        codLoopHostEl = document.createElement('div');
        codLoopHostEl.setAttribute('data-dc-cod-loop-host', '1');
        codLoopHostEl.style.display = 'none';
        codLoopHostEl.style.marginBottom = '16px';
        var codTitle = document.createElement('div');
        codTitle.style.fontWeight = '600';
        codTitle.style.marginBottom = '8px';
        codTitle.style.color = '#3498db';
        codTitle.style.fontFamily = 'system-ui, sans-serif';
        codTitle.style.display = 'flex';
        codTitle.style.alignItems = 'center';
        codTitle.style.justifyContent = 'space-between';
        codTitle.style.gap = '10px';
        codTitle.style.flexWrap = 'wrap';
        var codTitleLbl = document.createElement('span');
        codTitleLbl.innerHTML =
            'Model loop <span style="font-weight:400;color:#95a5a6;font-size:11px;">(College of DuPage NEXLAB)</span>';
        codLoadBtn = document.createElement('button');
        codLoadBtn.type = 'button';
        codLoadBtn.setAttribute('data-dc-cod-load', '1');
        codLoadBtn.textContent = 'Load model loop';
        codLoadBtn.style.display = 'none';
        codLoadBtn.style.padding = '4px 10px';
        codLoadBtn.style.fontSize = '11px';
        codLoadBtn.style.borderRadius = '4px';
        codLoadBtn.style.border = '1px solid #444';
        codLoadBtn.style.background = '#2a2a32';
        codLoadBtn.style.color = '#ecf0f1';
        codLoadBtn.style.cursor = 'pointer';
        codLoadBtn.style.flexShrink = '0';
        codTitle.appendChild(codTitleLbl);
        codTitle.appendChild(codLoadBtn);
        var codWrap = document.createElement('div');
        codWrap.setAttribute('data-dc-cod-loop-wrap', '1');
        codLoopWrapEl = codWrap;
        codWrap.style.display = 'grid';
        codWrap.style.width = '100%';
        codWrap.style.background = '#111';
        codWrap.style.borderRadius = '6px';
        codWrap.style.overflow = 'hidden';
        codWrap.style.visibility = 'hidden';
        codLoopImgA = document.createElement('img');
        codLoopImgA.alt = 'COD model';
        codLoopImgA.style.gridArea = '1 / 1';
        codLoopImgA.style.width = '100%';
        codLoopImgA.style.height = 'auto';
        codLoopImgA.style.display = 'block';
        codLoopImgA.style.transition = 'opacity 0.2s ease-out';
        codLoopImgA.style.alignSelf = 'start';
        codLoopImgB = document.createElement('img');
        codLoopImgB.alt = '';
        codLoopImgB.style.gridArea = '1 / 1';
        codLoopImgB.style.width = '100%';
        codLoopImgB.style.height = 'auto';
        codLoopImgB.style.display = 'block';
        codLoopImgB.style.transition = 'opacity 0.2s ease-out';
        codLoopImgB.style.alignSelf = 'start';
        codWrap.appendChild(codLoopImgA);
        codWrap.appendChild(codLoopImgB);
        codLoopMetaEl = document.createElement('div');
        codLoopMetaEl.style.fontSize = '10px';
        codLoopMetaEl.style.color = '#7f8c8d';
        codLoopMetaEl.style.marginTop = '8px';
        codLoopMetaEl.style.fontFamily = 'system-ui, sans-serif';
        codLoopMetaEl.style.lineHeight = '1.45';
        codLoopHostEl.appendChild(codTitle);
        codLoopHostEl.appendChild(codWrap);
        codLoopHostEl.appendChild(codLoopMetaEl);
        detailEl.appendChild(codLoopHostEl);

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
        initCrossTabPollSync();
        initMetarTafSharedSync();
        initViewedSync();
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
        stopMetarTafSharedSync();
        stopViewedSync();
        stopCrossTabPollSync();
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
        stopCodModelLoop();
        var pk;
        for (pk in codCacheByParms) {
            if (Object.prototype.hasOwnProperty.call(codCacheByParms, pk)) {
                codRevokeCacheEntry(pk);
            }
        }
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
        detailContentEl = null;
        codLoopHostEl = null;
        codLoopWrapEl = null;
        codLoopMetaEl = null;
        codLoopImgA = null;
        codLoopImgB = null;
        codLoadBtn = null;
        window.__myScriptCleanup = undefined;
    };
})();
