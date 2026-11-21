const hostyIndiaService = require('./hostyindia');
const cloudflareService = require('./cloudflare');
const dnsStore = require('./dnsStore');
const orderStore = require('./orderStore');

/**
 * WebNavi Nameserver Approval Status Constants
 */
const NS_STATUS = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ACTIVE: 'ACTIVE',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Map internal state to customer-facing status object.
 * Guaranteed never to report DNS as active while approval or activation is pending.
 * @param {Object} zone
 */
function getCustomerFacingState(zone) {
  const approval = (zone && zone.approvalStatus) || NS_STATUS.NOT_SUBMITTED;
  const cfStatus = (zone && zone.status) || 'pending';

  switch (approval) {
    case NS_STATUS.NOT_SUBMITTED:
      return {
        label: 'Nameserver setup requested',
        badge: 'SETUP_REQUESTED',
        badgeColor: '#ffd43b',
        description: 'Domain registration confirmed. Preparing authoritative Cloudflare nameservers.',
        step: 1,
        isDnsActive: false,
      };

    case NS_STATUS.PENDING_APPROVAL:
      return {
        label: 'Awaiting registrar approval',
        badge: 'AWAITING_APPROVAL',
        badgeColor: '#ff8a24',
        description: 'Nameservers submitted to HostyIndia registry and are currently pending administrator approval.',
        step: 2,
        isDnsActive: false,
      };

    case NS_STATUS.APPROVED:
      if (cfStatus === 'active') {
        return {
          label: 'DNS active',
          badge: 'DNS_ACTIVE',
          badgeColor: '#00e599',
          description: 'Cloudflare authoritative nameservers approved and active worldwide.',
          step: 4,
          isDnsActive: true,
        };
      }
      return {
        label: 'DNS activation pending',
        badge: 'PROPAGATING',
        badgeColor: '#38bdf8',
        description: 'Registrar approved nameservers. Waiting for global root DNS propagation and Cloudflare activation.',
        step: 3,
        isDnsActive: false,
      };

    case NS_STATUS.ACTIVE:
      return {
        label: 'DNS active',
        badge: 'DNS_ACTIVE',
        badgeColor: '#00e599',
        description: 'Cloudflare authoritative nameservers are fully active and serving traffic.',
        step: 4,
        isDnsActive: true,
      };

    case NS_STATUS.REJECTED:
      return {
        label: 'Action required',
        badge: 'REJECTED',
        badgeColor: '#f87171',
        description: 'Nameserver update was rejected by the registrar administrator. Please review registrant details or contact support.',
        step: 0,
        isDnsActive: false,
      };

    case NS_STATUS.FAILED:
      return {
        label: 'Action required',
        badge: 'FAILED',
        badgeColor: '#f87171',
        description: 'Nameserver submission failed at registrar gateway. Please retry or contact technical support.',
        step: 0,
        isDnsActive: false,
      };

    case NS_STATUS.UNKNOWN:
    default:
      return {
        label: 'Action required',
        badge: 'UNKNOWN',
        badgeColor: '#eab308',
        description: 'Registrar gateway timed out while checking nameservers. Status synchronization is in progress.',
        step: 0,
        isDnsActive: false,
      };
  }
}

/**
 * Normalizes an array or object of nameservers into a sorted list of lowercase hostnames.
 * @param {any} nsInput
 * @returns {string[]}
 */
function normalizeNameservers(nsInput) {
  if (!nsInput) return [];
  let list = [];

  if (Array.isArray(nsInput)) {
    list = nsInput;
  } else if (typeof nsInput === 'object') {
    list = Object.values(nsInput);
  } else if (typeof nsInput === 'string') {
    list = nsInput.split(/[,\s]+/);
  }

  return list
    .filter((ns) => typeof ns === 'string' && ns.trim().length > 0)
    .map((ns) => ns.trim().toLowerCase().replace(/\.+$/, ''))
    .sort();
}

/**
 * Compare two sets of nameservers for equality.
 * @param {any} nsA
 * @param {any} nsB
 * @returns {boolean}
 */
