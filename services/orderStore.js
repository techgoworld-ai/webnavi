const crypto = require('crypto');
const { getDb } = require('./db');
const customerTokenService = require('./customerTokens');
const { hashToken, safeCompareHashes, generateCapabilityToken } = require('./customerTokens');

/**
 * WebNavi Domain Order Storage (SQLite Persisted)
 * Manages orders and concurrent locking with SQLite storage.
 * Only SHA-256 hashes of capability tokens are persisted.
 */
class OrderStore {
  constructor(customDb = null) {
    this.db = customDb || getDb();
    this.locks = new Map(); // in-memory short-lived mutex (60s TTL)
    if (process.env.SEED_DEMO_DATA === 'true') {
      this._seedDemoOrder();
    }
  }

  _seedDemoOrder() {
    const orderId = 'ORD-WN-84920';
    const existing = this.getOrderById(orderId);
    if (existing) return;

    const demoCustomerId = 'wn84920-demo-artisan';
    const demoCustomerToken = 'demo-customer-capability-token-84920';
    const demoOrderToken = 'demo-order-capability-token-84920';

    try {
      customerTokenService.createCustomerToken(demoCustomerId, {
        rawToken: demoCustomerToken,
        description: 'Demo Artisan Spice Co. Portal Token',
      });
    } catch (e) {
      // ignore if already seeded
    }

    const now = new Date(Date.now() - 24 * 3600 * 1000); // 1 day ago
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const demo = {
      orderId,
      customerId: demoCustomerId,
      ticketId: 'WN-84920',
      domain: 'theartisanspice.com',
      tld: '.com',
      registrant: {
        firstName: 'Vikram',
        lastName: 'Malhotra',
        email: 'vikram@artisanspice.in',
        phone: '+91.9876543210',
        address1: 'Plot 42, Hinjewadi Phase 1',
        address2: 'Near Tech Park',
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411057',
        country: 'IN',
        orgName: 'The Artisan Spice Co.',
        registrantType: 'Individual',
      },
      regPeriodYears: 1,
      regPrice: 849.00,
      renewPrice: 1049.00,
      taxAmount: 0.00,
      taxNote: 'At-cost registry wholesale fee (Taxes zero-rated by registry)',
      totalAmount: 849.00,
      currency: 'INR',
      paymentStatus: 'PAID',
      paymentMethod: 'Advance Deposit Allocation',
      status: 'ACTIVE',
      dnsStatus: 'PENDING_APPROVAL',
      registrarRef: 'HI-DOM-731-84920',
      zoneId: 'cf-zone-84920-artisan',
      nameservers: ['amy.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      createdAt: now.toISOString(),
      registeredAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastSyncedAt: new Date().toISOString(),
      idempotencyKey: 'idemp-wn-84920-demo',
      orderTokenHash: hashToken(demoOrderToken),
      logs: [
        {
          timestamp: now.toISOString(),
          status: 'ACTIVE',
          message: 'Domain theartisanspice.com registered via HostyIndia gateway. Status: Active.',
        },
      ],
    };

    this._insertOrder(demo);
  }

  _deserialize(row) {
    if (!row) return null;
    return {
      orderId: row.order_id,
      customerId: row.customer_id,
      ticketId: row.ticket_id,
      domain: row.domain,
      tld: row.tld,
      registrant: row.registrant_json ? JSON.parse(row.registrant_json) : {},
      regPeriodYears: row.reg_period_years,
      regPrice: row.reg_price,
      renewPrice: row.renew_price,
      taxAmount: row.tax_amount,
      taxNote: row.tax_note,
      totalAmount: row.total_amount,
      currency: row.currency,
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
      status: row.status,
      dnsStatus: row.dns_status || (row.zone_id ? (row.status === 'ACTIVE' ? 'PENDING_APPROVAL' : 'NOT_STARTED') : 'NOT_STARTED'),
      registrarRef: row.registrar_ref,
      zoneId: row.zone_id,
      nameservers: row.nameservers_json ? JSON.parse(row.nameservers_json) : [],
      createdAt: row.created_at,
      registeredAt: row.registered_at,
      expiresAt: row.expires_at,
      lastSyncedAt: row.last_synced_at,
      idempotencyKey: row.idempotency_key,
      orderTokenHash: row.order_token_hash || (row.secret_token ? hashToken(row.secret_token) : null),
      logs: row.logs_json ? JSON.parse(row.logs_json) : [],
    };
  }

  _insertOrder(order) {
    const stmt = this.db.prepare(`
      INSERT INTO orders (
        order_id, customer_id, ticket_id, domain, tld, registrant_json,
        reg_period_years, reg_price, renew_price, tax_amount, tax_note,
        total_amount, currency, payment_status, payment_method, status, dns_status,
        registrar_ref, zone_id, nameservers_json, created_at, registered_at,
        expires_at, last_synced_at, idempotency_key, logs_json, order_token_hash
      ) VALUES (
        @orderId, @customerId, @ticketId, @domain, @tld, @registrantJson,
        @regPeriodYears, @regPrice, @renewPrice, @taxAmount, @taxNote,
        @totalAmount, @currency, @paymentStatus, @paymentMethod, @status, @dnsStatus,
        @registrarRef, @zoneId, @nameserversJson, @createdAt, @registeredAt,
        @expiresAt, @lastSyncedAt, @idempotencyKey, @logsJson, @orderTokenHash
      )
    `);

    stmt.run({
      orderId: order.orderId,
      customerId: order.customerId,
      ticketId: order.ticketId,
      domain: order.domain,
      tld: order.tld,
      registrantJson: JSON.stringify(order.registrant || {}),
      regPeriodYears: order.regPeriodYears || 1,
      regPrice: order.regPrice || 0,
      renewPrice: order.renewPrice || 0,
      taxAmount: order.taxAmount || 0,
      taxNote: order.taxNote || '',
      totalAmount: order.totalAmount || 0,
      currency: order.currency || 'INR',
      paymentStatus: order.paymentStatus || 'PENDING',
      paymentMethod: order.paymentMethod || 'Reseller Wallet Allocation',
      status: order.status || 'PENDING',
      dnsStatus: order.dnsStatus || 'NOT_STARTED',
      registrarRef: order.registrarRef || null,
      zoneId: order.zoneId || null,
      nameserversJson: JSON.stringify(order.nameservers || []),
      createdAt: order.createdAt || new Date().toISOString(),
      registeredAt: order.registeredAt || null,
      expiresAt: order.expiresAt || null,
      lastSyncedAt: order.lastSyncedAt || null,
      idempotencyKey: order.idempotencyKey || null,
      logsJson: JSON.stringify(order.logs || []),
      orderTokenHash: order.orderTokenHash || null,
    });
  }

  acquireLock(key) {
    const existing = this.locks.get(key);
    const now = Date.now();
    if (existing && now - existing < 60000) {
      return false; // Locked
    }
    this.locks.set(key, now);
    return true;
  }

  releaseLock(key) {
    this.locks.delete(key);
  }

  createOrder({
    customerId = null,
    ticketId = null,
    domain,
    registrant,
    regPeriodYears = 1,
    regPrice,
    renewPrice,
    taxAmount = 0,
    taxNote = '',
    totalAmount,
    currency = 'INR',
    paymentStatus = 'PENDING',
    paymentMethod = 'Reseller Wallet Allocation',
    idempotencyKey = null,
    nameservers = [],
    zoneId = null,
    dnsStatus = 'NOT_STARTED',
    orderToken = null,
  }) {
    const cleanDomain = domain.trim().toLowerCase();
    const orderId = 'ORD-WN-' + Math.floor(10000 + Math.random() * 90000);
    const now = new Date();
    const rawOrderToken = orderToken || generateCapabilityToken();
    const orderTokenHash = hashToken(rawOrderToken);

    const order = {
      orderId,
      customerId: customerId || ('cust-' + crypto.randomBytes(4).toString('hex')),
      ticketId: ticketId || ('WN-' + Math.floor(10000 + Math.random() * 90000)),
      domain: cleanDomain,
      tld: '.' + cleanDomain.split('.').pop(),
      orderToken: rawOrderToken,
      orderTokenHash,
      registrant: {
        firstName: (registrant.firstName || '').trim(),
        lastName: (registrant.lastName || '').trim(),
        email: (registrant.email || '').trim().toLowerCase(),
        phone: (registrant.phone || '').trim(),
        address1: (registrant.address1 || '').trim(),
        address2: (registrant.address2 || '').trim(),
        city: (registrant.city || '').trim(),
        state: (registrant.state || '').trim(),
        postalCode: (registrant.postalCode || '').trim(),
        country: (registrant.country || 'IN').trim().toUpperCase(),
        orgName: (registrant.orgName || '').trim(),
        registrantType: registrant.registrantType || 'Individual',
      },
      regPeriodYears: parseInt(regPeriodYears, 10) || 1,
      regPrice: Number(regPrice),
      renewPrice: Number(renewPrice),
      taxAmount: Number(taxAmount) || 0,
      taxNote: taxNote || 'Wholesale registrar quote (Taxes zero-rated or pending registrar reconciliation)',
      totalAmount: Number(totalAmount),
      currency: currency || 'INR',
      paymentStatus,
      paymentMethod,
      status: 'PENDING',
      dnsStatus: dnsStatus || 'NOT_STARTED',
      registrarRef: null,
      zoneId: zoneId || null,
      nameservers: (Array.isArray(nameservers) && nameservers.length > 0) ? nameservers : [],
      createdAt: now.toISOString(),
      registeredAt: null,
      expiresAt: null,
      lastSyncedAt: null,
      idempotencyKey: idempotencyKey || ('idemp-' + crypto.randomBytes(8).toString('hex')),
      logs: [
        {
          timestamp: now.toISOString(),
          status: 'PENDING',
          message: `Order created for ${cleanDomain}. Amount: ${currency} ${totalAmount}. Waiting for confirmation and registry execution.`,
        },
      ],
    };

    this._insertOrder(order);
    return order;
  }

  getOrderById(orderId) {
    if (!orderId) return null;
    const row = this.db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
    return this._deserialize(row);
  }

  getOrderByDomain(domain) {
    if (!domain) return null;
    const clean = domain.trim().toLowerCase();
    const row = this.db.prepare('SELECT * FROM orders WHERE LOWER(domain) = ? ORDER BY created_at DESC LIMIT 1').get(clean);
    return this._deserialize(row);
  }

  getOrdersByCustomerId(customerId) {
    if (!customerId) return [];
    const rows = this.db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
    return rows.map((r) => this._deserialize(r));
  }

  getAllOrders() {
    const rows = this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    return rows.map((r) => this._deserialize(r));
  }

  updateOrder(orderId, updates) {
    const existing = this.getOrderById(orderId);
    if (!existing) return null;

    const merged = { ...existing, ...updates };

    const stmt = this.db.prepare(`
      UPDATE orders SET
        customer_id = @customerId,
        ticket_id = @ticketId,
        domain = @domain,
        tld = @tld,
        registrant_json = @registrantJson,
        reg_period_years = @regPeriodYears,
        reg_price = @regPrice,
        renew_price = @renewPrice,
        tax_amount = @taxAmount,
        tax_note = @taxNote,
        total_amount = @totalAmount,
        currency = @currency,
        payment_status = @paymentStatus,
        payment_method = @paymentMethod,
        status = @status,
        dns_status = @dnsStatus,
        registrar_ref = @registrarRef,
        zone_id = @zoneId,
        nameservers_json = @nameserversJson,
        registered_at = @registeredAt,
        expires_at = @expiresAt,
        last_synced_at = @lastSyncedAt,
        idempotency_key = @idempotencyKey,
        logs_json = @logsJson,
        order_token_hash = @orderTokenHash
      WHERE order_id = @orderId
    `);

    stmt.run({
      orderId,
      customerId: merged.customerId,
      ticketId: merged.ticketId,
      domain: merged.domain,
      tld: merged.tld,
      registrantJson: JSON.stringify(merged.registrant || {}),
      regPeriodYears: merged.regPeriodYears || 1,
      regPrice: merged.regPrice || 0,
      renewPrice: merged.renewPrice || 0,
      taxAmount: merged.taxAmount || 0,
      taxNote: merged.taxNote || '',
      totalAmount: merged.totalAmount || 0,
      currency: merged.currency || 'INR',
      paymentStatus: merged.paymentStatus || 'PENDING',
      paymentMethod: merged.paymentMethod || 'Reseller Wallet Allocation',
      status: merged.status || 'PENDING',
      dnsStatus: merged.dnsStatus || 'NOT_STARTED',
      registrarRef: merged.registrarRef || null,
      zoneId: merged.zoneId || null,
      nameserversJson: JSON.stringify(merged.nameservers || []),
      registeredAt: merged.registeredAt || null,
      expiresAt: merged.expiresAt || null,
      lastSyncedAt: merged.lastSyncedAt || null,
      idempotencyKey: merged.idempotencyKey || null,
      logsJson: JSON.stringify(merged.logs || []),
      orderTokenHash: merged.orderTokenHash || (merged.secretToken ? hashToken(merged.secretToken) : null),
    });

    return merged;
  }

  validateOrderToken(orderId, rawToken) {
    if (!orderId || !rawToken || typeof rawToken !== 'string') return false;
    const clean = rawToken.trim();

    const order = this.getOrderById(orderId);
    if (!order) return false;

    // Public identifiers (orderId, customerId, email, phone) can NEVER authenticate access
    if (clean.toLowerCase() === order.orderId.toLowerCase()) return false;
    if (order.customerId && clean.toLowerCase() === order.customerId.toLowerCase()) return false;
    if (order.registrant && order.registrant.email && clean.toLowerCase() === order.registrant.email.toLowerCase()) return false;
    if (order.registrant && order.registrant.phone && clean === order.registrant.phone.trim()) return false;

    if (!order.orderTokenHash) return false;
    const candidateHash = hashToken(clean);
    return safeCompareHashes(candidateHash, order.orderTokenHash);
  }

  addLog(orderId, status, message) {
    const existing = this.getOrderById(orderId);
    if (!existing) return null;

    const logs = existing.logs || [];
    logs.push({
      timestamp: new Date().toISOString(),
      status,
      message,
    });

    this.updateOrder(orderId, { logs });
    return this.getOrderById(orderId);
  }
}

const orderStore = new OrderStore();
module.exports = orderStore;
module.exports.OrderStore = OrderStore;
