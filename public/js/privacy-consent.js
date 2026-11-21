/**
 * WebNavi Privacy, Cookie Consent & Lightweight Visitor Tracking Engine
 * 
 * Features:
 * - Professional GDPR/ePrivacy compliant Cookie Consent Banner
 * - Granular categories: Necessary (locked), Functional, Analytics, Marketing
 * - Instant consent update & withdrawal via Cookie Settings modal
 * - Client-side visitor ID & session tracking respecting user choices
 * - Responsive WebNavi dark theme styling with #00e599 green accent
 */

(function () {
  'use strict';

  const CONSENT_STORAGE_KEY = 'wn_cookie_consent';
  const VISITOR_ID_KEY = 'wn_visitor_id';
  const SESSION_ID_KEY = 'wn_session_id';
  const CONSENT_MAX_AGE_DAYS = 365;

  // Retrieve current customer ID if logged in / present on portal
  function getCustomerId() {
    try {
      if (window.currentCustomer && window.currentCustomer.id) return window.currentCustomer.id;
      if (window.clientData && window.clientData.id) return window.clientData.id;
      const stored = localStorage.getItem('wn_customer_id');
      if (stored) return stored;
    } catch (e) {}
    return null;
  }

  // Load stored consent
  function getStoredConsent() {
    try {
      const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.timestamp) {
        const ageDays = (Date.now() - new Date(data.timestamp).getTime()) / (1000 * 3600 * 24);
        if (ageDays > CONSENT_MAX_AGE_DAYS) {
          localStorage.removeItem(CONSENT_STORAGE_KEY);
          return null;
        }
        return data;
      }
    } catch (e) {}
    return null;
  }

  // Save consent
  function saveConsent(status, preferences) {
    const consentData = {
      status, // 'accepted_all', 'rejected_optional', 'customized'
      preferences: {
        necessary: true,
        functional: !!preferences.functional,
        analytics: !!preferences.analytics,
        marketing: !!preferences.marketing,
      },
      timestamp: new Date().toISOString(),
      version: 1,
    };

    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consentData));
    } catch (e) {}

    // If analytics rejected, purge all visitor & session tracking keys immediately
    if (!consentData.preferences.analytics) {
      try {
        localStorage.removeItem(VISITOR_ID_KEY);
        sessionStorage.removeItem(VISITOR_ID_KEY);
        sessionStorage.removeItem(SESSION_ID_KEY);
      } catch (e) {}
    }

    // Report consent event to backend
    const visitorId = consentData.preferences.analytics ? getVisitorId(false) : null;
    fetch('/api/tracking/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        customerId: getCustomerId(),
        action: status === 'accepted_all' ? 'accept_all' : (status === 'rejected_optional' ? 'reject_optional' : 'customize'),
        preferences: consentData.preferences,
      }),
    }).catch(() => {});

    // Dispatch DOM event for other platform scripts
    window.dispatchEvent(new CustomEvent('webnavi:consentUpdated', { detail: consentData }));

    // If analytics accepted, trigger pageview to initialize persistent tracking
    if (consentData.preferences.analytics) {
      setTimeout(trackPageView, 50);
    }

    return consentData;
  }

  // Get or generate visitor ID
  function getVisitorId(allowPersistent = true) {
    const consent = getStoredConsent();
    // Strictly opt-in: Analytics allowed ONLY if explicit consent granted
    const analyticsAllowed = consent && consent.preferences && consent.preferences.analytics === true;
    if (!analyticsAllowed) {
      return null;
    }

    let vid = null;
    if (allowPersistent) {
      try {
        vid = localStorage.getItem(VISITOR_ID_KEY);
      } catch (e) {}
    }

    if (!vid) {
      try {
        vid = sessionStorage.getItem(VISITOR_ID_KEY);
      } catch (e) {}
    }

    return vid;
  }

  // Get current session ID
  function getSessionId() {
    const consent = getStoredConsent();
    const analyticsAllowed = consent && consent.preferences && consent.preferences.analytics === true;
    if (!analyticsAllowed) {
      return null;
    }
    try {
      return sessionStorage.getItem(SESSION_ID_KEY);
    } catch (e) {}
    return null;
  }

  // Store visitor & session IDs according to consent rules
  function storeTrackingIdentifiers(visitorId, sessionId) {
    const consent = getStoredConsent();
    const analyticsAllowed = consent && consent.preferences && consent.preferences.analytics === true;

    try {
      if (analyticsAllowed) {
        sessionStorage.setItem(SESSION_ID_KEY, sessionId);
        sessionStorage.setItem(VISITOR_ID_KEY, visitorId);
        localStorage.setItem(VISITOR_ID_KEY, visitorId);
      } else {
        sessionStorage.removeItem(SESSION_ID_KEY);
        sessionStorage.removeItem(VISITOR_ID_KEY);
        localStorage.removeItem(VISITOR_ID_KEY);
      }
    } catch (e) {}
  }

  let lastTrackedPath = null;
  let lastTrackedTime = 0;

  // Send page view tracking event
  function trackPageView() {
    const currentPath = window.location.pathname || '/';
    const now = Date.now();
    // Prevent rapid duplicate pageview events on single page render (within 1 second)
    if (lastTrackedPath === currentPath && (now - lastTrackedTime < 1000)) {
      return;
    }
    lastTrackedPath = currentPath;
    lastTrackedTime = now;

    const consent = getStoredConsent();
    // If user has explicitly rejected optional tracking and analytics is false, do not execute tracking
    if (consent && consent.preferences && consent.preferences.analytics === false) {
      return;
    }

    const visitorId = getVisitorId(true);
    const sessionId = getSessionId();

    fetch('/api/tracking/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        sessionId,
        path: currentPath,
        title: document.title || 'WebNavi',
        referrer: document.referrer || '',
        customerId: getCustomerId(),
        consent: consent ? { status: consent.status, preferences: consent.preferences } : null,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.visitorId && data.sessionId && !data.trackingDisabled) {
          storeTrackingIdentifiers(data.visitorId, data.sessionId);
        }
      })
      .catch(() => {});
  }

  // Build and inject UI components (Banner + Modal)
  function injectPrivacyUI() {
    if (document.getElementById('wnPrivacyRoot')) return;

    const root = document.createElement('div');
    root.id = 'wnPrivacyRoot';
    root.innerHTML = `
      <style>
        #wnPrivacyBanner {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          max-width: 480px;
          width: calc(100% - 3rem);
          background: #061811;
          border: 1px solid #1a4a38;
          border-radius: 12px;
          padding: 1.5rem;
          box-shadow: 0 20px 50px rgba(0,0,0,0.85);
          z-index: 99999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #d7e0db;
          display: none;
          animation: wnFadeIn 0.3s ease-out;
        }
        @keyframes wnFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        #wnPrivacyBanner h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1.1rem;
          font-weight: 700;
          color: #ffffff;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        #wnPrivacyBanner h3 span {
          color: #00e599;
        }
        #wnPrivacyBanner p {
          margin: 0 0 1.25rem 0;
          font-size: 0.85rem;
          line-height: 1.45;
          color: #9cb1a6;
        }
        .wn-consent-actions {
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
        }
        .wn-btn-primary-consent {
          background: #00e599;
          color: #03140e;
          border: none;
          padding: 0.65rem 1rem;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
          transition: background 0.2s;
        }
        .wn-btn-primary-consent:hover {
          background: #00ffaa;
        }
        .wn-btn-row {
          display: flex;
          gap: 0.65rem;
        }
        .wn-btn-secondary-consent {
          flex: 1;
          background: #07241b;
          color: #00e599;
          border: 1px solid #1a4a38;
          padding: 0.55rem 0.75rem;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.8rem;
          cursor: pointer;
          transition: border-color 0.2s;
          text-align: center;
        }
        .wn-btn-secondary-consent:hover {
          border-color: #00e599;
        }
        .wn-btn-tertiary-consent {
          flex: 1;
          background: transparent;
          color: #9cb1a6;
          border: 1px solid #163629;
          padding: 0.55rem 0.75rem;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.8rem;
          cursor: pointer;
          transition: color 0.2s;
          text-align: center;
        }
        .wn-btn-tertiary-consent:hover {
          color: #fff;
          border-color: #2a5a48;
        }

        /* Customize Modal Overlay */
        #wnPrivacyModal {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(4px);
          z-index: 100000;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #d7e0db;
        }
        .wn-modal-box {
          background: #061811;
          border: 1px solid #1a4a38;
          border-radius: 12px;
          max-width: 540px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          padding: 1.75rem;
          box-shadow: 0 25px 60px rgba(0,0,0,0.9);
        }
        .wn-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #163629;
          padding-bottom: 1rem;
          margin-bottom: 1.25rem;
        }
        .wn-modal-header h3 {
          margin: 0;
          font-size: 1.2rem;
          color: #ffffff;
        }
        .wn-close-btn {
          background: none;
          border: none;
          color: #7b9489;
          font-size: 1.5rem;
          cursor: pointer;
          line-height: 1;
        }
        .wn-category-item {
          background: #04140e;
          border: 1px solid #163629;
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 0.85rem;
        }
        .wn-category-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.4rem;
        }
        .wn-category-title {
          font-weight: 700;
          font-size: 0.9rem;
          color: #ffffff;
        }
        .wn-category-badge {
          font-size: 0.7rem;
          padding: 0.15rem 0.5rem;
          border-radius: 4px;
          background: #07241b;
          color: #00e599;
          border: 1px solid #1a4a38;
          font-weight: 600;
        }
        .wn-category-desc {
          font-size: 0.78rem;
          color: #9cb1a6;
          line-height: 1.4;
          margin: 0;
        }
        /* Custom Switch */
        .wn-switch {
          position: relative;
          display: inline-block;
          width: 40px;
          height: 22px;
        }
        .wn-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .wn-slider {
          position: absolute;
          cursor: pointer;
          inset: 0;
          background-color: #1a382d;
          transition: 0.3s;
          border-radius: 22px;
        }
        .wn-slider:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        input:checked + .wn-slider {
          background-color: #00e599;
        }
        input:checked + .wn-slider:before {
          transform: translateX(18px);
          background-color: #03140e;
        }
        input:disabled + .wn-slider {
          opacity: 0.6;
          cursor: not-allowed;
        }
      </style>

      <!-- Banner -->
      <div id="wnPrivacyBanner">
        <h3><span>🛡️</span> Your Privacy Matters</h3>
        <p>
          We use cookies to improve your browsing experience, remember your preferences and understand how visitors use our website.
        </p>
        <div class="wn-consent-actions">
          <button type="button" class="wn-btn-primary-consent" id="btnAcceptAllCookies">
            Accept All Cookies
          </button>
          <div class="wn-btn-row">
            <button type="button" class="wn-btn-secondary-consent" id="btnRejectOptionalCookies">
              Reject Optional Cookies
            </button>
            <button type="button" class="wn-btn-tertiary-consent" id="btnCustomizeCookies">
              Customize Settings
            </button>
          </div>
        </div>
      </div>

      <!-- Customization Modal -->
      <div id="wnPrivacyModal">
        <div class="wn-modal-box">
          <div class="wn-modal-header">
            <h3>Cookie Preferences</h3>
            <button type="button" class="wn-close-btn" id="btnClosePrivacyModal">&times;</button>
          </div>

          <p style="font-size:0.82rem; color:#9cb1a6; margin-bottom:1.25rem; line-height:1.45;">
            Configure which cookies you consent to WebNavi using during your visits. Necessary cookies cannot be disabled as they are required for security and core domain functions.
          </p>

          <!-- Necessary -->
          <div class="wn-category-item">
            <div class="wn-category-header">
              <span class="wn-category-title">Necessary Cookies</span>
              <span class="wn-category-badge">Always Active</span>
            </div>
            <p class="wn-category-desc">
              Essential for the website to function securely, authenticate sessions, and process domain orders and DNS configurations.
            </p>
          </div>

          <!-- Functional -->
          <div class="wn-category-item">
            <div class="wn-category-header">
              <span class="wn-category-title">Functional Cookies</span>
              <label class="wn-switch">
                <input type="checkbox" id="toggleFunctional">
                <span class="wn-slider"></span>
              </label>
            </div>
            <p class="wn-category-desc">
              Remember your site preferences such as default currency, region, and interface display modes.
            </p>
          </div>

          <!-- Analytics -->
          <div class="wn-category-item">
            <div class="wn-category-header">
              <span class="wn-category-title">Analytics Cookies</span>
              <label class="wn-switch">
                <input type="checkbox" id="toggleAnalytics">
                <span class="wn-slider"></span>
              </label>
            </div>
            <p class="wn-category-desc">
              Help us understand how visitors interact with WebNavi, returning visit frequency, and popular services without identifying individuals.
            </p>
          </div>

          <!-- Marketing -->
          <div class="wn-category-item">
            <div class="wn-category-header">
              <span class="wn-category-title">Marketing Cookies</span>
              <label class="wn-switch">
                <input type="checkbox" id="toggleMarketing">
                <span class="wn-slider"></span>
              </label>
            </div>
            <p class="wn-category-desc">
              Used only if promotional campaigns or platform updates are tailored to your interests.
            </p>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.5rem; gap:0.75rem;">
            <button type="button" id="btnModalRejectAll" style="background:transparent; border:1px solid #1a4a38; color:#9cb1a6; padding:0.55rem 0.85rem; border-radius:6px; font-size:0.8rem; cursor:pointer;">
              Reject Optional
            </button>
            <div style="display:flex; gap:0.65rem;">
              <button type="button" id="btnModalSavePreferences" style="background:#07241b; border:1px solid #00e599; color:#00e599; padding:0.55rem 1rem; border-radius:6px; font-weight:700; font-size:0.8rem; cursor:pointer;">
                Save Preferences
              </button>
              <button type="button" id="btnModalAcceptAll" style="background:#00e599; border:none; color:#03140e; padding:0.55rem 1.15rem; border-radius:6px; font-weight:700; font-size:0.8rem; cursor:pointer;">
                Accept All
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    // Event Bindings
    const banner = document.getElementById('wnPrivacyBanner');
    const modal = document.getElementById('wnPrivacyModal');

    // 1. Accept All
    document.getElementById('btnAcceptAllCookies').addEventListener('click', () => {
      saveConsent('accepted_all', { functional: true, analytics: true, marketing: true });
      banner.style.display = 'none';
    });
    document.getElementById('btnModalAcceptAll').addEventListener('click', () => {
      saveConsent('accepted_all', { functional: true, analytics: true, marketing: true });
      modal.style.display = 'none';
      banner.style.display = 'none';
    });

    // 2. Reject Optional
    document.getElementById('btnRejectOptionalCookies').addEventListener('click', () => {
      saveConsent('rejected_optional', { functional: false, analytics: false, marketing: false });
      banner.style.display = 'none';
    });
    document.getElementById('btnModalRejectAll').addEventListener('click', () => {
      saveConsent('rejected_optional', { functional: false, analytics: false, marketing: false });
      modal.style.display = 'none';
      banner.style.display = 'none';
    });

    // 3. Customize Settings
    document.getElementById('btnCustomizeCookies').addEventListener('click', () => {
      openCustomizationModal();
    });
    document.getElementById('btnClosePrivacyModal').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    // 4. Save Custom Preferences
    document.getElementById('btnModalSavePreferences').addEventListener('click', () => {
      const functional = document.getElementById('toggleFunctional').checked;
      const analytics = document.getElementById('toggleAnalytics').checked;
      const marketing = document.getElementById('toggleMarketing').checked;

      const allAccepted = functional && analytics && marketing;
      const allRejected = !functional && !analytics && !marketing;
      let status = 'customized';
      if (allAccepted) status = 'accepted_all';
      if (allRejected) status = 'rejected_optional';

      saveConsent(status, { functional, analytics, marketing });
      modal.style.display = 'none';
      banner.style.display = 'none';
    });

    // Close modal on click outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  function openCustomizationModal() {
    injectPrivacyUI();
    const modal = document.getElementById('wnPrivacyModal');
    const consent = getStoredConsent();

    const prefs = (consent && consent.preferences) || { functional: false, analytics: false, marketing: false };
    document.getElementById('toggleFunctional').checked = !!prefs.functional;
    document.getElementById('toggleAnalytics').checked = !!prefs.analytics;
    document.getElementById('toggleMarketing').checked = !!prefs.marketing;

    modal.style.display = 'flex';
  }

  function init() {
    injectPrivacyUI();

    const stored = getStoredConsent();
    if (!stored) {
      // First-time visitor: reveal banner after gentle 600ms delay
      setTimeout(() => {
        const banner = document.getElementById('wnPrivacyBanner');
        if (banner) banner.style.display = 'block';
      }, 600);
    }

    // Automatically record pageview
    trackPageView();
  }

  // Public API exposed for footer links or settings invocation
  window.WebNaviPrivacy = {
    openSettings: openCustomizationModal,
    getConsent: getStoredConsent,
    acceptAll: () => saveConsent('accepted_all', { functional: true, analytics: true, marketing: true }),
    rejectOptional: () => saveConsent('rejected_optional', { functional: false, analytics: false, marketing: false }),
    trackPageView,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

