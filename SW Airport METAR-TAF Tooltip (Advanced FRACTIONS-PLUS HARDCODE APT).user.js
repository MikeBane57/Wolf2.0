// ==UserScript==
// @name         SW Airport METAR/TAF Tooltip (Advanced FRACTIONS-PLUS HARDCODE APT)
// @namespace    Wolf 2.0
// @version      7.5
// @description  METAR/TAF tooltip with per-token coloring, advanced alerts, prefs; shares METAR/TAF cache with METAR watch (same tab)
// @match        https://opssuitemain.swacorp.com/*worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        GM_xmlhttpRequest
// @connect      tgftp.nws.noaa.gov
// @donkeycode-pref {"metarCacheMinutes":{"type":"number","group":"METAR tooltip","label":"Cache (minutes)","description":"How long to reuse fetched METAR/TAF before refreshing.","default":5,"min":1,"max":120,"step":1},"metarDebug":{"type":"boolean","group":"METAR tooltip","label":"Debug logging","description":"Log to the browser console when enabled.","default":false},"metarTooltipOffsetX":{"type":"number","group":"METAR tooltip","label":"Tooltip offset X (px)","description":"Added to click position (positive = right).","default":12,"min":-500,"max":500,"step":1},"metarTooltipOffsetY":{"type":"number","group":"METAR tooltip","label":"Tooltip offset Y (px)","description":"Added to click position (positive = down).","default":12,"min":-500,"max":500,"step":1},"metarTooltipDisplayMs":{"type":"number","group":"METAR tooltip","label":"Auto-hide after (ms)","description":"0 = stay open until you click elsewhere.","default":0,"min":0,"max":300000,"step":1000},"metarUseCustomAirportAlerts":{"type":"boolean","group":"METAR alerts","label":"Use custom airport thresholds","description":"Airport-specific rules in the script (e.g. BUR ceilings/gusts). Turn off to ignore those.","default":true},"metarHighlightIFR":{"type":"boolean","group":"METAR highlights","label":"Highlight IFR (ceiling/vis)","default":true},"metarHighlightMVFR":{"type":"boolean","group":"METAR highlights","label":"Highlight MVFR","default":true},"metarHighlightCustom":{"type":"boolean","group":"METAR highlights","label":"Highlight custom threshold hits","description":"When custom airport alerts fire.","default":true},"metarHighlightCrosswind":{"type":"boolean","group":"METAR highlights","label":"Highlight crosswind","default":true},"metarHighlightLLWS":{"type":"boolean","group":"METAR highlights","label":"Highlight LLWS / WS","default":true},"metarHighlightIcing":{"type":"boolean","group":"METAR highlights","label":"Highlight icing","default":true},"metarHighlightTS":{"type":"boolean","group":"METAR highlights","label":"Highlight thunderstorms","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SW%20Airport%20METAR-TAF%20Tooltip%20(Advanced%20FRACTIONS-PLUS%20HARDCODE%20APT).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SW%20Airport%20METAR-TAF%20Tooltip%20(Advanced%20FRACTIONS-PLUS%20HARDCODE%20APT).user.js
// ==/UserScript==

