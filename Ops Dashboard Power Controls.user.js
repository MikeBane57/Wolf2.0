// ==UserScript==
// @name         Ops Dashboard Power Controls
// @namespace    Wolf 2.0
// @version      4.3
// @description  Toggle + resize panels (width & height) + minimize toolbar; defaults from DonkeyCODE prefs
// @match        https://opssuitemain.swacorp.com/operational-dashboard*
// @grant        none
// @donkeycode-pref {"opsDashPerfW":{"type":"number","group":"Ops dashboard — Performance","label":"Width %","description":"Default panel width (10–100). Slider changes are saved in this browser (localStorage).","default":50,"min":10,"max":100,"step":1},"opsDashPerfH":{"type":"number","group":"Ops dashboard — Performance","label":"Height px","default":300,"min":100,"max":900,"step":10},"opsDashPerfHidden":{"type":"boolean","group":"Ops dashboard — Performance","label":"Start hidden","description":"If true, panel is removed until you show it from the toolbar.","default":false},"opsDashTaxiW":{"type":"number","group":"Ops dashboard — Taxi / CNLDs","label":"Width %","default":50,"min":10,"max":100,"step":1},"opsDashTaxiH":{"type":"number","group":"Ops dashboard — Taxi / CNLDs","label":"Height px","default":300,"min":100,"max":900,"step":10},"opsDashTaxiHidden":{"type":"boolean","group":"Ops dashboard — Taxi / CNLDs","label":"Start hidden","default":false},"opsDashOtsW":{"type":"number","group":"Ops dashboard — OTS / Diversions","label":"Width %","default":50,"min":10,"max":100,"step":1},"opsDashOtsH":{"type":"number","group":"Ops dashboard — OTS / Diversions","label":"Height px","default":300,"min":100,"max":900,"step":10},"opsDashOtsHidden":{"type":"boolean","group":"Ops dashboard — OTS / Diversions","label":"Start hidden","default":false},"opsDashOtpW":{"type":"number","group":"Ops dashboard — OTP Graph","label":"Width %","default":50,"min":10,"max":100,"step":1},"opsDashOtpH":{"type":"number","group":"Ops dashboard — OTP Graph","label":"Height px","default":300,"min":100,"max":900,"step":10},"opsDashOtpHidden":{"type":"boolean","group":"Ops dashboard — OTP Graph","label":"Start hidden","default":false},"opsDashToolbarBottomPx":{"type":"number","group":"Ops dashboard — Toolbar","label":"Toolbar distance from bottom (px)","default":20,"min":0,"max":400,"step":5},"opsDashToolbarRightPx":{"type":"number","group":"Ops dashboard — Toolbar","label":"Toolbar distance from right (px)","default":20,"min":0,"max":400,"step":5},"opsDashToolbarWidthPx":{"type":"number","group":"Ops dashboard — Toolbar","label":"Toolbar width (px)","default":240,"min":180,"max":400,"step":10}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Ops%20Dashboard%20Power%20Controls.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Ops%20Dashboard%20Power%20Controls.user.js
// ==/UserScript==

