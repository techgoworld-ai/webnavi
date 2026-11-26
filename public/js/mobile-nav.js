/**
 * WebNavi Mobile Navigation System
 * Injects hamburger button + slide-down mobile menu on all pages
 * Works with the existing .site-nav / .nav-inner / .nav-actions structure
 */
(function () {
  'use strict';

  function init() {
    const navInner = document.querySelector('.nav-inner');
    const navActions = document.querySelector('.nav-actions');
    if (!navInner || !navActions) return;

    // Avoid duplicate injection
    if (document.getElementById('mobileNavPanel')) return;

    // ── 1. Build hamburger button ──────────────────────────────────────────
    const hamburger = document.createElement('button');
    hamburger.className = 'hamburger-btn';
    hamburger.setAttribute('aria-label', 'Open navigation menu');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-controls', 'mobileNavPanel');
    hamburger.setAttribute('type', 'button');
    hamburger.innerHTML = '<span></span><span></span><span></span>';
    navActions.appendChild(hamburger);

    // ── 2. Collect nav links from existing desktop nav ─────────────────────
    const desktopNavUl = document.querySelector('.nav-links');
    const links = desktopNavUl
      ? Array.from(desktopNavUl.querySelectorAll('a')).map(a => ({
          href: a.getAttribute('href'),
          text: a.textContent.trim(),
        }))
      : [];

    // Fallback links if none found (e.g. login.html)
    const defaultLinks = [
      { href: '/', text: 'Home' },
      { href: '/#how-it-works', text: 'How It Works' },
      { href: '/#the-math', text: 'Why Free' },
      { href: '/blog', text: 'Blog' },
      { href: '/#faq', text: 'FAQ' },
    ];
    const navLinks = links.length > 0 ? links : defaultLinks;

    // ── 3. Detect Sign In link in desktop nav actions ──────────────────────
    const signInEl = document.getElementById('navCustomerLink')
      || document.querySelector('.nav-actions a[href="/login"]');
    const signInHref = signInEl ? signInEl.getAttribute('href') : '/login';

    // Detect Get Free Website button
    const ctaBtn = document.querySelector('.nav-actions .btn-yellow, .nav-actions .btn.btn-yellow');
    const ctaHref = ctaBtn ? ctaBtn.getAttribute('href') : '/free-website';
    const ctaText = ctaBtn ? ctaBtn.textContent.replace(/\s+/g, ' ').trim() : 'Get Free Website';

    // ── 4. Build mobile nav panel HTML ────────────────────────────────────
    const panel = document.createElement('nav');
    panel.className = 'mobile-nav-panel';
    panel.setAttribute('aria-label', 'Mobile navigation');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('id', 'mobileNavPanel');

    const linksHtml = navLinks.map(l =>
      `<li><a href="${l.href}">${l.text}</a></li>`
    ).join('');

    panel.innerHTML = `
      <ul class="mobile-nav-links">${linksHtml}</ul>
      <div class="mobile-nav-actions">
        <a href="${ctaHref}" class="btn btn-yellow">${ctaText} &rarr;</a>
        <a href="${signInHref}" class="mobile-signin-link">Sign In to Dashboard</a>
      </div>
    `;

    // Insert panel right after <header class="site-nav">
    const siteNav = document.querySelector('.site-nav');
    if (siteNav && siteNav.parentNode) {
      siteNav.parentNode.insertBefore(panel, siteNav.nextSibling);
    } else {
      document.body.insertBefore(panel, document.body.firstChild);
    }

    // ── 5. Position panel cleanly underneath sticky navbar ─────────────────
    function syncPanelPosition() {
      const navBottom = siteNav
        ? Math.max(0, Math.round(siteNav.getBoundingClientRect().bottom))
        : 64;
      panel.style.top = navBottom + 'px';
      panel.style.maxHeight = 'calc(100dvh - ' + navBottom + 'px)';
    }

    // ── 6. Toggle logic ───────────────────────────────────────────────────
    let isOpen = false;

    function openMenu() {
      syncPanelPosition();
      isOpen = true;
      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
      hamburger.classList.add('open');
      hamburger.setAttribute('aria-expanded', 'true');
      hamburger.setAttribute('aria-label', 'Close navigation menu');
    }

    function closeMenu() {
      isOpen = false;
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.setAttribute('aria-label', 'Open navigation menu');
    }

    hamburger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      isOpen ? closeMenu() : openMenu();
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (isOpen && !panel.contains(e.target) && !hamburger.contains(e.target)) {
        closeMenu();
      }
    });

    // Close on nav link click
    panel.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        closeMenu();
      });
    });

    // Keep panel glued beneath sticky navbar if user scrolls while menu is open
    window.addEventListener('scroll', function () {
      if (isOpen) syncPanelPosition();
    }, { passive: true });

    // Close on resize back to desktop
    window.addEventListener('resize', function () {
      if (window.innerWidth > 768 && isOpen) {
        closeMenu();
      } else if (isOpen) {
        syncPanelPosition();
      }
    });

    // ── 7. Escape key support ──────────────────────────────────────────────
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) closeMenu();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
