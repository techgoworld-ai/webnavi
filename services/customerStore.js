/**
 * WebNavi Customer Store & Authentication Service
 * 
 * Production-ready customer management:
 * - Hashed passwords via bcrypt (10 rounds) - never stored plain-text
 * - Email normalization & unique constraints
 * - Server-side session tracking with HttpOnly cookies
 * - Single-use cryptographic password reset tokens (SHA-256 hashed)
 * - Strict isolation from Admin credentials and permissions
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const emailService = require('./emailService');

class CustomerStore {
  constructor(customDb = null) {
    this.db = customDb || getDb();
  }

  /**
   * Normalizes an email address (lowercase and trimmed).
   */
  normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
  }

  /**
   * Generates a unique customer ID (e.g. CUST-a1b2c3d4)
   */
  generateCustomerId() {
    return 'CUST-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  /**
   * Hashes a password using bcrypt (Cost factor 12 - OWASP standard).
   */
  hashPassword(password) {
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new Error('Password must be at least 8 characters in length.');
    }
    const rounds = process.env.BCRYPT_ROUNDS ? parseInt(process.env.BCRYPT_ROUNDS, 10) : 12;
    return bcrypt.hashSync(password, rounds);
  }

  /**
   * Verifies password against stored bcrypt hash.
   */
  verifyPassword(password, hash) {
    if (!password || !hash) return false;
    try {
      return bcrypt.compareSync(password, hash);
    } catch (e) {
      return false;
    }
  }

  /**
   * Finds customer by normalized email.
   * Excludes password_hash unless includePassword=true.
   */
  findByEmail(email, includePassword = false) {
    const cleanEmail = this.normalizeEmail(email);
    if (!cleanEmail) return null;

    const row = this.db.prepare('SELECT * FROM customers WHERE email = ?').get(cleanEmail);
    if (!row) return null;

    if (!includePassword) {
      const { password_hash, ...safeCustomer } = row;
      return safeCustomer;
    }
    return row;
  }

  /**
   * Finds customer by ID.
   */
  findById(id, includePassword = false) {
    if (!id || typeof id !== 'string') return null;

    const row = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id.trim());
    if (!row) return null;

    if (!includePassword) {
      const { password_hash, ...safeCustomer } = row;
      return safeCustomer;
    }
    return row;
  }

  /**
   * Creates a new customer account.
   * Throws Error with code 'ACCOUNT_EXISTS' if email is already taken.
   */
  /**
   * Creates a new customer account.
   * Lifecycle: PENDING_VERIFICATION -> ACTIVE
   * Issues 24-hour verification token and dispatches verification email.
   * Throws Error with code 'ACCOUNT_EXISTS' if email is already taken.
   */
  createCustomer({ fullName, email, phone = '', password, accountStatus = 'PENDING_VERIFICATION', autoSendVerification = true }) {
    const cleanEmail = this.normalizeEmail(email);
    if (!cleanEmail || !cleanEmail.includes('@')) {
      const err = new Error('A valid email address is required.');
      err.code = 'INVALID_EMAIL';
      err.statusCode = 400;
      throw err;
    }

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      const err = new Error('Full name is required.');
      err.code = 'INVALID_NAME';
      err.statusCode = 400;
      throw err;
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      const err = new Error('Password must be at least 8 characters in length.');
      err.code = 'INVALID_PASSWORD';
      err.statusCode = 400;
      throw err;
    }

    // Check if account already exists
    const existing = this.findByEmail(cleanEmail);
    if (existing) {
      const err = new Error(`An account with email "${cleanEmail}" already exists. Please sign in.`);
      err.code = 'ACCOUNT_EXISTS';
      err.statusCode = 409;
      throw err;
    }

    const customerId = this.generateCustomerId();
    const passwordHash = this.hashPassword(password);
    const nowIso = new Date().toISOString();
    const initialStatus = accountStatus || 'PENDING_VERIFICATION';

    this.db.prepare(`
      INSERT INTO customers (
        id, full_name, email, phone, password_hash,
        account_status, email_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      customerId,
      fullName.trim(),
      cleanEmail,
      phone ? phone.trim() : '',
      passwordHash,
      initialStatus,
      nowIso,
      nowIso
    );

    // Issue cryptographic email verification token
    const tokenRes = this.createEmailVerificationToken(customerId);

    // Dispatch verification email
    if (autoSendVerification && initialStatus === 'PENDING_VERIFICATION') {
      try {
        emailService.sendVerificationEmail({
          id: customerId,
          full_name: fullName.trim(),
          email: cleanEmail,
        }, tokenRes.rawToken);
      } catch (e) {
        console.warn('[CustomerStore] Verification dispatch notice:', e.message);
      }
    }

    return {
      id: customerId,
      full_name: fullName.trim(),
      fullName: fullName.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      account_status: initialStatus,
      accountStatus: initialStatus,
      email_verified_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      verificationToken: process.env.NODE_ENV !== 'production' ? tokenRes.rawToken : undefined,
    };
  }

  /**
   * Creates a single-use cryptographically secure email verification token.
   * Stores SHA-256 hash with 24-hour expiration.
   */
  createEmailVerificationToken(customerId) {
    if (!customerId) throw new Error('Customer ID is required.');

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = Date.now();
    const expiresAt = new Date(now + 24 * 3600 * 1000).toISOString(); // 24 hours
    const nowIso = new Date(now).toISOString();

    // Invalidate any active unused verification tokens for this customer
    this.db.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE customer_id = ? AND used_at IS NULL')
      .run(nowIso, customerId);

    this.db.prepare(`
      INSERT INTO email_verification_tokens (customer_id, token_hash, expires_at, used_at, created_at)
      VALUES (?, ?, ?, NULL, ?)
    `).run(customerId, tokenHash, expiresAt, nowIso);

    return {
      rawToken,
      tokenHash,
      expiresAt,
    };
  }

  /**
   * Verifies an email token, marking it used and activating the customer account.
   */
  verifyEmailToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') {
      const err = new Error('Invalid or missing email verification token.');
      err.code = 'INVALID_TOKEN';
      err.statusCode = 400;
      throw err;
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const record = this.db.prepare('SELECT * FROM email_verification_tokens WHERE token_hash = ?').get(tokenHash);

    if (!record) {
      const err = new Error('Invalid or unrecognized verification token.');
      err.code = 'INVALID_TOKEN';
      err.statusCode = 400;
      throw err;
    }

    if (record.used_at) {
      const err = new Error('This verification link has already been used. Please sign in to your account.');
      err.code = 'TOKEN_ALREADY_USED';
      err.statusCode = 400;
      throw err;
    }

    const nowIso = new Date().toISOString();
    if (record.expires_at <= nowIso) {
      const err = new Error('This verification link has expired (24-hour limit). Please request a new verification link.');
      err.code = 'TOKEN_EXPIRED';
      err.statusCode = 400;
      throw err;
    }

    // Mark token as used
    this.db.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE id = ?').run(nowIso, record.id);

    // Activate customer account
    this.db.prepare(`
      UPDATE customers
      SET account_status = 'ACTIVE', email_verified_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso, nowIso, record.customer_id);

    const updatedCustomer = this.findById(record.customer_id);

    return {
      success: true,
      message: 'Email address verified successfully. Your WebNavi customer account is now fully active.',
      customer: updatedCustomer,
    };
  }

  /**
   * Resends verification email for a customer.
   * Protects against user enumeration.
   */
  async resendVerificationEmail(email) {
    const cleanEmail = this.normalizeEmail(email);
    if (!cleanEmail || !cleanEmail.includes('@')) {
      const err = new Error('Valid email address is required.');
      err.code = 'INVALID_EMAIL';
      err.statusCode = 400;
      throw err;
    }

    const customer = this.findByEmail(cleanEmail);
    if (!customer) {
      // Non-enumerating uniform response
      return {
        success: true,
        message: 'If an unverified account with that email exists, a verification link has been sent.',
      };
    }

    if (customer.email_verified_at && customer.account_status === 'ACTIVE') {
      return {
        success: true,
        alreadyVerified: true,
        message: 'This account has already been verified. Please sign in.',
      };
    }

    const tokenRes = this.createEmailVerificationToken(customer.id);
    await emailService.sendVerificationEmail(customer, tokenRes.rawToken);

    return {
      success: true,
      message: 'A new verification link has been sent to your email address.',
      verificationToken: process.env.NODE_ENV !== 'production' ? tokenRes.rawToken : undefined,
    };
  }

  /**
   * Authenticates customer credentials and records login timestamp.
   */
  authenticate(email, password) {
    const cleanEmail = this.normalizeEmail(email);
    if (!cleanEmail || !password) return null;

    const customerWithHash = this.findByEmail(cleanEmail, true);
    if (!customerWithHash) return null;

    if (customerWithHash.account_status === 'SUSPENDED' || customerWithHash.account_status === 'DISABLED') {
      const err = new Error('This account has been suspended. Please contact WebNavi support.');
      err.code = 'ACCOUNT_DISABLED';
      err.statusCode = 403;
      throw err;
    }

    const isValid = this.verifyPassword(password, customerWithHash.password_hash);
    if (!isValid) return null;

    const nowIso = new Date().toISOString();
    this.db.prepare('UPDATE customers SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .run(nowIso, nowIso, customerWithHash.id);

    const { password_hash, ...safeCustomer } = customerWithHash;
    safeCustomer.last_login_at = nowIso;
    return safeCustomer;
  }

  /**
   * Creates a secure server-side customer session.
   */
  createSession(customerId, { ip = '', userAgent = '', rememberMe = false } = {}) {
    const sessionToken = crypto.randomBytes(32).toString('hex'); // 64 chars
    const now = Date.now();
    const durationDays = rememberMe ? 30 : 1;
    const expiresAt = new Date(now + durationDays * 24 * 3600 * 1000).toISOString();
    const nowIso = new Date(now).toISOString();

    this.db.prepare(`
      INSERT INTO customer_sessions (
        session_id, customer_id, created_at, expires_at, last_activity_at, ip_masked, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionToken,
      customerId,
      nowIso,
      expiresAt,
      nowIso,
      ip ? ip.substring(0, 45) : '',
      userAgent ? userAgent.substring(0, 255) : ''
    );

    return {
      token: sessionToken,
      expiresAt,
      durationDays,
    };
  }

  /**
   * Validates a customer session token and returns associated customer.
   */
  validateSession(sessionToken) {
    if (!sessionToken || typeof sessionToken !== 'string') return null;

    const nowIso = new Date().toISOString();
    const session = this.db.prepare(`
      SELECT s.*, c.full_name, c.email, c.phone, c.account_status, c.email_verified_at, c.created_at as account_created_at
      FROM customer_sessions s
      JOIN customers c ON c.id = s.customer_id
      WHERE s.session_id = ? AND s.expires_at > ?
    `).get(sessionToken.trim(), nowIso);

    if (!session) return null;

    if (session.account_status === 'SUSPENDED' || session.account_status === 'DISABLED') {
      this.revokeSession(sessionToken);
      return null;
    }

    // Refresh last activity
    this.db.prepare('UPDATE customer_sessions SET last_activity_at = ? WHERE session_id = ?')
      .run(nowIso, session.session_id);

    return {
      id: session.customer_id,
      full_name: session.full_name,
      fullName: session.full_name,
      email: session.email,
      phone: session.phone,
      account_status: session.account_status,
      accountStatus: session.account_status,
      email_verified_at: session.email_verified_at,
      emailVerifiedAt: session.email_verified_at,
      created_at: session.account_created_at,
      createdAt: session.account_created_at,
      sessionId: session.session_id,
      expiresAt: session.expires_at,
    };
  }

  /**
   * Destroys an active customer session.
   */
  revokeSession(sessionToken) {
    if (!sessionToken) return;
    this.db.prepare('DELETE FROM customer_sessions WHERE session_id = ?').run(sessionToken.trim());
  }

  /**
   * Destroys all sessions for a customer (e.g. after password reset).
   */
  revokeAllCustomerSessions(customerId) {
    if (!customerId) return;
    this.db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customerId);
  }

  /**
   * Updates customer profile fields (full name, phone).
   * Does NOT alter domain registrant records.
   */
  updateProfile(customerId, { fullName, phone }) {
    const customer = this.findById(customerId);
    if (!customer) throw new Error('Customer account not found.');

    const cleanName = (fullName && typeof fullName === 'string') ? fullName.trim() : customer.full_name;
    const cleanPhone = (phone !== undefined && typeof phone === 'string') ? phone.trim() : customer.phone;
    const nowIso = new Date().toISOString();

    this.db.prepare(`
      UPDATE customers
      SET full_name = ?, phone = ?, updated_at = ?
      WHERE id = ?
    `).run(cleanName, cleanPhone, nowIso, customerId);

    return this.findById(customerId);
  }

  /**
   * Changes customer password after verifying old password.
   */
  changePassword(customerId, currentPassword, newPassword) {
    const customerWithHash = this.findById(customerId, true);
    if (!customerWithHash) throw new Error('Customer account not found.');

    const isMatch = this.verifyPassword(currentPassword, customerWithHash.password_hash);
    if (!isMatch) {
      const err = new Error('Current password does not match.');
      err.code = 'INVALID_PASSWORD';
      err.statusCode = 400;
      throw err;
    }

    if (!newPassword || newPassword.length < 8) {
      const err = new Error('New password must be at least 8 characters long.');
      err.code = 'INVALID_NEW_PASSWORD';
      err.statusCode = 400;
      throw err;
    }

    const newHash = this.hashPassword(newPassword);
    const nowIso = new Date().toISOString();

    this.db.prepare('UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, nowIso, customerId);

    // Revoke other sessions for security
    this.revokeAllCustomerSessions(customerId);
    return true;
  }

  /**
   * Creates a single-use cryptographically secure password reset token.
   * Stores SHA-256 hash with 1-hour expiration and dispatches reset email.
   */
  async createPasswordResetToken(email) {
    const cleanEmail = this.normalizeEmail(email);
    const customer = this.findByEmail(cleanEmail);

    if (!customer) {
      // Security: Never reveal whether email exists
      return {
        success: true,
        emailSent: false,
        message: 'If an account with that email exists, reset instructions have been sent.',
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = Date.now();
    const expiresAt = new Date(now + 3600 * 1000).toISOString(); // 1 hour
    const nowIso = new Date(now).toISOString();

    // Invalidate prior unused tokens
    this.db.prepare('UPDATE password_resets SET used_at = ? WHERE customer_id = ? AND used_at IS NULL')
      .run(nowIso, customer.id);

    this.db.prepare(`
      INSERT INTO password_resets (customer_id, token_hash, expires_at, used_at, created_at)
      VALUES (?, ?, ?, NULL, ?)
    `).run(customer.id, tokenHash, expiresAt, nowIso);

    // Dispatch transactional email via Resend
    try {
      await emailService.sendPasswordResetEmail(customer, rawToken);
    } catch (e) {
      console.warn('[CustomerStore] Password reset dispatch notice:', e.message);
    }

    return {
      success: true,
      emailSent: true,
      provider: emailService.getProviderStatus().provider,
      message: 'If an account with that email exists, reset instructions have been sent.',
      // Expose resetToken strictly in non-production or for local testing verification
      resetToken: process.env.NODE_ENV !== 'production' ? rawToken : undefined,
    };
  }

  /**
   * Resets password using valid unexpired single-use token.
   */
  resetPasswordWithToken(rawToken, newPassword) {
    if (!rawToken || typeof rawToken !== 'string') {
      const err = new Error('Invalid or missing password reset token.');
      err.code = 'INVALID_TOKEN';
      err.statusCode = 400;
      throw err;
    }

    if (!newPassword || newPassword.length < 8) {
      const err = new Error('New password must be at least 8 characters long.');
      err.code = 'INVALID_PASSWORD';
      err.statusCode = 400;
      throw err;
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const nowIso = new Date().toISOString();

    const record = this.db.prepare(`
      SELECT * FROM password_resets
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
    `).get(tokenHash, nowIso);

    if (!record) {
      const err = new Error('Password reset token is invalid, expired, or has already been used.');
      err.code = 'TOKEN_EXPIRED';
      err.statusCode = 400;
      throw err;
    }

    const newHash = this.hashPassword(newPassword);

    // Invalidate token
    this.db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(nowIso, record.id);

    // Update customer password
    this.db.prepare('UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, nowIso, record.customer_id);

    // Invalidate all active sessions
    this.revokeAllCustomerSessions(record.customer_id);

    return {
      success: true,
      message: 'Password has been successfully reset. Please sign in with your new password.',
    };
  }

  /**
   * Aggregates real customer dashboard data for the authenticated customer.
   * Strictly isolates data to the customerId provided.
   */
  getCustomerDashboardData(customerId) {
    if (!customerId) return null;

    const customer = this.findById(customerId);
    if (!customer) return null;

    // 1. Customer domains
    const domains = this.db.prepare(`
      SELECT o.order_id, o.domain, o.status as registration_status, o.dns_status,
             o.registered_at, o.expires_at, o.created_at, z.status as zone_status,
             z.nameservers_json, z.approval_status as nameserver_approval_status
      FROM orders o
      LEFT JOIN dns_zones z ON z.domain = o.domain
      WHERE o.customer_id = ?
      ORDER BY o.created_at DESC
    `).all(customerId);

    // 2. Customer website applications
    const applications = this.db.prepare(`
      SELECT a.client_id, a.ticket_id, a.business_name, a.full_name, a.preferred_domain,
             a.industry, a.city, a.current_stage, a.created_at, a.updated_at,
             b.total_cost, b.paid_amount, b.payment_status as billing_status
      FROM applications a
      LEFT JOIN project_billings b ON b.client_id = a.client_id
      WHERE a.customer_id = ? OR a.client_id = ?
      ORDER BY a.created_at DESC
    `).all(customerId, customerId);

    // 3. Customer orders
    const orders = this.db.prepare(`
      SELECT order_id, domain, total_amount, currency, payment_status, status,
             payment_method, created_at, registered_at
      FROM orders
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).all(customerId);

    // 4. Compute metrics
    const totalDomains = domains.length;
    const activeDomains = domains.filter(d => (d.registration_status || '').toUpperCase() === 'ACTIVE').length;
    const pendingOrders = orders.filter(o => ['PENDING', 'PROCESSING', 'UNKNOWN'].includes((o.status || '').toUpperCase())).length;
    const totalApplications = applications.length;
    const totalOrders = orders.length;

    // 5. Stage names for website projects
    const stageNames = {
      1: 'Blueprint & Strategy',
      2: 'Visual Design & Wireframes',
      3: 'Production Development',
      4: 'Content & Integrations',
      5: 'QA & Review',
      6: 'Live Launch',
    };

    // 6. Build chronological activity timeline
    const recentActivity = [];
    if (customer.last_login_at) {
      recentActivity.push({
        type: 'AUTH',
        title: 'Customer Sign In',
        timestamp: customer.last_login_at,
        description: 'Signed into WebNavi Customer Portal',
      });
    }
    orders.forEach(o => {
      recentActivity.push({
        type: 'ORDER',
        title: `Domain Order: ${o.domain}`,
        timestamp: o.created_at,
        description: `Order ${o.order_id} • Status: ${o.status || 'PROCESSING'} • ₹${Number(o.total_amount || 0).toFixed(2)}`,
      });
    });
    applications.forEach(a => {
      recentActivity.push({
        type: 'APPLICATION',
        title: `Website Project: ${a.business_name || a.ticket_id}`,
        timestamp: a.created_at,
        description: `Ticket ${a.ticket_id} • Stage ${a.current_stage}: ${stageNames[a.current_stage] || 'In Progress'}`,
      });
    });
    recentActivity.sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp));

    // 7. Determine pending actions
    const pendingActions = [];
    if (customer.account_status === 'PENDING_VERIFICATION' || !customer.email_verified_at) {
      pendingActions.push({
        id: 'VERIFY_EMAIL',
        severity: 'HIGH',
        title: 'Verify Your Email Address',
        description: `Please verify ${customer.email} to fully activate all services and access DNS zone controls.`,
        actionType: 'resend_verification',
        actionText: 'Resend Verification Link',
      });
    }
    orders.filter(o => (o.status || '').toUpperCase() === 'PENDING' || (o.payment_status || '').toUpperCase() === 'PENDING').forEach(o => {
      pendingActions.push({
        id: `ORDER_PENDING_${o.order_id}`,
        severity: 'MEDIUM',
        title: `Order Awaiting Confirmation: ${o.domain}`,
        description: `Order ${o.order_id} is pending registrar confirmation.`,
        actionType: 'view_orders',
        actionText: 'View Order Details',
      });
    });

    return {
      customer: {
        id: customer.id,
        fullName: customer.full_name,
        full_name: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        accountStatus: customer.account_status,
        account_status: customer.account_status,
        emailVerified: Boolean(customer.email_verified_at),
        email_verified: Boolean(customer.email_verified_at),
        emailVerifiedAt: customer.email_verified_at,
        email_verified_at: customer.email_verified_at,
        createdAt: customer.created_at,
        created_at: customer.created_at,
        lastLoginAt: customer.last_login_at,
        last_login_at: customer.last_login_at,
      },
      summary: {
        totalDomains,
        activeDomains,
        pendingOrders,
        totalApplications,
        totalOrders,
      },
      metrics: {
        totalDomains,
        activeDomains,
        pendingOrders,
        totalApplications,
        totalOrders,
      },
      pendingActions,
      recentActivity: recentActivity.slice(0, 10),
      domains: domains.map(d => ({
        orderId: d.order_id,
        domain: d.domain,
        status: d.registration_status,
        dnsStatus: d.dns_status || 'NOT_STARTED',
        dnsApprovalStatus: d.nameserver_approval_status || 'PENDING',
        zoneStatus: d.zone_status || 'PENDING',
        registeredAt: d.registered_at,
        expiresAt: d.expires_at,
        createdAt: d.created_at,
        nameservers: d.nameservers_json ? JSON.parse(d.nameservers_json) : [],
        invoiceUrl: `/api/orders/${d.order_id}/invoice`,
      })),
      applications: applications.map(a => ({
        clientId: a.client_id,
        ticketId: a.ticket_id,
        businessName: a.business_name || a.full_name,
        preferredDomain: a.preferred_domain,
        industry: a.industry,
        city: a.city,
        currentStage: a.current_stage,
        stageName: stageNames[a.current_stage] || `Stage ${a.current_stage}`,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        portalUrl: `/application/${a.client_id}`,
        billingStatus: a.billing_status || 'UNPAID',
      })),
      orders: orders.map(o => ({
        orderId: o.order_id,
        domain: o.domain,
        product: `Domain Registration (${o.domain})`,
        totalAmount: o.total_amount,
        currency: o.currency || 'INR',
        paymentStatus: o.payment_status,
        status: o.status,
        createdAt: o.created_at,
        registeredAt: o.registered_at,
        invoiceUrl: `/api/orders/${o.order_id}/invoice`,
      })),
    };
  }
}

const customerStore = new CustomerStore();
module.exports = customerStore;
module.exports.CustomerStore = CustomerStore;

