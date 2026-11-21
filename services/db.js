const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let dbInstance = null;

function getDb(customPath) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const defaultDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }

  const dbPath = customPath || process.env.DB_PATH || path.join(defaultDir, 'webnavi.db');
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and foreign keys
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  initSchema(db);

  if (!customPath) {
    dbInstance = db;
  }

  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      customer_id TEXT,
      ticket_id TEXT,
      domain TEXT NOT NULL,
      tld TEXT,
      registrant_json TEXT,
      reg_period_years INTEGER DEFAULT 1,
      reg_price REAL DEFAULT 0,
      renew_price REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      tax_note TEXT,
      total_amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'INR',
      payment_status TEXT DEFAULT 'PENDING',
      payment_method TEXT DEFAULT 'Reseller Wallet Allocation',
      status TEXT DEFAULT 'PENDING',
      registrar_ref TEXT,
      zone_id TEXT,
      nameservers_json TEXT,
      created_at TEXT,
      registered_at TEXT,
      expires_at TEXT,
      last_synced_at TEXT,
      idempotency_key TEXT,
      logs_json TEXT,
      secret_token TEXT,
      order_token_hash TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_orders_domain ON orders(domain);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS customer_tokens (
      customer_id TEXT NOT NULL,
      token_hash TEXT NOT NULL PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      description TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_customer_tokens_cid ON customer_tokens(customer_id);

    CREATE TABLE IF NOT EXISTS dns_zones (
      domain TEXT PRIMARY KEY,
      zone_id TEXT,
      order_id TEXT,
      customer_id TEXT,
      status TEXT DEFAULT 'pending',
      nameservers_json TEXT,
      registrar_nameservers_json TEXT,
      nameservers_submitted_to_registrar INTEGER DEFAULT 0,
      nameserver_approval_status TEXT DEFAULT 'none',
      approval_status TEXT DEFAULT 'NOT_SUBMITTED',
      request_date TEXT,
      last_verification_time TEXT,
      latest_registrar_response_json TEXT,
      verification_fail_count INTEGER DEFAULT 0,
      created_at TEXT,
      last_synced_at TEXT,
      cached_records_json TEXT,
      notifications_json TEXT,
      logs_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_zones_zone_id ON dns_zones(zone_id);
    CREATE INDEX IF NOT EXISTS idx_zones_customer ON dns_zones(customer_id);
    CREATE INDEX IF NOT EXISTS idx_zones_order ON dns_zones(order_id);

    -- Project Management: Applications
    CREATE TABLE IF NOT EXISTS applications (
      client_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      customer_id TEXT,
      full_name TEXT,
      business_name TEXT,
      industry TEXT,
      city TEXT,
      state TEXT,
      phone TEXT,
      email TEXT,
      preferred_domain TEXT,
      existing_site TEXT,
      instagram TEXT,
      youtube TEXT,
      facebook TEXT,
      description TEXT,
      assigned_developer TEXT DEFAULT 'Liam & Alex (Lead Architects)',
      current_stage INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      raw_data_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_applications_ticket ON applications(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);

    -- Project Stages
    CREATE TABLE IF NOT EXISTS project_stages (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      stage_number INTEGER NOT NULL,
      stage_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      started_at TEXT,
      completed_at TEXT,
      assigned_user TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_stages_client ON project_stages(client_id);

    -- Real Client-Developer Chat Messages
    CREATE TABLE IF NOT EXISTS project_messages (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      message_text TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_messages_client ON project_messages(client_id);
    CREATE INDEX IF NOT EXISTS idx_project_messages_read ON project_messages(is_read);

    -- Staging Previews
    CREATE TABLE IF NOT EXISTS project_previews (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      version TEXT NOT NULL,
      preview_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PUBLISHED',
      changelog_notes TEXT,
      published_by TEXT,
      published_at TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      is_current INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_project_previews_client ON project_previews(client_id);

    -- Client Revisions
    CREATE TABLE IF NOT EXISTS project_revisions (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      preview_id TEXT,
      preview_version TEXT NOT NULL,
      client_name TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_revisions_client ON project_revisions(client_id);

    -- Project Billings
    CREATE TABLE IF NOT EXISTS project_billings (
      client_id TEXT PRIMARY KEY,
      currency TEXT DEFAULT 'INR',
      design_labor_amount REAL DEFAULT 0,
      design_labor_original REAL DEFAULT 18000,
      domain_cost REAL DEFAULT 1199,
      hosting_cost REAL DEFAULT 1801,
      other_charges REAL DEFAULT 0,
      total_cost REAL DEFAULT 3000,
      milestone1_advance REAL DEFAULT 1500,
      milestone2_balance REAL DEFAULT 1500,
      paid_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'UNPAID',
      updated_at TEXT NOT NULL
    );

    -- Project Payments
    CREATE TABLE IF NOT EXISTS project_payments (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      milestone TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      payment_method TEXT DEFAULT 'Manual Bank / UPI Transfer',
      reference TEXT,
      status TEXT DEFAULT 'VERIFIED',
      verified_by TEXT,
      verified_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_payments_client ON project_payments(client_id);

    -- Project Notifications
    CREATE TABLE IF NOT EXISTS project_notifications (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_notifications_client ON project_notifications(client_id);

    -- Project Audit Logs
    CREATE TABLE IF NOT EXISTS project_audit_logs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_audit_logs_client ON project_audit_logs(client_id);

    -- Domain TLD Pricing Engine Table (Wholesale vs Retail)
    CREATE TABLE IF NOT EXISTS domain_tld_pricing (
      tld TEXT PRIMARY KEY,
      wholesale_register REAL NOT NULL,
      wholesale_renew REAL NOT NULL,
      wholesale_transfer REAL DEFAULT 0,
      retail_register REAL,
      retail_renew REAL,
      retail_transfer REAL,
      currency TEXT DEFAULT 'INR',
      grace_period_days INTEGER DEFAULT 30,
      addons_json TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      allow_loss INTEGER DEFAULT 0,
      supplier_source TEXT DEFAULT 'HostyIndia',
      last_synced_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tld_pricing_active ON domain_tld_pricing(is_active);

    -- Competitor TLD Pricing Table (Verified Competitor Benchmarks)
    CREATE TABLE IF NOT EXISTS competitor_tld_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tld TEXT NOT NULL,
      competitor_name TEXT NOT NULL,
      reg_price REAL,
      renew_price REAL,
      term_years INTEGER DEFAULT 1,
      currency TEXT DEFAULT 'INR',
      conditions TEXT,
      whois_privacy TEXT,
      mandatory_fees REAL DEFAULT 0,
      source_url TEXT NOT NULL,
      is_verified INTEGER DEFAULT 1,
      verified_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      notes TEXT,
      term_options_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_tld_name ON competitor_tld_pricing (tld, competitor_name);
    CREATE INDEX IF NOT EXISTS idx_comp_tld_active ON competitor_tld_pricing (tld, is_active);

    CREATE TABLE IF NOT EXISTS visitors (
      visitor_id TEXT PRIMARY KEY,
      customer_id TEXT,
      first_visit_at TEXT NOT NULL,
      last_visit_at TEXT NOT NULL,
      total_visits INTEGER DEFAULT 1,
      total_page_views INTEGER DEFAULT 1,
      device_category TEXT DEFAULT 'Desktop',
      browser_category TEXT DEFAULT 'Other',
      consent_status TEXT DEFAULT 'pending',
      consent_preferences_json TEXT DEFAULT '{\"necessary\":true,\"functional\":false,\"analytics\":false,\"marketing\":false}',
      consent_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visitors_customer ON visitors(customer_id);
    CREATE INDEX IF NOT EXISTS idx_visitors_last_visit ON visitors(last_visit_at);
    CREATE INDEX IF NOT EXISTS idx_visitors_total_visits ON visitors(total_visits);

    CREATE TABLE IF NOT EXISTS visitor_sessions (
      session_id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      session_number INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      ended_at TEXT,
      page_views_count INTEGER DEFAULT 1,
      entry_page TEXT,
      exit_page TEXT,
      device_category TEXT DEFAULT 'Desktop',
      browser_category TEXT DEFAULT 'Other',
      ip_masked TEXT,
      user_agent TEXT,
      is_bot INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON visitor_sessions(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON visitor_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON visitor_sessions(last_activity_at);

    CREATE TABLE IF NOT EXISTS visitor_pageviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      page_path TEXT NOT NULL,
      page_title TEXT,
      referrer TEXT,
      viewed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pageviews_session ON visitor_pageviews(session_id);
    CREATE INDEX IF NOT EXISTS idx_pageviews_visitor ON visitor_pageviews(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_pageviews_viewed ON visitor_pageviews(viewed_at);

    CREATE TABLE IF NOT EXISTS cookie_consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT,
      customer_id TEXT,
      consent_action TEXT NOT NULL,
      necessary INTEGER DEFAULT 1,
      functional INTEGER DEFAULT 0,
      analytics INTEGER DEFAULT 0,
      marketing INTEGER DEFAULT 0,
      ip_masked TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consents_visitor ON cookie_consents(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_consents_created ON cookie_consents(created_at);

    -- Dedicated Customer Accounts
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      account_status TEXT DEFAULT 'ACTIVE',
      email_verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
    CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(account_status);

    -- Secure Customer Sessions
    CREATE TABLE IF NOT EXISTS customer_sessions (
      session_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      ip_masked TEXT,
      user_agent TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cust_sessions_cid ON customer_sessions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_cust_sessions_expires ON customer_sessions(expires_at);

    -- Single-Use Password Reset Tokens
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pwd_resets_token ON password_resets(token_hash);
    CREATE INDEX IF NOT EXISTS idx_pwd_resets_cid ON password_resets(customer_id);

    -- Single-Use Email Verification Tokens (24h validity, SHA-256 hashed)
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verification_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_email_verif_cid ON email_verification_tokens(customer_id);

    -- Persistent Database-Backed Rate Limiting (Single-server shared store)
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      hits INTEGER NOT NULL DEFAULT 1,
      reset_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
  `);

  try {
    db.exec(`ALTER TABLE orders ADD COLUMN wholesale_cost REAL DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE orders ADD COLUMN secret_token TEXT`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE orders ADD COLUMN order_token_hash TEXT`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE orders ADD COLUMN dns_status TEXT DEFAULT 'NOT_STARTED'`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_token_hash ON orders(order_token_hash)`);
  } catch (e) {
    // Ignore index creation error
  }

  try {
    db.exec(`ALTER TABLE competitor_tld_pricing ADD COLUMN term_options_json TEXT`);
  } catch (e) {
    // Column already exists
  }
}

module.exports = {
  getDb,
  initSchema,
};

