const { getDb } = require('./db');
const hostyIndia = require('./hostyindia');

/**
 * Normalizes TLD string (e.g., 'com' -> '.com', '.IN' -> '.in')
 * @param {string} rawTld 
 * @returns {string}
 */
function normalizeTld(rawTld) {
  if (!rawTld || typeof rawTld !== 'string') return '';
  const trimmed = rawTld.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

class PricingService {
  constructor(customDb = null) {
    this.db = customDb || getDb();
  }

  /**
   * Synchronizes wholesale TLD pricing from HostyIndia upstream API into SQLite.
   * 
   * Strict Safety & Architecture Rules:
   * 1. Fetches all 649+ TLDs using HostyIndia ?action=pricing.
   * 2. Stores registration, renewal, and transfer costs separately.
   * 3. NEVER overwrites existing retail prices during wholesale synchronization.
   * 4. NEVER applies automatic percentage markups (leaves retail prices NULL for manual admin configuration).
   * 5. Atomically executes inside a single database transaction.
   * 
   * @returns {Promise<{ success: boolean, totalFetched: number, inserted: number, updated: number, currency: string, syncedAt: string }>}
   */
  async syncWholesalePricing() {
    const startTime = Date.now();
    console.log('[PricingService] Initiating wholesale pricing synchronization from HostyIndia...');

    const upstreamData = await hostyIndia.getTldPricing();
    if (!upstreamData || !upstreamData.pricing || typeof upstreamData.pricing !== 'object') {
      throw new Error('HostyIndia returned invalid pricing structure or empty TLD list.');
    }

    const tldEntries = Object.entries(upstreamData.pricing);
    const totalFetched = tldEntries.length;
    const syncedAt = new Date().toISOString();
    const currency = upstreamData.currency || 'INR';

    console.log(`[PricingService] Upstream returned ${totalFetched} TLD pricing entries (${currency}). Preparing database upsert...`);

    const selectStmt = this.db.prepare('SELECT tld, retail_register, retail_renew, retail_transfer FROM domain_tld_pricing WHERE tld = ?');

    const updateStmt = this.db.prepare(`
      UPDATE domain_tld_pricing
      SET wholesale_register = ?,
          wholesale_renew = ?,
          wholesale_transfer = ?,
          currency = ?,
          grace_period_days = ?,
          addons_json = ?,
          supplier_source = 'HostyIndia',
          last_synced_at = ?
      WHERE tld = ?
    `);

    const insertStmt = this.db.prepare(`
      INSERT INTO domain_tld_pricing (
        tld, wholesale_register, wholesale_renew, wholesale_transfer,
        retail_register, retail_renew, retail_transfer,
        currency, grace_period_days, addons_json,
        is_active, allow_loss, supplier_source,
        last_synced_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 1, 0, 'HostyIndia', ?, ?)
    `);

    let insertedCount = 0;
    let updatedCount = 0;

    const syncTransaction = this.db.transaction((entries) => {
      for (const [rawKey, item] of entries) {
        const tld = normalizeTld(item.tld || rawKey);
        if (!tld || tld === '.') continue;

        const wholesaleRegister = Number(item.register);
        const wholesaleRenew = Number(item.renew);
        const wholesaleTransfer = item.transfer != null ? Number(item.transfer) : 0;

        // Skip malformed entries without valid registration or renewal costs
        if (isNaN(wholesaleRegister) || isNaN(wholesaleRenew) || wholesaleRegister < 0 || wholesaleRenew < 0) {
          console.warn(`[PricingService] Skipping invalid pricing data for TLD "${tld}": reg=${item.register}, renew=${item.renew}`);
          continue;
        }

        const gracePeriod = item.grace_period_days ? parseInt(item.grace_period_days, 10) : 30;
        const addonsJson = JSON.stringify(item.addons || {});

        const existing = selectStmt.get(tld);
        if (existing) {
          // Update wholesale supplier costs only — preserve existing retail prices and admin settings
          updateStmt.run(
            wholesaleRegister,
            wholesaleRenew,
            wholesaleTransfer,
            currency,
            gracePeriod,
            addonsJson,
            syncedAt,
            tld
          );
          updatedCount++;
        } else {
          // Insert new TLD row with NULL retail prices (no automatic markup forced)
          insertStmt.run(
            tld,
            wholesaleRegister,
            wholesaleRenew,
            wholesaleTransfer,
            currency,
            gracePeriod,
            addonsJson,
            syncedAt,
            syncedAt
          );
          insertedCount++;
        }
      }
    });

    syncTransaction(tldEntries);

    const elapsedMs = Date.now() - startTime;
    console.log(`[PricingService] Wholesale pricing sync completed in ${elapsedMs}ms: ${insertedCount} inserted, ${updatedCount} updated, ${totalFetched} total.`);

    return {
      success: true,
      totalFetched,
      inserted: insertedCount,
      updated: updatedCount,
      currency,
      syncedAt,
      elapsedMs,
    };
  }

  /**
   * Retrieves stored pricing record for a single TLD.
   * @param {string} rawTld 
   * @returns {Object|null}
   */
  getTldPricing(rawTld) {
    const tld = normalizeTld(rawTld);
    if (!tld) return null;
    return this.db.prepare('SELECT * FROM domain_tld_pricing WHERE tld = ?').get(tld) || null;
  }

  /**
   * Retrieves all TLD pricing records with optional filtering.
   * @param {Object} [options]
   * @param {boolean} [options.onlyActive=false]
   * @param {string} [options.search]
   * @returns {Array<Object>}
   */
  getAllTldPricing(options = {}) {
    let sql = 'SELECT * FROM domain_tld_pricing';
    const conditions = [];
    const params = [];

    if (options.onlyActive) {
      conditions.push('is_active = 1');
    }

    if (options.search && typeof options.search === 'string') {
      conditions.push('tld LIKE ?');
      params.push(`%${options.search.trim().toLowerCase()}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY tld ASC';
    return this.db.prepare(sql).all(...params);
  }

  /**
   * Retrieves summary statistics regarding the pricing table.
   * @returns {{ totalCount: number, activeCount: number, configuredCount: number, lossCount: number, currency: string, lastSyncedAt: string|null }}
   */
  getLastSyncInfo() {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as totalCount,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeCount,
        SUM(CASE WHEN retail_register IS NOT NULL AND retail_renew IS NOT NULL THEN 1 ELSE 0 END) as configuredCount,
        SUM(CASE WHEN (retail_register IS NOT NULL AND retail_register < wholesale_register) OR (retail_renew IS NOT NULL AND retail_renew < wholesale_renew) THEN 1 ELSE 0 END) as lossCount,
        MAX(last_synced_at) as lastSyncedAt,
        currency
      FROM domain_tld_pricing
    `).get();

    return {
      totalCount: stats?.totalCount || 0,
      activeCount: stats?.activeCount || 0,
      configuredCount: stats?.configuredCount || 0,
      lossCount: stats?.lossCount || 0,
      currency: stats?.currency || 'INR',
      lastSyncedAt: stats?.lastSyncedAt || null,
    };
  }

  /**
   * Admin paginated & filtered TLD pricing retrieval with calculated profits and loss indicators.
   * STRICT ACCESS: Wholesale costs and profit calculations must only be accessed through admin routes.
   * @param {Object} [options]
   */
  getAdminTldPricing(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(250, Math.max(1, parseInt(options.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    // Filter by search string
    if (options.search && typeof options.search === 'string') {
      const rawQ = options.search.trim().toLowerCase();
      const q = rawQ.startsWith('.') ? rawQ.slice(1) : rawQ;
      conditions.push('(tld LIKE ?)');
      params.push(`%${q}%`);
    }

    // Filter by configuration status
    if (options.status === 'configured') {
      conditions.push('(retail_register IS NOT NULL AND retail_renew IS NOT NULL)');
    } else if (options.status === 'unconfigured') {
      conditions.push('(retail_register IS NULL OR retail_renew IS NULL)');
    } else if (options.status === 'loss') {
      conditions.push('((retail_register IS NOT NULL AND retail_register < wholesale_register) OR (retail_renew IS NOT NULL AND retail_renew < wholesale_renew))');
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // Total count for current filter
    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM domain_tld_pricing${whereClause}`).get(...params);
    const total = countRow ? countRow.total : 0;

    // Sorting
    let sortColumn = 'tld';
    if (options.sort === 'wholesale_register') sortColumn = 'wholesale_register';
    else if (options.sort === 'wholesale_renew') sortColumn = 'wholesale_renew';
    else if (options.sort === 'retail_register') sortColumn = 'retail_register';
    else if (options.sort === 'retail_renew') sortColumn = 'retail_renew';
    else if (options.sort === 'profit_register') sortColumn = '(retail_register - wholesale_register)';

    const sortDir = options.order && options.order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const sql = `
      SELECT * FROM domain_tld_pricing
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDir}
      LIMIT ? OFFSET ?
    `;

    const rows = this.db.prepare(sql).all(...params, limit, offset);

    // Compute margins and audit indicators
    const items = rows.map(r => {
      const profitRegister = r.retail_register != null ? Number((r.retail_register - r.wholesale_register).toFixed(2)) : null;
      const profitRenew = r.retail_renew != null ? Number((r.retail_renew - r.wholesale_renew).toFixed(2)) : null;
      const profitTransfer = r.retail_transfer != null ? Number((r.retail_transfer - r.wholesale_transfer).toFixed(2)) : null;

      const isLossRegister = r.retail_register != null && r.retail_register < r.wholesale_register;
      const isLossRenew = r.retail_renew != null && r.retail_renew < r.wholesale_renew;
      const isLossTransfer = r.retail_transfer != null && r.retail_transfer < r.wholesale_transfer;

      return {
        ...r,
        profit_register: profitRegister,
        profit_renew: profitRenew,
        profit_transfer: profitTransfer,
        is_loss_register: isLossRegister,
        is_loss_renew: isLossRenew,
        is_loss_transfer: isLossTransfer,
        has_loss: isLossRegister || isLossRenew || isLossTransfer,
      };
    });

    const summary = this.getLastSyncInfo();

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary,
    };
  }

  /**
   * Updates retail pricing for an individual TLD with strict loss-prevention safeguards.
   * @param {string} rawTld 
   * @param {Object} updates 
   * @param {number|null} [updates.retail_register]
   * @param {number|null} [updates.retail_renew]
   * @param {number|null} [updates.retail_transfer]
   * @param {boolean} [updates.allow_loss=false]
   * @param {boolean} [updates.is_active]
   */
  updateTldPricing(rawTld, updates = {}) {
    const tld = normalizeTld(rawTld);
    const existing = this.getTldPricing(tld);
    if (!existing) {
      const err = new Error(`TLD "${tld}" not found in catalog.`);
      err.statusCode = 404;
      throw err;
    }

    const regPrice = updates.retail_register !== undefined
      ? (updates.retail_register === null || updates.retail_register === '' ? null : Number(updates.retail_register))
      : existing.retail_register;

    const renewPrice = updates.retail_renew !== undefined
      ? (updates.retail_renew === null || updates.retail_renew === '' ? null : Number(updates.retail_renew))
      : existing.retail_renew;

    const transferPrice = updates.retail_transfer !== undefined
      ? (updates.retail_transfer === null || updates.retail_transfer === '' ? null : Number(updates.retail_transfer))
      : existing.retail_transfer;

    // Validate numeric values
    if (regPrice !== null && (isNaN(regPrice) || regPrice < 0)) {
      const err = new Error('Invalid retail registration price.');
      err.statusCode = 400;
      throw err;
    }
    if (renewPrice !== null && (isNaN(renewPrice) || renewPrice < 0)) {
      const err = new Error('Invalid retail renewal price.');
      err.statusCode = 400;
      throw err;
    }
    if (transferPrice !== null && (isNaN(transferPrice) || transferPrice < 0)) {
      const err = new Error('Invalid retail transfer price.');
      err.statusCode = 400;
      throw err;
    }

    // Loss-prevention check (Requirement 9)
    const isLossReg = regPrice !== null && regPrice < existing.wholesale_register;
    const isLossRenew = renewPrice !== null && renewPrice < existing.wholesale_renew;
    const isLossTransfer = transferPrice !== null && transferPrice < existing.wholesale_transfer;
    const isSellingAtLoss = isLossReg || isLossRenew || isLossTransfer;

    const allowLoss = Boolean(updates.allow_loss);
    if (isSellingAtLoss && !allowLoss) {
      const details = [];
      if (isLossReg) details.push(`Registration price (₹${regPrice}) is below wholesale cost (₹${existing.wholesale_register})`);
      if (isLossRenew) details.push(`Renewal price (₹${renewPrice}) is below wholesale cost (₹${existing.wholesale_renew})`);
      if (isLossTransfer) details.push(`Transfer price (₹${transferPrice}) is below wholesale cost (₹${existing.wholesale_transfer})`);

      const err = new Error(`Loss warning: ${details.join('; ')}. Explicit admin approval is required to sell at a loss.`);
      err.statusCode = 400;
      err.code = 'LOSS_WARNING';
      err.requiresApproval = true;
      err.details = { isLossReg, isLossRenew, isLossTransfer };
      throw err;
    }

    const isActive = updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : existing.is_active;
    const nowIso = new Date().toISOString();

    this.db.prepare(`
      UPDATE domain_tld_pricing
      SET retail_register = ?,
          retail_renew = ?,
          retail_transfer = ?,
          allow_loss = ?,
          is_active = ?,
          updated_at = ?
      WHERE tld = ?
    `).run(regPrice, renewPrice, transferPrice, allowLoss ? 1 : 0, isActive, nowIso, tld);

    const updated = this.getTldPricing(tld);
    const profitRegister = updated.retail_register != null ? Number((updated.retail_register - updated.wholesale_register).toFixed(2)) : null;
    const profitRenew = updated.retail_renew != null ? Number((updated.retail_renew - updated.wholesale_renew).toFixed(2)) : null;

    return {
      ...updated,
      profit_register: profitRegister,
      profit_renew: profitRenew,
    };
  }

  /**
   * Bulk updates retail prices across multiple TLDs safely with loss validation.
   * @param {Object} params
   * @param {Array<string>|string} params.tlds 'all' or array of TLDs
   * @param {string} params.markupType 'fixed' (add fixed ₹ amount to wholesale) or 'set' (set explicit retail price)
   * @param {number} [params.regValue]
   * @param {number} [params.renewValue]
   * @param {boolean} [params.allow_loss=false]
   */
  bulkUpdatePricing(params = {}) {
    const { tlds, markupType, regValue, renewValue, allow_loss = false } = params;

    let targetTlds = [];
    if (tlds === 'all') {
      const allRows = this.db.prepare('SELECT tld FROM domain_tld_pricing').all();
      targetTlds = allRows.map(r => r.tld);
    } else if (tlds === 'unconfigured') {
      const unconfRows = this.db.prepare('SELECT tld FROM domain_tld_pricing WHERE retail_register IS NULL AND retail_renew IS NULL').all();
      targetTlds = unconfRows.map(r => r.tld);
    } else if (Array.isArray(tlds)) {
      targetTlds = tlds.map(normalizeTld).filter(Boolean);
    }

    if (targetTlds.length === 0) {
      throw new Error('No target TLDs specified for bulk update.');
    }

    const nowIso = new Date().toISOString();
    let updatedCount = 0;

    const bulkTx = this.db.transaction(() => {
      for (const tld of targetTlds) {
        const item = this.getTldPricing(tld);
        if (!item) continue;

        let newReg = item.retail_register;
        let newRenew = item.retail_renew;

        if (markupType === 'fixed') {
          if (regValue != null && !isNaN(regValue)) {
            newReg = Math.max(0, Number((item.wholesale_register + Number(regValue)).toFixed(2)));
          }
          if (renewValue != null && !isNaN(renewValue)) {
            newRenew = Math.max(0, Number((item.wholesale_renew + Number(renewValue)).toFixed(2)));
          }
        } else if (markupType === 'set') {
          if (regValue != null && !isNaN(regValue)) {
            newReg = Number(Number(regValue).toFixed(2));
          }
          if (renewValue != null && !isNaN(renewValue)) {
            newRenew = Number(Number(renewValue).toFixed(2));
          }
        }

        const isLoss = (newReg !== null && newReg < item.wholesale_register) || (newRenew !== null && newRenew < item.wholesale_renew);
        if (isLoss && !allow_loss) {
          throw new Error(`Bulk update rejected: TLD "${tld}" would be priced below wholesale cost without explicit loss approval.`);
        }

        this.db.prepare(`
          UPDATE domain_tld_pricing
          SET retail_register = ?,
              retail_renew = ?,
              allow_loss = ?,
              updated_at = ?
          WHERE tld = ?
        `).run(newReg, newRenew, allow_loss ? 1 : 0, nowIso, tld);

        updatedCount++;
      }
    });

    bulkTx();

    return {
      success: true,
      updatedCount,
      totalTargets: targetTlds.length,
      timestamp: nowIso,
    };
  }
}

// Export singleton instance initialized with standard database
const pricingServiceInstance = new PricingService();

module.exports = pricingServiceInstance;
module.exports.PricingService = PricingService;
module.exports.normalizeTld = normalizeTld;

