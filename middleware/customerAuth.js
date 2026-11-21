/**
 * Customer Authentication & Rate Limiting Middleware
 * 
 * Strict Invariants:
 * - Separates customer authentication from admin authentication completely
 * - Reads HttpOnly session cookie 'wn_customer_session' or Bearer token
 * - Attaches authenticated customer object to req.customer
 * - Rate limits authentication attempts to protect against brute-force
 */

const customerStore = require('../services/customerStore');

// In-memory rate limiting map: key -> { count, resetTime }
const rateLimitMap = new Map();

// Periodic cleanup of expired rate limit entries every 10 minutes to prevent memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitMap.entries()) {
      if (now > record.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }, 10 * 60 * 1000).unref();
}

function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, message = 'Too many requests. Please try again later.' }) {
  return (req, res, next) => {
    const ip = req.ip || (req.socket ? req.socket.remoteAddress : '') || 'unknown';
    const key = `${ip}_${req.path}`;
    const now = Date.now();

    const record = rateLimitMap.get(key) || { count: 0, resetTime: now + windowMs };

    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
      rateLimitMap.set(key, record);
      return next();
    }

    record.count++;
    rateLimitMap.set(key, record);

    if (record.count > max) {
      const waitSeconds = Math.ceil((record.resetTime - now) / 1000);
      return res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMITED',
        retryAfterSeconds: waitSeconds,
      });
    }

    next();
  };
}

/**
 * Parses customer session token from HTTP-only cookie or Authorization header.
 */
function extractCustomerSessionToken(req) {
  if (!req) return null;

  // 1. Check HTTP-only cookie 'wn_customer_session'
  const cookieHeader = req.headers && req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)wn_customer_session=([^;]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1].trim());
      } catch (e) {}
    }
  }

  // 2. Check Bearer token (Authorization: Bearer <token>)
  const authHeader = req.headers && req.headers['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

/**
 * Mandatory customer authentication middleware.
 * Rejects with 401 if unauthenticated.
 */
function requireCustomerAuth(req, res, next) {
  const token = extractCustomerSessionToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Customer authentication required. Please sign in.',
      code: 'UNAUTHORIZED',
    });
  }

  const customer = customerStore.validateSession(token);
  if (!customer) {
    return res.status(401).json({
      success: false,
      error: 'Session expired or invalid. Please sign in again.',
      code: 'SESSION_EXPIRED',
    });
  }

  req.customer = customer;
  req.customerSessionToken = token;
  next();
}

/**
 * Optional customer authentication middleware.
 * Attaches req.customer if valid, but does not reject if absent.
 */
function optionalCustomerAuth(req, res, next) {
  const token = extractCustomerSessionToken(req);
  if (token) {
    const customer = customerStore.validateSession(token);
    if (customer) {
      req.customer = customer;
      req.customerSessionToken = token;
    }
  }
  next();
}

module.exports = {
  requireCustomerAuth,
  optionalCustomerAuth,
  extractCustomerSessionToken,
  rateLimit,
};

