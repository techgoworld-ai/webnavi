const BASE_URL = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 20000;

/**
 * Validates and retrieves Cloudflare credentials from environment variables.
 * @returns {{ token: string, accountId: string }}
 */
function getCredentials() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!token) {
    const err = new Error('Cloudflare API Token (CLOUDFLARE_API_TOKEN) is not configured.');
    err.statusCode = 401;
    err.code = 'CF_TOKEN_MISSING';
    throw err;
  }

  return { token: token.trim(), accountId: (accountId || '').trim() };
}

/**
 * Returns sanitized auth headers for Cloudflare API.
 * Never logs or returns credentials in errors.
 */
function getHeaders() {
  const { token } = getCredentials();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Safe fetch wrapper for Cloudflare API with timeout and sanitized error parsing.
 * @param {string} endpoint Path starting with /
 * @param {RequestInit} [options]
 */
async function cfFetch(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { ...getHeaders(), ...(options.headers || {}) };

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
      const err = new Error(`Cloudflare gateway request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
      err.statusCode = 504;
      err.code = 'CF_GATEWAY_TIMEOUT';
      throw err;
    }
    throw fetchErr;
  }

  const data = await response.json().catch(() => ({
    success: false,
    errors: [{ code: 0, message: `Cloudflare returned non-JSON response (HTTP ${response.status})` }],
  }));

  if (!response.ok || data.success === false) {
    const firstError = (data.errors && data.errors[0]) || {};
    const errMsg = firstError.message || `Cloudflare API error (HTTP ${response.status})`;
    const err = new Error(errMsg);
    err.statusCode = response.status;
    err.code = firstError.code || `CF_ERROR_${response.status}`;
    err.cfErrors = data.errors || [];
    err.cfMessages = data.messages || [];

    if (firstError.code === 9109 || /location|ip address|client ip/i.test(errMsg)) {
      err.isIpRestricted = true;
      err.code = 9109;
      err.diagnosticHint = 'Cloudflare API token IP restriction (Error 9109): The outbound public IP is not in the token Client IP Filtering whitelist. Whitelist this IP in Cloudflare Dashboard (My Profile -> API Tokens).';
    }

    throw err;
  }

  return data;
}

/**
 * 0. Verify Cloudflare Token directly via /user/tokens/verify
 */
async function verifyToken() {
  const { token } = getCredentials();
  try {
    const response = await fetch(`${BASE_URL}/user/tokens/verify`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data = await response.json();
    if (data.success && data.result) {
      return {
        verified: true,
        id: data.result.id,
        status: data.result.status,
        expiresOn: data.result.expires_on,
        notBefore: data.result.not_before,
      };
    }

    const firstErr = (data.errors && data.errors[0]) || {};
    return {
      verified: false,
      statusCode: response.status,
      code: firstErr.code || 1000,
      message: firstErr.message || 'Token verification failed',
      note: 'Account-scoped tokens may not have permission to query /user/tokens/verify.',
    };
  } catch (err) {
    return {
      verified: false,
      error: err.message,
    };
  }
}

/**
 * 1. Verify Cloudflare Account Access & Token Connectivity
 */
async function getAccountStatus() {
  const { accountId } = getCredentials();
  if (!accountId) {
    return {
      connected: false,
      message: 'CLOUDFLARE_ACCOUNT_ID is not configured.',
    };
  }

  try {
    const data = await cfFetch('/accounts');
    const accounts = data.result || [];
    const matched = accounts.find((acc) => acc.id === accountId);

    if (matched) {
      return {
        connected: true,
        accountId: matched.id,
        accountName: matched.name,
        type: matched.type,
      };
    }

    return {
      connected: true,
      accountId,
      accountName: accounts[0] ? accounts[0].name : 'Default Account',
      note: 'Account accessed via token.',
    };
  } catch (err) {
    const isIpRestricted = err.code === 9109 || /location|ip address|client ip/i.test(err.message);
    return {
      connected: false,
      error: err.message,
      code: err.code,
      isIpRestricted,
      diagnosticHint: isIpRestricted
        ? 'Cloudflare API token IP restriction (Error 9109): The outbound public IP is not in the token Client IP Filtering whitelist.'
        : undefined,
    };
  }
}

/**
 * 2. List all Cloudflare DNS Zones accessible by the account.
 * @param {Object} [params]
 */
async function listZones(params = {}) {
  const { accountId } = getCredentials();
  const query = new URLSearchParams();
  if (accountId) query.append('account.id', accountId);
  if (params.name) query.append('name', params.name.trim().toLowerCase());
  if (params.status) query.append('status', params.status);
  query.append('per_page', String(params.per_page || 50));

  const data = await cfFetch(`/zones?${query.toString()}`);
  const zones = data.result || [];
  return {
    success: true,
    count: zones.length,
    zones: zones.map((z) => ({
      zoneId: z.id,
      name: z.name,
      status: z.status,
      nameServers: z.name_servers || [],
      originalNs: z.original_name_servers || [],
      paused: Boolean(z.paused),
      type: z.type,
      createdAt: z.created_on,
      activatedOn: z.activated_on,
    })),
  };
}

/**
 * 3. Create a new DNS Zone on Cloudflare
 * Handles duplicate zones by looking up the existing zone rather than failing.
 * @param {string} domain Domain name (e.g. example.com)
 */
async function createZone(domain) {
  if (!domain || typeof domain !== 'string') {
    throw new Error('A valid domain name is required.');
  }

  const cleanDomain = domain.trim().toLowerCase();
  const { accountId } = getCredentials();

  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is required to create a new DNS zone.');
  }

  console.log(`[Cloudflare API] Creating DNS zone for domain="${cleanDomain}"`);

  try {
    const data = await cfFetch('/zones', {
      method: 'POST',
      body: JSON.stringify({
        account: { id: accountId },
        name: cleanDomain,
        type: 'full',
      }),
    });

    const zone = data.result;
    return {
      success: true,
      zoneId: zone.id,
      name: zone.name,
      status: zone.status, // 'pending' | 'active' | 'moved'
      nameServers: zone.name_servers || [],
      originalNs: zone.original_name_servers || [],
      paused: Boolean(zone.paused),
      type: zone.type,
      createdAt: zone.created_on,
      raw: zone,
    };
  } catch (err) {
    // Error Code 1061: Zone already exists on Cloudflare
    if (err.code === 1061 || (err.message && err.message.includes('already exists'))) {
      console.log(`[Cloudflare API] Zone for "${cleanDomain}" already exists. Fetching existing zone details.`);
      return await getZoneByName(cleanDomain);
    }
    throw err;
  }
}

/**
 * 3. Retrieve Zone by Domain Name
 * @param {string} domain 
 */
async function getZoneByName(domain) {
  const cleanDomain = domain.trim().toLowerCase();
  const data = await cfFetch(`/zones?name=${encodeURIComponent(cleanDomain)}`);
  const zones = data.result || [];

  if (zones.length === 0) {
    const err = new Error(`Zone for domain "${cleanDomain}" was not found in Cloudflare account.`);
    err.statusCode = 404;
    err.code = 'ZONE_NOT_FOUND';
    throw err;
  }

  const zone = zones[0];
  return {
    success: true,
    zoneId: zone.id,
    name: zone.name,
    status: zone.status,
    nameServers: zone.name_servers || [],
    originalNs: zone.original_name_servers || [],
    paused: Boolean(zone.paused),
    type: zone.type,
    createdAt: zone.created_on,
    raw: zone,
  };
}

/**
 * 4. Retrieve Zone Details & Assigned Nameservers by Zone ID
 * @param {string} zoneId
 */
async function getZoneDetails(zoneId) {
  if (!zoneId) throw new Error('Zone ID is required.');
  const data = await cfFetch(`/zones/${encodeURIComponent(zoneId)}`);
  const zone = data.result;

  return {
    success: true,
    zoneId: zone.id,
    name: zone.name,
    status: zone.status, // 'pending' | 'active' | 'moved'
    nameServers: zone.name_servers || [],
    originalNs: zone.original_name_servers || [],
    paused: Boolean(zone.paused),
    activatedOn: zone.activated_on,
    modifiedOn: zone.modified_on,
    raw: zone,
  };
}

/**
 * 5. Trigger Cloudflare Zone Activation Check
 * Instructs Cloudflare to check whether the domain's live nameservers match its assigned nameservers.
 * @param {string} zoneId
 */
async function checkZoneActivation(zoneId) {
  if (!zoneId) throw new Error('Zone ID is required.');
  const data = await cfFetch(`/zones/${encodeURIComponent(zoneId)}/activation_check`, {
    method: 'PUT',
  });
  return {
    success: true,
    zoneId: data.result ? data.result.id : zoneId,
    message: 'Cloudflare nameserver verification initiated. Cloudflare will query root nameservers shortly.',
  };
}

/**
 * 6. List DNS Records for a Zone
 * @param {string} zoneId
 * @param {Object} [filters] type, name, page, per_page
 */
async function listDnsRecords(zoneId, filters = {}) {
  if (!zoneId) throw new Error('Zone ID is required.');

  const params = new URLSearchParams();
  if (filters.type) params.append('type', filters.type.toUpperCase());
  if (filters.name) params.append('name', filters.name);
  params.append('per_page', String(filters.per_page || 100));

  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await cfFetch(`/zones/${encodeURIComponent(zoneId)}/dns_records${query}`);
  const records = data.result || [];

  return {
    success: true,
    count: records.length,
    records: records.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl, // 1 = Auto, or seconds
      proxied: Boolean(r.proxied),
      proxiable: Boolean(r.proxiable),
      priority: r.priority != null ? r.priority : null,
      comment: r.comment || '',
      createdOn: r.created_on,
      modifiedOn: r.modified_on,
    })),
  };
}

/**
 * 7. Validate and Normalize a DNS Record
 * Validates A, AAAA, CNAME, MX, TXT format.
 */
function validateDnsRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return ['Record payload is required.'];
  }

  const allowedTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'];
  const type = (record.type || '').toString().toUpperCase().trim();
  if (!allowedTypes.includes(type)) {
    errors.push(`Invalid record type "${type}". Allowed: ${allowedTypes.join(', ')}.`);
  }

  const name = record.name != null ? String(record.name).trim() : '';
  if (!name) {
    errors.push('Record name is required (e.g. "@", "www", or full hostname).');
  }

  const content = record.content != null ? String(record.content).trim() : '';
  if (!content) {
    errors.push('Record content is required.');
  } else {
    // Type-specific validations when content is provided
    if (type === 'A') {
      const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipv4Regex.test(content)) {
        errors.push('Content for A record must be a valid IPv4 address (e.g. 192.0.2.1).');
      }
    } else if (type === 'AAAA') {
      const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})$/;
      if (!ipv6Regex.test(content)) {
        errors.push('Content for AAAA record must be a valid IPv6 address.');
      }
    }
  }

  if (type === 'MX') {
    if (record.priority == null || isNaN(Number(record.priority))) {
      errors.push('MX records require a valid numeric priority (e.g. 10).');
    }
  }

  return errors;
}

/**
 * 8. Create a DNS Record (A, AAAA, CNAME, MX, TXT)
 * @param {string} zoneId
 * @param {Object} record { type, name, content, ttl, proxied, priority, comment }
 */
async function createDnsRecord(zoneId, record) {
  if (!zoneId) throw new Error('Zone ID is required.');

  const validationErrors = validateDnsRecord(record);
  if (validationErrors.length > 0) {
    const err = new Error(validationErrors.join(' '));
    err.statusCode = 400;
    err.validationErrors = validationErrors;
    throw err;
  }

  const type = record.type.toUpperCase().trim();
  const payload = {
    type,
    name: record.name.trim(),
    content: record.content.trim(),
    ttl: record.ttl != null ? parseInt(record.ttl, 10) : 1, // 1 = Automatic
    comment: (record.comment || 'WebNavi Managed Record').trim(),
  };

  // Only A, AAAA, CNAME can be proxied
  if (['A', 'AAAA', 'CNAME'].includes(type)) {
    payload.proxied = Boolean(record.proxied);
  } else {
    payload.proxied = false;
  }

  if (type === 'MX') {
    payload.priority = parseInt(record.priority, 10) || 10;
  }

  console.log(`[Cloudflare API] Creating DNS record in zone="${zoneId}": type=${type} name=${payload.name}`);

  const data = await cfFetch(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const r = data.result;
  return {
    success: true,
    record: {
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl,
      proxied: r.proxied,
      priority: r.priority,
      comment: r.comment,
    },
    message: `DNS record ${r.type} (${r.name}) created successfully.`,
  };
}

/**
 * 8b. Fetch a Single DNS Record by ID
 * @param {string} zoneId
 * @param {string} recordId
 */
async function getDnsRecord(zoneId, recordId) {
  if (!zoneId) throw new Error('Zone ID is required.');
  if (!recordId) throw new Error('Record ID is required.');

  const data = await cfFetch(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`);
  const r = data.result;
  if (!r) throw new Error(`Record ${recordId} not found in zone ${zoneId}.`);

  return {
    success: true,
    record: {
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl,
      proxied: Boolean(r.proxied),
      proxiable: Boolean(r.proxiable),
      priority: r.priority != null ? r.priority : null,
      comment: r.comment || '',
      createdOn: r.created_on,
      modifiedOn: r.modified_on,
    },
  };
}

/**
 * 9. Edit an Existing DNS Record
 * @param {string} zoneId
 * @param {string} recordId
 * @param {Object} record { type, name, content, ttl, proxied, priority, comment }
 */
async function updateDnsRecord(zoneId, recordId, record) {
  if (!zoneId || !recordId) throw new Error('Zone ID and Record ID are required.');

  const validationErrors = validateDnsRecord(record);
  if (validationErrors.length > 0) {
    const err = new Error(validationErrors.join(' '));
    err.statusCode = 400;
    err.validationErrors = validationErrors;
    throw err;
  }

  const type = record.type.toUpperCase().trim();
  const payload = {
    type,
    name: record.name.trim(),
    content: record.content.trim(),
    ttl: record.ttl != null ? parseInt(record.ttl, 10) : 1,
    comment: (record.comment || 'WebNavi Managed Record').trim(),
  };

  if (['A', 'AAAA', 'CNAME'].includes(type)) {
    payload.proxied = Boolean(record.proxied);
  } else {
    payload.proxied = false;
  }

  if (type === 'MX') {
    payload.priority = parseInt(record.priority, 10) || 10;
  }

  console.log(`[Cloudflare API] Updating DNS record ${recordId} in zone="${zoneId}"`);

  const data = await cfFetch(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  const r = data.result;
  return {
    success: true,
    record: {
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl,
      proxied: r.proxied,
      priority: r.priority,
      comment: r.comment,
    },
    message: `DNS record ${r.type} (${r.name}) updated successfully.`,
  };
}

/**
 * 10. Delete a DNS Record
 * @param {string} zoneId
 * @param {string} recordId
 */
async function deleteDnsRecord(zoneId, recordId) {
  if (!zoneId || !recordId) throw new Error('Zone ID and Record ID are required.');

  console.log(`[Cloudflare API] Deleting DNS record ${recordId} in zone="${zoneId}"`);

  const data = await cfFetch(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  });

  return {
    success: true,
    id: data.result ? data.result.id : recordId,
    message: 'DNS record deleted successfully from Cloudflare.',
  };
}

/**
 * 11. Detect the outbound public IP as seen by Cloudflare edge.
 * Useful for diagnosing IP whitelist mismatches without third-party exposure.
 * @returns {Promise<string|null>}
 */
async function getOutboundIp() {
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    const match = text.match(/^ip=(.+)$/m);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch (e) {
    try {
      const res2 = await fetch('https://api.ipify.org?format=json', {
        signal: AbortSignal.timeout(5000),
      });
      const data = await res2.json();
      if (data && data.ip) return data.ip.trim();
    } catch (_) {}
  }
  return null;
}

module.exports = {
  verifyToken,
  getAccountStatus,
  listZones,
  createZone,
  getZoneByName,
  getZoneDetails,
  checkZoneActivation,
  listDnsRecords,
  getDnsRecord,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  validateDnsRecord,
  getOutboundIp,
};

