/**
 * WebNavi Transactional Email Templates
 * 
 * Branded responsive HTML & plain-text templates for:
 * 1. Account Email Verification
 * 2. Password Reset
 * 3. Domain Order Confirmation
 * 4. Free Website Application Confirmation
 * 
 * Design matches WebNavi emerald (#00e599), gold (#ffd43b), and dark obsidian theme.
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function baseLayout({ title, preheader, contentHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #03140e; }
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; padding: 12px !important; }
      .content-cell { padding: 24px 18px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #03140e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #d7e0db;">
  <div style="display: none; font-size: 1px; color: #03140e; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #03140e; padding: 30px 0;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" border="0" cellpadding="0" cellspacing="0" width="560" style="max-width: 560px; width: 100%;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #00e599; width: 36px; height: 36px; border-radius: 8px; text-align: center; vertical-align: middle;">
                    <span style="color: #03140e; font-size: 20px; font-weight: 900; line-height: 36px;">W</span>
                  </td>
                  <td style="padding-left: 12px;">
                    <span style="color: #ffffff; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;">WebNavi</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main Card -->
          <tr>
            <td class="content-cell" style="background-color: #051912; border: 1px solid #1a382d; border-radius: 14px; padding: 36px 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              ${contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 24px; font-size: 12px; color: #6b857a; line-height: 1.6;">
              <p style="margin: 0 0 8px 0;">WebNavi — High-Performance Domain Registration &amp; Cloud Infrastructure</p>
              <p style="margin: 0;">This is an automated transactional message sent to you regarding your WebNavi account. Please do not reply directly to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * 1. Account Email Verification Template
 */
function getVerificationEmail({ fullName, email, verificationUrl, expiresHours = 24 }) {
  const safeName = escapeHtml(fullName || 'Valued Customer');
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(verificationUrl);

  const contentHtml = `
    <div style="display: inline-block; background-color: rgba(0, 229, 153, 0.12); border: 1px solid rgba(0, 229, 153, 0.3); border-radius: 4px; padding: 4px 10px; color: #00e599; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px;">
      Account Security
    </div>
    <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0 0 14px 0; letter-spacing: -0.02em;">Verify your WebNavi account</h1>
    <p style="color: #9ab3a8; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
      Hello <strong style="color: #ffffff;">${safeName}</strong>, thank you for choosing WebNavi. Please confirm ownership of <strong style="color: #ffd43b;">${safeEmail}</strong> to activate your customer account and access your dashboard.
    </p>

    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
      <tr>
        <td align="left">
          <a href="${safeUrl}" target="_blank" style="background-color: #ffd43b; color: #020c08; padding: 14px 28px; font-size: 15px; font-weight: 800; text-decoration: none; border-radius: 8px; display: inline-block; letter-spacing: 0.02em;">
            Verify Email Address &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="color: #7b9489; font-size: 13px; line-height: 1.5; margin: 0 0 16px 0;">
      This verification link is single-use and will expire in <strong>${expiresHours} hours</strong>. If you did not create a WebNavi account or request this, no action is required.
    </p>

    <div style="border-top: 1px solid #143326; padding-top: 16px; margin-top: 24px;">
      <p style="color: #5c7469; font-size: 12px; line-height: 1.5; margin: 0; word-break: break-all;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${safeUrl}" style="color: #00e599; text-decoration: underline;">${safeUrl}</a>
      </p>
    </div>
  `;

  const text = `Verify your WebNavi account\n\nHello ${fullName || 'Valued Customer'},\n\nPlease verify your email address (${email}) to activate your customer account:\n${verificationUrl}\n\nThis single-use link expires in ${expiresHours} hours.\n\nWebNavi Team`;

  return {
    subject: 'Verify your WebNavi account',
    html: baseLayout({
      title: 'Verify your WebNavi account',
      preheader: 'Please verify your email address to activate your WebNavi customer account.',
      contentHtml,
    }),
    text,
  };
}

/**
 * 2. Password Reset Template
 */