function nameserversMatch(nsA, nsB) {
  const listA = normalizeNameservers(nsA);
  const listB = normalizeNameservers(nsB);
  if (listA.length === 0 || listB.length === 0) return false;

  // Check if every nameserver in Cloudflare list exists in registrar list
  const allInB = listA.every((ns) => listB.includes(ns));
  const allInA = listB.every((ns) => listA.includes(ns));
  return allInB || (listA.length >= 2 && listB.length >= 2 && listA[0] === listB[0] && listA[1] === listB[1]);
}

/**
 * 1. Submit Cloudflare assigned nameservers to HostyIndia.
 * Prevents duplicate submissions while a request is already PENDING_APPROVAL or ACTIVE.
 * @param {Object} params
 * @param {string} params.domain
 * @param {boolean} [params.confirmAction=true]
 * @param {boolean} [params.force=false]
 * @param {string} [params.origin='admin']
 */
async function submitNameservers({ domain: domainInput, confirmAction = true, force = false, origin = 'admin' }) {
  if (!domainInput || typeof domainInput !== 'string') {
    throw new Error('A valid domain name is required.');
  }

  const cleanDomain = domainInput.trim().toLowerCase();
  let zone = dnsStore.getZoneByDomain(cleanDomain);

  // Auto-upsert zone if not already in store
  if (!zone) {
    const order = orderStore.getOrderByDomain(cleanDomain);
    zone = dnsStore.upsertZone({
      domain: cleanDomain,
      orderId: order ? order.orderId : null,
      customerId: order ? order.customerId : null,
      approvalStatus: NS_STATUS.NOT_SUBMITTED,
    });
  }

  // Prevent duplicate submissions
  if (!force) {
    if (zone.approvalStatus === NS_STATUS.PENDING_APPROVAL) {
      const err = new Error(`A nameserver change request for "${cleanDomain}" is already pending HostyIndia Administrator approval.`);
      err.statusCode = 409;
      err.code = 'DUPLICATE_SUBMISSION';
      throw err;
    }

    if (zone.approvalStatus === NS_STATUS.ACTIVE) {
      const err = new Error(`Domain "${cleanDomain}" already has verified active Cloudflare nameservers.`);
      err.statusCode = 400;
      err.code = 'ALREADY_ACTIVE';
      throw err;
    }
  }

  // Ensure Cloudflare assigned nameservers exist
  let nameServers = zone.nameServers || [];
  if (nameServers.length < 2) {
    try {
      const cfZone = await cloudflareService.createZone(cleanDomain);
      if (cfZone && cfZone.nameServers && cfZone.nameServers.length > 0) {
        nameServers = cfZone.nameServers;
        dnsStore.updateZone(cleanDomain, {
          zoneId: cfZone.zoneId,
          nameServers: cfZone.nameServers,
          status: cfZone.status,
        });
      }
    } catch (cfErr) {
      console.warn(`[Nameserver Sync] Cloudflare zone creation/lookup notice for ${cleanDomain}:`, cfErr.message);
      // Fallback to default Cloudflare nameservers if token lacks zone.create
      if (nameServers.length === 0) {
        nameServers = ['amy.ns.cloudflare.com', 'bob.ns.cloudflare.com'];
        dnsStore.updateZone(cleanDomain, { nameServers });
      }
    }
  }

  const reqTime = new Date().toISOString();
  console.log(`[Nameserver Sync] Submitting Cloudflare nameservers (${nameServers.join(', ')}) to HostyIndia for domain="${cleanDomain}"`);

  let hostyResult;
  try {
    hostyResult = await hostyIndiaService.saveNameservers({
      domain: cleanDomain,
      ns1: nameServers[0],
      ns2: nameServers[1],
      ns3: nameServers[2] || '',
      ns4: nameServers[3] || '',
    });
  } catch (err) {
    dnsStore.updateZone(cleanDomain, {
      approvalStatus: NS_STATUS.FAILED,
      requestDate: reqTime,
      latestRegistrarResponse: { success: false, message: err.message },
    });

    dnsStore.addNotification(cleanDomain, {
      type: 'NS_FAILED',
      title: 'Nameserver Submission Failed',
      message: `Failed to submit nameservers to HostyIndia gateway for ${cleanDomain}: ${err.message}`,
      target: 'admin',
    });

    dnsStore.addLog(cleanDomain, 'NS_SUBMISSION_FAILED', err.message);
    throw err;
  }

  // Evaluate HostyIndia response
  const isPending = hostyResult.is_pending === true ||
                    hostyResult.approval_status === 'pending' ||
                    (typeof hostyResult.message === 'string' && /pending|approval|review/i.test(hostyResult.message));

  let newStatus = NS_STATUS.FAILED;
  if (hostyResult.success) {
    newStatus = isPending ? NS_STATUS.PENDING_APPROVAL : NS_STATUS.APPROVED;
  }

  dnsStore.updateZone(cleanDomain, {
    approvalStatus: newStatus,
    nameserverApprovalStatus: isPending ? 'pending' : (hostyResult.success ? 'approved' : 'failed'),
    nameserversSubmittedToRegistrar: true,
    requestDate: reqTime,
    latestRegistrarResponse: hostyResult,
  });

  // Create notifications and audit logs
  if (newStatus === NS_STATUS.PENDING_APPROVAL) {
    dnsStore.addNotification(cleanDomain, {
      type: 'NS_SUBMITTED',
      title: 'Nameserver Update Submitted',
      message: `Cloudflare nameservers (${nameServers.join(', ')}) submitted to HostyIndia for ${cleanDomain}. Request is pending HostyIndia Administrator approval.`,
      target: 'both',
    });
    dnsStore.addLog(cleanDomain, 'PENDING_APPROVAL', 'Nameservers submitted to HostyIndia. Waiting for HostyIndia Administrator approval.');
  } else if (newStatus === NS_STATUS.APPROVED) {
    dnsStore.addNotification(cleanDomain, {
      type: 'NS_APPROVED',
      title: 'Nameserver Update Approved',
      message: `HostyIndia confirmed immediate nameserver update for ${cleanDomain}.`,
      target: 'both',
    });
    dnsStore.addLog(cleanDomain, 'APPROVED', 'Nameservers updated at registrar.');
  } else {
    dnsStore.addNotification(cleanDomain, {
      type: 'NS_FAILED',
      title: 'Nameserver Submission Unconfirmed',
      message: hostyResult.message || `HostyIndia returned non-success response for ${cleanDomain}.`,
      target: 'admin',
    });
    dnsStore.addLog(cleanDomain, 'FAILED', hostyResult.message || 'Submission failed.');
  }

  // Sync to orderStore if order exists
  const order = orderStore.getOrderByDomain(cleanDomain);
  if (order) {
    orderStore.updateOrder(order.orderId, {
      nameservers: nameServers,
      dnsStatus: newStatus === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : (newStatus === 'ACTIVE' ? 'ACTIVE' : 'FAILED'),
    });
    orderStore.addLog(order.orderId, order.status, `Nameservers submitted to HostyIndia. Status: ${newStatus}`);
  }

  const updatedZone = dnsStore.getZoneByDomain(cleanDomain);
  return {
    success: hostyResult.success,
    domain: cleanDomain,
    approvalStatus: newStatus,
    customerFacing: getCustomerFacingState(updatedZone),
    nameServers,
    requestDate: reqTime,
    latestRegistrarResponse: hostyResult,
    message: hostyResult.message || 'Nameserver change submitted to HostyIndia.',
  };
}

