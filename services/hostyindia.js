const BASE_URL = 'https://reseller.hostyindia.com/api/v1/';
const REQUEST_TIMEOUT_MS = Number(process.env.HOSTY_TIMEOUT_MS) || 45000;

/**
 * Validates and retrieves required HostyIndia reseller credentials from environment variables.
 * @returns {Record<string, string>} Headers dictionary with credentials.
 */
function getAuthHeaders() {
  const resellerId = process.env.HOSTY_RESELLER_ID;
  const apiKey = process.env.HOSTY_API_KEY;
  const apiSecret = process.env.HOSTY_API_SECRET;

  if (!resellerId || !apiKey || !apiSecret) {
    const err = new Error('HostyIndia credentials are not properly configured.');
    err.statusCode = 401;
    err.code = 'AUTH_ERROR';
    throw err;
  }

  return {
    'Content-Type': 'application/json',
    'X-Hosty-Reseller-Id': resellerId,
    'X-Hosty-Api-Key': apiKey,
    'X-Hosty-Api-Secret': apiSecret,
  };
}

/**
 * Validates and normalizes domain input string.
 * @param {string} domain 
 * @returns {string} Cleaned, lowercase domain name.
 */
function normalizeAndValidateDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    const err = new Error('A valid domain name string is required.');
    err.statusCode = 400;
    throw err;
  }

  const cleaned = domain.trim().toLowerCase();

  // Basic regex check for valid domain name with extension (e.g., example.com, site.in)
  const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,}$/i;
  if (!domainPattern.test(cleaned)) {
    const err = new Error('Invalid domain format. Example: example.in or example.com');
    err.statusCode = 400;
    throw err;
  }

  return cleaned;
}

/**
 * Operation A: Get reseller balance and domain count.
 * Returns normalized object without exposing personal info (e.g., names, emails, portal URL).
 */
async function getBalance() {
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=balance`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError' || /timeout|aborted/i.test(fetchErr.message)) {
      const timeoutErr = new Error(`Registry gateway request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`);
      timeoutErr.statusCode = 504;
      timeoutErr.code = 'GATEWAY_TIMEOUT';
      throw timeoutErr;
    }
    throw fetchErr;
  }

  const data = await response.json().catch(() => {
    throw new Error(`Upstream returned invalid JSON (HTTP ${response.status})`);
  });

  if (!response.ok || data.status === 'error' || data.success === false) {
    const errorMsg = data.message || `HostyIndia API error with status ${response.status}`;
    const err = new Error(errorMsg);
    if (response.status === 401 || response.status === 403 || /unauthorized|api[ -]?key|secret|credential|forbidden/i.test(errorMsg)) {
      err.statusCode = 401;
      err.code = 'AUTH_ERROR';
    } else {
      err.statusCode = response.status >= 500 ? 502 : response.status;
    }
    err.code = data.error_code || err.code;
    throw err;
  }

  return {
    success: true,
    balance: Number(data.balance ?? 0),
    currency: data.currency || 'INR',
    active_domains: Number(data.active_domains ?? 0),
    formatted_balance: data.formatted_balance || `₹ ${Number(data.balance ?? 0).toFixed(2)}`,
  };
}

/**
 * Operation B: Check domain availability and pricing.
 * Strictly read-only; never registers or purchases domains.
 * @param {string} domainInput 
 */
async function checkDomainAvailability(domainInput) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=check`;

  console.log(`[HostyIndia API Check] Initiating registry lookup for domain="${domain}"`);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError' || /timeout|aborted/i.test(fetchErr.message)) {
      const timeoutErr = new Error(`Registry gateway request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds. The upstream registrar took too long to query the registry.`);
      timeoutErr.statusCode = 504;
      timeoutErr.code = 'GATEWAY_TIMEOUT';
      throw timeoutErr;
    }
    throw fetchErr;
  }

  const data = await response.json().catch(() => {
    throw new Error(`Upstream returned invalid JSON (HTTP ${response.status})`);
  });

  // Log raw upstream response safely without sensitive credentials
  console.log(`[HostyIndia API Check] Response received for domain="${domain}" [HTTP ${response.status}]:`, {
    domain: data.domain || domain,
    is_available: data.is_available,
    status: data.status,
    price: data.price,
    renew_price: data.renew_price,
    currency: data.currency,
    message: data.message,
    success: data.success,
  });

  if (!response.ok || data.success === false) {
    const errorMsg = data.message || `Domain check failed with status ${response.status}`;
    const err = new Error(errorMsg);
    if (response.status === 401 || response.status === 403 || /unauthorized|api[ -]?key|secret|credential|forbidden/i.test(errorMsg)) {
      err.statusCode = 401;
      err.code = 'AUTH_ERROR';
    } else {
      err.statusCode = response.status >= 500 ? 502 : response.status;
    }
    throw err;
  }

  // Exact tri-state mapping for availability:
  // true  -> available
  // false -> unavailable / registered
  // null / undefined / unexpected -> unknown (never default to registered)
  let isAvailable = null;
  let availabilityStatus = 'unknown';

  if (data.is_available === true) {
    isAvailable = true;
    availabilityStatus = 'available';
  } else if (data.is_available === false) {
    isAvailable = false;
    availabilityStatus = 'unavailable';
  } else if (typeof data.status === 'string') {
    const lowerStatus = data.status.toLowerCase().trim();
    if (lowerStatus === 'available') {
      isAvailable = true;
      availabilityStatus = 'available';
    } else if (lowerStatus === 'unavailable' || lowerStatus === 'registered') {
      isAvailable = false;
      availabilityStatus = 'unavailable';
    }
  }

  const priceVal = data.price != null && !isNaN(data.price) ? Number(data.price) : null;
  const renewPriceVal = data.renew_price != null && !isNaN(data.renew_price) ? Number(data.renew_price) : null;

  return {
    success: true,
    domain: data.domain || domain,
    tld: data.tld || ('.' + domain.split('.').pop()),
    is_available: isAvailable,
    availability_status: availabilityStatus,
    price: priceVal,
    renew_price: renewPriceVal,
    formatted_price: data.formatted_price || (priceVal != null ? `₹ ${priceVal.toFixed(2)}` : null),
    formatted_renew: data.formatted_renew || (renewPriceVal != null ? `₹ ${renewPriceVal.toFixed(2)}` : null),
    currency: data.currency || 'INR',
    message: data.message || (isAvailable === true ? `Domain ${domain} is available!` : (isAvailable === false ? `Domain ${domain} is already registered.` : `Status unknown for domain ${domain}.`)),
  };
}