(function() {
"use strict";

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

function getCacheMs() {
    return numPref('metarCacheMinutes', 5, 1, 120) * 60 * 1000;
}

/** Same keys as METAR watch — tgftp-equivalent METAR/TAF text shared across scripts via localStorage + BroadcastChannel. */
var LS_METAR_TAF_SHARED = 'dc-metar-taf-shared-v1';
var BC_METAR_TAF_SHARED = 'dc-metar-taf-shared';
var SHARED_METAR_TAF_TTL_MS = 8 * 60 * 1000;
var metarTafSharedChannel = null;
var onStorageMetarTaf = null;

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
    writeSharedMetarTafEntry(icao, metar, taf);
    broadcastSharedMetarTaf(icao, metar, taf);
}

function logDebug() {
    if (!boolPref('metarDebug', false)) {
        return;
    }
    console.log.apply(console, arguments);
}

function allowHighlight(cls) {
    if (!cls) {
        return null;
    }
    var map = {
        ifr: 'metarHighlightIFR',
        mvfr: 'metarHighlightMVFR',
        custom: 'metarHighlightCustom',
        crosswind: 'metarHighlightCrosswind',
        llws: 'metarHighlightLLWS',
        icing: 'metarHighlightIcing',
        ts: 'metarHighlightTS'
    };
    var pk = map[cls];
    if (!pk) {
        return cls;
    }
    return boolPref(pk, true) ? cls : null;
}

// ---------------- CONFIG ----------------
const cache = {};

const IATA_TO_ICAO = {
ABQ:"KABQ", ALB:"KALB", ATL:"KATL", AUS:"KAUS", BDL:"KBDL", BHM:"KBHM", BNA:"KBNA",
BOS:"KBOS", BOI:"KBOI", BUF:"KBUF", BUR:"KBUR", BWI:"KBWI", CUN:"MMUN", CHS:"KCHS",
CMH:"KCMH", COS:"KCOS", CRP:"KCRP", CVG:"KCVG", DAL:"KDAL", DCA:"KDCA", DEN:"KDEN",
DTW:"KDTW", ECP:"KECP", ELP:"KELP", FAT:"KFAT", FLL:"KFLL", GCM:"MWCR", GEG:"KGEG",
GRR:"KGRR", GSP:"KGSP", HOU:"KHOU", HNL:"PHNL", IAD:"KIAD", MTJ:"KMTJ", BZN:"KBZN",
IND:"KIND", ISP:"KISP", JAN:"KJAN", JAX:"KJAX", KOA:"PHKO", LAS:"KLAS", HDN:"KHDN",
LAX:"KLAX", LGB:"KLGB", LIH:"PHLI", LIR:"MRLB", MAF:"KMAF", MBJ:"MKJP", MCO:"KMCO",
MDW:"KMDW", MEM:"KMEM", MHT:"KMHT", MIA:"KMIA", MSP:"KMSP", MSY:"KMSY", OAK:"KOAK",
OKC:"KOKC", OMA:"KOMA", ONT:"KONT", ORF:"KORF", OGG:"PHOG", PDX:"KPDX", PHL:"KPHL",
PHX:"KPHX", PIT:"KPIT", PNS:"KPNS", PVR:"MMPR", RDU:"KRDU", RNO:"KRNO", RSW:"KRSW",
SAN:"KSAN", SAT:"KSAT", SBA:"KSBA", SEA:"KSEA", SFO:"KSFO", SJC:"KSJC", SMF:"KSMF",
SNA:"KSNA", TPA:"KTPA", TUL:"KTUL", TUS:"KTUS", VPS:"KVPS", AUA:"TNCA", SLC:"KSLC",
NAS:"MYNN", BZE:"MZBZ", SJD:"MMSD", PUJ:"MDPC", SJO:"MROC", SJU:"TJSJ", STT:"TIST",
EUG:"KEUG", PSP:"KPSP", TUS:"KTUS", AMA:"KAMA", LBB:"KLBB", ICT:"KICT", MCI:"KMCI",
STL:"KSTL", DSM:"KDSM", ORD:"KORD", MKE:"KMKE", CLE:"KCLE", ROC:"KROC", PWM:"KPWM",
PVD:"KPVD", LGA:"KLGA", RIC:"KRIC", CLT:"KCLT", SAV:"KSAV", MYR:"KMYR", SRQ:"KSRQ",
PBI:"KPBI", HAV:"MUHA", PLS:"MBPV", ITO:"PHTO", ANC:"PANC", LIT:"KLIT", SDF:"KSDF",
TYS:"KTYS",
};

// Custom alerts per airport
const ALERTS = {
    BUR: [
        { type:"ceiling", op:"<", value:2000, message:"⚠ BUR ceiling below 2000ft" },
        { type:"wind_gust", op:">", value:40, message:"⚠ BUR gust over 40kt" },
        { type:"crosswind", op:">", value:25, message:"⚠ BUR crosswind over 25kt" },
        { type:"llws", op:">", value:0, message:"⚠ BUR LLWS detected" },
        { type:"icing", op:">", value:0, message:"⚠ BUR freezing precipitation" },
        { type:"ts", op:">", value:0, message:"⚠ BUR thunderstorm nearby" }
    ]
};

// Alert colors
const ALERT_COLORS = {
    ifr: "#ff4d4d",
    mvfr: "#ffa500",
    custom: "#00ffff",
    crosswind: "#00ff00",
    llws: "#ff00ff",
    icing: "#1e90ff",
    ts: "#ffff00"
};

// ---------------- TOOLTIP ----------------
const host = document.createElement("div");
host.style.all="initial";
host.style.position="fixed";
host.style.zIndex=9999999;
host.style.pointerEvents="none";
document.body.appendChild(host);

const shadow = host.attachShadow({mode:"open"});
const tip = document.createElement("div");
shadow.appendChild(tip);
Object.assign(tip.style,{
    position:"absolute",
    background:"#000",
    color:"#fff",
    padding:"8px",
    borderRadius:"6px",
    fontFamily:"monospace",
    fontSize:"12px",
    minWidth:"400px",
    boxShadow:"0 0 12px rgba(0,0,0,.8)",
    whiteSpace:"pre-wrap",
    display:"none"
});

var tipHideTimer = null;

function showTip(x, y, html){
    if (tipHideTimer) {
        clearTimeout(tipHideTimer);
        tipHideTimer = null;
    }
    tip.innerHTML = html;
    var ox = x + numPref('metarTooltipOffsetX', 12, -500, 500);
    var oy = y + numPref('metarTooltipOffsetY', 12, -500, 500);
    host.style.left = ox + "px";
    host.style.top = oy + "px";
    tip.style.display = "block";
    tip.offsetHeight; // force repaint
    var dms = numPref('metarTooltipDisplayMs', 0, 0, 300000);
    if (dms > 0) {
        tipHideTimer = setTimeout(function() {
            tip.style.display = "none";
            tipHideTimer = null;
        }, dms);
    }
}

// hide on click outside
function onPointerDownHide(e){
    if(!tip.contains(e.target) && tip.style.display==="block"){
        if (tipHideTimer) {
            clearTimeout(tipHideTimer);
            tipHideTimer = null;
        }
        tip.style.display="none";
    }
}
window.addEventListener("pointerdown", onPointerDownHide);

// ---------------- WEATHER FETCH ----------------
function fetchWeather(iata, cb){
    const icao = IATA_TO_ICAO[iata.toUpperCase()];
    if(!icao){ cb({metar:"No ICAO mapping", taf:""}); return; }

    const now = Date.now();
    const cacheMs = getCacheMs();
    if(cache[icao] && now-cache[icao].t<cacheMs){
        cb(cache[icao]); return;
    }

    var shared = readSharedMetarTafStore()[icao];
    if (shared && shared.metar !== undefined && shared.taf !== undefined && now - (shared.t || 0) < SHARED_METAR_TAF_TTL_MS) {
        mergeSharedIntoTooltipCache(icao, shared.metar, shared.taf, shared.t);
        if (cache[icao] && now - cache[icao].t < cacheMs) {
            cb(cache[icao]);
            return;
        }
    }

    const metarURL = `https://tgftp.nws.noaa.gov/data/observations/metar/stations/${icao}.TXT`;
    const tafURL = `https://tgftp.nws.noaa.gov/data/forecasts/taf/stations/${icao}.TXT`;

    GM_xmlhttpRequest({method:"GET", url:metarURL, onload:r=>{
        let metar="N/A";
        try{ metar=r.responseText.split("\n").slice(1).join(" ").trim()||"N/A"; }catch(e){}
        GM_xmlhttpRequest({method:"GET", url:tafURL, onload:r2=>{
            let taf="N/A";
            try{ taf=r2.responseText.split("\n").slice(1).join("\n").trim()||"N/A"; }catch(e){}
            const metarHTML=selectiveHighlightMETAR(metar,iata);
            const tafHTML=selectiveHighlightTAF(taf,iata);
            const html=`<b>${iata} (${icao})</b>\n${metarHTML}\n\n${tafHTML}`;
            logDebug("Tooltip HTML generated for", iata, ":\n", html);
            const result={metar, taf, html, t:Date.now()};
            cache[icao]=result;
            publishMetarTafShared(icao, metar, taf);
            cb(result);
        }});
    }});
}

///////////////////// vis fraction parse fix/////////////////

function parseVisibility(token){

    // Strip trailing SM
    if(!token.endsWith("SM")) return null;
    token = token.replace("SM","");

    // Less than indicator
    if(token.startsWith("M")){
        token = token.substring(1);
        const frac = parseFraction(token);
        return frac !== null ? frac - 0.01 : 0; // treat as slightly lower
    }

    // Greater than indicator
    if(token.startsWith("P")){
        token = token.substring(1);
        const val = parseFloat(token);
        return isNaN(val) ? null : val + 0.01;
    }

    // Mixed number "1 1/2"
    if(token.includes(" ")){
        const parts = token.split(" ");
        const whole = parseFloat(parts[0]);
        const frac = parseFraction(parts[1]);
        if(!isNaN(whole) && frac !== null){
            return whole + frac;
        }
    }

    // Fraction only "3/4"
    const fracOnly = parseFraction(token);
    if(fracOnly !== null) return fracOnly;

    // Plain integer
    const val = parseFloat(token);
    return isNaN(val) ? null : val;
}


function parseFraction(str){
    if(!str.includes("/")) return null;
    const [num,den] = str.split("/");
    const n = parseFloat(num);
    const d = parseFloat(den);
    if(!isNaN(n) && !isNaN(d) && d !== 0){
        return n/d;
    }
    return null;
}

// ---------------- TOKEN CLASSIFICATION ----------------
function classifyToken(word,iata,fullLine=""){
    let m;

    // Ceiling
    m=word.match(/^(BKN|OVC)(\d{3})$/);
    if(m){
        const ceil=parseInt(m[2],10)*100;
        if(ceil<1000) return allowHighlight("ifr");
        if(ceil<=3000) return allowHighlight("mvfr");
        if(triggerAlert("ceiling",ceil,iata)) return allowHighlight("custom");
        return null;
    }

   // -------- Visibility (FULL fractional support) --------
let vis = parseVisibility(word);
if(vis !== null){
    if(vis < 3) return allowHighlight("ifr");
    if(vis <= 5) return allowHighlight("mvfr");
    if(triggerAlert("visibility", vis, iata)) return allowHighlight("custom");
    return null;
}


    // Wind gust
    m=word.match(/G(\d{2,3})KT/);
    if(m && triggerAlert("wind_gust",parseInt(m[1],10),iata)) return allowHighlight("custom");

    // Crosswind (approximate)
    if(fullLine.match(/^\d{3}\d{2,3}G?\d{0,2}KT/)){
        if(triggerAlert("crosswind",0,iata)) return allowHighlight("crosswind");
    }

    // LLWS detection
    if(fullLine.includes("WS") || fullLine.includes("LLWS")) return allowHighlight("llws");

    // Icing
    if(word.match(/FZRA|FZDZ|SN|PL/)) return allowHighlight("icing");

    // Thunderstorm
    if(word.match(/TS|TSRA|VCTS/)) return allowHighlight("ts");

    return null;
}

function triggerAlert(type,val,iata){
    if (!boolPref('metarUseCustomAirportAlerts', true)) {
        return false;
    }
    const rules=ALERTS[iata.toUpperCase()];
    if(!rules) return false;
    for(const r of rules){
        if(r.type!==type) continue;
        if(r.op===">" && val>r.value) return true;
        if(r.op=="<" && val<r.value) return true;
    }
    return false;
}

// ---------------- SELECTIVE HIGHLIGHT ----------------
function selectiveHighlightMETAR(metar,iata){
    return `<b>METAR</b>\n${metar.split(" ").map(w=>{
        const cls=classifyToken(w,iata,metar);
        if(cls) return `<span style="color:${ALERT_COLORS[cls]||'#ff4d4d'}">${w}</span>`;
        return w;
    }).join(" ")}`;
}

function selectiveHighlightTAF(taf,iata){
    return `<b>TAF</b>\n${taf.split("\n").map(line=>{
        return line.split(" ").map(w=>{
            const cls=classifyToken(w,iata,line);
            if(cls) return `<span style="color:${ALERT_COLORS[cls]||'#ff4d4d'}">${w}</span>`;
            return w;
        }).join(" ");
    }).join("\n")}`;
}

function mergeSharedIntoTooltipCache(icao, metar, taf, ts) {
    if (!icao) {
        return;
    }
    var tUse = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now();
    var prev = cache[icao];
    if (prev && prev.t && prev.t > tUse + 500) {
        return;
    }
    var iata = '';
    var k;
    for (k in IATA_TO_ICAO) {
        if (Object.prototype.hasOwnProperty.call(IATA_TO_ICAO, k) && IATA_TO_ICAO[k] === icao) {
            iata = k;
            break;
        }
    }
    var metarHTML = selectiveHighlightMETAR(metar, iata);
    var tafHTML = selectiveHighlightTAF(taf, iata);
    var html = '<b>' + iata + ' (' + icao + ')</b>\n' + metarHTML + '\n\n' + tafHTML;
    cache[icao] = { metar: metar, taf: taf, html: html, t: tUse };
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
                mergeSharedIntoTooltipCache(d.icao, d.metar, d.taf, d.t);
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
                    mergeSharedIntoTooltipCache(ic, ent.metar, ent.taf, ent.t);
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

// ---------------- CLICK DETECTION ----------------
function detectAirport(x,y){
    const stack=document.elementsFromPoint(x,y);
    for(const el of stack){
        const txt=el.textContent?.trim();
        if(!txt) continue;
        if(el.className.includes("tg9Iiv9oAOo= zbA1EvKL1Bo=") || el.className.includes("tg9Iiv9oAOo= Ziu3-r4LY1M=")){
            if(/^[A-Z]{3}$/.test(txt)){
                logDebug("Detected airport code:", txt);
                return txt;
            }
        }
    }
    return null;
}

// ---------------- LISTENER ----------------
let tooltipLock = false;

function onPointerUpShow(e){
    if (tooltipLock) return;
    tooltipLock = true;
    setTimeout(function(){ tooltipLock=false; }, 50); // ignore duplicate events for 50ms

    const code = detectAirport(e.clientX,e.clientY);
    if(!code) return;
    fetchWeather(code, function(data){
        showTip(e.clientX,e.clientY, data.html);
    });
}
window.addEventListener("pointerup", onPointerUpShow, true);

initMetarTafSharedSync();

window.__myScriptCleanup = function() {
    stopMetarTafSharedSync();
    if (tipHideTimer) {
        clearTimeout(tipHideTimer);
        tipHideTimer = null;
    }
    try {
        window.removeEventListener("pointerdown", onPointerDownHide);
    } catch (e) {}
    try {
        window.removeEventListener("pointerup", onPointerUpShow, true);
    } catch (e1) {}
    try {
        host.remove();
    } catch (e2) {}
    window.__myScriptCleanup = undefined;
};


})();
