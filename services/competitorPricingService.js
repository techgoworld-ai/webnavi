const { getDb } = require('./db');

/**
 * Normalizes TLD string (e.g., 'com' -> '.com', '.IN' -> '.in')
 */
function normalizeTld(rawTld) {
  if (!rawTld || typeof rawTld !== 'string') return '';
  const trimmed = rawTld.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

/**
 * Accurately extracts the TLD from a domain name or raw TLD string,
 * correctly supporting multi-part TLDs (e.g. .co.in, .net.in, .org.in, .5g.in).
 */
function extractTld(domainOrTld, db = null) {
  if (!domainOrTld || typeof domainOrTld !== 'string') return '.com';
  let clean = domainOrTld.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split('?')[0];

  // If already starts with a dot, return normalized
  if (clean.startsWith('.')) {
    return clean;
  }

  // Check against db if available
  if (db) {
    try {
      const match = db.prepare(`
        SELECT tld FROM domain_tld_pricing 
        WHERE ? LIKE '%' || tld 
        ORDER BY LENGTH(tld) DESC 
        LIMIT 1
      `).get(clean);
      if (match && match.tld) {
        return match.tld;
      }
    } catch (e) {
      // Fall through to heuristic parsing
    }
  }

  const parts = clean.split('.');
  if (parts.length < 2) return '.com';

  if (parts.length >= 3) {
    const twoPart = '.' + parts.slice(-2).join('.');
    const commonMulti = ['.co.in', '.net.in', '.org.in', '.gen.in', '.ind.in', '.firm.in', '.5g.in', '.6g.in', '.com.au', '.net.au', '.org.uk', '.co.uk', '.biz.in'];
    if (commonMulti.includes(twoPart)) {
      return twoPart;
    }
  }

  return '.' + parts[parts.length - 1];
}


/**
 * Resolves verified WHOIS Privacy status per TLD and provider.
 * Distinguishes Included, Paid, Unavailable, and Not verified.
 */
function getWhoisPrivacyForTld(provider, tld, rawPrivacy, addonsJson) {
  const normTld = (tld || '').toLowerCase();
  const restrictedCcTlds = ['.in', '.co.in', '.net.in', '.org.in', '.gen.in', '.ind.in', '.firm.in', '.us', '.ca', '.de', '.fr'];

  if (restrictedCcTlds.includes(normTld)) {
    return {
      text: 'Unavailable (Registry Policy)',
      status: 'unavailable',
      note: 'Registry policy prohibits proxy'
    };
  }

  if (provider === 'WebNavi') {
    let hasPrivacy = false;
    if (addonsJson) {
      try {
        const parsed = typeof addonsJson === 'string' ? JSON.parse(addonsJson) : addonsJson;
        hasPrivacy = !!parsed.id_protection;
      } catch (e) {}
    }
    if (hasPrivacy) {
      return {
        text: 'Included Free',
        status: 'included',
        note: 'Native inclusion'
      };
    }
    return {
      text: 'Not verified',
      status: 'not_verified',
      note: 'Subject to TLD verification'
    };
  }

  if (rawPrivacy) {
    const lower = rawPrivacy.toLowerCase();
    if (lower.includes('free') || lower.includes('included') || lower.includes('forever')) {
      return {
        text: rawPrivacy,
        status: 'included',
        note: 'Included with registration'
      };
    }
    if (lower.includes('paid')) {
      return {
        text: rawPrivacy,
        status: 'paid',
        note: 'Paid add-on'
      };
    }
    if (lower.includes('unavail') || lower.includes('not')) {
      return {
        text: 'Unavailable (Registry Policy)',
        status: 'unavailable',
        note: 'Not supported for this TLD'
      };
    }
  }

  return {
    text: 'Not verified',
    status: 'not_verified',
    note: 'Verify with provider'
  };
}

class CompetitorPricingService {
  constructor(customDb = null) {
    this.db = customDb || getDb();
    this.seedDefaultCompetitors();
  }

  /**
   * Seeds verified benchmark pricing records for major TLDs (.com, .in, .store, .io, .co.in)
   * if not already present in the database.
   */
  seedDefaultCompetitors() {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM competitor_tld_pricing').get();
    if (countRow && countRow.cnt > 0) {
      return;
    }

    console.log('[CompetitorPricing] Seeding verified initial competitor benchmark records...');

    const initialBenchmarks = [
      // .com
      {
        tld: '.com',
        competitor_name: 'GoDaddy',
        reg_price: 1079,
        renew_price: 1599,
        term_years: 1,
        currency: 'INR',
        conditions: 'Registration options: 1-Yr ₹1,079 | 2-Yr ₹2,148 | 3-Yr Upfront ₹3,199. Standard renewal ₹1,599/yr after selected term.',
        whois_privacy: 'Included',
        mandatory_fees: 0,
        source_url: 'https://www.godaddy.com/en-in/domains',
        is_verified: 0,
        verified_at: 'Pending verification',
        notes: 'User-provided pricing pending independent source verification.',
        term_options_json: JSON.stringify({
          term_1yr: 1079,
          term_2yr: 2148,
          term_3yr_upfront: 3199,
          renewal_per_year: 1599
        })
      },
      {
        tld: '.com',
        competitor_name: 'Hostinger',
        reg_price: 999,
        renew_price: 1499,
        term_years: 1,
        currency: 'INR',
        conditions: 'Registration options: 1-Yr ₹999 | 2-Yr ₹1,998 | 3-Yr Upfront ₹2,999. Standard renewal ₹1,499/yr after selected term.',
        whois_privacy: 'Free WHOIS Privacy',
        mandatory_fees: 0,
        source_url: 'https://www.hostinger.in/domain-checker',
        is_verified: 0,
        verified_at: 'Pending verification',
        notes: 'User-provided pricing pending independent source verification.',
        term_options_json: JSON.stringify({
          term_1yr: 999,
          term_2yr: 1998,
          term_3yr_upfront: 2999,
          renewal_per_year: 1499
        })
      },
      {
        tld: '.com',
        competitor_name: 'Namecheap',
        reg_price: 999,
        renew_price: 1449,
        term_years: 1,
        currency: 'INR',
        conditions: 'Standard 1-year registration. Renews annually at standard rate.',
        whois_privacy: 'Free Forever',
        mandatory_fees: 0,
        source_url: 'https://www.namecheap.com/domains/registration/results/?domain=.com',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Converted from official USD rate ($10.28 reg / $14.98 renew).'
      },

      // .in
      {
        tld: '.in',
        competitor_name: 'GoDaddy',
        reg_price: 599,
        renew_price: 899,
        term_years: 1,
        currency: 'INR',
        conditions: 'Registration options: 1-Yr ₹599 | 2-Yr ₹1,198 | 3-Yr Upfront ₹1,799. Standard renewal ₹899/yr after selected term.',
        whois_privacy: 'Included',
        mandatory_fees: 0,
        source_url: 'https://www.godaddy.com/en-in/domains/in-domain',
        is_verified: 0,
        verified_at: 'Pending verification',
        notes: 'User-provided pricing pending independent source verification.',
        term_options_json: JSON.stringify({
          term_1yr: 599,
          term_2yr: 1198,
          term_3yr_upfront: 1799,
          renewal_per_year: 899
        })
      },
      {
        tld: '.in',
        competitor_name: 'Hostinger',
        reg_price: 499,
        renew_price: 799,
        term_years: 1,
        currency: 'INR',
        conditions: '1st year promo rate. Standard renewal rate applies year 2+.',
        whois_privacy: 'Free WHOIS Privacy',
        mandatory_fees: 0,
        source_url: 'https://www.hostinger.in/domain-checker',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Hostinger India verified .in rate.'
      },
      {
        tld: '.in',
        competitor_name: 'Namecheap',
        reg_price: 749,
        renew_price: 899,
        term_years: 1,
        currency: 'INR',
        conditions: 'Standard 1-year registration.',
        whois_privacy: 'Free Forever',
        mandatory_fees: 0,
        source_url: 'https://www.namecheap.com/domains/registration/results/?domain=.in',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Converted from Namecheap published .in USD rate.'
      },

      // .store
      {
        tld: '.store',
        competitor_name: 'GoDaddy',
        reg_price: 199,
        renew_price: 5499,
        term_years: 1,
        currency: 'INR',
        conditions: '1st year teaser promotional rate. Renews at standard non-promo ₹5,499/yr.',
        whois_privacy: 'Included',
        mandatory_fees: 0,
        source_url: 'https://www.godaddy.com/en-in/domains/store-domain',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'GoDaddy .store promo pricing.'
      },
      {
        tld: '.store',
        competitor_name: 'Hostinger',
        reg_price: 299,
        renew_price: 4999,
        term_years: 1,
        currency: 'INR',
        conditions: '1st year promo rate. Renews at standard rate year 2+.',
        whois_privacy: 'Free WHOIS Privacy',
        mandatory_fees: 0,
        source_url: 'https://www.hostinger.in/domain-checker',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Hostinger .store promo pricing.'
      },
      {
        tld: '.store',
        competitor_name: 'Namecheap',
        reg_price: 249,
        renew_price: 5899,
        term_years: 1,
        currency: 'INR',
        conditions: '1st year promo with standard renewal year 2+.',
        whois_privacy: 'Free Forever',
        mandatory_fees: 0,
        source_url: 'https://www.namecheap.com/domains/registration/results/?domain=.store',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Converted from Namecheap published .store rates.'
      },

      // .io
      {
        tld: '.io',
        competitor_name: 'GoDaddy',
        reg_price: 5999,
        renew_price: 6999,
        term_years: 1,
        currency: 'INR',
        conditions: '1-year registration. Standard renewal.',
        whois_privacy: 'Included',
        mandatory_fees: 0,
        source_url: 'https://www.godaddy.com/en-in/domains/io-domain',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'GoDaddy published .io rates.'
      },
      {
        tld: '.io',
        competitor_name: 'Hostinger',
        reg_price: 4499,
        renew_price: 5999,
        term_years: 1,
        currency: 'INR',
        conditions: 'Standard 1-year registration and renewal.',
        whois_privacy: 'Free WHOIS Privacy',
        mandatory_fees: 0,
        source_url: 'https://www.hostinger.in/domain-checker',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Hostinger published .io rates.'
      },
      {
        tld: '.io',
        competitor_name: 'Namecheap',
        reg_price: 4899,
        renew_price: 5899,
        term_years: 1,
        currency: 'INR',
        conditions: 'Standard annual registration and renewal rate.',
        whois_privacy: 'Free Forever',
        mandatory_fees: 0,
        source_url: 'https://www.namecheap.com/domains/registration/results/?domain=.io',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Converted from Namecheap published .io rates.'
      },

      // .co.in
      {
        tld: '.co.in',
        competitor_name: 'GoDaddy',
        reg_price: 399,
        renew_price: 899,
        term_years: 1,
        currency: 'INR',
        conditions: '1st year promo rate with standard renewal.',
        whois_privacy: 'Included',
        mandatory_fees: 0,
        source_url: 'https://www.godaddy.com/en-in/domains/co-in-domain',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'GoDaddy official .co.in pricing.'
      },
      {
        tld: '.co.in',
        competitor_name: 'Hostinger',
        reg_price: 499,
        renew_price: 799,
        term_years: 1,
        currency: 'INR',
        conditions: '1st year promo rate with standard renewal.',
        whois_privacy: 'Free WHOIS Privacy',
        mandatory_fees: 0,
        source_url: 'https://www.hostinger.in/domain-checker',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Hostinger official .co.in pricing.'
      },
      {
        tld: '.co.in',
        competitor_name: 'Namecheap',
        reg_price: 699,
        renew_price: 849,
        term_years: 1,
        currency: 'INR',
        conditions: 'Standard 1-year registration.',
        whois_privacy: 'Free Forever',
        mandatory_fees: 0,
        source_url: 'https://www.namecheap.com/domains/registration/results/?domain=.co.in',
        is_verified: 1,
        verified_at: '2026-11-10',
        notes: 'Converted from Namecheap published .co.in rate.'
      }
    ];

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO competitor_tld_pricing (
        tld, competitor_name, reg_price, renew_price, term_years, currency,
        conditions, whois_privacy, mandatory_fees, source_url, is_verified,
        verified_at, is_active, notes, term_options_json
      ) VALUES (
        @tld, @competitor_name, @reg_price, @renew_price, @term_years, @currency,
        @conditions, @whois_privacy, @mandatory_fees, @source_url, @is_verified,
        @verified_at, 1, @notes, @term_options_json
      )
    `);

    const tx = this.db.transaction((items) => {
      for (const item of items) {
        if (!item.term_options_json) item.term_options_json = null;
        insertStmt.run(item);
      }
    });

    tx(initialBenchmarks);
    console.log(`[CompetitorPricing] Seeded ${initialBenchmarks.length} benchmark records successfully.`);
  }

  /**
   * Retrieves complete dynamic competitor comparison for a specific domain or TLD.
   * Performs all 1-year, renewal, and 3-year cumulative math transparently.
   * 
   * @param {string} domainOrTld 
   * @param {string} currency 'INR' or 'USD'
   * @returns {Object}
   */
  getComparisonForTld(domainOrTld, currency = 'INR') {
    const isUSD = String(currency).toUpperCase() === 'USD';
    const rate = 98; // 1 USD = 98 INR platform conversion rate

    const tld = extractTld(domainOrTld, this.db);
    const domain = (domainOrTld && domainOrTld.includes('.')) ? domainOrTld.trim().toLowerCase() : `example${tld}`;

    // 1. Fetch WebNavi pricing from domain_tld_pricing
    const webnaviRecord = this.db.prepare(`
      SELECT tld, wholesale_register, wholesale_renew, retail_register, retail_renew, currency, addons_json
      FROM domain_tld_pricing
      WHERE tld = ?
    `).get(tld);

    let webnaviWholesaleReg = 849;
    let webnaviWholesaleRenew = 1099;
    let webnaviReg = 899;
    let webnaviRenew = 1349;

    if (webnaviRecord) {
      webnaviWholesaleReg = Number(webnaviRecord.wholesale_register || 0);
      webnaviWholesaleRenew = Number(webnaviRecord.wholesale_renew || 0);
      webnaviReg = webnaviRecord.retail_register != null ? Number(webnaviRecord.retail_register) : webnaviWholesaleReg;
      webnaviRenew = webnaviRecord.retail_renew != null ? Number(webnaviRecord.retail_renew) : webnaviWholesaleRenew;
    } else {
      // Fallback heuristics for unknown TLDs
      if (tld === '.in') {
        webnaviWholesaleReg = 599;
        webnaviWholesaleRenew = 799;
        webnaviReg = 649;
        webnaviRenew = 849;
      }
    }

    const webnaviServiceFee = Math.max(0, webnaviReg - webnaviWholesaleReg);
    const webnaviRenewServiceFee = Math.max(0, webnaviRenew - webnaviWholesaleRenew);
    const webnavi3Yr = webnaviReg + (webnaviRenew * 2);

    // 2. Fetch competitors for this TLD
    const competitorRows = this.db.prepare(`
      SELECT * FROM competitor_tld_pricing
      WHERE tld = ? AND is_active = 1
      ORDER BY competitor_name ASC
    `).all(tld);

    // Standard expected competitor list
    const standardCompetitors = ['GoDaddy', 'Hostinger', 'Namecheap'];
    const competitorMap = new Map();
    for (const row of competitorRows) {
      competitorMap.set(row.competitor_name, row);
    }

    const processedCompetitors = [];
    let verifiedCount = 0;
    let totalVerified3Yr = 0;
    let maxSavings = 0;
    let maxSavingsCompetitor = null;

    for (const compName of standardCompetitors) {
      const row = competitorMap.get(compName);
      const isUserProvided = row && (row.is_verified === 0 || (row.notes && row.notes.includes('User-provided')));
      const hasPrices = row && row.reg_price != null && row.renew_price != null;
      const isAvailable = row && hasPrices && (row.is_verified === 1 || isUserProvided);

      if (!isAvailable) {
        // Unverified or unavailable for this TLD
        processedCompetitors.push({
          name: compName,
          tld,
          is_available: false,
          is_user_provided: false,
          has_term_options: false,
          term_options: null,
          status_text: 'Price unavailable — verify with provider.',
          reg_price_display: 'Price unavailable',
          renew_price_display: 'Verify with provider',
          three_year_total_display: '—',
          three_year_total: null,
          whois_privacy: row?.whois_privacy || 'Verify with provider',
          conditions: row?.conditions || 'Pricing not published or unverified for this TLD.',
          source_url: row?.source_url || (compName === 'GoDaddy' ? 'https://www.godaddy.com' : compName === 'Hostinger' ? 'https://www.hostinger.com' : 'https://www.namecheap.com'),
          verified_at: null,
          verification_status: 'Unverified',
          webnavi_savings: null,
          savings_pct: null,
          notes: row?.notes || null
        });
      } else {
        verifiedCount++;
        const cReg = Number(row.reg_price);
        const cRenew = Number(row.renew_price);
        const cMandatory = Number(row.mandatory_fees || 0);

        let termOptionsObj = null;
        let c3Yr = cReg + (cRenew * 2) + cMandatory;

        // Multi-term registration options (GoDaddy, Hostinger, etc.)
        let termConfig = null;
        if (row && row.term_options_json) {
          try {
            termConfig = typeof row.term_options_json === 'string' ? JSON.parse(row.term_options_json) : row.term_options_json;
          } catch (e) {}
        }
        if (!termConfig) {
          if (compName === 'GoDaddy' && (tld === '.com' || tld === '.in')) {
            termConfig = {
              term_1yr: tld === '.com' ? 1079 : 599,
              term_2yr: tld === '.com' ? 2148 : 1198,
              term_3yr_upfront: tld === '.com' ? 3199 : 1799,
              renewal_per_year: tld === '.com' ? 1599 : 899
            };
          } else if (compName === 'Hostinger' && tld === '.com') {
            termConfig = {
              term_1yr: 999,
              term_2yr: 1998,
              term_3yr_upfront: 2999,
              renewal_per_year: 1499
            };
          }
        }

        if (termConfig && termConfig.term_1yr) {
          const t1 = Number(termConfig.term_1yr);
          const t2 = Number(termConfig.term_2yr);
          const t3 = Number(termConfig.term_3yr_upfront);
          const rYear = Number(termConfig.renewal_per_year);

          // Three distinct calculation models:
          // 1. 3-Year Upfront Registration
          const upfront3YrTotal = t3;
          // 2. 1-Year Registration + 2 Annual Renewals
          const term1YrRenewTotal = t1 + (rYear * 2);
          // 3. 2-Year Registration + 1 Annual Renewal
          const term2YrRenewTotal = t2 + rYear;

          // Savings vs WebNavi 3-Year Total
          const savingsVs1YrRenew = term1YrRenewTotal - webnavi3Yr;
          const savingsVs2YrRenew = term2YrRenewTotal - webnavi3Yr;
          const savingsVsUpfront3Yr = upfront3YrTotal - webnavi3Yr;

          termOptionsObj = {
            term_1yr: t1,
            term_1yr_display: isUSD ? `$${(t1 / rate).toFixed(2)}` : `₹${t1.toLocaleString('en-IN')}`,
            term_2yr: t2,
            term_2yr_display: isUSD ? `$${(t2 / rate).toFixed(2)}` : `₹${t2.toLocaleString('en-IN')}`,
            term_3yr_upfront: t3,
            term_3yr_upfront_display: isUSD ? `$${(t3 / rate).toFixed(2)}` : `₹${t3.toLocaleString('en-IN')}`,
            renewal_per_year: rYear,
            renewal_per_year_display: isUSD ? `$${(rYear / rate).toFixed(2)} / yr` : `₹${rYear.toLocaleString('en-IN')} / yr`,

            // Calculation 1: 3-Year Upfront Registration
            upfront_3yr_total: upfront3YrTotal,
            upfront_3yr_display: isUSD ? `$${(upfront3YrTotal / rate).toFixed(2)}` : `₹${upfront3YrTotal.toLocaleString('en-IN')}`,
            upfront_3yr_label: '3-Year Upfront Registration',
            upfront_3yr_formula: isUSD ? `$${(upfront3YrTotal / rate).toFixed(2)} total for initial 3-year term` : `₹${upfront3YrTotal.toLocaleString('en-IN')} total for initial 3-year term`,
            upfront_3yr_savings: savingsVsUpfront3Yr,

            // Calculation 2: 1-Year Registration + 2 Annual Renewals
            term_1yr_renew_total: term1YrRenewTotal,
            term_1yr_renew_display: isUSD ? `$${(term1YrRenewTotal / rate).toFixed(2)}` : `₹${term1YrRenewTotal.toLocaleString('en-IN')}`,
            term_1yr_renew_label: '1-Year Registration + 2 Annual Renewals',
            term_1yr_renew_formula: isUSD ? `$${(t1 / rate).toFixed(2)} + $${(rYear / rate).toFixed(2)} + $${(rYear / rate).toFixed(2)} = $${(term1YrRenewTotal / rate).toFixed(2)}` : `₹${t1.toLocaleString('en-IN')} + ₹${rYear.toLocaleString('en-IN')} + ₹${rYear.toLocaleString('en-IN')} = ₹${term1YrRenewTotal.toLocaleString('en-IN')}`,
            term_1yr_renew_savings: savingsVs1YrRenew,

            // Calculation 3: 2-Year Registration + 1 Annual Renewal
            term_2yr_renew_total: term2YrRenewTotal,
            term_2yr_renew_display: isUSD ? `$${(term2YrRenewTotal / rate).toFixed(2)}` : `₹${term2YrRenewTotal.toLocaleString('en-IN')}`,
            term_2yr_renew_label: '2-Year Registration + 1 Annual Renewal',
            term_2yr_renew_formula: isUSD ? `$${(t2 / rate).toFixed(2)} + $${(rYear / rate).toFixed(2)} = $${(term2YrRenewTotal / rate).toFixed(2)}` : `₹${t2.toLocaleString('en-IN')} + ₹${rYear.toLocaleString('en-IN')} = ₹${term2YrRenewTotal.toLocaleString('en-IN')}`,
            term_2yr_renew_savings: savingsVs2YrRenew
          };

          // Primary comparison defaults to 1-Year Registration + 2 Annual Renewals
          c3Yr = term1YrRenewTotal;
        }

        totalVerified3Yr += c3Yr;

        const savings = c3Yr - webnavi3Yr;
        const savingsPct = c3Yr > 0 ? ((savings / c3Yr) * 100) : 0;

        if (savings > maxSavings) {
          maxSavings = savings;
          maxSavingsCompetitor = compName;
        }

        // Format according to targetCurrency
        const regDisplay = isUSD ? `$${(cReg / rate).toFixed(2)}` : `₹${cReg.toLocaleString('en-IN')}`;
        const renewDisplay = isUSD ? `$${(cRenew / rate).toFixed(2)} / yr` : `₹${cRenew.toLocaleString('en-IN')} / yr`;
        const threeYrDisplay = isUSD ? `$${(c3Yr / rate).toFixed(2)}` : `₹${c3Yr.toLocaleString('en-IN')}`;

        const firstYrSavings = cReg - webnaviReg;
        const renewalSavings = cRenew - webnaviRenew;

        const compPrivacyObj = getWhoisPrivacyForTld(compName, tld, row.whois_privacy, null);

        processedCompetitors.push({
          name: compName,
          tld,
          is_available: true,
          is_user_provided: !!isUserProvided,
          is_verified: Number(row.is_verified) === 1 && !isUserProvided,
          has_term_options: !!termOptionsObj,
          term_options: termOptionsObj,
          reg_price: cReg,
          renew_price: cRenew,
          first_year_savings: firstYrSavings,
          first_year_savings_display: isUSD ? `${(Math.abs(firstYrSavings) / rate).toFixed(2)}` : `₹${Math.abs(firstYrSavings).toLocaleString('en-IN')}`,
          renewal_savings: renewalSavings,
          renewal_savings_display: isUSD ? `${(Math.abs(renewalSavings) / rate).toFixed(2)}` : `₹${Math.abs(renewalSavings).toLocaleString('en-IN')}`,
          mandatory_fees: cMandatory,
          three_year_total: c3Yr,
          reg_price_display: regDisplay,
          renew_price_display: renewDisplay,
          three_year_total_display: threeYrDisplay,
          whois_privacy: compPrivacyObj.text,
          whois_privacy_status: compPrivacyObj.status,
          conditions: row.conditions || 'Standard published provider terms.',
          source_url: row.source_url,
          verified_at: isUserProvided ? null : row.verified_at,
          verification_status: isUserProvided ? 'User-provided pricing pending independent source verification' : 'Verified',
          webnavi_savings: savings,
          webnavi_savings_display: isUSD ? `$${(Math.abs(savings) / rate).toFixed(2)}` : `₹${Math.abs(savings).toLocaleString('en-IN')}`,
          savings_pct: Number(savingsPct.toFixed(1)),
          is_cheaper_than_webnavi: savings < 0,
          notes: row.notes || null
        });
      }
    }

    // Format WebNavi values
    const webnaviRegDisplay = isUSD ? `$${(webnaviReg / rate).toFixed(2)}` : `₹${webnaviReg.toLocaleString('en-IN')}`;
    const webnaviRenewDisplay = isUSD ? `$${(webnaviRenew / rate).toFixed(2)} / yr` : `₹${webnaviRenew.toLocaleString('en-IN')} / yr`;
    const webnavi3YrDisplay = isUSD ? `$${(webnavi3Yr / rate).toFixed(2)}` : `₹${webnavi3Yr.toLocaleString('en-IN')}`;
    const webnaviWholesaleDisplay = isUSD ? `$${(webnaviWholesaleReg / rate).toFixed(2)}` : `₹${webnaviWholesaleReg.toLocaleString('en-IN')}`;
    const webnaviServiceFeeDisplay = isUSD ? `$${(webnaviServiceFee / rate).toFixed(2)}` : `₹${webnaviServiceFee.toLocaleString('en-IN')}`;

    const avgCompetitor3Yr = verifiedCount > 0 ? (totalVerified3Yr / verifiedCount) : 0;
    const avgSavings = verifiedCount > 0 ? (avgCompetitor3Yr - webnavi3Yr) : 0;

    // Resolve WebNavi WHOIS Privacy dynamically
    const webnaviPrivacyObj = getWhoisPrivacyForTld('WebNavi', tld, null, webnaviRecord?.addons_json);

    // Dynamic Lowest Price Evaluation
    const availableComps = processedCompetitors.filter(c => c.is_available);
    const allCompetitorsVerified = availableComps.length > 0 && availableComps.every(c => c.is_verified === true);
    const isWebNaviLowestReg = availableComps.every(c => Number(c.reg_price) >= webnaviReg);
    const isWebNaviLowestRenew = availableComps.every(c => Number(c.renew_price) >= webnaviRenew);
    const isWebNaviLowestOverall = isWebNaviLowestReg && isWebNaviLowestRenew;

    let lowestRegComp = null;
    let minRegPrice = webnaviReg;
    for (const c of availableComps) {
      if (Number(c.reg_price) < minRegPrice) {
        minRegPrice = Number(c.reg_price);
        lowestRegComp = c.name;
      }
    }

    // Retrieve last verified audit date dynamically from database
    const auditDateRow = this.db.prepare(`
      SELECT MAX(verified_at) AS last_verified
      FROM competitor_tld_pricing
      WHERE tld = ? AND is_active = 1 AND is_verified = 1 AND verified_at IS NOT NULL AND verified_at != 'Pending verification'
    `).get(tld);
    const dynamicAuditDate = auditDateRow?.last_verified || (
      processedCompetitors.find(c => c.is_verified && c.verified_at && c.verified_at !== 'Pending verification')?.verified_at || '2026-11-10'
    );

    return {
      tld,
      domain,
      currency: isUSD ? 'USD' : 'INR',
      currency_symbol: isUSD ? '$' : '₹',
      webnavi: {
        tld,
        name: 'WebNavi',
        reg_price: webnaviReg,
        renew_price: webnaviRenew,
        three_year_total: webnavi3Yr,
        reg_price_display: webnaviRegDisplay,
        renew_price_display: webnaviRenewDisplay,
        three_year_total_display: webnavi3YrDisplay,
        service_fee: webnaviServiceFee,
        renew_service_fee: webnaviRenewServiceFee,
        service_fee_display: webnaviServiceFeeDisplay,
        whois_privacy: webnaviPrivacyObj.text,
        whois_privacy_status: webnaviPrivacyObj.status,
        conditions: 'Direct Registry Registration — Disclosed Service Fee.',
        renewal_notice: 'Clear Upfront Rates — Know Your Exact Renewal Cost Before Checkout.'
      },
      competitors: processedCompetitors,
      comparison_audit: {
        all_competitors_verified: allCompetitorsVerified,
        is_webnavi_lowest_reg: isWebNaviLowestReg,
        is_webnavi_lowest_renew: isWebNaviLowestRenew,
        is_webnavi_lowest_overall: isWebNaviLowestOverall,
        lowest_reg_provider: lowestRegComp || 'WebNavi',
        last_verified_at: dynamicAuditDate,
        badge_title: isWebNaviLowestOverall
          ? (allCompetitorsVerified ? 'Lowest Verified Price' : 'Lowest Among Supplied Prices')
          : (isWebNaviLowestRenew ? 'Lowest Renewal Rate' : 'Direct Registry Pricing'),
        badge_explanation: isWebNaviLowestOverall
          ? (allCompetitorsVerified ? 'Cheapest 1st-Yr & Renewal Rate' : 'Competitor prices are subject to verification and provider-specific conditions.')
          : 'Direct Registry Registration — Disclosed Service Fee'
      },
      why_webnavi: {
        registration_price_display: webnaviRegDisplay,
        service_fee_display: webnaviServiceFeeDisplay,
        service_fee_note: 'Direct Registry + Service Fee',
        first_year_display: webnaviRegDisplay,
        renewal_price_display: webnaviRenewDisplay,
        renewal_fee_display: isUSD ? `$${(webnaviRenewServiceFee / rate).toFixed(2)}` : `₹${webnaviRenewServiceFee.toLocaleString('en-IN')}`,
        last_verified_at: dynamicAuditDate,
        is_transparent: true
      },
      savings_calculator: {
        domain,
        tld,
        has_verified_comparison: verifiedCount > 0,
        verified_count: verifiedCount,
        webnavi_year1_display: webnaviRegDisplay,
        webnavi_year2_display: isUSD ? `$${(webnaviRenew / rate).toFixed(2)}` : `₹${webnaviRenew.toLocaleString('en-IN')}`,
        webnavi_year3_display: isUSD ? `$${(webnaviRenew / rate).toFixed(2)}` : `₹${webnaviRenew.toLocaleString('en-IN')}`,
        webnavi_3yr_display: webnavi3YrDisplay,
        avg_savings_display: isUSD ? `$${(avgSavings / rate).toFixed(2)}` : `₹${Math.round(avgSavings).toLocaleString('en-IN')}`,
        max_savings_display: isUSD ? `$${(maxSavings / rate).toFixed(2)}` : `₹${Math.round(maxSavings).toLocaleString('en-IN')}`,
        max_savings_competitor: maxSavingsCompetitor,
        avg_savings_positive: avgSavings > 0
      }
    };
  }

  /**
   * Retrieves paginated competitor pricing list for admin management.
   */
  getAll(options = {}) {
    let sql = 'SELECT * FROM competitor_tld_pricing';
    const conditions = [];
    const params = [];

    if (options.search) {
      conditions.push('(tld LIKE ? OR competitor_name LIKE ?)');
      params.push(`%${options.search.trim()}%`, `%${options.search.trim()}%`);
    }

    if (options.tld) {
      conditions.push('tld = ?');
      params.push(normalizeTld(options.tld));
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY tld ASC, competitor_name ASC';

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Adds or updates a competitor pricing benchmark record.
   */
  saveCompetitorPrice(data) {
    if (!data.tld || !data.competitor_name) {
      throw new Error('Both TLD and Competitor Name are required.');
    }

    const tld = normalizeTld(data.tld);
    const competitor_name = data.competitor_name.trim();
    const reg_price = data.reg_price !== undefined && data.reg_price !== '' && data.reg_price !== null ? Number(data.reg_price) : null;
    const renew_price = data.renew_price !== undefined && data.renew_price !== '' && data.renew_price !== null ? Number(data.renew_price) : null;
    const term_years = Number(data.term_years || 1);
    const currency = (data.currency || 'INR').trim().toUpperCase();
    const conditions = (data.conditions || '').trim();
    const whois_privacy = (data.whois_privacy || 'Included').trim();
    const mandatory_fees = Number(data.mandatory_fees || 0);
    const source_url = (data.source_url || '').trim();
    const is_verified = data.is_verified === false || data.is_verified === 0 || data.is_verified === '0' ? 0 : 1;
    const verified_at = (data.verified_at || new Date().toISOString().split('T')[0]).trim();
    const is_active = data.is_active === false || data.is_active === 0 || data.is_active === '0' ? 0 : 1;
    const notes = (data.notes || '').trim();
    const term_options_json = data.term_options_json ? (typeof data.term_options_json === 'string' ? data.term_options_json : JSON.stringify(data.term_options_json)) : null;
    const now = new Date().toISOString();

    const existing = this.db.prepare('SELECT id FROM competitor_tld_pricing WHERE tld = ? AND competitor_name = ?').get(tld, competitor_name);

    if (existing) {
      this.db.prepare(`
        UPDATE competitor_tld_pricing
        SET reg_price = ?,
            renew_price = ?,
            term_years = ?,
            currency = ?,
            conditions = ?,
            whois_privacy = ?,
            mandatory_fees = ?,
            source_url = ?,
            is_verified = ?,
            verified_at = ?,
            is_active = ?,
            notes = ?,
            term_options_json = COALESCE(?, term_options_json),
            updated_at = ?
        WHERE id = ?
      `).run(
        reg_price, renew_price, term_years, currency, conditions, whois_privacy,
        mandatory_fees, source_url, is_verified, verified_at, is_active, notes,
        term_options_json, now, existing.id
      );
      return { id: existing.id, action: 'updated', tld, competitor_name };
    } else {
      const res = this.db.prepare(`
        INSERT INTO competitor_tld_pricing (
          tld, competitor_name, reg_price, renew_price, term_years, currency,
          conditions, whois_privacy, mandatory_fees, source_url, is_verified,
          verified_at, is_active, notes, term_options_json, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        tld, competitor_name, reg_price, renew_price, term_years, currency,
        conditions, whois_privacy, mandatory_fees, source_url, is_verified,
        verified_at, is_active, notes, term_options_json, now, now
      );
      return { id: res.lastInsertRowid, action: 'created', tld, competitor_name };
    }
  }

  /**
   * Deletes a competitor pricing record by ID.
   */
  deleteCompetitorPrice(id) {
    return this.db.prepare('DELETE FROM competitor_tld_pricing WHERE id = ?').run(id);
  }
}

module.exports = new CompetitorPricingService();


