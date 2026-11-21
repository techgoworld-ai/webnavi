const express = require('express');
const router = express.Router();
const hostyIndiaService = require('../services/hostyindia');
const pricingService = require('../services/pricingService');
const competitorPricingService = require('../services/competitorPricingService');

/**
 * GET /api/domains/competitors
 * Dynamic TLD-based competitor pricing comparison and transparent savings calculation.
 * Returns verified competitor benchmarks, transparent wholesale/retail breakdown,
 * and 3-year cumulative costs for GoDaddy, Hostinger, Namecheap, and WebNavi.
 */
router.get('/competitors', (req, res) => {
  try {
    const domainOrTld = req.query.tld || req.query.domain || 'artisanspice.com';
    const currency = (req.query.currency || 'INR').toUpperCase();
    const comparison = competitorPricingService.getComparisonForTld(domainOrTld, currency);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      success: true,
      ...comparison
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve competitor comparison.'
    });
  }
});

/**
 * GET /api/domains/geo
 * Detects visitor country and recommended currency.
 * If visitor is from India -> country 'IN', currency 'INR'.
 * If visitor is from any other country -> country detected (e.g. 'US', 'GB', 'CA', etc.), currency 'USD'.
 */
router.get('/geo', (req, res) => {
  const cfCountry = (req.headers['cf-ipcountry'] || req.headers['x-country-code'] || req.headers['x-geo-country'] || req.headers['x-vercel-ip-country'] || '').toString().trim().toUpperCase();
  const clientCountry = (req.query.country || '').toString().trim().toUpperCase();
  const clientOffset = req.query.offset !== undefined ? parseInt(req.query.offset, 10) : null;
  const clientTz = (req.query.tz || '').toString().toLowerCase();

  let country = 'IN'; // Default to India for WebNavi
  let isIndia = true;

  if (cfCountry && cfCountry.length === 2) {
    country = cfCountry;
    isIndia = country === 'IN';
  } else if (clientCountry && clientCountry.length === 2 && clientCountry === 'IN') {
    country = 'IN';
    isIndia = true;
  } else if (clientOffset === -330 || clientTz.includes('calcutta') || clientTz.includes('kolkata') || clientTz.includes('india')) {
    country = 'IN';
    isIndia = true;
  } else if (clientCountry && clientCountry.length === 2) {
    country = clientCountry;
    isIndia = country === 'IN';
  } else {
    const acceptLang = (req.headers['accept-language'] || '').toLowerCase();
    if (acceptLang.includes('en-in') || acceptLang.includes('hi') || acceptLang.includes('ta-in') || acceptLang.includes('te-in') || acceptLang.includes('mr-in') || acceptLang.includes('gu-in')) {
      country = 'IN';
      isIndia = true;
    } else if (acceptLang.includes('en-gb')) {
      country = 'GB';
      isIndia = false;
    } else if (acceptLang.includes('en-ca')) {
      country = 'CA';
      isIndia = false;
    } else if (acceptLang.includes('en-au')) {
      country = 'AU';
      isIndia = false;
    } else if (acceptLang.includes('ar-ae')) {
      country = 'AE';
      isIndia = false;
    } else if (acceptLang.includes('de-de') || acceptLang.includes('de')) {
      country = 'DE';
      isIndia = false;
    } else if (acceptLang.includes('en-sg') || acceptLang.includes('zh-sg')) {
      country = 'SG';
      isIndia = false;
    } else {
      // Local development or default fallback: WebNavi primary base is India (IST -330)
      country = 'IN';
      isIndia = true;
    }
  }

  const currency = isIndia ? 'INR' : 'USD';
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    success: true,
    country,
    isIndia,
    currency,
  });
});

/**
 * GET /api/domains/balance
 * Returns normalized reseller wallet balance, currency, and active domain count.
 * Excludes sensitive personal details (reseller ID, email, names, portal URL).
 */
router.get('/balance', async (req, res, next) => {
  try {
    const result = await hostyIndiaService.getBalance();
    res.json(result);
  } catch (error) {
    if (error.statusCode === 504 || error.code === 'GATEWAY_TIMEOUT' || /timeout|aborted/i.test(error.message)) {
      return res.status(504).json({
        success: false,
        error: error.message || 'Registry gateway request timed out. Please try again.',
        code: 'GATEWAY_TIMEOUT',
      });
    }
    if (error.statusCode === 401 || error.code === 'AUTH_ERROR') {
      return res.status(401).json({
        success: false,
        error: error.message,
        code: 'AUTH_ERROR',
      });
    }
    next(error);
  }
});

/**
 * POST /api/domains/check
 * Request body: { "domain": "example.in" }
 * Checks availability and pricing. Strictly read-only; does not register domains.
 */
router.post('/check', async (req, res, next) => {
  try {
    const { domain } = req.body || {};

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid "domain" parameter in request body.',
      });
    }

    console.log(`[POST /api/domains/check] User query: "${domain}"`);
    const result = await hostyIndiaService.checkDomainAvailability(domain);

    // Apply configured retail pricing if present (e.g. .com at ₹899 / ₹1,349, .in at ₹649 / ₹849);
    // Otherwise fallback directly to upstream wholesale pricing.
    const tld = result.tld || ('.' + result.domain.split('.').pop());
    const pricingConfig = pricingService.getTldPricing(tld);
    if (pricingConfig) {
      result.wholesale_price = result.price;
      result.wholesale_renew = result.renew_price;
      if (pricingConfig.retail_register != null) {
        result.price = pricingConfig.retail_register;
        result.formatted_price = `₹ ${Number(result.price).toFixed(2)}`;
      }
      if (pricingConfig.retail_renew != null) {
        result.renew_price = pricingConfig.retail_renew;
        result.formatted_renew = `₹ ${Number(result.renew_price).toFixed(2)}`;
      }
    }

    console.log(`[POST /api/domains/check] Resolved domain="${result.domain}" | is_available=${result.is_available} | status=${result.availability_status} | price=${result.price} (wholesale=${result.wholesale_price || result.price})`);
    res.json(result);
  } catch (error) {
    if (error.statusCode === 400 || (error.message && (error.message.includes('Invalid domain format') || error.message.includes('valid domain name')))) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
    if (error.statusCode === 504 || error.code === 'GATEWAY_TIMEOUT' || /timeout|aborted/i.test(error.message)) {
      return res.status(504).json({
        success: false,
        error: error.message || 'Registry gateway request timed out. Please try again.',
        code: 'GATEWAY_TIMEOUT',
      });
    }
    if (error.statusCode === 401 || error.code === 'AUTH_ERROR') {
      return res.status(401).json({
        success: false,
        error: error.message,
        code: 'AUTH_ERROR',
      });
    }
    next(error);
  }
});

module.exports = router;