/**
 * Operation C: Register domain with HostyIndia.
 * Submits domain registration request to HostyIndia API.
 * @param {Object} params
 * @param {string} params.domain
 * @param {number} [params.years=1]
 * @param {string[]} [params.nameservers]
 * @param {Object} [params.registrant]
 */
async function registerDomain({ domain: domainInput, years = 1, nameservers = [], registrant = {} }) {
  const domain = normalizeAndValidateDomain(domainInput);
  const regYears = Math.max(1, Math.min(10, parseInt(years, 10) || 1));
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=register`;

  const payload = {
    domain,
    years: regYears,
  };

  // Nameservers mapping: Omit ns1, ns2, ns3, ns4, ns5 entirely when no custom nameservers are provided.
  // HostyIndia automatically assigns its default registrar nameservers during initial domain registration.
  if (Array.isArray(nameservers) && nameservers.length > 0) {
    const cleanNs = nameservers
      .filter((ns) => typeof ns === 'string' && ns.trim().length > 0)
      .map((ns) => ns.trim());

    // Strict validation: Reject banned placeholder / prohibited nameservers
    for (const ns of cleanNs) {
      if (/webnavi\.net/i.test(ns)) {
        throw new Error(`Placeholder nameserver "${ns}" is strictly prohibited.`);
      }
      if (/hostyindia\.in/i.test(ns)) {
        throw new Error(`Nameserver "${ns}" must not be supplied manually. HostyIndia assigns default registrar nameservers automatically.`);
      }
    }

    if (cleanNs.length > 0) {
      if (cleanNs[0]) payload.ns1 = cleanNs[0];
      if (cleanNs[1]) payload.ns2 = cleanNs[1];
      if (cleanNs[2]) payload.ns3 = cleanNs[2];
      if (cleanNs[3]) payload.ns4 = cleanNs[3];
      if (cleanNs[4]) payload.ns5 = cleanNs[4];
    }
  }

  // Include registrant fields if present
  if (registrant && typeof registrant === 'object') {
    if (registrant.firstName) payload.firstname = registrant.firstName.trim();
    if (registrant.lastName) payload.lastname = registrant.lastName.trim();
    if (registrant.email) payload.email = registrant.email.trim();
    if (registrant.phone) payload.phone = registrant.phone.trim();
    if (registrant.address1) payload.address1 = registrant.address1.trim();
    if (registrant.city) payload.city = registrant.city.trim();
    if (registrant.state) payload.state = registrant.state.trim();
    if (registrant.postalCode) payload.postcode = registrant.postalCode.trim();
    if (registrant.country) payload.country = registrant.country.trim();
    if (registrant.orgName) payload.companyname = registrant.orgName.trim();
  }

  console.log(`[HostyIndia API Register] Submitting registration for domain="${domain}" years=${regYears}`);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
      const timeoutErr = new Error(`Registry gateway registration request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Status unknown. Do NOT retry blindly.`);
      timeoutErr.statusCode = 504;
      timeoutErr.code = 'GATEWAY_TIMEOUT';
      throw timeoutErr;
    }
    throw fetchErr;
  }

  const data = await response.json().catch(() => {
    throw new Error(`Upstream registrar returned non-JSON response (HTTP ${response.status})`);
  });

  console.log(`[HostyIndia API Register] Raw response for domain="${domain}" [HTTP ${response.status}]:`, {
    status: response.status,
    success: data.success,
    statusText: data.status,
    message: data.message,
    errorCode: data.error_code,
    orderId: data.order_id || data.domain_id,
  });

  if (!response.ok || data.success === false) {
    const errorMsg = data.message || `Registration failed with HTTP ${response.status}`;
    const err = new Error(errorMsg);
    err.statusCode = response.status;
    err.code = data.error_code || (response.status === 402 ? 'INSUFFICIENT_FUNDS' : (response.status === 401 ? 'AUTH_ERROR' : 'REGISTRATION_FAILED'));
    err.details = {
      required: data.required,
      available: data.available,
      deficit: data.deficit,
      upstreamStatus: data.status,
    };
    throw err;
  }

  return {
    success: true,
    domain: data.domain || domain,
    domain_id: data.domain_id || data.id || null,
    order_id: data.order_id || null,
    registration_status: data.status || 'Active',
    message: data.message || `Domain ${domain} registered successfully!`,
    raw: data,
  };
}

/**
 * Operation D: Get domain info and feature flags.
 * @param {string} domainInput
 */
async function getDomainInfo(domainInput) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=domain_info`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Error retrieving domain info: ${err.message}`);
  }

  const data = await response.json().catch(() => ({ success: false, message: 'Invalid response' }));
  return data;
}

/**
 * Operation E: Retrieve live nameservers for a domain.
 * @param {string} domainInput
 */
async function getNameservers(domainInput) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=get_nameservers`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      success: false,
      message: 'Not available through registrar API.',
      domain,
      live_ns: null,
    };
  }

  const data = await response.json().catch(() => ({ success: false, message: 'Invalid response' }));
  if (!response.ok || data.success === false) {
    return {
      success: false,
      message: data.message || 'Not available through registrar API.',
      domain,
      live_ns: null,
    };
  }

  return {
    success: true,
    domain: data.domain || domain,
    live_ns: data.live_ns || { ns1: data.ns1, ns2: data.ns2, ns3: data.ns3, ns4: data.ns4, ns5: data.ns5 },
    is_pending: Boolean(data.is_pending),
    approval_status: data.approval_status || 'none',
  };
}

