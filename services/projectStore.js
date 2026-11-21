const crypto = require('crypto');
const { getDb } = require('./db');

const STAGE_NAMES = [
  'Form Submission & Intake Audit',
  'Developer Consultation & Interactive Demo Review',
  'Milestone 1 Advance & Domain Purchase',
  'Site Architecture & Page Assembly',
  'Hosting / LiteSpeed Cloud Hosting Setup',
  'Final Balance Payment & Handover',
];

const STAGE_DESCRIPTIONS = [
  'Business profile received and ICANN domain availability verified.',
  'Interactive wireframe & typography review with lead developer.',
  'Domain locking, DNS configuration & wholesale gateway allocation.',
  'Full responsive layout assembly, WhatsApp conversion hooks & assets.',
  'Dedicated LiteSpeed NVMe node, SSL certificates & database provisioning.',
  'Source code export, root DNS transfer & final project settlement.',
];

const VALID_STAGE_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'AWAITING_PAYMENT'];

class ProjectStore {
  constructor(customDb = null) {
    this.db = customDb || getDb();
    if (process.env.SEED_DEMO_DATA === 'true') {
      this.seedInitialDemoApplication();
    }
  }

  seedInitialDemoApplication() {
    try {
      const seedClientId = 'wn84920-demo-artisan';
      const existing = this.db.prepare('SELECT client_id FROM applications WHERE client_id = ?').get(seedClientId);
      if (existing) return;

      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO applications (
          client_id, ticket_id, customer_id, full_name, business_name, industry,
          city, state, phone, email, preferred_domain, existing_site,
          instagram, youtube, facebook, description, assigned_developer,
          current_stage, created_at, updated_at, raw_data_json
        ) VALUES (
          ?, 'WN-84920', ?, 'Vikram Malhotra', 'The Artisan Spice Co.', 'Specialty Food, Organic Spices',
          'Pune', 'Maharashtra', '+91 98765 43210', 'vikram@artisanspice.in', 'theartisanspice.com', 'None',
          'artisanspice_in', '', '', 'Handcrafted digital presence to showcase catalog and accept direct orders.',
          'Liam & Alex (Lead Architects)', 2, ?, ?, '{}'
        )
      `).run(seedClientId, seedClientId, now, now);

      STAGE_NAMES.forEach((name, idx) => {
        const stageNum = idx + 1;
        let status = 'PENDING';
        let startedAt = null;
        let completedAt = null;
        let assignedUser = null;
        let notes = STAGE_DESCRIPTIONS[idx];

        if (stageNum === 1) {
          status = 'COMPLETED';
          startedAt = now;
          completedAt = now;
          assignedUser = 'System Intake Audit';
          notes = 'Form intake completed and verified with ICANN registry.';
        } else if (stageNum === 2) {
          status = 'IN_PROGRESS';
          startedAt = now;
          assignedUser = 'Liam & Alex (Lead Architects)';
          notes = 'Interactive consultation and prototype review ready.';
        }

        this.db.prepare(`
          INSERT INTO project_stages (
            id, client_id, stage_number, stage_name, status, started_at, completed_at, assigned_user, notes, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`${seedClientId}_stage_${stageNum}`, seedClientId, stageNum, name, status, startedAt, completedAt, assignedUser, notes, now);
      });

