const express = require('express');
const router = express.Router();
const hostyIndiaService = require('../services/hostyindia');
const pricingService = require('../services/pricingService');
const cloudflareService = require('../services/cloudflare');
const orderStore = require('../services/orderStore');
const dnsStore = require('../services/dnsStore');
const customerStore = require('../services/customerStore');
const emailService = require('../services/emailService');
const nameserverSync = require('../services/nameserverSync');
const { generateInvoicePdf } = require('../services/invoiceGenerator');
const customerTokenService = require('../services/customerTokens');
const { optionalCustomerAuth } = require('../middleware/customerAuth');
const {
  isAdminRequest,
  adminAuth,
  sanitizeRegistrantForPublic,
  verifyCustomerOwnership,
} = require('../services/auth');

/**
 * Validates registrant data according to ICANN registrar standards.
 * @param {Object} reg
 */
function validateRegistrant(reg) {
  const errors = [];
  if (!reg || typeof reg !== 'object') {
    return ['Registrant information is required.'];
  }

  if (!reg.firstName || !reg.firstName.trim()) errors.push('First name is required.');
  if (!reg.lastName || !reg.lastName.trim()) errors.push('Last name is required.');

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!reg.email || !emailRegex.test(reg.email.trim())) {
    errors.push('A valid email address is required.');
  }

  // Phone validation with country code (e.g., +91 98765 43210 or +91.9876543210 or +1.5551234567)
  const phoneRegex = /^\+?[0-9\s\-().]{8,20}$/;
  if (!reg.phone || !phoneRegex.test(reg.phone.trim())) {
    errors.push('A valid phone number including country code is required (e.g., +91 98765 43210).');
  }

  if (!reg.address1 || !reg.address1.trim()) errors.push('Address Line 1 is required.');
  if (!reg.city || !reg.city.trim()) errors.push('City is required.');
  if (!reg.state || !reg.state.trim()) errors.push('State / Province is required.');
  if (!reg.postalCode || !reg.postalCode.trim()) errors.push('Postal / ZIP code is required.');
  if (!reg.country || !reg.country.trim()) errors.push('Country is required.');

  return errors;
}

/**
 * POST /api/orders/quote
 * Pre-registration quote: checks live availability and live pricing from HostyIndia.
 * Also checks reseller wallet balance to know if funds are currently available.
 */
