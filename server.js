require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const domainRoutes = require('./routes/domains');
const orderRoutes = require('./routes/orders');
const adminOrderRoutes = require('./routes/adminOrders');
const dnsRoutes = require('./routes/dns');
const visitorTrackingRoutes = require('./routes/visitorTracking');
const adminVisitorRoutes = require('./routes/adminVisitors');
const { clientRouter: applicationRoutes, adminRouter: adminApplicationRoutes } = require('./routes/applications');
const customerRoutes = require('./routes/customer');
const projectStore = require('./services/projectStore');
const {
  adminAuth,
  isAdminRequest,
  isValidAdminUsername,
  isValidAdminPassword,
  createAdminSession,
  revokeAdminSession,
} = require('./services/auth');
const customerTokenService = require('./services/customerTokens');
const { startScheduledCleanup } = require('./services/analyticsCleanupScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * REVERSE PROXY & TRUSTED HOP CONFIGURATION:
 * Configures Express trust proxy strictly for trusted proxy hops.
 * 
 * Never blindly trust arbitrary X-Forwarded-For headers from public networks.
 * - TRUST_PROXY='loopback, linklocal, uniquelocal' (default: trusts reverse proxies on localhost, private cloud subnets/VPCs)
 * - TRUST_PROXY='1' (if placed directly behind a single reverse proxy or Cloudflare tunnel)
 * - TRUST_PROXY='false' (if deployed directly without reverse proxy)
 */
const trustProxyConfig = (() => {
  const raw = (process.env.TRUST_PROXY || '').trim();
  if (!raw) return 'loopback, linklocal, uniquelocal';
  if (raw === 'true') return 'loopback, linklocal, uniquelocal';
  if (raw === 'false') return false;
  const num = parseInt(raw, 10);
  if (!isNaN(num)) return num;
  return raw;
})();
app.set('trust proxy', trustProxyConfig);

// Initialize background analytics retention cleanup scheduler
startScheduledCleanup();

// Permissive CORS middleware for local development / testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Body parsing middleware
app.use(express.json());

// Admin Login API (authenticates against environment variables and issues secure HTTP-only session cookie)
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (isValidAdminUsername(username) && isValidAdminPassword(password)) {
    const sessionToken = createAdminSession();
    res.cookie('wn_admin_token', sessionToken, {
      path: '/',
      sameSite: 'lax',
      maxAge: 24 * 3600 * 1000, // 24 hours
      httpOnly: true, // Immune to JavaScript access (prevents XSS exfiltration)
      secure: process.env.NODE_ENV === 'production',
    });
    return res.json({ success: true, message: 'Admin authentication successful.' });
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid admin username or password.',
    code: 'UNAUTHORIZED',
  });
});

// Admin Logout API (revokes active session in memory and clears HTTP-only cookie)
app.all('/api/admin/logout', (req, res) => {
  const cookieHeader = req.headers && req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)wn_admin_token=([^;]+)/);
    if (match) {
      try {
        revokeAdminSession(decodeURIComponent(match[1].trim()));
      } catch (e) {}
    }
  }

  res.clearCookie('wn_admin_token', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return res.redirect('/');
});

// Completely remove/disable admin web portal (returns standard 404 Not Found)
app.all(['/admin', '/admin.html'], (req, res) => {
  res.status(404).send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><pre>Cannot ' + req.method + ' ' + req.path + '</pre></body></html>');
});

// Serve static frontend assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Domain API routes
app.use('/api/domains', domainRoutes);

// Order & Registration API routes
app.use('/api/orders', orderRoutes);

// Cloudflare Authoritative DNS Management routes
app.use('/api/dns', dnsRoutes);

// Public Visitor Tracking & Consent routes
app.use('/api/tracking', visitorTrackingRoutes);

// Admin Visitor Management routes (strictly protected by adminAuth)
app.use('/api/admin/visitors', adminAuth, adminVisitorRoutes);

// Admin Domain & Wallet Management routes
app.use('/api/admin', adminOrderRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database-driven Dynamic Client Application & Project Lifecycle Routes
app.use('/api/applications', applicationRoutes);
app.use('/api/admin/applications', adminApplicationRoutes);

// Customer Account & Authentication Routes
app.use('/api/customer', customerRoutes);

// Customer Account Pages
app.get(['/login', '/login.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get(['/forgot-password', '/forgot-password.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

app.get(['/reset-password', '/reset-password.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.get(['/verify-email', '/verify-email.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify-email.html'));
});

app.get(['/verify-pending', '/verify-pending.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify-pending.html'));
});

app.get(['/customer/dashboard', '/customer/dashboard.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer', 'dashboard.html'));
});

// Unique client portal: serve application.html for valid clientId with secure capability token
app.get('/application/:clientId', (req, res) => {
  const { clientId } = req.params;
  let sessionToken = null;
  try {
    sessionToken = customerTokenService.createCustomerToken(clientId, { description: 'Portal Session' });
  } catch (e) {
    console.warn('[Portal Session] Token issuance notice:', e.message);
  }

  if (sessionToken) {
    res.cookie('wn_cust_token_' + clientId, sessionToken, {
      path: '/',
      sameSite: 'lax',
      maxAge: 30 * 24 * 3600 * 1000,
    });
  }
  res.sendFile(path.join(__dirname, 'public', 'application.html'));
});

// Dedicated route for Free Website landing page
app.get(['/free-website', '/free-website.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'free-website.html'));
});

// Privacy Policy & Terms of Service routes
app.get(['/privacy', '/privacy.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get(['/terms', '/terms.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// Redirect legacy /domains requests to free website
app.get(['/domains', '/domains.html'], (req, res) => {
  res.redirect('/free-website.html');
});

// Blog index & article routes
app.get(['/blog', '/blog/', '/blog/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blog', 'index.html'));
});

app.get('/blog/:slug', (req, res, next) => {
  const fs = require('fs');
  const slug = req.params.slug.replace(/\.html$/, '');
  const filePath = path.join(__dirname, 'public', 'blog', `${slug}.html`);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  next();
});

// Fallback to index.html for frontend navigation
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

// Centralized error-handling middleware (safe, no secret leakage)
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WebNavi server running at http://localhost:${PORT}`);
    const emailService = require('./services/emailService');
    emailService.logStartupReadiness();
  });
}

module.exports = app;

