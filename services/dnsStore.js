const { getDb } = require('./db');

/**
 * WebNavi DNS Zone Store (SQLite Persisted)
 * Manages Cloudflare DNS zones with persistent SQLite storage.
 */
class DnsStore {
  constructor(customDb = null) {
    this.db = customDb || getDb();
    if (process.env.SEED_DEMO_DATA === 'true') {
      this._seedDemoZone();
    }
  }

  _seedDemoZone() {
    const domain = 'theartisanspice.com';
    const existing = this.getZoneByDomain(domain);
    if (existing) return;

    const now = new Date();
    const reqTime = new Date(Date.now() - 3600000).toISOString();

    const demo = {
      zoneId: 'cf-zone-84920-artisan',
      domain,
      orderId: 'ORD-WN-84920',
      customerId: 'wn84920-demo-artisan',
      status: 'pending',
      nameServers: ['amy.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      registrarNameServers: [],
      approvalStatus: 'PENDING_APPROVAL',
      requestDate: reqTime,
      lastVerificationTime: now.toISOString(),
      latestRegistrarResponse: {
        success: true,
        approval_status: 'pending',
        is_pending: true,
        message: 'Nameserver change request submitted successfully and is pending HostyIndia Administrator approval.',
      },
      verificationFailCount: 0,
      nameserversSubmittedToRegistrar: true,
      nameserverApprovalStatus: 'pending',
      lastSyncedAt: now.toISOString(),
      createdAt: now.toISOString(),
      cachedRecords: [
        {
          id: 'rec-1',
          type: 'A',
          name: 'theartisanspice.com',
          content: '103.126.34.39',
          ttl: 1,
          proxied: true,
          comment: 'WebNavi Production LiteSpeed Node',
        },
        {
          id: 'rec-2',
          type: 'CNAME',
          name: 'www.theartisanspice.com',
          content: 'theartisanspice.com',
          ttl: 1,
          proxied: true,
          comment: 'Root canonical alias',
        },
        {
          id: 'rec-3',
          type: 'TXT',
          name: 'theartisanspice.com',
          content: 'v=spf1 include:_spf.webnavi.net ~all',
          ttl: 3600,
          proxied: false,
          comment: 'SPF email validation',
        },
      ],
      notifications: [
        {
          id: 'notif-1',
          type: 'NS_SUBMITTED',
          title: 'Nameserver Update Submitted',
          message: 'Cloudflare nameservers (amy.ns.cloudflare.com, bob.ns.cloudflare.com) submitted to HostyIndia for theartisanspice.com. Status: Pending Administrator Approval.',
          timestamp: reqTime,
          target: 'both',
          read: false,
        },
      ],
      logs: [
        {
          timestamp: now.toISOString(),
          action: 'ZONE_ATTACHED',
          message: 'Zone attached to order ORD-WN-84920 with Cloudflare nameservers amy.ns.cloudflare.com, bob.ns.cloudflare.com',
        },
        {
          timestamp: reqTime,
          action: 'NAMESERVERS_SUBMITTED',
          message: 'Nameservers submitted to HostyIndia for administrator approval.',
        },
      ],
    };

    this._insertZone(demo);
  }

  _deserialize(row) {
    if (!row) return null;
    return {
      domain: row.domain,
      zoneId: row.zone_id,
      orderId: row.order_id,
      customerId: row.customer_id,
      status: row.status,
      nameServers: row.nameservers_json ? JSON.parse(row.nameservers_json) : [],
      registrarNameServers: row.registrar_nameservers_json ? JSON.parse(row.registrar_nameservers_json) : [],
      nameserversSubmittedToRegistrar: Boolean(row.nameservers_submitted_to_registrar),
      nameserverApprovalStatus: row.nameserver_approval_status,
      approvalStatus: row.approval_status,
      requestDate: row.request_date,
      lastVerificationTime: row.last_verification_time,
      latestRegistrarResponse: row.latest_registrar_response_json ? JSON.parse(row.latest_registrar_response_json) : null,
      verificationFailCount: row.verification_fail_count || 0,
      createdAt: row.created_at,
      lastSyncedAt: row.last_synced_at,
      cachedRecords: row.cached_records_json ? JSON.parse(row.cached_records_json) : [],
      notifications: row.notifications_json ? JSON.parse(row.notifications_json) : [],
      logs: row.logs_json ? JSON.parse(row.logs_json) : [],
      recordsCount: row.cached_records_json ? JSON.parse(row.cached_records_json).length : 0,
    };
  }

  _insertZone(zone) {
    const stmt = this.db.prepare(`
      INSERT INTO dns_zones (
        domain, zone_id, order_id, customer_id, status,
        nameservers_json, registrar_nameservers_json,
        nameservers_submitted_to_registrar, nameserver_approval_status,
        approval_status, request_date, last_verification_time,
        latest_registrar_response_json, verification_fail_count,
        created_at, last_synced_at, cached_records_json,
        notifications_json, logs_json
      ) VALUES (
        @domain, @zoneId, @orderId, @customerId, @status,
        @nameserversJson, @registrarNameserversJson,
        @nameserversSubmittedToRegistrar, @nameserverApprovalStatus,
        @approvalStatus, @requestDate, @lastVerificationTime,
        @latestRegistrarResponseJson, @verificationFailCount,
        @createdAt, @lastSyncedAt, @cachedRecordsJson,
        @notificationsJson, @logsJson
      )
    `);

    stmt.run({
      domain: zone.domain.trim().toLowerCase(),
      zoneId: zone.zoneId || null,
      orderId: zone.orderId || null,
      customerId: zone.customerId || null,
      status: zone.status || 'pending',
      nameserversJson: JSON.stringify(zone.nameServers || []),
      registrarNameserversJson: JSON.stringify(zone.registrarNameServers || []),
      nameserversSubmittedToRegistrar: zone.nameserversSubmittedToRegistrar ? 1 : 0,
      nameserverApprovalStatus: zone.nameserverApprovalStatus || 'none',
      approvalStatus: zone.approvalStatus || 'NOT_SUBMITTED',
      requestDate: zone.requestDate || null,
      lastVerificationTime: zone.lastVerificationTime || null,
      latestRegistrarResponseJson: zone.latestRegistrarResponse ? JSON.stringify(zone.latestRegistrarResponse) : null,
      verificationFailCount: zone.verificationFailCount || 0,
      createdAt: zone.createdAt || new Date().toISOString(),
      lastSyncedAt: zone.lastSyncedAt || new Date().toISOString(),
      cachedRecordsJson: JSON.stringify(zone.cachedRecords || []),
      notificationsJson: JSON.stringify(zone.notifications || []),
      logsJson: JSON.stringify(zone.logs || []),
    });
  }

  getAllZones() {
    const rows = this.db.prepare('SELECT * FROM dns_zones ORDER BY created_at DESC').all();
    return rows.map((r) => this._deserialize(r));
  }

  getZoneByDomain(domain) {
    if (!domain) return null;
    const clean = domain.trim().toLowerCase();
    const row = this.db.prepare('SELECT * FROM dns_zones WHERE domain = ?').get(clean);
    return this._deserialize(row);
  }

  getZoneById(zoneId) {
    if (!zoneId) return null;
    const row = this.db.prepare('SELECT * FROM dns_zones WHERE zone_id = ?').get(zoneId);
    return this._deserialize(row);
  }

  getZonesByCustomerId(customerId) {
    if (!customerId) return [];
    const rows = this.db.prepare('SELECT * FROM dns_zones WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
    return rows.map((r) => this._deserialize(r));
  }

  upsertZone({
    zoneId,
    domain,
    orderId = null,
    customerId = null,
    status = 'pending',
    nameServers = [],
    nameserversSubmittedToRegistrar = false,
    nameserverApprovalStatus = 'none',
    approvalStatus = 'NOT_SUBMITTED',
    registrarNameServers = [],
    requestDate = null,
    lastVerificationTime = null,
    latestRegistrarResponse = null,
    verificationFailCount = 0,
  }) {
    const cleanDomain = domain.trim().toLowerCase();
    const existing = this.getZoneByDomain(cleanDomain);
    const now = new Date().toISOString();

    const record = {
      zoneId: zoneId || (existing ? existing.zoneId : `cf-zone-${Date.now()}`),
      domain: cleanDomain,
      orderId: orderId || (existing ? existing.orderId : null),
      customerId: customerId || (existing ? existing.customerId : null),
      status: status || (existing ? existing.status : 'pending'),
      nameServers: (nameServers && nameServers.length > 0) ? nameServers : (existing ? existing.nameServers : []),
      registrarNameServers: (registrarNameServers && registrarNameServers.length > 0) ? registrarNameServers : (existing ? (existing.registrarNameServers || []) : []),
      nameserversSubmittedToRegistrar: nameserversSubmittedToRegistrar ?? (existing ? existing.nameserversSubmittedToRegistrar : false),
      nameserverApprovalStatus: nameserverApprovalStatus || (existing ? existing.nameserverApprovalStatus : 'none'),
      approvalStatus: approvalStatus || (existing ? existing.approvalStatus : 'NOT_SUBMITTED'),
      requestDate: requestDate || (existing ? existing.requestDate : null),
      lastVerificationTime: lastVerificationTime || (existing ? existing.lastVerificationTime : null),
      latestRegistrarResponse: latestRegistrarResponse || (existing ? existing.latestRegistrarResponse : null),
      verificationFailCount: verificationFailCount != null ? verificationFailCount : (existing ? (existing.verificationFailCount || 0) : 0),
      createdAt: existing ? existing.createdAt : now,
      lastSyncedAt: now,
      cachedRecords: existing ? existing.cachedRecords : [],
      notifications: existing ? (existing.notifications || []) : [],
      logs: existing ? existing.logs : [
        {
          timestamp: now,
          action: 'ZONE_CREATED',
          message: `Cloudflare DNS zone tracked for domain "${cleanDomain}".`,
        },
      ],
    };

    if (existing) {
      this.updateZone(cleanDomain, record);
    } else {
      this._insertZone(record);
    }

    return record;
  }

  updateZone(domain, updates) {
    const existing = this.getZoneByDomain(domain);
    if (!existing) return null;

    const merged = { ...existing, ...updates, lastSyncedAt: new Date().toISOString() };

    const stmt = this.db.prepare(`
      UPDATE dns_zones SET
        zone_id = @zoneId,
        order_id = @orderId,
        customer_id = @customerId,
        status = @status,
        nameservers_json = @nameserversJson,
        registrar_nameservers_json = @registrarNameserversJson,
        nameservers_submitted_to_registrar = @nameserversSubmittedToRegistrar,
        nameserver_approval_status = @nameserverApprovalStatus,
        approval_status = @approvalStatus,
        request_date = @requestDate,
        last_verification_time = @lastVerificationTime,
        latest_registrar_response_json = @latestRegistrarResponseJson,
        verification_fail_count = @verificationFailCount,
        last_synced_at = @lastSyncedAt,
        cached_records_json = @cachedRecordsJson,
        notifications_json = @notificationsJson,
        logs_json = @logsJson
      WHERE domain = @domain
    `);

    stmt.run({
      domain: merged.domain.trim().toLowerCase(),
      zoneId: merged.zoneId || null,
      orderId: merged.orderId || null,
      customerId: merged.customerId || null,
      status: merged.status || 'pending',
      nameserversJson: JSON.stringify(merged.nameServers || []),
      registrarNameserversJson: JSON.stringify(merged.registrarNameServers || []),
      nameserversSubmittedToRegistrar: merged.nameserversSubmittedToRegistrar ? 1 : 0,
      nameserverApprovalStatus: merged.nameserverApprovalStatus || 'none',
      approvalStatus: merged.approvalStatus || 'NOT_SUBMITTED',
      requestDate: merged.requestDate || null,
      lastVerificationTime: merged.lastVerificationTime || null,
      latestRegistrarResponseJson: merged.latestRegistrarResponse ? JSON.stringify(merged.latestRegistrarResponse) : null,
      verificationFailCount: merged.verificationFailCount || 0,
      lastSyncedAt: merged.lastSyncedAt || new Date().toISOString(),
      cachedRecordsJson: JSON.stringify(merged.cachedRecords || []),
      notificationsJson: JSON.stringify(merged.notifications || []),
      logsJson: JSON.stringify(merged.logs || []),
    });

    return merged;
  }

  addNotification(domain, notif) {
    const zone = this.getZoneByDomain(domain);
    if (!zone) return null;

    const notifications = zone.notifications || [];
    const notification = {
      id: notif.id || `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type: notif.type || 'INFO',
      title: notif.title || 'Notification',
      message: notif.message || '',
      timestamp: notif.timestamp || new Date().toISOString(),
      target: notif.target || 'both',
      read: Boolean(notif.read),
    };
    notifications.unshift(notification);

    this.updateZone(domain, { notifications });
    return notification;
  }

  getNotifications(domain, target = null) {
    const zone = this.getZoneByDomain(domain);
    if (!zone) return [];
    let list = zone.notifications || [];
    if (target) {
      list = list.filter((n) => n.target === 'both' || n.target === target);
    }
    return list;
  }

  addLog(domain, action, message) {
    const zone = this.getZoneByDomain(domain);
    if (!zone) return null;

    const logs = zone.logs || [];
    logs.push({
      timestamp: new Date().toISOString(),
      action,
      message,
    });

    this.updateZone(domain, { logs });
    return this.getZoneByDomain(domain);
  }
}

const dnsStore = new DnsStore();
module.exports = dnsStore;
module.exports.DnsStore = DnsStore;