router.post('/quote', async (req, res, next) => {
  try {
    const { domain, years = 1 } = req.body || {};
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ success: false, error: 'Domain name is required.' });
    }

    const cleanDomain = domain.trim().toLowerCase();
    const regYears = Math.max(1, Math.min(10, parseInt(years, 10) || 1));

    // 1. Fetch live availability and wholesale price
    const availResult = await hostyIndiaService.checkDomainAvailability(cleanDomain);

    // 2. Fetch current wallet balance
    let wallet = null;
    try {
      wallet = await hostyIndiaService.getBalance();
    } catch (wErr) {
      console.warn('[Quote] Wallet balance check failed:', wErr.message);
    }

    const tld = availResult.tld || ('.' + cleanDomain.split('.').pop());
    const pricingConfig = pricingService.getTldPricing(tld);
    const regPrice = (pricingConfig && pricingConfig.retail_register != null) ? pricingConfig.retail_register : (availResult.price || 849.00);
    const renewPrice = (pricingConfig && pricingConfig.retail_renew != null) ? pricingConfig.retail_renew : (availResult.renew_price || 1049.00);
    const taxAmount = 0.00; // Zero-rated wholesale registry pass-through
    const totalAmount = regPrice;

    res.json({
      success: true,
      domain: cleanDomain,
      tld: availResult.tld,
      is_available: availResult.is_available,
      availability_status: availResult.availability_status,
      period_years: regYears,
      reg_price: regPrice,
      renew_price: renewPrice,
      wholesale_price: availResult.price || regPrice,
      wholesale_renew: availResult.renew_price || renewPrice,
      tax_amount: taxAmount,
      tax_note: 'Transparent wholesale pass-through registry quote',
      total_amount: totalAmount,
      currency: availResult.currency || 'INR',
      wallet_balance: wallet ? wallet.balance : null,
      wallet_sufficient: wallet ? wallet.balance >= (availResult.price || totalAmount) : null,
      message: availResult.message,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/checkout
 * Fully automated domain checkout:
 * 1. Validates registrant details.
 * 2. Re-verifies live availability & price.
 * 3. Verifies reseller wallet balance.
 * 4. Creates or retrieves Cloudflare DNS zone.
 * 5. Extracts assigned Cloudflare nameservers (never placeholders).
 * 6. Submits registration to HostyIndia with Cloudflare nameservers (ns1, ns2).
 * 7. Confirms registration, links zone & order in persistent storage.
 * 8. Initiates nameserver approval tracking with safe fallback.
 */
router.post('/checkout', optionalCustomerAuth, async (req, res, next) => {
  const {
    domain,
    years = 1,
    registrant,
    customerId,
    ticketId,
    confirmedAccuracy,
    idempotencyKey,
    accountPassword,
    password,
    confirmPassword,
    accountEmail,
    accountFullName,
    accountPhone,
  } = req.body || {};

  // 1. Validate domain
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({ success: false, error: 'A valid domain name is required.' });
  }
  const cleanDomain = domain.trim().toLowerCase();

  // 2. Validate confirmation
  if (!confirmedAccuracy) {
    return res.status(400).json({
      success: false,
      error: 'You must confirm that the submitted registrant information is accurate.',
    });
  }

  // 3. Validate registrant fields
  const regErrors = validateRegistrant(registrant);
  if (regErrors.length > 0) {
    return res.status(400).json({
      success: false,
      error: regErrors.join(' '),
      validationErrors: regErrors,
    });
  }

  // 3.5. Customer Account Resolution & Duplicate Email Guard
  let resolvedCustomerId = null;
  let customerAccountCreated = false;
  let targetEmail = (accountEmail || (registrant && registrant.email) || '').trim().toLowerCase();
  let targetFullName = (accountFullName || `${(registrant && registrant.firstName) || ''} ${(registrant && registrant.lastName) || ''}`).trim() || targetEmail;

  if (req.customer) {
    // Authenticated customer: link order directly to account
    resolvedCustomerId = req.customer.id;
    if (req.customer.email) targetEmail = req.customer.email.trim().toLowerCase();
    if (req.customer.full_name) targetFullName = req.customer.full_name;
  } else {
    const pwd = accountPassword || password;

    if (targetEmail) {
      const existingCust = customerStore.findByEmail(targetEmail);
      if (existingCust) {
        return res.status(409).json({
          success: false,
          error: 'An account with this email address already exists. Please sign in to link this domain purchase to your existing account.',
          code: 'ACCOUNT_EXISTS',
        });
      }

      if (pwd) {
        if (pwd.length < 8) {
          return res.status(400).json({
            success: false,
            error: 'Password must be at least 8 characters in length.',
            code: 'INVALID_PASSWORD',
          });
        }

        if (confirmPassword && pwd !== confirmPassword) {
          return res.status(400).json({
            success: false,
            error: 'Passwords do not match.',
            code: 'PASSWORD_MISMATCH',
          });
        }

        const fullName = targetFullName || targetEmail;
        const phone = accountPhone || (registrant && registrant.phone) || '';

        const newCust = customerStore.createCustomer({
          email: targetEmail,
          password: pwd,
          fullName,
          phone,
        });

        resolvedCustomerId = newCust.id;
        customerAccountCreated = true;

        // Issue session and cookie
        const ip = req.ip || (req.socket ? req.socket.remoteAddress : '');
        const userAgent = req.headers['user-agent'] || '';
        const session = customerStore.createSession(newCust.id, { ip, userAgent });

        res.cookie('wn_customer_session', session.token, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          maxAge: session.durationDays * 24 * 3600 * 1000,
        });
      }
    }

    if (!resolvedCustomerId) {
      resolvedCustomerId = customerId || ('cust-' + require('crypto').randomBytes(4).toString('hex'));
    }
  }

  // 4. Duplicate Registration & Reconciliation Guard
  const existingOrder = orderStore.getOrderByDomain(cleanDomain);
  if (existingOrder) {
    if (existingOrder.status === 'ACTIVE' || existingOrder.status === 'PROCESSING') {
      return res.status(409).json({
        success: false,
        error: `Domain "${cleanDomain}" already has an active order (${existingOrder.orderId}). Duplicate registration prevented.`,
        code: 'DUPLICATE_REGISTRATION',
        orderId: existingOrder.orderId,
      });
    }

    if (existingOrder.status === 'UNKNOWN') {
      return res.status(409).json({
        success: false,
        error: `Domain "${cleanDomain}" has an order awaiting reconciliation (${existingOrder.orderId}). Reconcile this order before re-submitting to prevent duplicate registration or charges.`,
        code: 'RECONCILIATION_REQUIRED',
        orderId: existingOrder.orderId,
        recoveryUrl: `/api/orders/${existingOrder.orderId}/recover`,
      });
    }
  }

  // 5. Idempotency & Concurrency Lock
  const lockKey = idempotencyKey || `order-lock-${cleanDomain}`;
  const acquired = orderStore.acquireLock(lockKey);
  if (!acquired) {
    return res.status(409).json({
      success: false,
      error: 'A registration request for this domain or session is already processing. Please wait.',
      code: 'CONCURRENT_REQUEST',
    });
  }

  try {
    // 6. Recheck domain availability immediately before registration
    console.log(`[Checkout] Re-verifying live availability for "${cleanDomain}"`);
    const checkResult = await hostyIndiaService.checkDomainAvailability(cleanDomain);
    if (checkResult.is_available === false) {
      orderStore.releaseLock(lockKey);
      return res.status(400).json({
        success: false,
        error: `Domain "${cleanDomain}" is no longer available. It was already registered or taken by another party.`,
        code: 'DOMAIN_TAKEN',
      });
    }
    if (checkResult.is_available !== true) {
      orderStore.releaseLock(lockKey);
      return res.status(400).json({
        success: false,
        error: `Domain "${cleanDomain}" availability could not be confirmed by the registry. Status: ${checkResult.availability_status}.`,
        code: 'AVAILABILITY_UNKNOWN',
      });
    }

    const tld = checkResult.tld || ('.' + cleanDomain.split('.').pop());
    const pricingConfig = pricingService.getTldPricing(tld);
    const regPrice = (pricingConfig && pricingConfig.retail_register != null) ? pricingConfig.retail_register : (checkResult.price || 849.00);
    const renewPrice = (pricingConfig && pricingConfig.retail_renew != null) ? pricingConfig.retail_renew : (checkResult.renew_price || 1049.00);
    const totalAmount = regPrice;
    const wholesaleRequired = checkResult.price || regPrice;

    // 6.5. Prevent checkout if displayed quote differs from final live registry quote
    const clientExpected = req.body.expectedPrice !== undefined
      ? req.body.expectedPrice
      : (req.body.expectedTotalPrice !== undefined
        ? req.body.expectedTotalPrice
        : (req.body.expectedTotalAmount !== undefined ? req.body.expectedTotalAmount : null));

    if (clientExpected !== null && clientExpected !== undefined) {
      const parsedExpected = parseFloat(clientExpected);
      if (!isNaN(parsedExpected) && Math.abs(parsedExpected - totalAmount) > 0.01) {
        orderStore.releaseLock(lockKey);
        return res.status(409).json({
          success: false,
          error: `Quote discrepancy detected: displayed price (₹ ${parsedExpected.toFixed(2)}) differs from the final live registry quote (₹ ${totalAmount.toFixed(2)}). Please refresh your quote before completing checkout.`,
          code: 'QUOTE_DISCREPANCY',
          details: {
            displayedPrice: parsedExpected,
            livePrice: totalAmount,
            currency: checkResult.currency || 'INR',
          },
        });
      }
    }

    // 7. Check reseller wallet balance BEFORE registration
    const wallet = await hostyIndiaService.getBalance();
    console.log(`[Checkout] Reseller wallet balance: ₹${wallet.balance}, Wholesale Required: ₹${wholesaleRequired}`);

    if (wallet.balance < wholesaleRequired) {
      const deficit = wholesaleRequired - wallet.balance;
      const deficitMsg = `Insufficient reseller wallet balance. Required wholesale: ₹ ${wholesaleRequired.toFixed(2)}, Available: ₹ ${wallet.balance.toFixed(2)}. Deficit: ₹ ${deficit.toFixed(2)}. Please add funds to your HostyIndia reseller wallet to complete registration.`;
      orderStore.releaseLock(lockKey);

      return res.status(402).json({
        success: false,
        error: deficitMsg,
        code: 'INSUFFICIENT_FUNDS',
        details: {
          required: totalAmount,
          available: wallet.balance,
          deficit,
        },
      });
    }

    // 8. Create order record in PENDING state
    // HostyIndia automatically assigns default registrar nameservers during initial registration.
    // We do NOT manually pass nameservers during initial registration.
    // Custom nameservers (Cloudflare) are provisioned and submitted post-registration via save_nameservers.
    let generatedCustomerToken = null;
    try {
      generatedCustomerToken = customerTokenService.createCustomerToken(resolvedCustomerId);
    } catch (e) {
      console.warn('[Checkout] Customer token issuance notice:', e.message);
    }

    const order = orderStore.createOrder({
      customerId: resolvedCustomerId,
      ticketId,
      domain: cleanDomain,
      registrant,
      regPeriodYears: years,
      regPrice,
      renewPrice,
      taxAmount: 0.00,
      totalAmount,
      currency: 'INR',
      paymentStatus: 'PAID',
      paymentMethod: 'Reseller Wallet Allocation',
      idempotencyKey: lockKey,
      nameservers: [], // Will be populated with assigned Cloudflare nameservers post-registration
      zoneId: null,
    });

    // 9. Submit registration ONCE to HostyIndia gateway WITHOUT nameservers
    orderStore.updateOrder(order.orderId, { status: 'PROCESSING' });
    orderStore.addLog(order.orderId, 'PROCESSING', `Submitting registration request to HostyIndia gateway (automatic default registrar nameservers)`);

    let regResponse;
    try {
      regResponse = await hostyIndiaService.registerDomain({
        domain: cleanDomain,
        years,
        registrant,
      });
    } catch (regErr) {
      if (regErr.code === 'GATEWAY_TIMEOUT') {
        // Critical safeguard: Never blindly retry a registration after a timeout.
        orderStore.updateOrder(order.orderId, { status: 'UNKNOWN' });
        orderStore.addLog(order.orderId, 'UNKNOWN', 'Registry gateway timed out. Registration status unknown. Reconcile via registrar recovery without duplicate charges.');
        orderStore.releaseLock(lockKey);
        return res.status(504).json({
          success: false,
          error: 'Registry gateway timed out during registration. Order recorded with status UNKNOWN. WebNavi will reconcile status via registrar recovery without duplicate charges.',
          orderId: order.orderId,
          status: 'UNKNOWN',
          domain: cleanDomain,
          recoveryUrl: `/api/orders/${order.orderId}/recover`,
        });
      }

      // Non-timeout registration failure
      orderStore.updateOrder(order.orderId, { status: 'FAILED' });
      orderStore.addLog(order.orderId, 'FAILED', `Registration failed at HostyIndia: ${regErr.message}`);
      orderStore.releaseLock(lockKey);

      return res.status(regErr.statusCode || 500).json({
        success: false,
        error: regErr.message || 'Domain registration failed at registrar gateway.',
        orderId: order.orderId,
        status: 'FAILED',
        code: regErr.code || 'REGISTRATION_FAILED',
        details: regErr.details,
      });
    }

    // 10. Confirm successful registration through HostyIndia
    // Safeguard: Never mark registration successful without HostyIndia confirmation.
    if (!regResponse || regResponse.success !== true) {
      orderStore.updateOrder(order.orderId, { status: 'FAILED' });
      orderStore.releaseLock(lockKey);
      return res.status(502).json({
        success: false,
        error: 'HostyIndia did not return successful confirmation of registration.',
        orderId: order.orderId,
        status: 'FAILED',
      });
    }

    // 11. Domain registration is CONFIRMED by HostyIndia — Mark order ACTIVE in persistent storage
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + (parseInt(years, 10) || 1));

    const registrarRef = regResponse.domain_id
      ? `HI-DOM-${regResponse.domain_id}`
      : (regResponse.order_id ? `HI-ORD-${regResponse.order_id}` : `HI-CONFIRMED-${Date.now()}`);

    orderStore.updateOrder(order.orderId, {
      status: 'ACTIVE',
      dnsStatus: 'NOT_STARTED',
      registrarRef,
      registeredAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastSyncedAt: now.toISOString(),
    });

    orderStore.addLog(order.orderId, 'ACTIVE', `Registration confirmed by HostyIndia. Reference: ${registrarRef}. Domain active until ${expiresAt.toISOString()}. DNS initialization pending.`);

    // 12. ONLY AFTER confirmed registration, provision or retrieve Cloudflare DNS Zone
    // CRITICAL ARCHITECTURE RULE: Never mark a confirmed registration as FAILED because Cloudflare fails!
    let cfZone = null;
    let cfError = null;
    let assignedNs = [];
    let nsSyncResult = null;

    try {
      console.log(`[Checkout] Domain confirmed active. Provisioning Cloudflare DNS zone for "${cleanDomain}"`);
      cfZone = await cloudflareService.createZone(cleanDomain);

      if (cfZone && Array.isArray(cfZone.nameServers) && cfZone.nameServers.length >= 2) {
        assignedNs = cfZone.nameServers.map((s) => s.trim().toLowerCase()).filter(Boolean);

        // Update persistent store with Cloudflare zone details
        orderStore.updateOrder(order.orderId, {
          zoneId: cfZone.zoneId,
          nameservers: [assignedNs[0], assignedNs[1]],
          dnsStatus: 'PENDING_APPROVAL',
        });

        dnsStore.upsertZone({
          zoneId: cfZone.zoneId,
          domain: cleanDomain,
          orderId: order.orderId,
          customerId: order.customerId,
          status: cfZone.status || 'pending',
          nameServers: [assignedNs[0], assignedNs[1]],
          approvalStatus: 'NOT_SUBMITTED',
        });
        dnsStore.addLog(cleanDomain, 'ZONE_PROVISIONED', `Cloudflare zone ${cfZone.zoneId} provisioned with nameservers: ${assignedNs[0]}, ${assignedNs[1]}`);

        // Submit nameserver delegation change to HostyIndia save_nameservers API
        try {
          nsSyncResult = await nameserverSync.submitNameservers({
            domain: cleanDomain,
            confirmAction: true,
            origin: 'checkout',
          });
          console.log(`[Checkout] Nameserver change submitted to HostyIndia for "${cleanDomain}": ${nsSyncResult.approvalStatus}`);
        } catch (nsErr) {
          console.warn(`[Checkout] Nameserver delegation submission notice for ${cleanDomain}:`, nsErr.message);
          orderStore.addLog(order.orderId, 'NS_NOTICE', `Nameserver delegation notice: ${nsErr.message}`);
        }
      } else {
        throw new Error('Cloudflare did not return at least 2 valid assigned nameservers.');
      }
    } catch (dnsErr) {
      cfError = dnsErr;
      console.warn(`[Checkout] Cloudflare DNS zone provisioning deferred for "${cleanDomain}":`, dnsErr.message);

      // Registration remains ACTIVE! Record deferred state in order and DNS store
      orderStore.updateOrder(order.orderId, {
        dnsStatus: 'DEFERRED',
      });
      orderStore.addLog(order.orderId, 'DNS_PENDING', `Cloudflare DNS setup deferred: ${dnsErr.message}. Domain registration remains ACTIVE. Retry via /setup-dns without duplicate charges.`);

      dnsStore.upsertZone({
        domain: cleanDomain,
        orderId: order.orderId,
        customerId: order.customerId,
        approvalStatus: 'FAILED',
        status: 'pending',
      });
      dnsStore.addLog(cleanDomain, 'DNS_PROVISION_DEFERRED', `Cloudflare setup deferred: ${dnsErr.message}`);
    }

    // Link registrarRef in dnsStore
    dnsStore.updateZone(cleanDomain, {
      orderId: order.orderId,
      customerId: order.customerId,
      registrarRef,
    });

    orderStore.releaseLock(lockKey);

    const updatedOrder = orderStore.getOrderById(order.orderId);

    // Dispatch transactional order confirmation email
    try {
      if (targetEmail) {
        emailService.sendOrderConfirmationEmail({
          email: targetEmail,
          fullName: targetFullName || targetEmail,
        }, updatedOrder);
      }
    } catch (e) {
      console.warn('[Orders] Confirmation email notice:', e.message);
    }
    const zoneRecord = dnsStore.getZoneByDomain(cleanDomain);
    const customerFacing = nsSyncResult
      ? nsSyncResult.customerFacing
      : (cfError
        ? {
            label: 'Nameserver setup requested',
            badge: 'DNS_PENDING',
            badgeColor: '#ffd43b',
            description: 'Domain registration confirmed active. Cloudflare DNS zone setup is queued for automatic retry.',
            isDnsActive: false,
          }
        : nameserverSync.getCustomerFacingState(zoneRecord));

    res.json({
      success: true,
      orderId: order.orderId,
      domain: order.domain,
      status: 'ACTIVE',
      dnsStatus: updatedOrder.dnsStatus || 'PENDING_APPROVAL',
      registrarRef: updatedOrder.registrarRef,
      registeredAt: updatedOrder.registeredAt,
      expiresAt: updatedOrder.expiresAt,
      zoneId: cfZone ? cfZone.zoneId : null,
      nameservers: assignedNs.length > 0 ? [assignedNs[0], assignedNs[1]] : updatedOrder.nameservers,
      dnsConfigured: Boolean(cfZone && !cfError),
      dnsApprovalStatus: nsSyncResult ? nsSyncResult.approvalStatus : (cfError ? 'FAILED' : 'PENDING_APPROVAL'),
      nameserverApprovalStatus: nsSyncResult ? nsSyncResult.approvalStatus : (cfError ? 'FAILED' : 'PENDING_APPROVAL'),
      customerFacing,
      retryDnsUrl: `/api/orders/${order.orderId}/setup-dns`,
      invoiceUrl: `/api/orders/${order.orderId}/invoice?token=${order.orderToken}`,
      customerToken: generatedCustomerToken,
      orderToken: order.orderToken,
      message: cfError
        ? `Domain ${order.domain} registered successfully! Cloudflare DNS provisioning deferred for retry without re-registering.`
        : `Domain ${order.domain} registered successfully with Cloudflare nameservers! Nameservers submitted for registrar approval.`,
      customerAccountCreated,
      customerId: resolvedCustomerId,
      order: updatedOrder,
    });
  } catch (err) {
    orderStore.releaseLock(lockKey);
    next(err);
  }
});

