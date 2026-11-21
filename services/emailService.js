/**
 * WebNavi Transactional Email Delivery Service (Resend Integration)
 * 
 * Features:
 * - Resend API integration for high deliverability transactional emails
 * - Safe fallback/simulation when RESEND_API_KEY is not configured or during testing
 * - In-memory audit log of sent emails for local test verification
 * - Zero exposure of raw API keys in responses or logs
 * - Branded HTML & plain-text transactional emails
 */

const { Resend } = require('resend');
const crypto = require('crypto');
const emailTemplates = require('./emailTemplates');

class EmailService {
  constructor() {
    this.sentEmails = []; // Test & audit buffer
  }

  getApiKey() {
    return (process.env.RESEND_API_KEY || '').trim();
  }

  getFromAddress() {
    return (process.env.EMAIL_FROM || 'WebNavi <onboarding@resend.dev>').trim();
  }

  getOwnerEmail() {
    return (process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || 'techgoworld@gmail.com').trim();
  }

  getBaseUrl() {
    return (process.env.APP_BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
  }

  /**
   * Returns current provider readiness and configuration status without leaking keys.
   */
  getProviderStatus() {
    const report = this.validateConfiguration();

    return {
      provider: 'resend',
      configured: report.apiKeyConfigured,
      validKeyFormat: report.validKeyFormat,
      senderAddress: report.senderAddress,
      senderDomain: report.senderDomain,
      isCustomDomain: report.isCustomDomain,
      baseUrl: report.baseUrl,
      baseUrlIsHttps: report.baseUrlIsHttps,
      mode: report.apiKeyConfigured ? 'live' : 'simulated',
      readyForProduction: report.readyForProduction,
      readyForDevelopment: report.readyForDevelopment,
      issues: report.issues,
      recommendations: report.recommendations,
    };
  }

  /**
   * Thorough configuration validation & production readiness checker.
   */
  validateConfiguration() {
    const key = this.getApiKey();
    const from = this.getFromAddress();
    const baseUrl = this.getBaseUrl();
    const isProd = process.env.NODE_ENV === 'production';

    const issues = [];
    const recommendations = [];

    // 1. API Key validation
    const hasKey = Boolean(key && key.length > 5);
    const validKeyFormat = hasKey && key.startsWith('re_') && key.length > 20;

    if (!hasKey) {
      issues.push('RESEND_API_KEY is not configured in environment variables.');
      recommendations.push('Add RESEND_API_KEY=re_... to your environment configuration.');
    } else if (!validKeyFormat) {
      issues.push('RESEND_API_KEY format is invalid (must begin with "re_" and exceed 20 characters).');
    }

    // 2. Sender Address & Domain validation
    const emailMatch = from.match(/<([^>]+)>|([^\s<]+@[^\s>]+)/);
    const cleanSenderEmail = emailMatch ? (emailMatch[1] || emailMatch[2]).trim().toLowerCase() : '';
    const senderDomain = cleanSenderEmail.includes('@') ? cleanSenderEmail.split('@')[1] : '';
    const isResendDev = senderDomain === 'resend.dev';

    if (!cleanSenderEmail || !senderDomain) {
      issues.push('EMAIL_FROM does not contain a valid sender email address.');
      recommendations.push('Set EMAIL_FROM to a valid address (e.g. "WebNavi <noreply@webnavi.in>").');
    } else if (isResendDev) {
      if (isProd) {
        issues.push('EMAIL_FROM uses onboarding@resend.dev in production. Resend restricts this address to test emails only.');
      }
      recommendations.push('Verify your custom domain (e.g. webnavi.in) in the Resend dashboard and update EMAIL_FROM.');
    }

    // 3. Base URL validation
    let validUrl = false;
    let isHttps = false;
    let isLocalhost = false;
    try {
      const parsed = new URL(baseUrl);
      validUrl = Boolean(parsed.protocol && parsed.host);
      isHttps = parsed.protocol === 'https:';
      isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch (e) {
      issues.push(`APP_BASE_URL ("${baseUrl}") is not a valid absolute URL.`);
    }

    if (validUrl) {
      if (isProd && !isHttps) {
        issues.push('Production APP_BASE_URL must use HTTPS protocol for secure verification and password reset links.');
        recommendations.push('Update APP_BASE_URL to start with "https://" (e.g. https://webnavi.in).');
      }
      if (isProd && isLocalhost) {
        issues.push('Production APP_BASE_URL points to localhost/127.0.0.1. Email links will not be accessible to external users.');
        recommendations.push('Update APP_BASE_URL to your public domain (e.g. https://webnavi.in).');
      }
    }

    const readyForProduction = validKeyFormat && Boolean(cleanSenderEmail) && !isResendDev && validUrl && isHttps && !isLocalhost;

    return {
      readyForProduction,
      readyForDevelopment: hasKey || !isProd,
      environment: isProd ? 'production' : (process.env.NODE_ENV || 'development'),
      apiKeyConfigured: hasKey,
      validKeyFormat,
      senderAddress: from,
      senderDomain: senderDomain || 'unknown',
      isCustomDomain: Boolean(senderDomain && !isResendDev),
      baseUrl,
      baseUrlIsValid: validUrl,
      baseUrlIsHttps: isHttps,
      baseUrlIsLocalhost: isLocalhost,
      issues,
      recommendations,
    };
  }

  /**
   * Logs email service readiness banner on application startup.
   */
  logStartupReadiness() {
    const report = this.validateConfiguration();
    console.log(`[Email Service] Provider: Resend | Key Configured: ${report.apiKeyConfigured ? 'Yes (re_...)' : 'No'} | Sender: ${report.senderAddress} | Base URL: ${report.baseUrl}`);
    if (report.issues.length > 0 && process.env.NODE_ENV === 'production') {
      console.warn('[Email Service Production Readiness Warnings]:');
      report.issues.forEach(issue => console.warn(`  - ${issue}`));
    }
  }

  /**
   * Primary email dispatch method.
   */
  async sendEmail({ to, subject, html, text }) {
    if (!to || !to.includes('@')) {
      throw new Error('Valid recipient email address is required.');
    }
    if (!subject) {
      throw new Error('Email subject is required.');
    }

    const apiKey = this.getApiKey();
    const from = this.getFromAddress();

    const record = {
      id: 'msg_' + crypto.randomBytes(8).toString('hex'),
      to,
      from,
      subject,
      html,
      text,
      sentAt: new Date().toISOString(),
      provider: apiKey ? 'resend' : 'simulated',
    };

    // Keep last 100 sent emails in memory for testing/audit
    this.sentEmails.push(record);
    if (this.sentEmails.length > 100) {
      this.sentEmails.shift();
    }

    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        return {
          success: false,
          error: 'RESEND_API_KEY is required in production environment.',
          code: 'MISSING_API_KEY',
          provider: 'resend',
          simulated: false,
        };
      }

      // Safe simulated delivery when API key is not yet provided in development/test
      return {
        success: true,
        id: record.id,
        simulated: true,
        provider: 'resend-simulated',
        to,
        subject,
        message: 'Email simulated in development/test environment (RESEND_API_KEY not configured).',
      };
    }

    try {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: [to],
        subject,
        html,
        text,
      });

