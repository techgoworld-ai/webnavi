/**
 * WebNavi Sovereign Platform Frontend Engine
 * Includes 4-second Geographic Country/Currency Popup (1 USD = 98 INR)
 */

const USD_TO_INR_RATE = 98;
let currentCurrency = "INR"; // 'INR' or 'USD'
let detectedCountry = "IN";

const COUNTRY_MAP = {
  IN: { name: "India", currency: "INR", symbol: "₹" },
  US: { name: "United States", currency: "USD", symbol: "$" },
  GB: { name: "United Kingdom", currency: "USD", symbol: "$" },
  CA: { name: "Canada", currency: "USD", symbol: "$" },
  AU: { name: "Australia", currency: "USD", symbol: "$" },
  AE: { name: "United Arab Emirates", currency: "USD", symbol: "$" },
  DE: { name: "Germany", currency: "USD", symbol: "$" },
  SG: { name: "Singapore", currency: "USD", symbol: "$" }
};

/**
 * High-definition SVG flags for all major regions
 */
function getCountryFlagSvg(countryCode) {
  const code = (countryCode || "").toUpperCase();
  if (code === "IN" || code === "INR") {
    return `<svg class="flag-icon" width="22" height="15" viewBox="0 0 640 480" style="border-radius:2px; vertical-align:middle; display:inline-block; flex-shrink:0;" aria-label="India Flag"><path fill="#FF9933" d="M0 0h640v160H0z"/><path fill="#FFFFFF" d="M0 160h640v160H0z"/><path fill="#128807" d="M0 320h640v160H0z"/><g transform="translate(320 240)"><circle r="40" fill="none" stroke="#000080" stroke-width="5"/><circle r="8" fill="#000080"/><g stroke="#000080" stroke-width="2"><line x1="0" y1="-40" x2="0" y2="40"/><line x1="-40" y1="0" x2="40" y2="0"/><line x1="-28.28" y1="-28.28" x2="28.28" y2="28.28"/><line x1="-28.28" y1="28.28" x2="28.28" y2="-28.28"/><line x1="-36.95" y1="-15.3" x2="36.95" y2="15.3"/><line x1="-36.95" y1="15.3" x2="36.95" y2="-15.3"/><line x1="-15.3" y1="-36.95" x2="15.3" y2="36.95"/><line x1="-15.3" y1="36.95" x2="15.3" y2="-36.95"/><line x1="-39.23" y1="-7.8" x2="39.23" y2="7.8"/><line x1="-39.23" y1="7.8" x2="39.23" y2="-7.8"/><line x1="-7.8" y1="-39.23" x2="7.8" y2="39.23"/><line x1="-7.8" y1="39.23" x2="7.8" y2="-39.23"/><line x1="-33.26" y1="-22.25" x2="33.26" y2="22.25"/><line x1="-33.26" y1="22.25" x2="33.26" y2="-22.25"/><line x1="-22.25" y1="-33.26" x2="22.25" y2="33.26"/><line x1="-22.25" y1="33.26" x2="22.25" y2="-33.26"/></g></g></svg>`;
  }
  if (code === "GB" || code === "UK") {
    return `<svg class="flag-icon" width="22" height="15" viewBox="0 0 640 480" style="border-radius:2px; vertical-align:middle; display:inline-block; flex-shrink:0;" aria-label="UK Flag"><path fill="#012169" d="M0 0h640v480H0z"/><path fill="#FFF" d="m75 0 245 180L565 0h75v60L435 240l205 180v60h-75L320 300 75 480H0v-60l205-180L0 60V0h75z"/><path fill="#C8102E" d="m420 280 220 165v35l-265-200h45zm10-80 210-155V0l-260 195 50 5zM0 445l220-165h45L0 480v-35zm0-410L215 195l50-5L0 0v35z"/><path fill="#FFF" d="M260 0h120v480H260zM0 180h640v120H0z"/><path fill="#C8102E" d="M280 0h80v480h-80zM0 200h640v80H0z"/></svg>`;
  }
  if (code === "CA") {
    return `<svg class="flag-icon" width="22" height="15" viewBox="0 0 640 480" style="border-radius:2px; vertical-align:middle; display:inline-block; flex-shrink:0;" aria-label="Canada Flag"><path fill="#f00" d="M0 0h640v480H0z"/><path fill="#fff" d="M160 0h320v480H160z"/><path fill="#f00" d="m320 70 17 52 38-16-10 40 43 5-23 35 30 18-37 18 10 39-36-8-5 45-27-24-27 24-5-45-36 8 10-39-37-18 30-18-23-35 43-5-10-40 38 16zM315 315h10v95h-10z"/></svg>`;
  }
  if (code === "AE") {
    return `<svg class="flag-icon" width="22" height="15" viewBox="0 0 640 480" style="border-radius:2px; vertical-align:middle; display:inline-block; flex-shrink:0;" aria-label="UAE Flag"><path fill="#00732f" d="M0 0h640v160H0z"/><path fill="#fff" d="M0 160h640v160H0z"/><path fill="#000" d="M0 320h640v160H0z"/><path fill="#f00" d="M0 0h160v480H0z"/></svg>`;
  }
  if (code === "AU") {
    return `<svg class="flag-icon" width="22" height="15" viewBox="0 0 640 480" style="border-radius:2px; vertical-align:middle; display:inline-block; flex-shrink:0;" aria-label="Australia Flag"><path fill="#00247d" d="M0 0h640v480H0z"/><g transform="scale(0.5)"><path fill="#012169" d="M0 0h640v480H0z"/><path fill="#FFF" d="m75 0 245 180L565 0h75v60L435 240l205 180v60h-75L320 300 75 480H0v-60l205-180L0 60V0h75z"/><path fill="#C8102E" d="m420 280 220 165v35l-265-200h45zm10-80 210-155V0l-260 195 50 5zM0 445l220-165h45L0 480v-35zm0-410L215 195l50-5L0 0v35z"/><path fill="#FFF" d="M260 0h120v480H260zM0 180h640v120H0z"/><path fill="#C8102E" d="M280 0h80v480h-80zM0 200h640v80H0z"/></g><g fill="#fff"><circle cx="480" cy="120" r="14"/><circle cx="550" cy="180" r="14"/><circle cx="480" cy="360" r="14"/><circle cx="420" cy="220" r="14"/><circle cx="500" cy="260" r="10"/><circle cx="160" cy="360" r="28"/></g></svg>`;
  }
  if (code === "DE") {
    return `<svg class="flag-icon" width="22" height="15" viewBox="0 0 640 480" style="border-radius:2px; vertical-align:middle; display:inline-block; flex-shrink:0;" aria-label="Germany Flag"><path fill="#000" d="M0 0h640v160H0z"/><path fill="#d00" d="M0 160h640v160H0z"/><path fill="#ffce00" d="M0 320h640v160H0z"/></svg>`;
  }
  // Default: US Flag for United States & Global
  return `<svg class="flag-icon" width="22" height="15" viewBox="0 0 640 480" style="border-radius:2px; vertical-align:middle; display:inline-block; flex-shrink:0;" aria-label="USA Flag"><g fill="#B22234"><path d="M0 0h640v480H0z"/><path stroke="#FFFFFF" stroke-width="36.92" d="M0 55.38h640M0 129.23h640M0 203.08h640M0 276.92h640M0 350.77h640M0 424.62h640"/></g><path fill="#3C3B6E" d="M0 0h260v258.46H0z"/><g fill="#FFFFFF"><circle cx="30" cy="24" r="6"/><circle cx="70" cy="24" r="6"/><circle cx="110" cy="24" r="6"/><circle cx="150" cy="24" r="6"/><circle cx="190" cy="24" r="6"/><circle cx="230" cy="24" r="6"/><circle cx="50" cy="50" r="6"/><circle cx="90" cy="50" r="6"/><circle cx="130" cy="50" r="6"/><circle cx="170" cy="50" r="6"/><circle cx="210" cy="50" r="6"/><circle cx="30" cy="76" r="6"/><circle cx="70" cy="76" r="6"/><circle cx="110" cy="76" r="6"/><circle cx="150" cy="76" r="6"/><circle cx="190" cy="76" r="6"/><circle cx="230" cy="76" r="6"/><circle cx="50" cy="102" r="6"/><circle cx="90" cy="102" r="6"/><circle cx="130" cy="102" r="6"/><circle cx="170" cy="102" r="6"/><circle cx="210" cy="102" r="6"/><circle cx="30" cy="128" r="6"/><circle cx="70" cy="128" r="6"/><circle cx="110" cy="128" r="6"/><circle cx="150" cy="128" r="6"/><circle cx="190" cy="128" r="6"/><circle cx="230" cy="128" r="6"/><circle cx="50" cy="154" r="6"/><circle cx="90" cy="154" r="6"/><circle cx="130" cy="154" r="6"/><circle cx="170" cy="154" r="6"/><circle cx="210" cy="154" r="6"/><circle cx="30" cy="180" r="6"/><circle cx="70" cy="180" r="6"/><circle cx="110" cy="180" r="6"/><circle cx="150" cy="180" r="6"/><circle cx="190" cy="180" r="6"/><circle cx="230" cy="180" r="6"/><circle cx="50" cy="206" r="6"/><circle cx="90" cy="206" r="6"/><circle cx="130" cy="206" r="6"/><circle cx="170" cy="206" r="6"/><circle cx="210" cy="206" r="6"/><circle cx="30" cy="232" r="6"/><circle cx="70" cy="232" r="6"/><circle cx="110" cy="232" r="6"/><circle cx="150" cy="232" r="6"/><circle cx="190" cy="232" r="6"/><circle cx="230" cy="232" r="6"/></g></svg>`;
}
window.getFlagSvg = getCountryFlagSvg;
window.getCountryFlagSvg = getCountryFlagSvg;