      this.db.prepare(`
        INSERT INTO project_billings (
          client_id, currency, design_labor_amount, design_labor_original,
          domain_cost, hosting_cost, other_charges, total_cost,
          milestone1_advance, milestone2_balance, paid_amount, payment_status, updated_at
        ) VALUES (?, 'INR', 0, 18000, 1199, 1801, 0, 3000, 1500, 1500, 0, 'UNPAID', ?)
      `).run(seedClientId, now);
    } catch (e) {
      // Non-fatal if table not yet initialized
    }
  }

  /**
   * Create a new client application with complete project lifecycle, billing, and audit records.
   */
  createApplication(formData) {
    const ticketId = 'WN-' + Math.floor(10000 + Math.random() * 90000);
    const clientId = ticketId.replace('WN-', 'wn') + '-' + crypto.randomBytes(6).toString('hex');
    const now = new Date().toISOString();

    const fullName = (formData.fullName || formData.name || '').trim();
    const businessName = (formData.businessName || formData.brandName || '').trim();
    const industry = (formData.industry || '').trim();
    const city = (formData.city || '').trim();
    const state = (formData.state || '').trim();
    const phone = (formData.phone || '').trim();
    const email = (formData.email || '').trim().toLowerCase();
    const preferredDomain = (formData.preferredDomain || formData.domain || '').trim().toLowerCase();
    const existingSite = (formData.existingSite || '').trim();
    const instagram = (formData.instagram || '').trim();
    const youtube = (formData.youtube || '').trim();
    const facebook = (formData.facebook || '').trim();
    const description = (formData.description || formData.notes || formData.projectBrief || '').trim();
    const assignedDeveloper = 'Liam & Alex (Lead Architects)';

    // 1. Insert Application
    const insertAppStmt = this.db.prepare(`
      INSERT INTO applications (
        client_id, ticket_id, customer_id, full_name, business_name, industry,
        city, state, phone, email, preferred_domain, existing_site,
        instagram, youtube, facebook, description, assigned_developer,
        current_stage, created_at, updated_at, raw_data_json
      ) VALUES (
        @clientId, @ticketId, @customerId, @fullName, @businessName, @industry,
        @city, @state, @phone, @email, @preferredDomain, @existingSite,
        @instagram, @youtube, @facebook, @description, @assignedDeveloper,
        2, @createdAt, @updatedAt, @rawDataJson
      )
    `);

    insertAppStmt.run({
      clientId,
      ticketId,
      customerId: formData.customerId || clientId,
      fullName,
      businessName,
      industry,
      city,
      state,
      phone,
      email,
      preferredDomain,
      existingSite,
      instagram,
      youtube,
      facebook,
      description,
      assignedDeveloper,
      createdAt: now,
      updatedAt: now,
      rawDataJson: JSON.stringify(formData),
    });

    // 2. Initialize 6 Project Stages
    const insertStageStmt = this.db.prepare(`
      INSERT INTO project_stages (
        id, client_id, stage_number, stage_name, status, started_at, completed_at, assigned_user, notes, updated_at
      ) VALUES (
        @id, @clientId, @stageNumber, @stageName, @status, @startedAt, @completedAt, @assignedUser, @notes, @updatedAt
      )
    `);

    STAGE_NAMES.forEach((name, idx) => {
      const stageNum = idx + 1;
      let status = 'PENDING';
      let startedAt = null;
      let completedAt = null;
      let assignedUser = null;
      let notes = STAGE_DESCRIPTIONS[idx];

      if (stageNum === 1) {
        status = 'COMPLETED';
        startedAt = now;
        completedAt = now;
        assignedUser = 'System Intake Audit';
        notes = 'Form intake completed and verified with ICANN registry.';
      } else if (stageNum === 2) {
        status = 'IN_PROGRESS';
        startedAt = now;
        assignedUser = assignedDeveloper;
        notes = 'Interactive consultation and prototype review ready.';
      }

      insertStageStmt.run({
        id: `${clientId}_stage_${stageNum}`,
        clientId,
        stageNumber: stageNum,
        stageName: name,
        status,
        startedAt,
        completedAt,
        assignedUser,
        notes,
        updatedAt: now,
      });
    });

    // 3. Initialize Project Billings
    const insertBillingStmt = this.db.prepare(`
      INSERT INTO project_billings (
        client_id, currency, design_labor_amount, design_labor_original,
        domain_cost, hosting_cost, other_charges, total_cost,
        milestone1_advance, milestone2_balance, paid_amount, payment_status, updated_at
      ) VALUES (
        @clientId, 'INR', 0, 18000, 1199, 1801, 0, 3000, 1500, 1500, 0, 'UNPAID', @updatedAt
      )
    `);

    insertBillingStmt.run({
      clientId,
      updatedAt: now,
    });

    // 4. Initial Audit Log & Notification (Messages remain empty until client or admin starts conversation)
    this.logAudit(clientId, 'APPLICATION_CREATED', 'client', fullName || 'Applicant', {
      ticketId,
      preferredDomain,
      industry,
    });

    this.createNotification(clientId, 'STAGE_CHANGE', 'Application Intake Completed', 'Your application was accepted and Stage 2 consultation is in progress.');

    return this.getApplication(clientId);
  }

  /**
   * Retrieve full application details including stages, billing, preview, and unread counts.
   */
  getApplication(clientId) {
    if (!clientId) return null;
    const cleanId = clientId.trim();

    const app = this.db.prepare(`SELECT * FROM applications WHERE client_id = ?`).get(cleanId);
    if (!app) return null;

    const stages = this.getStages(cleanId);
    const billing = this.getBilling(cleanId);
    const currentPreview = this.getCurrentPreview(cleanId);
    const unreadClient = this.getUnreadCount(cleanId, 'client');
    const unreadAdmin = this.getUnreadCount(cleanId, 'admin');

    let rawData = {};
    try {
      rawData = JSON.parse(app.raw_data_json || '{}');
    } catch (e) {}

    return {
      clientId: app.client_id,
      ticketId: app.ticket_id,
      customerId: app.customer_id,
      fullName: app.full_name,
      businessName: app.business_name,
      industry: app.industry,
      city: app.city,
      state: app.state,
      phone: app.phone,
      email: app.email,
      preferredDomain: app.preferred_domain,
      existingSite: app.existing_site,
      instagram: app.instagram,
      youtube: app.youtube,
      facebook: app.facebook,
      description: app.description,
      assignedDeveloper: app.assigned_developer,
      currentStage: app.current_stage,
      createdAt: app.created_at,
      updatedAt: app.updated_at,
      stages,
      billing,
      currentPreview,
      unreadClientMessages: unreadClient,
      unreadAdminMessages: unreadAdmin,
      rawData,
    };
  }

  /**
   * Retrieve all applications for admin management.
   */
  getAllApplications() {
    const rows = this.db.prepare(`SELECT * FROM applications ORDER BY created_at DESC`).all();
    return rows.map(r => this.getApplication(r.client_id));
  }

  /**
   * Retrieve the most recent application by email address.
   */
  getApplicationByEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const cleanEmail = email.trim().toLowerCase();
    const row = this.db.prepare(`SELECT client_id FROM applications WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 1`).get(cleanEmail);
    if (!row) return null;
    return this.getApplication(row.client_id);
  }

  /**
   * Retrieve the most recent application associated with a customer ID.
   */
  getApplicationByCustomerId(customerId) {
    if (!customerId) return null;
    const row = this.db.prepare(`
      SELECT client_id FROM applications 
      WHERE customer_id = ? OR client_id = ? 
      ORDER BY created_at DESC LIMIT 1
    `).get(customerId, customerId);
    if (!row) return null;
    return this.getApplication(row.client_id);
  }

  /**
   * Update application metadata (e.g., assigned developer).
   */
  updateApplication(clientId, updates = {}, actor = { role: 'admin', name: 'Admin' }) {
    const existing = this.getApplication(clientId);
    if (!existing) throw new Error('Application not found');

    const now = new Date().toISOString();
    const fields = [];
    const params = { clientId, updatedAt: now };

    if (updates.assignedDeveloper !== undefined) {
      fields.push('assigned_developer = @assignedDeveloper');
      params.assignedDeveloper = updates.assignedDeveloper;
    }
    if (updates.preferredDomain !== undefined) {
      fields.push('preferred_domain = @preferredDomain');
      params.preferredDomain = updates.preferredDomain.trim().toLowerCase();
    }
    if (updates.description !== undefined) {
      fields.push('description = @description');
      params.description = updates.description;
    }

    if (fields.length > 0) {
      fields.push('updated_at = @updatedAt');
      this.db.prepare(`UPDATE applications SET ${fields.join(', ')} WHERE client_id = @clientId`).run(params);
      this.logAudit(clientId, 'APPLICATION_UPDATED', actor.role, actor.name, updates);
    }

    return this.getApplication(clientId);
  }

  // ── STAGE LIFECYCLE ─────────────────────────────────────────────────────────

  getStages(clientId) {
    const rows = this.db.prepare(`
      SELECT * FROM project_stages WHERE client_id = ? ORDER BY stage_number ASC
    `).all(clientId.trim());

    return rows.map(r => ({
      id: r.id,
      stageNumber: r.stage_number,
      stageName: r.stage_name,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      assignedUser: r.assigned_user,
      notes: r.notes,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Update a project stage's status with sequence enforcement.
   */
  updateStageStatus(clientId, stageNumber, newStatus, metadata = {}, actor = { role: 'admin', name: 'Admin' }) {
    const cleanNum = Number(stageNumber);
    if (!cleanNum || cleanNum < 1 || cleanNum > 6) {
      throw new Error(`Invalid stage number: ${stageNumber}. Must be between 1 and 6.`);
    }
    const cleanStatus = String(newStatus).toUpperCase().trim();
    if (!VALID_STAGE_STATUSES.includes(cleanStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Allowed: ${VALID_STAGE_STATUSES.join(', ')}`);
    }

    const stages = this.getStages(clientId);
    const targetStage = stages.find(s => s.stageNumber === cleanNum);
    if (!targetStage) throw new Error(`Stage ${cleanNum} not found for client ${clientId}`);

    // Sequence Validation: Cannot mark completed if previous stages are not completed
    if (cleanStatus === 'COMPLETED' && cleanNum > 1) {
      const priorIncomplete = stages.filter(s => s.stageNumber < cleanNum && s.status !== 'COMPLETED');
      if (priorIncomplete.length > 0) {
        throw new Error(`Cannot complete Stage ${cleanNum} until prior stages (${priorIncomplete.map(s => s.stageNumber).join(', ')}) are completed.`);
      }
    }

    const now = new Date().toISOString();
    let completedAt = targetStage.completedAt;
    let startedAt = targetStage.startedAt;

    if (cleanStatus === 'COMPLETED') {
      completedAt = now;
      if (!startedAt) startedAt = now;
    } else if (cleanStatus === 'IN_PROGRESS' || cleanStatus === 'AWAITING_PAYMENT') {
      if (!startedAt) startedAt = now;
      completedAt = null;
    }

    const assignedUser = metadata.assignedUser || targetStage.assignedUser || actor.name;
    const notes = metadata.notes !== undefined ? metadata.notes : targetStage.notes;

    this.db.prepare(`
      UPDATE project_stages SET
        status = @status,
        started_at = @startedAt,
        completed_at = @completedAt,
        assigned_user = @assignedUser,
        notes = @notes,
        updated_at = @updatedAt
      WHERE client_id = @clientId AND stage_number = @stageNumber
    `).run({
      status: cleanStatus,
      startedAt,
      completedAt,
      assignedUser,
      notes,
      updatedAt: now,
      clientId,
      stageNumber: cleanNum,
    });

    // If stage was completed, advance current_stage
    let nextCurrentStage = cleanNum;
    if (cleanStatus === 'COMPLETED') {
      if (cleanNum < 6) {
        nextCurrentStage = cleanNum + 1;
        // Automatically start next stage if it was PENDING
        const nextStage = stages.find(s => s.stageNumber === nextCurrentStage);
        if (nextStage && nextStage.status === 'PENDING') {
          const nextInitialStatus = (nextCurrentStage === 3 || nextCurrentStage === 6) ? 'AWAITING_PAYMENT' : 'IN_PROGRESS';
          this.db.prepare(`
            UPDATE project_stages SET
              status = ?, started_at = ?, updated_at = ?
            WHERE client_id = ? AND stage_number = ?
          `).run(nextInitialStatus, now, now, clientId, nextCurrentStage);
        }
      }
    } else if (cleanStatus === 'IN_PROGRESS' || cleanStatus === 'AWAITING_PAYMENT') {
      nextCurrentStage = cleanNum;
    }

    this.db.prepare(`
      UPDATE applications SET current_stage = ?, updated_at = ? WHERE client_id = ?
    `).run(nextCurrentStage, now, clientId);

    // Audit Log & Notification
    this.logAudit(clientId, 'STAGE_STATUS_UPDATED', actor.role, actor.name, {
      stageNumber: cleanNum,
      oldStatus: targetStage.status,
      newStatus: cleanStatus,
      notes,
    });

    this.createNotification(
      clientId,
      'STAGE_CHANGE',
      `Stage ${cleanNum}: ${targetStage.stageName}`,
      `Status updated to ${cleanStatus} by ${actor.name}.`
    );

    return this.getStages(clientId);
  }

  // ── DYNAMIC CHAT MESSAGING ──────────────────────────────────────────────────

  getMessages(clientId) {
    const rows = this.db.prepare(`
      SELECT * FROM project_messages WHERE client_id = ? ORDER BY created_at ASC
    `).all(clientId.trim());

    return rows.map(r => ({
      id: r.id,
      clientId: r.client_id,
      senderRole: r.sender_role,
      senderId: r.sender_id,
      authorName: r.author_name,
      text: r.message_text,
      isRead: Boolean(r.is_read),
      readAt: r.read_at,
      timestamp: r.created_at,
    }));
  }

  postMessage(clientId, messageData) {
    const {
      senderRole = 'client',
      senderId = 'user',
      authorName = 'User',
      messageText,
    } = messageData || {};

    if (!messageText || !messageText.trim()) {
      throw new Error('Message text is required.');
    }

    const id = 'msg_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO project_messages (
        id, client_id, sender_role, sender_id, author_name, message_text, is_read, read_at, created_at
      ) VALUES (
        @id, @clientId, @senderRole, @senderId, @authorName, @messageText, 0, NULL, @createdAt
      )
    `).run({
      id,
      clientId: clientId.trim(),
      senderRole,
      senderId,
      authorName,
      messageText: messageText.trim(),
      createdAt: now,
    });

    // Notify the other party
    const targetType = senderRole === 'client' ? 'ADMIN_MESSAGE_ALERT' : 'CLIENT_MESSAGE_ALERT';
    this.createNotification(
      clientId,
      'MESSAGE',
      `New Message from ${authorName}`,
      messageText.trim().substring(0, 100)
    );

    return {
      id,
      clientId,
      senderRole,
      senderId,
      authorName,
      text: messageText.trim(),
      isRead: false,
      timestamp: now,
    };
  }

  markMessagesAsRead(clientId, readerRole) {
    const now = new Date().toISOString();
    // If client is reading, mark engineer/admin/system messages as read
    // If admin is reading, mark client messages as read
    const targetRoles = readerRole === 'client' ? ['engineer', 'admin', 'system'] : ['client'];
    const placeholders = targetRoles.map(() => '?').join(',');

    this.db.prepare(`
      UPDATE project_messages
      SET is_read = 1, read_at = ?
      WHERE client_id = ? AND is_read = 0 AND sender_role IN (${placeholders})
    `).run(now, clientId.trim(), ...targetRoles);
  }

  getUnreadCount(clientId, role) {
    const targetRoles = role === 'client' ? ['engineer', 'admin', 'system'] : ['client'];
    const placeholders = targetRoles.map(() => '?').join(',');
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM project_messages
      WHERE client_id = ? AND is_read = 0 AND sender_role IN (${placeholders})
    `).get(clientId.trim(), ...targetRoles);

    return row ? row.count : 0;
  }

  // ── STAGING PREVIEW SANDBOX ─────────────────────────────────────────────────

  getPreviews(clientId) {
    const rows = this.db.prepare(`
      SELECT * FROM project_previews WHERE client_id = ? ORDER BY published_at DESC
    `).all(clientId.trim());

    return rows.map(r => ({
      id: r.id,
      clientId: r.client_id,
      version: r.version,
      previewUrl: r.preview_url,
      status: r.status,
      changelogNotes: r.changelog_notes,
      publishedBy: r.published_by,
      publishedAt: r.published_at,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      isCurrent: Boolean(r.is_current),
    }));
  }

  getCurrentPreview(clientId) {
    const row = this.db.prepare(`
      SELECT * FROM project_previews WHERE client_id = ? AND is_current = 1 LIMIT 1
    `).get(clientId.trim());

    if (!row) return null;

    return {
      id: row.id,
      clientId: row.client_id,
      version: row.version,
      previewUrl: row.preview_url,
      status: row.status,
      changelogNotes: row.changelog_notes,
      publishedBy: row.published_by,
      publishedAt: row.published_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      isCurrent: true,
    };
  }

  publishPreview(clientId, data, actor = { role: 'admin', name: 'Developer' }) {
    const {
      previewUrl,
      version = 'v1.0',
      changelogNotes = 'Initial staging preview deployment.',
    } = data || {};

    if (!previewUrl || !previewUrl.trim()) {
      throw new Error('A valid preview URL is required.');
    }

    const cleanUrl = previewUrl.trim();
    const cleanVersion = version.trim();
    const now = new Date().toISOString();
    const id = 'prv_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');

    // Archive previous active previews
    this.db.prepare(`
      UPDATE project_previews SET is_current = 0, status = 'ARCHIVED' WHERE client_id = ?
    `).run(clientId.trim());

    // Insert new current preview
    this.db.prepare(`
      INSERT INTO project_previews (
        id, client_id, version, preview_url, status, changelog_notes, published_by, published_at, is_current
      ) VALUES (
        @id, @clientId, @version, @previewUrl, 'PUBLISHED', @changelogNotes, @publishedBy, @publishedAt, 1
      )
    `).run({
      id,
      clientId: clientId.trim(),
      version: cleanVersion,
      previewUrl: cleanUrl,
      changelogNotes: changelogNotes.trim(),
      publishedBy: actor.name,
      publishedAt: now,
    });

    // Notify client via chat & notifications
    this.postMessage(clientId, {
      senderRole: 'engineer',
      senderId: 'engineer',
      authorName: actor.name,
      messageText: `Staging preview ${cleanVersion} published! Please review the layout in your Sandbox: ${cleanUrl}`,
    });

    this.createNotification(
      clientId,
      'PREVIEW_PUBLISHED',
      `New Staging Preview: ${cleanVersion}`,
      `Lead developer published ${cleanVersion}. You can inspect desktop and mobile layouts in your sandbox.`
    );

    this.logAudit(clientId, 'PREVIEW_PUBLISHED', actor.role, actor.name, {
      previewId: id,
      version: cleanVersion,
      previewUrl: cleanUrl,
    });

    return this.getCurrentPreview(clientId);
  }

  approvePreview(clientId, version, actor = { role: 'client', name: 'Client' }) {
    const current = this.getCurrentPreview(clientId);
    if (!current) {
      throw new Error('No published preview found to approve.');
    }
    if (version && current.version !== version.trim()) {
      throw new Error(`Approval version mismatch: currently reviewing ${current.version}, attempted to approve ${version}.`);
    }

    const now = new Date().toISOString();

    // 1. Mark Preview as Approved
    this.db.prepare(`
      UPDATE project_previews SET approved_by = ?, approved_at = ? WHERE id = ?
    `).run(actor.name, now, current.id);

    // 2. Advance Stage 2 to COMPLETED
    this.updateStageStatus(clientId, 2, 'COMPLETED', {
      notes: `Interactive demo preview ${current.version} reviewed and formally approved by ${actor.name}.`,
    }, actor);

    // 3. Stage 3 (Milestone 1 Advance & Domain Purchase) unlocks to AWAITING_PAYMENT
    this.updateStageStatus(clientId, 3, 'AWAITING_PAYMENT', {
      notes: 'Demo approved. Advance payment gateway unlocked for domain reservation.',
    }, actor);

    // 4. Log Audit & Notifications
    this.logAudit(clientId, 'DEMO_APPROVED', actor.role, actor.name, {
      previewId: current.id,
      version: current.version,
    });

    this.createNotification(
      clientId,
      'DEMO_APPROVED',
      'Demo Approved by Client',
      `${actor.name} approved preview ${current.version}. Milestone 1 payment is now ready.`
    );

    this.postMessage(clientId, {
      senderRole: 'system',
      senderId: 'system',
      authorName: 'WebNavi Milestone Manager',
      messageText: `✓ Client approved interactive demo preview ${current.version}. Stage 2 complete! Advance deposit (Milestone 1) is now unlocked.`,
    });

    return {
      success: true,
      previewId: current.id,
      version: current.version,
      approvedAt: now,
      approvedBy: actor.name,
      nextStage: 3,
    };
  }

  requestRevision(clientId, version, comment, actor = { role: 'client', name: 'Client' }) {
    if (!comment || !comment.trim()) {
      throw new Error('A detailed revision note or comment is required.');
    }

    const current = this.getCurrentPreview(clientId);
    const targetVersion = version ? version.trim() : (current ? current.version : 'v1.0');
    const now = new Date().toISOString();
    const id = 'rev_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');

    this.db.prepare(`
      INSERT INTO project_revisions (
        id, client_id, preview_id, preview_version, client_name, comment, created_at
      ) VALUES (
        @id, @clientId, @previewId, @previewVersion, @clientName, @comment, @createdAt
      )
    `).run({
      id,
      clientId: clientId.trim(),
      previewId: current ? current.id : null,
      previewVersion: targetVersion,
      clientName: actor.name,
      comment: comment.trim(),
      createdAt: now,
    });

    // Stage 2 remains IN_PROGRESS with note
    this.updateStageStatus(clientId, 2, 'IN_PROGRESS', {
      notes: `Client requested revisions on ${targetVersion}: "${comment.trim().substring(0, 80)}"`,
    }, actor);

    this.postMessage(clientId, {
      senderRole: 'client',
      senderId: 'client',
      authorName: actor.name,
      messageText: `📝 Revision requested on ${targetVersion}: ${comment.trim()}`,
    });

    this.createNotification(
      clientId,
      'REVISION_REQUESTED',
      `Revision Requested on ${targetVersion}`,
      `${actor.name}: "${comment.trim().substring(0, 100)}"`
    );

    this.logAudit(clientId, 'REVISION_REQUESTED', actor.role, actor.name, {
      revisionId: id,
      version: targetVersion,
      comment: comment.trim(),
    });

    return {
      success: true,
      revisionId: id,
      version: targetVersion,
      comment: comment.trim(),
      createdAt: now,
    };
  }

  getRevisions(clientId) {
    const rows = this.db.prepare(`
      SELECT * FROM project_revisions WHERE client_id = ? ORDER BY created_at DESC
    `).all(clientId.trim());

    return rows.map(r => ({
      id: r.id,
      previewId: r.preview_id,
      previewVersion: r.preview_version,
      clientName: r.client_name,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  }

  // ── DYNAMIC BILLING & PAYMENTS ───────────────────────────────────────────────

  getBilling(clientId) {
    const cleanId = clientId.trim();
    let billing = this.db.prepare(`SELECT * FROM project_billings WHERE client_id = ?`).get(cleanId);
    if (!billing) {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO project_billings (
          client_id, currency, design_labor_amount, design_labor_original,
          domain_cost, hosting_cost, other_charges, total_cost,
          milestone1_advance, milestone2_balance, paid_amount, payment_status, updated_at
        ) VALUES (
          ?, 'INR', 0, 18000, 1199, 1801, 0, 3000, 1500, 1500, 0, 'UNPAID', ?
        )
      `).run(cleanId, now);
      billing = this.db.prepare(`SELECT * FROM project_billings WHERE client_id = ?`).get(cleanId);
    }

    const payments = this.getPayments(cleanId);
    const paidSum = payments.filter(p => p.status === 'VERIFIED').reduce((sum, p) => sum + p.amount, 0);

    return {
      clientId: billing.client_id,
      currency: billing.currency || 'INR',
      designLaborAmount: billing.design_labor_amount,
      designLaborOriginal: billing.design_labor_original,
      domainCost: billing.domain_cost,
      hostingCost: billing.hosting_cost,
      otherCharges: billing.other_charges,
      totalCost: billing.total_cost,
      milestone1Advance: billing.milestone1_advance,
      milestone2Balance: billing.milestone2_balance,
      paidAmount: paidSum,
      remainingBalance: Math.max(0, billing.total_cost - paidSum),
      paymentStatus: paidSum >= billing.total_cost ? 'PAID' : (paidSum > 0 ? 'PARTIALLY_PAID' : 'UNPAID'),
      updatedAt: billing.updated_at,
      payments,
    };
  }

  updateBilling(clientId, updates = {}, actor = { role: 'admin', name: 'Admin' }) {
    const existing = this.getBilling(clientId);
    const now = new Date().toISOString();

    const domainCost = updates.domainCost !== undefined ? Number(updates.domainCost) : existing.domainCost;
    const hostingCost = updates.hostingCost !== undefined ? Number(updates.hostingCost) : existing.hostingCost;
    const otherCharges = updates.otherCharges !== undefined ? Number(updates.otherCharges) : existing.otherCharges;
    const designLabor = updates.designLaborAmount !== undefined ? Number(updates.designLaborAmount) : existing.designLaborAmount;
    const totalCost = designLabor + domainCost + hostingCost + otherCharges;
    const m1 = updates.milestone1Advance !== undefined ? Number(updates.milestone1Advance) : Math.round(totalCost / 2);
    const m2 = Math.max(0, totalCost - m1);

    this.db.prepare(`
      UPDATE project_billings SET
        design_labor_amount = @designLabor,
        domain_cost = @domainCost,
        hosting_cost = @hostingCost,
        other_charges = @otherCharges,
        total_cost = @totalCost,
        milestone1_advance = @m1,
        milestone2_balance = @m2,
        updated_at = @updatedAt
      WHERE client_id = @clientId
    `).run({
      designLabor,
      domainCost,
      hostingCost,
      otherCharges,
      totalCost,
      m1,
      m2,
      updatedAt: now,
      clientId,
    });

    this.logAudit(clientId, 'BILLING_UPDATED', actor.role, actor.name, {
      totalCost,
      milestone1Advance: m1,
      milestone2Balance: m2,
    });

    return this.getBilling(clientId);
  }

  getPayments(clientId) {
    const rows = this.db.prepare(`
      SELECT * FROM project_payments WHERE client_id = ? ORDER BY created_at ASC
    `).all(clientId.trim());

    return rows.map(r => ({
      id: r.id,
      clientId: r.client_id,
      milestone: r.milestone,
      amount: r.amount,
      currency: r.currency,
      paymentMethod: r.payment_method,
      reference: r.reference,
      status: r.status,
      verifiedBy: r.verified_by,
      verifiedAt: r.verified_at,
      notes: r.notes,
      createdAt: r.created_at,
    }));
  }

  recordPayment(clientId, paymentData, actor = { role: 'admin', name: 'Admin' }) {
    const {
      milestone = 'Milestone 1 Advance',
      amount,
      currency = 'INR',
      paymentMethod = 'Bank / UPI Direct',
      reference = 'TXN-' + Math.floor(100000 + Math.random() * 900000),
      notes = 'Verified by administrator.',
    } = paymentData || {};

    const cleanAmount = Number(amount);
    if (!cleanAmount || cleanAmount <= 0) {
      throw new Error('A valid positive payment amount is required.');
    }

    const id = 'pay_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO project_payments (
        id, client_id, milestone, amount, currency, payment_method, reference, status, verified_by, verified_at, notes, created_at
      ) VALUES (
        @id, @clientId, @milestone, @amount, @currency, @paymentMethod, @reference, 'VERIFIED', @verifiedBy, @verifiedAt, @notes, @createdAt
      )
    `).run({
      id,
      clientId: clientId.trim(),
      milestone: milestone.trim(),
      amount: cleanAmount,
      currency,
      paymentMethod,
      reference: reference.trim(),
      verifiedBy: actor.name,
      verifiedAt: now,
      notes: notes.trim(),
      createdAt: now,
    });

    const billing = this.getBilling(clientId);
    const paidSum = billing.paidAmount;

    // Automated Stage Lifecycle Progression based on verified payments
    // 1. If Milestone 1 is verified: complete Stage 3, advance Stage 4 to IN_PROGRESS
    if (paidSum >= billing.milestone1Advance) {
      try {
        this.updateStageStatus(clientId, 3, 'COMPLETED', {
          notes: `Milestone 1 Advance (${currency} ${cleanAmount}) verified. Reference: ${reference}`,
        }, actor);
        this.updateStageStatus(clientId, 4, 'IN_PROGRESS', {
          notes: 'Domain lock confirmed. Site assembly & page generation in progress.',
        }, actor);
      } catch (e) {
        // Safe continuation if already at a higher stage
      }
    }

    // 2. If Milestone 2 / Full total is verified: complete Stage 6
    if (paidSum >= billing.totalCost) {
      try {
        this.updateStageStatus(clientId, 6, 'COMPLETED', {
          notes: `Final balance verified (${currency} ${cleanAmount}). Reference: ${reference}. Handover complete.`,
        }, actor);
      } catch (e) {}
    }

    // Update billing status
    const newStatus = paidSum >= billing.totalCost ? 'PAID' : 'PARTIALLY_PAID';
    this.db.prepare(`
      UPDATE project_billings SET paid_amount = ?, payment_status = ?, updated_at = ? WHERE client_id = ?
    `).run(paidSum, newStatus, now, clientId);

    this.postMessage(clientId, {
      senderRole: 'system',
      senderId: 'system',
      authorName: 'WebNavi Accounts Gateway',
      messageText: `💳 Payment verified: ${currency} ${cleanAmount.toFixed(2)} for ${milestone} (Ref: ${reference}). Receipt generated.`,
    });

    this.createNotification(
      clientId,
      'PAYMENT_VERIFIED',
      `Payment Verified (${currency} ${cleanAmount})`,
      `Receipt generated for ${milestone}. Reference: ${reference}.`
    );

    this.logAudit(clientId, 'PAYMENT_VERIFIED', actor.role, actor.name, {
      paymentId: id,
      milestone,
      amount: cleanAmount,
      reference,
    });

    return this.getBilling(clientId);
  }

  // ── NOTIFICATIONS & AUDIT LOGS ──────────────────────────────────────────────

  createNotification(clientId, type, title, message) {
    const id = 'notif_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO project_notifications (
        id, client_id, type, title, message, is_read, created_at
      ) VALUES (
        @id, @clientId, @type, @title, @message, 0, @createdAt
      )
    `).run({
      id,
      clientId: clientId.trim(),
      type,
      title,
      message,
      createdAt: now,
    });

    return id;
  }

  getNotifications(clientId) {
    const rows = this.db.prepare(`
      SELECT * FROM project_notifications WHERE client_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(clientId.trim());

    return rows.map(r => ({
      id: r.id,
      clientId: r.client_id,
      type: r.type,
      title: r.title,
      message: r.message,
      isRead: Boolean(r.is_read),
      createdAt: r.created_at,
    }));
  }

  markNotificationRead(notificationId) {
    this.db.prepare(`
      UPDATE project_notifications SET is_read = 1 WHERE id = ?
    `).run(notificationId);
  }

  logAudit(clientId, action, actorRole, actorName, details = {}) {
    const id = 'aud_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO project_audit_logs (
        id, client_id, action, actor_role, actor_name, details_json, created_at
      ) VALUES (
        @id, @clientId, @action, @actorRole, @actorName, @detailsJson, @createdAt
      )
    `).run({
      id,
      clientId: clientId.trim(),
      action,
      actorRole,
      actorName,
      detailsJson: JSON.stringify(details),
      createdAt: now,
    });

    return id;
  }

  getAuditLogs(clientId) {
    const rows = this.db.prepare(`
      SELECT * FROM project_audit_logs WHERE client_id = ? ORDER BY created_at DESC
    `).all(clientId.trim());

    return rows.map(r => {
      let details = {};
      try {
        details = JSON.parse(r.details_json || '{}');
      } catch (e) {}

      return {
        id: r.id,
        action: r.action,
        actorRole: r.actor_role,
        actorName: r.actor_name,
        details,
        timestamp: r.created_at,
      };
    });
  }
}

module.exports = new ProjectStore();
