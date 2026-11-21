const express = require('express');
const router = express.Router();
const hostyIndiaService = require('../services/hostyindia');
const orderStore = require('../services/orderStore');
const nameserverSync = require('../services/nameserverSync');
const pricingService = require('../services/pricingService');
const competitorPricingService = require('../services/competitorPricingService');
const { adminAuth } = require('../services/auth');

// Protect all /api/admin/* endpoints with admin authentication
router.use(adminAuth);

// Ensure sensitive admin dashboard responses are never cached by browser or proxies
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

/**
 * GET /api/admin/metrics
 * Dynamic aggregated database metrics for WebNavi Admin Control Panel.
 * Queries actual SQLite tables directly (orders and dns_zones).
 */
router.get('/metrics', (req, res, next) => {
  try {
    const db = orderStore.db;

    // Total domains: count of genuine domain orders
    const totalOrdersRow = db.prepare('SELECT COUNT(*) as count FROM orders').get();
    const totalDomains = totalOrdersRow ? totalOrdersRow.count : 0;

    // Active domains: count where verified registrar registration status is ACTIVE
    const activeOrdersRow = db.prepare("SELECT COUNT(*) as count FROM orders WHERE UPPER(status) = 'ACTIVE'").get();
    const activeDomains = activeOrdersRow ? activeOrdersRow.count : 0;

    // Pending DNS: count where DNS setup or nameserver approval is genuinely pending
    const pendingDnsRow = db.prepare("SELECT COUNT(*) as count FROM orders WHERE UPPER(dns_status) IN ('PENDING_APPROVAL', 'DNS_PENDING', 'DEFERRED') OR (UPPER(status) = 'ACTIVE' AND (zone_id IS NULL OR zone_id = '' OR nameservers_json IS NULL OR nameservers_json = '[]'))").get();
    const pendingDns = pendingDnsRow ? pendingDnsRow.count : 0;

    // Failed orders: count where registration status is genuinely FAILED
    const failedOrdersRow = db.prepare("SELECT COUNT(*) as count FROM orders WHERE UPPER(status) = 'FAILED'").get();
    const failedOrders = failedOrdersRow ? failedOrdersRow.count : 0;

    // Managed DNS zones: count of real Cloudflare zones associated with genuine domain orders
    const totalZonesRow = db.prepare('SELECT COUNT(*) as count FROM dns_zones').get();
    const managedDnsZones = totalZonesRow ? totalZonesRow.count : 0;

    // Pending HostyIndia approval: count of real nameserver requests that are actually pending
    const pendingApprovalRow = db.prepare("SELECT COUNT(*) as count FROM dns_zones WHERE UPPER(approval_status) = 'PENDING_APPROVAL'").get();
    const pendingHostyIndiaApproval = pendingApprovalRow ? pendingApprovalRow.count : 0;

    // DNS Active & Serving: count of zones verified active through Cloudflare where actual registrar delegation matches Cloudflare nameservers
    const activeDnsRow = db.prepare("SELECT COUNT(*) as count FROM dns_zones WHERE (LOWER(status) = 'active' AND UPPER(approval_status) = 'APPROVED') OR UPPER(approval_status) = 'ACTIVE'").get();
    const dnsActiveServing = activeDnsRow ? activeDnsRow.count : 0;

    res.json({
      success: true,
      metrics: {
        totalDomains,
        activeDomains,
        pendingDns,
        failedOrders,
        managedDnsZones,
        pendingHostyIndiaApproval,
        dnsActiveServing,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/wallet
 * Returns current HostyIndia reseller wallet balance.
 */
router.get('/wallet', async (req, res, next) => {
  try {
    const wallet = await hostyIndiaService.getBalance();
    res.json({
      success: true,
      balance: wallet.balance,
      formatted_balance: wallet.formatted_balance,
      currency: wallet.currency,
      active_domains: wallet.active_domains,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/orders
 * Returns all domain registration orders with full metadata.
 */
router.get('/orders', async (req, res, next) => {
  try {
    const orders = orderStore.getAllOrders();
    let wallet = null;
    try {
      wallet = await hostyIndiaService.getBalance();
    } catch (e) {
      // Wallet check is non-fatal for order listing
    }

    res.json({
      success: true,
      count: orders.length,
      orders,
      wallet: wallet ? {
        balance: wallet.balance,
        formatted_balance: wallet.formatted_balance,
        currency: wallet.currency,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/orders/:orderId
 * Returns detailed order information.
 */
router.get('/orders/:orderId', (req, res) => {
  const order = orderStore.getOrderById(req.params.orderId);
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found.' });
  }
  res.json({ success: true, order });
});

/**
 * POST /api/admin/orders/:orderId/sync
 * Syncs domain status, expiry, and registrar state via HostyIndia sync/info actions.
 */
router.post('/orders/:orderId/sync', async (req, res, next) => {
  try {
    const order = orderStore.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    console.log(`[Admin Sync] Synchronizing domain "${order.domain}" with HostyIndia`);

    let syncResult = null;
    try {
      syncResult = await hostyIndiaService.syncDomain(order.domain);
    } catch (e) {
      console.warn('[Admin Sync] sync action returned:', e.message);
    }

    let infoResult = null;
    try {
      infoResult = await hostyIndiaService.getDomainInfo(order.domain);
    } catch (e) {
      console.warn('[Admin Sync] domain_info action returned:', e.message);
    }

    const updates = {
      lastSyncedAt: new Date().toISOString(),
    };

    if (syncResult && syncResult.expirydate) {
      updates.expiresAt = new Date(syncResult.expirydate).toISOString();
    }

    if (infoResult && infoResult.success) {
      if (infoResult.status) updates.status = infoResult.status.toUpperCase();
      if (infoResult.domain_id) updates.registrarRef = `HI-DOM-${infoResult.domain_id}`;
    }

    orderStore.updateOrder(order.orderId, updates);
    orderStore.addLog(order.orderId, updates.status || order.status, 'Domain synchronized with HostyIndia gateway.');

    // Also trigger nameserver and Cloudflare DNS verification if DNS zone is configured
    let dnsResult = null;
    try {
      dnsResult = await nameserverSync.verifyDomainNameservers(order.domain);
    } catch (e) {
      console.warn('[Admin Sync] nameserver verification returned:', e.message);
    }

    const updated = orderStore.getOrderById(order.orderId);
    res.json({
      success: true,
      order: updated,
      syncResult,
      infoResult,
      dnsResult,
      message: `Domain ${order.domain} synchronized successfully.`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/orders/:orderId/nameservers
 * Fetches live nameservers from HostyIndia.
 */
router.get('/orders/:orderId/nameservers', async (req, res, next) => {
  try {
    const order = orderStore.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const nsResult = await hostyIndiaService.getNameservers(order.domain);
    res.json({
      success: true,
      domain: order.domain,
      nameservers: nsResult.live_ns,
      is_pending: nsResult.is_pending,
      message: nsResult.message,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/orders/:orderId/nameservers
 * Updates live nameservers on HostyIndia.
 */
router.post('/orders/:orderId/nameservers', async (req, res, next) => {
  try {
    const order = orderStore.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const { ns1, ns2, ns3, ns4, ns5 } = req.body || {};
    if (!ns1 || !ns2) {
      return res.status(400).json({ success: false, error: 'ns1 and ns2 are required.' });
    }

    const result = await hostyIndiaService.saveNameservers({
      domain: order.domain,
      ns1,
      ns2,
      ns3,
      ns4,
      ns5,
    });

    const newNsList = [ns1, ns2];
    if (ns3) newNsList.push(ns3);
    if (ns4) newNsList.push(ns4);
    if (ns5) newNsList.push(ns5);

    orderStore.updateOrder(order.orderId, { nameservers: newNsList });
    orderStore.addLog(order.orderId, order.status, `Nameservers updated to: ${newNsList.join(', ')}`);

    res.json({
      success: true,
      message: result.message || 'Nameserver change submitted to registrar.',
      result,
      nameservers: newNsList,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/pricing
 * Retrieve paginated & searchable TLD pricing catalog with wholesale costs, retail prices, and profit margins.
 * STRICT: Admin session required.
 */
router.get('/pricing', (req, res, next) => {
  try {
    const { search, page, limit, sort, order } = req.query || {};
    const status = req.query.status || req.query.filter || 'all';
    const result = pricingService.getAdminTldPricing({
      search,
      status,
      page,
      limit,
      sort,
      order,
    });
    res.json({ success: true, ...result, metrics: result.summary });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/pricing/update
 * Update retail registration, renewal, or transfer price for a specific TLD with loss safeguards.
 */
router.post('/pricing/update', (req, res, next) => {
  try {
    const { tld, retail_register, retail_renew, retail_transfer, allow_loss, is_active } = req.body || {};
    if (!tld || typeof tld !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid "tld" parameter is required.' });
    }

    const updated = pricingService.updateTldPricing(tld, {
      retail_register,
      retail_renew,
      retail_transfer,
      allow_loss,
      is_active,
    });

    res.json({
      success: true,
      message: `Pricing updated for ${updated.tld}`,
      tldPricing: updated,
      pricing: updated,
    });
  } catch (error) {
    if (error.code === 'LOSS_WARNING') {
      return res.status(400).json({
        success: false,
        error: error.message,
        code: error.code,
        requiresApproval: true,
        details: error.details,
        warnings: [error.message],
      });
    }
    next(error);
  }
});

/**
 * POST /api/admin/pricing/sync
 * Manually trigger fresh wholesale pricing synchronization from HostyIndia upstream.
 * Guarantees existing retail prices are never overwritten.
 */
router.post('/pricing/sync', async (req, res, next) => {
  try {
    const syncResult = await pricingService.syncWholesalePricing();
    res.json({
      success: true,
      message: `Wholesale pricing synchronized successfully (${syncResult.totalFetched} TLDs processed).`,
      stats: { inserted: syncResult.insertedCount, updated: syncResult.updatedCount },
      ...syncResult,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/pricing/bulk
 * Safe bulk pricing updates with loss-prevention guards.
 */
router.post('/pricing/bulk', (req, res, next) => {
  try {
    let { tlds, scope, markupType, strategy, regValue, reg_val, renewValue, renew_val, allow_loss } = req.body || {};
    
    // Support scope aliases
    if (!tlds && scope) {
      tlds = scope; // 'all' or 'unconfigured'
    }
    // Support strategy aliases
    if (!markupType && strategy) {
      markupType = strategy === 'flat' ? 'set' : 'fixed';
    }
    if (regValue === undefined && reg_val !== undefined) regValue = reg_val;
    if (renewValue === undefined && renew_val !== undefined) renewValue = renew_val;

    if (!tlds || (!Array.isArray(tlds) && !['all', 'unconfigured'].includes(tlds))) {
      return res.status(400).json({ success: false, error: 'Target "tlds" must be an array, "all", or "unconfigured".' });
    }
    if (!['fixed', 'set'].includes(markupType)) {
      return res.status(400).json({ success: false, error: 'Valid markupType ("fixed" or "set") is required.' });
    }

    const result = pricingService.bulkUpdatePricing({
      tlds,
      markupType,
      regValue,
      renewValue,
      allow_loss,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/competitors
 * List verified competitor benchmark records.
 */
router.get('/competitors', (req, res, next) => {
  try {
    const { search, tld } = req.query || {};
    const items = competitorPricingService.getAll({ search, tld });
    res.json({
      success: true,
      items,
      count: items.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/competitors
 * Create or upsert a competitor benchmark record.
 */
router.post('/competitors', (req, res, next) => {
  try {
    const result = competitorPricingService.saveCompetitorPrice(req.body);
    res.json({
      success: true,
      message: `Competitor price for ${result.tld} (${result.competitor_name}) saved successfully.`,
      result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/admin/competitors/:id
 * Delete a competitor benchmark record by ID.
 */
router.delete('/competitors/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    competitorPricingService.deleteCompetitorPrice(id);
    res.json({
      success: true,
      message: `Competitor benchmark #${id} removed successfully.`
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
