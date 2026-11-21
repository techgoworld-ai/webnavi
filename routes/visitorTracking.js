/**
 * Public Visitor Tracking & Consent APIs
 * 
 * Rules:
 * - Publicly accessible for frontend client event reporting
 * - Sanitized inputs (no passwords, payment data, form inputs or PII accepted)
 * - IPs are masked before saving; no browser fingerprinting
 */

const express = require('express');
const router = express.Router();
const visitorTracking = require('../services/visitorTracking');

// POST /api/tracking/pageview
router.post('/pageview', (req, res) => {
  try {
    const { visitorId, sessionId, path, title, referrer, customerId, consent } = req.body || {};

    // Secure IP extraction: uses Express validated trust-proxy resolution (never raw untrusted headers)
    const ip = req.ip || (req.socket ? req.socket.remoteAddress : '') || '';
    const userAgent = req.headers['user-agent'] || '';

    const result = visitorTracking.recordPageView({
      visitorId,
      sessionId,
      path,
      title,
      referrer,
      userAgent,
      ip,
      customerId,
      consent,
    });

    res.json(result);
  } catch (error) {
    console.error('[Visitor Tracking Error]', error.message);
    res.status(500).json({ success: false, error: 'Tracking recording error' });
  }
});

// POST /api/tracking/consent
router.post('/consent', (req, res) => {
  try {
    const { visitorId, customerId, action, preferences } = req.body || {};

    // Secure IP extraction: uses Express validated trust-proxy resolution (never raw untrusted headers)
    const ip = req.ip || (req.socket ? req.socket.remoteAddress : '') || '';
    const userAgent = req.headers['user-agent'] || '';

    const result = visitorTracking.recordConsent({
      visitorId,
      customerId,
      action,
      preferences,
      userAgent,
      ip,
    });

    res.json(result);
  } catch (error) {
    console.error('[Consent Recording Error]', error.message);
    res.status(500).json({ success: false, error: 'Consent recording error' });
  }
});

module.exports = router;