      if (error) {
        console.warn(`[Resend Error] Failed to send email to ${to}:`, error.message || error);
        return {
          success: false,
          error: error.message || 'Resend delivery failed',
          provider: 'resend',
          code: error.name || 'DELIVERY_ERROR',
        };
      }

      return {
        success: true,
        id: data ? data.id : record.id,
        simulated: false,
        provider: 'resend',
        to,
      };
    } catch (err) {
      console.warn(`[Email Service Exception] ${err.message}`);
      return {
        success: false,
        error: err.message,
        provider: 'resend',
        code: 'RESEND_EXCEPTION',
      };
    }
  }

  /**
   * Sends account email verification link (24-hour expiration).
   */
  async sendVerificationEmail(customer, rawToken) {
    if (!customer || !customer.email) {
      throw new Error('Customer with valid email required for verification email.');
    }
    const verificationUrl = `${this.getBaseUrl()}/verify-email?token=${encodeURIComponent(rawToken)}`;
    const template = emailTemplates.getVerificationEmail({
      fullName: customer.full_name || customer.fullName,
      email: customer.email,
      verificationUrl,
      expiresHours: 24,
    });

    return this.sendEmail({
      to: customer.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  /**
   * Sends single-use password reset link (1-hour expiration).
   */
  async sendPasswordResetEmail(customer, rawToken) {
    if (!customer || !customer.email) {
      throw new Error('Customer with valid email required for password reset email.');
    }
    const resetUrl = `${this.getBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const template = emailTemplates.getPasswordResetEmail({
      fullName: customer.full_name || customer.fullName,
      email: customer.email,
      resetUrl,
      expiresMinutes: 60,
    });

    return this.sendEmail({
      to: customer.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  /**
   * Sends domain purchase confirmation receipt.
   */
  async sendOrderConfirmationEmail(customer, order) {
    if (!customer || !customer.email) return { success: false, error: 'No recipient email' };
    const invoiceUrl = order.invoiceUrl || `${this.getBaseUrl()}/api/orders/${order.order_id || order.orderId}/invoice`;
    const dashboardUrl = `${this.getBaseUrl()}/customer/dashboard`;
    const template = emailTemplates.getOrderConfirmationEmail({
      fullName: customer.full_name || customer.fullName,
      orderId: order.order_id || order.orderId,
      domain: order.domain,
      totalAmount: order.total_amount || order.totalAmount,
      currency: order.currency || 'INR',
      invoiceUrl,
      dashboardUrl,
    });

    return this.sendEmail({
      to: customer.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  /**
   * Sends free website application confirmation.
   */
  async sendApplicationConfirmationEmail(customer, application) {
    if (!customer || !customer.email) return { success: false, error: 'No recipient email' };
    const portalUrl = `${this.getBaseUrl()}/application/${application.client_id || application.clientId}`;
    const template = emailTemplates.getApplicationConfirmationEmail({
      fullName: customer.full_name || customer.fullName,
      ticketId: application.ticket_id || application.ticketId,
      businessName: application.business_name || application.businessName,
      portalUrl,
    });

    return this.sendEmail({
      to: customer.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  /**
   * Sends owner/admin alert notification when a new free website application is submitted.
   */
  async sendOwnerApplicationNotification(application, formData = {}) {
    const ownerEmail = this.getOwnerEmail();
    if (!ownerEmail) return { success: false, error: 'No owner email configured' };

    const portalUrl = `${this.getBaseUrl()}/application/${application.client_id || application.clientId}`;
    const template = emailTemplates.getOwnerApplicationNotificationEmail({
      fullName: formData.fullName || formData.name || application.fullName,
      businessName: formData.businessName || application.businessName,
      ticketId: application.ticket_id || application.ticketId,
      email: formData.email || application.email,
      phone: formData.phone || application.phone,
      preferredDomain: formData.preferredDomain || application.preferredDomain,
      city: formData.city || application.city,
      state: formData.state || application.state,
      description: formData.description || application.description,
      portalUrl,
    });

    return this.sendEmail({
      to: ownerEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  /**
   * Helper methods for tests
   */
  getSentEmails() {
    return [...this.sentEmails];
  }

  getLastSentEmail() {
    return this.sentEmails.length > 0 ? this.sentEmails[this.sentEmails.length - 1] : null;
  }

  clearSentEmails() {
    this.sentEmails = [];
  }
}

const emailService = new EmailService();
module.exports = emailService;
module.exports.EmailService = EmailService;

