/**
 * SQLite-Backed Persistent Rate Limiter Middleware
 * 
 * Provides shared, persistent rate-limiting across process restarts for single-server deployments
 * without requiring an external Redis service.
 */

const { getDb } = require('../services/db');

function dbRateLimit({
  windowMs = 15 * 60 * 1000,
  max = 10,
  prefix = 'rl',
  message = 'Too many requests. Please try again later.',
  keyGenerator = null,
}) {
  return function rateLimitMiddleware(req, res, next) {
    // Determine client identifier
    let clientKey;
    if (typeof keyGenerator === 'function') {
      clientKey = keyGenerator(req);
    } else {
      const forwarded = req.headers['x-forwarded-for'];
      const rawIp = forwarded ? forwarded.split(',')[0].trim() : (req.ip || (req.socket ? req.socket.remoteAddress : '127.0.0.1'));
      clientKey = rawIp || '127.0.0.1';
    }

    const fullKey = `${prefix}:${clientKey}`;
    const now = Date.now();
    const db = getDb();

    try {
      // 1. Opportunistic cleanup of expired rows
      db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').run(now);

      // 2. Fetch or update current counter
      const row = db.prepare('SELECT hits, reset_at FROM rate_limits WHERE key = ?').get(fullKey);

      if (!row || row.reset_at <= now) {
        const resetAt = now + windowMs;
        db.prepare(`
          INSERT INTO rate_limits (key, hits, reset_at)
          VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET hits = 1, reset_at = excluded.reset_at
        `).run(fullKey, resetAt);

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - 1));
        res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
        return next();
      }

      if (row.hits >= max) {
        const retryAfterSec = Math.max(1, Math.ceil((row.reset_at - now) / 1000));
        res.setHeader('Retry-After', retryAfterSec);
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('X-RateLimit-Reset', Math.ceil(row.reset_at / 1000));

        return res.status(429).json({
          success: false,
          error: message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: retryAfterSec,
        });
      }

      // Increment hit count
      const updatedHits = row.hits + 1;
      db.prepare('UPDATE rate_limits SET hits = hits + 1 WHERE key = ?').run(fullKey);

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - updatedHits));
      res.setHeader('X-RateLimit-Reset', Math.ceil(row.reset_at / 1000));
      return next();

    } catch (err) {
      console.warn('[RateLimiter DB Warning]', err.message);
      // Fallback: never hard-block legitimate users if rate limit DB has a temporary issue
      return next();
    }
  };
}

module.exports = {
  dbRateLimit,
};