/**
 * Operation F: Save / update nameservers for a domain.
 * @param {Object} params
 */
async function saveNameservers({ domain: domainInput, ns1, ns2, ns3 = '', ns4 = '', ns5 = '' }) {
  const domain = normalizeAndValidateDomain(domainInput);
  if (!ns1 || !ns2) {
    throw new Error('At least primary (ns1) and secondary (ns2) nameservers are required.');
  }

  // Reject placeholder nameservers
  for (const ns of [ns1, ns2, ns3, ns4, ns5].filter(Boolean)) {
    if (/webnavi\.net/i.test(ns)) {
      throw new Error(`Placeholder nameserver "${ns}" is strictly prohibited.`);
    }
  }

  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=save_nameservers`;

  const payload = {
    domain,
    ns1: ns1.trim(),
    ns2: ns2.trim(),
    ns3: (ns3 || '').trim(),
    ns4: (ns4 || '').trim(),
    ns5: (ns5 || '').trim(),
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Error updating nameservers: ${err.message}`);
  }

  const data = await response.json().catch(() => ({ success: false, message: 'Invalid response' }));
  return data;
}

/**
 * Operation G: Sync domain status and dates from HostyIndia.
 * @param {string} domainInput
 */
async function syncDomain(domainInput) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=sync`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Error synchronizing domain: ${err.message}`);
  }

  const data = await response.json().catch(() => ({ success: false, message: 'Invalid response' }));
  return data;
}

