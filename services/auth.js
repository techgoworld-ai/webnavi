const crypto = require('crypto');
const customerTokenService = require('./customerTokens');
const { hashToken, safeCompareHashes, generateCapabilityToken } = require('./customerTokens');

/**
 * Active admin sessions store (in-memory, tokenHash -> { createdAt, expiresAt })
 * 24-hour TTL with instant revocation upon logout.
 */
const activeAdminSessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function createAdminSession() {
  const rawToken = 'wn_adm_sess_' + crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  activeAdminSessions.set(tokenHash, {
    createdAt: Date.now(),
    expiresAt,
  });
  return rawToken;
}

function isValidAdminSession(rawToken) {
  if (typeof rawToken !== 'string' || !rawToken.trim()) return false;
  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  const session = activeAdminSessions.get(tokenHash);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    activeAdminSessions.delete(tokenHash);
    return false;
  }
  return true;
}

function revokeAdminSession(rawToken) {
  if (typeof rawToken !== 'string' || !rawToken.trim()) return;
  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  activeAdminSessions.delete(tokenHash);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getAdminUsername() {
  return (process.env.ADMIN_USERNAME || '').trim();
}

function getAdminPassword() {
  return (process.env.ADMIN_PASSWORD || '').trim();
}

function getAdminApiKey() {
  return (process.env.ADMIN_API_KEY || process.env.ADMIN_PASSWORD || '').trim();
}

function isValidAdminUsername(user) {
  if (typeof user !== 'string' || !user) return false;
  const configured = getAdminUsername();
  if (!configured) return false;
  return safeCompare(user, configured);
}

function isValidAdminPassword(pass) {
  if (typeof pass !== 'string' || !pass.trim()) return false;
  const clean = pass.trim();
  const configuredPass = getAdminPassword();
  const configuredKey = getAdminApiKey();
  if (!configuredPass && !configuredKey) return false; // Fail closed if unconfigured
  return (Boolean(configuredPass) && safeCompare(clean, configuredPass)) ||
         (Boolean(configuredKey) && safeCompare(clean, configuredKey));
}

/**
 * Checks whether an incoming Express request contains valid admin credentials
 * via HTTP Basic Auth, X-Admin-Key header, Bearer token, or secure HTTP-only session cookie.
 * 
 * STRICT SECURITY INVARIANT:
 * Query parameters (?key=...) are NEVER accepted for admin authentication.
 * Does not reject the request; returns boolean.
 */
function isAdminRequest(req) {
  if (!req) return false;

  // 1. Check HTTP Basic Auth
  const authHeader = req.headers && req.headers['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('basic ')) {
    try {
      const b64 = authHeader.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx !== -1) {
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
        if (isValidAdminUsername(user) && isValidAdminPassword(pass)) {
          return true;
        }
      }
    } catch (e) {
      // Malformed basic auth
    }
  }

  // 2. Check Bearer token (Authorization: Bearer <secret>)
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (isValidAdminPassword(token)) {
      return true;
    }
  }

  // 3. Check X-Admin-Key header
  const xAdminKey = req.headers && req.headers['x-admin-key'];
  if (xAdminKey && isValidAdminPassword(xAdminKey)) {
    return true;
  }

  // 4. Check Secure Session Cookie (wn_admin_token)
  const cookieHeader = req.headers && req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)wn_admin_token=([^;]+)/);
    if (match) {
      try {
        const cookieVal = decodeURIComponent(match[1].trim());
        if (isValidAdminSession(cookieVal) || isValidAdminPassword(cookieVal)) {
          return true;
        }
      } catch (e) {}
    }
  }

  // Query parameters are STRICTLY EXCLUDED.
  return false;
}

/**
 * Express middleware requiring admin authentication.
 * Responds with HTTP 401 and WWW-Authenticate header if unauthenticated.
 */
function adminAuth(req, res, next) {
  if (isAdminRequest(req)) {
    req.isAdmin = true;
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="WebNavi Admin Portal"');
  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Admin authentication required.',
    code: 'UNAUTHORIZED',
  });
}

