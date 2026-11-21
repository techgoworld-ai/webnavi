/**
 * WebNavi Visitor Tracking & Privacy Consent Engine
 * 
 * Strict Privacy & Compliance Rules:
 * - Pseudonymous visitor IDs (VIS-xxxx)
 * - Session-based visit counting with 30-minute inactivity timeout
 * - No browser fingerprinting, no permanent IP identification (IPs masked)
 * - Granular cookie consent enforcement (Necessary, Functional, Analytics, Marketing)
 * - If optional tracking is rejected, persistent analytics identifiers are NOT stored
 * - Bot filtering (known bots flagged and excluded from ordinary visitor metrics)
 * - Direct SQLite persistence with strict foreign key / index optimizations
 */

const crypto = require('crypto');
const { getDb } = require('./db');

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity timeout

/**
 * Masks an IP address for privacy-conscious storage.
 * IPv4: replaces last octet with 'xxx' (e.g., 192.168.1.xxx)
 * IPv6: replaces lower 64 bits with 'xxxx'
 */
function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return '0.0.0.xxx';
  let cleaned = ip.trim();
  // Strip IPv6-mapped IPv4 prefix (::ffff:192.168.1.1)
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.substring(7);
  }

  if (cleaned.includes('.')) {
    // IPv4
    const parts = cleaned.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    }
  } else if (cleaned.includes(':')) {
    // IPv6
    const parts = cleaned.split(':');
    if (parts.length >= 3) {
      return `${parts.slice(0, 3).join(':')}::xxxx`;
    }
  }
  return '0.0.0.xxx';
}

/**
 * Parses user agent into device category, browser category, and bot indicator.
 */
function parseDeviceAndBrowser(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return { device: 'Desktop', browser: 'Other', isBot: 0 };
  }

  const ua = userAgent.toLowerCase();

  // Known bot/crawler detection
  const isBot = /bot|crawler|spider|slurp|facebookexternalhit|bingpreview|headless|phantomjs/i.test(ua) ? 1 : 0;

  // Device classification
  let device = 'Desktop';
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    device = 'Tablet';
  } else if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile|webos/i.test(ua)) {
    device = 'Mobile';
  }

  // Browser classification
  let browser = 'Other';
  if (/edg([ea]|ios)?\//i.test(ua)) {
    browser = 'Edge';
  } else if (/opr\/|opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/chrome|crios/i.test(ua)) {
    browser = 'Chrome';
  } else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) {
    browser = 'Safari';
  } else if (/firefox|fxios/i.test(ua)) {
    browser = 'Firefox';
  }

  return { device, browser, isBot };
}

class VisitorTrackingService {
  constructor(customDb = null) {
    this._db = customDb;
  }

  get db() {
    return this._db || getDb();
  }

  /**
   * Generates a pseudonymous visitor ID (e.g. VIS-9f8a12b4)
   */
  generateVisitorId() {
    return 'VIS-' + crypto.randomBytes(4).toString('hex');
  }

  /**
   * Generates a session ID (e.g. SES-173132...)
   */
  generateSessionId() {
    return 'SES-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
  }