/**
 * Full-page loader shown after form submission, before redirect to client portal.
 */
function showSubmitLoader(ticketId) {
  let overlay = document.getElementById("submitRedirectOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "submitRedirectOverlay";
    overlay.style.cssText = [
      "position:fixed","inset:0","background:var(--bg-primary, #031A13)",
      "display:flex","flex-direction:column","align-items:center",
      "justify-content:center","z-index:99999","gap:1.25rem",
      "font-family:'Plus Jakarta Sans',sans-serif"
    ].join(";");
    overlay.innerHTML = `
      <div style="
        width:60px;height:60px;border-radius:50%;
        border:3px solid rgba(255,212,59,0.15);
        border-top-color:#FFD43B;
        animation:wn_spin 0.9s linear infinite;
      "></div>
      <div style="text-align:center;">
        <div style="font-size:1.05rem;font-weight:700;color:#fff;margin-bottom:0.4rem;">
          Application Submitted! 🎉
        </div>
        <div style="font-size:0.82rem;color:rgba(255,255,255,0.5);font-family:monospace;">
          Ticket <strong style="color:#FFD43B;">#${ticketId}</strong> · Opening your client portal…
        </div>
      </div>
      <style>
        @keyframes wn_spin { to { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(overlay);
  }
  overlay.style.display = "flex";
}

function hideSubmitLoader() {
  const overlay = document.getElementById("submitRedirectOverlay");
  if (overlay) overlay.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  initCurrencySystem();
  initDomainSearch();
  initCanvasStudio();
  initKeyboardShortcuts();
  initCodeExportModal();
  initMultiStepApplication();
  initSidebarWhatsappCta();
});

/**
 * Wire up the sidebar WhatsApp CTA button with a general enquiry message.
 */
function initSidebarWhatsappCta() {
  const btn = document.getElementById("sidebarWhatsappCta");
  if (!btn) return;
  const msg = encodeURIComponent(
    "Hi WebNavi Team! I'd like to know more about the Free Website offer and talk to someone from the team."
  );
  btn.href = `https://wa.me/919876543210?text=${msg}`;
}

/**
 * Detects visitor country based on timezone and system locale.
 * Accurately detects: India (IN), UK (GB), UAE (AE), Canada (CA),
 * Australia (AU), Germany (DE), Singapore (SG), USA (US), etc.
 */
function detectVisitorCountry() {
  try {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").toLowerCase();
    const offset = new Date().getTimezoneOffset(); // -330 for India (UTC+5:30)
    if (tz.includes("calcutta") || tz.includes("kolkata") || tz.includes("india") || offset === -330) {
      return "IN";
    }
    if (tz.includes("london") || tz.includes("belfast") || tz.includes("europe/london")) return "GB";
    if (tz.includes("dubai") || tz.includes("asia/dubai")) return "AE";
    if (tz.includes("toronto") || tz.includes("vancouver") || tz.includes("montreal") || tz.includes("calgary") || tz.includes("edmonton")) return "CA";
    if (tz.includes("sydney") || tz.includes("melbourne") || tz.includes("brisbane") || tz.includes("perth") || tz.includes("adelaide") || tz.includes("australia")) return "AU";
    if (tz.includes("berlin") || tz.includes("munich") || tz.includes("frankfurt") || tz.includes("europe/berlin")) return "DE";
    if (tz.includes("singapore") || tz.includes("asia/singapore")) return "SG";
    if (tz.includes("new_york") || tz.includes("chicago") || tz.includes("los_angeles") || tz.includes("denver") || tz.includes("america/")) return "US";
  } catch (e) {}

  try {
    const lang = (navigator.language || navigator.userLanguage || "").toLowerCase();
    if (lang.endsWith("-in") || lang.startsWith("hi") || lang.startsWith("ta") || lang.startsWith("te") || lang.startsWith("mr") || lang.startsWith("gu") || lang.startsWith("bn")) {
      return "IN";
    }
    if (lang.endsWith("-gb") || lang.endsWith("-uk")) return "GB";
    if (lang.endsWith("-ca")) return "CA";
    if (lang.endsWith("-au")) return "AU";
    if (lang.endsWith("-ae") || lang.startsWith("ar")) return "AE";
    if (lang.endsWith("-de") || lang.startsWith("de")) return "DE";
    if (lang.endsWith("-sg")) return "SG";
  } catch (e) {}

  return "IN";
}

function detectVisitorCurrency() {
  const c = detectVisitorCountry();
  return c === "IN" ? "INR" : "USD";
}

/**
 * Country & Currency Detection Engine
 * Auto-detects visitor country and displays their exact country flag badge.
 * Strictly maintains visitor's actual country (India for Indian visitors).
 */
function initCurrencySystem() {
  const navToggle = document.getElementById("navbarCurrencyToggle");

  // Determine initial country and currency
  const initialCountry = detectVisitorCountry();
  setCountryBadge(initialCountry);

  // Asynchronously query server geo endpoint to verify IP country
  const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const offset = new Date().getTimezoneOffset();
  fetch(`/api/domains/geo?tz=${tz}&offset=${offset}&country=${initialCountry}`)
    .then((r) => r.json())
    .then((data) => {
      if (data && data.success && data.country) {
        if (initialCountry === "IN" && data.country !== "IN") {
          return; // Browser hardware clock is in India (IST offset -330)
        }
        setCountryBadge(data.country);
      }
    })
    .catch(() => {});

  // Clicking the flag keeps the user's country intact without switching
  if (navToggle) {
    navToggle.addEventListener("click", (e) => {
      e.preventDefault();
    });
  }
}

/**
 * Set country badge and update prices
 */
function setCountryBadge(countryCode) {
  detectedCountry = (countryCode || "IN").toUpperCase();
  currentCurrency = detectedCountry === "IN" ? "INR" : "USD";
  window.currentCurrency = currentCurrency;
  window.detectedCountry = detectedCountry;

  const info = COUNTRY_MAP[detectedCountry] || { name: "Detected Region", currency: currentCurrency, symbol: currentCurrency === "INR" ? "₹" : "$" };

  // Update navbar flag badge
  const navFlag = document.getElementById("navFlag");
  const navToggle = document.getElementById("navbarCurrencyToggle");
  const navCode = document.getElementById("navCurrencyCode");

  if (navFlag) {
    navFlag.innerHTML = getCountryFlagSvg(detectedCountry);
  }
  if (navToggle) {
    navToggle.title = `Location: ${info.name}`;
    navToggle.setAttribute("aria-label", `Location: ${info.name}`);
  }
  if (navCode) {
    navCode.textContent = "";
    navCode.style.display = "none";
  }

  // Update all elements with data-usd and data-inr
  const priceElements = document.querySelectorAll("[data-usd][data-inr]");
  priceElements.forEach((el) => {
    const val = currentCurrency === "INR" ? el.getAttribute("data-inr") : el.getAttribute("data-usd");
    if (val !== null && val !== undefined) {
      el.innerHTML = val;
    }
  });

  try {
    window.dispatchEvent(new CustomEvent("webnavi:currencychange", { detail: { currency: currentCurrency, country: detectedCountry } }));
  } catch (e) {}
}

window.setCountryBadge = setCountryBadge;
window.setGlobalCurrency = function(curr) {
  if (curr === "INR") setCountryBadge("IN");
  else if (curr === "USD" && detectedCountry === "IN") setCountryBadge("US");
  else setCountryBadge(detectedCountry);
};
window.detectVisitorCurrency = detectVisitorCurrency;

/**
 * Domain Search Gateway with live backend /api/domains/check integration
 */
function initDomainSearch() {
  const input = document.getElementById("gatewayDomainInput");
  const clearBtn = document.getElementById("clearSearchBtn");
  const checkBtn = document.getElementById("gatewayCheckBtn");
  const resultsArea = document.getElementById("gatewayResultsArea");
  const tldPills = document.querySelectorAll(".tld-pill");

  if (!input || !checkBtn || !resultsArea) return;

  // Show/hide clear button
  input.addEventListener("input", () => {
    if (clearBtn) {
      clearBtn.style.display = input.value.trim() ? "block" : "none";
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      clearBtn.style.display = "none";
      input.focus();
    });
  }

  // TLD rate pills click
  tldPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const tld = pill.getAttribute("data-tld");
      let current = input.value.trim();
      if (!current) {
        current = "studiofolio";
      }
      const base = current.split(".")[0];
      const targetDomain = `${base}${tld}`;
      input.value = targetDomain;
      if (clearBtn) clearBtn.style.display = "block";
      performSearch(targetDomain);
    });
  });

  // Submit on button or Enter
  checkBtn.addEventListener("click", (e) => {
    e.preventDefault();
    performSearch(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performSearch(input.value);
    }
  });

  async function performSearch(rawInput) {
    // Clear previous results immediately before initiating a new search
    resultsArea.innerHTML = "";

    let query = (rawInput || "").trim().toLowerCase();
    if (!query) {
      query = "studiofolio.dev";
      input.value = query;
    }

    if (!query.includes(".")) {
      query = `${query}.com`;
      input.value = query;
    }

    // Validation
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,}$/i;
    if (!domainRegex.test(query)) {
      renderError(`"${escapeHtml(query)}" is not a valid domain. Enter a format like name.com or name.dev`);
      return;
    }

    setLoading(true, query);

    try {
      const response = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: query }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || data.success === false) {
        const errorMsg = (data && data.error) || (data && data.message) || `Error checking domain (${response.status})`;
        const errorCode = (data && data.code) || (response.status === 504 ? "GATEWAY_TIMEOUT" : (response.status === 401 ? "AUTH_ERROR" : null));
        renderError(errorMsg, errorCode);
        return;
      }

      renderSuccess(data);
    } catch (err) {
      renderError("Network error contacting domain registry gateway. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function setLoading(loading, domain) {
    if (loading) {
      checkBtn.disabled = true;
      checkBtn.innerHTML = `
        <span class="pulse-dot" style="width: 8px; height: 8px; display: inline-block;"></span>
        Querying Gateway...
      `;
      resultsArea.innerHTML = `
        <div class="result-box" style="justify-content: center; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.88rem;">
          <span class="pulse-dot" style="margin-right: 0.5rem;"></span>
          Querying ICANN registrar gateway for <strong>${escapeHtml(domain)}</strong>...
        </div>
      `;
    } else {
      checkBtn.disabled = false;
      checkBtn.innerHTML = `Check Availability`;
    }
  }

  function renderError(message, code) {
    let title = "Registry Gateway Notice";
    let isTimeout = code === "GATEWAY_TIMEOUT" || /timeout|aborted/i.test(message || "");
    if (isTimeout) {
      title = "Registry Query Timeout";
      if (!message || /aborted due to timeout/i.test(message)) {
        message = "The upstream ICANN registrar gateway took longer than usual to respond. The domain may still be available.";
      }
    } else if (code === "AUTH_ERROR") {
      title = "Registrar Authentication Error";
    }

    resultsArea.innerHTML = `
      <div class="result-box unavailable">
        <div class="result-left" style="align-items: flex-start;">
          <div class="result-status-icon cross" style="margin-top: 2px;">✕</div>
          <div>
            <div class="result-domain-title" style="color: var(--accent-red);">${escapeHtml(title)}</div>
            <div class="result-desc" style="color: var(--text-muted); margin-top: 4px;">${escapeHtml(message)}</div>
            ${isTimeout ? `
              <button type="button" onclick="document.getElementById('checkBtn')?.click()" style="margin-top: 10px; font-family: var(--font-mono); font-size: 0.78rem; padding: 5px 12px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
                <span>↺</span> Retry Availability Check
              </button>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function renderSuccess(data) {
    const isAvail = data.is_available === true;
    const isUnavail = data.is_available === false;
    const domainName = data.domain || input.value;
    
    // Price conversion based on 1 USD = 98 INR
    let displayPrice = "";
    let displayRenew = "";
    let displaySavings = "";

    if (data.price != null && !isNaN(data.price)) {
      const priceVal = Number(data.price);
      if (currentCurrency === "INR") {
        const inrAmount = data.currency === "INR" ? priceVal : Math.round(priceVal * USD_TO_INR_RATE);
        displayPrice = `₹ ${inrAmount.toLocaleString("en-IN")}/yr`;
      } else {
        const usdAmount = data.currency === "INR" ? (priceVal / USD_TO_INR_RATE).toFixed(2) : priceVal.toFixed(2);
        displayPrice = `$${usdAmount}/yr`;
      }
      displaySavings = currentCurrency === "INR" ? "Saves ~₹23,520/yr vs SaaS builders" : "Saves ~$240/yr vs SaaS builders";
    } else {
      displayPrice = "Registry Wholesale Fee";
    }

    if (data.renew_price != null && !isNaN(data.renew_price)) {
      const renewVal = Number(data.renew_price);
      if (currentCurrency === "INR") {
        const inrRenew = data.currency === "INR" ? renewVal : Math.round(renewVal * USD_TO_INR_RATE);
        displayRenew = `Renews at ₹ ${inrRenew.toLocaleString("en-IN")}/yr`;
      } else {
        const usdRenew = data.currency === "INR" ? (renewVal / USD_TO_INR_RATE).toFixed(2) : renewVal.toFixed(2);
        displayRenew = `Renews at $${usdRenew}/yr`;
      }
    }

    if (isAvail) {
      resultsArea.innerHTML = `
        <div class="result-box available">
          <div class="result-left">
            <div class="result-status-icon check">✓</div>
            <div>
              <div class="result-domain-title">
                ${escapeHtml(domainName)}
                <span class="tag-available">AVAILABLE AT COST</span>
              </div>
              <div class="result-desc">
                Includes WHOIS privacy + Visual Builder license (${currentCurrency === "INR" ? "₹0" : "$0"}) + Let's Encrypt SSL
              </div>
            </div>
          </div>

          <div class="result-right">
            <div class="price-display">
              <div class="price-main">${displayPrice}</div>
              ${displayRenew ? `<div style="font-size: 0.72rem; color: var(--text-dim); font-family: var(--font-mono); margin-top: 2px;">${displayRenew}</div>` : ""}
              ${displaySavings ? `<div class="price-savings">${displaySavings}</div>` : ""}
            </div>
            <button type="button" class="btn btn-yellow" id="selectDomainBtn" style="padding: 0.55rem 1.15rem; font-size: 0.85rem;">
              Select Domain
            </button>
          </div>
        </div>
      `;

      const selectBtn = document.getElementById("selectDomainBtn");
      if (selectBtn) {
        selectBtn.addEventListener("click", () => {
          openRegistrationModal(domainName, data);
        });
      }
    } else if (isUnavail) {
      const baseName = domainName.split(".")[0];
      resultsArea.innerHTML = `
        <div class="result-box unavailable">
          <div class="result-left">
            <div class="result-status-icon cross">✕</div>
            <div>
              <div class="result-domain-title">
                ${escapeHtml(domainName)}
                <span class="tag-taken">REGISTERED</span>
              </div>
              <div class="result-desc">
                ${escapeHtml(data.message || "This domain is already registered.")} Suggested alternative extensions to check:
              </div>
            </div>
          </div>

          <div class="result-right" style="gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" class="tld-pill quick-try" data-domain="${baseName}.in">${baseName}.in</button>
            <button type="button" class="tld-pill quick-try" data-domain="${baseName}.co.in">${baseName}.co.in</button>
            <button type="button" class="tld-pill quick-try" data-domain="${baseName}.org">${baseName}.org</button>
            <button type="button" class="tld-pill quick-try" data-domain="get${baseName}.com">get${baseName}.com</button>
          </div>
        </div>
      `;

      resultsArea.querySelectorAll(".quick-try").forEach((btn) => {
        btn.addEventListener("click", () => {
          const alt = btn.getAttribute("data-domain");
          input.value = alt;
          performSearch(alt);
        });
      });
    } else {
      // Tri-state fallback: Missing or unexpected values display UNKNOWN
      const baseName = domainName.split(".")[0];
      resultsArea.innerHTML = `
        <div class="result-box unknown">
          <div class="result-left">
            <div class="result-status-icon question">?</div>
            <div>
              <div class="result-domain-title">
                ${escapeHtml(domainName)}
                <span class="tag-unknown">STATUS UNKNOWN</span>
              </div>
              <div class="result-desc">
                ${escapeHtml(data.message || "Registry gateway status unknown for this extension. Try checking another extension or contact registry gateway.")}
              </div>
            </div>
          </div>

          <div class="result-right" style="gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" class="tld-pill quick-try" data-domain="${baseName}.com">${baseName}.com</button>
            <button type="button" class="tld-pill quick-try" data-domain="${baseName}.in">${baseName}.in</button>
          </div>
        </div>
      `;

      resultsArea.querySelectorAll(".quick-try").forEach((btn) => {
        btn.addEventListener("click", () => {
          const alt = btn.getAttribute("data-domain");
          input.value = alt;
          performSearch(alt);
        });
      });
    }
  }
}

/**
 * Interactive Visual Canvas Studio
 */
function initCanvasStudio() {
  const viewportDesktop = document.getElementById("viewportDesktop");
  const viewportMobile = document.getElementById("viewportMobile");
  const canvasContainer = document.getElementById("canvasCenterViewport");
  const domNodes = document.querySelectorAll(".dom-tree-node");
  const displayBtns = document.querySelectorAll(".display-switch-btn");
  const publishBtn = document.getElementById("publishLiveBtn");

  if (!viewportDesktop || !viewportMobile || !canvasContainer) return;

  viewportMobile.addEventListener("click", () => {
    viewportMobile.classList.add("active");
    viewportDesktop.classList.remove("active");
    canvasContainer.classList.add("mobile-mode");
  });

  viewportDesktop.addEventListener("click", () => {
    viewportDesktop.classList.add("active");
    viewportMobile.classList.remove("active");
    canvasContainer.classList.remove("mobile-mode");
  });

  domNodes.forEach((node) => {
    node.addEventListener("click", () => {
      domNodes.forEach((n) => n.classList.remove("active"));
      node.classList.add("active");
      const targetTag = node.getAttribute("data-target") || "div.hero";
      const inspectorTarget = document.getElementById("inspectorTargetTag");
      if (inspectorTarget) {
        inspectorTarget.textContent = targetTag;
      }
    });
  });

  displayBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      displayBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  if (publishBtn) {
    publishBtn.addEventListener("click", () => {
      showNotification("⚡ Published live! Container cached with LiteSpeed LSCache under 40ms TTFB.");
    });
  }
}

/**
 * Keyboard Shortcuts: ⌘ + K / Ctrl + K
 */
function initKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const input = document.getElementById("gatewayDomainInput");
      if (input) {
        input.focus();
        input.select();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  });
}

