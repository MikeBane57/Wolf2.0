// ==UserScript==
// @name         METAR/TAF tracked stations (GMT button)
// @namespace    Wolf 2.0
// @version      2.0.57
// @description  Run on worksheet widget only (no schedule/other Ops Suite tabs). Toolbar debug → inspector only.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet
// @grant        GM_xmlhttpRequest
// @connect      tgftp.nws.noaa.gov
// @connect      aviationweather.gov
// @connect      api.weather.gov
// @connect      radar.weather.gov
// @connect      rvr.data.faa.gov
// @connect      atis.info
// @connect      api.open-meteo.com
// @connect      weather.cod.edu
// @donkeycode-pref {"metarWatchToolbarClickDebug":{"type":"boolean","group":"METAR watch · debug","label":"Log worksheet toolbar clicks (extension inspector)","description":"When ON, helper-row click diagnostics go to the DonkeyCODE service worker (DONKEYCODE_PAGE_LOG), not the page console. Default OFF.","default":false}}
// @donkeycode-pref {"metarWatchFetchDatisInBackground":{"type":"boolean","group":"METAR watch · panels","label":"Fetch D-ATIS during background refresh","description":"When off, D-ATIS loads only for the station open in the modal or when you click Refresh D-ATIS. Reduces atis.info traffic and avoids repeated missing-station lookups.","default":false}}
// @donkeycode-pref {"metarWatchPollMinutes":{"type":"number","group":"METAR watch","label":"Poll every (minutes)","description":"How often to refresh METAR/TAF in the background.","default":5,"min":1,"max":120,"step":1},"metarWatchConcurrentStations":{"type":"number","group":"METAR watch","label":"Parallel station fetches","description":"How many airports to load at the same time (higher = faster refresh, more concurrent requests).","default":10,"min":1,"max":20,"step":1},"metarWatchNotify":{"type":"boolean","group":"METAR watch","label":"Browser notifications","description":"Notify when METAR/TAF changes for a tracked station since you last opened the modal.","default":true},"metarWatchNotifyRulesMode":{"type":"select","group":"METAR watch · notify rules","label":"Notify only when rules match","description":"Off: notify on any METAR/TAF change. Global: JSON rules apply to every station. Per IATA: global rules plus optional per-airport JSON overrides.","default":"off","options":[{"value":"off","label":"Off (any change)"},{"value":"global","label":"Global rules only"},{"value":"per_iata","label":"Global + per-IATA overrides"}]},"metarWatchNotifyRulesGlobal":{"type":"string","group":"METAR watch · notify rules","label":"Global rules (JSON, optional)","description":"Use the modal 'Alert rules' form instead. If you save the form, it overrides this string. Array of rules, OR empty. Example: [{\"metar\":{\"ceilingFtMax\":1000}},{\"taf\":{\"visibilitySmMax\":0.5}}].","default":""},"metarWatchNotifyRulesPerIata":{"type":"string","group":"METAR watch · notify rules","label":"Per-IATA rules (JSON, optional)","description":"Form overrides when saved. Example: {\"ATL\":[{\"metar\":{\"ceilingFtMax\":500}}]}.","default":""},"metarWatchDefaultStations":{"type":"string","group":"METAR watch","label":"Default stations (IATA)","description":"Comma-separated list used until you customize the list (same region as SW tooltip defaults).","default":"ATL,MDW,BWI,OAK,TPA,MCO,DAL,MKE,LAS,PHX,DEN,LAX,SAN,FLL,HOU"},"metarWatchShowRvr":{"type":"boolean","group":"METAR watch · panels","label":"Show FAA RVR","description":"Runway visual range. Turn off to hide the panel and stop FAA RVR requests.","default":true},"metarWatchFetchRvrInPoll":{"type":"boolean","group":"METAR watch · panels","label":"Fetch RVR during background poll","description":"When off (recommended if rvr.data.faa.gov blocks you), RVR loads only when the modal is open or you tap Refresh RVR.","default":false},"metarWatchShowDatis":{"type":"boolean","group":"METAR watch · panels","label":"Show Digital ATIS","description":"D-ATIS block (atis.info).","default":true},"metarWatchShowRadar":{"type":"boolean","group":"METAR watch · panels","label":"Show NWS radar loop","description":"Radar GIF from the nearest NWS site.","default":true},"metarWatchShowHrrr":{"type":"boolean","group":"METAR watch · panels","label":"Show hourly chart","description":"Temperature + PoP bars (source chosen below).","default":true},"metarWatchHrrrHourlySource":{"type":"select","group":"METAR watch · panels","label":"Hourly chart data source","description":"NOAA uses api.weather.gov grid hourly forecast at the airport. Open-Meteo uses a GFS blend (not pure HRRR).","default":"noaa","options":[{"value":"noaa","label":"NOAA (weather.gov hourly)"},{"value":"openmeteo","label":"Open-Meteo (GFS blend)"}]},"metarWatchShowAfd":{"type":"boolean","group":"METAR watch · panels","label":"Show Area Forecast Discussion","description":"AFD text from weather.gov for the airport WFO.","default":true},"metarWatchShowCodModelLoop":{"type":"boolean","group":"METAR watch · panels","label":"College of DuPage model loop","description":"Animated PNG loop from weather.cod.edu NEXLAB (public API). Default parms = RAP CONUS simulated reflectivity.","default":true},"metarWatchCodAutoSector":{"type":"boolean","group":"METAR watch · panels","label":"COD loop: auto region","description":"Pick nearest NEXLAB sector from airport lat/lon (HRRR). Turn off to use manual parms below.","default":true},"metarWatchCodLoopModel":{"type":"select","group":"METAR watch · panels","label":"COD loop model","description":"Used with auto region.","default":"HRRR","options":[{"value":"HRRR","label":"HRRR"},{"value":"RAP","label":"RAP"}]},"metarWatchCodModelParms":{"type":"string","group":"METAR watch · panels","label":"COD loop parms (manual)","description":"When auto region is off: full dash parms for get-files.php, e.g. current-HRRR-MW-prec-radar-1-0-100","default":"current-HRRR-MW-prec-radar-1-0-100"},"metarWatchCodLoopLoadTrigger":{"type":"select","group":"METAR watch · panels","label":"COD loop: when to load","description":"On station: fetch frames when you select an airport (no reload on 15s list refresh). Manual: only after you click Load (fastest modal).","default":"on_station","options":[{"value":"on_station","label":"When viewing a station"},{"value":"manual","label":"Manual (Load button)"}]},"metarWatchCodCachePollMinutes":{"type":"number","group":"METAR watch · panels","label":"COD cache: check new run (min)","description":"0 = only when you load the loop. Otherwise periodic JSON check; images re-download only when COD serves a new run.","default":3,"min":0,"max":60,"step":1},"metarWatchCodPrefetchSectors":{"type":"boolean","group":"METAR watch · panels","label":"COD: prefetch tracked sectors","description":"After each METAR poll, background-download COD frames once per NEXLAB sector covering your station list (same cache for all airports in that sector). Turn off to save bandwidth.","default":true},"metarWatchSharedPoll":{"type":"boolean","group":"METAR watch","label":"Sync alerts across tabs","description":"One tab leads background METAR/TAF polls; other tabs receive the same fetches and can share the leader’s alert/notification state. Reduces duplicate traffic. Best with the same station list.","default":true},"metarWatchTextHighlightSwStyle":{"type":"boolean","group":"METAR watch · text colors","label":"SW-style token colors in METAR/TAF","description":"In the detail panel, color tokens like the SW Airport tooltip (IFR red, MVFR orange, etc.). Optional notify-rule highlights still take priority.","default":true},"metarHighlightIFR":{"type":"boolean","group":"METAR watch · text colors","label":"·· Highlight IFR (ceiling/vis)","default":true},"metarHighlightMVFR":{"type":"boolean","group":"METAR watch · text colors","label":"·· Highlight MVFR","default":true},"metarHighlightCrosswind":{"type":"boolean","group":"METAR watch · text colors","label":"·· Highlight crosswind","default":true},"metarHighlightLLWS":{"type":"boolean","group":"METAR watch · text colors","label":"·· Highlight LLWS / WS","default":true},"metarHighlightIcing":{"type":"boolean","group":"METAR watch · text colors","label":"·· Highlight icing","default":true},"metarHighlightTS":{"type":"boolean","group":"METAR watch · text colors","label":"·· Highlight thunderstorms","default":true},"metarWatchModalStateJson":{"type":"string","group":"METAR watch · saved from modal","label":"Alert modal bundle (auto)","description":"Written when you save Notification alert conditions. Syncs via DonkeyCODE session storage.","default":""}}
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
    /** When BroadcastChannel is unavailable, leader writes poll payload here so other tabs can apply via storage event. */
    var LS_POLL_RESULTS = 'dc-metar-watch-poll-results-v1';
    /** In-modal “Alert rules” form overrides DonkeyCODE JSON string prefs when set. */
    var LS_NOTIFY_RULES_UI = 'dc-metar-watch-notify-rules-ui-v1';
    /** In-modal notify + timing (overrides DonkeyCODE defaults for this browser when set). */
    var LS_METAR_UI_SETTINGS = 'dc-metar-watch-ui-settings-v1';
    var LS_DATIS_MISSING = 'dc-metar-watch-datis-missing-v1';
    /** One-time: apply bundled DonkeyCODE modal snapshot if local storage was empty. */
    var LS_METAR_MODAL_BUNDLE_APPLIED = 'dc-metar-modal-bundle-pref-v1';
    var METAR_MODAL_BUNDLE_VERSION = 1;
    var lastAppliedPollResultsTs = 0;
    var SHARED_METAR_TAF_TTL_MS = 8 * 60 * 1000;
    var DATIS_MISSING_TTL_MS = 12 * 60 * 60 * 1000;
    var datisMissingCache = null;
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

    function readMetarWatchUi() {
        try {
            var raw = localStorage.getItem(LS_METAR_UI_SETTINGS);
            if (!raw) {
                return null;
            }
            var o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : null;
        } catch (e) {
            return null;
        }
    }

    function writeMetarWatchUi(obj) {
        try {
            localStorage.setItem(LS_METAR_UI_SETTINGS, JSON.stringify(obj));
        } catch (e) {}
    }

    function metarWatchNotifyEnabled() {
        var ui = readMetarWatchUi();
        if (ui && typeof ui.metarWatchNotify === 'boolean') {
            return ui.metarWatchNotify;
        }
        return boolPref('metarWatchNotify', true);
    }

    function metarPollMinutesEffective() {
        var ui = readMetarWatchUi();
        if (ui && ui.metarWatchPollMinutes != null) {
            var n = Math.floor(Number(ui.metarWatchPollMinutes));
            if (Number.isFinite(n)) {
                return Math.min(120, Math.max(1, n));
            }
        }
        return numPref('metarWatchPollMinutes', 5, 1, 120);
    }

    function metarConcurrentStationsEffective() {
        var ui = readMetarWatchUi();
        if (ui && ui.metarWatchConcurrentStations != null) {
            var n = Math.floor(Number(ui.metarWatchConcurrentStations));
            if (Number.isFinite(n)) {
                return Math.min(20, Math.max(1, n));
            }
        }
        return numPref('metarWatchConcurrentStations', 10, 1, 20);
    }

    function metarSharedPollEnabled() {
        var ui = readMetarWatchUi();
        if (ui && typeof ui.metarWatchSharedPoll === 'boolean') {
            return ui.metarWatchSharedPoll;
        }
        return boolPref('metarWatchSharedPoll', true);
    }

    function metarFetchDatisInBackground() {
        var ui = readMetarWatchUi();
        if (ui && typeof ui.metarWatchFetchDatisInBackground === 'boolean') {
            return ui.metarWatchFetchDatisInBackground;
        }
        return boolPref('metarWatchFetchDatisInBackground', false);
    }

    var DEFAULT_FRESH_MINUTES = 5;

    function metarWatchAlertFreshMinutes() {
        var ui = readMetarWatchUi();
        if (ui && ui.metarWatchAlertFreshMinutes != null) {
            var n = Math.floor(Number(ui.metarWatchAlertFreshMinutes));
            if (Number.isFinite(n)) {
                return Math.min(120, Math.max(1, n));
            }
        }
        return DEFAULT_FRESH_MINUTES;
    }

    function metarWatchFreshWindowMs() {
        return metarWatchAlertFreshMinutes() * 60 * 1000;
    }

    function metarWatchHighlightWithRulesWhenNotifyOff() {
        var ui = readMetarWatchUi();
        if (ui && typeof ui.metarWatchHighlightWithRulesWhenNotifyOff === 'boolean') {
            return ui.metarWatchHighlightWithRulesWhenNotifyOff;
        }
        return true;
    }

    function metarWatchNotifyOnColored() {
        var ui = readMetarWatchUi();
        if (ui && typeof ui.metarWatchNotifyOnColored === 'boolean') {
            return ui.metarWatchNotifyOnColored;
        }
        return true;
    }

    function metarWatchNotifyOnSpecial() {
        var ui = readMetarWatchUi();
        if (ui && typeof ui.metarWatchNotifyOnSpecial === 'boolean') {
            return ui.metarWatchNotifyOnSpecial;
        }
        return true;
    }

    function hasDefinedNotifyRules() {
        var uiR = readNotifyRulesUi();
        if (uiR) {
            var g = Array.isArray(uiR.global) ? uiR.global : [];
            if (g.length) {
                return true;
            }
            var p = uiR.perIata && typeof uiR.perIata === 'object' ? uiR.perIata : {};
            var k;
            for (k in p) {
                if (Object.prototype.hasOwnProperty.call(p, k) && p[k] && p[k].length) {
                    return true;
                }
            }
        }
        if (typeof donkeycodeGetPref !== 'function') {
            return false;
        }
        var dG = parseNotifyRulesArray(String(donkeycodeGetPref('metarWatchNotifyRulesGlobal') != null ? donkeycodeGetPref('metarWatchNotifyRulesGlobal') : ''));
        if (dG && dG.length) {
            return true;
        }
        var mP = parseNotifyRulesPerIataMap(donkeycodeGetPref('metarWatchNotifyRulesPerIata'));
        for (k in mP) {
            if (Object.prototype.hasOwnProperty.call(mP, k) && mP[k] && mP[k].length) {
                return true;
            }
        }
        return false;
    }

    function isSpecialMetarTaf(metar, taf) {
        var m = String(metar || '');
        var t = String(taf || '');
        if (m && /\bSPECI\b/i.test(m)) {
            return true;
        }
        if (t && /\b(TEMPO|BECMG|PROB\d+|FM\d{6})\b/.test(t)) {
            return true;
        }
        return false;
    }

    function shouldSendDesktopNotificationForContent(iata, rec) {
        if (!rec) {
            return false;
        }
        if (metarWatchNotifyOnSpecial() && isSpecialMetarTaf(rec.metar, rec.taf)) {
            return true;
        }
        if (metarWatchNotifyOnColored()) {
            var rules = mergeNotifyRulesForIata(iata);
            if (rules && rules.length) {
                return notifyRulesPassForStation(iata, rec);
            }
            return notifyRulesMode() === 'off';
        }
        return notifyRulesPassForStation(iata, rec);
    }

    function metarSwStylePrefKey(key) {
        var ui = readMetarWatchUi();
        if (ui && typeof ui[key] === 'boolean') {
            return ui[key];
        }
        return boolPref(key, true);
    }

    function sharedPollEnabled() {
        return metarSharedPollEnabled();
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
        if (!sharedPollEnabled() || !results || !results.length) {
            return;
        }
        var sig = stationList.slice().sort().join(',');
        var ts = Date.now();
        if (pollBroadcastChannel) {
            try {
                pollBroadcastChannel.postMessage({
                    type: 'poll-results',
                    tabId: tabInstanceId,
                    ts: ts,
                    results: results,
                    stationSig: sig
                });
            } catch (e) {}
        }
        try {
            localStorage.setItem(
                LS_POLL_RESULTS,
                JSON.stringify({
                    tabId: tabInstanceId,
                    ts: ts,
                    results: results,
                    stationSig: sig
                })
            );
        } catch (e) {}
    }

    function applySharedPollResults(results, remoteSig, ts) {
        if (!results || !results.length) {
            return;
        }
        if (typeof ts === 'number' && Number.isFinite(ts)) {
            if (ts <= lastAppliedPollResultsTs) {
                return;
            }
            lastAppliedPollResultsTs = ts;
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

    function tryApplyStoredPollResults() {
        if (!sharedPollEnabled()) {
            return;
        }
        try {
            var raw = localStorage.getItem(LS_POLL_RESULTS);
            if (!raw) {
                return;
            }
            var d = JSON.parse(raw);
            if (!d || !d.results || !d.results.length || typeof d.ts !== 'number') {
                return;
            }
            if (Date.now() - d.ts > 15 * 60 * 1000) {
                return;
            }
            if (d.tabId === tabInstanceId) {
                return;
            }
            applySharedPollResults(d.results, d.stationSig, d.ts);
        } catch (e) {}
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
                    applySharedPollResults(d.results, d.stationSig, d.ts);
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
            if (e && e.key === LS_POLL_RESULTS && e.newValue && sharedPollEnabled()) {
                try {
                    var d = JSON.parse(e.newValue);
                    if (d && d.tabId && d.tabId !== tabInstanceId && d.results) {
                        applySharedPollResults(d.results, d.stationSig, d.ts);
                    }
                } catch (e2) {}
            }
        };
        window.addEventListener('storage', onStorageLeader);
        onPageHidePoll = function () {
            releasePollLeadership();
        };
        window.addEventListener('pagehide', onPageHidePoll);
        tryApplyStoredPollResults();
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
        var now = Date.now();
        try {
            var store = readSharedMetarTafStore();
            store[icao] = { metar: String(metar || ''), taf: String(taf || ''), t: now };
            localStorage.setItem(LS_METAR_TAF_SHARED, JSON.stringify(store));
        } catch (e) {
            try {
                var store2 = readSharedMetarTafStore();
                store2[icao] = { metar: String(metar || ''), taf: String(taf || ''), t: now };
                localStorage.setItem(LS_METAR_TAF_SHARED, JSON.stringify(store2));
            } catch (e2) {}
        }
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

    /** Normalize for comparisons and cross-tab merge (avoids false NEW / stale from whitespace). */
    function normalizeMetarTafText(s) {
        return String(s || '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
    }

    function metarTafLooksEmpty(s) {
        var t = normalizeMetarTafText(s);
        return !t || t === 'N/A' || /^n\s*\/\s*a$/i.test(t);
    }

    /** Lowest BKN/OVC/VV ceiling in feet AGL from raw METAR text, or null if none. */
    function ceilingFtFromMetar(metar) {
        var s = String(metar || '').toUpperCase();
        var minH = Infinity;
        var re = /\b(BKN|OVC|VV)(\d{3})\b/g;
        var m;
        while ((m = re.exec(s)) !== null) {
            var h = parseInt(m[2], 10) * 100;
            if (h > 0 && h < 60000) {
                minH = Math.min(minH, h);
            }
        }
        return minH === Infinity ? null : minH;
    }

    /**
     * Same token shape in raw METAR/TAF (use on original string for indices; /gi).
     * Order: P…, M…, mixed 2 1/2, simple fraction, whole miles. Avoids turning 1 1/2 into 11/2.
     */
    var RE_VISIBILITY_SM = /\b(P\d+(?:\/\d+)?|M(?:\d+\s+)?\d+\/\d+|M\d+\/\d+|\d+\s+\d+\/\d+|\d+\/\d+|\d+)\s*SM\b/gi;

    /**
     * Parse one visibility run including optional SM. Mixed numbers: "1 1/2" → 1.5 (not 11/2).
     * P* = above; M* = below (NWS convention).
     */
    function parseOneVisToken(tok) {
        var t = String(tok || '')
            .toUpperCase()
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');
        if (!t) {
            return null;
        }
        t = t.replace(/SM$/i, '');
        t = t.replace(/^\s+|\s+$/g, '');
        if (!t) {
            return null;
        }
        if (t.charAt(0) === 'P') {
            t = t.substring(1);
            if (t.indexOf('/') >= 0) {
                var pfr = t.match(/^(\d+)\/(\d+)$/);
                if (pfr) {
                    return (
                        parseInt(pfr[1], 10) / parseInt(pfr[2], 10) + 0.01
                    );
                }
            }
            var pw = t.match(/^(\d+)$/);
            if (pw) {
                return parseInt(pw[1], 10) + 0.01;
            }
            return null;
        }
        if (t.charAt(0) === 'M') {
            t = t.substring(1);
            if (t.indexOf(' ') >= 0) {
                var mmx = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
                if (mmx) {
                    return (
                        parseInt(mmx[1], 10) +
                        parseInt(mmx[2], 10) / parseInt(mmx[3], 10) -
                        0.01
                    );
                }
            }
            var mf = t.match(/^(\d+)\/(\d+)$/);
            if (mf) {
                return (
                    parseInt(mf[1], 10) / parseInt(mf[2], 10) - 0.01
                );
            }
            return null;
        }
        if (t.indexOf(' ') > 0) {
            var mix = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
            if (mix) {
                return (
                    parseInt(mix[1], 10) + parseInt(mix[2], 10) / parseInt(mix[3], 10)
                );
            }
        }
        if (t.indexOf('/') >= 0) {
            var f = t.match(/^(\d+)\/(\d+)$/);
            if (f) {
                return parseInt(f[1], 10) / parseInt(f[2], 10);
            }
        }
        var w = t.match(/^(\d+)$/);
        if (w) {
            var n = parseInt(w[1], 10);
            if (n >= 1 && n <= 50) {
                return n;
            }
        }
        return null;
    }

    /**
     * Minimum reported visibility in statute miles found in TAF/METAR text (best-effort).
     * Handles e.g. 1/2SM, 2SM, P6SM, 1 1/2SM, M1/4SM.
     */
    function minVisibilitySmInText(txt) {
        var s = String(txt || '');
        var minV = Infinity;
        var re = new RegExp(RE_VISIBILITY_SM.source, 'gi');
        var m;
        while ((m = re.exec(s)) !== null) {
            var v = parseOneVisToken(m[0]);
            if (v !== null && Number.isFinite(v) && v >= 0 && v < 100) {
                minV = Math.min(minV, v);
            }
        }
        return minV === Infinity ? null : minV;
    }

    /**
     * Parse max visibility for notify rules (user input in modal). Accepts decimals and fractions: 0.5, 1/2, 1 1/2.
     */
    function parseVisMaxForRule(str) {
        var t = String(str == null ? '' : str)
            .trim()
            .replace(/\s+/g, ' ');
        if (!t) {
            return null;
        }
        if (Number.isFinite(Number(t)) && !/^\d+\s+\d/.test(t)) {
            var n0 = Number(t);
            if (n0 >= 0 && n0 < 100) {
                return n0;
            }
        }
        var p = parseOneVisToken(t + (/\bSM$/i.test(t) ? '' : 'SM'));
        if (p !== null && Number.isFinite(p) && p >= 0 && p < 100) {
            return p;
        }
        return null;
    }

    var DEFAULT_COLOR_HIGH = '#c0392b';
    var DEFAULT_COLOR_ADVISORY = '#d68910';
    var DEFAULT_COLOR_CUSTOM = '#9b59b6';

    function normalizeRuleHex(s) {
        if (s == null || s === undefined) {
            return '';
        }
        var t = String(s).trim();
        if (!t) {
            return '';
        }
        if (/^#[0-9A-Fa-f]{6}$/.test(t)) {
            return t;
        }
        if (/^#[0-9A-Fa-f]{3}$/.test(t)) {
            return '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3] + t[4] + t[4];
        }
        return '';
    }

    function findCeilingTokenRanges(text) {
        var s = String(text || '');
        var out = [];
        var re = /\b(BKN|OVC|VV)(\d{3})\b/gi;
        var m;
        while ((m = re.exec(s)) !== null) {
            var h = parseInt(m[2], 10) * 100;
            if (h > 0 && h < 60000) {
                out.push({ start: m.index, end: m.index + m[0].length, kind: 'ceil', h: h });
            }
        }
        return out;
    }

    /** Full \d...SM / fraction visibility tokens only (not lone digits in fractions). */
    function findVisibilityTokenRanges(text) {
        var s = String(text || '');
        var out = [];
        var re = new RegExp(RE_VISIBILITY_SM.source, 'gi');
        var m;
        while ((m = re.exec(s)) !== null) {
            var p = parseOneVisToken(m[0]);
            if (p === null || !Number.isFinite(p) || p < 0 || p >= 100) {
                continue;
            }
            out.push({ start: m.index, end: m.index + m[0].length, sm: p });
        }
        return out;
    }

    function parseRuleLevel(rule) {
        if (!rule || typeof rule !== 'object') {
            return 'advisory';
        }
        var l = String(rule.level || 'advisory').toLowerCase();
        if (l === 'high' || l === 'custom' || l === 'priority') {
            return l;
        }
        return 'advisory';
    }

    function parseRuleColor(rule) {
        if (!rule || typeof rule !== 'object' || !rule.color) {
            return '';
        }
        return normalizeRuleHex(rule.color) || '';
    }

    function ruleHighlightPriority(rule) {
        var lv = parseRuleLevel(rule);
        if (lv === 'high') {
            return 3;
        }
        if (lv === 'priority' || lv === 'custom') {
            return 2;
        }
        return 1;
    }

    function metarTafPartHasExtraConstraints(part) {
        if (!part || typeof part !== 'object') {
            return false;
        }
        if (part.requireTs) {
            return true;
        }
        if (part.requireLlws) {
            return true;
        }
        if (part.speciOnly) {
            return true;
        }
        if (String(part.textContains == null ? '' : part.textContains).trim().length) {
            return true;
        }
        return false;
    }

    function metarTafPartExtraPass(part, text) {
        if (!part || typeof part !== 'object' || !String(text || '').length) {
            return !metarTafPartHasExtraConstraints(part);
        }
        if (!metarTafPartHasExtraConstraints(part)) {
            return true;
        }
        var u = String(text || '').toUpperCase();
        if (part.speciOnly) {
            if (u.indexOf('TAF') >= 0) {
                if (!/\b(PROB|BECMG|FM\d|TEMPO)\b/.test(String(text)) && u.indexOf('TEMPO') < 0) {
                    return false;
                }
            } else if (u.indexOf('SPECI') < 0) {
                return false;
            }
        }
        if (part.requireTs) {
            if (!/\b(TS|TSRA|VCTS|TSTM|TSNO)\b/i.test(String(text)) && !/[-+]TS/.test(String(text))) {
                return false;
            }
        }
        if (part.requireLlws) {
            if (u.indexOf('LLWS') < 0 && u.indexOf('LO LV') < 0 && u.indexOf('W/S') < 0) {
                return false;
            }
        }
        var tsub = String(part.textContains == null ? '' : part.textContains).trim();
        if (tsub.length) {
            if (String(text || '').toLowerCase().indexOf(tsub.toLowerCase()) < 0) {
                return false;
            }
        }
        return true;
    }

    function effectiveHighlightColorForRule(rule) {
        var custom = parseRuleColor(rule);
        if (custom) {
            return custom;
        }
        var ui = readNotifyRulesUi();
        var h = (ui && ui.colorHigh) || DEFAULT_COLOR_HIGH;
        var a = (ui && ui.colorAdvisory) || DEFAULT_COLOR_ADVISORY;
        var c = (ui && ui.colorCustom) || DEFAULT_COLOR_CUSTOM;
        var p = (ui && ui.colorPriority) || h;
        var lv = parseRuleLevel(rule);
        if (lv === 'high') {
            return h;
        }
        if (lv === 'custom') {
            return c;
        }
        if (lv === 'priority') {
            return p;
        }
        return a;
    }

    function partHasCigOrVis(rm) {
        if (!rm || typeof rm !== 'object') {
            return false;
        }
        return (
            (rm.ceilingFtMax != null && Number.isFinite(Number(rm.ceilingFtMax))) ||
            (rm.visibilitySmMax != null && Number.isFinite(Number(rm.visibilitySmMax)))
        );
    }

    function partMatchesMetarTaf(rm, text) {
        if (!rm || typeof rm !== 'object' || !String(text || '').length) {
            return false;
        }
        if (partHasCigOrVis(rm)) {
            if (rm.ceilingFtMax != null && Number.isFinite(Number(rm.ceilingFtMax))) {
                var c = ceilingFtFromMetar(text);
                if (c === null || c > Number(rm.ceilingFtMax)) {
                    return false;
                }
            }
            if (rm.visibilitySmMax != null) {
                var maxVsM = Number(rm.visibilitySmMax);
                if (Number.isFinite(maxVsM)) {
                    var vm = minVisibilitySmInText(text);
                    if (vm === null || vm > maxVsM) {
                        return false;
                    }
                }
            }
        } else {
            if (!metarTafPartHasExtraConstraints(rm)) {
                return true;
            }
        }
        return metarTafPartExtraPass(rm, text);
    }

    function ruleMatchesOne(rule, metar, taf) {
        if (!rule || typeof rule !== 'object') {
            return false;
        }
        if (!rule.metar && !rule.taf) {
            return false;
        }
        var mStr = String(metar || '');
        var tStr = String(taf || '');
        var hasM = mStr.length > 0;
        var hasT = tStr.length > 0;
        var okM = true;
        if (rule.metar && typeof rule.metar === 'object') {
            if (!hasM) {
                okM = false;
            } else {
                okM = partMatchesMetarTaf(rule.metar, mStr);
            }
        } else {
            okM = true;
        }
        var okT = true;
        if (rule.taf && typeof rule.taf === 'object') {
            if (!hasT) {
                okT = false;
            } else {
                okT = partMatchesMetarTaf(rule.taf, tStr);
            }
        } else {
            okT = true;
        }
        if (rule.metar && rule.taf) {
            return okM && okT;
        }
        if (rule.metar) {
            return okM;
        }
        if (rule.taf) {
            return okT;
        }
        return false;
    }

    function ruleAppliesToSection(rule, which, text) {
        if (!rule || !text) {
            return false;
        }
        var p = which === 'metar' ? rule.metar : rule.taf;
        if (!p || typeof p !== 'object') {
            return false;
        }
        if (which === 'metar') {
            return ruleMatchesOne({ metar: p, taf: null }, text, '');
        }
        return ruleMatchesOne({ metar: null, taf: p }, '', text);
    }

    function findHighlightSpansForText(rawText, which, rules) {
        var s = String(rawText || '');
        if (!s || !rules || !rules.length) {
            return [];
        }
        var spans = [];
        var ri;
        for (ri = 0; ri < rules.length; ri++) {
            var rule = rules[ri];
            if (!ruleAppliesToSection(rule, which, s)) {
                continue;
            }
            var col = effectiveHighlightColorForRule(rule);
            if (!col) {
                continue;
            }
            var part = which === 'metar' ? rule.metar : rule.taf;
            if (!part || typeof part !== 'object') {
                continue;
            }
            if (part.ceilingFtMax != null && Number.isFinite(Number(part.ceilingFtMax))) {
                var maxCeil = Number(part.ceilingFtMax);
                var cra = findCeilingTokenRanges(s);
                var ci;
                for (ci = 0; ci < cra.length; ci++) {
                    if (cra[ci].h > 0 && cra[ci].h <= maxCeil) {
                        spans.push({
                            start: cra[ci].start,
                            end: cra[ci].end,
                            color: col,
                            pri: ruleHighlightPriority(rule),
                            label: notifyRuleLineForTooltip(ri, rule, which, 'ceiling', maxCeil)
                        });
                    }
                }
            }
            if (part.visibilitySmMax != null && Number.isFinite(Number(part.visibilitySmMax))) {
                var maxVis = Number(part.visibilitySmMax);
                var vra = findVisibilityTokenRanges(s);
                var vi;
                for (vi = 0; vi < vra.length; vi++) {
                    if (vra[vi].sm != null && vra[vi].sm <= maxVis) {
                        spans.push({
                            start: vra[vi].start,
                            end: vra[vi].end,
                            color: col,
                            pri: ruleHighlightPriority(rule),
                            label: notifyRuleLineForTooltip(ri, rule, which, 'vis', maxVis)
                        });
                    }
                }
            }
        }
        return resolveOverlappingHighlightSpans(spans);
    }

    function resolveOverlappingHighlightSpans(spans) {
        if (!spans.length) {
            return [];
        }
        var sorted = spans
            .filter(function (x) {
                return x && x.end > x.start;
            })
            .sort(function (a, b) {
                if (a.start !== b.start) {
                    return a.start - b.start;
                }
                if ((b.pri || 0) !== (a.pri || 0)) {
                    return (b.pri || 0) - (a.pri || 0);
                }
                return b.end - a.end;
            });
        var out = [];
        var i;
        for (i = 0; i < sorted.length; i++) {
            var sp = sorted[i];
            var j;
            var skip = false;
            for (j = 0; j < out.length; j++) {
                var o = out[j];
                if (sp.start >= o.start && sp.end <= o.end) {
                    skip = true;
                    break;
                }
            }
            if (!skip) {
                out.push({
                    start: sp.start,
                    end: sp.end,
                    color: sp.color,
                    label: sp.label
                });
            }
        }
        out.sort(function (a, b) {
            return a.start - b.start;
        });
        return out;
    }

    /** SW Airport tooltip: same default hex values for IFR, MVFR, and weather tokens. */
    var SW_STYLE_ALERT_COLORS = {
        ifr: '#ff4d4d',
        mvfr: '#ffa500',
        crosswind: '#00ff00',
        llws: '#ff00ff',
        icing: '#1e90ff',
        ts: '#ffff00'
    };

    /** One-line `title` for SW-style token underlines (no "SW style" prefix). */
    var SW_STYLE_HOVER = {
        ifr: 'IFR (ceiling/visibility)',
        mvfr: 'MVFR',
        crosswind: 'Strong gust (crosswind)',
        llws: 'Low-level wind shear (LLWS/WS)',
        icing: 'Freezing precip / ice',
        ts: 'Thunderstorm (TS/TSRA/VCTS)'
    };

    function swStyleTooltipForClass(cls) {
        if (!cls) {
            return '';
        }
        return SW_STYLE_HOVER[cls] || '';
    }

    function notifyRuleLineForTooltip(ri, rule, which, kind, maxVal) {
        var n = (Number(ri) >= 0 ? Number(ri) + 1 : 0);
        var pre = n ? 'Notify rule ' + n + ' — ' : 'Notify rule — ';
        var section = which === 'metar' ? 'METAR' : 'TAF';
        var lv = parseRuleLevel(rule);
        var L =
            lv === 'high' ? 'High' : lv === 'custom' ? 'Custom' : lv === 'priority' ? 'Priority' : 'Advisory';
        var base = pre + section + ' · ' + L;
        if (kind === 'ceiling') {
            return base + ': ceiling ≤ ' + String(maxVal) + ' ft';
        }
        if (kind === 'vis') {
            return base + ': visibility ≤ ' + String(maxVal) + ' SM';
        }
        return base;
    }

    function allowSwStyleHighlightClass(cls) {
        if (!cls) {
            return null;
        }
        var map = {
            ifr: 'metarHighlightIFR',
            mvfr: 'metarHighlightMVFR',
            crosswind: 'metarHighlightCrosswind',
            llws: 'metarHighlightLLWS',
            icing: 'metarHighlightIcing',
            ts: 'metarHighlightTS'
        };
        var pk = map[cls];
        if (!pk) {
            return cls;
        }
        return metarSwStylePrefKey(pk) ? cls : null;
    }

    function parseVisibilityTokenForSwStyle(token) {
        var t = String(token || '');
        if (!t.endsWith('SM')) {
            return null;
        }
        t = t.replace(/SM$/i, '');
        if (t.indexOf('M') === 0) {
            t = t.substring(1);
        }
        var pInd = t.indexOf('P') === 0;
        if (pInd) {
            t = t.substring(1);
        }
        var n;
        if (t.indexOf(' ') >= 0) {
            var parts = t.split(/\s+/);
            var whole = parseFloat(parts[0]);
            var fr = parts[1] ? parseSwFraction(parts[1]) : null;
            n =
                !isNaN(whole) && fr !== null
                    ? whole + fr
                    : isNaN(whole)
                      ? null
                      : whole;
        } else {
            n = parseSwFraction(t);
            if (n === null) {
                n = parseFloat(t);
            }
        }
        if (n === null || isNaN(n) || !Number.isFinite(n)) {
            return null;
        }
        if (pInd) {
            n += 0.01;
        } else if (String(token).indexOf('M') === 0) {
            n -= 0.01;
        }
        if (n < 0) {
            n = 0;
        }
        return n;
    }

    function parseSwFraction(str) {
        if (!str || String(str).indexOf('/') < 0) {
            return null;
        }
        var p = String(str).split('/');
        var nu = parseFloat(p[0]);
        var de = parseFloat(p[1]);
        if (isNaN(nu) || isNaN(de) || de === 0) {
            return null;
        }
        return nu / de;
    }

    /**
     * One METAR line token — mirrors SW Airport tooltip `classifyToken` (ceiling, vis, gust, LLWS, icing, TS).
     */
    function swStyleClassifyTokenMetar(word, fullLine) {
        var w = String(word);
        var line = String(fullLine);
        var m;
        m = w.match(/^(BKN|OVC)(\d{3})$/i);
        if (m) {
            var ceil1 = parseInt(m[2], 10) * 100;
            if (ceil1 < 1000) {
                return allowSwStyleHighlightClass('ifr');
            }
            if (ceil1 <= 3000) {
                return allowSwStyleHighlightClass('mvfr');
            }
        }
        var vis = parseVisibilityTokenForSwStyle(w);
        if (vis !== null) {
            if (vis < 3) {
                return allowSwStyleHighlightClass('ifr');
            }
            if (vis <= 5) {
                return allowSwStyleHighlightClass('mvfr');
            }
        }
        m = w.match(/G(\d{2,3})KT/i);
        if (m) {
            var g = parseInt(m[1], 10);
            if (line.match(/^\d{3}\d{2,3}G?\d{0,2}KT/i) && g > 25) {
                return allowSwStyleHighlightClass('crosswind');
            }
        }
        if (
            w === 'LLWS' ||
            w === 'WS' ||
            w.indexOf('LLWS') === 0 ||
            (w.length <= 5 && w.indexOf('LLWS') >= 0)
        ) {
            return allowSwStyleHighlightClass('llws');
        }
        if (w.match(/FZRA|FZDZ|SN|PL/i)) {
            return allowSwStyleHighlightClass('icing');
        }
        if (w.match(/TS|TSRA|VCTS/i)) {
            return allowSwStyleHighlightClass('ts');
        }
        return null;
    }

    /**
     * TAF line token (same as SW: line-scoped, no fixed airport custom alerts here).
     */
    function swStyleClassifyTokenTaf(word, fullLine) {
        return swStyleClassifyTokenMetar(word, fullLine);
    }

    function findSwStyleVisibilitySpansMetar(s) {
        var out = [];
        if (!s) {
            return out;
        }
        var re = new RegExp(RE_VISIBILITY_SM.source, 'gi');
        var m;
        while ((m = re.exec(s)) !== null) {
            var vis = parseOneVisToken(m[0]);
            if (vis === null || !Number.isFinite(vis)) {
                continue;
            }
            var cls = null;
            if (vis < 3) {
                cls = allowSwStyleHighlightClass('ifr');
            } else if (vis <= 5) {
                cls = allowSwStyleHighlightClass('mvfr');
            }
            if (cls && SW_STYLE_ALERT_COLORS[cls]) {
                out.push({
                    start: m.index,
                    end: m.index + m[0].length,
                    color: SW_STYLE_ALERT_COLORS[cls],
                    pri: 0,
                    label: swStyleTooltipForClass(cls)
                });
            }
        }
        return out;
    }

    function charInsideVisibilitySpan(idx, visSpans) {
        var v;
        for (v = 0; v < visSpans.length; v++) {
            var spv = visSpans[v];
            if (idx >= spv.start && idx < spv.end) {
                return true;
            }
        }
        return false;
    }

    function findSwStyleHighlightSpans(plain, which) {
        if (!metarSwStylePrefKey('metarWatchTextHighlightSwStyle')) {
            return [];
        }
        var s = String(plain || '');
        if (!s) {
            return [];
        }
        var tafMode = which === 'taf';
        var visSpMetar = !tafMode ? findSwStyleVisibilitySpansMetar(s) : [];
        var re = /([^\s\u00a0\n\r]+)/g;
        var m;
        var spans = visSpMetar.length ? visSpMetar.slice() : [];
        m = re.exec(s);
        while (m) {
            var w = m[1];
            var start = m.index;
            var end = start + w.length;
            if (!tafMode && charInsideVisibilitySpan(start, visSpMetar)) {
                m = re.exec(s);
                continue;
            }
            var lineStart;
            if (tafMode) {
                lineStart = s.lastIndexOf('\n', start);
                lineStart = lineStart < 0 ? 0 : lineStart + 1;
            } else {
                lineStart = 0;
            }
            var lineEnd;
            if (tafMode) {
                lineEnd = s.indexOf('\n', start);
                if (lineEnd < 0) {
                    lineEnd = s.length;
                }
            } else {
                lineEnd = s.length;
            }
            var fullLine = s.slice(lineStart, lineEnd);
            var cls = tafMode
                ? swStyleClassifyTokenTaf(w, fullLine)
                : swStyleClassifyTokenMetar(w, s);
            if (cls && SW_STYLE_ALERT_COLORS[cls]) {
                var swLab = swStyleTooltipForClass(cls);
                if (tafMode) {
                    spans.push({
                        start: start,
                        end: end,
                        color: SW_STYLE_ALERT_COLORS[cls],
                        pri: 0,
                        label: swLab
                    });
                } else {
                    if (!parseVisibilityTokenForSwStyle(w)) {
                        spans.push({
                            start: start,
                            end: end,
                            color: SW_STYLE_ALERT_COLORS[cls],
                            pri: 0,
                            label: swLab
                        });
                    }
                }
            }
            m = re.exec(s);
        }
        return resolveOverlappingHighlightSpans(spans);
    }

    function mergeRuleSpansWithSwSpans(ruleSpans, swSpans) {
        if (!swSpans || !swSpans.length) {
            return ruleSpans || [];
        }
        if (!ruleSpans || !ruleSpans.length) {
            return swSpans;
        }
        var outM = ruleSpans.slice();
        var j;
        var j2;
        for (j = 0; j < swSpans.length; j++) {
            var sw = swSpans[j];
            var ovl = false;
            for (j2 = 0; j2 < ruleSpans.length; j2++) {
                var u = ruleSpans[j2];
                if (u && sw && sw.start < u.end && sw.end > u.start) {
                    ovl = true;
                    break;
                }
            }
            if (!ovl) {
                outM.push(sw);
            }
        }
        return outM;
    }

    function shouldUseNotifyRulesForHighlights(rules) {
        if (notifyRulesMode() !== 'off' && rules && rules.length) {
            return true;
        }
        return metarWatchHighlightWithRulesWhenNotifyOff() && rules && rules.length;
    }

    function applyMetarTafMetarBlockHighlights(plainLinesJoined, iata) {
        var s = String(plainLinesJoined || '');
        var rules = mergeNotifyRulesForIata(iata);
        var useRules = shouldUseNotifyRulesForHighlights(rules);
        if (!useRules && !metarSwStylePrefKey('metarWatchTextHighlightSwStyle')) {
            return escapeHtml(s).replace(/\n/g, '<br>');
        }
        return applyHighlightsToPlainString(
            s,
            useRules ? rules : [],
            'metar',
            iata
        );
    }

    function applyMetarTafTafBlockHighlights(plainTaf, iata) {
        var s = String(plainTaf || '');
        var rules = mergeNotifyRulesForIata(iata);
        var useRules = shouldUseNotifyRulesForHighlights(rules);
        if (!useRules && !metarSwStylePrefKey('metarWatchTextHighlightSwStyle')) {
            return escapeHtml(s).replace(/\n/g, '<br>');
        }
        return applyHighlightsToPlainString(
            s,
            useRules ? rules : [],
            'taf',
            iata
        );
    }

    function applyHighlightsToPlainString(s, rules, block, iata) {
        if (!s) {
            return '';
        }
        iata = iata || '';
        var which = block === 'taf' ? 'taf' : 'metar';
        var hSpans = [];
        if (shouldUseNotifyRulesForHighlights(rules)) {
            hSpans = hSpans.concat(findHighlightSpansForText(s, which, rules));
        }
        var swSpans = [];
        if (metarSwStylePrefKey('metarWatchTextHighlightSwStyle')) {
            swSpans = findSwStyleHighlightSpans(s, which);
        }
        hSpans = mergeRuleSpansWithSwSpans(hSpans, swSpans);
        if (!hSpans.length) {
            return escapeHtml(s).replace(/\n/g, '<br>');
        }
        hSpans.sort(function (a, b) {
            if (a.start !== b.start) {
                return a.start - b.start;
            }
            return (a.end || 0) - (b.end || 0);
        });
        var out = '';
        var pos = 0;
        var b;
        for (b = 0; b < hSpans.length; b++) {
            var sp = hSpans[b];
            if (sp.start > pos) {
                out += escapeHtml(s.slice(pos, sp.start));
            }
            var tip = sp.label ? ' title="' + escapeHtml(String(sp.label)) + '"' : '';
            out +=
                '<mark' +
                tip +
                ' style="background:transparent;padding:0 1px;border-radius:2px;box-shadow:inset 0 -2px 0 ' +
                escapeHtml(sp.color) +
                ';color:' +
                escapeHtml(sp.color) +
                ';">' +
                escapeHtml(s.slice(sp.start, sp.end)) +
                '</mark>';
            pos = sp.end;
        }
        if (pos < s.length) {
            out += escapeHtml(s.slice(pos));
        }
        return out.replace(/\n/g, '<br>');
    }

    function parseNotifyRulesArray(str) {
        var t = String(str || '').trim();
        if (!t) {
            return [];
        }
        try {
            var a = JSON.parse(t);
            return Array.isArray(a) ? a : [];
        } catch (e) {
            return [];
        }
    }

    function parseNotifyRulesPerIataMap(str) {
        try {
            var o = JSON.parse(String(str || '').trim() || '{}');
            return o && typeof o === 'object' ? o : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Optional in-modal rules (localStorage). When present, overrides DonkeyCODE JSON string prefs
     * so users can edit conditions without hand-writing JSON.
     */
    function readNotifyRulesUi() {
        try {
            var raw = localStorage.getItem(LS_NOTIFY_RULES_UI);
            if (!raw) {
                return null;
            }
            var o = JSON.parse(raw);
            if (!o || typeof o !== 'object') {
                return null;
            }
            var g = o.global;
            var globalArr = Array.isArray(g) ? g : [];
            var per = o.perIata;
            var perMap = per && typeof per === 'object' ? per : {};
            var mode;
            if ('mode' in o) {
                mode = String(o.mode || 'off').toLowerCase();
                if (mode !== 'off' && mode !== 'global' && mode !== 'per_iata') {
                    mode = 'off';
                }
            } else {
                var pk0 = perMap && typeof perMap === 'object' ? Object.keys(perMap) : [];
                if (pk0.length) {
                    mode = 'per_iata';
                } else if (globalArr && globalArr.length) {
                    mode = 'global';
                } else {
                    mode = 'off';
                }
            }
            var ch = normalizeRuleHex(o.colorHigh) || DEFAULT_COLOR_HIGH;
            var ca = normalizeRuleHex(o.colorAdvisory) || DEFAULT_COLOR_ADVISORY;
            var cc = normalizeRuleHex(o.colorCustom) || DEFAULT_COLOR_CUSTOM;
            var cp = normalizeRuleHex(o.colorPriority) || DEFAULT_COLOR_HIGH;
            if (mode === 'off') {
                if (perMap && typeof perMap === 'object') {
                    var pk1 = Object.keys(perMap);
                    if (pk1.length) {
                        mode = 'per_iata';
                    }
                }
            }
            if (mode === 'off' && globalArr && globalArr.length) {
                mode = 'global';
            }
            return {
                mode: mode,
                global: globalArr,
                perIata: perMap,
                colorHigh: ch,
                colorAdvisory: ca,
                colorCustom: cc,
                colorPriority: cp
            };
        } catch (e) {
            return null;
        }
    }

    function writeNotifyRulesUi(obj) {
        try {
            localStorage.setItem(LS_NOTIFY_RULES_UI, JSON.stringify(obj));
        } catch (e) {}
    }

    function clearNotifyRulesUi() {
        try {
            localStorage.removeItem(LS_NOTIFY_RULES_UI);
        } catch (e) {}
    }

    function buildMetarModalStateBundle() {
        return {
            v: METAR_MODAL_BUNDLE_VERSION,
            ui: readMetarWatchUi() || {},
            rules: readNotifyRulesUi() || null
        };
    }

    function tryDonkeycodeSetScriptPref(key, value) {
        if (value === undefined) {
            return;
        }
        var g = typeof globalThis !== 'undefined' ? globalThis : window;
        var names = [
            'donkeycodeSetPref',
            'donkeycodeSetUserPref',
            'donkeycodeScriptSetPref',
            'dcSetPref'
        ];
        var ni;
        for (ni = 0; ni < names.length; ni++) {
            if (typeof g[names[ni]] === 'function') {
                try {
                    g[names[ni]](key, value);
                    return;
                } catch (e) {}
            }
        }
    }

    function tryDonkeycodeRequestPreferenceSync() {
        var w = window;
        var payload = { type: 'donkeycode:save-prefs' };
        try {
            w.postMessage(payload, '*');
        } catch (e1) {}
        try {
            w.postMessage({ source: 'donkeycode', action: 'savePreferences' }, '*');
        } catch (e0b) {}
        if (w.parent && w.parent !== w) {
            try {
                w.parent.postMessage(payload, '*');
            } catch (e2) {}
        }
    }

    function applyMetarModalStateBundle(b) {
        if (!b || b.v !== METAR_MODAL_BUNDLE_VERSION) {
            return;
        }
        if (b.ui && typeof b.ui === 'object') {
            try {
                localStorage.setItem(LS_METAR_UI_SETTINGS, JSON.stringify(b.ui));
            } catch (e) {}
        }
        if (b.rules && typeof b.rules === 'object') {
            try {
                localStorage.setItem(LS_NOTIFY_RULES_UI, JSON.stringify(b.rules));
            } catch (e2) {}
        }
    }

    function pushNotifyRulesToLegacyStringPrefs(rules) {
        if (!rules || typeof rules !== 'object' || typeof donkeycodeGetPref !== 'function') {
            return;
        }
        var mode = String(rules.mode || 'off');
        var g = Array.isArray(rules.global) ? rules.global : [];
        var p = rules.perIata && typeof rules.perIata === 'object' ? rules.perIata : {};
        try {
            tryDonkeycodeSetScriptPref('metarWatchNotifyRulesMode', mode);
            tryDonkeycodeSetScriptPref('metarWatchNotifyRulesGlobal', JSON.stringify(g));
            tryDonkeycodeSetScriptPref('metarWatchNotifyRulesPerIata', JSON.stringify(p));
        } catch (e) {}
    }

    function pushMetarModalStateToDonkeycodePrefs() {
        if (typeof donkeycodeGetPref !== 'function') {
            return;
        }
        var b = buildMetarModalStateBundle();
        var json;
        try {
            json = JSON.stringify(b);
        } catch (e) {
            return;
        }
        tryDonkeycodeSetScriptPref('metarWatchModalStateJson', json);
        if (b.rules) {
            pushNotifyRulesToLegacyStringPrefs(b.rules);
        }
        var ui = b.ui;
        if (ui && typeof ui === 'object') {
            if (ui.metarWatchNotify != null) {
                tryDonkeycodeSetScriptPref('metarWatchNotify', !!ui.metarWatchNotify);
            }
            if (ui.metarWatchPollMinutes != null) {
                tryDonkeycodeSetScriptPref('metarWatchPollMinutes', Math.floor(Number(ui.metarWatchPollMinutes)) || 5);
            }
            if (ui.metarWatchConcurrentStations != null) {
                tryDonkeycodeSetScriptPref('metarWatchConcurrentStations', Math.floor(Number(ui.metarWatchConcurrentStations)) || 10);
            }
            if (ui.metarWatchSharedPoll != null) {
                tryDonkeycodeSetScriptPref('metarWatchSharedPoll', !!ui.metarWatchSharedPoll);
            }
            if (ui.metarWatchFetchDatisInBackground != null) {
                tryDonkeycodeSetScriptPref('metarWatchFetchDatisInBackground', !!ui.metarWatchFetchDatisInBackground);
            }
        }
        tryDonkeycodeRequestPreferenceSync();
    }

    function migrateMetarModalBundleFromPrefs() {
        try {
            if (localStorage.getItem(LS_METAR_MODAL_BUNDLE_APPLIED)) {
                return;
            }
        } catch (e) {
            return;
        }
        if (typeof donkeycodeGetPref !== 'function') {
            return;
        }
        var hasLocal =
            (function () {
                try {
                    return (
                        (localStorage.getItem(LS_METAR_UI_SETTINGS) && localStorage.getItem(LS_METAR_UI_SETTINGS).length > 2) ||
                        localStorage.getItem(LS_NOTIFY_RULES_UI)
                    );
                } catch (e2) {
                    return true;
                }
            })();
        if (hasLocal) {
            try {
                localStorage.setItem(LS_METAR_MODAL_BUNDLE_APPLIED, '1');
            } catch (e3) {}
            return;
        }
        var raw = String(donkeycodeGetPref('metarWatchModalStateJson', '') || '').trim();
        if (!raw) {
            try {
                localStorage.setItem(LS_METAR_MODAL_BUNDLE_APPLIED, '1');
            } catch (e4) {}
            return;
        }
        try {
            var o = JSON.parse(raw);
            if (o && o.v === METAR_MODAL_BUNDLE_VERSION) {
                applyMetarModalStateBundle(o);
            }
        } catch (e5) {}
        try {
            localStorage.setItem(LS_METAR_MODAL_BUNDLE_APPLIED, '1');
        } catch (e6) {}
    }

    function ruleToRowValues(rule) {
        var o = {
            level: 'advisory',
            useCustomColor: false,
            customColor: '#888888',
            mC: '',
            mV: '',
            mTs: false,
            mLws: false,
            mTxt: '',
            mSpeci: false,
            tC: '',
            tV: '',
            tTs: false,
            tLws: false,
            tTxt: '',
            tSpeci: false
        };
        if (!rule || typeof rule !== 'object') {
            return o;
        }
        var pl = parseRuleLevel(rule);
        o.level = pl === 'high' || pl === 'custom' || pl === 'priority' ? pl : 'advisory';
        var pc = parseRuleColor(rule);
        if (pc) {
            o.useCustomColor = true;
            o.customColor = pc;
        }
        if (rule.metar && typeof rule.metar === 'object') {
            var m = rule.metar;
            if (m.ceilingFtMax != null && Number.isFinite(Number(m.ceilingFtMax))) {
                o.mC = String(m.ceilingFtMax);
            }
            if (m.visibilitySmMax != null && Number.isFinite(Number(m.visibilitySmMax))) {
                o.mV = String(m.visibilitySmMax);
            }
            o.mTs = !!m.requireTs;
            o.mLws = !!m.requireLlws;
            o.mSpeci = !!m.speciOnly;
            o.mTxt = m.textContains != null ? String(m.textContains) : '';
        }
        if (rule.taf && typeof rule.taf === 'object') {
            var t = rule.taf;
            if (t.ceilingFtMax != null && Number.isFinite(Number(t.ceilingFtMax))) {
                o.tC = String(t.ceilingFtMax);
            }
            if (t.visibilitySmMax != null && Number.isFinite(Number(t.visibilitySmMax))) {
                o.tV = String(t.visibilitySmMax);
            }
            o.tTs = !!t.requireTs;
            o.tLws = !!t.requireLlws;
            o.tSpeci = !!t.speciOnly;
            o.tTxt = t.textContains != null ? String(t.textContains) : '';
        }
        return o;
    }

    function rowValuesToRule(inp) {
        if (!inp || typeof inp !== 'object') {
            return null;
        }
        var rule = {};
        var lvs = String((inp.level != null && inp.level.value) || 'advisory').toLowerCase();
        if (lvs === 'high' || lvs === 'custom' || lvs === 'priority') {
            rule.level = lvs;
        } else {
            rule.level = 'advisory';
        }
        if (inp.useCustomColor && inp.useCustomColor.checked && normalizeRuleHex(inp.customColor && inp.customColor.value)) {
            rule.color = normalizeRuleHex(inp.customColor.value);
        }
        function buildPart(ceil, vis, ts, lws, txt, spec) {
            var p = {};
            var mc = String(ceil == null ? '' : ceil).trim();
            var mv = String(vis == null ? '' : vis).trim();
            if (mc.length && Number.isFinite(Number(mc))) {
                p.ceilingFtMax = Number(mc);
            }
            if (mv.length) {
                var pvm = parseVisMaxForRule(mv);
                if (pvm != null) {
                    p.visibilitySmMax = pvm;
                }
            }
            if (ts && ts.checked) {
                p.requireTs = true;
            }
            if (lws && lws.checked) {
                p.requireLlws = true;
            }
            if (spec && spec.checked) {
                p.speciOnly = true;
            }
            var tx = String(txt == null ? '' : txt).trim();
            if (tx.length) {
                p.textContains = tx;
            }
            return p;
        }
        var m = buildPart(
            inp.mC && inp.mC.value,
            inp.mV && inp.mV.value,
            inp.mTs,
            inp.mLws,
            inp.mTxt,
            inp.mSpeci
        );
        var t = buildPart(
            inp.tC && inp.tC.value,
            inp.tV && inp.tV.value,
            inp.tTs,
            inp.tLws,
            inp.tTxt,
            inp.tSpeci
        );
        if (Object.keys(m).length) {
            rule.metar = m;
        }
        if (Object.keys(t).length) {
            rule.taf = t;
        }
        if (!rule.metar && !rule.taf) {
            return null;
        }
        return rule;
    }

    function notifyRulesMode() {
        var ui = readNotifyRulesUi();
        if (ui) {
            var gN = Array.isArray(ui.global) && ui.global.length;
            var pm = ui.perIata && typeof ui.perIata === 'object' ? ui.perIata : {};
            var pN = false;
            var pk;
            for (pk in pm) {
                if (Object.prototype.hasOwnProperty.call(pm, pk) && pm[pk] && pm[pk].length) {
                    pN = true;
                    break;
                }
            }
            var m0 = String(ui.mode || 'off').toLowerCase();
            if (m0 === 'per_iata' || pN) {
                return pN || gN ? 'per_iata' : (gN ? 'global' : 'off');
            }
            if (m0 === 'global') {
                return gN ? 'global' : (pN ? 'per_iata' : 'off');
            }
            if (!gN && !pN) {
                return 'off';
            }
            return pN ? 'per_iata' : 'global';
        }
        var v0 = String(getPref('metarWatchNotifyRulesMode', 'off') || 'off').toLowerCase();
        if (v0 === 'per_iata' || v0 === 'global') {
            if (!hasDefinedNotifyRules()) {
                return 'off';
            }
            return v0;
        }
        return 'off';
    }

    function mergeNotifyRulesForIata(iata) {
        var mode = notifyRulesMode();
        var ui = readNotifyRulesUi();
        if (ui) {
            if (!ui.colorCustom) {
                ui.colorCustom = DEFAULT_COLOR_CUSTOM;
            }
            if (!ui.colorPriority) {
                ui.colorPriority = DEFAULT_COLOR_HIGH;
            }
            var globalArr = Array.isArray(ui.global) ? ui.global : [];
            if (mode === 'global') {
                return globalArr;
            }
            if (mode === 'per_iata') {
                var map = ui.perIata && typeof ui.perIata === 'object' ? ui.perIata : {};
                var u = String(iata || '').toUpperCase();
                var extra = map[u];
                var out = globalArr.slice();
                if (extra && Array.isArray(extra)) {
                    var ei;
                    for (ei = 0; ei < extra.length; ei++) {
                        out.push(extra[ei]);
                    }
                }
                return out;
            }
            return [];
        }
        if (typeof donkeycodeGetPref !== 'function') {
            return [];
        }
        var rawG = donkeycodeGetPref('metarWatchNotifyRulesGlobal');
        var gArr = parseNotifyRulesArray(rawG !== undefined && rawG !== null ? String(rawG) : '');
        if (mode === 'global') {
            return gArr;
        }
        if (mode === 'per_iata') {
            var map2 = parseNotifyRulesPerIataMap(donkeycodeGetPref('metarWatchNotifyRulesPerIata'));
            var u2 = String(iata || '').toUpperCase();
            var ex2 = map2[u2];
            var out2 = gArr.slice();
            if (ex2 && Array.isArray(ex2)) {
                var j;
                for (j = 0; j < ex2.length; j++) {
                    out2.push(ex2[j]);
                }
            }
            return out2;
        }
        return [];
    }

    function notifyRulesPassForStation(iata, rec) {
        var metar = rec && rec.metar != null ? String(rec.metar) : '';
        var taf = rec && rec.taf != null ? String(rec.taf) : '';
        function anyRuleMatches() {
            var rules = mergeNotifyRulesForIata(iata);
            if (!rules || !rules.length) {
                return false;
            }
            var i;
            for (i = 0; i < rules.length; i++) {
                if (ruleMatchesOne(rules[i], metar, taf)) {
                    return true;
                }
            }
            return false;
        }
        if (notifyRulesMode() === 'off') {
            if (metarWatchNotifyOnColored() && hasDefinedNotifyRules()) {
                return anyRuleMatches();
            }
            return true;
        }
        if (!anyRuleMatches()) {
            return false;
        }
        return true;
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
    /** Round-robin: which product parms to check this tick (displayed + tracked sectors). */
    var codPollParmsList = [];
    var codPollIndex = 0;
    /** ICAO → { lat, lon } from api.weather.gov/stations (for sector prefetch). */
    var stationCoordsByIcao = {};
    var stationCoordsPending = {};
    var codPrefetchQueue = [];
    var codPrefetchActive = false;
    /** parms string → { runKey, blobUrls: string[], fileUrls: string[] } */
    var codCacheByParms = {};
    var codDisplayedParms = null;

    function codCachePollMs() {
        return numPref('metarWatchCodCachePollMinutes', 3, 0, 60) * 60 * 1000;
    }

    function codPrefetchSectorsEnabled() {
        return boolPref('metarWatchCodPrefetchSectors', true);
    }

    function mergeStationCoordsFromFetch(icao, st) {
        if (!icao || !st || !st.geometry || !st.geometry.coordinates) {
            return;
        }
        var coords = st.geometry.coordinates;
        var lon = coords[0];
        var lat = coords[1];
        if (typeof lat !== 'number' || typeof lon !== 'number') {
            return;
        }
        stationCoordsByIcao[icao] = { lat: lat, lon: lon };
    }

    function ensureStationCoordsForIcao(icao, cb) {
        if (!icao) {
            if (typeof cb === 'function') {
                cb(false);
            }
            return;
        }
        var c = stationCoordsByIcao[icao];
        if (c && typeof c.lat === 'number' && typeof c.lon === 'number') {
            if (typeof cb === 'function') {
                cb(true);
            }
            return;
        }
        if (stationCoordsPending[icao]) {
            stationCoordsPending[icao].push(cb);
            return;
        }
        stationCoordsPending[icao] = [cb];
        fetchJson('https://api.weather.gov/stations/' + encodeURIComponent(icao), function (st) {
            mergeStationCoordsFromFetch(icao, st);
            var arr = stationCoordsPending[icao];
            delete stationCoordsPending[icao];
            var ok = !!(stationCoordsByIcao[icao]);
            var ai;
            for (ai = 0; ai < arr.length; ai++) {
                try {
                    if (typeof arr[ai] === 'function') {
                        arr[ai](ok);
                    }
                } catch (e) {}
            }
        });
    }

    /**
     * parms to poll: current loop (if any) + one entry per NEXLAB sector covering tracked stations (deduped).
     */
    function rebuildCodPollParmsList() {
        var list = [];
        if (codDisplayedParms) {
            list.push(codDisplayedParms);
        }
        if (codPrefetchSectorsEnabled() && showCodModelLoopPanel() && codLoopLoadTrigger() !== 'manual') {
            var model = codLoopModelPref();
            var seen = {};
            var si;
            for (si = 0; si < stationList.length; si++) {
                var ic = icaoFor(stationList[si]);
                if (!ic) {
                    continue;
                }
                var coord = stationCoordsByIcao[ic];
                if (!coord) {
                    continue;
                }
                var sec = codPickSectorForLatLon(coord.lat, coord.lon, model);
                var parms = codBuildParms(model, sec);
                if (!seen[parms]) {
                    seen[parms] = true;
                    list.push(parms);
                }
            }
        }
        var out = [];
        var o = {};
        var li;
        for (li = 0; li < list.length; li++) {
            var p = list[li];
            if (p && !o[p]) {
                o[p] = true;
                out.push(p);
            }
        }
        codPollParmsList = out;
        codPollIndex = 0;
    }

    function codStopLoopAnimationOnly() {
        if (codLoopTimer) {
            clearInterval(codLoopTimer);
            codLoopTimer = null;
        }
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

    function codRunFingerprint(fileUrls) {
        if (!fileUrls || !fileUrls.length) {
            return '';
        }
        var n = fileUrls.length;
        var first = String(fileUrls[0] || '');
        var last = String(fileUrls[n - 1] || '');
        return n + '|' + first + '|' + last;
    }

    /** Reject HTML error pages mislabeled as image/png. */
    function codBufferLooksLikePng(buf) {
        if (!buf || typeof buf.byteLength !== 'number' || buf.byteLength < 24) {
            return false;
        }
        try {
            var u8 = new Uint8Array(buf);
            return u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
        } catch (e) {
            return false;
        }
    }

    /**
     * If blob caching fails (HTML bodies, tool quirks), use COD HTTPS URLs in the loop (no local blob).
     * Same cache object shape: blobUrls holds display URLs (https or blob).
     */
    function codSetCacheDirectHttp(parms, fileUrls) {
        if (!fileUrls || !fileUrls.length) {
            return;
        }
        var runKey = codRunFingerprint(fileUrls);
        codRevokeCacheEntry(parms);
        codCacheByParms[parms] = {
            runKey: runKey,
            fileUrls: fileUrls.slice(),
            blobUrls: fileUrls.slice(),
            useHttpUrls: true
        };
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

    function codFetchImageBlobUrlAttempt(httpUrl, attempt, cb) {
        if (typeof GM_xmlhttpRequest === 'function') {
            GM_xmlhttpRequest({
                method: 'GET',
                url: httpUrl,
                responseType: 'arraybuffer',
                onload: function (resp) {
                    if (!xhrStatusOk(resp)) {
                        if (attempt < 2) {
                            setTimeout(function () {
                                codFetchImageBlobUrlAttempt(httpUrl, attempt + 1, cb);
                            }, 400 * (attempt + 1));
                        } else {
                            cb(null);
                        }
                        return;
                    }
                    var buf = resp.response;
                    if (buf && typeof ArrayBuffer !== 'undefined' && buf instanceof ArrayBuffer && !codBufferLooksLikePng(buf)) {
                        if (attempt < 2) {
                            setTimeout(function () {
                                codFetchImageBlobUrlAttempt(httpUrl, attempt + 1, cb);
                            }, 400 * (attempt + 1));
                        } else {
                            cb(null);
                        }
                        return;
                    }
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
                    if (attempt < 2) {
                        setTimeout(function () {
                            codFetchImageBlobUrlAttempt(httpUrl, attempt + 1, cb);
                        }, 400 * (attempt + 1));
                    } else {
                        cb(null);
                    }
                },
                ontimeout: function () {
                    if (attempt < 2) {
                        setTimeout(function () {
                            codFetchImageBlobUrlAttempt(httpUrl, attempt + 1, cb);
                        }, 400 * (attempt + 1));
                    } else {
                        cb(null);
                    }
                }
            });
            return;
        }
        if (typeof fetch === 'function') {
            fetch(httpUrl, { credentials: 'omit', cache: 'no-store', mode: 'cors' })
                .then(function (r) {
                    if (!r.ok) {
                        throw new Error('bad');
                    }
                    return r.arrayBuffer();
                })
                .then(function (ab) {
                    if (!codBufferLooksLikePng(ab)) {
                        throw new Error('notpng');
                    }
                    return new Blob([ab], { type: 'image/png' });
                })
                .then(function (blob) {
                    cb(URL.createObjectURL(blob));
                })
                .catch(function () {
                    if (attempt < 2) {
                        setTimeout(function () {
                            codFetchImageBlobUrlAttempt(httpUrl, attempt + 1, cb);
                        }, 400 * (attempt + 1));
                    } else {
                        cb(null);
                    }
                });
            return;
        }
        cb(null);
    }

    function codFetchImageBlobUrl(httpUrl, cb) {
        codFetchImageBlobUrlAttempt(httpUrl, 0, cb);
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
        var failCount = 0;
        function finishOrFallback() {
            if (failCount > 0) {
                codRevokeCacheEntry(parms);
                var bi;
                for (bi = 0; bi < blobUrls.length; bi++) {
                    try {
                        if (blobUrls[bi] && String(blobUrls[bi]).indexOf('blob:') === 0) {
                            URL.revokeObjectURL(blobUrls[bi]);
                        }
                    } catch (e2) {}
                }
                codSetCacheDirectHttp(parms, fileUrls);
                cb(true);
                return;
            }
            codCacheByParms[parms] = {
                runKey: runKey,
                fileUrls: fileUrls.slice(),
                blobUrls: blobUrls
            };
            cb(true);
        }
        function next() {
            if (idx >= fileUrls.length) {
                finishOrFallback();
                return;
            }
            codFetchImageBlobUrl(fileUrls[idx], function (u) {
                if (!u) {
                    failCount++;
                } else {
                    blobUrls.push(u);
                }
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

    function codPollOneParmsTick(parms) {
        if (!parms) {
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
    }

    function codEnsureCodCachePollRunning() {
        var ms = codCachePollMs();
        if (!showCodModelLoopPanel() || ms <= 0) {
            codClearCachePoll();
            return;
        }
        rebuildCodPollParmsList();
        if (!codPollParmsList.length) {
            codClearCachePoll();
            return;
        }
        if (codCacheCheckTimer) {
            return;
        }
        codCacheCheckTimer = setInterval(function () {
            if (!showCodModelLoopPanel()) {
                codClearCachePoll();
                return;
            }
            rebuildCodPollParmsList();
            if (!codPollParmsList.length) {
                return;
            }
            var parmsTick = codPollParmsList[codPollIndex % codPollParmsList.length];
            codPollIndex++;
            codPollOneParmsTick(parmsTick);
        }, ms);
    }

    function codScheduleCachePoll(parms) {
        codDisplayedParms = parms || null;
        rebuildCodPollParmsList();
        codEnsureCodCachePollRunning();
    }

    function stopCodModelLoop() {
        codStopLoopAnimationOnly();
        codDisplayedParms = null;
        rebuildCodPollParmsList();
        codEnsureCodCachePollRunning();
    }

    function codPrefetchDrainQueue() {
        if (codPrefetchActive || !codPrefetchQueue.length) {
            return;
        }
        var parms = codPrefetchQueue.shift();
        if (!parms) {
            codPrefetchDrainQueue();
            return;
        }
        codPrefetchActive = true;
        var apiUrl = COD_BASE + '/assets/php/scripts/get-files.php?parms=' + encodeURIComponent(parms);
        fetchText(apiUrl, function (txt) {
            if (!txt) {
                codPrefetchActive = false;
                codPrefetchDrainQueue();
                return;
            }
            var j;
            try {
                j = JSON.parse(txt);
            } catch (e1) {
                codPrefetchActive = false;
                codPrefetchDrainQueue();
                return;
            }
            if (!j || j.err !== 'false' || !j.files || !j.files.length) {
                codPrefetchActive = false;
                codPrefetchDrainQueue();
                return;
            }
            var files = j.files;
            var newKey = codRunFingerprint(files);
            var cur = codCacheByParms[parms];
            if (cur && cur.runKey === newKey) {
                codPrefetchActive = false;
                codPrefetchDrainQueue();
                return;
            }
            codFillCacheFromHttpFiles(parms, files, function () {
                codPrefetchActive = false;
                codPrefetchDrainQueue();
            });
        });
    }

    /**
     * After METAR poll: resolve coords for tracked stations, then queue one COD download per unique NEXLAB sector (reuses codCacheByParms).
     */
    function codPrefetchTrackedSectorsAfterPoll() {
        if (!codPrefetchSectorsEnabled() || !showCodModelLoopPanel() || codLoopLoadTrigger() === 'manual') {
            return;
        }
        if (codAutoSectorPref()) {
            var need = [];
            var si;
            for (si = 0; si < stationList.length; si++) {
                var ic = icaoFor(stationList[si]);
                if (ic && !stationCoordsByIcao[ic]) {
                    need.push(ic);
                }
            }
            var pending = need.length;
            if (pending === 0) {
                codEnqueueSectorPrefetchParms();
                return;
            }
            var ni;
            for (ni = 0; ni < need.length; ni++) {
                (function (ic) {
                    ensureStationCoordsForIcao(ic, function () {
                        pending--;
                        if (pending <= 0) {
                            codEnqueueSectorPrefetchParms();
                        }
                    });
                })(need[ni]);
            }
            return;
        }
        var manualParms = codModelParmsManual();
        if (manualParms && !codCacheByParms[manualParms]) {
            codPrefetchQueue.push(manualParms);
            codPrefetchDrainQueue();
        }
    }

    function codEnqueueSectorPrefetchParms() {
        var model = codLoopModelPref();
        var seen = {};
        var si;
        for (si = 0; si < stationList.length; si++) {
            var ic = icaoFor(stationList[si]);
            if (!ic) {
                continue;
            }
            var coord = stationCoordsByIcao[ic];
            if (!coord) {
                continue;
            }
            var sec = codPickSectorForLatLon(coord.lat, coord.lon, model);
            var parms = codBuildParms(model, sec);
            if (seen[parms] || codCacheByParms[parms]) {
                continue;
            }
            seen[parms] = true;
            codPrefetchQueue.push(parms);
        }
        rebuildCodPollParmsList();
        codPrefetchDrainQueue();
        codEnsureCodCachePollRunning();
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
            mergeStationCoordsFromFetch(icao, st);
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
                    var noteC = 'ready (cached)';
                    if (cached.useHttpUrls) {
                        noteC = 'ready (cached, direct image URLs)';
                    }
                    codStartLoopFromUrls(cached.blobUrls, myGen, parms, tag, sub, noteC);
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
        return metarPollMinutesEffective() * 60 * 1000;
    }

    function restartPollTimer() {
        if (pollTimer) {
            try {
                clearInterval(pollTimer);
            } catch (e) {}
            pollTimer = null;
        }
        try {
            runPoll();
        } catch (e2) {}
        try {
            pollTimer = setInterval(runPoll, pollMs());
        } catch (e3) {}
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
        HAV: 'MUHA', PLS: 'MBPV', ITO: 'PHTO', ANC: 'PANC', LIT: 'KLIT', SDF: 'KSDF', TYS: 'KTYS',
        HRL: 'KHRL', KIN: 'MKJS', STS: 'KSTS', SXM: 'TNCM'
    };

    var METAR_PRESET_SECTORS = {
        s1: { label: 'Sector 1', iatas: [
            'ALB', 'BDL', 'BOS', 'BUF', 'BWI', 'DCA', 'IAD', 'ISP', 'LGA', 'MHT', 'ORF', 'PHL', 'PIT', 'PVD', 'PWM', 'RIC', 'ROC'
        ] },
        s2: { label: 'Sector 2', iatas: [
            'ATL', 'BHM', 'BNA', 'CHS', 'CLT', 'CVG', 'ECP', 'FLL', 'GSP', 'JAX', 'MCO', 'MEM', 'MIA', 'MSY', 'MYR', 'PBI', 'PNS',
            'RDU', 'RSW', 'SAV', 'SDF', 'SRQ', 'TPA', 'TYS', 'VPS'
        ] },
        s3: { label: 'Sector 3', iatas: ['CLE', 'CMH', 'DSM', 'DTW', 'GRR', 'IND', 'MDW', 'MKE', 'MSP', 'OMA', 'ORD'] },
        s4: { label: 'Sector 4', iatas: ['AMA', 'AUS', 'CRP', 'DAL', 'HOU', 'HRL', 'ICT', 'JAN', 'LBB', 'LIT', 'MAF', 'MCI', 'OKC', 'SAT', 'STL', 'TUL'] },
        s5: { label: 'Sector 5', iatas: [
            'ABQ', 'BOI', 'BZN', 'COS', 'DEN', 'ELP', 'EUG', 'FAT', 'GEG', 'HDN', 'MTJ', 'OAK', 'PDX', 'RNO', 'SEA', 'SFO', 'SJC', 'SLC', 'SMF', 'STS'
        ] },
        s6: { label: 'Sector 6', iatas: ['BUR', 'LAS', 'LAX', 'LGB', 'ONT', 'PHX', 'PSP', 'SAN', 'SBA', 'SNA', 'TUS'] },
        intl: { label: 'International', iatas: ['PLS', 'PUJ', 'KIN', 'PVR', 'CUN', 'LIR', 'SJO', 'HAV', 'GCM', 'NAS', 'BZE', 'STT', 'SJU', 'AUA', 'SXM'] },
        etops: { label: 'ETOPS (AK/HI)', iatas: ['ANC', 'KOA', 'LIH', 'HNL', 'OGG', 'ITO'] }
    };

    var METAR_PRESET_REGIONS = {
        east: { label: 'East', sectorKeys: ['s1', 's2'] },
        central: { label: 'Central', sectorKeys: ['s3', 's4'] },
        west: { label: 'West', sectorKeys: ['s5', 's6'] },
        intl_etops: { label: 'INTL/ETOPS', sectorKeys: ['intl', 'etops'] }
    };

    function mergePresetIatasIntoStationList(orderedIatas) {
        var have = {};
        var i;
        for (i = 0; i < stationList.length; i++) {
            have[stationList[i]] = 1;
        }
        var added = [];
        for (i = 0; i < (orderedIatas || []).length; i++) {
            var code = String(orderedIatas[i] || '')
                .trim()
                .toUpperCase();
            if (!/^[A-Z]{3}$/.test(code) || !icaoFor(code) || have[code]) {
                continue;
            }
            have[code] = 1;
            stationList.push(code);
            added.push(code);
        }
        if (added.length) {
            saveStationList(stationList);
            normalizePendingChangeTimes();
        }
        return added;
    }

    function iatasFromPresetCheckboxes(quickAddHost) {
        var out = [];
        var seen = {};
        var cbs = quickAddHost && quickAddHost.querySelectorAll ? quickAddHost.querySelectorAll('input[type="checkbox"][data-dc-mx-preset-key]') : [];
        var i;
        for (i = 0; i < cbs.length; i++) {
            if (!cbs[i].checked) {
                continue;
            }
            var key = String(cbs[i].getAttribute('data-dc-mx-preset-key') || '');
            var kind = String(cbs[i].getAttribute('data-dc-mx-preset-kind') || '');
            if (kind === 'region' && METAR_PRESET_REGIONS[key]) {
                var skA = METAR_PRESET_REGIONS[key].sectorKeys;
                var si;
                for (si = 0; si < skA.length; si++) {
                    var se = METAR_PRESET_SECTORS[skA[si]];
                    if (!se || !se.iatas) {
                        continue;
                    }
                    var ti;
                    for (ti = 0; ti < se.iatas.length; ti++) {
                        var iata = se.iatas[ti];
                        if (iata && !seen[iata]) {
                            seen[iata] = 1;
                            out.push(iata);
                        }
                    }
                }
            } else if (kind === 'sector' && METAR_PRESET_SECTORS[key]) {
                var se2 = METAR_PRESET_SECTORS[key];
                if (!se2 || !se2.iatas) {
                    continue;
                }
                var tj;
                for (tj = 0; tj < se2.iatas.length; tj++) {
                    var iat2 = se2.iatas[tj];
                    if (iat2 && !seen[iat2]) {
                        seen[iat2] = 1;
                        out.push(iat2);
                    }
                }
            }
        }
        return out;
    }

    function applySharedMetarTafToCache(icao, metar, taf, ts) {
        if (!icao) {
            return;
        }
        var tUse = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now();
        var nm = normalizeMetarTafText(metar);
        var nt = normalizeMetarTafText(taf);
        var cur = cacheByIcao[icao];
        if (cur && typeof cur.t === 'number' && cur.t > tUse + 500) {
            var localM = normalizeMetarTafText(cur.metar);
            var localT = normalizeMetarTafText(cur.taf);
            var sharedHasM = !metarTafLooksEmpty(nm);
            var sharedHasT = !metarTafLooksEmpty(nt);
            var localWeakM = metarTafLooksEmpty(localM);
            var localWeakT = metarTafLooksEmpty(localT);
            if (!(sharedHasM && localWeakM) && !(sharedHasT && localWeakT)) {
                return;
            }
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
                metar: nm || 'N/A',
                metarLines: nm && !metarTafLooksEmpty(nm) ? [nm] : [],
                taf: nt || 'N/A',
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
            if (!metarTafLooksEmpty(nm)) {
                cur.metar = nm;
                cur.metarLines = [nm];
            }
            if (!metarTafLooksEmpty(nt)) {
                cur.taf = nt;
            }
            var prevT = typeof cur.t === 'number' && Number.isFinite(cur.t) ? cur.t : 0;
            cur.t = Math.max(prevT, tUse);
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
        return normalizeMetarTafText(metar) + '\u0000' + normalizeMetarTafText(taf);
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
    /** Station (IATA) whose METAR/TAF NEW highlight is shown; mark detail-seen when user picks another row or closes modal. */
    var detailSeenPendingIata = null;

    function flushDetailSeenPendingIfSwitchingTo(newIata) {
        if (detailSeenPendingIata && detailSeenPendingIata !== newIata) {
            markStationViewed(detailSeenPendingIata);
            detailSeenPendingIata = null;
        }
    }

    function reloadViewedSnapshotsFromStorage() {
        viewedSnapshot = loadViewedSnapshot();
        detailSeenSnapshot = loadDetailSeenSnapshot();
    }

    function applyViewedSyncFromOtherTab(icao) {
        reloadViewedSnapshotsFromStorage();
        notifyDedupeMap = loadNotifyDedupeMap();
        if (icao && detailSeenPendingIata && icaoFor(detailSeenPendingIata) === icao) {
            detailSeenPendingIata = null;
        }
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
    var onToolbarClickDebug = null;
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
    var alertRulesBackdrop = null;
    var alertRulesModal = null;
    var alertRulesGlobalBlock = null;
    var alertRulesGlobalHost = null;
    var alertRulesPerSectionWrap = null;
    var alertRulesPerHost = null;
    var alertRulesColorHighInp = null;
    var alertRulesColorAdvisoryInp = null;
    var alertMetarSettingsNotify = null;
    var alertMetarSettingsPoll = null;
    var alertMetarSettingsConc = null;
    var alertMetarSettingsShared = null;
    var alertMetarSettingsDatisBackground = null;
    var alertMetarSettingsFresh = null;
    var alertMetarSettingsHiRules = null;
    var alertMetarSettingsSw = {};
    var alertMetarSettingsNotifyColored = null;
    var alertMetarSettingsNotifySpecial = null;
    var metarSettingsApplySwTokenMaster = null;
    var alertRulesColorCustomInp = null;
    var alertRulesColorPriorityInp = null;
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
        return (
            !v ||
            normalizeMetarTafText(c.metar) !== normalizeMetarTafText(v.metar) ||
            normalizeMetarTafText(c.taf) !== normalizeMetarTafText(v.taf)
        );
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

    /** Yellow: change within configured minutes; red: older (still unseen). */
    function pendingChangeAgeClass(iata) {
        var t = pendingChangeTime[iata];
        if (typeof t !== 'number' || !Number.isFinite(t)) {
            return null;
        }
        var age = Date.now() - t;
        if (age <= metarWatchFreshWindowMs()) {
            return 'fresh';
        }
        return 'stale';
    }

    /** List row colors: rules-matching stale uses yellow/red by age; non-matching stale is subtle grey. */
    function listRowAlertStyle(iata) {
        if (!isStationStaleVersusViewed(iata)) {
            return { kind: 'none' };
        }
        var icao = icaoFor(iata);
        var rec = icao && cacheByIcao[icao];
        if (rec && notifyRulesPassForStation(iata, rec)) {
            var age = pendingChangeAgeClass(iata);
            if (age === 'fresh') {
                return { kind: 'rules_fresh' };
            }
            if (age === 'stale') {
                return { kind: 'rules_stale' };
            }
            return { kind: 'rules_fresh' };
        }
        return { kind: 'subtle' };
    }

    function notifyRulesPassForSection(iata, rec, section) {
        if (notifyRulesMode() === 'off') {
            return true;
        }
        var rules = mergeNotifyRulesForIata(iata);
        if (!rules.length) {
            return false;
        }
        var metar = rec && rec.metar ? String(rec.metar) : '';
        var taf = rec && rec.taf ? String(rec.taf) : '';
        var i;
        for (i = 0; i < rules.length; i++) {
            if (section === 'metar' && ruleAppliesToSection(rules[i], 'metar', metar)) {
                return true;
            }
            if (section === 'taf' && ruleAppliesToSection(rules[i], 'taf', taf)) {
                return true;
            }
        }
        return false;
    }

    /** Modal section title: rules match that section → yellow (&lt;5m) / red (&gt;5m); else subtle until viewed. */
    function detailTitleHighlightStyle(iata, sectionUnseen, sectionKey) {
        if (!sectionUnseen) {
            return '';
        }
        var icao = icaoFor(iata);
        var r = icao && cacheByIcao[icao];
        var rulesOk = r && sectionKey ? notifyRulesPassForSection(iata, r, sectionKey) : false;
        var pad = 'padding:6px 10px;margin-bottom:6px;border-radius:4px;box-sizing:border-box;';
        if (rulesOk) {
            var age = pendingChangeAgeClass(iata);
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
        return (
            pad +
            'background:rgba(127,140,141,0.12);border-left:3px solid #7f8c8d;color:#bdc3c7 !important;'
        );
    }

    function metarTafUnseenVersusViewed(iata, r) {
        var icao = icaoFor(iata);
        if (!icao || !r) {
            return { metar: false, taf: false };
        }
        var v = detailSeenSnapshot[icao];
        var cm = normalizeMetarTafText(r.metar);
        var ct = normalizeMetarTafText(r.taf);
        if (!v) {
            return { metar: true, taf: true };
        }
        return {
            metar: cm !== normalizeMetarTafText(v.metar),
            taf: ct !== normalizeMetarTafText(v.taf)
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

    /** NOAA text FTP is not CORS-enabled; page `fetch` only creates console noise. Use GM only. */
    function isTgftpNoaaUrl(u) {
        return typeof u === 'string' && u.indexOf('https://tgftp.nws.noaa.gov/') === 0;
    }

    function fetchTextViaPageFetch(url, cb) {
        if (isTgftpNoaaUrl(url)) {
            cb('');
            return;
        }
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
        var disableFallback = opts && opts.disableFallback === true;
        function finish(txt, meta) {
            cb(typeof txt === 'string' ? txt : '', meta || null);
        }
        function fallback() {
            if (disableFallback) {
                finish('', { skippedFallback: true });
                return;
            }
            if (isTgftpNoaaUrl(url)) {
                finish('');
                return;
            }
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
                    return res.text().then(function (t) {
                        finish(typeof t === 'string' ? t : '', { status: res.status, ok: !!res.ok });
                    });
                })
                .catch(function () {
                    finish('', { error: true });
                });
        }
        if (typeof GM_xmlhttpRequest === 'function') {
            var details = {
                method: 'GET',
                url: url,
                onload: function (resp) {
                    var txt = xhrResponseText(resp);
                    if (txt && xhrStatusOk(resp)) {
                        finish(txt, { status: resp.status, ok: true });
                        return;
                    }
                    if (isTgftpNoaaUrl(url)) {
                        finish(typeof txt === 'string' ? txt : '', { status: resp.status, ok: xhrStatusOk(resp) });
                        return;
                    }
                    if (disableFallback) {
                        finish(typeof txt === 'string' ? txt : '', { status: resp.status, ok: xhrStatusOk(resp) });
                        return;
                    }
                    fallback();
                },
                onerror: function () {
                    if (isTgftpNoaaUrl(url)) {
                        finish('');
                        return;
                    }
                    fallback();
                },
                ontimeout: function () {
                    if (isTgftpNoaaUrl(url)) {
                        finish('');
                        return;
                    }
                    fallback();
                }
            };
            if (headers) {
                details.headers = headers;
            }
            GM_xmlhttpRequest(details);
            return;
        }
        if (isTgftpNoaaUrl(url)) {
            finish('');
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
    function readDatisMissingCache() {
        var now = Date.now();
        if (!datisMissingCache) {
            try {
                datisMissingCache = JSON.parse(localStorage.getItem(LS_DATIS_MISSING) || '{}') || {};
            } catch (e) {
                datisMissingCache = {};
            }
        }
        var changed = false;
        var k;
        for (k in datisMissingCache) {
            if (Object.prototype.hasOwnProperty.call(datisMissingCache, k) && now - Number(datisMissingCache[k] || 0) > DATIS_MISSING_TTL_MS) {
                delete datisMissingCache[k];
                changed = true;
            }
        }
        if (changed) {
            writeDatisMissingCache();
        }
        return datisMissingCache;
    }

    function writeDatisMissingCache() {
        try {
            localStorage.setItem(LS_DATIS_MISSING, JSON.stringify(datisMissingCache || {}));
        } catch (e) {}
    }

    function datisMarkedMissing(icao) {
        var key = String(icao || '').toUpperCase();
        var cache = readDatisMissingCache();
        return !!(key && cache[key] && Date.now() - Number(cache[key]) <= DATIS_MISSING_TTL_MS);
    }

    function markDatisMissing(icao, missing) {
        var key = String(icao || '').toUpperCase();
        if (!key) {
            return;
        }
        var cache = readDatisMissingCache();
        if (missing) {
            cache[key] = Date.now();
        } else if (cache[key]) {
            delete cache[key];
        } else {
            return;
        }
        writeDatisMissingCache();
    }

    function shouldFetchDatisForIcao(icao, force) {
        if (!showDatisPanel()) {
            return false;
        }
        if (force) {
            return true;
        }
        return !datisMarkedMissing(icao);
    }

    function shouldFetchDatisDuringEnrichment(icao, iata) {
        if (!shouldFetchDatisForIcao(icao, false)) {
            return false;
        }
        if (modal && modal.style.display === 'flex' && selectedIata === iata) {
            return true;
        }
        return metarFetchDatisInBackground();
    }

    function fetchDatisForIcao(icao, cb, opts) {
        var code = String(icao || '').toUpperCase();
        var force = opts && opts.force === true;
        if (!shouldFetchDatisForIcao(code, force)) {
            cb(null);
            return;
        }
        fetchText('https://atis.info/api/' + encodeURIComponent(code), function (txt, meta) {
            if (!txt || txt.charAt(0) !== '[') {
                if (meta && Number(meta.status) === 404) {
                    markDatisMissing(code, true);
                }
                cb(null);
                return;
            }
            try {
                var arr = JSON.parse(txt);
                if (!Array.isArray(arr) || !arr.length) {
                    markDatisMissing(code, true);
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
                markDatisMissing(code, !out.length);
                cb(out.length ? out : null);
            } catch (e) {
                cb(null);
            }
        }, { disableFallback: true });
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
        }, { force: true });
    }

    function patchDetailExtras(icao, iata) {
        if (!icao || !iata) {
            return;
        }
        if (!showDatisPanel() && !showHrrrPanel()) {
            return;
        }
        fetchJson('https://api.weather.gov/stations/' + encodeURIComponent(icao), function (st) {
            mergeStationCoordsFromFetch(icao, st);
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
            if (shouldFetchDatisDuringEnrichment(icao, iata)) {
                fetchDatisForIcao(icao, function (datis) {
                    maybeHrrrAfterDatis(datis);
                });
            } else {
                maybeHrrrAfterDatis(undefined);
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
            mergeStationCoordsFromFetch(icao, st);
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
            ensureStationCoordsForIcao(icao);
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
        var concurrency = metarConcurrentStationsEffective();
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
                snap[r.icao] = {
                    metar: normalizeMetarTafText(r.metar) || 'N/A',
                    taf: normalizeMetarTafText(r.taf) || 'N/A'
                };
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
            if (
                normalizeMetarTafText(c.metar) !== normalizeMetarTafText(v.metar) ||
                normalizeMetarTafText(c.taf) !== normalizeMetarTafText(v.taf)
            ) {
                return true;
            }
        }
        return false;
    }

    function maybeNotify(staleIcaoSet) {
        if (!metarWatchNotifyEnabled()) {
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
            var iataForNotify = iataFromIcao(icao);
            if (iataForNotify && !shouldSendDesktopNotificationForContent(iataForNotify, rec)) {
                notifyShownForCurrent[icao] = true;
                continue;
            }
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
            var hasRuleMatch = false;
            var hasRuleMatchOld = false;
            var si2;
            for (si2 = 0; si2 < stale.length; si2++) {
                var icx = stale[si2];
                var ix = iataFromIcao(icx);
                var rx = cacheByIcao[icx];
                var pass = ix && rx && notifyRulesPassForStation(ix, rx);
                if (pass) {
                    hasRuleMatch = true;
                    if (ix && pendingChangeAgeClass(ix) === 'stale') {
                        hasRuleMatchOld = true;
                    }
                }
            }
            btn.style.color = '#f1c40f';
            if (hasRuleMatchOld) {
                btn.style.background = '#c0392b';
                btn.style.color = '#fff';
                btn.setAttribute('data-dc-metar-alert', '1');
            } else {
                btn.style.background = '#2c3e50';
                btn.removeAttribute('data-dc-metar-alert');
            }
            if (hasRuleMatch) {
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
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
                codPrefetchTrackedSectorsAfterPoll();
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
        var snap = { metar: normalizeMetarTafText(r.metar), taf: normalizeMetarTafText(r.taf) };
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
                    renderDetail(selectedIata, { skipCodLoop: true });
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
                    var ls = listRowAlertStyle(iata);
                    if (ls.kind === 'rules_fresh') {
                        row.style.background = 'rgba(241,196,15,0.35)';
                        row.style.border = '1px solid rgba(241,196,15,0.55)';
                    } else if (ls.kind === 'rules_stale') {
                        row.style.background = 'rgba(192,57,43,0.4)';
                        row.style.border = '1px solid rgba(231,76,60,0.55)';
                    } else if (ls.kind === 'subtle') {
                        row.style.background = 'rgba(127,140,141,0.15)';
                        row.style.border = '1px solid rgba(127,140,141,0.35)';
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
                var ls2 = listRowAlertStyle(iata);
                if (ls2.kind === 'rules_fresh') {
                    label.style.color = '#2c2c2c';
                    label.style.fontWeight = '600';
                } else if (ls2.kind === 'rules_stale') {
                    label.style.color = '#fadbd8';
                    label.style.fontWeight = '600';
                } else if (ls2.kind === 'subtle') {
                    label.style.color = '#aeb6b8';
                    label.style.fontWeight = '500';
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
                    flushDetailSeenPendingIfSwitchingTo(iata);
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
                '<div style="color:#95a5a6;font-family:system-ui,sans-serif;">No station selected. Add airports or use Quick add.</div>';
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
                        renderDetail(iata, { skipCodLoop: true });
                        ensureFaaRvrLoaded(iata);
                    }
                },
                { fetchRvrNow: true }
            );
            return;
        }
        var unseen = metarTafUnseenVersusViewed(iata, r);
        var metarTitleStyle =
            'font-weight:600;margin-bottom:6px;color:#3498db;' + detailTitleHighlightStyle(iata, unseen.metar, 'metar');
        var tafTitleStyle =
            'font-weight:600;margin-bottom:8px;color:#3498db;' + detailTitleHighlightStyle(iata, unseen.taf, 'taf');
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
                    applyMetarTafMetarBlockHighlights(metarDisplay[mj], iata) +
                    '</div>';
            }
        } else {
            mBlocks = '<div style="color:#95a5a6;">N/A</div>';
        }
        var t = applyMetarTafTafBlockHighlights(r.taf || '', iata);
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
            detailSeenPendingIata = iata;
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
        closeAlertRulesDialog();
        if (detailSeenPendingIata) {
            markStationViewed(detailSeenPendingIata);
            detailSeenPendingIata = null;
        }
        modal.style.display = 'none';
        backdrop.style.display = 'none';
        stopListColorTimer();
        stopCodModelLoop();
        if (codLoopHostEl) {
            codLoopHostEl.style.display = 'none';
        }
    }

    var WX_BTN_ATTR = 'data-dc-metar-watch-btn';
    var TOOLBAR_STYLE_ID = 'dc-metar-ws-toolbar-ptr-style';
    var WSB_STATE_ID = 'dc-ws-state-reload-host';

    function isPaxConnectionsPage() {
        try {
            return (
                String(location.pathname || '')
                    .toLowerCase()
                    .indexOf('pax-connections') >= 0
            );
        } catch (e) {
            return false;
        }
    }

    function detachMetarWatchWxButton() {
        try {
            if (btn && btn.parentNode) {
                btn.remove();
            } else {
                var nd = document.querySelectorAll('[' + WX_BTN_ATTR + '="1"]');
                var n;
                for (n = 0; n < nd.length; n++) {
                    try {
                        if (nd[n] && nd[n].parentNode) {
                            nd[n].remove();
                        }
                    } catch (e) {}
                }
            }
        } catch (e2) {}
        btn = null;
        badge = null;
        removeEmptyWorksheetHelperField();
    }


    function isWorksheetWidgetPage() {
        try {
            return String(location.pathname || '').indexOf('/widgets/worksheet') === 0;
        } catch (e) {
            return false;
        }
    }

    function textLabel(el) {
        return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    }

    function findWorksheetFieldsRow() {
        if (!isWorksheetWidgetPage()) {
            return null;
        }
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
        var wxn = helper.querySelector('[' + WX_BTN_ATTR + '="1"]');
        var st = document.getElementById(WSB_STATE_ID);
        var i;
        var list = [wxn, st];
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

    function removeEmptyWorksheetHelperField() {
        var helper = document.querySelector(
            '[data-dc-worksheet-helper-buttons="1"]'
        );
        if (
            helper &&
            !helper.querySelector(
                'button, #' + WSB_STATE_ID
            )
        ) {
            try {
                helper.remove();
            } catch (e) {}
        }
    }

    function donkeycodePageLog(msg) {
        if (msg == null) {
            return;
        }
        var s = String(msg);
        if (typeof window !== 'undefined' && window.top) {
            try {
                window.top.postMessage(
                    { type: 'DONKEYCODE_PAGE_LOG', message: s, level: 'log' },
                    '*'
                );
            } catch (e) {}
        }
    }

    function ensureWorksheetToolbarClickDebug() {
        if (!isWorksheetWidgetPage() || onToolbarClickDebug) {
            return;
        }
        if (boolPref('metarWatchToolbarClickDebug', false) !== true) {
            return;
        }
        onToolbarClickDebug = function (ev) {
            if (!ev || (ev.type !== 'pointerdown' && ev.type !== 'click')) {
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
            var lines = [
                '[Wolf2.0][METAR] toolbar ' + ev.type,
                '  target: ' + (t && t.tagName) + (t && t.getAttribute('id') ? ' #' + t.getAttribute('id') : ''),
                '  elementFromPoint: ' + (pick && pick.tagName)
            ];
            donkeycodePageLog(lines.join('\n'));
        };
        document.addEventListener('click', onToolbarClickDebug, true);
        try {
            document.addEventListener('pointerdown', onToolbarClickDebug, true);
        } catch (e) {
            document.addEventListener('mousedown', onToolbarClickDebug, true);
        }
    }

    function ensureMetarToolbarZStyle() {
        if (document.getElementById(TOOLBAR_STYLE_ID)) {
            return;
        }
        var st = document.createElement('style');
        st.id = TOOLBAR_STYLE_ID;
        st.textContent =
            '[data-dc-worksheet-helper-buttons="1"],button[' +
            WX_BTN_ATTR +
            '="1"]{' +
            'position:relative!important;z-index:2147482000!important;pointer-events:auto!important;}' +
            'span#dc-ws-state-reload-host,#' +
            'dc-ws-state-reload-host' +
            '{position:relative!important;z-index:2147482000!important;pointer-events:auto!important;}';
        try {
            document.head.appendChild(st);
        } catch (e) {}
    }

    function findGmtClockElement() {
        if (isPaxConnectionsPage()) {
            return null;
        }
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

    /**
     * Hot-reload / duplicate injection can leave multiple WX nodes; keep one and refresh refs.
     */
    function dedupeWxButtonNodes() {
        var nodes = document.querySelectorAll('[' + WX_BTN_ATTR + '="1"]');
        if (!nodes.length) {
            btn = null;
            badge = null;
            return;
        }
        var keep = btn && btn.isConnected ? btn : nodes[0];
        var i;
        for (i = 0; i < nodes.length; i++) {
            if (nodes[i].getAttribute && nodes[i].getAttribute('data-dc-mx-wx-demo') === '1') {
                continue;
            }
            if (nodes[i] !== keep) {
                try {
                    nodes[i].remove();
                } catch (e) {}
            }
        }
        btn = keep;
        try {
            badge = btn.querySelector('span');
        } catch (e2) {
            badge = null;
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

    function bindWxButtonIfNeeded() {
        if (!btn) {
            return;
        }
        if (btn.getAttribute('data-dc-wx-click-bound') === '1') {
            return;
        }
        btn.setAttribute('data-dc-wx-click-bound', '1');
        bindWorksheetToolbarButtonActivate(btn, function () {
            if (Notification && Notification.permission === 'default' && metarWatchNotifyEnabled()) {
                try {
                    Notification.requestPermission();
                } catch (e) {}
            }
            openModal();
        });
    }

    function mountButtonNearClock() {
        if (isPaxConnectionsPage()) {
            detachMetarWatchWxButton();
            return;
        }
        ensureMetarToolbarZStyle();
        dedupeWxButtonNodes();

        var worksheetHelper = getOrCreateWorksheetHelperField();
        var anchor = worksheetHelper ? null : findGmtClockElement();
        var host = worksheetHelper || (anchor && anchor.parentElement ? anchor.parentElement : document.body);
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
            btn.setAttribute(WX_BTN_ATTR, '1');
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
        }
        if (!btn.getAttribute('data-dc-wx-open-bound')) {
            btn.setAttribute('data-dc-wx-open-bound', '1');
        }
        bindWxButtonIfNeeded();
        if (worksheetHelper) {
            btn.style.marginLeft = '0';
            btn.style.minHeight = '36px';
            btn.style.height = 'auto';
            btn.style.alignSelf = 'stretch';
            if (btn.parentNode !== worksheetHelper) {
                try {
                    worksheetHelper.appendChild(btn);
                } catch (e) {}
            }
            orderWsbInHelper(worksheetHelper);
        } else if (anchor && anchor.parentNode) {
            var hPar = anchor.parentNode;
            btn.style.marginLeft = '8px';
            if (btn.parentNode !== hPar) {
                try {
                    hPar.appendChild(btn);
                } catch (e01) {
                    try {
                        hPar.insertBefore(btn, anchor.nextSibling);
                    } catch (e02) {}
                }
            } else {
                try {
                    hPar.appendChild(btn);
                } catch (e03) {}
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
            btn.style.marginLeft = '8px';
            btn.style.minHeight = '';
            btn.style.maxHeight = '50px';
            btn.style.alignSelf = '';
            if (btn.parentNode !== host) {
                host.appendChild(btn);
            }
        }
    }

    function elNumInput(ph) {
        var i = document.createElement('input');
        i.type = 'number';
        i.step = 'any';
        i.min = '0';
        i.placeholder = ph;
        i.style.width = '100%';
        i.style.boxSizing = 'border-box';
        i.style.padding = '4px 6px';
        i.style.fontSize = '11px';
        i.style.borderRadius = '4px';
        i.style.border = '1px solid #555';
        i.style.background = '#2a2a32';
        i.style.color = '#ecf0f1';
        return i;
    }

    function mkRuleExtraLine(label, vObj, which) {
        var pfx = which === 't' ? 't' : 'm';
        var wrap = document.createElement('div');
        wrap.style.cssText =
            'display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:10px;color:#bdc3c7;';
        var sp = document.createElement('span');
        sp.textContent = label;
        sp.style.minWidth = '40px';
        sp.style.color = which === 't' ? '#9b59b6' : '#3498db';
        sp.style.fontWeight = '600';
        wrap.appendChild(sp);
        function addCb(txt, k, title) {
            var lb = document.createElement('label');
            lb.style.cssText = 'display:inline-flex;align-items:center;gap:3px;cursor:pointer;user-select:none;';
            var c = document.createElement('input');
            c.type = 'checkbox';
            c.checked = !!vObj[k];
            c.title = title;
            c.style.width = '12px';
            c.style.height = '12px';
            lb.appendChild(c);
            lb.appendChild(document.createTextNode(txt));
            wrap.appendChild(lb);
            return c;
        }
        var tsB = addCb('TS', pfx + 'Ts', 'Meteorological thunderstorm (TS+/-, VCTS, etc.)');
        var llB = addCb('LLWS', pfx + 'Lws', 'LLWS, LO LV, W/S, etc.');
        var specB = addCb('Spec', pfx + 'Speci', which === 't' ? 'TEMPO, BECMG, PROB, FM, etc. (TAF only)' : 'SPECI in METAR');
        var ti = document.createElement('input');
        ti.type = 'text';
        ti.placeholder = 'text contains…';
        ti.title = 'Case-insensitive substring; applies to the corresponding METAR or TAF line';
        ti.value = vObj[pfx + 'Txt'] || '';
        ti.style.cssText =
            'min-width:120px;flex:1 1 120px;max-width:100%;box-sizing:border-box;padding:2px 6px;font-size:10px;border-radius:4px;border:1px solid #555;background:#2a2a32;color:#ecf0f1;';
        wrap.appendChild(ti);
        return { wrap: wrap, ts: tsB, ll: llB, spec: specB, txt: ti };
    }

    function buildRuleRowEl(rule) {
        var v = ruleToRowValues(rule || null);
        var row = document.createElement('div');
        row.setAttribute('data-dc-arule-row', '1');
        row.style.cssText = 'margin-bottom:10px;border-bottom:1px solid #2c2c36;padding-bottom:6px;';
        var line1 = document.createElement('div');
        line1.style.display = 'grid';
        line1.style.gridTemplateColumns = 'minmax(88px,0.9fr) 22px 22px 1fr 1fr 1fr 1fr';
        line1.style.gap = '6px';
        line1.style.alignItems = 'end';
        var level = document.createElement('select');
        level.title =
            'Default underline color: Advisory / High / Custom (preset) / Priority (preset). Or check custom swatch to set this row’s color.';
        level.style.cssText =
            'width:100%;padding:4px 4px;font-size:10px;border-radius:4px;border:1px solid #555;background:#2a2a32;color:#ecf0f1;';
        var lo = document.createElement('option');
        lo.value = 'advisory';
        lo.textContent = 'Advisory';
        var lh = document.createElement('option');
        lh.value = 'high';
        lh.textContent = 'High';
        var lcu = document.createElement('option');
        lcu.value = 'custom';
        lcu.textContent = 'Custom (preset)';
        var lpr = document.createElement('option');
        lpr.value = 'priority';
        lpr.textContent = 'Priority (preset)';
        level.appendChild(lo);
        level.appendChild(lh);
        level.appendChild(lcu);
        level.appendChild(lpr);
        if (v.level === 'high' || v.level === 'custom' || v.level === 'priority') {
            level.value = v.level;
        } else {
            level.value = 'advisory';
        }
        var useColor = document.createElement('input');
        useColor.type = 'checkbox';
        useColor.title = 'Custom color for this rule';
        useColor.checked = v.useCustomColor;
        useColor.style.width = '16px';
        useColor.style.height = '16px';
        var colorInp = document.createElement('input');
        colorInp.type = 'color';
        colorInp.value = v.customColor || '#888888';
        colorInp.title = 'Rule color';
        colorInp.style.width = '22px';
        colorInp.style.height = '22px';
        colorInp.style.padding = '0';
        colorInp.style.border = 'none';
        colorInp.style.cursor = 'pointer';
        colorInp.style.background = 'transparent';
        if (!v.useCustomColor) {
            colorInp.style.opacity = '0.4';
            colorInp.disabled = true;
        }
        useColor.addEventListener('change', function () {
            colorInp.disabled = !useColor.checked;
            colorInp.style.opacity = useColor.checked ? '1' : '0.4';
        });
        var mC = elNumInput('METAR ceil max');
        mC.value = v.mC;
        var mV = elNumInput('');
        mV.type = 'text';
        mV.removeAttribute('min');
        mV.inputMode = 'decimal';
        mV.placeholder = '1.5, 1/2, 1 1/2';
        mV.title = 'Max vis in statute miles: decimal or fraction (e.g. 0.5, 1/2, 1 1/2)';
        mV.value = v.mV;
        var tC = elNumInput('TAF ceil max');
        tC.value = v.tC;
        var tV = elNumInput('');
        tV.type = 'text';
        tV.removeAttribute('min');
        tV.inputMode = 'decimal';
        tV.placeholder = '1.5, 1/2';
        tV.title = 'TAF vis max (SM), same as METAR vis';
        tV.value = v.tV;
        line1.appendChild(level);
        line1.appendChild(useColor);
        line1.appendChild(colorInp);
        line1.appendChild(mC);
        line1.appendChild(mV);
        line1.appendChild(tC);
        line1.appendChild(tV);
        var mEx = mkRuleExtraLine('M', v, 'm');
        var tEx = mkRuleExtraLine('T', v, 't');
        var line2 = document.createElement('div');
        line2.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px;';
        line2.appendChild(mEx.wrap);
        line2.appendChild(tEx.wrap);
        row._inputs = {
            level: level,
            useCustomColor: useColor,
            customColor: colorInp,
            mC: mC,
            mV: mV,
            tC: tC,
            tV: tV,
            mTs: mEx.ts,
            mLws: mEx.ll,
            mSpeci: mEx.spec,
            mTxt: mEx.txt,
            tTs: tEx.ts,
            tLws: tEx.ll,
            tSpeci: tEx.spec,
            tTxt: tEx.txt
        };
        row.appendChild(line1);
        row.appendChild(line2);
        return row;
    }

    function collectRuleRowsFromHost(host) {
        var out = [];
        if (!host) {
            return out;
        }
        var nodes = host.querySelectorAll('[data-dc-arule-row="1"]');
        var i;
        for (i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var inp = n._inputs;
            if (!inp) {
                continue;
            }
            var r = rowValuesToRule(inp);
            if (r) {
                out.push(r);
            }
        }
        return out;
    }

    function syncAlertModeUi() {
        if (alertRulesPerSectionWrap) {
            alertRulesPerSectionWrap.style.display = 'block';
        }
    }

    function populateMetarSettingsForm() {
        if (!alertMetarSettingsNotify) {
            return;
        }
        alertMetarSettingsNotify.checked = metarWatchNotifyEnabled();
        if (alertMetarSettingsPoll) {
            alertMetarSettingsPoll.value = String(metarPollMinutesEffective());
        }
        if (alertMetarSettingsConc) {
            alertMetarSettingsConc.value = String(metarConcurrentStationsEffective());
        }
        if (alertMetarSettingsShared) {
            alertMetarSettingsShared.checked = metarSharedPollEnabled();
        }
        if (alertMetarSettingsDatisBackground) {
            alertMetarSettingsDatisBackground.checked = metarFetchDatisInBackground();
        }
        if (alertMetarSettingsFresh) {
            alertMetarSettingsFresh.value = String(metarWatchAlertFreshMinutes());
        }
        if (alertMetarSettingsHiRules) {
            alertMetarSettingsHiRules.checked = metarWatchHighlightWithRulesWhenNotifyOff();
        }
        if (alertMetarSettingsNotifyColored) {
            alertMetarSettingsNotifyColored.checked = metarWatchNotifyOnColored();
        }
        if (alertMetarSettingsNotifySpecial) {
            alertMetarSettingsNotifySpecial.checked = metarWatchNotifyOnSpecial();
        }
        var ssw;
        for (ssw in alertMetarSettingsSw) {
            if (Object.prototype.hasOwnProperty.call(alertMetarSettingsSw, ssw) && alertMetarSettingsSw[ssw]) {
                alertMetarSettingsSw[ssw].checked = metarSwStylePrefKey(ssw);
            }
        }
        if (typeof metarSettingsApplySwTokenMaster === 'function') {
            metarSettingsApplySwTokenMaster();
        }
    }

    function readMetarSettingsIntoStorage() {
        if (!alertMetarSettingsNotify) {
            return;
        }
        var o = readMetarWatchUi() || {};
        o.metarWatchNotify = !!alertMetarSettingsNotify.checked;
        if (alertMetarSettingsPoll) {
            var pm = Math.floor(Number(alertMetarSettingsPoll.value));
            o.metarWatchPollMinutes = Number.isFinite(pm) ? Math.min(120, Math.max(1, pm)) : metarPollMinutesEffective();
        }
        if (alertMetarSettingsConc) {
            var cc = Math.floor(Number(alertMetarSettingsConc.value));
            o.metarWatchConcurrentStations = Number.isFinite(cc)
                ? Math.min(20, Math.max(1, cc))
                : metarConcurrentStationsEffective();
        }
        if (alertMetarSettingsShared) {
            o.metarWatchSharedPoll = !!alertMetarSettingsShared.checked;
        }
        if (alertMetarSettingsDatisBackground) {
            o.metarWatchFetchDatisInBackground = !!alertMetarSettingsDatisBackground.checked;
        }
        if (alertMetarSettingsFresh) {
            var fwm = Math.floor(Number(alertMetarSettingsFresh.value));
            o.metarWatchAlertFreshMinutes = Number.isFinite(fwm)
                ? Math.min(120, Math.max(1, fwm))
                : metarWatchAlertFreshMinutes();
        }
        if (alertMetarSettingsHiRules) {
            o.metarWatchHighlightWithRulesWhenNotifyOff = !!alertMetarSettingsHiRules.checked;
        }
        if (alertMetarSettingsNotifyColored) {
            o.metarWatchNotifyOnColored = !!alertMetarSettingsNotifyColored.checked;
        }
        if (alertMetarSettingsNotifySpecial) {
            o.metarWatchNotifyOnSpecial = !!alertMetarSettingsNotifySpecial.checked;
        }
        var ssw2;
        for (ssw2 in alertMetarSettingsSw) {
            if (Object.prototype.hasOwnProperty.call(alertMetarSettingsSw, ssw2) && alertMetarSettingsSw[ssw2]) {
                o[ssw2] = !!alertMetarSettingsSw[ssw2].checked;
            }
        }
        writeMetarWatchUi(o);
        try {
            restartPollTimer();
        } catch (e) {}
    }

    function readAlertFormIntoStorage() {
        if (!alertRulesGlobalHost) {
            return;
        }
        var g = collectRuleRowsFromHost(alertRulesGlobalHost);
        var ch = (alertRulesColorHighInp && normalizeRuleHex(alertRulesColorHighInp.value)) || DEFAULT_COLOR_HIGH;
        var ca = (alertRulesColorAdvisoryInp && normalizeRuleHex(alertRulesColorAdvisoryInp.value)) || DEFAULT_COLOR_ADVISORY;
        var cc = (alertRulesColorCustomInp && normalizeRuleHex(alertRulesColorCustomInp.value)) || DEFAULT_COLOR_CUSTOM;
        var cpr = (alertRulesColorPriorityInp && normalizeRuleHex(alertRulesColorPriorityInp.value)) || DEFAULT_COLOR_HIGH;
        var perIata = {};
        if (alertRulesPerHost) {
            var bl = alertRulesPerHost.querySelectorAll('[data-dc-arule-airport]');
            var b;
            for (b = 0; b < bl.length; b++) {
                var bEl = bl[b];
                var codeInp = bEl._iata;
                if (!codeInp) {
                    continue;
                }
                var c = String(codeInp.value || '')
                    .trim()
                    .toUpperCase();
                c = c.replace(/[^A-Z0-9]/g, '');
                if (c.length < 2 || c.length > 4) {
                    continue;
                }
                if (c.length === 4) {
                    c = c.slice(0, 3);
                }
                if (!/^[A-Z]{3}$/.test(c)) {
                    continue;
                }
                if (!bEl._ruleHost) {
                    continue;
                }
                var arr = collectRuleRowsFromHost(bEl._ruleHost);
                if (arr.length) {
                    perIata[c] = arr;
                }
            }
        }
        var hasPer = false;
        var hpk;
        for (hpk in perIata) {
            if (Object.prototype.hasOwnProperty.call(perIata, hpk) && perIata[hpk] && perIata[hpk].length) {
                hasPer = true;
                break;
            }
        }
        var mode;
        if (!g.length && !hasPer) {
            mode = 'off';
        } else if (hasPer) {
            mode = 'per_iata';
        } else {
            mode = 'global';
        }
        writeNotifyRulesUi({
            mode: mode,
            global: g,
            perIata: perIata,
            colorHigh: ch,
            colorAdvisory: ca,
            colorCustom: cc,
            colorPriority: cpr
        });
        readMetarSettingsIntoStorage();
        try {
            pushMetarModalStateToDonkeycodePrefs();
        } catch (eSync) {}
    }

    function addGlobalRuleRow() {
        if (!alertRulesGlobalHost) {
            return;
        }
        alertRulesGlobalHost.appendChild(buildRuleRowEl(null));
    }

    function addPerAirportBlock(airportCode, rulesArr) {
        if (!alertRulesPerHost) {
            return;
        }
        var wrap = document.createElement('div');
        wrap.setAttribute('data-dc-arule-airport', '1');
        wrap.style.border = '1px solid #444';
        wrap.style.borderRadius = '6px';
        wrap.style.padding = '8px';
        wrap.style.marginBottom = '8px';
        wrap.style.background = '#1e1e24';
        var top = document.createElement('div');
        top.style.display = 'flex';
        top.style.alignItems = 'center';
        top.style.gap = '8px';
        top.style.marginBottom = '6px';
        var lab = document.createElement('span');
        lab.textContent = 'IATA';
        lab.style.fontSize = '11px';
        lab.style.color = '#95a5a6';
        var iata = document.createElement('input');
        iata.type = 'text';
        iata.maxLength = 4;
        iata.placeholder = 'e.g. DEN';
        iata.value = airportCode || '';
        iata.style.width = '72px';
        iata.style.boxSizing = 'border-box';
        iata.style.padding = '4px 6px';
        iata.style.fontSize = '12px';
        iata.style.borderRadius = '4px';
        iata.style.border = '1px solid #555';
        iata.style.background = '#2a2a32';
        iata.style.color = '#ecf0f1';
        var addLine = document.createElement('button');
        addLine.type = 'button';
        addLine.textContent = 'Add rule line';
        addLine.style.fontSize = '10px';
        addLine.style.padding = '3px 8px';
        addLine.style.cursor = 'pointer';
        addLine.style.border = '1px solid #555';
        addLine.style.background = '#333';
        addLine.style.color = '#ccc';
        addLine.style.borderRadius = '4px';
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.textContent = 'Remove airport';
        rm.style.fontSize = '10px';
        rm.style.marginLeft = 'auto';
        rm.style.padding = '3px 8px';
        rm.style.cursor = 'pointer';
        rm.style.border = '1px solid #633';
        rm.style.background = '#2a1f1f';
        rm.style.color = '#eaa';
        rm.style.borderRadius = '4px';
        var rh = document.createElement('div');
        rh.setAttribute('data-dc-per-rules', '1');
        wrap._ruleHost = rh;
        wrap._iata = iata;
        var rlist = rulesArr && rulesArr.length ? rulesArr : [null];
        var r;
        for (r = 0; r < rlist.length; r++) {
            rh.appendChild(buildRuleRowEl(rlist[r]));
        }
        addLine.addEventListener('click', function () {
            rh.appendChild(buildRuleRowEl(null));
        });
        rm.addEventListener('click', function () {
            try {
                wrap.remove();
            } catch (e) {}
        });
        top.appendChild(lab);
        top.appendChild(iata);
        top.appendChild(addLine);
        top.appendChild(rm);
        wrap.appendChild(top);
        wrap.appendChild(rh);
        alertRulesPerHost.appendChild(wrap);
        try {
            syncAlertModeUi();
        } catch (e0) {}
    }

    function addPerBlockEmpty() {
        addPerAirportBlock('', [null]);
    }

    function populateAlertRulesForm() {
        if (!alertRulesGlobalHost || !alertRulesPerHost) {
            return;
        }
        alertRulesGlobalHost.innerHTML = '';
        alertRulesPerHost.innerHTML = '';
        var stored = readNotifyRulesUi();
        if (stored) {
            if (alertRulesColorHighInp) {
                alertRulesColorHighInp.value = stored.colorHigh || DEFAULT_COLOR_HIGH;
                var s1 = alertRulesColorHighInp.nextElementSibling;
                if (s1 && s1.style) {
                    s1.style.background = alertRulesColorHighInp.value;
                }
            }
            if (alertRulesColorAdvisoryInp) {
                alertRulesColorAdvisoryInp.value = stored.colorAdvisory || DEFAULT_COLOR_ADVISORY;
                var s2 = alertRulesColorAdvisoryInp.nextElementSibling;
                if (s2 && s2.style) {
                    s2.style.background = alertRulesColorAdvisoryInp.value;
                }
            }
            if (alertRulesColorCustomInp) {
                alertRulesColorCustomInp.value = stored.colorCustom || DEFAULT_COLOR_CUSTOM;
                var s2c = alertRulesColorCustomInp.nextElementSibling;
                if (s2c && s2c.style) {
                    s2c.style.background = alertRulesColorCustomInp.value;
                }
            }
            if (alertRulesColorPriorityInp) {
                alertRulesColorPriorityInp.value = stored.colorPriority || DEFAULT_COLOR_HIGH;
                var s2p = alertRulesColorPriorityInp.nextElementSibling;
                if (s2p && s2p.style) {
                    s2p.style.background = alertRulesColorPriorityInp.value;
                }
            }
            var g = stored.global && Array.isArray(stored.global) ? stored.global : [];
            if (!g.length) {
                g = [null];
            }
            var gi;
            for (gi = 0; gi < g.length; gi++) {
                alertRulesGlobalHost.appendChild(buildRuleRowEl(g[gi]));
            }
            var p = stored.perIata && typeof stored.perIata === 'object' ? stored.perIata : {};
            var k;
            for (k in p) {
                if (Object.prototype.hasOwnProperty.call(p, k) && p[k] && Array.isArray(p[k])) {
                    addPerAirportBlock(k, p[k]);
                }
            }
        } else {
            if (alertRulesColorHighInp) {
                alertRulesColorHighInp.value = DEFAULT_COLOR_HIGH;
            }
            if (alertRulesColorAdvisoryInp) {
                alertRulesColorAdvisoryInp.value = DEFAULT_COLOR_ADVISORY;
                var s2b = alertRulesColorAdvisoryInp.nextElementSibling;
                if (s2b && s2b.style) {
                    s2b.style.background = alertRulesColorAdvisoryInp.value;
                }
            }
            if (alertRulesColorHighInp) {
                var s1b = alertRulesColorHighInp.nextElementSibling;
                if (s1b && s1b.style) {
                    s1b.style.background = alertRulesColorHighInp.value;
                }
            }
            if (alertRulesColorCustomInp) {
                alertRulesColorCustomInp.value = DEFAULT_COLOR_CUSTOM;
                var s3c = alertRulesColorCustomInp.nextElementSibling;
                if (s3c && s3c.style) {
                    s3c.style.background = alertRulesColorCustomInp.value;
                }
            }
            if (alertRulesColorPriorityInp) {
                alertRulesColorPriorityInp.value = DEFAULT_COLOR_HIGH;
                var s3p = alertRulesColorPriorityInp.nextElementSibling;
                if (s3p && s3p.style) {
                    s3p.style.background = alertRulesColorPriorityInp.value;
                }
            }
            if (typeof donkeycodeGetPref === 'function') {
                var gArr = parseNotifyRulesArray(String(donkeycodeGetPref('metarWatchNotifyRulesGlobal') != null ? donkeycodeGetPref('metarWatchNotifyRulesGlobal') : ''));
                if (!gArr.length) {
                    gArr = [null];
                }
                var gk;
                for (gk = 0; gk < gArr.length; gk++) {
                    alertRulesGlobalHost.appendChild(buildRuleRowEl(gArr[gk]));
                }
                var mExt = String(donkeycodeGetPref('metarWatchNotifyRulesMode') || 'off').toLowerCase();
                if (mExt === 'per_iata') {
                    var pmap = parseNotifyRulesPerIataMap(donkeycodeGetPref('metarWatchNotifyRulesPerIata'));
                    var pk;
                    for (pk in pmap) {
                        if (Object.prototype.hasOwnProperty.call(pmap, pk) && pmap[pk] && Array.isArray(pmap[pk])) {
                            addPerAirportBlock(pk, pmap[pk]);
                        }
                    }
                }
            } else {
                alertRulesGlobalHost.appendChild(buildRuleRowEl(null));
            }
        }
        if (alertRulesPerHost && !alertRulesPerHost.querySelector('[data-dc-arule-airport]')) {
            addPerBlockEmpty();
        }
        syncAlertModeUi();
    }

    function buildAlertRulesDialog() {
        alertRulesBackdrop = document.createElement('div');
        alertRulesBackdrop.style.cssText =
            'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000020;';
        alertRulesBackdrop.addEventListener('click', function () {
            closeAlertRulesDialog();
        });
        alertRulesModal = document.createElement('div');
        alertRulesModal.style.cssText =
            'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,98vw);max-height:min(86vh,720px);overflow:hidden;display:none;flex-direction:column;z-index:10000021;background:#25252c;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.6);font-family:system-ui,sans-serif;color:#ecf0f1;';
        alertRulesModal.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        var hdr = document.createElement('div');
        hdr.style.cssText =
            'padding:12px 16px;background:#1e1e24;border-bottom:1px solid #333;font-weight:600;font-size:15px;';
        hdr.textContent = 'Notification alert conditions';
        var sc = document.createElement('div');
        sc.style.cssText = 'padding:12px 16px;overflow:auto;flex:1;min-height:0;';

        var settingsWrap = document.createElement('div');
        settingsWrap.style.cssText =
            'margin-bottom:14px;padding:10px 12px;background:#1a1d28;border:1px solid #333;border-radius:8px;';
        var setTitle = document.createElement('div');
        setTitle.textContent = 'Alerting & background refresh';
        setTitle.style.cssText = 'font-size:12px;font-weight:600;margin-bottom:8px;color:#5dade2;';
        var setGrid = document.createElement('div');
        setGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end;';
        function mkLabel(txt, hint) {
            var lb = document.createElement('label');
            lb.textContent = txt;
            lb.style.cssText = 'font-size:11px;color:#bdc3c7;display:block;margin-bottom:2px;';
            if (hint) {
                lb.title = hint;
            }
            return lb;
        }
        function mkNumIn(ph, w) {
            var n = document.createElement('input');
            n.type = 'number';
            n.min = '1';
            n.step = '1';
            n.placeholder = ph;
            n.style.cssText =
                'width:' +
                (w || '100%') +
                ';box-sizing:border-box;padding:4px 8px;font-size:12px;border-radius:4px;border:1px solid #555;background:#2a2a32;color:#ecf0f1;';
            return n;
        }
        var cell1 = document.createElement('div');
        cell1.style.minWidth = '200px';
        cell1.style.flex = '1 1 200px';
        cell1.appendChild(mkLabel('Browser notifications', 'Notify when a tracked station’s METAR/TAF changes (subject to rules below).'));
        var rowN = document.createElement('div');
        rowN.style.display = 'flex';
        rowN.style.alignItems = 'center';
        rowN.style.gap = '6px';
        alertMetarSettingsNotify = document.createElement('input');
        alertMetarSettingsNotify.type = 'checkbox';
        alertMetarSettingsNotify.title = 'Turn off to disable desktop notifications (WX badge can still use rules).';
        var labN = document.createElement('span');
        labN.textContent = 'Enabled';
        labN.style.fontSize = '12px';
        rowN.appendChild(alertMetarSettingsNotify);
        rowN.appendChild(labN);
        cell1.appendChild(rowN);

        var cell2 = document.createElement('div');
        cell2.style.minWidth = '140px';
        cell2.style.flex = '0 0 120px';
        cell2.appendChild(mkLabel('Poll every (minutes)', 'Background refresh interval for METAR/TAF. Applies after Save.'));
        alertMetarSettingsPoll = mkNumIn('5', '80px');
        alertMetarSettingsPoll.min = '1';
        alertMetarSettingsPoll.max = '120';
        cell2.appendChild(alertMetarSettingsPoll);

        var cell3 = document.createElement('div');
        cell3.style.minWidth = '120px';
        cell3.style.flex = '0 0 100px';
        cell3.appendChild(
            mkLabel('Parallel fetches', 'Stations to load at once during each refresh (1–20).')
        );
        alertMetarSettingsConc = mkNumIn('10', '80px');
        alertMetarSettingsConc.min = '1';
        alertMetarSettingsConc.max = '20';
        cell3.appendChild(alertMetarSettingsConc);

        var cell4 = document.createElement('div');
        cell4.style.minWidth = '200px';
        cell4.style.flex = '1 1 200px';
        cell4.appendChild(
            mkLabel('Sync alerts across tabs', 'One tab leads background polls; other tabs get the same data and can share leader alert state. Reduces duplicate traffic.')
        );
        var rowS = document.createElement('div');
        rowS.style.display = 'flex';
        rowS.style.alignItems = 'center';
        rowS.style.gap = '6px';
        alertMetarSettingsShared = document.createElement('input');
        alertMetarSettingsShared.type = 'checkbox';
        var labS = document.createElement('span');
        labS.textContent = 'On';
        labS.style.fontSize = '12px';
        rowS.appendChild(alertMetarSettingsShared);
        rowS.appendChild(labS);
        cell4.appendChild(rowS);

        var cell5 = document.createElement('div');
        cell5.style.minWidth = '220px';
        cell5.style.flex = '1 1 220px';
        cell5.appendChild(
            mkLabel('D-ATIS background lookups', 'When off, atis.info is queried only for the open station or Refresh D-ATIS. Missing stations are cached for 12 hours.')
        );
        var rowD = document.createElement('div');
        rowD.style.display = 'flex';
        rowD.style.alignItems = 'center';
        rowD.style.gap = '6px';
        alertMetarSettingsDatisBackground = document.createElement('input');
        alertMetarSettingsDatisBackground.type = 'checkbox';
        var labD = document.createElement('span');
        labD.textContent = 'Fetch during refresh';
        labD.style.fontSize = '12px';
        rowD.appendChild(alertMetarSettingsDatisBackground);
        rowD.appendChild(labD);
        cell5.appendChild(rowD);

        setGrid.appendChild(cell1);
        setGrid.appendChild(cell2);
        setGrid.appendChild(cell3);
        setGrid.appendChild(cell4);
        setGrid.appendChild(cell5);
        settingsWrap.appendChild(setTitle);
        settingsWrap.appendChild(setGrid);

        var moreTitle = document.createElement('div');
        moreTitle.textContent = 'List / badge timing & text highlights';
        moreTitle.style.cssText = 'font-size:12px;font-weight:600;margin:14px 0 8px;color:#9b59b6;';
        settingsWrap.appendChild(moreTitle);

        var moreGrid = document.createElement('div');
        moreGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end;';
        var cellF = document.createElement('div');
        cellF.style.minWidth = '120px';
        var labF = document.createElement('label');
        labF.textContent = '“Fresh” alert window (min)';
        labF.style.cssText = 'font-size:11px;color:#bdc3c7;display:block;margin-bottom:2px;';
        labF.title = 'List row stays yellow (fresh) for this long after a rules-matching change; after that, red (stale).';
        cellF.appendChild(labF);
        alertMetarSettingsFresh = mkNumIn('5', '64px');
        alertMetarSettingsFresh.min = '1';
        alertMetarSettingsFresh.max = '120';
        cellF.appendChild(alertMetarSettingsFresh);
        moreGrid.appendChild(cellF);
        settingsWrap.appendChild(moreGrid);

        var freshHelp = document.createElement('div');
        freshHelp.style.cssText =
            'margin:8px 0 0;padding:8px 10px;background:#1e1e24;border:1px solid #333;border-radius:6px;font-size:10px;color:#bdc3c7;line-height:1.45;';
        var freshP1 = document.createElement('div');
        freshP1.textContent =
            '“Fresh” minutes: for an unseen, rules-matching change, the station list and the worksheet WX button use yellow text on the dark background while still “fresh”; if you have not opened the detail after the window, the button flips to a red background with white text (stale) until you open it.';
        var freshP2 = document.createElement('div');
        freshP2.style.marginTop = '6px';
        freshP2.textContent = 'Example — same layout as the real worksheet WX control (14px, badge “!” when alerting):';
        var freshRow1 = document.createElement('div');
        freshRow1.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;';
        function wxDemoButton(fresh) {
            var w = document.createElement('button');
            w.type = 'button';
            w.textContent = 'WX';
            w.title = fresh ? 'Within fresh window (yellow on dark)' : 'Past fresh window, still unseen (stale: red background)';
            w.setAttribute(WX_BTN_ATTR, '1');
            w.setAttribute('data-dc-mx-wx-demo', '1');
            w.style.marginLeft = '0';
            w.style.padding = '0 10px';
            w.style.fontSize = '14px';
            w.style.fontWeight = '600';
            w.style.border = 'none';
            w.style.borderRadius = '4px';
            w.style.cursor = 'default';
            w.style.position = 'relative';
            w.style.boxSizing = 'border-box';
            w.style.maxHeight = '50px';
            w.style.minHeight = '32px';
            w.style.display = 'inline-flex';
            w.style.alignItems = 'center';
            w.style.justifyContent = 'center';
            w.style.lineHeight = '1';
            if (fresh) {
                w.style.background = '#2c3e50';
                w.style.color = '#f1c40f';
            } else {
                w.style.background = '#c0392b';
                w.style.color = '#fff';
                w.setAttribute('data-dc-metar-alert', '1');
            }
            var bd = document.createElement('span');
            bd.textContent = '!';
            bd.style.display = 'inline-block';
            bd.style.position = 'absolute';
            bd.style.top = '-6px';
            bd.style.right = '-6px';
            bd.style.background = '#f1c40f';
            bd.style.color = '#000';
            bd.style.fontSize = '10px';
            bd.style.fontWeight = '800';
            bd.style.borderRadius = '8px';
            bd.style.minWidth = '16px';
            bd.style.height = '16px';
            bd.style.lineHeight = '16px';
            bd.style.textAlign = 'center';
            w.appendChild(bd);
            return w;
        }
        var s1 = wxDemoButton(true);
        var s2 = wxDemoButton(false);
        var freshLbl = document.createElement('span');
        freshLbl.style.cssText = 'color:#95a5a6;font-size:9px;';
        freshLbl.textContent = 'fresh (yellow on dark)';
        var staleLbl = document.createElement('span');
        staleLbl.style.cssText = 'color:#95a5a6;font-size:9px;';
        staleLbl.textContent = 'stale (red fill)';
        freshRow1.appendChild(s1);
        freshRow1.appendChild(freshLbl);
        freshRow1.appendChild(s2);
        freshRow1.appendChild(staleLbl);
        freshHelp.appendChild(freshP1);
        freshHelp.appendChild(freshP2);
        freshHelp.appendChild(freshRow1);
        settingsWrap.appendChild(freshHelp);

        var swLab = document.createElement('div');
        swLab.textContent = 'Color coding for METAR/TAF (per-token IFR, MVFR, etc.)';
        swLab.style.cssText = 'font-size:11px;color:#95a5a6;margin:8px 0 4px;';
        settingsWrap.appendChild(swLab);
        var swMap = [
            ['metarWatchTextHighlightSwStyle', 'On (master)'],
            ['metarHighlightIFR', 'IFR'],
            ['metarHighlightMVFR', 'MVFR'],
            ['metarHighlightCrosswind', 'Crosswind'],
            ['metarHighlightLLWS', 'LLWS'],
            ['metarHighlightIcing', 'Icing'],
            ['metarHighlightTS', 'T-storms']
        ];
        var swR = document.createElement('div');
        swR.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;';
        var sxi;
        for (sxi = 0; sxi < swMap.length; sxi++) {
            var wk = swMap[sxi][0];
            var wl = document.createElement('label');
            wl.setAttribute('data-dc-mx-swl', wk);
            wl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;user-select:none;';
            var wcb = document.createElement('input');
            wcb.type = 'checkbox';
            wcb.setAttribute('data-dc-mx-sw', wk);
            alertMetarSettingsSw[wk] = wcb;
            if (wk !== 'metarWatchTextHighlightSwStyle') {
                wl.style.color = '#95a5a6';
            }
            wl.appendChild(wcb);
            wl.appendChild(document.createTextNode(swMap[sxi][1]));
            swR.appendChild(wl);
        }
        var masterW = alertMetarSettingsSw['metarWatchTextHighlightSwStyle'];
        function applySwTokenMasterState() {
            var on = masterW && !!masterW.checked;
            var sxi2;
            for (sxi2 = 0; sxi2 < swMap.length; sxi2++) {
                if (swMap[sxi2][0] === 'metarWatchTextHighlightSwStyle') {
                    continue;
                }
                var cbx = alertMetarSettingsSw[swMap[sxi2][0]];
                if (!cbx) {
                    continue;
                }
                cbx.disabled = !on;
                cbx.title = on ? '' : 'Turn on the master to edit';
                if (!on) {
                    cbx.checked = false;
                }
                var le = cbx.parentElement;
                if (le) {
                    le.style.opacity = on ? '1' : '0.4';
                }
            }
        }
        if (masterW) {
            masterW.addEventListener('change', applySwTokenMasterState);
        }
        settingsWrap.appendChild(swR);

        var afterSwLine = document.createElement('div');
        afterSwLine.style.cssText = 'margin:10px 0 0;padding:8px 0 0;border-top:1px solid #2c2c36;';
        var afterSwL = document.createElement('div');
        afterSwL.style.cssText = 'font-size:10px;color:#95a5a6;margin-bottom:6px;';
        afterSwL.textContent = 'Underlines: apply your notify rules in text (in addition to color coding above, when rules are defined).';
        afterSwLine.appendChild(afterSwL);
        var rowHi = document.createElement('div');
        rowHi.style.cssText = 'display:flex;align-items:center;gap:6px;';
        alertMetarSettingsHiRules = document.createElement('input');
        alertMetarSettingsHiRules.type = 'checkbox';
        var labH2b = document.createElement('span');
        labH2b.textContent = 'Apply rules to METAR/TAF underlines when you have no rule-based notifications (see below)';
        labH2b.style.cssText = 'font-size:11px;color:#bdc3c7;';
        labH2b.title =
            'If you are not using rule-only notifications, still show CIG/vis/rule underlines in the text when rules are defined, not only the color-coding line highlights.';
        rowHi.appendChild(alertMetarSettingsHiRules);
        rowHi.appendChild(labH2b);
        afterSwLine.appendChild(rowHi);
        var rowNCol = document.createElement('div');
        rowNCol.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;';
        alertMetarSettingsNotifyColored = document.createElement('input');
        alertMetarSettingsNotifyColored.type = 'checkbox';
        alertMetarSettingsNotifyColored.title =
            'When on, a desktop notification is sent if text matches your custom rules. When you have no rules, every METAR/TAF change still alerts.';
        var labNsp1 = document.createElement('span');
        labNsp1.textContent = 'Notify for the above color coding (rules; else any change if no rules)';
        labNsp1.style.cssText = 'font-size:11px;color:#bdc3c7;';
        rowNCol.appendChild(alertMetarSettingsNotifyColored);
        rowNCol.appendChild(labNsp1);
        afterSwLine.appendChild(rowNCol);
        settingsWrap.appendChild(afterSwLine);
        var notifySpecLine = document.createElement('div');
        notifySpecLine.style.cssText = 'margin:6px 0 0;padding:0 0 0;border-top:none;';
        var rowNsp2 = document.createElement('div');
        rowNsp2.style.cssText = 'display:flex;align-items:center;gap:6px;';
        alertMetarSettingsNotifySpecial = document.createElement('input');
        alertMetarSettingsNotifySpecial.type = 'checkbox';
        alertMetarSettingsNotifySpecial.title =
            'Also notify on SPECI METARs, or TAFs with TEMPO/BECMG/PROB/FM groups. Independent of the rule list.';
        var labNsp2 = document.createElement('span');
        labNsp2.textContent = 'Notify for special TAF or METAR (e.g. SPECI, TEMPO/BECMG/PROB)';
        labNsp2.style.cssText = 'font-size:11px;color:#bdc3c7;';
        rowNsp2.appendChild(alertMetarSettingsNotifySpecial);
        rowNsp2.appendChild(labNsp2);
        notifySpecLine.appendChild(rowNsp2);
        settingsWrap.appendChild(notifySpecLine);
        metarSettingsApplySwTokenMaster = applySwTokenMasterState;
        applySwTokenMasterState();

        sc.appendChild(settingsWrap);

        var catRow = document.createElement('div');
        catRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-bottom:12px;padding:8px 10px;background:#1e1e24;border-radius:6px;border:1px solid #333;';
        var catLab = document.createElement('span');
        catLab.textContent = 'Default rule colors';
        catLab.style.cssText = 'font-size:12px;color:#bdc3c7;font-weight:600;';
        var hiWrap = document.createElement('label');
        hiWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#ecf0f1;';
        hiWrap.appendChild(document.createTextNode('High'));
        alertRulesColorHighInp = document.createElement('input');
        alertRulesColorHighInp.type = 'color';
        alertRulesColorHighInp.value = DEFAULT_COLOR_HIGH;
        alertRulesColorHighInp.title = 'High';
        alertRulesColorHighInp.style.cssText = 'width:28px;height:28px;padding:0;border:none;cursor:pointer;';
        var hiSw = document.createElement('span');
        hiSw.style.cssText = 'display:inline-block;width:28px;height:28px;border-radius:4px;border:1px solid #555;vertical-align:middle;';
        function syncHi() {
            hiSw.style.background = alertRulesColorHighInp.value;
        }
        alertRulesColorHighInp.addEventListener('input', syncHi);
        alertRulesColorHighInp.addEventListener('change', syncHi);
        hiWrap.appendChild(alertRulesColorHighInp);
        hiWrap.appendChild(hiSw);
        var adWrap = document.createElement('label');
        adWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#ecf0f1;';
        adWrap.appendChild(document.createTextNode('Advisory'));
        alertRulesColorAdvisoryInp = document.createElement('input');
        alertRulesColorAdvisoryInp.type = 'color';
        alertRulesColorAdvisoryInp.value = DEFAULT_COLOR_ADVISORY;
        alertRulesColorAdvisoryInp.title = 'Advisory';
        alertRulesColorAdvisoryInp.style.cssText = 'width:28px;height:28px;padding:0;border:none;cursor:pointer;';
        var adSw = document.createElement('span');
        adSw.style.cssText = 'display:inline-block;width:28px;height:28px;border-radius:4px;border:1px solid #555;vertical-align:middle;';
        function syncAd() {
            adSw.style.background = alertRulesColorAdvisoryInp.value;
        }
        alertRulesColorAdvisoryInp.addEventListener('input', syncAd);
        alertRulesColorAdvisoryInp.addEventListener('change', syncAd);
        adWrap.appendChild(alertRulesColorAdvisoryInp);
        adWrap.appendChild(adSw);
        var cuWrap = document.createElement('label');
        cuWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#ecf0f1;';
        cuWrap.appendChild(document.createTextNode('Custom (level)'));
        alertRulesColorCustomInp = document.createElement('input');
        alertRulesColorCustomInp.type = 'color';
        alertRulesColorCustomInp.value = DEFAULT_COLOR_CUSTOM;
        alertRulesColorCustomInp.title = '“Custom (preset)” rule level (no per-rule color)';
        alertRulesColorCustomInp.style.cssText = 'width:28px;height:28px;padding:0;border:none;cursor:pointer;';
        var cuSw = document.createElement('span');
        cuSw.style.cssText = 'display:inline-block;width:28px;height:28px;border-radius:4px;border:1px solid #555;vertical-align:middle;';
        function syncCu() {
            cuSw.style.background = alertRulesColorCustomInp.value;
        }
        alertRulesColorCustomInp.addEventListener('input', syncCu);
        alertRulesColorCustomInp.addEventListener('change', syncCu);
        cuWrap.appendChild(alertRulesColorCustomInp);
        cuWrap.appendChild(cuSw);
        var prWrap = document.createElement('label');
        prWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#ecf0f1;';
        prWrap.appendChild(document.createTextNode('Priority (level)'));
        alertRulesColorPriorityInp = document.createElement('input');
        alertRulesColorPriorityInp.type = 'color';
        alertRulesColorPriorityInp.value = DEFAULT_COLOR_HIGH;
        alertRulesColorPriorityInp.title = '“Priority (preset)” rule level; usually same as High';
        alertRulesColorPriorityInp.style.cssText = 'width:28px;height:28px;padding:0;border:none;cursor:pointer;';
        var prSw = document.createElement('span');
        prSw.style.cssText = 'display:inline-block;width:28px;height:28px;border-radius:4px;border:1px solid #555;vertical-align:middle;';
        function syncPr() {
            prSw.style.background = alertRulesColorPriorityInp.value;
        }
        alertRulesColorPriorityInp.addEventListener('input', syncPr);
        alertRulesColorPriorityInp.addEventListener('change', syncPr);
        prWrap.appendChild(alertRulesColorPriorityInp);
        prWrap.appendChild(prSw);
        catRow.appendChild(catLab);
        catRow.appendChild(hiWrap);
        catRow.appendChild(adWrap);
        catRow.appendChild(cuWrap);
        catRow.appendChild(prWrap);
        syncHi();
        syncAd();
        syncCu();
        syncPr();
        sc.appendChild(catRow);

        alertRulesGlobalBlock = document.createElement('div');
        var gHead = document.createElement('div');
        gHead.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px;';
        var gLab = document.createElement('div');
        gLab.textContent = 'Global rules (any row can match; OR across rows)';
        gLab.style.cssText = 'font-size:12px;font-weight:600;color:#3498db;flex:1;min-width:0;';
        gLab.setAttribute('data-dc-glab', '1');
        var addG = document.createElement('button');
        addG.type = 'button';
        addG.textContent = 'Add rule';
        addG.style.cssText = 'font-size:11px;padding:4px 10px;cursor:pointer;border-radius:4px;border:1px solid #555;background:#2a2a32;color:#ecf0f1;';
        addG.addEventListener('click', addGlobalRuleRow);
        gHead.appendChild(gLab);
        gHead.appendChild(addG);
        alertRulesGlobalHost = document.createElement('div');
        var gColH = document.createElement('div');
        gColH.style.cssText =
            'display:grid;grid-template-columns:minmax(88px,0.9fr) 16px 22px 1fr 1fr 1fr 1fr;gap:6px;font-size:9px;color:#7f8c8d;margin-bottom:2px;align-items:end;';
        var h0a = document.createElement('span');
        h0a.textContent = 'Level';
        var h0b = document.createElement('span');
        h0b.textContent = ' ';
        h0b.title = 'Check = custom';
        var h0c = document.createElement('span');
        h0c.textContent = ' ';
        var h1 = document.createElement('span');
        h1.textContent = 'M CIG ≤ ft';
        var h2 = document.createElement('span');
        h2.textContent = 'M vis ≤ sm';
        var h3 = document.createElement('span');
        h3.textContent = 'T CIG ≤ ft';
        var h4 = document.createElement('span');
        h4.textContent = 'T vis ≤ sm';
        gColH.appendChild(h0a);
        gColH.appendChild(h0b);
        gColH.appendChild(h0c);
        gColH.appendChild(h1);
        gColH.appendChild(h2);
        gColH.appendChild(h3);
        gColH.appendChild(h4);
        alertRulesGlobalBlock.appendChild(gHead);
        alertRulesGlobalBlock.appendChild(gColH);
        alertRulesGlobalBlock.appendChild(alertRulesGlobalHost);
        sc.appendChild(alertRulesGlobalBlock);

        var pWrap = document.createElement('div');
        pWrap.style.cssText = 'display:none;';
        alertRulesPerSectionWrap = pWrap;
        pWrap.setAttribute('data-dc-per-wrap', '1');
        var pHead = document.createElement('div');
        pHead.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0 6px;';
        var pTitle = document.createElement('div');
        pTitle.textContent = 'Per-airport extra rules (OR with global for that IATA)';
        pTitle.style.cssText = 'font-size:12px;font-weight:600;color:#9b59b6;flex:1;min-width:0;';
        var addP = document.createElement('button');
        addP.type = 'button';
        addP.textContent = 'Add rule';
        addP.style.cssText = 'font-size:11px;padding:4px 10px;cursor:pointer;border-radius:4px;border:1px solid #555;background:#2a2a32;color:#ecf0f1;';
        addP.addEventListener('click', addPerBlockEmpty);
        alertRulesPerHost = document.createElement('div');
        pHead.appendChild(pTitle);
        pHead.appendChild(addP);
        pWrap.appendChild(pHead);
        pWrap.appendChild(alertRulesPerHost);
        sc.appendChild(pWrap);

        var foot = document.createElement('div');
        foot.style.cssText =
            'display:flex;gap:8px;justify-content:flex-end;padding:10px 16px;border-top:1px solid #333;background:#1e1e24;';
        var saveB = document.createElement('button');
        saveB.type = 'button';
        saveB.textContent = 'Save';
        saveB.style.cssText = 'padding:8px 16px;font-size:12px;cursor:pointer;border-radius:4px;border:none;background:#2980b9;color:#fff;';
        var cancelB = document.createElement('button');
        cancelB.type = 'button';
        cancelB.textContent = 'Cancel';
        cancelB.style.cssText = 'padding:8px 16px;font-size:12px;cursor:pointer;border-radius:4px;border:1px solid #555;background:#2a2a32;color:#ecf0f1;';
        var useExtB = document.createElement('button');
        useExtB.type = 'button';
        useExtB.textContent = 'Use DonkeyCODE JSON instead';
        useExtB.title = 'Clear in-browser rules and use extension JSON string preferences';
        useExtB.style.cssText = 'padding:8px 10px;font-size:11px;cursor:pointer;border-radius:4px;border:1px solid #555;background:#2a1a1a;color:#eaa;';
        saveB.addEventListener('click', function () {
            readAlertFormIntoStorage();
            updateAlertState();
            closeAlertRulesDialog();
        });
        cancelB.addEventListener('click', closeAlertRulesDialog);
        useExtB.addEventListener('click', function () {
            if (
                window.confirm(
                    'Clear in-browser rules and notify/refresh settings (this browser) and use DonkeyCODE JSON + extension defaults?'
                )
            ) {
                clearNotifyRulesUi();
                try {
                    localStorage.removeItem(LS_METAR_UI_SETTINGS);
                } catch (e) {}
                try {
                    tryDonkeycodeSetScriptPref('metarWatchModalStateJson', '');
                    tryDonkeycodeSetScriptPref('metarWatchNotifyRulesMode', 'off');
                    tryDonkeycodeSetScriptPref('metarWatchNotifyRulesGlobal', '[]');
                    tryDonkeycodeSetScriptPref('metarWatchNotifyRulesPerIata', '{}');
                    tryDonkeycodeRequestPreferenceSync();
                } catch (e3) {}
                try {
                    restartPollTimer();
                } catch (e2) {}
                updateAlertState();
                closeAlertRulesDialog();
            }
        });
        foot.appendChild(useExtB);
        foot.appendChild(cancelB);
        foot.appendChild(saveB);
        var hdrBlock = document.createElement('div');
        hdrBlock.appendChild(hdr);
        alertRulesModal.appendChild(hdrBlock);
        alertRulesModal.appendChild(sc);
        alertRulesModal.appendChild(foot);
        document.body.appendChild(alertRulesBackdrop);
        document.body.appendChild(alertRulesModal);
    }

    function openAlertRulesDialog() {
        if (!alertRulesModal) {
            buildAlertRulesDialog();
        }
        populateMetarSettingsForm();
        populateAlertRulesForm();
        syncAlertModeUi();
        if (alertRulesBackdrop) {
            alertRulesBackdrop.style.display = 'block';
        }
        if (alertRulesModal) {
            alertRulesModal.style.display = 'flex';
        }
    }

    function closeAlertRulesDialog() {
        if (alertRulesBackdrop) {
            alertRulesBackdrop.style.display = 'none';
        }
        if (alertRulesModal) {
            alertRulesModal.style.display = 'none';
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
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.textContent = 'Alert rules';
        rulesBtn.title = 'Set conditions for badge/notify (form — no JSON)';
        rulesBtn.style.marginRight = '8px';
        rulesBtn.style.padding = '6px 10px';
        rulesBtn.style.fontSize = '12px';
        rulesBtn.style.borderRadius = '4px';
        rulesBtn.style.border = '1px solid #6c5ce7';
        rulesBtn.style.background = '#2d2640';
        rulesBtn.style.color = '#dccffc';
        rulesBtn.style.cursor = 'pointer';
        rulesBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            openAlertRulesDialog();
        });
        header.appendChild(headerTitle);
        header.appendChild(refreshThisBtn);
        header.appendChild(refreshAllBtn);
        header.appendChild(rulesBtn);
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

        var leftScroll = document.createElement('div');
        leftScroll.setAttribute('data-dc-mx-left-scroll', '1');
        leftScroll.style.cssText = 'flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:8px;';

        listEl = document.createElement('div');
        listEl.style.flex = '0 0 auto';
        listEl.style.minHeight = '0';
        listEl.style.overflow = 'visible';

        var quickAddHost = document.createElement('div');
        quickAddHost.setAttribute('data-dc-mx-quick-add', '1');
        quickAddHost.style.cssText = 'flex:0 0 auto;min-height:0;display:none;';
        var quickDeets = document.createElement('details');
        try {
            quickDeets.open = true;
        } catch (e) {}
        quickDeets.style.cssText = 'border:1px solid #3a3a45;border-radius:6px;background:#1e1e24;padding:6px 8px;';
        var quickSum = document.createElement('summary');
        quickSum.textContent = 'Regions & sectors';
        quickSum.style.cssText = 'cursor:pointer;font-size:12px;font-weight:600;color:#5dade2;user-select:none;list-style:none;';
        try {
            quickSum.style.listStyle = 'none';
        } catch (e) {}
        quickDeets.appendChild(quickSum);
        var quickChWrap = document.createElement('div');
        quickChWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:11px;color:#bdc3c7;margin-top:6px;';
        var rKeys = Object.keys(METAR_PRESET_REGIONS);
        var rki;
        for (rki = 0; rki < rKeys.length; rki++) {
            var rkey = rKeys[rki];
            var rg = METAR_PRESET_REGIONS[rkey];
            var lbr = document.createElement('label');
            lbr.style.cssText = 'display:flex;align-items:flex-start;gap:6px;cursor:pointer;user-select:none;';
            var cbr = document.createElement('input');
            cbr.type = 'checkbox';
            cbr.setAttribute('data-dc-mx-preset-key', rkey);
            cbr.setAttribute('data-dc-mx-preset-kind', 'region');
            cbr.style.marginTop = '2px';
            var tdiv = document.createElement('span');
            tdiv.style.cssText = 'color:#a569bd;font-weight:600;';
            tdiv.textContent = rg.label;
            lbr.appendChild(cbr);
            lbr.appendChild(tdiv);
            quickChWrap.appendChild(lbr);
        }
        var secLab = document.createElement('div');
        secLab.textContent = 'Sectors';
        secLab.style.cssText = 'font-weight:600;margin-top:4px;color:#3498db;font-size:11px;';
        quickChWrap.appendChild(secLab);
        var sKeys = Object.keys(METAR_PRESET_SECTORS);
        var ski;
        for (ski = 0; ski < sKeys.length; ski++) {
            var skey = sKeys[ski];
            var sec = METAR_PRESET_SECTORS[skey];
            var lb = document.createElement('label');
            lb.style.cssText = 'display:flex;align-items:flex-start;gap:6px;cursor:pointer;user-select:none;';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.setAttribute('data-dc-mx-preset-key', skey);
            cb.setAttribute('data-dc-mx-preset-kind', 'sector');
            cb.style.marginTop = '2px';
            var spanT = document.createElement('span');
            spanT.style.cssText = 'color:#ecf0f1;font-weight:600;';
            spanT.textContent = sec.label;
            lb.appendChild(cb);
            lb.appendChild(spanT);
            quickChWrap.appendChild(lb);
        }
        var quickAct = document.createElement('div');
        quickAct.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center;';
        var addPresetBtn = document.createElement('button');
        addPresetBtn.type = 'button';
        addPresetBtn.textContent = 'Add selected';
        addPresetBtn.style.cssText = 'padding:5px 10px;font-size:12px;border:none;border-radius:4px;background:#2980b9;color:#fff;cursor:pointer;';
        addPresetBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var toAdd = iatasFromPresetCheckboxes(quickAddHost);
            if (!toAdd.length) {
                setStatusBar('No new stations to add (already in list or no ICAO).');
                return;
            }
            var merged = mergePresetIatasIntoStationList(toAdd);
            if (!merged.length) {
                setStatusBar('All selected codes are already in the list or lack ICAO mapping.');
                return;
            }
            if (addInput) {
                addInput.value = '';
            }
            if (selectedIata && stationList.indexOf(selectedIata) < 0) {
                selectedIata = null;
            }
            selectedIata = merged[0] || selectedIata || stationList[0] || null;
            renderStationList();
            if (selectedIata) {
                renderDetail(selectedIata, { deferEnrichment: true, skipCodLoop: true });
            }
            setStatusBar('Adding ' + merged.length + ' station(s)…');
            fetchAllStations(
                merged,
                function () {
                    renderStationList();
                    if (selectedIata) {
                        renderDetail(selectedIata, { skipCodLoop: true });
                    }
                    updateRefreshThisLabel();
                    updateAlertState();
                    setStatusBar('Added ' + merged.length + ' to list · ' + new Date().toLocaleTimeString());
                },
                function (iata) {
                    setStatusBar('Loading ' + (iata || '') + '…');
                },
                { deferEnrichment: true }
            );
        });
        var clearPresetBtn = document.createElement('button');
        clearPresetBtn.type = 'button';
        clearPresetBtn.textContent = 'Clear';
        clearPresetBtn.style.cssText = 'padding:5px 10px;font-size:12px;border-radius:4px;border:1px solid #555;background:#2a2a32;color:#ccc;cursor:pointer;';
        clearPresetBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var all = quickAddHost.querySelectorAll('input[type="checkbox"][data-dc-mx-preset-key]');
            var z;
            for (z = 0; z < all.length; z++) {
                all[z].checked = false;
            }
        });
        quickAct.appendChild(addPresetBtn);
        quickAct.appendChild(clearPresetBtn);
        quickChWrap.appendChild(quickAct);
        quickDeets.appendChild(quickChWrap);
        quickAddHost.appendChild(quickDeets);

        var addRow = document.createElement('div');
        addRow.style.marginTop = '10px';
        addRow.style.flexShrink = '0';
        addRow.style.display = 'flex';
        addRow.style.flexDirection = 'column';
        addRow.style.gap = '8px';

        var inputWrap = document.createElement('div');
        inputWrap.style.cssText =
            'display:flex;align-items:stretch;gap:0;border:1px solid #444;border-radius:4px;background:#2a2a32;overflow:hidden;min-height:32px;';
        var quickToggleBtn = document.createElement('button');
        quickToggleBtn.type = 'button';
        quickToggleBtn.textContent = 'Quick add';
        quickToggleBtn.title = 'Show or hide region/sector quick add (below)';
        quickToggleBtn.setAttribute('aria-expanded', 'false');
        quickToggleBtn.setAttribute('aria-controls', 'dc-mx-quick-add-panel');
        quickAddHost.id = 'dc-mx-quick-add-panel';
        quickToggleBtn.style.cssText =
            'flex:0 0 auto;align-self:stretch;padding:4px 6px;font-size:10px;font-weight:700;line-height:1.15;border:none;border-right:1px solid #444;background:#25252c;color:#5dade2;cursor:pointer;max-width:58px;text-align:center;';
        addInput = document.createElement('input');
        addInput.type = 'text';
        addInput.placeholder = 'KDEN or DEN';
        addInput.maxLength = 8;
        addInput.setAttribute('aria-label', 'Airport code to add');
        addInput.style.flex = '1';
        addInput.style.minWidth = '0';
        addInput.style.boxSizing = 'border-box';
        addInput.style.padding = '6px 8px';
        addInput.style.border = 'none';
        addInput.style.borderRadius = '0';
        addInput.style.background = 'transparent';
        addInput.style.color = '#ecf0f1';
        addInput.style.fontSize = '12px';
        quickToggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            var hidden = quickAddHost.style.display === 'none' || !quickAddHost.style.display;
            if (hidden) {
                quickAddHost.style.display = 'block';
                quickToggleBtn.setAttribute('aria-expanded', 'true');
            } else {
                quickAddHost.style.display = 'none';
                quickToggleBtn.setAttribute('aria-expanded', 'false');
            }
        });
        inputWrap.appendChild(quickToggleBtn);
        inputWrap.appendChild(addInput);
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = 'Add station';
        addBtn.style.flex = '1';
        addBtn.style.minWidth = '0';
        addBtn.style.boxSizing = 'border-box';
        addBtn.style.padding = '8px 10px';
        addBtn.style.border = 'none';
        addBtn.style.borderRadius = '4px';
        addBtn.style.background = '#2980b9';
        addBtn.style.color = '#fff';
        addBtn.style.cursor = 'pointer';
        addBtn.style.fontSize = '13px';
        addBtn.style.flexShrink = '0';
        var clearAllBtn = document.createElement('button');
        clearAllBtn.type = 'button';
        clearAllBtn.textContent = 'Clear all';
        clearAllBtn.title = 'Remove every station from the tracked list';
        clearAllBtn.style.cssText =
            'flex:0 0 auto;padding:8px 10px;border:1px solid #7e3c3c;border-radius:4px;background:#4c2424;color:#fadbd8;cursor:pointer;font-size:12px;white-space:nowrap;';
        var addBtnRow = document.createElement('div');
        addBtnRow.style.cssText = 'display:flex;gap:6px;align-items:stretch;';

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
        clearAllBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!stationList.length) {
                setStatusBar('No stations to clear.');
                return;
            }
            stationList = [];
            saveStationList(stationList);
            pendingChangeTime = {};
            selectedIata = null;
            if (addInput) {
                addInput.value = '';
            }
            renderStationList();
            renderDetail(null, { skipCodLoop: true });
            updateRefreshThisLabel();
            updateAlertState();
            setStatusBar('Cleared all stations · ' + new Date().toLocaleTimeString());
            runPoll();
        });
        addBtnRow.appendChild(addBtn);
        addBtnRow.appendChild(clearAllBtn);
        addRow.appendChild(inputWrap);
        addRow.appendChild(quickAddHost);
        addRow.appendChild(addBtnRow);

        leftScroll.appendChild(listEl);
        left.appendChild(sortRow);
        left.appendChild(leftScroll);
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
            if (e.key !== 'Escape') {
                return;
            }
            if (alertRulesModal && alertRulesModal.style.display === 'flex') {
                closeAlertRulesDialog();
                return;
            }
            if (modal && modal.style.display === 'flex') {
                closeModal();
            }
        };
        document.addEventListener('keydown', onDocKey);
    }

    function init() {
        try {
            migrateMetarModalBundleFromPrefs();
        } catch (eMig) {}
        ensureWorksheetToolbarClickDebug();
        buildModal();
        mountButtonNearClock();
        var flo = document.getElementById('dc-worksheet-scripts-float-host');
        if (flo) {
            try {
                flo.remove();
            } catch (e) {}
        }
        initCrossTabPollSync();
        initMetarTafSharedSync();
        initViewedSync();
        restartPollTimer();
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
            if (alertRulesBackdrop) {
                alertRulesBackdrop.remove();
            }
        } catch (e) {}
        try {
            if (alertRulesModal) {
                alertRulesModal.remove();
            }
        } catch (e) {}
        alertRulesBackdrop = null;
        alertRulesModal = null;
        metarSettingsApplySwTokenMaster = null;
        alertMetarSettingsDatisBackground = null;
        alertMetarSettingsNotifyColored = null;
        alertMetarSettingsNotifySpecial = null;
        alertRulesGlobalBlock = null;
        alertRulesGlobalHost = null;
        alertRulesPerSectionWrap = null;
        alertRulesPerHost = null;
        try {
            if (btn) {
                btn.remove();
            }
        } catch (e) {}
        try {
            var ts = document.getElementById(TOOLBAR_STYLE_ID);
            if (ts) {
                ts.remove();
            }
        } catch (e3) {}
        try {
            var hel = document.querySelector(
                '[data-dc-worksheet-helper-buttons="1"]'
            );
            if (
                hel &&
                !hel.querySelector(
                    'button, #' + WSB_STATE_ID
                )
            ) {
                hel.remove();
            }
        } catch (e5) {}
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
