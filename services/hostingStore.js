const crypto = require('crypto');

/**
 * WebNavi Hosting Accounts Store
 * In-memory persistence reusing existing database architecture.
 */
class HostingStore {
  constructor() {
    this.hostingAccounts = new Map();
    if (process.env.SEED_DEMO_DATA === 'true') {
      this._seedDemoAccount();
    }
  }

  _seedDemoAccount() {
    const demoId = 'HOST-84920';
    const now = new Date();
    const renewal = new Date(now);
    renewal.setFullYear(renewal.getFullYear() + 1);

    this.hostingAccounts.set(demoId, {
      id: demoId,
      clientId: 'wn84920-demo-artisan',
      ticketId: 'WN-84920',
      customerName: 'Vikram Malhotra',
      businessName: 'The Artisan Spice Co.',
      domain: 'theartisanspice.com',
      storageMb: 1536, // 1.5 GB
      storageFormatted: '1.5 GB',
      bandwidthMb: 15360, // 15 GB
      bandwidthFormatted: '15 GB / mo',
      durationYears: 1,
      durationFormatted: '1 Year',
      hostingStatus: 'Pending', // Pending | Active | Suspended | Expired
      sslStatus: 'Pending', // Pending | Installed | Failed | Expired
      deploymentStatus: 'Pending', // Pending | DNS Configuration | VPS Setup | SSL Installation | Website Deployment | Active
      deploymentStep: 1, // 1: Pending, 2: DNS Config, 3: VPS Setup, 4: SSL, 5: Web Deploy, 6: Active
      vpsConnected: false,
      createdAt: now.toISOString(),
      renewalDate: renewal.toISOString(),
      serverIp: null,
      nameservers: ['ns1.webnavi.net', 'ns2.webnavi.net'],
      deploymentLogs: [
        {
          timestamp: now.toISOString(),
          step: 'Pending',
          status: 'info',
          message: 'Hosting account created with 1.5 GB SSD & 15 GB bandwidth. Provisioning paused: VPS is Not Connected.',
        }
      ],
    });
  }

  getAll() {
    const list = Array.from(this.hostingAccounts.values());
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  }

  getById(id) {
    if (!id) return null;
    return this.hostingAccounts.get(id) || null;
  }

  getByDomain(domain) {
    if (!domain) return null;
    const clean = domain.trim().toLowerCase();
    for (const acc of this.hostingAccounts.values()) {
      if (acc.domain.toLowerCase() === clean) return acc;
    }
    return null;
  }

  getByClientId(clientId) {
    if (!clientId) return null;
    for (const acc of this.hostingAccounts.values()) {
      if (acc.clientId === clientId) return acc;
    }
    return null;
  }

  create({ clientId, ticketId, customerName, businessName, domain }) {
    if (!customerName || !domain) {
      throw new Error('Customer name and domain are required to create a hosting account.');
    }

    const cleanDomain = domain.trim().toLowerCase();
    const existing = this.getByDomain(cleanDomain);
    if (existing) {
      throw new Error(`A hosting account for domain "${cleanDomain}" already exists (ID: ${existing.id}).`);
    }

    const id = 'HOST-' + Math.floor(10000 + Math.random() * 90000);
    const now = new Date();
    const renewal = new Date(now);
    renewal.setFullYear(renewal.getFullYear() + 1);

    const record = {
      id,
      clientId: clientId || null,
      ticketId: ticketId || ('WN-' + Math.floor(10000 + Math.random() * 90000)),
      customerName: customerName.trim(),
      businessName: (businessName || customerName).trim(),
      domain: cleanDomain,
      storageMb: 1536, // 1.5 GB
      storageFormatted: '1.5 GB',
      bandwidthMb: 15360, // 15 GB
      bandwidthFormatted: '15 GB / mo',
      durationYears: 1,
      durationFormatted: '1 Year',
      hostingStatus: 'Pending',
      sslStatus: 'Pending',
      deploymentStatus: 'Pending',
      deploymentStep: 1,
      vpsConnected: false,
      createdAt: now.toISOString(),
      renewalDate: renewal.toISOString(),
      serverIp: null,
      nameservers: ['ns1.webnavi.net', 'ns2.webnavi.net'],
      deploymentLogs: [
        {
          timestamp: now.toISOString(),
          step: 'Pending',
          status: 'info',
          message: 'Account initialized. Status: Pending. Storage: 1.5 GB. Bandwidth: 15 GB. Duration: 1 Year.',
        }
      ],
    };

    this.hostingAccounts.set(id, record);
    return record;
  }

  update(id, updates) {
    const acc = this.getById(id);
    if (!acc) return null;

    Object.assign(acc, updates);
    this.hostingAccounts.set(id, acc);
    return acc;
  }

  addLog(id, step, status, message) {
    const acc = this.getById(id);
    if (!acc) return null;

    acc.deploymentLogs = acc.deploymentLogs || [];
    acc.deploymentLogs.push({
      timestamp: new Date().toISOString(),
      step,
      status, // 'info' | 'warning' | 'error' | 'success'
      message,
    });
    return acc;
  }
}

const hostingStore = new HostingStore();
module.exports = hostingStore;

