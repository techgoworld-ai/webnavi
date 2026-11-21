/**
 * Admin Visitor Management API Routes
 * 
 * STRICT ACCESS CONTROL:
 * Protected by adminAuth middleware.
 * Never accessible to non-admin or public users.
 */

const express = require('express');
const router = express.Router();
const visitorTracking = require('../services/visitorTracking');

// Ensure sensitive visitor analytics responses are never cached by browser or proxies
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// GET /api/admin/visitors
// Retrieves paginated & searchable visitors list with metrics
router.get('/', (req, res) => {
  try {
    const { search, type, dateRange, sortBy, sortOrder, page, limit } = req.query || {};

    const result = visitorTracking.getVisitorsList({
      search,
      type,
      dateRange,
      sortBy,
      sortOrder,
      page,
      limit,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Admin Visitors Error]', error.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve visitors' });
  }
});

// GET /api/admin/visitors/export/csv
// Exports visitor records to CSV file. Strictly admin authorized.
router.get('/export/csv', (req, res) => {
  try {
    const { search, type, dateRange, sortBy, sortOrder } = req.query || {};
    const csvContent = visitorTracking.exportVisitorsCsv({
      search,
      type,
      dateRange,
      sortBy,
      sortOrder,
    });

    const filename = `webnavi-visitors-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error) {
    console.error('[Admin Visitors CSV Export Error]', error.message);
    res.status(500).json({ success: false, error: 'Failed to export CSV' });
  }
});

// POST /api/admin/visitors/retention/cleanup
// Executes retention policy cleanup. Strictly admin authorized.
router.post('/retention/cleanup', (req, res) => {
  try {
    const { retentionDays } = req.body || {};
    const result = visitorTracking.cleanupOldAnalytics(retentionDays);
    res.json(result);
  } catch (error) {
    console.error('[Admin Visitors Cleanup Error]', error.message);
    res.status(500).json({ success: false, error: 'Failed to execute retention cleanup' });
  }
});

// GET /api/admin/visitors/:visitorId
// Retrieves single visitor complete overview, visit-by-visit history, and consent log
router.get('/:visitorId', (req, res) => {
  try {
    const { visitorId } = req.params;
    const details = visitorTracking.getVisitorDetails(visitorId);

    if (!details) {
      return res.status(404).json({ success: false, error: 'Visitor record not found' });
    }

    res.json({ success: true, ...details });
  } catch (error) {
    console.error('[Admin Visitor Details Error]', error.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve visitor details' });
  }
});

module.exports = router;

