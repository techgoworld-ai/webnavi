const crypto = require('crypto');
const { getDb } = require('./db');

/**
 * Deterministic SHA-256 hash of a capability token.
 * Only the hash is persisted in SQLite.
 */
function hashToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Constant-time comparison of token hashes to mitigate timing attacks.
 */
function safeCompareHashes(hashA, hashB) {
  if (!hashA || !hashB || typeof hashA !== 'string' || typeof hashB !== 'string') return false;
  const bufA = Buffer.from(hashA, 'hex');
  const bufB = Buffer.from(hashB, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a cryptographically secure 256-bit capability token.
 */
function generateCapabilityToken() {
  return crypto.randomBytes(32).toString('hex');
}

class CustomerTokenService {
  constructor(customDb = null) {
    this.db = customDb || getDb();
    this._initTable();
  }

  _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS customer_tokens (
        customer_id TEXT NOT NULL,
        token_hash TEXT NOT NULL PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        description TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_customer_tokens_cid ON customer_tokens(customer_id);
    `);
  }

  /**
   * Generates a new 256-bit cryptographically secure capability token for a customer.
   * Stores ONLY the SHA-256 hash in SQLite.
   * Returns the raw token string once to the caller.
   */
  createCustomerToken(customerId, options = {}) {
    if (!customerId || typeof customerId !== 'string') {
      throw new Error('Valid customerId is required to generate customer token.');
    }

    const {
      expiresInDays = 30,
      description = 'Customer Portal Access Token',
      rawToken = null, // for testing or deterministic seeding
    } = options;

    const token = rawToken || generateCapabilityToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = expiresInDays
      ? new Date(now.getTime() + expiresInDays * 24 * 3600 * 1000).toISOString()
      : null;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO customer_tokens (
        customer_id, token_hash, created_at, expires_at, revoked_at, description
      ) VALUES (
        @customerId, @tokenHash, @createdAt, @expiresAt, NULL, @description
      )
    `);

    stmt.run({
      customerId: customerId.trim(),
      tokenHash,
      createdAt: now.toISOString(),
      expiresAt,
      description,
    });

    return token;
  }

  /**
   * Validates an incoming customer capability token against a specific customerId.
   * Strictly enforces:
   * - customerId itself is NEVER accepted as a token.
   * - orderId, email, or phone are NEVER accepted as a token.
   * - token must match the SHA-256 hash stored for that customer.
   * - token must not be revoked or expired.
   * - if the token belongs to a DIFFERENT customer, returns CROSS_CUSTOMER_FORBIDDEN (403).
   */
  validateCustomerToken(customerId, rawToken) {
    if (!rawToken || typeof rawToken !== 'string') {
      return { valid: false, reason: 'MISSING_TOKEN', status: 401 };
    }

    const cleanToken = rawToken.trim();

    // Critical Security Guard: Customer ID or public identifier must NEVER authorize access
    if (customerId && cleanToken.toLowerCase() === customerId.trim().toLowerCase()) {
      return {
        valid: false,
        reason: 'CUSTOMER_ID_NOT_A_SECRET',
        status: 401,
        message: 'A customer ID is a public identifier and cannot be used as an authentication credential.',
      };
    }

    // Minimum entropy check (64 hex characters = 32 bytes)
    if (cleanToken.length < 32) {
      return { valid: false, reason: 'INVALID_TOKEN_FORMAT', status: 401 };
    }

    const tokenHash = hashToken(cleanToken);

    // 1. Check if token exists for THIS customer
    const targetCustomerStmt = this.db.prepare(`
      SELECT * FROM customer_tokens WHERE customer_id = ? AND token_hash = ?
    `);
    const match = targetCustomerStmt.get(customerId.trim(), tokenHash);

    if (match) {
      // Check if revoked
      if (match.revoked_at) {
        return {
          valid: false,
          reason: 'TOKEN_REVOKED',
          status: 401,
          message: 'Customer capability token has been revoked.',
        };
      }

      // Check if expired
      if (match.expires_at && new Date(match.expires_at) < new Date()) {
        return {
          valid: false,
          reason: 'TOKEN_EXPIRED',
          status: 401,
          message: 'Customer capability token has expired.',
        };
      }

      return {
        valid: true,
        customerId: match.customer_id,
        createdAt: match.created_at,
      };
    }

    // 2. Check if token belongs to ANOTHER customer (Cross-customer attack / IDOR attempt)
    const anyCustomerStmt = this.db.prepare(`
      SELECT customer_id FROM customer_tokens WHERE token_hash = ?
    `);
    const otherCustomer = anyCustomerStmt.get(tokenHash);

    if (otherCustomer && otherCustomer.customer_id !== customerId.trim()) {
      return {
        valid: false,
        reason: 'CROSS_CUSTOMER_FORBIDDEN',
        status: 403,
        message: 'Forbidden: Access denied. Token does not belong to the requested customer record.',
      };
    }

    // 3. Token not found at all
    return {
      valid: false,
      reason: 'INVALID_TOKEN',
      status: 401,
      message: 'Invalid customer capability token.',
    };
  }

  /**
   * Revoke a specific customer token.
   */
  revokeToken(rawToken) {
    if (!rawToken) return false;
    const tokenHash = hashToken(rawToken);
    const stmt = this.db.prepare(`
      UPDATE customer_tokens SET revoked_at = ? WHERE token_hash = ?
    `);
    const res = stmt.run(new Date().toISOString(), tokenHash);
    return res.changes > 0;
  }

  /**
   * Revoke all tokens belonging to a customer.
   */
  revokeAllCustomerTokens(customerId) {
    if (!customerId) return 0;
    const stmt = this.db.prepare(`
      UPDATE customer_tokens SET revoked_at = ? WHERE customer_id = ? AND revoked_at IS NULL
    `);
    const res = stmt.run(new Date().toISOString(), customerId.trim());
    return res.changes;
  }
}

const customerTokenService = new CustomerTokenService();

module.exports = customerTokenService;
module.exports.CustomerTokenService = CustomerTokenService;
module.exports.hashToken = hashToken;
module.exports.safeCompareHashes = safeCompareHashes;
module.exports.generateCapabilityToken = generateCapabilityToken;