/**
 * Code Export Modal
 */
function initCodeExportModal() {
  const exportBtn = document.getElementById("exportCodeBtn");
  const modal = document.getElementById("exportCodeModal");
  const closeBtn = document.getElementById("closeModalBtn");
  const copyBtn = document.getElementById("copyCodeBtn");

  if (!exportBtn || !modal || !closeBtn) return;

  exportBtn.addEventListener("click", () => {
    modal.classList.add("open");
  });

  closeBtn.addEventListener("click", () => {
    modal.classList.remove("open");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("open");
    }
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const code = document.getElementById("exportCodeContent").textContent;
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = "Copied to Clipboard!";
        setTimeout(() => {
          copyBtn.textContent = "Copy HTML & Tailwind";
        }, 2000);
      });
    });
  }
}

/**
 * Toast Notification Helper
 */
function showNotification(msg) {
  let toast = document.getElementById("webnaviToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "webnaviToast";
    toast.style.cssText = `
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: #0E1813;
      border: 1px solid #00E599;
      color: #FFFFFF;
      padding: 0.9rem 1.4rem;
      border-radius: 8px;
      font-size: 0.88rem;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      animation: fadeIn 200ms ease;
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span style="color:#00E599; font-weight:800;">✓</span> ${escapeHtml(msg)}`;
  toast.style.display = "flex";
  clearTimeout(window.__toastTimeout);
  window.__toastTimeout = setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/**
 * Multi-Step Free Website Application Form (Images 1, 2, 3)
 */
function initMultiStepApplication() {
  const form = document.getElementById("freeWebsiteApplicationForm");
  if (!form) return;

  let currentStep = 1;
  const totalSteps = 4;

  const panel1 = document.getElementById("stepPanel1");
  const panel2 = document.getElementById("stepPanel2");
  const panel3 = document.getElementById("stepPanel3");
  const panel4 = document.getElementById("stepPanel4");
  const panelSuccess = document.getElementById("stepPanelSuccess");

  const tab1 = document.getElementById("stepTab1");
  const tab2 = document.getElementById("stepTab2");
  const tab3 = document.getElementById("stepTab3");
  const tab4 = document.getElementById("stepTab4");

  const progressBar = document.getElementById("formProgressBar");
  const progressLabel = document.getElementById("stepProgressLabel");

  // Step 1 Inputs
  const fullName = document.getElementById("fullNameInput");
  const email = document.getElementById("emailInput");
  const phone = document.getElementById("phoneInput");
  const dialCode = document.getElementById("countryDialCode");
  const city = document.getElementById("cityInput");
  const state = document.getElementById("stateInput");
  const accountPassword = document.getElementById("accountPasswordInput");
  const confirmPassword = document.getElementById("confirmPasswordInput");

  let isCustomerAuthenticated = false;

  const STAGE_NAMES_MAP = {
    1: 'Stage 1: Form Intake Audit',
    2: 'Stage 2: Developer Consultation & Demo',
    3: 'Stage 3: Milestone 1 & Domain Purchase',
    4: 'Stage 4: Site Architecture & Assembly',
    5: 'Stage 5: Cloud Hosting & SSL Setup',
    6: 'Stage 6: Live Launch & Final Handover'
  };

  function showAlreadyAppliedCard(app) {
    const card = document.getElementById("alreadyAppliedCard");
    const progressCard = document.getElementById("formProgressCard");
    if (!card) return;

    const ticketBadge = document.getElementById("appliedTicketBadge");
    const bName = document.getElementById("appliedBusinessName");
    const stageEl = document.getElementById("appliedStageName");
    const domainEl = document.getElementById("appliedDomainName");
    const redirectBtn = document.getElementById("btnRedirectToPortal");
    const toggleBtn = document.getElementById("btnToggleNewApplicationForm");

    if (ticketBadge) ticketBadge.textContent = app.ticketId ? `#${app.ticketId}` : '#WN-APPLICATION';
    if (bName) bName.textContent = app.businessName || 'Your Business';
    if (stageEl) {
      const stageNum = Number(app.currentStage || 1);
      stageEl.textContent = STAGE_NAMES_MAP[stageNum] || `Stage ${stageNum}: In Progress`;
    }
    if (domainEl) domainEl.textContent = app.preferredDomain || 'Pending Domain Selection';
    if (redirectBtn) {
      redirectBtn.href = app.portalUrl || `/application/${app.clientId}`;
    }

    card.style.display = "block";
    if (progressCard) progressCard.style.display = "none";
    if (form) form.style.display = "none";

    if (toggleBtn) {
      toggleBtn.onclick = () => {
        card.style.display = "none";
        if (progressCard) progressCard.style.display = "block";
        if (form) form.style.display = "block";
        goToStep(1);
      };
    }
  }

  // 1. Query logged-in customer's active application
  fetch("/api/applications/my-active")
    .then((r) => r.json())
    .then((data) => {
      if (data && data.success && data.applied) {
        showAlreadyAppliedCard(data);
        localStorage.setItem("webnavi_application", JSON.stringify(data));
        return;
      }

      // 2. Check localStorage if no session application
      const cached = localStorage.getItem("webnavi_application");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.clientId) {
            fetch(`/api/applications/${parsed.clientId}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((appData) => {
                if (appData && (appData.clientId || appData.ticketId)) {
                  const merged = { ...parsed, ...(appData.data || appData) };
                  showAlreadyAppliedCard(merged);
                }
              })
              .catch(() => {});
          }
        } catch (e) {}
      }
    })
    .catch(() => {});

  // Check customer session status on page load
  fetch("/api/customer/me")
    .then((r) => r.json())
    .then((d) => {
      if (d && d.success && d.customer) {
        isCustomerAuthenticated = true;
        const passRow = document.getElementById("websitePasswordInputsRow");
        const notice = document.getElementById("websiteLoggedInNotice");
        const noticeText = document.getElementById("websiteLoggedInText");
        if (passRow) passRow.style.display = "none";
        if (notice && noticeText) {
          notice.style.display = "block";
          noticeText.innerHTML = `✓ Signed in as <strong>${escapeHtml(d.customer.fullName || d.customer.email)}</strong> (${escapeHtml(d.customer.email)}). Application will be automatically linked to your account.`;
        }
        if (fullName && !fullName.value && d.customer.fullName) fullName.value = d.customer.fullName;
        if (email && !email.value && d.customer.email) email.value = d.customer.email;
        if (phone && !phone.value && d.customer.phone) phone.value = d.customer.phone.replace(/^\+\d+\s*/, '');
      }
    })
    .catch(() => {});

  // Step 2 Inputs
  const businessName = document.getElementById("businessNameInput");
  const industry = document.getElementById("industrySelect");
  const existingSite = document.getElementById("existingSiteInput");
  const instagram = document.getElementById("instagramInput");
  const youtube = document.getElementById("youtubeInput");
  const facebook = document.getElementById("facebookInput");

  // Step 3 Inputs
  const preferredDomain = document.getElementById("preferredDomainInput");
  const q1Yes = document.getElementById("q1YesBtn");
  const q2Yes = document.getElementById("q2YesBtn");
  const q3Yes = document.getElementById("q3YesBtn");

  // Prevent any "No" click interactions and explain requirement
  document.querySelectorAll(".btn-toggle-no").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      showNotification("This requirement is mandatory to qualify for 100% Free Website Design.");
    });
  });

  function goToStep(step) {
    currentStep = step;

    [panel1, panel2, panel3, panel4, panelSuccess].forEach((p) => {
      if (p) p.style.display = "none";
    });

    const pct = (step / totalSteps) * 100;
    if (progressBar) progressBar.style.width = `${pct}%`;

    const labels = [
      "Step 1 of 4: Your Details",
      "Step 2 of 4: Business Information",
      "Step 3 of 4: Eligibility & Agreement",
      "Step 4 of 4: Review & Send",
    ];
    if (progressLabel) progressLabel.textContent = labels[step - 1];

    const tabs = [tab1, tab2, tab3, tab4];
    tabs.forEach((tab, idx) => {
      if (!tab) return;
      tab.classList.remove("active", "completed");
      if (idx + 1 === step) {
        tab.classList.add("active");
      } else if (idx + 1 < step) {
        tab.classList.add("completed");
      }
    });

    if (step === 1 && panel1) panel1.style.display = "block";
    if (step === 2 && panel2) panel2.style.display = "block";
    if (step === 3 && panel3) panel3.style.display = "block";
    if (step === 4 && panel4) {
      panel4.style.display = "block";
      populateReview();
    }
  }

  function populateReview() {
    const summaryCard = document.getElementById("reviewSummaryCard");
    if (!summaryCard) return;

    // Collect social profiles
    const socials = [];
    if (instagram && instagram.value.trim()) socials.push(`IG: ${escapeHtml(instagram.value.trim())}`);
    if (youtube && youtube.value.trim()) socials.push(`YT: ${escapeHtml(youtube.value.trim())}`);
    if (facebook && facebook.value.trim()) socials.push(`FB: ${escapeHtml(facebook.value.trim())}`);
    const socialsText = socials.length > 0 ? socials.join(" • ") : "None provided";

    const domainDisplay = preferredDomain && preferredDomain.value.trim() 
      ? escapeHtml(preferredDomain.value.trim()) 
      : "To be chosen with engineer";

    summaryCard.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0.75rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">Applicant Contact</div>
          <strong style="color: var(--text-white);">${escapeHtml(fullName.value)}</strong>
          <div style="color: var(--accent-green); font-family: var(--font-mono); font-size: 0.85rem;">${escapeHtml(dialCode.value)} ${escapeHtml(phone.value)}</div>
          <div style="color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(city.value)}, ${escapeHtml(state.value)}</div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">Business &amp; Social</div>
          <strong style="color: var(--text-white);">${escapeHtml(businessName.value)}</strong>
          <div style="color: var(--accent-yellow); font-size: 0.82rem;">${escapeHtml(industry.value || "General")}</div>
          <div style="color: var(--text-muted); font-size: 0.8rem;">${socialsText}</div>
        </div>
      </div>
      <div style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem;">
        <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; margin-bottom: 0.35rem;">Confirmed Infrastructure Requirements</div>
        <div style="display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.82rem;">
          <div style="color: var(--accent-green);">✓ <strong>Pay ₹2,999 ($30) for Domain + Hostinger Cloud:</strong> Agreed (Yes)</div>
          <div style="color: var(--accent-green);">✓ <strong>Domain via WebNavi ICANN Gateway:</strong> Agreed (Yes)</div>
          <div style="color: var(--accent-green);">✓ <strong>Deploy on Hostinger LiteSpeed Cloud:</strong> Agreed (Yes)</div>
          <div style="color: var(--text-muted); margin-top: 0.2rem;"><strong>Desired Domain:</strong> ${domainDisplay}</div>
        </div>
      </div>
    `;
  }

  const btnNext1 = document.getElementById("btnNextStep1");
  const btnNext2 = document.getElementById("btnNextStep2");
  const btnNext3 = document.getElementById("btnNextStep3");

  const btnBack2 = document.getElementById("btnBackStep2");
  const btnBack3 = document.getElementById("btnBackStep3");
  const btnBack4 = document.getElementById("btnBackStep4");

  if (btnNext1) {
    btnNext1.addEventListener("click", () => {
      if (!fullName.value.trim()) {
        fullName.focus();
        showNotification("Please enter your Full Name");
        return;
      }
      if (!email.value.trim()) {
        email.focus();
        showNotification("Please enter your Business Email");
        return;
      }
      if (!isCustomerAuthenticated) {
        if (!accountPassword || !accountPassword.value || accountPassword.value.length < 8) {
          if (accountPassword) accountPassword.focus();
          showNotification("Please create a password of at least 8 characters");
          return;
        }
        if (!confirmPassword || accountPassword.value !== confirmPassword.value) {
          if (confirmPassword) confirmPassword.focus();
          showNotification("Account passwords do not match");
          return;
        }
      }
      if (!phone.value.trim()) {
        phone.focus();
        showNotification("Please enter your WhatsApp / Mobile number");
        return;
      }
      if (!city.value.trim() || !state.value.trim()) {
        city.focus();
        showNotification("Please enter your City and State");
        return;
      }

      // Check if this email already submitted an application
      const emailVal = email.value.trim().toLowerCase();
      fetch(`/api/applications/check-status?email=${encodeURIComponent(emailVal)}`)
        .then((r) => r.json())
        .then((statusData) => {
          if (statusData && statusData.success && statusData.applied) {
            showAlreadyAppliedCard(statusData);
            localStorage.setItem("webnavi_application", JSON.stringify(statusData));
            showNotification(`An application is already active for this email!`);
          } else {
            goToStep(2);
          }
        })
        .catch(() => {
          goToStep(2);
        });
    });
  }

  if (btnBack2) btnBack2.addEventListener("click", () => goToStep(1));

  if (btnNext2) {
    btnNext2.addEventListener("click", () => {
      if (!businessName.value.trim()) {
        businessName.focus();
        showNotification("Please enter your Business or Brand name");
        return;
      }
      if (!industry.value) {
        industry.focus();
        showNotification("Please select your Business Category");
        return;
      }
      goToStep(3);
    });
  }

  if (btnBack3) btnBack3.addEventListener("click", () => goToStep(2));
  if (btnNext3) btnNext3.addEventListener("click", () => goToStep(4));
  if (btnBack4) btnBack4.addEventListener("click", () => goToStep(3));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("btnSubmitApplication");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting Application...";
    }

    const payload = {
      fullName: fullName.value,
      email: email.value,
      phone: `${dialCode.value} ${phone.value}`,
      city: city.value,
      state: state.value,
      businessName: businessName.value,
      industry: industry.value,
      accountPassword: (!isCustomerAuthenticated && accountPassword) ? accountPassword.value : undefined,
      confirmPassword: (!isCustomerAuthenticated && confirmPassword) ? confirmPassword.value : undefined,
      existingSite: existingSite ? existingSite.value : "",
      instagram: instagram ? instagram.value : "",
      youtube: youtube ? youtube.value : "",
      facebook: facebook ? facebook.value : "",
      preferredDomain: preferredDomain ? preferredDomain.value : "",
      agreedPackagePrice: true,
      agreedDomainWebNavi: true,
      agreedHostingerHosting: true,
    };

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok || data.success === false) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "🚀 Submit Free Website Application";
        }
        if (response.status === 409 || data.code === "ACCOUNT_EXISTS") {
          const emailVal = email.value.trim().toLowerCase();
          fetch(`/api/applications/check-status?email=${encodeURIComponent(emailVal)}`)
            .then((r) => r.json())
            .then((res) => {
              if (res && res.success && res.applied) {
                showAlreadyAppliedCard(res);
                localStorage.setItem("webnavi_application", JSON.stringify(res));
                showNotification(`Application already active! Redirecting to your portal...`);
                setTimeout(() => {
                  window.location.href = res.portalUrl;
                }, 1800);
              } else {
                showNotification(data.error || "An account with this email already exists. Please sign in.");
                setTimeout(() => {
                  window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
                }, 2000);
              }
            })
            .catch(() => {
              showNotification(data.error || "An account with this email already exists. Please sign in.");
            });
          return;
        }
        showNotification(data.error || "Failed to submit application. Please review your details.");
        return;
      }
      const ticketId = data.ticketId || "WN-" + Math.floor(10000 + Math.random() * 90000);
      const clientId = data.clientId;
      const portalUrl = data.portalUrl || `/application/${data.clientId}`;

      // Save to localStorage for instant recognition across sessions
      localStorage.setItem("webnavi_application", JSON.stringify({
        clientId: data.clientId,
        ticketId: ticketId,
        portalUrl: portalUrl,
        businessName: businessName.value,
        preferredDomain: preferredDomain ? preferredDomain.value : "",
        currentStage: 1,
        createdAt: new Date().toISOString()
      }));

      // Show full-page loader before redirect
      showSubmitLoader(ticketId);

      // After a short delay, redirect to the unique client portal
      setTimeout(() => {
        if (portalUrl) {
          window.location.href = portalUrl;
        } else {
          // Fallback: show old success panel if no portalUrl
          hideSubmitLoader();
          [panel1, panel2, panel3, panel4].forEach((p) => {
            if (p) p.style.display = "none";
          });
          if (panelSuccess) panelSuccess.style.display = "block";
          const ticketDisplay = document.getElementById("successTicketId");
          if (ticketDisplay) ticketDisplay.textContent = `TICKET #${ticketId}`;
          const phoneDisplay = document.getElementById("successPhoneDisplay");
          if (phoneDisplay) phoneDisplay.textContent = `${dialCode.value} ${phone.value}`;
          const waBtn = document.getElementById("whatsappDirectLink");
          if (waBtn) {
            const waMsg = encodeURIComponent(
              `Hi WebNavi Team! I just submitted my Free Website Application (Ticket: ${ticketId}) for my business "${businessName.value}".`
            );
            waBtn.href = `https://wa.me/919876543210?text=${waMsg}`;
          }
          if (progressLabel) progressLabel.textContent = "Application Complete";
          if (progressBar) progressBar.style.width = "100%";
        }
      }, 2200);

    } catch (err) {
      showNotification("Network error submitting application. Please try again.");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "🚀 Submit Free Website Application";
      }
    }
  });
}

