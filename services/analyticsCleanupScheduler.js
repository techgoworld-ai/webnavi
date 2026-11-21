/**
 * WebNavi Automated Analytics Retention Scheduler
 * 
 * Configurable, singleton background scheduler for purging raw analytics
 * records (visitor pageviews, expired sessions, orphan visitor profiles)
 * older than the configured retention threshold (default: 90 days).
 * 
 * Safety & Privacy Invariants:
 * - Never deletes cookie_consents (preserved for legal/compliance accountability)
 * - Never touches customer orders, applications, or account data
 * - Prevents duplicate timers / overlapping executions
 * - Logs only aggregate counts and timestamps (zero PII)
 */

const visitorTracking = require('./visitorTracking');

let cleanupTimer = null;
let isJobRunning = false;

function getRetentionDays() {
  const envVal = parseInt(process.env.ANALYTICS_RETENTION_DAYS, 10);
  return (!isNaN(envVal) && envVal > 0) ? envVal : 90;
}

function getIntervalMs() {
  const hours = parseFloat(process.env.ANALYTICS_CLEANUP_INTERVAL_HOURS);
  const intervalHours = (!isNaN(hours) && hours > 0) ? hours : 24; // Default: 24 hours (Daily)
  return intervalHours * 3600 * 1000;
}

function isCleanupEnabled() {
  return process.env.ANALYTICS_CLEANUP_ENABLED !== 'false';
}

/**
 * Executes a single cleanup run safely.
 */
async function executeCleanup(reason = 'scheduled') {
  if (isJobRunning) {
    console.log(`[Analytics Retention] Cleanup already in progress, skipping concurrent run (${reason}).`);
    return null;
  }

  isJobRunning = true;
  try {
    const retentionDays = getRetentionDays();
    const result = visitorTracking.cleanupOldAnalytics(retentionDays);

    console.log(`[Analytics Retention] Automated cleanup completed (${reason}): purged ${result.purgedPageviews} pageviews, ${result.purgedSessions} sessions, ${result.purgedOrphanVisitors} orphan visitors older than ${result.cutoffDate} (${result.retentionDays}-day retention policy).`);
    return result;
  } catch (error) {
    console.error(`[Analytics Retention Error] Automated cleanup failed (${reason}):`, error.message);
    return null;
  } finally {
    isJobRunning = false;
  }
}

/**
 * Initializes and starts the background daily scheduler.
 * Idempotent: Calling multiple times will not create duplicate timers.
 */
function startScheduledCleanup(options = {}) {
  if (!isCleanupEnabled()) {
    console.log('[Analytics Retention] Scheduled cleanup is disabled via ANALYTICS_CLEANUP_ENABLED=false.');
    return null;
  }

  if (cleanupTimer) {
    return cleanupTimer;
  }

  const intervalMs = getIntervalMs();
  const intervalHours = intervalMs / (3600 * 1000);

  console.log(`[Analytics Retention] Background scheduler initialized: runs every ${intervalHours}h with ${getRetentionDays()}-day retention window.`);

  // Execute initial startup run after a safe 5-second stabilization window (unless skipped)
  if (!options.skipInitialRun) {
    setTimeout(() => {
      executeCleanup('server-startup').catch(() => {});
    }, 5000).unref();
  }

  // Schedule recurring daily interval
  cleanupTimer = setInterval(() => {
    executeCleanup('daily-interval').catch(() => {});
  }, intervalMs);

  // Unref timer so it does not block node process shutdown
  if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  return cleanupTimer;
}

/**
 * Stops the background scheduler (e.g. for testing or graceful shutdown).
 */
function stopScheduledCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('[Analytics Retention] Background scheduler stopped.');
  }
}

module.exports = {
  startScheduledCleanup,
  stopScheduledCleanup,
  executeCleanup,
  getRetentionDays,
  getIntervalMs,
  isCleanupEnabled,
};

