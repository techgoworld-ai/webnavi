const express = require('express');
const router = express.Router();
const projectStore = require('../services/projectStore');
const orderStore = require('../services/orderStore');
const dnsStore = require('../services/dnsStore');
const customerStore = require('../services/customerStore');
const customerTokenService = require('../services/customerTokens');
const emailService = require('../services/emailService');
const { generateProjectInvoicePdf } = require('../services/invoiceGenerator');
const { verifyCustomerOwnership, adminAuth } = require('../services/auth');
const { optionalCustomerAuth } = require('../middleware/customerAuth');

/**
 * Middleware: Verify that the caller owns the application identified by :clientId,
 * or is an authenticated admin.
 */
function requireApplicationAuth(req, res, next) {
  const { clientId } = req.params;
  const app = projectStore.getApplication(clientId);
  const targetId = (app && app.customerId) ? app.customerId : clientId;

  let authResult = verifyCustomerOwnership(req, targetId);
  if (!authResult.authorized && authResult.status !== 403 && targetId !== clientId) {
    const tokenResult = verifyCustomerOwnership(req, clientId);
    if (tokenResult.authorized) authResult = tokenResult;
  }

  if (!authResult.authorized) {
    return res.status(authResult.status || 401).json({
      success: false,
      error: authResult.message || 'Unauthorized access to client application portal.',
      code: authResult.reason || 'UNAUTHORIZED',
    });
  }

  req.isAppAdmin = Boolean(authResult.isAdmin);
  req.authCustomerId = authResult.customerId || clientId;
  next();
}

// ── CLIENT-FACING / APPLICATION PORTAL ROUTES ───────────────────────────────

/**
 * GET /api/applications/my-active
 * Check if the currently authenticated customer has an active application.
 */
