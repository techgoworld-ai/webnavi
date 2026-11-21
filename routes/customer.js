/**
 * Customer Authentication & Dashboard API Routes
 */

const express = require('express');
const router = express.Router();
const customerStore = require('../services/customerStore');
const emailService = require('../services/emailService');
const { requireCustomerAuth } = require('../middleware/customerAuth');
const { dbRateLimit } = require('../middleware/rateLimiter');

// Database-backed persistent rate limiters
const loginLimiter = dbRateLimit({
  prefix: 'login',
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  message: 'Too many sign-in attempts. Please try again after 15 minutes.',
});
const resetLimiter = dbRateLimit({
  prefix: 'reset',
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  message: 'Too many password reset attempts. Please try again after 15 minutes.',
});
const verifyLimiter = dbRateLimit({
  prefix: 'verify',
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  message: 'Too many verification attempts. Please try again later.',
});
const resendLimiter = dbRateLimit({
  prefix: 'resend',
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  message: 'Too many resend verification requests. Please try again after 15 minutes.',
});
const changePasswordLimiter = dbRateLimit({
  prefix: 'chgpass',
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  message: 'Too many password change attempts. Please try again later.',
});
const profileLimiter = dbRateLimit({
  prefix: 'profile',
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 30 : 100,
  message: 'Too many profile update requests. Please try again later.',
});

/**
 * POST /api/customer/login
 * Customer Sign In
 */
router.post('/login', loginLimiter, (req, res) => {
  try {
    const { email, password, rememberMe = false } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.',
      });
    }

    const customer = customerStore.authenticate(email, password);
    if (!customer) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email address or password.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Create session
    const ip = req.ip || (req.socket ? req.socket.remoteAddress : '');
    const userAgent = req.headers['user-agent'] || '';
    const session = customerStore.createSession(customer.id, {
      ip,
      userAgent,
      rememberMe: Boolean(rememberMe),
    });

    // Set secure HTTP-only cookie
    res.cookie('wn_customer_session', session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: session.durationDays * 24 * 3600 * 1000,
    });

    res.json({
      success: true,
      message: 'Signed in successfully.',
      customer: {
        id: customer.id,
        fullName: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        lastLoginAt: customer.last_login_at,
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'An error occurred during authentication.',
    });
  }
});

/**
 * POST /api/customer/logout
 * Customer Sign Out
 */
router.post('/logout', (req, res) => {
  const cookieHeader = req.headers && req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)wn_customer_session=([^;]+)/);
    if (match) {
      try {
        const token = decodeURIComponent(match[1].trim());
        customerStore.revokeSession(token);
      } catch (e) {}
    }
  }

  // Clear cookie
  res.clearCookie('wn_customer_session', { path: '/' });
  res.json({ success: true, message: 'Signed out successfully.' });
});

/**
 * GET /api/customer/me
 * Retrieves current authenticated customer profile
 */
router.get('/me', requireCustomerAuth, (req, res) => {
  res.json({
    success: true,
    customer: {
      id: req.customer.id,
      fullName: req.customer.full_name,
      email: req.customer.email,
      phone: req.customer.phone,
      accountStatus: req.customer.account_status,
      createdAt: req.customer.created_at,
    },
  });
});

/**
 * PUT /api/customer/profile
 * Updates customer profile (name, phone)
 */
router.put('/profile', requireCustomerAuth, profileLimiter, (req, res) => {
  try {
    const { fullName, phone } = req.body || {};
    const updated = customerStore.updateProfile(req.customer.id, { fullName, phone });

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      customer: {
        id: updated.id,
        fullName: updated.full_name,
        email: updated.email,
        phone: updated.phone,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customer/change-password
 * Updates customer password
 */
router.post('/change-password', requireCustomerAuth, changePasswordLimiter, (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters in length.',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password and confirm password do not match.',
      });
    }

    customerStore.changePassword(req.customer.id, currentPassword, newPassword);

    // Re-issue new session for the current browser
    const ip = req.ip || (req.socket ? req.socket.remoteAddress : '');
    const userAgent = req.headers['user-agent'] || '';
    const newSession = customerStore.createSession(req.customer.id, { ip, userAgent });

    res.cookie('wn_customer_session', newSession.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 3600 * 1000,
    });

    res.json({
      success: true,
      message: 'Password updated successfully. Other active sessions have been revoked.',
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customer/forgot-password
 * Requests password reset token and dispatches reset email
 */
router.post('/forgot-password', resetLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required.' });
    }

    const result = await customerStore.createPasswordResetToken(email);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to process password reset request.' });
  }
});

/**
 * POST /api/customer/reset-password
 * Resets password using single-use token
 */
router.post('/reset-password', resetLimiter, (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body || {};

    if (!token) {
      return res.status(400).json({ success: false, error: 'Password reset token is required.' });
    }

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters in length.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }

    const result = customerStore.resetPasswordWithToken(token, newPassword);
    res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customer/verify-email
 * Verifies email ownership using single-use 24h cryptographic token
 */
router.post('/verify-email', verifyLimiter, (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Verification token is required.',
        code: 'MISSING_TOKEN',
      });
    }

    const result = customerStore.verifyEmailToken(token);
    res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Verification failed.',
      code: error.code || 'VERIFICATION_ERROR',
    });
  }
});

/**
 * GET /api/customer/verify-email
 * Query parameter verification helper for direct browser links
 */
router.get('/verify-email', verifyLimiter, (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.redirect('/verify-email?status=missing');
  }

  try {
    const result = customerStore.verifyEmailToken(token);
    return res.redirect('/verify-email?status=success');
  } catch (error) {
    const code = error.code || 'error';
    return res.redirect(`/verify-email?status=${encodeURIComponent(code)}`);
  }
});

/**
 * POST /api/customer/resend-verification
 * Resends verification email with user enumeration protection
 */
router.post('/resend-verification', resendLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required.',
        code: 'MISSING_EMAIL',
      });
    }

    const result = await customerStore.resendVerificationEmail(email);
    res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to resend verification link.',
      code: error.code || 'RESEND_ERROR',
    });
  }
});

/**
 * GET /api/customer/email-provider-status
 * Reports Resend integration status without exposing secrets
 */
router.get('/email-provider-status', (req, res) => {
  const status = emailService.getProviderStatus();
  res.json({ success: true, ...status });
});

/**
 * GET /api/customer/dashboard-data
 * Returns real aggregated data for the authenticated customer
 */
router.get('/dashboard-data', requireCustomerAuth, (req, res) => {
  try {
    const data = customerStore.getCustomerDashboardData(req.customer.id);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Customer data not found.' });
    }
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('[Customer Dashboard Error]', error.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve dashboard data.' });
  }
});

module.exports = router;