/**
 * Domain Registration & Checkout Flow
 */
let currentRegDomain = null;
let currentRegQuote = null;

window.isCustomerLoggedIn = false;

window.openRegistrationModal = async function (domain, cachedData) {
  currentRegDomain = domain;
  const modal = document.getElementById("domainRegisterModal");
  if (!modal) return;

  const domainTitle = document.getElementById("regModalDomainName");
  if (domainTitle) domainTitle.textContent = domain;

  // Reset steps
  window.goToStep1();

  const alertBox = document.getElementById("regModalAlert");
  if (alertBox) alertBox.style.display = "none";

  modal.style.display = "flex";
  modal.classList.add("open");
  modal.style.opacity = "1";
  modal.style.pointerEvents = "auto";

  // Check customer session status
  fetch("/api/customer/me")
    .then((r) => r.json())
    .then((d) => {
      const pwdGroup = document.getElementById("checkoutPasswordGroup");
      const notice = document.getElementById("checkoutLoggedInNotice");
      const noticeText = document.getElementById("checkoutLoggedInText");

      if (d && d.success && d.customer) {
        window.isCustomerLoggedIn = true;
        if (pwdGroup) pwdGroup.style.display = "none";
        if (notice && noticeText) {
          notice.style.display = "block";
          noticeText.innerHTML = `✓ Signed in as <strong>${escapeHtml(d.customer.fullName || d.customer.email)}</strong> (${escapeHtml(d.customer.email)}). Domain order will be linked to your account.`;
        }
        const fn = document.getElementById("regFirstName");
        const ln = document.getElementById("regLastName");
        const em = document.getElementById("regEmail");
        const ph = document.getElementById("regPhone");
        if (d.customer.fullName && fn && !fn.value) {
          const parts = d.customer.fullName.trim().split(" ");
          fn.value = parts[0] || "";
          if (ln && !ln.value && parts.length > 1) ln.value = parts.slice(1).join(" ");
        }
        if (d.customer.email && em && !em.value) em.value = d.customer.email;
        if (d.customer.phone && ph && !ph.value) ph.value = d.customer.phone;
      } else {
        window.isCustomerLoggedIn = false;
        if (pwdGroup) pwdGroup.style.display = "block";
        if (notice) notice.style.display = "none";
      }
    })
    .catch(() => {});

  // Fetch verified live quote
  try {
    const res = await fetch("/api/orders/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    });
    const quote = await res.json();
    if (quote.success) {
      currentRegQuote = quote;
    } else {
      currentRegQuote = {
        domain,
        reg_price: cachedData && cachedData.price ? cachedData.price : 849,
        renew_price: cachedData && cachedData.renew_price ? cachedData.renew_price : 1049,
        currency: "INR",
        total_amount: cachedData && cachedData.price ? cachedData.price : 849,
      };
    }
  } catch (err) {
    currentRegQuote = {
      domain,
      reg_price: cachedData && cachedData.price ? cachedData.price : 849,
      renew_price: cachedData && cachedData.renew_price ? cachedData.renew_price : 1049,
      currency: "INR",
      total_amount: cachedData && cachedData.price ? cachedData.price : 849,
    };
  }
};

window.closeRegisterModal = function () {
  const modal = document.getElementById("domainRegisterModal");
  if (modal) {
    modal.classList.remove("open");
    modal.style.opacity = "0";
    modal.style.pointerEvents = "none";
    modal.style.display = "none";
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("closeRegisterModalBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", window.closeRegisterModal);
  }
  const modal = document.getElementById("domainRegisterModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) window.closeRegisterModal();
    });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.closeRegisterModal();
  });
});

