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

    // ── 1. Build hamburger button ──────────────────────────────────────────
    const hamburger = document.createElement('button');
    hamburger.className = 'hamburger-btn';
    hamburger.setAttribute('aria-label', 'Open navigation menu');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('type', 'button');
    hamburger.innerHTML = '<span></span><span></span><span></span>';
    navActions.appendChild(hamburger);

    // ── 2. Collect nav links from existing desktop nav ─────────────────────
    const desktopNavUl = document.querySelector('.nav-links');
    const links = desktopNavUl
      ? Array.from(desktopNavUl.querySelectorAll('a')).map(a => ({
          href: a.getAttribute('href'),
          text: a.textContent.trim(),
          style: a.getAttribute('style') || '',
        }))
      : [];

    // Fallback links if none found
    const defaultLinks = [
      { href: '/', text: 'Home', style: '' },
      { href: '/#how-it-works', text: 'How It Works', style: '' },
      { href: '/#the-math', text: 'Why Free', style: '' },
      { href: '/blog', text: 'Blog', style: 'color:#00e599;font-weight:700;' },
      { href: '/#faq', text: 'FAQ', style: '' },
    ];
    const navLinks = links.length > 0 ? links : defaultLinks;

    // ── 3. Detect Sign In link in desktop nav actions ──────────────────────
    const signInEl = document.getElementById('navCustomerLink')
      || document.querySelector('.nav-actions a[href="/login"]');
    const signInHref = signInEl ? signInEl.getAttribute('href') : '/login';

    // Detect Get Free Website button
    const ctaBtn = document.querySelector('.nav-actions .btn-yellow, .nav-actions .btn.btn-yellow');
    const ctaHref = ctaBtn ? ctaBtn.getAttribute('href') : '/free-website';
    const ctaText = ctaBtn ? ctaBtn.textContent.trim() : 'Get Free Website';

    // ── 4. Build mobile nav panel HTML ────────────────────────────────────
    const panel = document.createElement('nav');
    panel.className = 'mobile-nav-panel';
    panel.setAttribute('aria-label', 'Mobile navigation');
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

    // ── 5. Toggle logic ───────────────────────────────────────────────────
    let isOpen = false;

    function openMenu() {
      isOpen = true;
      panel.classList.add('open');
      hamburger.classList.add('open');
      hamburger.setAttribute('aria-expanded', 'true');
      hamburger.setAttribute('aria-label', 'Close navigation menu');
      document.body.classList.add('nav-open');
    }

    function closeMenu() {
      isOpen = false;
      panel.classList.remove('open');
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.setAttribute('aria-label', 'Open navigation menu');
      document.body.classList.remove('nav-open');
    }

    hamburger.addEventListener('click', function (e) {
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

    // Close on resize back to desktop
    window.addEventListener('resize', function () {
      if (window.innerWidth > 768 && isOpen) closeMenu();
    });

    // ── 6. Escape key support ──────────────────────────────────────────────
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) closeMenu();
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