function getPasswordResetEmail({ fullName, email, resetUrl, expiresMinutes = 60 }) {
  const safeName = escapeHtml(fullName || 'Valued Customer');
  const safeUrl = escapeHtml(resetUrl);

  const contentHtml = `
    <div style="display: inline-block; background-color: rgba(255, 212, 59, 0.12); border: 1px solid rgba(255, 212, 59, 0.3); border-radius: 4px; padding: 4px 10px; color: #ffd43b; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px;">
      Password Recovery
    </div>
    <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0 0 14px 0; letter-spacing: -0.02em;">Reset your password</h1>
    <p style="color: #9ab3a8; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
      Hello <strong style="color: #ffffff;">${safeName}</strong>, we received a request to reset the password for your WebNavi account. Click below to choose a new secure password.
    </p>

    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
      <tr>
        <td align="left">
          <a href="${safeUrl}" target="_blank" style="background-color: #ffd43b; color: #020c08; padding: 14px 28px; font-size: 15px; font-weight: 800; text-decoration: none; border-radius: 8px; display: inline-block; letter-spacing: 0.02em;">
            Set New Password &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="color: #7b9489; font-size: 13px; line-height: 1.5; margin: 0 0 16px 0;">
      This single-use reset link expires in <strong>${expiresMinutes} minutes</strong>. If you did not initiate this request, your password remains secure and you can safely disregard this email.
    </p>

    <div style="border-top: 1px solid #143326; padding-top: 16px; margin-top: 24px;">
      <p style="color: #5c7469; font-size: 12px; line-height: 1.5; margin: 0; word-break: break-all;">
        Direct link: <a href="${safeUrl}" style="color: #00e599; text-decoration: underline;">${safeUrl}</a>
      </p>
    </div>
  `;

  const text = `Reset your WebNavi password\n\nHello ${fullName || 'Valued Customer'},\n\nWe received a request to reset your password. Use the link below within ${expiresMinutes} minutes:\n${resetUrl}\n\nIf you did not make this request, please ignore this email.\n\nWebNavi Security Team`;

  return {
    subject: 'Reset your WebNavi password',
    html: baseLayout({
      title: 'Reset your WebNavi password',
      preheader: 'Use this secure link to reset your WebNavi account password.',
      contentHtml,
    }),
    text,
  };
}

/**
 * 3. Domain Order Confirmation Template
 */
function getOrderConfirmationEmail({ fullName, orderId, domain, totalAmount, currency = 'INR', invoiceUrl, dashboardUrl }) {
  const safeName = escapeHtml(fullName || 'Valued Customer');
  const safeOrderId = escapeHtml(orderId);
  const safeDomain = escapeHtml(domain);
  const safeAmount = Number(totalAmount || 0).toFixed(2);
  const safeCurrency = escapeHtml(currency);
  const safeInvoice = invoiceUrl ? escapeHtml(invoiceUrl) : null;
  const safeDashboard = escapeHtml(dashboardUrl || 'https://webnavi.in/customer/dashboard');

  const contentHtml = `
    <div style="display: inline-block; background-color: rgba(0, 229, 153, 0.12); border: 1px solid rgba(0, 229, 153, 0.3); border-radius: 4px; padding: 4px 10px; color: #00e599; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px;">
      Order Confirmed
    </div>
    <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0 0 14px 0; letter-spacing: -0.02em;">Domain Purchase Confirmation</h1>
    <p style="color: #9ab3a8; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
      Hello <strong style="color: #ffffff;">${safeName}</strong>, thank you for your order. We have received your payment and provisioned your domain registration.
    </p>

    <!-- Order Summary Table -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #020c08; border: 1px solid #143326; border-radius: 10px; margin: 20px 0; overflow: hidden;">
      <tr>
        <td style="padding: 14px 18px; border-bottom: 1px solid #143326; color: #7b9489; font-size: 13px;">Order Reference</td>
        <td align="right" style="padding: 14px 18px; border-bottom: 1px solid #143326; color: #ffd43b; font-family: monospace; font-weight: 700; font-size: 14px;">${safeOrderId}</td>
      </tr>
      <tr>
        <td style="padding: 14px 18px; border-bottom: 1px solid #143326; color: #7b9489; font-size: 13px;">Registered Domain</td>
        <td align="right" style="padding: 14px 18px; border-bottom: 1px solid #143326; color: #00e599; font-weight: 700; font-size: 14px;">${safeDomain}</td>
      </tr>
      <tr>
        <td style="padding: 14px 18px; color: #7b9489; font-size: 13px;">Total Paid</td>
        <td align="right" style="padding: 14px 18px; color: #ffffff; font-weight: 800; font-size: 16px;">${safeCurrency} ${safeAmount}</td>
      </tr>
    </table>

    ${safeInvoice ? `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 24px 0 12px 0;">
      <tr>
        <td align="left">
          <a href="${safeInvoice}" target="_blank" style="background-color: #ffd43b; color: #020c08; padding: 12px 24px; font-size: 14px; font-weight: 800; text-decoration: none; border-radius: 8px; display: inline-block;">
            Download Tax Invoice (PDF) &rarr;
          </a>
        </td>
      </tr>
    </table>` : ''}

    <p style="color: #7b9489; font-size: 13px; line-height: 1.5; margin: 16px 0 0 0;">
      Authoritative Cloudflare DNS zone records and nameserver delegation have been initiated for your domain. You can manage DNS records directly through your customer dashboard.
    </p>
  `;

  const text = `Domain Purchase Confirmation\n\nOrder ID: ${orderId}\nDomain: ${domain}\nTotal: ${currency} ${safeAmount}\n\nThank you for choosing WebNavi!\nManage your domains at: ${safeDashboard}`;

  return {
    subject: `Domain Order Confirmed: ${domain} (${orderId})`,
    html: baseLayout({
      title: `Order Confirmed — ${domain}`,
      preheader: `Your domain ${domain} has been registered successfully under Order ${orderId}.`,
      contentHtml,
    }),
    text,
  };
}