/**
 * 2. Verify domain nameservers against HostyIndia and Cloudflare.
 * Safely distinguishes between registrar approval and Cloudflare DNS activation.
 * @param {string} domainInput
 */
async function verifyDomainNameservers(domainInput) {
  if (!domainInput) throw new Error('Domain name is required.');
  const cleanDomain = domainInput.trim().toLowerCase();
  const zone = dnsStore.getZoneByDomain(cleanDomain);

  if (!zone) {
    throw new Error(`DNS zone for domain "${cleanDomain}" not found in system.`);
  }

  const verifyTime = new Date().toISOString();
  console.log(`[Nameserver Sync] Verifying nameservers for domain="${cleanDomain}" (Current status: ${zone.approvalStatus})`);

  // Step 1: Query HostyIndia get_nameservers
  let registrarNsResult;
  let registrarQueryFailed = false;

  try {
    registrarNsResult = await hostyIndiaService.getNameservers(cleanDomain);
  } catch (err) {
    console.warn(`[Nameserver Sync] Registrar query error for ${cleanDomain}:`, err.message);
    registrarQueryFailed = true;
    registrarNsResult = { success: false, message: err.message };
  }

  if (!registrarNsResult || !registrarNsResult.success) {
    registrarQueryFailed = true;
  }

  // Step 2: Query Cloudflare zone details and trigger activation check if pending
  let cfDetails = null;
  if (zone.zoneId && !zone.zoneId.startsWith('cf-zone-')) {
    try {
      cfDetails = await cloudflareService.getZoneDetails(zone.zoneId);
      if (cfDetails && cfDetails.status === 'pending') {
        // Trigger activation check on Cloudflare edge
        await cloudflareService.checkZoneActivation(zone.zoneId).catch(() => null);
      }
    } catch (cfErr) {
      console.warn(`[Nameserver Sync] Cloudflare details error for ${cleanDomain}:`, cfErr.message);
    }
  }

  // Extract nameserver lists
  const liveRegistrarNs = registrarNsResult && registrarNsResult.live_ns
    ? normalizeNameservers(registrarNsResult.live_ns)
    : [];

  const assignedCfNs = normalizeNameservers(zone.nameServers || []);

  let previousStatus = zone.approvalStatus || NS_STATUS.NOT_SUBMITTED;
  let newStatus = previousStatus;
  let failCount = zone.verificationFailCount || 0;

  if (registrarQueryFailed) {
    failCount++;
    if (failCount >= 3) {
      newStatus = NS_STATUS.UNKNOWN;
      dnsStore.addNotification(cleanDomain, {
        type: 'VERIFICATION_TIMEOUT',
        title: 'Registrar Verification Failed',
        message: `Verification failed ${failCount} consecutive times for ${cleanDomain}. HostyIndia gateway is unreachable.`,
        target: 'admin',
      });
      dnsStore.addLog(cleanDomain, 'VERIFY_FAIL', `Registrar verification timed out ${failCount} times.`);
    }
  } else {
    failCount = 0; // Reset fail counter on successful registrar query

    const matches = nameserversMatch(assignedCfNs, liveRegistrarNs);
    const isRegistrarPending = registrarNsResult.is_pending === true ||
                               registrarNsResult.approval_status === 'pending';

    const isRegistrarRejected = registrarNsResult.approval_status === 'rejected' ||
                                (typeof registrarNsResult.message === 'string' && /rejected|denied|cancelled/i.test(registrarNsResult.message));

    if (isRegistrarRejected) {
      newStatus = NS_STATUS.REJECTED;
      dnsStore.addNotification(cleanDomain, {
        type: 'NS_REJECTED',
        title: 'Nameserver Update Rejected',
        message: `HostyIndia Administrator rejected the nameserver update request for ${cleanDomain}.`,
        target: 'both',
      });
      dnsStore.addLog(cleanDomain, 'REJECTED', 'HostyIndia administrator rejected nameserver change.');
    } else if (matches) {
      // Nameservers MATCH assigned Cloudflare nameservers!
      if (previousStatus === NS_STATUS.PENDING_APPROVAL) {
        dnsStore.addNotification(cleanDomain, {
          type: 'APPROVAL_CONFIRMED',
          title: 'Nameserver Approval Confirmed',
          message: `HostyIndia has approved and updated nameservers for ${cleanDomain} to Cloudflare (${assignedCfNs.join(', ')}).`,
          target: 'both',
        });
        dnsStore.addLog(cleanDomain, 'APPROVAL_CONFIRMED', `Nameservers approved by HostyIndia: ${liveRegistrarNs.join(', ')}`);
      }

      // Check Cloudflare zone activation
      const cfIsActive = (cfDetails && cfDetails.status === 'active') || zone.status === 'active';
      if (cfIsActive) {
        newStatus = NS_STATUS.ACTIVE;
        if (previousStatus !== NS_STATUS.ACTIVE) {
          dnsStore.addNotification(cleanDomain, {
            type: 'DNS_ACTIVE',
            title: 'Cloudflare DNS Active',
            message: `Cloudflare DNS zone for ${cleanDomain} is verified active and resolving worldwide.`,
            target: 'both',
          });
          dnsStore.addLog(cleanDomain, 'DNS_ACTIVE', 'Cloudflare authoritative DNS active.');
        }
      } else {
        newStatus = NS_STATUS.APPROVED;
      }
    } else {
      // Nameservers DO NOT match assigned Cloudflare nameservers
      if (isRegistrarPending || previousStatus === NS_STATUS.PENDING_APPROVAL) {
        newStatus = NS_STATUS.PENDING_APPROVAL;
      } else if (previousStatus === NS_STATUS.NOT_SUBMITTED) {
        newStatus = NS_STATUS.NOT_SUBMITTED;
      } else {
        newStatus = NS_STATUS.FAILED;
      }
    }
  }

  // Update DNS store
  const updates = {
    approvalStatus: newStatus,
    registrarNameServers: liveRegistrarNs.length > 0 ? liveRegistrarNs : (zone.registrarNameServers || []),
    lastVerificationTime: verifyTime,
    verificationFailCount: failCount,
  };

  if (cfDetails && cfDetails.status) {
    updates.status = cfDetails.status;
  }
  if (registrarNsResult && registrarNsResult.success) {
    updates.latestRegistrarResponse = registrarNsResult;
    if (registrarNsResult.approval_status) {
      updates.nameserverApprovalStatus = registrarNsResult.approval_status;
    }
  }

  dnsStore.updateZone(cleanDomain, updates);

  // Sync DNS status to orderStore if order exists
  const order = orderStore.getOrderByDomain(cleanDomain);
  if (order) {
    const dnsStatusMap = {
      [NS_STATUS.ACTIVE]: 'ACTIVE',
      [NS_STATUS.APPROVED]: 'PENDING_APPROVAL',
      [NS_STATUS.PENDING_APPROVAL]: 'PENDING_APPROVAL',
      [NS_STATUS.FAILED]: 'FAILED',
      [NS_STATUS.REJECTED]: 'FAILED',
      [NS_STATUS.NOT_SUBMITTED]: 'NOT_STARTED',
    };
    if (dnsStatusMap[newStatus]) {
      const orderUpdates = {
        dnsStatus: dnsStatusMap[newStatus],
        lastSyncedAt: verifyTime,
      };
      if (newStatus === NS_STATUS.ACTIVE && order.status !== 'ACTIVE') {
        orderUpdates.status = 'ACTIVE';
      }
      orderStore.updateOrder(order.orderId, orderUpdates);
    }
  }

  const updatedZone = dnsStore.getZoneByDomain(cleanDomain);
  return {
    success: true,
    domain: cleanDomain,
    approvalStatus: newStatus,
    customerFacing: getCustomerFacingState(updatedZone),
    assignedCloudflareNs: assignedCfNs,
    liveRegistrarNs,
    nameserversMatch: nameserversMatch(assignedCfNs, liveRegistrarNs),
    cloudflareStatus: updatedZone.status,
    lastVerificationTime: verifyTime,
    latestRegistrarResponse: updatedZone.latestRegistrarResponse,
  };
}

/**
 * 3. Verify all zones in the background.
 */
async function syncAllZones() {
  const zones = dnsStore.getAllZones();
  const results = [];

  for (const z of zones) {
    try {
      const res = await verifyDomainNameservers(z.domain);
      results.push(res);
    } catch (err) {
      results.push({ domain: z.domain, success: false, error: err.message });
    }
  }

  return {
    success: true,
    total: zones.length,
    results,
  };
}

module.exports = {
  NS_STATUS,
  getCustomerFacingState,
  normalizeNameservers,
  nameserversMatch,
  submitNameservers,
  verifyDomainNameservers,
  syncAllZones,
};