  /**
   * Records a page view and manages visitor / session state with 30-min inactivity rule.
   */
  recordPageView(params = {}) {
    const {
      visitorId: rawVisitorId,
      sessionId: rawSessionId,
      path: rawPath = '/',
      title = 'WebNavi',
      referrer = '',
      userAgent = '',
      ip = '',
      customerId = null,
      consent = null,
    } = params;

    const path = typeof rawPath === 'string' && rawPath ? rawPath.trim() : '/';
    const now = new Date();
    const nowIso = now.toISOString();
    const ipMasked = maskIp(ip);
    const { device, browser, isBot } = parseDeviceAndBrowser(userAgent);

    // PRIVACY INVARIANT: If optional analytics consent was rejected, do NOT persist optional tracking
    const isAnalyticsExplicitlyRejected = consent && (
      consent.status === 'rejected_optional' ||
      (consent.preferences && consent.preferences.analytics === false)
    );

    if (isAnalyticsExplicitlyRejected) {
      return {
        success: true,
        trackingDisabled: true,
        reason: 'Optional analytics consent rejected by user',
        timestamp: nowIso,
      };
    }

    // Verify and sanitize customer ID (only link genuine authenticated accounts)
    const validCustomerId = this.validateCustomerId(customerId);

    let visitorId = rawVisitorId ? rawVisitorId.trim() : null;
    let sessionId = rawSessionId ? rawSessionId.trim() : null;

    let isNewVisitor = false;
    let isNewSession = false;

    // Check if visitor exists in database
    let visitor = null;
    if (visitorId) {
      visitor = this.db.prepare('SELECT * FROM visitors WHERE visitor_id = ?').get(visitorId);
    }

    if (!visitor) {
      // Create new visitor
      isNewVisitor = true;
      isNewSession = true;
      if (!visitorId) {
        visitorId = this.generateVisitorId();
      }
      sessionId = this.generateSessionId();

      const consentStatus = consent && consent.status ? consent.status : 'pending';
      const consentPrefs = consent && consent.preferences ? JSON.stringify(consent.preferences) : '{"necessary":true,"functional":false,"analytics":false,"marketing":false}';

      this.db.prepare(`
        INSERT INTO visitors (
          visitor_id, customer_id, first_visit_at, last_visit_at,
          total_visits, total_page_views, device_category, browser_category,
          consent_status, consent_preferences_json, consent_updated_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        visitorId,
        validCustomerId,
        nowIso,
        nowIso,
        device,
        browser,
        consentStatus,
        consentPrefs,
        consent ? nowIso : null,
        nowIso,
        nowIso
      );

      // Create initial session #1
      this.db.prepare(`
        INSERT INTO visitor_sessions (
          session_id, visitor_id, session_number, started_at, last_activity_at,
          page_views_count, entry_page, exit_page, device_category, browser_category,
          ip_masked, user_agent, is_bot
        ) VALUES (?, ?, 1, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        visitorId,
        nowIso,
        nowIso,
        path,
        path,
        device,
        browser,
        ipMasked,
        userAgent.substring(0, 255),
        isBot
      );

    } else {
      // Existing visitor returning
      // Check session
      let session = null;
      if (sessionId) {
        session = this.db.prepare('SELECT * FROM visitor_sessions WHERE session_id = ? AND visitor_id = ?').get(sessionId, visitorId);
      }

      let sessionActive = false;
      if (session) {
        const lastActTime = new Date(session.last_activity_at).getTime();
        const diff = now.getTime() - lastActTime;
        if (diff < SESSION_TIMEOUT_MS) {
          sessionActive = true;
        }
      }

      if (sessionActive && session) {
        // Same active session (<30 mins since last activity)
        // Refresh session activity & page view count
        isNewSession = false;

        this.db.prepare(`
          UPDATE visitor_sessions
          SET last_activity_at = ?,
              page_views_count = page_views_count + 1,
              exit_page = ?
          WHERE session_id = ?
        `).run(nowIso, path, session.session_id);

        // Update visitor total page views
        this.db.prepare(`
          UPDATE visitors
          SET last_visit_at = ?,
              total_page_views = total_page_views + 1,
              customer_id = COALESCE(customer_id, ?),
              updated_at = ?
          WHERE visitor_id = ?
        `).run(nowIso, validCustomerId, nowIso, visitorId);

      } else {
        // Session expired (>=30 mins) or new session!
        // Increment visitor total_visits by 1
        isNewSession = true;
        const newTotalVisits = (visitor.total_visits || 1) + 1;
        sessionId = this.generateSessionId();

        // Create new session record
        this.db.prepare(`
          INSERT INTO visitor_sessions (
            session_id, visitor_id, session_number, started_at, last_activity_at,
            page_views_count, entry_page, exit_page, device_category, browser_category,
            ip_masked, user_agent, is_bot
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sessionId,
          visitorId,
          newTotalVisits,
          nowIso,
          nowIso,
          path,
          path,
          device,
          browser,
          ipMasked,
          userAgent.substring(0, 255),
          isBot
        );

        // Update visitor total visits and total page views
        this.db.prepare(`
          UPDATE visitors
          SET last_visit_at = ?,
              total_visits = ?,
              total_page_views = total_page_views + 1,
              customer_id = COALESCE(customer_id, ?),
              updated_at = ?
          WHERE visitor_id = ?
        `).run(nowIso, newTotalVisits, validCustomerId, nowIso, visitorId);
      }
    }

    // Insert page view record
    this.db.prepare(`
      INSERT INTO visitor_pageviews (
        session_id, visitor_id, page_path, page_title, referrer, viewed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      visitorId,
      path,
      (title || '').substring(0, 150),
      (referrer || '').substring(0, 255),
      nowIso
    );

    return {
      success: true,
      visitorId,
      sessionId,
      isNewVisitor,
      isNewSession,
      timestamp: nowIso,
    };
  }

  /**
   * Records a user's cookie consent choice in database.
   */
  recordConsent(params = {}) {
    const {
      visitorId,
      customerId = null,
      action = 'customize',
      preferences = {},
      userAgent = '',
      ip = '',
    } = params;

    const nowIso = new Date().toISOString();
    const ipMasked = maskIp(ip);

    const necessary = 1; // Always enabled
    const functional = preferences.functional ? 1 : 0;
    const analytics = preferences.analytics ? 1 : 0;
    const marketing = preferences.marketing ? 1 : 0;

    let consentStatus = 'customized';
    if (action === 'accept_all') consentStatus = 'accepted_all';
    if (action === 'reject_optional') consentStatus = 'rejected_optional';

    // Log consent record in cookie_consents
    const info = this.db.prepare(`
      INSERT INTO cookie_consents (
        visitor_id, customer_id, consent_action,
        necessary, functional, analytics, marketing,
        ip_masked, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      visitorId || null,
      customerId || null,
      action,
      necessary,
      functional,
      analytics,
      marketing,
      ipMasked,
      userAgent.substring(0, 255),
      nowIso
    );

    // If visitor exists, update visitor's consent status
    if (visitorId) {
      this.db.prepare(`
        UPDATE visitors
        SET consent_status = ?,
            consent_preferences_json = ?,
            consent_updated_at = ?,
            updated_at = ?
        WHERE visitor_id = ?
      `).run(
        consentStatus,
        JSON.stringify({ necessary: true, functional: !!functional, analytics: !!analytics, marketing: !!marketing }),
        nowIso,
        nowIso,
        visitorId
      );
    }

    return {
      success: true,
      consentId: info.lastInsertRowid,
      visitorId,
      consentStatus,
      preferences: { necessary: true, functional: !!functional, analytics: !!analytics, marketing: !!marketing },
      timestamp: nowIso,
    };
  }

  /**
   * Retrieves paginated, filtered, and searchable visitor list for Admin Dashboard.
   */
  getVisitorsList(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(options.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    // Search by visitor ID or customer ID
    if (options.search && typeof options.search === 'string') {
      const q = options.search.trim().toLowerCase();
      conditions.push("(LOWER(v.visitor_id) LIKE ? OR LOWER(COALESCE(v.customer_id, '')) LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }

    // Filter by type: new (1 visit) vs returning (>1 visit)
    if (options.type === 'new') {
      conditions.push('v.total_visits = 1');
    } else if (options.type === 'returning') {
      conditions.push('v.total_visits > 1');
    }

    // Filter by date range
    if (options.dateRange === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      conditions.push('v.last_visit_at >= ?');
      params.push(todayStart.toISOString());
    } else if (options.dateRange === '7d') {
      const d7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      conditions.push('v.last_visit_at >= ?');
      params.push(d7.toISOString());
    } else if (options.dateRange === '30d') {
      const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      conditions.push('v.last_visit_at >= ?');
      params.push(d30.toISOString());
    }

    // Sorting
    let orderBy = 'v.last_visit_at DESC';
    if (options.sortBy === 'total_visits') {
      const dir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
      orderBy = `v.total_visits ${dir}, v.last_visit_at DESC`;
    } else if (options.sortBy === 'total_page_views') {
      const dir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
      orderBy = `v.total_page_views ${dir}`;
    } else if (options.sortBy === 'first_visit') {
      const dir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
      orderBy = `v.first_visit_at ${dir}`;
    } else if (options.sortBy === 'last_visit') {
      const dir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
      orderBy = `v.last_visit_at ${dir}`;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matching
    const countRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM visitors v ${whereClause}
    `).get(...params);
    const total = countRow ? countRow.count : 0;

    // Fetch page items
    const rows = this.db.prepare(`
      SELECT v.*,
             (SELECT COUNT(*) FROM visitor_sessions s WHERE s.visitor_id = v.visitor_id) as session_count
      FROM visitors v
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // Compute summary metrics for the header
    const metrics = this.getVisitorMetrics();

    return {
      items: rows.map(r => ({
        visitor_id: r.visitor_id,
        customer_id: r.customer_id,
        is_customer: !!r.customer_id,
        first_visit_at: r.first_visit_at,
        last_visit_at: r.last_visit_at,
        total_visits: r.total_visits,
        total_page_views: r.total_page_views,
        device_category: r.device_category,
        browser_category: r.browser_category,
        consent_status: r.consent_status,
        visitor_type: r.total_visits === 1 ? 'New' : 'Returning',
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      metrics,
    };
  }

  /**
   * Retrieves comprehensive metrics for Visitor Management header.
   */
  getVisitorMetrics() {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM visitors').get();
    const newRow = this.db.prepare('SELECT COUNT(*) as count FROM visitors WHERE total_visits = 1').get();
    const returningRow = this.db.prepare('SELECT COUNT(*) as count FROM visitors WHERE total_visits > 1').get();
    const visitsRow = this.db.prepare('SELECT COALESCE(SUM(total_visits), 0) as total FROM visitors').get();
    const pageviewsRow = this.db.prepare('SELECT COALESCE(SUM(total_page_views), 0) as total FROM visitors').get();
    const consentAcceptedRow = this.db.prepare("SELECT COUNT(*) as count FROM visitors WHERE consent_status = 'accepted_all'").get();

    return {
      totalVisitors: totalRow ? totalRow.count : 0,
      newVisitors: newRow ? newRow.count : 0,
      returningVisitors: returningRow ? returningRow.count : 0,
      totalVisits: visitsRow ? visitsRow.total : 0,
      totalPageViews: pageviewsRow ? pageviewsRow.total : 0,
      consentAcceptedCount: consentAcceptedRow ? consentAcceptedRow.count : 0,
    };
  }

  /**
   * Retrieves complete details for a single visitor, including full session-by-session history.
   */
  getVisitorDetails(visitorId) {
    if (!visitorId) return null;

    const visitor = this.db.prepare('SELECT * FROM visitors WHERE visitor_id = ?').get(visitorId);
    if (!visitor) return null;

    // Fetch all sessions in chronological order
    const sessions = this.db.prepare(`
      SELECT * FROM visitor_sessions
      WHERE visitor_id = ?
      ORDER BY session_number DESC
    `).all(visitorId);

    // Fetch pageviews for each session
    const sessionsWithViews = sessions.map(s => {
      const views = this.db.prepare(`
        SELECT page_path, page_title, referrer, viewed_at
        FROM visitor_pageviews
        WHERE session_id = ?
        ORDER BY viewed_at ASC
      `).all(s.session_id);

      // Calculate approximate session duration in seconds
      let durationSeconds = 0;
      if (s.started_at && s.last_activity_at) {
        durationSeconds = Math.max(0, Math.round((new Date(s.last_activity_at) - new Date(s.started_at)) / 1000));
      }

      return {
        session_id: s.session_id,
        session_number: s.session_number,
        started_at: s.started_at,
        last_activity_at: s.last_activity_at,
        duration_seconds: durationSeconds,
        page_views_count: s.page_views_count,
        entry_page: s.entry_page,
        exit_page: s.exit_page,
        device_category: s.device_category,
        browser_category: s.browser_category,
        ip_masked: s.ip_masked,
        pageviews: views,
      };
    });

    // Compute top visited pages
    const topPages = this.db.prepare(`
      SELECT page_path, COUNT(*) as views_count
      FROM visitor_pageviews
      WHERE visitor_id = ?
      GROUP BY page_path
      ORDER BY views_count DESC
      LIMIT 6
    `).all(visitorId);

    // Fetch consent history log
    const consentHistory = this.db.prepare(`
      SELECT consent_action, necessary, functional, analytics, marketing, created_at
      FROM cookie_consents
      WHERE visitor_id = ?
      ORDER BY created_at DESC
    `).all(visitorId);

    return {
      overview: {
        visitor_id: visitor.visitor_id,
        customer_id: visitor.customer_id,
        is_customer: !!visitor.customer_id,
        first_visit_at: visitor.first_visit_at,
        last_visit_at: visitor.last_visit_at,
        total_visits: visitor.total_visits,
        total_page_views: visitor.total_page_views,
        device_category: visitor.device_category,
        browser_category: visitor.browser_category,
        consent_status: visitor.consent_status,
        consent_preferences: visitor.consent_preferences_json ? JSON.parse(visitor.consent_preferences_json) : null,
        consent_updated_at: visitor.consent_updated_at,
        visitor_type: visitor.total_visits === 1 ? 'New' : 'Returning',
      },
      topPages,
      sessions: sessionsWithViews,
      consentHistory,
    };
  }

  /**
   * Validates customer ID against real customer orders, applications or tokens
   * to prevent unauthenticated visitors from spoofing existing customer identities.
   */
  validateCustomerId(customerId) {
    if (!customerId || typeof customerId !== 'string') return null;
    const clean = customerId.trim();
    if (!clean) return null;
    try {
      const orderMatch = this.db.prepare('SELECT customer_id FROM orders WHERE customer_id = ? LIMIT 1').get(clean);
      if (orderMatch) return clean;
      const appMatch = this.db.prepare('SELECT client_id FROM applications WHERE client_id = ? OR customer_id = ? LIMIT 1').get(clean, clean);
      if (appMatch) return clean;
      const tokenMatch = this.db.prepare('SELECT customer_id FROM customer_tokens WHERE customer_id = ? LIMIT 1').get(clean);
      if (tokenMatch) return clean;
    } catch (e) {}
    return null;
  }

  /**
   * Generates sanitized CSV string of visitors.
   * Columns: Visitor ID, Customer ID, Total Visits, Total Page Views, First Visit, Last Visit, Device Category, Consent Status
   * Protects privacy: NO raw IP addresses, passwords, or personal data.
   */
  exportVisitorsCsv(options = {}) {
    const list = this.getVisitorsList({ ...options, page: 1, limit: 10000 });
    const items = list.items || [];

    const headers = [
      'Visitor ID',
      'Customer ID',
      'Total Visits',
      'Total Page Views',
      'First Visit',
      'Last Visit',
      'Device Category',
      'Consent Status'
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '';
      const s = String(str);
      if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = [headers.join(',')];
    for (const item of items) {
      rows.push([
        escapeCsv(item.visitor_id),
        escapeCsv(item.customer_id || 'Anonymous'),
        escapeCsv(item.total_visits),
        escapeCsv(item.total_page_views),
        escapeCsv(item.first_visit_at),
        escapeCsv(item.last_visit_at),
        escapeCsv(item.device_category),
        escapeCsv(item.consent_status)
      ].join(','));
    }

    return rows.join('\r\n');
  }

  /**
   * Configurable retention cleanup for raw analytics records.
   * - Defaults to 90 days (configurable via argument or process.env.ANALYTICS_RETENTION_DAYS).
   * - Deletes raw visitor_pageviews older than cutoffDate.
   * - Deletes expired visitor_sessions older than cutoffDate.
   * - Cleans up anonymous visitors whose sessions are all expired and older than cutoffDate.
   * - Preserves cookie_consents for legal/compliance accountability.
   * - Preserves all orders, accounts, and application records.
   */
  cleanupOldAnalytics(retentionDays = 90) {
    const days = Math.max(1, parseInt(retentionDays, 10) || parseInt(process.env.ANALYTICS_RETENTION_DAYS, 10) || 90);
    const cutoffDate = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const infoPageviews = this.db.prepare(`
      DELETE FROM visitor_pageviews
      WHERE viewed_at < ?
    `).run(cutoffDate);

    const infoSessions = this.db.prepare(`
      DELETE FROM visitor_sessions
      WHERE last_activity_at < ?
    `).run(cutoffDate);

    // Clean up orphan anonymous visitors with no remaining sessions and no customer linkage
    const infoVisitors = this.db.prepare(`
      DELETE FROM visitors
      WHERE customer_id IS NULL
        AND last_visit_at < ?
        AND visitor_id NOT IN (SELECT DISTINCT visitor_id FROM visitor_sessions)
    `).run(cutoffDate);

    return {
      success: true,
      retentionDays: days,
      cutoffDate,
      purgedPageviews: infoPageviews.changes,
      purgedSessions: infoSessions.changes,
      purgedOrphanVisitors: infoVisitors.changes,
      timestamp: new Date().toISOString(),
    };
  }
}

// Singleton instance
const visitorTrackingService = new VisitorTrackingService();

module.exports = visitorTrackingService;
module.exports.VisitorTrackingService = VisitorTrackingService;
module.exports.maskIp = maskIp;
module.exports.parseDeviceAndBrowser = parseDeviceAndBrowser;
module.exports.SESSION_TIMEOUT_MS = SESSION_TIMEOUT_MS;
