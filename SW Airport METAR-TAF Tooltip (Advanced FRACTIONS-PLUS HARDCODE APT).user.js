// ==UserScript==
// @name         SW Airport METAR/TAF Tooltip (Advanced FRACTIONS-PLUS HARDCODE APT)
// @namespace    Wolf 2.0
// @version      7.1
// @description  METAR/TAF tooltip with per-token coloring, advanced alerts (crosswind, LLWS, icing, thunderstorm), React-friendly tooltip with logging
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      tgftp.nws.noaa.gov
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SW%20Airport%20METAR-TAF%20Tooltip%20(Advanced%20FRACTIONS-PLUS%20HARDCODE%20APT).user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SW%20Airport%20METAR-TAF%20Tooltip%20(Advanced%20FRACTIONS-PLUS%20HARDCODE%20APT).user.js
// ==/UserScript==

(function() {
"use strict";

// ---------------- CONFIG ----------------
const CACHE_MS = 5*60*1000;
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

function showTip(x, y, html){
    tip.innerHTML = html;
    host.style.left = x + "px";
    host.style.top = y + "px";
    tip.style.display = "block";
    tip.offsetHeight; // force repaint
}

// hide on click outside
window.addEventListener("pointerdown", e=>{
    if(!tip.contains(e.target) && tip.style.display==="block"){
        tip.style.display="none";
    }
});

// ---------------- WEATHER FETCH ----------------
function fetchWeather(iata, cb){
    const icao = IATA_TO_ICAO[iata.toUpperCase()];
    if(!icao){ cb({metar:"No ICAO mapping", taf:""}); return; }

    const now = Date.now();
    if(cache[icao] && now-cache[icao].t<CACHE_MS){
        cb(cache[icao]); return;
    }

    const metarURL = `https://tgftp.nws.noaa.gov/data/observations/metar/stations/${icao}.TXT`;
    const tafURL = `https://tgftp.nws.noaa.gov/data/forecasts/taf/stations/${icao}.TXT`;

    GM_xmlhttpRequest({method:"GET", url:metarURL, onload:r=>{
        let metar="N/A";
        try{ metar=r.responseText.split("\n").slice(1).join(" ").trim()||"N/A"; }catch{}
        GM_xmlhttpRequest({method:"GET", url:tafURL, onload:r2=>{
            let taf="N/A";
            try{ taf=r2.responseText.split("\n").slice(1).join("\n").trim()||"N/A"; }catch{}
            const metarHTML=selectiveHighlightMETAR(metar,iata);
            const tafHTML=selectiveHighlightTAF(taf,iata);
            const html=`<b>${iata} (${icao})</b>\n${metarHTML}\n\n${tafHTML}`;
 console.log("Tooltip HTML generated for", iata, ":\n", html);
            const result={metar, taf, html, t:Date.now()};
            cache[icao]=result;
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
        const ceil=parseInt(m[2])*100;
        if(ceil<1000) return "ifr";
        if(ceil<=3000) return "mvfr";
        if(triggerAlert("ceiling",ceil,iata)) return "custom";
        return null;
    }

   // -------- Visibility (FULL fractional support) --------
let vis = parseVisibility(word);
if(vis !== null){
    if(vis < 3) return "ifr";
    if(vis <= 5) return "mvfr";
    if(triggerAlert("visibility", vis, iata)) return "custom";
    return null;
}


    // Wind gust
    m=word.match(/G(\d{2,3})KT/);
    if(m && triggerAlert("wind_gust",parseInt(m[1]),iata)) return "custom";

    // Crosswind (approximate)
    if(fullLine.match(/^\d{3}\d{2,3}G?\d{0,2}KT/)){
        if(triggerAlert("crosswind",0,iata)) return "crosswind";
    }

    // LLWS detection
    if(fullLine.includes("WS") || fullLine.includes("LLWS")) return "llws";

    // Icing
    if(word.match(/FZRA|FZDZ|SN|PL/)) return "icing";

    // Thunderstorm
    if(word.match(/TS|TSRA|VCTS/)) return "ts";

    return null;
}

function triggerAlert(type,val,iata){
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

// ---------------- CLICK DETECTION ----------------
function detectAirport(x,y){
    const stack=document.elementsFromPoint(x,y);
    for(const el of stack){
        const txt=el.textContent?.trim();
////////////////////////////////////////////////////        console.log("Clicked element:", el.tagName, el.className, "Text:", txt);
        if(!txt) continue;
        if(el.className.includes("tg9Iiv9oAOo= zbA1EvKL1Bo=") || el.className.includes("tg9Iiv9oAOo= Ziu3-r4LY1M=")){
            if(/^[A-Z]{3}$/.test(txt)){
 console.log("Detected airport code:", txt);
                return txt;
            }
        }
    }
    return null;
}

// ---------------- LISTENER ----------------
let tooltipLock = false;

window.addEventListener("pointerup", e=>{
    if (tooltipLock) return;
    tooltipLock = true;
    setTimeout(()=>{ tooltipLock=false }, 50); // ignore duplicate events for 50ms

    const code = detectAirport(e.clientX,e.clientY);
    if(!code) return;
    fetchWeather(code, data=>{
        showTip(e.clientX,e.clientY, data.html);
    });
}, true);


})();