/**
 * 4. Free Website Application Confirmation Template
 */
function getApplicationConfirmationEmail({ fullName, ticketId, businessName, portalUrl }) {
  const safeName = escapeHtml(fullName || 'Valued Customer');
  const safeTicket = escapeHtml(ticketId);
  const safeBiz = escapeHtml(businessName || 'Your Business Project');
  const safePortal = escapeHtml(portalUrl);

  const contentHtml = `
    <div style="display: inline-block; background-color: rgba(0, 229, 153, 0.12); border: 1px solid rgba(0, 229, 153, 0.3); border-radius: 4px; padding: 4px 10px; color: #00e599; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px;">
      Application Received
    </div>
    <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0 0 14px 0; letter-spacing: -0.02em;">Free Website Application Confirmed</h1>
    <p style="color: #9ab3a8; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
      Hello <strong style="color: #ffffff;">${safeName}</strong>, we received your application for <strong style="color: #ffd43b;">${safeBiz}</strong>. Our architecture team has queued your submission for review.
    </p>

    <!-- Project Box -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #020c08; border: 1px solid #143326; border-radius: 10px; margin: 20px 0; overflow: hidden;">
      <tr>
        <td style="padding: 14px 18px; border-bottom: 1px solid #143326; color: #7b9489; font-size: 13px;">Ticket ID</td>
        <td align="right" style="padding: 14px 18px; border-bottom: 1px solid #143326; color: #ffd43b; font-family: monospace; font-weight: 700; font-size: 14px;">${safeTicket}</td>
      </tr>
      <tr>
        <td style="padding: 14px 18px; color: #7b9489; font-size: 13px;">Project Status</td>
        <td align="right" style="padding: 14px 18px; color: #00e599; font-weight: 700; font-size: 13px;">Stage 1: Architecture Review</td>
      </tr>
    </table>

    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
      <tr>
        <td align="left">
          <a href="${safePortal}" target="_blank" style="background-color: #ffd43b; color: #020c08; padding: 14px 28px; font-size: 15px; font-weight: 800; text-decoration: none; border-radius: 8px; display: inline-block;">
            Open Client Project Portal &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="color: #7b9489; font-size: 13px; line-height: 1.5; margin: 0;">
      You can track project milestones, chat with assigned developers, and view staging previews inside your client portal.
    </p>
  `;

  const text = `Free Website Application Received\n\nTicket: ${ticketId}\nBusiness: ${businessName}\n\nTrack your application progress here:\n${portalUrl}\n\nWebNavi Projects Team`;

  return {
    subject: `Application Received: ${businessName} (${ticketId})`,
    html: baseLayout({
      title: `Application Confirmed — ${ticketId}`,
      preheader: `We have received your free website application for ${businessName}.`,
      contentHtml,
    }),
    text,
  };
}

module.exports = {
  getVerificationEmail,
  getPasswordResetEmail,
  getOrderConfirmationEmail,
  getApplicationConfirmationEmail,
};

