// ==UserScript==
// @name         (Beta do not use)Flight Tooltip Dynamic Parser
// @namespace    Wolf 2.0
// @version      1.2
// @description  Reformat tool tip pop up
// @match        https://opssuitemain.swacorp.com/widgets/worksheet
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        none
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Flight%20Tooltip%20Dynamic%20Parser.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Flight%20Tooltip%20Dynamic%20Parser.user.js
// ==/UserScript==



(function() {
    const touchedTooltips = new WeakMap();
    const touchedTooltipNodes = [];

    function extractInfo(text) {
        const info = {};

        // Gates
        const gateMatch = text.match(/Dep Gate\s*(\S+)\s*&\s*Arr Gate\s*(\S+)/i);
        if (gateMatch) { info.depGate = gateMatch[1]; info.arrGate = gateMatch[2]; }

        // Flight Number
        const flightMatch = text.match(/Flight\s*(\d+)/i);
        if (flightMatch) info.flightNumber = flightMatch[0];

        // Cities
        const citiesMatch = text.match(/\b([A-Z]{3})\b.*\b([A-Z]{3})\b/);
        if (citiesMatch) { info.origin = citiesMatch[1]; info.destination = citiesMatch[2]; }

        // Schedule + AC Type
        const schedLineMatch = text.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}).*(\w{2,5})?/);
        if (schedLineMatch) {
            info.schedFrom = schedLineMatch[1];
            info.schedTo = schedLineMatch[2];
            info.acType = schedLineMatch[3] || "";
        }

        // Booking
        const dhMatch = text.match(/DH:\s*([\d\s\w/]+)/i);
        if (dhMatch) info.dh = dhMatch[1].replace(/Pilots/i, "").replace(/\//, "| FA").trim();

        const bkdMatch = text.match(/BKD:\s*(\d+)/i);
        if (bkdMatch) info.bkd = bkdMatch[1];
        const lidMatch = text.match(/LID:\s*(\d+)/i);
        if (lidMatch) info.lid = lidMatch[1];

        // OUT/OFF/ON/IN
        const ofoiMatch = text.match(/OUT[\s\S]*?IN/i);
        if (ofoiMatch) info.ofoi = ofoiMatch[0];

        // Fuel
        const depFuelMatch = text.match(/Planned Departure Fuel:?\s*([\d,]+\s*\w+)/i);
        if (depFuelMatch) info.depFuel = depFuelMatch[1];
        const arrFuelMatch = text.match(/Planned Arrival Fuel:?\s*([\d,]+\s*\w+)/i);
        if (arrFuelMatch) info.arrFuel = arrFuelMatch[1];
        const altMatch = text.match(/Planned Alternates:?\s*(.*)/i);
        if (altMatch) info.alternates = altMatch[1];

        // Desk
        const deskMatch = text.match(/Desk:\s*(\d+)/i);
        if (deskMatch) info.desk = deskMatch[0];

        // Release
        const releaseMatch = text.match(/Flight Plan Released:?\s*(Yes|No)/i);
        if (releaseMatch) info.release = releaseMatch[1] === "Yes" ? "Released" : "Pending";

        return info;
    }

    function rebuildTooltip(tooltip) {
        if (!tooltip) return;
        if (!touchedTooltips.has(tooltip)) {
            touchedTooltips.set(tooltip, {
                html: tooltip.innerHTML,
                style: tooltip.getAttribute('style')
            });
            touchedTooltipNodes.push(tooltip);
        }

        // --- Warnings (unique) ---
        const warningNodes = Array.from(tooltip.querySelectorAll('div i.warning.sign.icon'))
                                  .map(icon => icon.parentElement.textContent.trim());
        const uniqueWarnings = [...new Set(warningNodes)];

        // Gather all other text
        let combinedText = "";
        Array.from(tooltip.querySelectorAll("div, span")).forEach(d => {
            if (!d.querySelector('i.warning.sign.icon')) combinedText += d.textContent + "\n";
        });
        const info = extractInfo(combinedText);

        tooltip.innerHTML = "";
        tooltip.style.display = "flex";
        tooltip.style.flexDirection = "column";
        tooltip.style.gap = "4px";
        tooltip.style.padding = "4px 6px";
        tooltip.style.border = "1px solid #ccc";
        tooltip.style.borderRadius = "4px";
        tooltip.style.color = "white";
        tooltip.style.maxWidth = "750px";   // ✅ max width 750px
        tooltip.style.backgroundColor = "#222";

        // --- Section 0: Warnings ---
        uniqueWarnings.forEach(warn => {
            const div = document.createElement("div");
            div.textContent = warn;
            div.style.color = "yellow";
            tooltip.appendChild(div);
        });

        // --- Section 1: Flight number + cities ---
        const sec1 = document.createElement("div");
        sec1.style.textAlign = "center";
        sec1.style.fontWeight = "600";
        sec1.textContent = `${info.flightNumber || ""} ${info.origin || ""}→${info.destination || ""}`;
        tooltip.appendChild(sec1);

        // --- Section 2: Gates ---
        const sec2 = document.createElement("div");
        sec2.style.display = "flex";
        sec2.style.justifyContent = "space-between";
        const depEl = document.createElement("span");
        depEl.textContent = `DEP ${info.depGate || ""}`;
        depEl.style.color = "#2e7d32";
        const arrEl = document.createElement("span");
        arrEl.textContent = `ARR ${info.arrGate || ""}`;
        arrEl.style.color = "#1565c0";
        sec2.appendChild(depEl);
        sec2.appendChild(arrEl);
        tooltip.appendChild(sec2);

        // --- Section 3: Schedule + AC Type ---
        const sec3 = document.createElement("div");
        sec3.style.textAlign = "center";
        sec3.textContent = `${info.schedFrom || ""} - ${info.schedTo || ""} ${info.acType || ""}`;
        tooltip.appendChild(sec3);

        // --- Section 4: Booking info ---
        const sec4 = document.createElement("div");
        sec4.style.textAlign = "center";
        sec4.textContent = `Deadheads: ${info.dh || ""}\nBKD: ${info.bkd || ""}\nLID: ${info.lid || ""}`;
        tooltip.appendChild(sec4);

        // --- Section 5: OUT/OFF/ON/IN ---
        if (info.ofoi) {
            const sec5 = document.createElement("div");
            sec5.style.textAlign = "center";
            sec5.textContent = info.ofoi;
            tooltip.appendChild(sec5);
        }

        // --- Section 6: Fuel info ---
        const sec6 = document.createElement("div");
        sec6.style.display = "flex";
        sec6.style.justifyContent = "space-between";
        const depFuelEl = document.createElement("span");
        depFuelEl.textContent = `Dep Fuel: ${info.depFuel || ""}`;
        depFuelEl.style.fontWeight = "600";
        const altEl = document.createElement("span");
        altEl.textContent = `Alt: ${info.alternates || ""}`;
        altEl.style.flex = "1";
        altEl.style.textAlign = "center";
        const arrFuelEl = document.createElement("span");
        arrFuelEl.textContent = `Arr Fuel: ${info.arrFuel || ""}`;
        arrFuelEl.style.fontWeight = "600";
        sec6.appendChild(depFuelEl);
        sec6.appendChild(altEl);
        sec6.appendChild(arrFuelEl);
        tooltip.appendChild(sec6);

        // --- Section 7: Desk ---
        const sec7 = document.createElement("div");
        sec7.style.textAlign = "center";
        sec7.textContent = `${info.desk || ""} | ${info.release || ""}`;
        tooltip.appendChild(sec7);

        // --- Section 8: Extra notes (new lines) ---
        const sec8 = document.createElement("div");
        sec8.style.whiteSpace = "pre-line";
        sec8.style.marginTop = "2px";
        const allText = combinedText.split("\n")
            .map(t => t.trim())
            .filter(t => t && !t.includes("Gate") && !t.includes("Flight") && !t.includes("DH:") && !t.includes("BKD") && !t.includes("LID") && !t.includes("Fuel") && !t.includes("Desk") && !t.includes("Released") && !t.includes("Alt") && !t.match(/\d{2}:\d{2}/) && !t.match(/OUT|OFF|ON|IN/));
        sec8.textContent = allText.join("\n");
        tooltip.appendChild(sec8);
    }

    // Observe dynamic tooltips
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    const tooltips = node.querySelectorAll('div[data-testid="flight-leg-tooltip"]');
                    tooltips.forEach(rebuildTooltip);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial run
    document.querySelectorAll('div[data-testid="flight-leg-tooltip"]').forEach(rebuildTooltip);

    window.__myScriptCleanup = function() {
        observer.disconnect();
        touchedTooltipNodes.forEach(function(tooltip) {
            if (!tooltip) {
                return;
            }
            const orig = touchedTooltips.get(tooltip);
            if (!orig) {
                return;
            }
            try {
                tooltip.innerHTML = orig.html;
                if (orig.style === null || orig.style === undefined) {
                    tooltip.removeAttribute('style');
                } else {
                    tooltip.setAttribute('style', orig.style);
                }
            } catch (e) {}
        });
        window.__myScriptCleanup = undefined;
    };
})();