/**
 * Mask an email address to protect customer privacy in public endpoints.
 * Example: 'vikram@artisanspice.in' -> 'v***m@artisanspice.in'
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***@***';
  const [user, domain] = parts;
  const maskedUser = user.length <= 2 ? user[0] + '***' : user[0] + '***' + user[user.length - 1];
  return `${maskedUser}@${domain}`;
}

/**
 * Mask a phone number to protect customer privacy in public endpoints.
 * Example: '+91.9876543210' -> '+91.******3210'
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const clean = phone.trim();
  if (clean.length <= 6) return '****';
  return clean.slice(0, 4) + '******' + clean.slice(-4);
}

/**
 * Mask a person's name for privacy in unauthenticated endpoints.
 */
function maskName(name) {
  if (!name || typeof name !== 'string') return '';
  const clean = name.trim();
  if (clean.length <= 2) return clean[0] + '*';
  return clean[0] + '***' + clean.slice(-1);
}

/**
 * Sanitizes registrant details for unauthenticated / public viewing.
 * Masks email, phone, last name, and removes exact street address and postal code.
 */
function sanitizeRegistrantForPublic(registrant) {
  if (!registrant || typeof registrant !== 'object') return {};
  return {
    firstName: registrant.firstName || '',
    lastName: maskName(registrant.lastName),
    email: maskEmail(registrant.email),
    phone: maskPhone(registrant.phone),
    city: registrant.city || '',
    state: registrant.state || '',
    country: registrant.country || '',
    postalCode: '[Redacted]',
    address1: '[Redacted for privacy]',
    address2: null,
    orgName: registrant.orgName || null,
    registrantType: registrant.registrantType || null,
    isRedacted: true,
  };
}

/**
 * Verifies whether the request possesses valid customer ownership or admin rights.
 *
 * CRITICAL SECURITY PRINCIPLE:
 * - A customerId or orderId is a public identifier and can NEVER be treated as a secret authentication credential.
 * - Customer capability tokens must be cryptographically generated (256-bit entropy).
 * - Tokens are hashed with SHA-256 and verified against SQLite records.
 * - Cross-customer access attempts return HTTP 403 Forbidden.
 *
 * Priority is given to secure HTTP headers (X-Customer-Token, X-Order-Token, Authorization: Bearer)
 * over URL parameters.
 *
 * @param {Object} req Express request
 * @param {string} customerId Expected customer ID
 * @param {Object} [order] Optional order record being accessed
 * @returns {{ authorized: boolean, reason?: string, status?: number, isAdmin?: boolean, message?: string }}
 */