/**
 * Operation H: Get WHOIS contact details.
 * @param {string} domainInput
 */
async function getWhois(domainInput) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=get_whois`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await response.json();
  } catch (err) {
    return { success: false, message: 'Not available through registrar API.' };
  }
}

/**
 * Operation I: Save WHOIS contact details.
 * @param {string} domainInput
 * @param {Object} contactdetails
 */
async function saveWhois(domainInput, contactdetails) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=save_whois`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain, contactdetails }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await response.json();
  } catch (err) {
    return { success: false, message: 'Not available through registrar API.' };
  }
}

/**
 * Operation J: Get registrar transfer lock status.
 * @param {string} domainInput
 */
async function getLock(domainInput) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=get_lock`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await response.json();
  } catch (err) {
    return { success: false, message: 'Not available through registrar API.' };
  }
}

/**
 * Operation K: Save registrar transfer lock status.
 * @param {string} domainInput
 * @param {string} lockstatus 'locked' | 'unlocked'
 */
async function saveLock(domainInput, lockstatus) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=save_lock`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain, lockstatus }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await response.json();
  } catch (err) {
    return { success: false, message: 'Not available through registrar API.' };
  }
}

/**
 * Operation L: Get EPP Auth Code.
 * @param {string} domainInput
 */
async function getEpp(domainInput) {
  const domain = normalizeAndValidateDomain(domainInput);
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=get_epp`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await response.json();
  } catch (err) {
    return { success: false, message: 'Not available through registrar API.' };
  }
}

/**
 * Operation M: Retrieve complete TLD wholesale pricing list (all 649+ TLDs).
 * Strictly read-only; retrieves upstream supplier costs in native currency (INR).
 * @returns {Promise<{ success: boolean, currency: string, count: number, pricing: Record<string, any> }>}
 */
async function getTldPricing() {
  const headers = getAuthHeaders();
  const url = `${BASE_URL}?action=pricing`;

  console.log('[HostyIndia API Pricing] Fetching wholesale TLD pricing catalog...');

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError' || /timeout|aborted/i.test(fetchErr.message)) {
      const timeoutErr = new Error(`Registry gateway request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`);
      timeoutErr.statusCode = 504;
      timeoutErr.code = 'GATEWAY_TIMEOUT';
      throw timeoutErr;
    }
    throw fetchErr;
  }

  const data = await response.json().catch(() => {
    throw new Error(`Upstream returned invalid JSON (HTTP ${response.status})`);
  });

  if (!response.ok || data.status === 'error' || data.success === false) {
    const errorMsg = data.message || `HostyIndia API error with status ${response.status}`;
    const err = new Error(errorMsg);
    err.statusCode = response.status >= 500 ? 502 : response.status;
    err.code = data.error_code || 'PRICING_FETCH_FAILED';
    throw err;
  }

  return {
    success: true,
    currency: data.currency || 'INR',
    count: data.count || Object.keys(data.pricing || {}).length,
    pricing: data.pricing || {},
  };
}

module.exports = {
  getBalance,
  checkDomainAvailability,
  registerDomain,
  getDomainInfo,
  getNameservers,
  saveNameservers,
  syncDomain,
  getWhois,
  saveWhois,
  getLock,
  saveLock,
  getEpp,
  getTldPricing,
  normalizeAndValidateDomain,
  REQUEST_TIMEOUT_MS,
};