/**
 * POST /api/orders/:orderId/recover
 * Safe timeout recovery & reconciliation endpoint.
 * Reconciles orders interrupted by timeout or errors WITHOUT blindly re-registering or charging again.
 */
router.post('/:orderId/recover', async (req, res, next) => {
  try {
    const order = orderStore.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    console.log(`[Order Recovery] Reconciling order ${order.orderId} (status: ${order.status}) for domain "${order.domain}"`);

    // 1. If already ACTIVE: preserve registration, ensure zone link, do NOT re-register
    if (order.status === 'ACTIVE') {
      let zone = dnsStore.getZoneByDomain(order.domain);
      if (!zone && order.zoneId) {
        zone = dnsStore.upsertZone({
          zoneId: order.zoneId,
          domain: order.domain,
          orderId: order.orderId,
          customerId: order.customerId,
          nameServers: order.nameservers,
        });
      }
      return res.json({
        success: true,
        order,
        recovered: true,
        alreadyActive: true,
        message: `Order ${order.orderId} is already ACTIVE with registrar reference ${order.registrarRef}. No duplicate registration submitted.`,
      });
    }

    // 2. Query HostyIndia registry to check if the domain was actually registered
    const check = await hostyIndiaService.checkDomainAvailability(order.domain);

    if (check.is_available === false) {
      // Domain was confirmed registered at the registry before/during timeout!
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setFullYear(expiresAt.getFullYear() + (parseInt(order.regPeriodYears, 10) || 1));
      const registrarRef = `HI-RECOVERED-${order.orderId}`;

      orderStore.updateOrder(order.orderId, {
        status: 'ACTIVE',
        registrarRef,
        registeredAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastSyncedAt: now.toISOString(),
      });
      orderStore.addLog(order.orderId, 'ACTIVE', `Registration reconciled via registry query. Domain confirmed registered. Status restored to ACTIVE without duplicate charge.`);

      // Link Cloudflare zone
      let zone = dnsStore.getZoneByDomain(order.domain);
      if (!zone && order.zoneId) {
        zone = dnsStore.upsertZone({
          zoneId: order.zoneId,
          domain: order.domain,
          orderId: order.orderId,
          customerId: order.customerId,
          nameServers: order.nameservers,
        });
      }

      // Safe nameserver submission/sync
      try {
        await nameserverSync.submitNameservers({
          domain: order.domain,
          confirmAction: true,
          origin: 'recovery',
        });
      } catch (e) {
        console.warn(`[Order Recovery] Nameserver submission notice:`, e.message);
      }

      const updated = orderStore.getOrderById(order.orderId);
      return res.json({
        success: true,
        order: updated,
        recovered: true,
        registeredViaRecovery: true,
        message: `Domain "${order.domain}" was verified as registered at the registry. Order recovered to ACTIVE.`,
      });
    } else if (check.is_available === true) {
      // Confirmed free: registrar never processed registration
      orderStore.updateOrder(order.orderId, {
        status: 'FAILED',
        lastSyncedAt: new Date().toISOString(),
      });
      orderStore.addLog(order.orderId, 'FAILED', `Reconciliation confirmed domain "${order.domain}" is still available. Registry never completed registration.`);

      return res.json({
        success: true,
        order: orderStore.getOrderById(order.orderId),
        recovered: true,
        registeredViaRecovery: false,
        canRetryCheckout: true,
        message: `Domain "${order.domain}" was NOT registered by the registry before the timeout. It remains available for checkout.`,
      });
    } else {
      // Inconclusive registry response: do NOT mark FAILED
      console.warn(`[Order Recovery] Inconclusive check for "${order.domain}": status=${check.availability_status}`);
      orderStore.addLog(order.orderId, 'UNKNOWN', `Reconciliation check was inconclusive (status: ${check.availability_status}). Order preserved as UNKNOWN to prevent duplicate charges or premature failure.`);

      return res.status(503).json({
        success: false,
        order: orderStore.getOrderById(order.orderId),
        recovered: false,
        inconclusive: true,
        code: 'REGISTRY_INCONCLUSIVE',
        error: `Registrar availability response was inconclusive (status: ${check.availability_status || 'unknown'}). Order status remains UNKNOWN. Please retry reconciliation when the registry is responsive.`,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/:orderId/setup-dns
 * POST /api/orders/:orderId/retry-dns
 * Retries Cloudflare zone provisioning and nameserver delegation for an already ACTIVE domain order.
 * CRITICAL SAFEGUARD: NEVER calls HostyIndia registerDomain or spends wallet funds.
 */
async function handleSetupDns(req, res, next) {
  try {
    const order = orderStore.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    if (order.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: `DNS provisioning is only permitted for ACTIVE confirmed domain registrations. Current status: ${order.status}.`,
        code: 'ORDER_NOT_ACTIVE',
      });
    }

    console.log(`[DNS Setup Retry] Provisioning Cloudflare zone for domain "${order.domain}" (Order ${order.orderId})`);

    // 1. Create or retrieve Cloudflare zone
    let cfZone = await cloudflareService.createZone(order.domain);
    const assignedNs = Array.isArray(cfZone.nameServers)
      ? cfZone.nameServers.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];

    if (assignedNs.length < 2) {
      return res.status(502).json({
        success: false,
        error: 'Cloudflare did not return at least 2 valid assigned nameservers.',
        code: 'INVALID_CLOUDFLARE_NAMESERVERS',
      });
    }

    // 2. Persist in dnsStore
    dnsStore.upsertZone({
      zoneId: cfZone.zoneId,
      domain: order.domain,
      orderId: order.orderId,
      customerId: order.customerId,
      status: cfZone.status || 'pending',
      nameServers: [assignedNs[0], assignedNs[1]],
    });
    dnsStore.addLog(order.domain, 'DNS_RETRY_SUCCESS', `Cloudflare zone ${cfZone.zoneId} provisioned on retry with nameservers: ${assignedNs[0]}, ${assignedNs[1]}`);

    // 3. Update order in orderStore
    orderStore.updateOrder(order.orderId, {
      zoneId: cfZone.zoneId,
      nameservers: [assignedNs[0], assignedNs[1]],
      dnsStatus: 'PENDING_APPROVAL',
    });
    orderStore.addLog(order.orderId, 'DNS_RETRY_SUCCESS', `Cloudflare DNS setup completed. Assigned nameservers: ${assignedNs[0]}, ${assignedNs[1]}`);

    // 4. Submit nameserver change to HostyIndia save_nameservers API
    let nsSyncResult = null;
    try {
      nsSyncResult = await nameserverSync.submitNameservers({
        domain: order.domain,
        confirmAction: true,
        origin: 'dns_retry',
      });
    } catch (nsErr) {
      console.warn(`[DNS Setup Retry] Nameserver submission notice for ${order.domain}:`, nsErr.message);
    }

    const updatedOrder = orderStore.getOrderById(order.orderId);
    const zone = dnsStore.getZoneByDomain(order.domain);

    res.json({
      success: true,
      orderId: order.orderId,
      domain: order.domain,
      status: order.status,
      dnsStatus: updatedOrder.dnsStatus || 'PENDING_APPROVAL',
      zoneId: cfZone.zoneId,
      nameservers: [assignedNs[0], assignedNs[1]],
      dnsConfigured: true,
      nameserverApprovalStatus: nsSyncResult ? nsSyncResult.approvalStatus : (zone ? zone.approvalStatus : 'PENDING_APPROVAL'),
      customerFacing: nsSyncResult ? nsSyncResult.customerFacing : nameserverSync.getCustomerFacingState(zone),
      message: `Cloudflare DNS zone provisioned and nameservers submitted to HostyIndia for ${order.domain}!`,
      order: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
}

router.post('/:orderId/setup-dns', handleSetupDns);
router.post('/:orderId/retry-dns', handleSetupDns);

/**
 * GET /api/orders/:orderId
 * Retrieve single order details.
 * Strictly protected: requires verified customer ownership (matching order token or customer token)
 * or admin authorization. Unauthenticated access returns 401; cross-customer access returns 403 Forbidden.
 */
router.get('/:orderId', (req, res) => {
  const order = orderStore.getOrderById(req.params.orderId);
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found.' });
  }

  const authCheck = verifyCustomerOwnership(req, order.customerId, order);
  if (!authCheck.authorized) {
    return res.status(authCheck.status || 401).json({
      success: false,
      error: authCheck.message || (authCheck.status === 403
        ? 'Forbidden: Cross-customer access denied. You do not have permission to view this order.'
        : 'Unauthorized: Order access requires verified customer ownership or admin authorization.'),
      code: authCheck.status === 403 ? 'FORBIDDEN' : (authCheck.reason || 'UNAUTHORIZED'),
      reason: authCheck.reason,
    });
  }

  res.json({
    success: true,
    order,
  });
});

/**
 * GET /api/orders/:orderId/invoice
 * Download official WebNavi PDF invoice for an order.
 * Strictly protected: requires verified customer ownership (token or customer ID) or admin authorization.
 */
router.get('/:orderId/invoice', async (req, res, next) => {
  try {
    const order = orderStore.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const authCheck = verifyCustomerOwnership(req, order.customerId, order);
    if (!authCheck.authorized) {
      return res.status(authCheck.status || 401).json({
        success: false,
        error: authCheck.message || (authCheck.status === 403
          ? 'Forbidden: Cross-customer access denied. You do not have permission to download this invoice.'
          : 'Unauthorized: Invoice download requires verified customer ownership or admin authorization.'),
        code: authCheck.status === 403 ? 'FORBIDDEN' : (authCheck.reason || 'UNAUTHORIZED'),
        reason: authCheck.reason,
      });
    }

    const pdfBuffer = await generateInvoicePdf(order);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="WebNavi-Invoice-${order.orderId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/customer/:customerId
 * Retrieve all orders belonging to a specific customer (for Client Portal).
 * Requires admin authorization OR customer ownership token matching :customerId.
 * Prevents URL parameter tampering / IDOR enumeration.
 */
router.get('/customer/:customerId', (req, res) => {
  const { customerId } = req.params;

  const authCheck = verifyCustomerOwnership(req, customerId);
  if (!authCheck.authorized) {
    return res.status(authCheck.status || 401).json({
      success: false,
      error: authCheck.message || (authCheck.status === 403
        ? 'Forbidden: Cross-customer access denied. You do not have permission to view orders for this customer.'
        : 'Unauthorized: Customer authorization token required to access customer orders.'),
      code: authCheck.status === 403 ? 'FORBIDDEN' : (authCheck.reason || 'UNAUTHORIZED'),
      reason: authCheck.reason,
    });
  }

  const list = orderStore.getOrdersByCustomerId(customerId);
  res.json({
    success: true,
    count: list.length,
    orders: list,
  });
});

module.exports = router;

