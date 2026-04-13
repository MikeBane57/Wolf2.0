// ==UserScript==
// @name         Ops Dashboard Power Controls
// @namespace    Wolf 2.0
// @version      4.1
// @description  Toggle + resize panels (width & height) + minimize toolbar
// @match        https://opssuitemain.swacorp.com/operational-dashboard*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Ops%20Dashboard%20Power%20Controls.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Ops%20Dashboard%20Power%20Controls.user.js
// ==/UserScript==

(function() {
'use strict';

const groups = [
    { name:"Performance", selector:'[class="middle aligned row gfQ0nkPrXCU= css-bwiy4s"]'},
    { name:"Taxi In/Out + CNLDs", selector:'[class="middle aligned row CTih2OEuFZ4= css-bwiy4s"]'},
    { name:"OTS / Diversions", selector:'[class="middle aligned row LECc4mtnuqI= css-bwiy4s"]'},
    { name:"OTP Graph", selector:'[class="seven wide column css-fr4wtc"]'}
];

const STORAGE_KEY = "opsPanelSettings";
const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

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
Object.assign(toolbar.style,{
    position:'fixed',
    bottom:'20px',
    right:'20px',
    background:'rgba(0,0,0,0.9)',
    borderRadius:'10px',
    zIndex:'99999',
    color:'white',
    fontFamily:'sans-serif',
    fontSize:'13px',
    width:'240px',
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
                flexItem.remove();
            });
            btn.style.background="#800";
        }else{
            removed.forEach(({el,parent,next})=>{
                parent.insertBefore(el,next);
            });
            removed=[];
            btn.style.background="#222";
            applySize();
        }
    };


function applySize(){

    const w=wSlider.value;
    const h=hSlider.value;

    saved[group.name]={w,h};
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
    setTimeout(applySize,1200);

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
    nukeObserver.disconnect();
    const tb = document.getElementById('ops-dashboard-power-controls-toolbar');
    if (tb) tb.remove();

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
};

})();