(function() {
'use strict';

const groups = [
    { name:"Performance", key:"perf", selector:'[class="middle aligned row gfQ0nkPrXCU= css-bwiy4s"]'},
    { name:"Taxi In/Out + CNLDs", key:"taxi", selector:'[class="middle aligned row CTih2OEuFZ4= css-bwiy4s"]'},
    { name:"OTS / Diversions", key:"ots", selector:'[class="middle aligned row LECc4mtnuqI= css-bwiy4s"]'},
    { name:"OTP Graph", key:"otp", selector:'[class="seven wide column css-fr4wtc"]'}
];

const PREF_KEYS = {
    perf: { w: 'opsDashPerfW', h: 'opsDashPerfH', hidden: 'opsDashPerfHidden' },
    taxi: { w: 'opsDashTaxiW', h: 'opsDashTaxiH', hidden: 'opsDashTaxiHidden' },
    ots: { w: 'opsDashOtsW', h: 'opsDashOtsH', hidden: 'opsDashOtsHidden' },
    otp: { w: 'opsDashOtpW', h: 'opsDashOtpH', hidden: 'opsDashOtpHidden' }
};

const STORAGE_KEY = "opsPanelSettings";
const pendingTimers = [];
const removedRecords = [];

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

function defaultsFromPrefs() {
    var out = {};
    var i;
    for (i = 0; i < groups.length; i++) {
        var g = groups[i];
        var pk = PREF_KEYS[g.key];
        out[g.name] = {
            w: numPref(pk.w, 50, 10, 100),
            h: numPref(pk.h, 300, 100, 900),
            hidden: boolPref(pk.hidden, false)
        };
    }
    return out;
}

var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
(function mergeDefaults() {
    var d = defaultsFromPrefs();
    var k;
    for (k in d) {
        if (!Object.prototype.hasOwnProperty.call(d, k)) {
            continue;
        }
        if (!saved[k]) {
            saved[k] = d[k];
        } else {
            if (saved[k].w === undefined) {
                saved[k].w = d[k].w;
            }
            if (saved[k].h === undefined) {
                saved[k].h = d[k].h;
            }
            if (saved[k].hidden === undefined) {
                saved[k].hidden = d[k].hidden;
            }
        }
    }
})();

function unlockRowLayout(el){

    let row = el.parentNode;

    if(!row) return;

    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.alignItems = "stretch";
    row.style.justifyContent = "flex-start";
    row.style.width = "100%";
    row.style.maxWidth = "100%";
}


function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }


// ---------- Toolbar ----------
const toolbar = document.createElement('div');
toolbar.id = 'ops-dashboard-power-controls-toolbar';
var tbBottom = numPref('opsDashToolbarBottomPx', 20, 0, 400);
var tbRight = numPref('opsDashToolbarRightPx', 20, 0, 400);
var tbWidth = numPref('opsDashToolbarWidthPx', 240, 180, 400);
Object.assign(toolbar.style,{
    position:'fixed',
    bottom: tbBottom + 'px',
    right: tbRight + 'px',
    background:'rgba(0,0,0,0.9)',
    borderRadius:'10px',
    zIndex:'99999',
    color:'white',
    fontFamily:'sans-serif',
    fontSize:'13px',
    width: tbWidth + 'px',
    boxShadow:'0 0 10px #000'
});

const header = document.createElement('div');
header.style.padding="6px";
header.style.cursor="pointer";
header.style.background="#111";
header.style.borderRadius="10px 10px 0 0";
header.innerHTML="⚙ Ops Panels";

const body = document.createElement('div');
body.style.padding="10px";

let minimized=false;
header.onclick=()=>{
    minimized=!minimized;
    body.style.display = minimized ? "none" : "block";
};

toolbar.appendChild(header);
toolbar.appendChild(body);
document.body.appendChild(toolbar);


// ---------- Helpers ----------
function getFlexItem(el){
    while(el && el.parentNode){
        if(getComputedStyle(el.parentNode).display.includes("flex"))
            return el;
        el=el.parentNode;
    }
    return el;
}


// ---------- Controls ----------
function addControls(group){

    const container=document.createElement('div');
    container.style.marginBottom="12px";

    const btn=document.createElement('button');
    btn.textContent=group.name;
    btn.style.width='100%';
    btn.style.background='#222';
    btn.style.color='white';
    btn.style.cursor='pointer';

    const wSlider=document.createElement('input');
    wSlider.type="range";
    wSlider.min=10;
    wSlider.max=100;
    wSlider.value=saved[group.name]?.w || 50;
    wSlider.title="Width %";
    wSlider.style.width="100%";

    const hSlider=document.createElement('input');
    hSlider.type="range";
    hSlider.min=100;
    hSlider.max=900;
    hSlider.value=saved[group.name]?.h || 300;
    hSlider.title="Height px";
    hSlider.style.width="100%";

    let removed=[];

    // Toggle remove
    btn.onclick=()=>{
        const elements=document.querySelectorAll(group.selector);

        if(removed.length===0){
            elements.forEach(el=>{
                const flexItem=getFlexItem(el);
                removed.push({
                    el:flexItem,
                    parent:flexItem.parentNode,
                    next:flexItem.nextSibling
                });
                removedRecords.push(removed[removed.length - 1]);
                flexItem.remove();
            });
            btn.style.background="#800";
            saved[group.name] = saved[group.name] || {};
            saved[group.name].hidden = true;
            save();
        }else{
            removed.forEach(({el,parent,next})=>{
                parent.insertBefore(el,next);
            });
            removed=[];
            btn.style.background="#222";
            saved[group.name] = saved[group.name] || {};
            saved[group.name].hidden = false;
            save();
            applySize();
        }
    };


function applySize(){

    const w=wSlider.value;
    const h=hSlider.value;

    saved[group.name]=saved[group.name]||{};
    saved[group.name].w=w;
    saved[group.name].h=h;
    save();

    document.querySelectorAll(group.selector).forEach(el=>{
        const flexItem=getFlexItem(el);

        unlockRowLayout(flexItem);   // ⭐ KEY LINE

        flexItem.style.flexBasis=w+"%";
        flexItem.style.maxWidth=w+"%";
        flexItem.style.flexGrow="1";
        flexItem.style.flexShrink="1";

        flexItem.style.height=h+"px";
    });
}

    wSlider.oninput=applySize;
    hSlider.oninput=applySize;

    // Apply saved on load
    const applySavedTimer = setTimeout(function() {
        if (saved[group.name] && saved[group.name].hidden) {
            btn.click();
        } else {
            applySize();
        }
    }, 1200);
    pendingTimers.push(applySavedTimer);

    container.appendChild(btn);
    container.appendChild(wSlider);
    container.appendChild(hSlider);
    body.appendChild(container);
}

groups.forEach(addControls);

const TARGET = ".middle.aligned.row._2co3koQ6lLI\\=.css-bwiy4s";

function nukeRow() {
    document.querySelectorAll(TARGET).forEach(el => {
        el.dataset.opsDashNukeTouched = '1';
        el.classList.remove(
            "middle",
            "aligned",
            "row",
            "_2co3koQ6lLI=",
            "css-bwiy4s"
        );

        el.style.display="flex";
        el.style.flexWrap="wrap";
        el.style.width="100%";

        console.log("Row unlocked");
    });
}

nukeRow();
const nukeObserver = new MutationObserver(nukeRow);
nukeObserver.observe(document.body,{childList:true,subtree:true});

window.__myScriptCleanup = function() {
    while (pendingTimers.length) {
        try { clearTimeout(pendingTimers.pop()); } catch (e) {}
    }
    nukeObserver.disconnect();
    const tb = document.getElementById('ops-dashboard-power-controls-toolbar');
    if (tb) tb.remove();

    while (removedRecords.length) {
        const rec = removedRecords.pop();
        if (!rec || !rec.el || rec.el.parentNode || !rec.parent) continue;
        try { rec.parent.insertBefore(rec.el, rec.next || null); } catch (e) {}
    }

    document.querySelectorAll('[data-ops-dash-nuke-touched]').forEach(function(el) {
        el.classList.add("middle", "aligned", "row", "_2co3koQ6lLI=", "css-bwiy4s");
        el.style.display = "";
        el.style.flexWrap = "";
        el.style.width = "";
        delete el.dataset.opsDashNukeTouched;
    });

    groups.forEach(function(group) {
        document.querySelectorAll(group.selector).forEach(function(el) {
            const flexItem = getFlexItem(el);
            if (!flexItem) return;
            flexItem.style.flexBasis = "";
            flexItem.style.maxWidth = "";
            flexItem.style.flexGrow = "";
            flexItem.style.flexShrink = "";
            flexItem.style.height = "";
        });
    });
    try {
        window.__myScriptCleanup = undefined;
    } catch (e) {}
};

})();