function verifyCustomerOwnership(req, customerId, order = null) {
  // 1. Admin always authorized
  if (isAdminRequest(req)) {
    return { authorized: true, isAdmin: true };
  }

  const targetCustomerId = customerId || (order && order.customerId);

  // 1.5. Authenticated Customer Session Verification (HttpOnly wn_customer_session)
  let sessionCustomer = req.customer || null;
  if (!sessionCustomer && req.headers && req.headers['cookie']) {
    const match = req.headers['cookie'].match(/(?:^|;\s*)wn_customer_session=([^;]+)/);
    if (match) {
      try {
        const customerStore = require('./customerStore');
        const session = customerStore.validateSession(decodeURIComponent(match[1].trim()));
        if (session) {
          sessionCustomer = session.customer || session;
        }
      } catch (e) {}
    }
  }

  if (sessionCustomer && targetCustomerId) {
    if (sessionCustomer.id.toLowerCase() === targetCustomerId.toLowerCase()) {
      return { authorized: true, customerId: targetCustomerId, sessionCustomer };
    } else {
      return {
        authorized: false,
        reason: 'CROSS_CUSTOMER_FORBIDDEN',
        status: 403,
        message: 'Forbidden: Cross-customer access denied. You do not have permission to access records belonging to another customer.',
      };
    }
  }

  // 2. Gather candidate tokens supplied by caller (headers preferred over query)
  const candidateTokens = [];

  const xCustToken = req.headers && req.headers['x-customer-token'];
  if (typeof xCustToken === 'string' && xCustToken.trim()) {
    candidateTokens.push(xCustToken.trim());
  }

  const xOrderToken = req.headers && req.headers['x-order-token'];
  if (typeof xOrderToken === 'string' && xOrderToken.trim()) {
    candidateTokens.push(xOrderToken.trim());
  }

  const authHeader = req.headers && req.headers['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const bToken = authHeader.slice(7).trim();
    if (bToken) candidateTokens.push(bToken);
  }

  // Query parameter fallback (for direct browser <a> downloads)
  if (req.query && typeof req.query.token === 'string' && req.query.token.trim()) {
    candidateTokens.push(req.query.token.trim());
  }

  if (req.body && typeof req.body.token === 'string' && req.body.token.trim()) {
    candidateTokens.push(req.body.token.trim());
  }

  // Cookie support (e.g. wn_cust_token or wn_cust_token_<clientId>)
  const cookieHeader = req.headers && req.headers['cookie'];
  if (cookieHeader) {
    const custMatches = cookieHeader.matchAll(/(?:^|;\s*)wn_cust_token(?:_[^=]+)?=([^;]+)/g);
    for (const match of custMatches) {
      try {
        candidateTokens.push(decodeURIComponent(match[1].trim()));
      } catch (e) {}
    }
  }

  // If no token was supplied at all
  if (candidateTokens.length === 0) {
    return {
      authorized: false,
      reason: 'NO_TOKEN',
      status: 401,
      message: 'Authorization capability token required.',
    };
  }

  // Evaluate candidate tokens
  for (const token of candidateTokens) {
    // Check 1: Explicit rejection of public identifiers used as tokens
    if (targetCustomerId && token.toLowerCase() === targetCustomerId.toLowerCase()) {
      return {
        authorized: false,
        reason: 'CUSTOMER_ID_NOT_A_SECRET',
        status: 401,
        message: 'A customer ID is a public identifier and cannot be used as an authentication credential.',
      };
    }
    if (order && token.toLowerCase() === order.orderId.toLowerCase()) {
      return {
        authorized: false,
        reason: 'ORDER_ID_NOT_A_SECRET',
        status: 401,
        message: 'An order ID is a public identifier and cannot be used as an authentication credential.',
      };
    }

    // Check 2: Customer capability token verification via SQLite token hash lookup
    if (targetCustomerId) {
      const custResult = customerTokenService.validateCustomerToken(targetCustomerId, token);
      if (custResult.valid) {
        return { authorized: true, customerId: targetCustomerId };
      }
      if (custResult.reason === 'CROSS_CUSTOMER_FORBIDDEN') {
        return {
          authorized: false,
          reason: 'CROSS_CUSTOMER_FORBIDDEN',
          status: 403,
          message: custResult.message,
        };
      }
      if (custResult.reason === 'TOKEN_EXPIRED' || custResult.reason === 'TOKEN_REVOKED') {
        return {
          authorized: false,
          reason: custResult.reason,
          status: 401,
          message: custResult.message,
        };
      }
    }

    // Check 3: Order-specific capability token verification via SQLite order_token_hash
    if (order) {
      const orderStore = require('./orderStore');
      if (orderStore.validateOrderToken(order.orderId, token)) {
        return { authorized: true, orderId: order.orderId };
      }
    }
  }

  // A token was supplied, but failed validation
  return {
    authorized: false,
    reason: 'INVALID_TOKEN',
    status: 401,
    message: 'Invalid or unrecognized capability token.',
  };
}

module.exports = {
  getAdminUsername,
  getAdminPassword,
  getAdminApiKey,
  safeCompare,
  isValidAdminUsername,
  isValidAdminPassword,
  createAdminSession,
  isValidAdminSession,
  revokeAdminSession,
  isAdminRequest,
  adminAuth,
  maskEmail,
  maskPhone,
  maskName,
  sanitizeRegistrantForPublic,
  verifyCustomerOwnership,
  hashToken,
  safeCompareHashes,
  generateCapabilityToken,
};
