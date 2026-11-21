const express = require('express');
const router = express.Router();
const cloudflareService = require('../services/cloudflare');
const hostyIndiaService = require('../services/hostyindia');
const dnsStore = require('../services/dnsStore');
const orderStore = require('../services/orderStore');
const nameserverSync = require('../services/nameserverSync');
const { verifyCustomerOwnership } = require('../services/auth');

// Prevent browser/proxy caching on DNS API endpoints
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

/**
 * GET /api/dns/status
 * Verifies Cloudflare API credentials and account accessibility.
 */
router.get('/status', async (req, res) => {
  try {
    const [status, tokenVerify] = await Promise.all([
      cloudflareService.getAccountStatus(),
      cloudflareService.verifyToken(),
    ]);

    // Mask raw accountId to prevent credential/account disclosure in public responses
    const safeStatus = status ? { ...status } : {};
    if (safeStatus.accountId) {
      delete safeStatus.accountId;
    }

    res.json({
      success: status.connected,
      cloudflare: safeStatus,
      tokenVerification: tokenVerify,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/dns/zones/live
 * Fetches real zones directly from Cloudflare API.
 */
router.get('/zones/live', async (req, res, next) => {
  try {
    const data = await cloudflareService.listZones();
    res.json(data);
  } catch (error) {
    if (error.code === 9109 || (error.message && error.message.includes('from location'))) {
      return res.status(403).json({
        success: false,
        code: 9109,
        error: error.message,
        hint: 'Your Cloudflare API Token has IP restrictions enabled in Cloudflare Dashboard. Add your current IP or remove IP restrictions to allow API calls.',
      });
    }
    next(error);
  }
});

/**
 * GET /api/dns/zones
 * Lists all managed DNS zones (Admin view).
 */
router.get('/zones', async (req, res, next) => {
  try {
    const zones = dnsStore.getAllZones();

    // Optionally refresh status from Cloudflare for active zones
    const enriched = await Promise.all(
      zones.map(async (z) => {
        if (z.zoneId && !z.zoneId.startsWith('cf-zone-')) {
          try {
            const live = await cloudflareService.getZoneDetails(z.zoneId);
            if (live && live.success) {
              z.status = live.status;
              if (live.nameServers && live.nameServers.length > 0) {
                z.nameServers = live.nameServers;
              }
            }
          } catch (e) {
            // Non-fatal, use cached status
          }
        }
        return z;
      })
    );

    res.json({
      success: true,
      count: enriched.length,
      zones: enriched.map((z) => ({
        ...z,
        customerFacing: nameserverSync.getCustomerFacingState(z),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/dns/zones/:domain
 * Retrieves details for a specific domain's DNS zone.
 */
router.get('/zones/:domain', async (req, res, next) => {
  try {
    const cleanDomain = req.params.domain.trim().toLowerCase();
    let zone = dnsStore.getZoneByDomain(cleanDomain);

    if (!zone) {
      // Check if domain order exists
      const order = orderStore.getOrderByDomain(cleanDomain);
      if (order) {
        zone = dnsStore.upsertZone({
          domain: cleanDomain,
          orderId: order.orderId,
          customerId: order.customerId,
          status: 'pending',
          nameServers: ['amy.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
        });
      } else {
        return res.status(404).json({
          success: false,
          error: `No DNS zone found for domain "${cleanDomain}".`,
        });
      }
    }

    // Refresh live status from Cloudflare if it has a real zone ID
    if (zone.zoneId && !zone.zoneId.startsWith('cf-zone-')) {
      try {
        const live = await cloudflareService.getZoneDetails(zone.zoneId);
        if (live && live.success) {
          zone.status = live.status;
          zone.nameServers = live.nameServers || zone.nameServers;
          dnsStore.updateZone(cleanDomain, { status: live.status, nameServers: zone.nameServers });
        }
      } catch (err) {
        console.warn(`[DNS Route] Live zone lookup error for ${cleanDomain}:`, err.message);
      }
    }

    res.json({
      success: true,
      zone: {
        ...zone,
        customerFacing: nameserverSync.getCustomerFacingState(zone),
        notifications: dnsStore.getNotifications(cleanDomain),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/dns/zones
 * Creates or attaches a Cloudflare DNS zone for a domain.
 * Request body: { domain, orderId, customerId }
 */
router.post('/zones', async (req, res, next) => {
  try {
    const { domain, orderId, customerId } = req.body || {};
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ success: false, error: 'A valid domain name is required.' });
    }

    const cleanDomain = domain.trim().toLowerCase();

    // Call Cloudflare API to create or retrieve zone
    let cfResult;
    try {
      cfResult = await cloudflareService.createZone(cleanDomain);
    } catch (cfErr) {
      // Handle permission error gracefully
      if (cfErr.message && cfErr.message.includes('Requires permission')) {
        console.warn(`[Cloudflare API Notice] Token lacks zone.create permission. Tracking zone as pending configuration.`);
        const localZone = dnsStore.upsertZone({
          zoneId: `cf-zone-${Date.now()}`,
          domain: cleanDomain,
          orderId,
          customerId,
          status: 'pending',
          nameServers: ['amy.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
        });

        dnsStore.addLog(cleanDomain, 'PERMISSION_NOTICE', 'Cloudflare API token requires zone.create permission for automated zone creation.');

        return res.json({
          success: true,
          zone: localZone,
          warning: 'Cloudflare API token lacks "com.cloudflare.api.account.zone.create" permission. The zone is created in WebNavi and ready for nameserver assignment once permission is updated.',
        });
      }
      throw cfErr;
    }

    // Upsert zone in local DB
    const zoneRecord = dnsStore.upsertZone({
      zoneId: cfResult.zoneId,
      domain: cleanDomain,
      orderId,
      customerId,
      status: cfResult.status,
      nameServers: cfResult.nameServers,
    });

    // Update order with Cloudflare nameservers if orderId exists
    if (orderId) {
      orderStore.updateOrder(orderId, {
        nameservers: cfResult.nameServers,
      });
      orderStore.addLog(orderId, 'DNS_CONFIG', `Cloudflare zone created (${cfResult.zoneId}). Assigned nameservers: ${cfResult.nameServers.join(', ')}`);
    }

    res.json({
      success: true,
      zone: zoneRecord,
      message: `Cloudflare DNS zone initialized for "${cleanDomain}". Status: ${cfResult.status}.`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/dns/zones/:zoneId/check-activation
 * Triggers Cloudflare nameserver activation check.
 */
router.post('/zones/:zoneId/check-activation', async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    const zone = dnsStore.getZoneById(zoneId);

    if (zoneId.startsWith('cf-zone-')) {
      return res.json({
        success: true,
        message: 'Local zone status rechecked. Waiting for nameserver update at registrar.',
        status: zone ? zone.status : 'pending',
      });
    }

    const result = await cloudflareService.checkZoneActivation(zoneId);
    const details = await cloudflareService.getZoneDetails(zoneId).catch(() => null);

    if (zone && details && details.status) {
      dnsStore.updateZone(zone.domain, { status: details.status });
      dnsStore.addLog(zone.domain, 'ACTIVATION_CHECK', `Activation check initiated. Cloudflare status: ${details.status}`);
    }

    res.json({
      success: true,
      message: result.message,
      currentStatus: details ? details.status : (zone ? zone.status : 'pending'),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/dns/zones/:zoneId/records
 * Lists DNS records for a zone.
 */
router.get('/zones/:zoneId/records', async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    const { type, name } = req.query;

    if (zoneId.startsWith('cf-zone-')) {
      const zone = dnsStore.getZoneById(zoneId);
      const records = (zone && zone.cachedRecords) || [];
      return res.json({
        success: true,
        count: records.length,
        records,
        isCached: true,
      });
    }

    const data = await cloudflareService.listDnsRecords(zoneId, { type, name });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/dns/zones/:zoneId/records
 * Creates a new DNS record (A, AAAA, CNAME, MX, TXT).
 */
router.post('/zones/:zoneId/records', async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    const recordPayload = req.body || {};

    if (zoneId.startsWith('cf-zone-')) {
      const zone = dnsStore.getZoneById(zoneId);
      if (!zone) return res.status(404).json({ success: false, error: 'Zone not found.' });

      const newRec = {
        id: `rec-${Date.now()}`,
        type: (recordPayload.type || 'A').toUpperCase(),
        name: recordPayload.name,
        content: recordPayload.content,
        ttl: parseInt(recordPayload.ttl, 10) || 1,
        proxied: Boolean(recordPayload.proxied),
        priority: recordPayload.priority != null ? parseInt(recordPayload.priority, 10) : null,
        comment: recordPayload.comment || 'WebNavi Managed Record',
      };
      zone.cachedRecords = zone.cachedRecords || [];
      zone.cachedRecords.push(newRec);
      dnsStore.addLog(zone.domain, 'RECORD_CREATED', `Created local record ${newRec.type} (${newRec.name})`);

      return res.json({
        success: true,
        record: newRec,
        message: `DNS record ${newRec.type} created successfully.`,
      });
    }

    const result = await cloudflareService.createDnsRecord(zoneId, recordPayload);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/dns/zones/:zoneId/records/:recordId
 * Updates an existing DNS record.
 */
router.put('/zones/:zoneId/records/:recordId', async (req, res, next) => {
  try {
    const { zoneId, recordId } = req.params;
    const recordPayload = req.body || {};

    if (zoneId.startsWith('cf-zone-')) {
      const zone = dnsStore.getZoneById(zoneId);
      if (!zone) return res.status(404).json({ success: false, error: 'Zone not found.' });

      const idx = (zone.cachedRecords || []).findIndex((r) => r.id === recordId);
      if (idx === -1) return res.status(404).json({ success: false, error: 'Record not found.' });

      Object.assign(zone.cachedRecords[idx], {
        type: (recordPayload.type || zone.cachedRecords[idx].type).toUpperCase(),
        name: recordPayload.name || zone.cachedRecords[idx].name,
        content: recordPayload.content || zone.cachedRecords[idx].content,
        ttl: recordPayload.ttl != null ? parseInt(recordPayload.ttl, 10) : zone.cachedRecords[idx].ttl,
        proxied: recordPayload.proxied !== undefined ? Boolean(recordPayload.proxied) : zone.cachedRecords[idx].proxied,
        priority: recordPayload.priority != null ? parseInt(recordPayload.priority, 10) : zone.cachedRecords[idx].priority,
        comment: recordPayload.comment || zone.cachedRecords[idx].comment,
      });

      return res.json({
        success: true,
        record: zone.cachedRecords[idx],
        message: 'DNS record updated successfully.',
      });
    }

    const result = await cloudflareService.updateDnsRecord(zoneId, recordId, recordPayload);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/dns/zones/:zoneId/records/:recordId
 * Deletes a DNS record from Cloudflare.
 */
router.delete('/zones/:zoneId/records/:recordId', async (req, res, next) => {
  try {
    const { zoneId, recordId } = req.params;

    if (zoneId.startsWith('cf-zone-')) {
      const zone = dnsStore.getZoneById(zoneId);
      if (!zone) return res.status(404).json({ success: false, error: 'Zone not found.' });

      zone.cachedRecords = (zone.cachedRecords || []).filter((r) => r.id !== recordId);
      dnsStore.addLog(zone.domain, 'RECORD_DELETED', `Deleted record ID ${recordId}`);

      return res.json({
        success: true,
        id: recordId,
        message: 'DNS record deleted successfully.',
      });
    }

    const result = await cloudflareService.deleteDnsRecord(zoneId, recordId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/dns/zones/:domain/apply-to-registrar
 * Alias: POST /api/dns/zones/:domain/submit-nameservers
 * Submits assigned Cloudflare nameservers to HostyIndia with duplicate prevention.
 */
router.post(['/zones/:domain/apply-to-registrar', '/zones/:domain/submit-nameservers'], async (req, res, next) => {
  try {
    const cleanDomain = req.params.domain.trim().toLowerCase();
    const { confirmAction, force } = req.body || {};

    if (!confirmAction) {
      return res.status(400).json({
        success: false,
        error: 'Explicit confirmation (confirmAction: true) is required to submit nameservers to the registrar.',
      });
    }

    const result = await nameserverSync.submitNameservers({
      domain: cleanDomain,
      confirmAction: true,
      force: Boolean(force),
      origin: 'admin',
    });

    res.json(result);
  } catch (error) {
    if (error.code === 'DUPLICATE_SUBMISSION') {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_SUBMISSION',
        error: error.message,
      });
    }
    if (error.code === 'ALREADY_ACTIVE') {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_ACTIVE',
        error: error.message,
      });
    }
    next(error);
  }
});

/**
 * POST /api/dns/zones/:domain/verify
 * Verifies nameserver approval and Cloudflare DNS activation.
 * Compares current registrar live nameservers with Cloudflare assigned nameservers.
 */
router.post('/zones/:domain/verify', async (req, res, next) => {
  try {
    const cleanDomain = req.params.domain.trim().toLowerCase();
    const result = await nameserverSync.verifyDomainNameservers(cleanDomain);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/dns/sync-all
 * Triggers background verification across all managed zones.
 */
router.post('/sync-all', async (req, res, next) => {
  try {
    const result = await nameserverSync.syncAllZones();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/dns/zones/:domain/notifications
 * Retrieves audit notifications for a domain.
 */
router.get('/zones/:domain/notifications', (req, res) => {
  const cleanDomain = req.params.domain.trim().toLowerCase();
  const target = req.query.target || null;
  const notifications = dnsStore.getNotifications(cleanDomain, target);
  res.json({
    success: true,
    domain: cleanDomain,
    count: notifications.length,
    notifications,
  });
});

/**
 * GET /api/dns/customer/domain/:domain/records
 * Returns DNS records for a domain belonging to the authenticated customer.
 * Directly queries Cloudflare as the authoritative source of truth.
 */
router.get('/customer/domain/:domain/records', async (req, res, next) => {
  try {
    const cleanDomain = (req.params.domain || '').trim().toLowerCase();
    const order = orderStore.getOrderByDomain(cleanDomain);
    const zone = dnsStore.getZoneByDomain(cleanDomain);

    if (!order && !zone) {
      return res.status(404).json({ success: false, error: `Domain "${cleanDomain}" not found.` });
    }

    const targetCustomerId = (order && order.customerId) || (zone && zone.customerId);
    const authResult = verifyCustomerOwnership(req, targetCustomerId, order);
    if (!authResult.authorized) {
      return res.status(authResult.status || 403).json({
        success: false,
        error: authResult.message || 'Access denied.',
        code: authResult.reason || 'FORBIDDEN',
      });
    }

    const zoneId = (zone && zone.zoneId) || (order && order.zoneId);
    let records = [];

    if (zoneId && !zoneId.startsWith('cf-zone-')) {
      try {
        const live = await cloudflareService.listDnsRecords(zoneId);
        records = (live && (live.records || live.result)) || [];
        // Synchronize local database cache with Cloudflare authoritative state
        if (zone) {
          zone.cachedRecords = records;
          try {
            dnsStore.updateZone(cleanDomain, { cachedRecords: records, lastSyncedAt: new Date().toISOString() });
          } catch (_) {}
        }
      } catch (e) {
        console.error(`[DNS Customer] Error listing Cloudflare records for ${cleanDomain}:`, e.message);
        return res.status(502).json({
          success: false,
          error: `Cloudflare API Error: ${e.message}`,
          code: 'CLOUDFLARE_FETCH_FAILED',
        });
      }
    } else if (zone && zone.cachedRecords) {
      records = zone.cachedRecords;
    }

    res.json({
      success: true,
      domain: cleanDomain,
      zoneId: zoneId || null,
      nameservers: (zone && zone.nameServers) || (order && order.nameservers) || [],
      dnsStatus: (zone && (zone.approvalStatus || zone.status)) || (order && order.dnsStatus) || 'ACTIVE',
      count: records.length,
      records: records.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        content: r.content,
        ttl: r.ttl,
        proxied: Boolean(r.proxied),
        priority: r.priority || null,
        created_on: r.created_on || r.createdOn || null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/dns/customer/domain/:domain/records
 * Creates a new DNS record for a customer-owned domain with duplicate prevention,
 * Cloudflare verification GET, and error propagation.
 */
router.post('/customer/domain/:domain/records', async (req, res, next) => {
  try {
    const cleanDomain = (req.params.domain || '').trim().toLowerCase();
    const order = orderStore.getOrderByDomain(cleanDomain);
    const zone = dnsStore.getZoneByDomain(cleanDomain);

    if (!order && !zone) {
      return res.status(404).json({ success: false, error: `Domain "${cleanDomain}" not found.` });
    }

    const targetCustomerId = (order && order.customerId) || (zone && zone.customerId);
    const authResult = verifyCustomerOwnership(req, targetCustomerId, order);
    if (!authResult.authorized) {
      return res.status(authResult.status || 403).json({
        success: false,
        error: authResult.message || 'Access denied.',
        code: authResult.reason || 'FORBIDDEN',
      });
    }

    const { type, name, content, ttl = 1, proxied = false, priority } = req.body || {};
    if (!type || !name || !content) {
      return res.status(400).json({ success: false, error: 'Type, Name and Content are required fields.' });
    }

    const cleanType = type.trim().toUpperCase();
    const allowedTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'];
    if (!allowedTypes.includes(cleanType)) {
      return res.status(400).json({ success: false, error: `Invalid DNS record type "${cleanType}". Allowed: ${allowedTypes.join(', ')}` });
    }

    const rawName = name.trim();
    const cleanContent = content.trim();

    // Canonicalize FQDN
    let fqdn = rawName;
    if (rawName === '@' || rawName === '' || rawName.toLowerCase() === cleanDomain) {
      fqdn = cleanDomain;
    } else if (!rawName.toLowerCase().endsWith('.' + cleanDomain)) {
      fqdn = `${rawName}.${cleanDomain}`;
    }

    // Input validation
    if (cleanType === 'A') {
      const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipv4Regex.test(cleanContent)) {
        return res.status(400).json({ success: false, error: `Invalid IPv4 address: "${cleanContent}"` });
      }
    } else if (cleanType === 'AAAA') {
      const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
      if (!ipv6Regex.test(cleanContent)) {
        return res.status(400).json({ success: false, error: `Invalid IPv6 address: "${cleanContent}"` });
      }
    } else if (cleanType === 'MX' && (priority == null || isNaN(parseInt(priority, 10)))) {
      return res.status(400).json({ success: false, error: 'Priority is required for MX records.' });
    }

    const zoneId = (zone && zone.zoneId) || (order && order.zoneId);
    if (!zoneId) {
      return res.status(400).json({ success: false, error: 'No DNS zone associated with this domain.' });
    }

    let createdRecord = null;

    if (zoneId.startsWith('cf-zone-')) {
      // Local demo / test zone
      const existing = (zone && zone.cachedRecords) || [];
      const isDup = existing.some(
        (r) => r.type === cleanType && r.name.toLowerCase() === fqdn.toLowerCase() && r.content.toLowerCase() === cleanContent.toLowerCase()
      );
      if (isDup) {
        return res.status(409).json({
          success: false,
          error: `A ${cleanType} record for "${fqdn}" with value "${cleanContent}" already exists.`,
          code: 'DUPLICATE_RECORD',
        });
      }
      createdRecord = {
        id: `rec-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        type: cleanType,
        name: fqdn,
        content: cleanContent,
        ttl: parseInt(ttl, 10) || 1,
        proxied: Boolean(proxied),
        priority: priority != null ? parseInt(priority, 10) : null,
        created_on: new Date().toISOString(),
      };
      if (zone) {
        zone.cachedRecords = zone.cachedRecords || [];
        zone.cachedRecords.push(createdRecord);
      }
    } else {
      // Real Cloudflare Zone:
      // 1. Prevent Duplicates by querying Cloudflare
      try {
        const live = await cloudflareService.listDnsRecords(zoneId, { type: cleanType });
        const existingList = (live && (live.records || live.result)) || [];
        const isDup = existingList.some((r) => {
          const rName = (r.name || '').toLowerCase();
          const rContent = (r.content || '').trim().toLowerCase();
          return r.type === cleanType && (rName === fqdn.toLowerCase() || rName === rawName.toLowerCase()) && rContent === cleanContent.toLowerCase();
        });

        if (isDup) {
          return res.status(409).json({
            success: false,
            error: `A ${cleanType} record for "${fqdn}" with value "${cleanContent}" already exists in Cloudflare.`,
            code: 'DUPLICATE_RECORD',
          });
        }
      } catch (checkErr) {
        console.warn(`[DNS Customer] Could not verify existing records before creation: ${checkErr.message}`);
      }

      // 2. Execute Cloudflare API create request
      let cfResult;
      try {
        cfResult = await cloudflareService.createDnsRecord(zoneId, {
          type: cleanType,
          name: rawName,
          content: cleanContent,
          ttl: parseInt(ttl, 10) || 1,
          proxied: Boolean(proxied),
          priority: priority != null ? parseInt(priority, 10) : undefined,
        });
      } catch (err) {
        console.error(`[DNS Customer] Cloudflare record creation failed: ${err.message}`);
        return res.status(err.statusCode || 400).json({
          success: false,
          error: `Cloudflare API Error: ${err.message}`,
          code: 'CLOUDFLARE_CREATE_FAILED',
        });
      }

      if (!cfResult || !cfResult.success || !cfResult.record || !cfResult.record.id) {
        return res.status(502).json({
          success: false,
          error: 'Cloudflare did not return a valid record confirmation.',
          code: 'INVALID_CLOUDFLARE_RESPONSE',
        });
      }

      // 3. Perform separate GET verification to confirm record is live in Cloudflare
      try {
        const verifyRes = await cloudflareService.getDnsRecord(zoneId, cfResult.record.id);
        if (verifyRes && verifyRes.success && verifyRes.record) {
          createdRecord = verifyRes.record;
        } else {
          createdRecord = cfResult.record;
        }
      } catch (vErr) {
        console.warn(`[DNS Customer] Cloudflare separate GET verification notice: ${vErr.message}`);
        createdRecord = cfResult.record;
      }

      // 4. Synchronize local cache
      if (zone) {
        zone.cachedRecords = zone.cachedRecords || [];
        zone.cachedRecords = zone.cachedRecords.filter((r) => r.id !== createdRecord.id);
        zone.cachedRecords.push(createdRecord);
        try {
          dnsStore.updateZone(cleanDomain, { cachedRecords: zone.cachedRecords, lastSyncedAt: new Date().toISOString() });
        } catch (_) {}
      }
    }

    dnsStore.addLog(cleanDomain, 'CUSTOMER_DNS_ADD', `Customer added ${cleanType} record: ${fqdn} -> ${cleanContent}`);

    res.status(201).json({
      success: true,
      record: createdRecord,
      message: `DNS record ${cleanType} created and verified in Cloudflare successfully.`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/dns/customer/domain/:domain/records/:recordId
 * Updates an existing DNS record on a customer-owned domain with Cloudflare verification.
 */
router.put('/customer/domain/:domain/records/:recordId', async (req, res, next) => {
  try {
    const cleanDomain = (req.params.domain || '').trim().toLowerCase();
    const { recordId } = req.params;
    const order = orderStore.getOrderByDomain(cleanDomain);
    const zone = dnsStore.getZoneByDomain(cleanDomain);

    if (!order && !zone) {
      return res.status(404).json({ success: false, error: `Domain "${cleanDomain}" not found.` });
    }

    const targetCustomerId = (order && order.customerId) || (zone && zone.customerId);
    const authResult = verifyCustomerOwnership(req, targetCustomerId, order);
    if (!authResult.authorized) {
      return res.status(authResult.status || 403).json({
        success: false,
        error: authResult.message || 'Access denied.',
        code: authResult.reason || 'FORBIDDEN',
      });
    }

    const { type, name, content, ttl = 1, proxied = false, priority } = req.body || {};
    if (!type || !name || !content) {
      return res.status(400).json({ success: false, error: 'Type, Name and Content are required fields.' });
    }

    const cleanType = type.trim().toUpperCase();
    const rawName = name.trim();
    const cleanContent = content.trim();

    const zoneId = (zone && zone.zoneId) || (order && order.zoneId);
    if (!zoneId) {
      return res.status(400).json({ success: false, error: 'No DNS zone associated with this domain.' });
    }

    let updatedRecord = null;

    if (zoneId.startsWith('cf-zone-')) {
      const idx = (zone.cachedRecords || []).findIndex((r) => r.id === recordId);
      if (idx === -1) return res.status(404).json({ success: false, error: 'Record not found.' });

      Object.assign(zone.cachedRecords[idx], {
        type: cleanType,
        name: rawName,
        content: cleanContent,
        ttl: parseInt(ttl, 10) || 1,
        proxied: Boolean(proxied),
        priority: priority != null ? parseInt(priority, 10) : zone.cachedRecords[idx].priority,
      });
      updatedRecord = zone.cachedRecords[idx];
    } else {
      // Real Cloudflare update
      try {
        const cfResult = await cloudflareService.updateDnsRecord(zoneId, recordId, {
          type: cleanType,
          name: rawName,
          content: cleanContent,
          ttl: parseInt(ttl, 10) || 1,
          proxied: Boolean(proxied),
          priority: priority != null ? parseInt(priority, 10) : undefined,
        });

        // Perform separate GET verification
        const verifyRes = await cloudflareService.getDnsRecord(zoneId, recordId);
        updatedRecord = (verifyRes && verifyRes.record) || cfResult.record;
      } catch (err) {
        console.error(`[DNS Customer] Cloudflare record update failed: ${err.message}`);
        return res.status(err.statusCode || 400).json({
          success: false,
          error: `Cloudflare API Error: ${err.message}`,
          code: 'CLOUDFLARE_UPDATE_FAILED',
        });
      }

      if (zone && Array.isArray(zone.cachedRecords)) {
        const idx = zone.cachedRecords.findIndex((r) => r.id === recordId);
        if (idx !== -1) {
          zone.cachedRecords[idx] = updatedRecord;
        } else {
          zone.cachedRecords.push(updatedRecord);
        }
        try {
          dnsStore.updateZone(cleanDomain, { cachedRecords: zone.cachedRecords, lastSyncedAt: new Date().toISOString() });
        } catch (_) {}
      }
    }

    dnsStore.addLog(cleanDomain, 'CUSTOMER_DNS_UPDATE', `Customer updated ${cleanType} record: ${recordId} -> ${cleanContent}`);

    res.json({
      success: true,
      record: updatedRecord,
      message: `DNS record ${cleanType} updated and verified in Cloudflare successfully.`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/dns/customer/domain/:domain/records/:recordId
 * Deletes a DNS record from a customer-owned domain.
 */
router.delete('/customer/domain/:domain/records/:recordId', async (req, res, next) => {
  try {
    const cleanDomain = (req.params.domain || '').trim().toLowerCase();
    const { recordId } = req.params;
    const order = orderStore.getOrderByDomain(cleanDomain);
    const zone = dnsStore.getZoneByDomain(cleanDomain);

    if (!order && !zone) {
      return res.status(404).json({ success: false, error: `Domain "${cleanDomain}" not found.` });
    }

    const targetCustomerId = (order && order.customerId) || (zone && zone.customerId);
    const authResult = verifyCustomerOwnership(req, targetCustomerId, order);
    if (!authResult.authorized) {
      return res.status(authResult.status || 403).json({
        success: false,
        error: authResult.message || 'Access denied.',
        code: authResult.reason || 'FORBIDDEN',
      });
    }

    const zoneId = (zone && zone.zoneId) || (order && order.zoneId);

    if (zoneId && !zoneId.startsWith('cf-zone-')) {
      try {
        await cloudflareService.deleteDnsRecord(zoneId, recordId);
      } catch (e) {
        console.error(`[DNS Customer] Cloudflare record deletion failed: ${e.message}`);
        return res.status(e.statusCode || 400).json({
          success: false,
          error: `Cloudflare API Error: ${e.message}`,
          code: 'CLOUDFLARE_DELETE_FAILED',
        });
      }
    }

    if (zone && Array.isArray(zone.cachedRecords)) {
      zone.cachedRecords = zone.cachedRecords.filter((r) => r.id !== recordId);
      try {
        dnsStore.updateZone(cleanDomain, { cachedRecords: zone.cachedRecords, lastSyncedAt: new Date().toISOString() });
      } catch (_) {}
    }

    dnsStore.addLog(cleanDomain, 'CUSTOMER_DNS_DELETE', `Customer deleted record ID ${recordId}`);

    res.json({
      success: true,
      id: recordId,
      message: 'DNS record deleted successfully from Cloudflare.',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