window.goToStep1 = function () {
  const s1 = document.getElementById("regStep1");
  const s2 = document.getElementById("regStep2");
  const s3 = document.getElementById("regStep3");
  if (s1) s1.style.display = "block";
  if (s2) s2.style.display = "none";
  if (s3) s3.style.display = "none";

  const t1 = document.getElementById("stepTab1");
  const t2 = document.getElementById("stepTab2");
  const t3 = document.getElementById("stepTab3");
  if (t1) { t1.style.color = "#ffd43b"; t1.querySelector("span").style.background = "#ffd43b"; t1.querySelector("span").style.color = "#03140e"; }
  if (t2) { t2.style.color = "#5d756b"; t2.querySelector("span").style.background = "#132d22"; t2.querySelector("span").style.color = "#7b9489"; }
  if (t3) { t3.style.color = "#5d756b"; t3.querySelector("span").style.background = "#132d22"; t3.querySelector("span").style.color = "#7b9489"; }
};

window.openRegisterModal = function (domain, price, renewPrice, curr) {
  if (typeof window.openRegistrationModal === 'function') {
    window.openRegistrationModal(domain, { price, renew_price: renewPrice, currency: curr });
  }
};

window.goToReviewStep = function (e) {
  if (e) e.preventDefault();

  const alertBox = document.getElementById("regModalAlert");
  const pwdInput = document.getElementById("regAccountPassword");
  const confirmPwdInput = document.getElementById("regConfirmPassword");

  if (!window.isCustomerLoggedIn && pwdInput) {
    if (!pwdInput.value || pwdInput.value.length < 8) {
      if (alertBox) {
        alertBox.style.display = "block";
        alertBox.style.background = "rgba(248, 113, 113, 0.15)";
        alertBox.style.color = "#f87171";
        alertBox.style.border = "1px solid rgba(248, 113, 113, 0.4)";
        alertBox.textContent = "Please create an account password of at least 8 characters.";
      }
      pwdInput.focus();
      return;
    }
    if (confirmPwdInput && pwdInput.value !== confirmPwdInput.value) {
      if (alertBox) {
        alertBox.style.display = "block";
        alertBox.style.background = "rgba(248, 113, 113, 0.15)";
        alertBox.style.color = "#f87171";
        alertBox.style.border = "1px solid rgba(248, 113, 113, 0.4)";
        alertBox.textContent = "Passwords do not match. Please verify your password.";
      }
      confirmPwdInput.focus();
      return;
    }
  }

  const fn = document.getElementById("regFirstName").value.trim();
  const ln = document.getElementById("regLastName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const phone = document.getElementById("regPhone").value.trim();
  const addr1 = document.getElementById("regAddress1") ? document.getElementById("regAddress1").value.trim() : (document.getElementById("regAddress") ? document.getElementById("regAddress").value.trim() : "");
  const addr2 = document.getElementById("regAddress2") ? document.getElementById("regAddress2").value.trim() : "";
  const city = document.getElementById("regCity").value.trim();
  const state = document.getElementById("regState").value.trim();
  const postal = document.getElementById("regPostal") ? document.getElementById("regPostal").value.trim() : (document.getElementById("regPostalCode") ? document.getElementById("regPostalCode").value.trim() : "");
  const country = document.getElementById("regCountry") ? document.getElementById("regCountry").value : "IN";
  const regType = document.getElementById("regType") ? document.getElementById("regType").value : "Individual";
  const org = document.getElementById("regOrg") ? document.getElementById("regOrg").value.trim() : "";

  // Populate Review step
  const revDomain = document.getElementById("reviewDomainTitle");
  if (revDomain) revDomain.textContent = currentRegDomain;

  const quote = currentRegQuote || { reg_price: 849, renew_price: 1049, total_amount: 849, currency: "INR" };

  const revReg = document.getElementById("reviewRegPrice");
  if (revReg) revReg.textContent = `₹ ${Number(quote.reg_price).toFixed(2)}`;

  const revRenew = document.getElementById("reviewRenewPrice");
  if (revRenew) revRenew.textContent = `₹ ${Number(quote.renew_price).toFixed(2)}/yr`;

  const revTax = document.getElementById("reviewTaxAmount");
  if (revTax) revTax.textContent = quote.tax_note ? `₹ 0.00 (${quote.tax_note})` : `₹ ${Number(quote.tax_amount || 0).toFixed(2)} (Zero-Rated Wholesale Quote)`;

  const revTotal = document.getElementById("reviewTotalPrice");
  if (revTotal) revTotal.textContent = `₹ ${Number(quote.total_amount).toFixed(2)}`;

  const revText = document.getElementById("reviewRegistrantText");
  if (revText) {
    revText.innerHTML = `
      <strong>${escapeHtml(fn)} ${escapeHtml(ln)}</strong> (${escapeHtml(regType)}${org ? ' &bull; ' + escapeHtml(org) : ''})<br>
      ${escapeHtml(addr1)}${addr2 ? ', ' + escapeHtml(addr2) : ''}<br>
      ${escapeHtml(city)}, ${escapeHtml(state)} ${escapeHtml(postal)} (${escapeHtml(country)})<br>
      Email: ${escapeHtml(email)} &bull; Phone: ${escapeHtml(phone)}
    `;
  }

  // Switch tabs
  const s1 = document.getElementById("regStep1");
  const s2 = document.getElementById("regStep2");
  const s3 = document.getElementById("regStep3");
  if (s1) s1.style.display = "none";
  if (s2) s2.style.display = "block";
  if (s3) s3.style.display = "none";

  const t1 = document.getElementById("stepTab1");
  const t2 = document.getElementById("stepTab2");
  if (t1) { t1.style.color = "#00e599"; t1.querySelector("span").style.background = "rgba(0,229,153,0.15)"; t1.querySelector("span").style.color = "#00e599"; }
  if (t2) { t2.style.color = "#ffd43b"; t2.querySelector("span").style.background = "#ffd43b"; t2.querySelector("span").style.color = "#03140e"; }
};

window.submitDomainRegistration = async function () {
  const chk = document.getElementById("confirmAccuracyCheckbox");
  const alertBox = document.getElementById("regModalAlert");
  if (!chk || !chk.checked) {
    if (alertBox) {
      alertBox.style.display = "block";
      alertBox.style.background = "rgba(248, 113, 113, 0.15)";
      alertBox.style.color = "#f87171";
      alertBox.style.border = "1px solid rgba(248, 113, 113, 0.4)";
      alertBox.textContent = "Please verify and check the confirmation box before proceeding.";
    }
    return;
  }

  const btn = document.getElementById("btnSubmitRegistration");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pulse-dot" style="width:8px; height:8px; display:inline-block; margin-right:6px;"></span> Registering via ICANN Gateway...`;
  }

  if (alertBox) alertBox.style.display = "none";

  const registrant = {
    firstName: document.getElementById("regFirstName").value.trim(),
    lastName: document.getElementById("regLastName").value.trim(),
    email: document.getElementById("regEmail").value.trim(),
    phone: document.getElementById("regPhone").value.trim(),
    address1: document.getElementById("regAddress1") ? document.getElementById("regAddress1").value.trim() : (document.getElementById("regAddress") ? document.getElementById("regAddress").value.trim() : ""),
    address2: document.getElementById("regAddress2") ? document.getElementById("regAddress2").value.trim() : "",
    city: document.getElementById("regCity").value.trim(),
    state: document.getElementById("regState").value.trim(),
    postalCode: document.getElementById("regPostal") ? document.getElementById("regPostal").value.trim() : (document.getElementById("regPostalCode") ? document.getElementById("regPostalCode").value.trim() : ""),
    country: document.getElementById("regCountry") ? document.getElementById("regCountry").value : "IN",
    registrantType: document.getElementById("regType") ? document.getElementById("regType").value : "Individual",
    orgName: document.getElementById("regOrg") ? document.getElementById("regOrg").value.trim() : "",
  };

  const payload = {
    domain: currentRegDomain,
    years: 1,
    registrant,
    accountPassword: (!window.isCustomerLoggedIn && document.getElementById("regAccountPassword")) ? document.getElementById("regAccountPassword").value : undefined,
    confirmPassword: (!window.isCustomerLoggedIn && document.getElementById("regConfirmPassword")) ? document.getElementById("regConfirmPassword").value : undefined,
    expectedPrice: currentRegQuote ? currentRegQuote.reg_price : undefined,
    expectedTotalAmount: currentRegQuote ? currentRegQuote.total_amount : undefined,
    confirmedAccuracy: true,
    idempotencyKey: `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
  };

  try {
    const response = await fetch("/api/orders/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || data.success === false) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>Confirm & Register Domain</span>`;
      }

      if (alertBox) {
        alertBox.style.display = "block";
        alertBox.style.background = "rgba(248, 113, 113, 0.15)";
        alertBox.style.color = "#f87171";
        alertBox.style.border = "1px solid rgba(248, 113, 113, 0.4)";
        if (data.code === "ACCOUNT_EXISTS") {
          alertBox.innerHTML = `
            <strong>Account Exists:</strong> An account with this email address already exists.
            <div style="margin-top:6px;"><a href="/login" style="color:#ffd43b; text-decoration:underline; font-weight:700;">Click here to sign in</a> to link this domain order to your existing account.</div>
          `;
        } else {
          alertBox.innerHTML = `
            <strong>Registration Notice:</strong> ${escapeHtml(data.error || "Domain registration could not be completed.")}
            ${data.details && data.details.required != null ? `<div style="margin-top:6px; font-size:0.75rem; color:#ffd43b;">Required: ₹ ${data.details.required} | Available in Wallet: ₹ ${data.details.available} | Deficit: ₹ ${data.details.deficit}</div>` : ''}
          `;
        }
      }
      return;
    }

    // SUCCESS - Move to Step 3
    const s1 = document.getElementById("regStep1");
    const s2 = document.getElementById("regStep2");
    const s3 = document.getElementById("regStep3");
    if (s1) s1.style.display = "none";
    if (s2) s2.style.display = "none";
    if (s3) s3.style.display = "block";

    const t2 = document.getElementById("stepTab2");
    const t3 = document.getElementById("stepTab3");
    if (t2) { t2.style.color = "#00e599"; t2.querySelector("span").style.background = "rgba(0,229,153,0.15)"; t2.querySelector("span").style.color = "#00e599"; }
    if (t3) { t3.style.color = "#00e599"; t3.querySelector("span").style.background = "#00e599"; t3.querySelector("span").style.color = "#03140e"; }

    const confDom = document.getElementById("confDomain");
    if (confDom) confDom.textContent = data.domain;

    const confOrd = document.getElementById("confOrderId");
    if (confOrd) confOrd.textContent = data.orderId;

    const confRef = document.getElementById("confRegistrarRef");
    if (confRef) confRef.textContent = data.registrarRef || "Confirmed by Gateway";

    const confReg = document.getElementById("confRegStatus");
    if (confReg) confReg.textContent = data.status || "ACTIVE";

    const confDns = document.getElementById("confDnsStatus");
    if (confDns) {
      confDns.textContent = data.dnsStatus || data.dnsApprovalStatus || "PENDING_APPROVAL";
    }

    const confCfNs = document.getElementById("confCloudflareNs");
    if (confCfNs) {
      const nsList = (data.nameservers && Array.isArray(data.nameservers) && data.nameservers.length > 0)
        ? data.nameservers
        : ((data.order && Array.isArray(data.order.nameservers) && data.order.nameservers.length > 0) ? data.order.nameservers : null);
      if (nsList && nsList.length >= 2) {
        confCfNs.textContent = nsList.join(", ");
      } else {
        confCfNs.textContent = "Cloudflare nameservers will be displayed upon zone activation";
      }
    }

    const confRegNs = document.getElementById("confRegistrarNs");
    if (confRegNs) {
      confRegNs.textContent = "HostyIndia Default Nameservers (auto-assigned by registry)";
    }

    const confExp = document.getElementById("confExpiryDate");
    if (confExp) {
      confExp.textContent = data.expiresAt ? new Date(data.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "1 Year from Today";
    }

    const invLink = document.getElementById("confInvoiceLink");
    if (invLink) {
      invLink.href = data.invoiceUrl || (data.secretToken ? `/api/orders/${data.orderId}/invoice?token=${encodeURIComponent(data.secretToken)}` : `/api/orders/${data.orderId}/invoice`);
    }

  } catch (netErr) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>Confirm & Register Domain</span>`;
    }
    if (alertBox) {
      alertBox.style.display = "block";
      alertBox.style.background = "rgba(248, 113, 113, 0.15)";
      alertBox.style.color = "#f87171";
      alertBox.style.border = "1px solid rgba(248, 113, 113, 0.4)";
      alertBox.textContent = "Network error communicating with the registrar gateway. Please try again.";
    }
  }
};

// Navbar Dropdown Accessible Behavior
document.addEventListener("DOMContentLoaded", () => {
  const dropdownTrigger = document.getElementById("pricingDropdownTrigger");
  const dropdownItem = dropdownTrigger ? dropdownTrigger.closest(".nav-item-dropdown") : null;
  if (dropdownTrigger && dropdownItem) {
    dropdownTrigger.addEventListener("click", (e) => {
      if (window.innerWidth <= 1024 || "ontouchstart" in window) {
        e.preventDefault();
        const isOpen = dropdownItem.classList.toggle("open");
        dropdownTrigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      }
    });

    document.addEventListener("click", (e) => {
      if (!dropdownItem.contains(e.target)) {
        dropdownItem.classList.remove("open");
        dropdownTrigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Global Customer Navbar Status
  const navCustomerLink = document.getElementById("navCustomerLink");
  if (navCustomerLink) {
    fetch("/api/customer/me")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && data.customer) {
          navCustomerLink.href = "/customer/dashboard";
          navCustomerLink.textContent = "Dashboard";
          navCustomerLink.style.color = "#00e599";
          navCustomerLink.style.fontWeight = "700";
        }
      })
      .catch(() => {});
  }
});
