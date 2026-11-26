/**
 * WebNavi Launch Announcement Banner
 * - Shows a dismissible "Official Launch Coming Soon" strip at the top
 * - Dismissed state saved in localStorage (won't reappear after close)
 * - Automatically adjusts mobile-nav panel offset when banner is visible/hidden
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'wn_launch_banner_dismissed_v1';

  function init() {
    // Don't show if already dismissed
    if (localStorage.getItem(STORAGE_KEY) === '1') return;

    // ── Build banner HTML ──────────────────────────────────────────────────
    var banner = document.createElement('div');
    banner.id = 'launchBanner';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML =
      '<span class="launch-banner-dot" aria-hidden="true"></span>' +
      '<span class="launch-banner-pill">🚀 Coming Soon</span>' +
      '<p class="launch-banner-text">' +
        '<strong>WebNavi Official Platform Launching Soon!</strong> ' +
        'Once our <span class="banner-highlight">Free Website Early Access</span> spots are filled, ' +
        'we will open the full self-serve dashboard. <strong>Stay tuned.</strong>' +
      '</p>' +
      '<a href="/free-website" class="launch-banner-cta">Grab Your Spot →</a>' +
      '<button class="launch-banner-close" aria-label="Dismiss announcement" id="launchBannerClose">' +
        '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
          '<line x1="1" y1="1" x2="13" y2="13"/>' +
          '<line x1="13" y1="1" x2="1" y2="13"/>' +
        '</svg>' +
      '</button>';

    // ── Insert before everything else in <body> ────────────────────────────
    var body = document.body;
    body.insertBefore(banner, body.firstChild);

    // ── Update mobile-nav panel offset ────────────────────────────────────
    updateMobileNavOffset(true);

    // ── Close button ──────────────────────────────────────────────────────
    var closeBtn = document.getElementById('launchBannerClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        dismiss();
      });
    }
  }

  function dismiss() {
    var banner = document.getElementById('launchBanner');
    if (!banner) return;
    banner.classList.add('hidden');
    localStorage.setItem(STORAGE_KEY, '1');
    // Update mobile panel offset after banner collapses
    setTimeout(function () { updateMobileNavOffset(false); }, 450);
  }

  function updateMobileNavOffset(bannerVisible) {
    var panel = document.getElementById('mobileNavPanel');
    if (!panel) return;
    // topbar(38) + navbar(64) = 102 without banner
    // banner is ~42px
    panel.style.top = bannerVisible ? '144px' : '102px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