router.get('/my-active', optionalCustomerAuth, (req, res) => {
  try {
    if (!req.customer) {
      return res.json({ success: true, applied: false });
    }
    const app = projectStore.getApplicationByCustomerId(req.customer.id);
    if (!app) {
      return res.json({ success: true, applied: false });
    }
    return res.json({
      success: true,
      applied: true,
      clientId: app.clientId,
      ticketId: app.ticketId,
      businessName: app.businessName,
      preferredDomain: app.preferredDomain,
      currentStage: app.currentStage,
      assignedDeveloper: app.assignedDeveloper,
      portalUrl: `/application/${app.clientId}`,
      createdAt: app.createdAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/applications/check-status?email=...
 * Check if an email address already has an existing website application.
 */
router.get('/check-status', (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email parameter is required.' });
    }
    const app = projectStore.getApplicationByEmail(email);
    if (!app) {
      return res.json({ success: true, applied: false });
    }
    return res.json({
      success: true,
      applied: true,
      clientId: app.clientId,
      ticketId: app.ticketId,
      businessName: app.businessName,
      preferredDomain: app.preferredDomain,
      currentStage: app.currentStage,
      assignedDeveloper: app.assignedDeveloper,
      portalUrl: `/application/${app.clientId}`,
      createdAt: app.createdAt,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/applications
 * Submit a new Free Website application.
 * Persists application, 6 stages, billing, and generates customer capability token.
 * Automatically provisions or associates a Customer Account.
 */
router.post('/', optionalCustomerAuth, (req, res, next) => {
  try {
    const formData = req.body || {};
    let accountCreated = false;
    let customerId = null;

    if (req.customer) {
      // Authenticated customer: directly associate application
      customerId = req.customer.id;
    } else {
      const email = (formData.email || '').trim().toLowerCase();
      const accountPassword = formData.accountPassword || formData.password;
      const confirmPassword = formData.confirmPassword;

      if (email) {
        const existing = customerStore.findByEmail(email);
        if (existing) {
          return res.status(409).json({
            success: false,
            error: 'An account with this email address already exists. Please sign in to your WebNavi account to associate this application.',
            code: 'ACCOUNT_EXISTS',
          });
        }

        if (accountPassword) {
          if (accountPassword.length < 8) {
            return res.status(400).json({
              success: false,
              error: 'Password must be at least 8 characters in length.',
              code: 'INVALID_PASSWORD',
            });
          }

          if (confirmPassword && accountPassword !== confirmPassword) {
            return res.status(400).json({
              success: false,
              error: 'Passwords do not match.',
              code: 'PASSWORD_MISMATCH',
            });
          }

          const customer = customerStore.createCustomer({
            email,
            password: accountPassword,
            fullName: formData.fullName || formData.name || '',
            phone: formData.phone || '',
          });

          customerId = customer.id;
          accountCreated = true;

          // Issue session and set HTTP-only cookie so user is seamlessly logged in
          const ip = req.ip || (req.socket ? req.socket.remoteAddress : '');
          const userAgent = req.headers['user-agent'] || '';
          const session = customerStore.createSession(customer.id, { ip, userAgent });

          res.cookie('wn_customer_session', session.token, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: session.durationDays * 24 * 3600 * 1000,
          });
        }
      }
    }

    if (customerId) {
      formData.customerId = customerId;
    }

    const app = projectStore.createApplication(formData);

    // Dispatch transactional emails: applicant confirmation & owner alert
    try {
      emailService.sendApplicationConfirmationEmail({
        email: formData.email,
        fullName: formData.fullName || formData.name || '',
      }, app);
    } catch (e) {
      console.warn('[Applications] Customer email notice:', e.message);
    }

    try {
      emailService.sendOwnerApplicationNotification(app, formData);
    } catch (e) {
      console.warn('[Applications] Owner email notice:', e.message);
    }

    // Issue cryptographically random customer capability token
    let customerToken = null;
    try {
      customerToken = customerTokenService.createCustomerToken(app.clientId, {
        description: `Portal Session for ${app.ticketId}`,
      });
    } catch (e) {
      console.warn('[Applications] Token issuance notice:', e.message);
    }

    res.json({
      success: true,
      ticketId: app.ticketId,
      clientId: app.clientId,
      customerId: app.customerId || customerId,
      accountCreated,
      customerToken,
      portalUrl: `/application/${app.clientId}`,
      message: 'Application submitted successfully. We will review your details within 24–48 hours.',
      receivedAt: app.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/applications/:clientId
 * Fetch application details, stage lifecycle, billing, and preview status.
 */
router.get('/:clientId', requireApplicationAuth, (req, res, next) => {
  try {
    const app = projectStore.getApplication(req.params.clientId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    res.json({
      success: true,
      application: app,
      // Backward-compatibility flat fields for existing client UI:
      ticketId: app.ticketId,
      clientId: app.clientId,
      receivedAt: app.createdAt,
      fullName: app.fullName,
      businessName: app.businessName,
      industry: app.industry,
      city: app.city,
      state: app.state,
      phone: app.phone,
      email: app.email,
      preferredDomain: app.preferredDomain,
      existingSite: app.existingSite,
      instagram: app.instagram,
      youtube: app.youtube,
      facebook: app.facebook,
      description: app.description,
      assignedDeveloper: app.assignedDeveloper,
      currentStage: app.currentStage,
      stages: app.stages,
      billing: app.billing,
      currentPreview: app.currentPreview,
      unreadMessages: req.isAppAdmin ? app.unreadAdminMessages : app.unreadClientMessages,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/applications/:clientId/messages
 * Retrieve real chat messages with read receipts and timestamps.
 */
router.get('/:clientId/messages', requireApplicationAuth, (req, res, next) => {
  try {
    const app = projectStore.getApplication(req.params.clientId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const messages = projectStore.getMessages(req.params.clientId);
    res.json({
      success: true,
      clientId: app.clientId,
      ticketId: app.ticketId,
      messages,
      unreadCount: req.isAppAdmin ? app.unreadAdminMessages : app.unreadClientMessages,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/applications/:clientId/messages
 * Post a chat message from Client or Admin.
 */
router.post('/:clientId/messages', requireApplicationAuth, (req, res, next) => {
  try {
    const { clientId } = req.params;
    const app = projectStore.getApplication(clientId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const body = req.body || {};
    const text = (body.text || body.message || '').trim();
    if (!text) {
      return res.status(400).json({ success: false, error: 'Message text is required.' });
    }

    const isEng = req.isAppAdmin || body.sender === 'admin' || body.sender === 'engineer' || body.senderRole === 'admin' || body.senderRole === 'engineer';
    const senderRole = isEng ? 'engineer' : 'client';
    const authorName = body.author || body.senderName || (isEng ? (app.assignedDeveloper || 'Liam & Alex') : (app.fullName || 'Client'));

    const msg = projectStore.postMessage(clientId, {
      senderRole,
      senderId: isEng ? 'engineer' : clientId,
      authorName,
      messageText: text,
    });

    res.json({ success: true, message: msg });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/applications/:clientId/messages/read
 * Mark messages as read and update read receipts.
 */
router.post('/:clientId/messages/read', requireApplicationAuth, (req, res, next) => {
  try {
    const { clientId } = req.params;
    const readerRole = req.isAppAdmin ? 'admin' : 'client';
    projectStore.markMessagesAsRead(clientId, readerRole);
    res.json({ success: true, message: 'Messages marked as read.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/applications/:clientId/preview
 * Retrieve current active preview and preview version history.
 */
router.get('/:clientId/preview', requireApplicationAuth, (req, res, next) => {
  try {
    const { clientId } = req.params;
    const currentPreview = projectStore.getCurrentPreview(clientId);
    const history = projectStore.getPreviews(clientId);
    const revisions = projectStore.getRevisions(clientId);

    res.json({
      success: true,
      hasPreview: Boolean(currentPreview),
      currentPreview,
      preview: currentPreview,
      history,
      revisions,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/applications/:clientId/preview/approve
 * Client approves the current staging preview demo.
 * Transitions Stage 2 to COMPLETED, Stage 3 to AWAITING_PAYMENT.
 * Invariant: Does NOT deduct funds or mark payment as completed.
 */
router.post('/:clientId/preview/approve', requireApplicationAuth, (req, res, next) => {
  try {
    const { clientId } = req.params;
    const app = projectStore.getApplication(clientId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const { version } = req.body || {};
    const result = projectStore.approvePreview(clientId, version, {
      role: 'client',
      name: app.fullName || 'Client',
    });

    res.json({
      success: true,
      message: `Demo preview ${result.version} approved! Milestone 1 advance payment is now ready.`,
      result,
      nextStage: result.nextStage,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/applications/:clientId/preview/revision
 * Client requests revisions on the current preview.
 */
router.post('/:clientId/preview/revision', requireApplicationAuth, (req, res, next) => {
  try {
    const { clientId } = req.params;
    const app = projectStore.getApplication(clientId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const { comment, version } = req.body || {};
    if (!comment || !comment.trim()) {
      return res.status(400).json({ success: false, error: 'A revision comment is required.' });
    }

    const result = projectStore.requestRevision(clientId, version, comment, {
      role: 'client',
      name: app.fullName || 'Client',
    });

    res.json({
      success: true,
      message: 'Revision requested. Your lead developer has been notified in chat.',
      result,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/applications/:clientId/billing
 * Get billing summary and verified transactions.
 */
router.get('/:clientId/billing', requireApplicationAuth, (req, res, next) => {
  try {
    const { clientId } = req.params;
    const billing = projectStore.getBilling(clientId);
    res.json({ success: true, billing });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/applications/:clientId/invoice
 * Download printable/official Project Invoice PDF.
 */
router.get('/:clientId/invoice', requireApplicationAuth, async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const app = projectStore.getApplication(clientId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const billing = projectStore.getBilling(clientId);
    const pdfBuffer = await generateProjectInvoicePdf(app, billing);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="WebNavi-Invoice-${app.ticketId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/applications/:clientId/notifications
 * Get persistent notifications for the client application.
 */
router.get('/:clientId/notifications', requireApplicationAuth, (req, res, next) => {
  try {
    const notifications = projectStore.getNotifications(req.params.clientId);
    res.json({ success: true, notifications });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/applications/:clientId/domains
 * Connect genuinely registered domain orders and Cloudflare DNS records.
 */
router.get('/:clientId/domains', requireApplicationAuth, (req, res, next) => {
  try {
    const { clientId } = req.params;
    const app = projectStore.getApplication(clientId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    // Query genuine orders associated with this customer ID, ticket ID, preferred domain, or phone
    const allOrders = orderStore.getAllOrders();
    const cleanEmail = (app.email || '').trim().toLowerCase();
    const cleanDomain = (app.preferredDomain || '').trim().toLowerCase();
    const cleanPhone = (app.phone || '').replace(/\D/g, '');

    const matchedOrders = allOrders.filter(ord => {
      const ordCust = (ord.customerId || '').trim().toLowerCase();
      const ordTicket = (ord.ticketId || '').trim().toLowerCase();
      const ordDomain = (ord.domain || '').trim().toLowerCase();
      const ordEmail = (ord.registrant && ord.registrant.email ? ord.registrant.email : '').trim().toLowerCase();
      const ordPhone = (ord.registrant && ord.registrant.phone ? ord.registrant.phone : '').replace(/\D/g, '');

      return ordCust === clientId.toLowerCase() ||
             (ordTicket && ordTicket === app.ticketId.toLowerCase()) ||
             (cleanEmail && ordEmail === cleanEmail) ||
             (cleanDomain && ordDomain === cleanDomain) ||
             (cleanPhone && cleanPhone.length >= 10 && ordPhone && ordPhone.includes(cleanPhone.slice(-10)));
    });

    // Match Cloudflare DNS zones
    const zones = dnsStore.getAllZones();
    const enrichedOrders = matchedOrders.map(ord => {
      const z = zones.find(zone => zone.domain.trim().toLowerCase() === ord.domain.trim().toLowerCase());
      return {
        ...ord,
        zone: z || null,
        dnsStatus: ord.dnsStatus || (z ? z.approvalStatus : 'NOT_STARTED'),
      };
    });

    res.json({
      success: true,
      count: enrichedOrders.length,
      orders: enrichedOrders,
    });
  } catch (err) {
    next(err);
  }
});

// ── ADMIN-SPECIFIC MANAGEMENT ROUTES (Protected by adminAuth) ─────────────────

const adminRouter = express.Router();
adminRouter.use(adminAuth);
adminRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

/**
 * GET /api/admin/applications
 * Returns all client applications sorted by date.
 */
adminRouter.get('/', (req, res, next) => {
  try {
    const list = projectStore.getAllApplications();
    res.json({ success: true, count: list.length, applications: list });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/applications/:clientId
 * Returns detailed application data and audit logs.
 */
adminRouter.get('/:clientId', (req, res, next) => {
  try {
    const app = projectStore.getApplication(req.params.clientId);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }
    const auditLogs = projectStore.getAuditLogs(req.params.clientId);
    res.json({ success: true, application: app, auditLogs });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/applications/:clientId
 * Update application metadata (assigned developer, domain, description).
 */
adminRouter.patch('/:clientId', (req, res, next) => {
  try {
    const { clientId } = req.params;
    const updated = projectStore.updateApplication(clientId, req.body || {}, {
      role: 'admin',
      name: 'Admin Architect',
    });
    res.json({ success: true, application: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/admin/applications/:clientId/stages/:stageNumber
 * Update a specific stage's status with sequence validation.
 */
adminRouter.patch('/:clientId/stages/:stageNumber', (req, res, next) => {
  try {
    const { clientId, stageNumber } = req.params;
    const { status, notes, assignedUser } = req.body || {};

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required.' });
    }

    const stages = projectStore.updateStageStatus(clientId, stageNumber, status, {
      notes,
      assignedUser,
    }, {
      role: 'admin',
      name: 'Admin Lead',
    });

    res.json({
      success: true,
      message: `Stage ${stageNumber} status updated to ${status}.`,
      stages,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/applications/:clientId/preview
 * Publish a new staging preview URL, version tag, and changelog notes.
 */
adminRouter.post('/:clientId/preview', (req, res, next) => {
  try {
    const { clientId } = req.params;
    const { previewUrl, version, changelogNotes } = req.body || {};

    if (!previewUrl || !previewUrl.trim()) {
      return res.status(400).json({ success: false, error: 'Preview URL is required.' });
    }

    const preview = projectStore.publishPreview(clientId, {
      previewUrl,
      version: version || 'v1.0',
      changelogNotes,
    }, {
      role: 'admin',
      name: 'Lead Developer',
    });

    res.json({
      success: true,
      message: `Staging preview ${preview.version} published successfully.`,
      preview,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/admin/applications/:clientId/billing
 * Update pricing line items.
 */
adminRouter.patch('/:clientId/billing', (req, res, next) => {
  try {
    const { clientId } = req.params;
    const billing = projectStore.updateBilling(clientId, req.body || {}, {
      role: 'admin',
      name: 'Finance Admin',
    });
    res.json({ success: true, billing });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/applications/:clientId/payments
 * Record a verified client payment and advance project milestones.
 */
adminRouter.post('/:clientId/payments', (req, res, next) => {
  try {
    const { clientId } = req.params;
    const paymentData = req.body || {};

    if (!paymentData.amount || Number(paymentData.amount) <= 0) {
      return res.status(400).json({ success: false, error: 'A valid payment amount is required.' });
    }

    const updatedBilling = projectStore.recordPayment(clientId, paymentData, {
      role: 'admin',
      name: 'Lead Architect',
    });

    res.json({
      success: true,
      message: 'Payment verified and milestone updated successfully.',
      billing: updatedBilling,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/applications/:clientId/audit
 * Get full audit history.
 */
adminRouter.get('/:clientId/audit', (req, res, next) => {
  try {
    const logs = projectStore.getAuditLogs(req.params.clientId);
    res.json({ success: true, count: logs.length, logs });
  } catch (err) {
    next(err);
  }
});

// Also keep backward compatibility on router directly under /admin/...
router.get('/admin/all', adminAuth, (req, res, next) => {
  try {
    const list = projectStore.getAllApplications();
    res.json({ success: true, count: list.length, applications: list });
  } catch (err) {
    next(err);
  }
});
router.patch('/admin/:clientId', adminAuth, (req, res, next) => adminRouter.handle(req, res, next));
router.patch('/admin/:clientId/stages/:stageNumber', adminAuth, (req, res, next) => adminRouter.handle(req, res, next));
router.post('/admin/:clientId/preview', adminAuth, (req, res, next) => adminRouter.handle(req, res, next));
router.patch('/admin/:clientId/billing', adminAuth, (req, res, next) => adminRouter.handle(req, res, next));
router.post('/admin/:clientId/payments', adminAuth, (req, res, next) => adminRouter.handle(req, res, next));
router.get('/admin/:clientId/audit', adminAuth, (req, res, next) => adminRouter.handle(req, res, next));

module.exports = router;
module.exports.clientRouter = router;
module.exports.adminRouter = adminRouter;
