const PDFDocument = require('pdfkit');

/**
 * WebNavi Customer Invoice / Order Receipt PDF Generator
 * Creates an official WebNavi document with sovereign branding, full registrant details,
 * verified wholesale pricing, tax breakdown, and registration details.
 *
 * @param {Object} order The order record from orderStore.
 * @returns {Promise<Buffer>} The generated PDF as a binary Buffer.
 */
function generateInvoicePdf(order) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `WebNavi Invoice - ${order.orderId}`,
          Author: 'WebNavi Domain Operations',
          Subject: `Domain Registration Order ${order.domain}`,
        },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const primaryColor = '#041610';
      const accentGold = '#c99a16';
      const accentGreen = '#00875a';
      const textMuted = '#4a5b53';
      const textDark = '#111827';
      const borderColor = '#d1d5db';

      // --- Header / Brand ---
      doc.rect(40, 40, 515, 60).fill('#051912');

      doc.fillColor('#ffd43b')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('WEBNAVI', 60, 52);

      doc.fillColor('#9cb1a6')
        .font('Helvetica')
        .fontSize(8.5)
        .text('Direct ICANN Registrar Gateway & Developer Cloud Infrastructure', 60, 76);

      doc.fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(14)
        .text('DOMAIN ORDER RECEIPT', 360, 52, { align: 'right', width: 175 });

      doc.fillColor('#ffd43b')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`INV-${order.orderId.replace('ORD-', '')}`, 360, 72, { align: 'right', width: 175 });

      let y = 120;

      // --- Metadata Table (2 Columns) ---
      // Left: Billed To (Registrant)
      doc.fillColor(accentGold)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('REGISTRANT & CONTACT DETAILS', 40, y);

      y += 14;
      const reg = order.registrant || {};
      const fullName = `${reg.firstName || ''} ${reg.lastName || ''}`.trim() || 'Valued Customer';

      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(11).text(fullName, 40, y);
      y += 14;

      doc.fillColor(textMuted).font('Helvetica').fontSize(9);
      if (reg.orgName) {
        doc.text(reg.orgName, 40, y);
        y += 12;
      }
      if (reg.address1) {
        doc.text(reg.address1 + (reg.address2 ? `, ${reg.address2}` : ''), 40, y);
        y += 12;
      }
      doc.text(`${reg.city || ''}, ${reg.state || ''} ${reg.postalCode || ''} (${reg.country || 'IN'})`, 40, y);
      y += 12;
      doc.text(`Email: ${reg.email || 'N/A'} | Phone: ${reg.phone || 'N/A'}`, 40, y);

      // Right: Order Metadata
      const rightX = 340;
      let rightY = 120;
      doc.fillColor(accentGold)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('ORDER SPECIFICATIONS', rightX, rightY);

      rightY += 14;
      doc.fillColor(textMuted).font('Helvetica').fontSize(9);

      const createdDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
      const regDate = order.registeredAt ? new Date(order.registeredAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Pending Confirmation';
      const expDate = order.expiresAt ? new Date(order.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Pending Confirmation';

      doc.text(`Order ID: `, rightX, rightY, { continued: true })
        .fillColor(textDark).font('Helvetica-Bold').text(order.orderId);
      rightY += 13;

      doc.fillColor(textMuted).font('Helvetica').text(`Order Date: `, rightX, rightY, { continued: true })
        .fillColor(textDark).font('Helvetica-Bold').text(createdDate);
      rightY += 13;

      doc.fillColor(textMuted).font('Helvetica').text(`Registration Status: `, rightX, rightY, { continued: true })
        .fillColor(order.status === 'ACTIVE' ? accentGreen : (order.status === 'FAILED' ? '#d9534f' : accentGold))
        .font('Helvetica-Bold').text(order.status || 'PENDING');
      rightY += 13;

      doc.fillColor(textMuted).font('Helvetica').text(`Payment Funding: `, rightX, rightY, { continued: true })
        .fillColor(textDark).font('Helvetica-Bold').text(order.paymentMethod || 'Reseller Wallet / Test Procedure');
      rightY += 13;

      if (order.registrarRef) {
        doc.fillColor(textMuted).font('Helvetica').text(`Registrar Ref: `, rightX, rightY, { continued: true })
          .fillColor(textDark).font('Helvetica-Bold').text(order.registrarRef);
        rightY += 13;
      }

      y = Math.max(y + 20, rightY + 20);

      // --- Itemized Table ---
      doc.rect(40, y, 515, 24).fill('#051912');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
      doc.text('DESCRIPTION / DOMAIN', 50, y + 7);
      doc.text('PERIOD', 310, y + 7);
      doc.text('RENEWAL RATE', 380, y + 7);
      doc.text('AMOUNT', 470, y + 7, { align: 'right', width: 75 });

      y += 24;

      // Table Row
      doc.rect(40, y, 515, 45).fill('#f9fafb');
      doc.rect(40, y, 515, 45).stroke('#e5e7eb');

      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(11).text(order.domain, 50, y + 10);
      doc.fillColor(textMuted).font('Helvetica').fontSize(8)
        .text(`ICANN Registry Wholesale Allocation • Direct wholesale pass-through`, 50, y + 25);

      doc.fillColor(textDark).font('Helvetica').fontSize(9.5)
        .text(`${order.regPeriodYears || 1} Year`, 310, y + 15);

      const renewText = order.renewPrice ? `₹ ${Number(order.renewPrice).toFixed(2)}/yr` : 'At-Cost';
      doc.fillColor(textMuted).font('Helvetica').fontSize(9)
        .text(renewText, 380, y + 15);

      const regAmountText = `₹ ${Number(order.regPrice || 0).toFixed(2)}`;
      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(11)
        .text(regAmountText, 470, y + 15, { align: 'right', width: 75 });

      y += 55;

      // --- Calculation Box ---
      const calcX = 320;
      doc.rect(calcX, y, 235, 80).fill('#f3f4f6');
      doc.rect(calcX, y, 235, 80).stroke('#d1d5db');

      let cy = y + 8;
      doc.fillColor(textMuted).font('Helvetica').fontSize(9).text('Wholesale Registration Fee:', calcX + 10, cy);
      doc.fillColor(textDark).font('Helvetica-Bold').text(`₹ ${Number(order.regPrice || 0).toFixed(2)}`, calcX + 130, cy, { align: 'right', width: 95 });

      cy += 16;
      doc.fillColor(textMuted).font('Helvetica').fontSize(9).text('Verified Registry Tax / GST:', calcX + 10, cy);
      const taxText = order.taxAmount > 0 ? `₹ ${Number(order.taxAmount).toFixed(2)}` : '₹ 0.00 (Zero-Rated)';
      doc.fillColor(textDark).font('Helvetica-Bold').text(taxText, calcX + 130, cy, { align: 'right', width: 95 });

      cy += 18;
      doc.rect(calcX + 10, cy - 2, 215, 1).fill('#cbd5e1');

      cy += 4;
      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(11).text('TOTAL AMOUNT:', calcX + 10, cy);
      doc.fillColor(accentGreen).font('Helvetica-Bold').fontSize(12).text(`₹ ${Number(order.totalAmount || 0).toFixed(2)}`, calcX + 130, cy, { align: 'right', width: 95 });

      // Left of calculation: Nameserver Details
      let nsY = y;
      doc.fillColor(accentGold).font('Helvetica-Bold').fontSize(9).text('ASSIGNED DNS NAMESERVERS', 40, nsY);
      nsY += 14;
      const nsList = Array.isArray(order.nameservers) && order.nameservers.length > 0 ? order.nameservers : ['Pending Cloudflare Assignment'];
      doc.fillColor(textMuted).font('Helvetica').fontSize(8.5);
      nsList.forEach((ns, idx) => {
        doc.text(`Primary NS ${idx + 1}: `, 40, nsY, { continued: true })
          .fillColor(textDark).font('Helvetica-Bold').text(ns);
        nsY += 12;
      });

      if (order.registeredAt) {
        doc.fillColor(textMuted).font('Helvetica').fontSize(8)
          .text(`Live Registration Date: ${regDate}`, 40, nsY);
        nsY += 11;
        doc.text(`Domain Expiration Date: ${expDate}`, 40, nsY);
      }

      y += 100;

      // --- Important Disclosures & Legal Notes ---
      doc.rect(40, y, 515, 75).fill('#f8fafc');
      doc.rect(40, y, 515, 75).stroke('#e2e8f0');

      doc.fillColor(accentGold).font('Helvetica-Bold').fontSize(8)
        .text('IMPORTANT REGISTRAR & BILLING NOTICE', 50, y + 8);

      doc.fillColor(textMuted).font('Helvetica').fontSize(7.5)
        .text('• This order receipt is issued by WebNavi for wholesale domain procurement and management services.', 50, y + 22)
        .text('• Domain registration is executed directly via HostyIndia ICANN Accredited wholesale gateway under reseller agreement.', 50, y + 34)
        .text('• WebNavi operates on a zero-markup transparent pricing pledge. Subsequent annual domain renewal is billed at standard registry at-cost wholesale rates.', 50, y + 46)
        .text('• You retain 100% legal registrant ownership, root DNS controls, and EPP authorization codes for this domain.', 50, y + 58);

      // --- Footer ---
      const footerY = 770;
      doc.rect(40, footerY, 515, 0.75).fill('#e5e7eb');
      doc.fillColor('#9ca3af').font('Helvetica').fontSize(7.5)
        .text('WebNavi Technologies • Direct ICANN Registrar Gateway • Sovereign Architecture', 40, footerY + 8, { align: 'center', width: 515 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generates an official WebNavi Project Invoice / Payment Receipt PDF for client applications.
 */
function generateProjectInvoicePdf(app, billing) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `WebNavi Project Invoice - ${app.ticketId}`,
          Author: 'WebNavi Project Operations',
          Subject: `Project Invoice for ${app.businessName || app.fullName}`,
        },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const accentGold = '#c99a16';
      const accentGreen = '#00875a';
      const textMuted = '#4a5b53';
      const textDark = '#111827';
      const borderColor = '#d1d5db';

      // --- Header / Brand ---
      doc.rect(40, 40, 515, 60).fill('#051912');

      doc.fillColor('#ffd43b')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('WEBNAVI', 60, 52);

      doc.fillColor('#9cb1a6')
        .font('Helvetica')
        .fontSize(8.5)
        .text('Direct ICANN Registrar Gateway & Developer Cloud Infrastructure', 60, 76);

      doc.fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(14)
        .text('PROJECT INVOICE', 360, 52, { align: 'right', width: 175 });

      doc.fillColor('#ffd43b')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`INV-${app.ticketId}`, 360, 72, { align: 'right', width: 175 });

      let y = 120;

      // --- Client Details ---
      doc.fillColor(accentGold).font('Helvetica-Bold').fontSize(9).text('BILLED TO (CLIENT DETAILS)', 40, y);
      y += 14;

      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(11).text(app.fullName || 'Valued Client', 40, y);
      y += 14;

      doc.fillColor(textMuted).font('Helvetica').fontSize(9);
      if (app.businessName) {
        doc.text(app.businessName, 40, y);
        y += 12;
      }
      doc.text(`${app.city || ''}, ${app.state || ''}`, 40, y);
      y += 12;
      doc.text(`Email: ${app.email || 'N/A'} | Phone: ${app.phone || 'N/A'}`, 40, y);

      // --- Project Metadata ---
      const rightX = 340;
      let rightY = 120;
      doc.fillColor(accentGold).font('Helvetica-Bold').fontSize(9).text('PROJECT SPECIFICATIONS', rightX, rightY);
      rightY += 14;
      doc.fillColor(textMuted).font('Helvetica').fontSize(9);
      doc.text(`Ticket Reference: ${app.ticketId}`, rightX, rightY);
      rightY += 12;
      doc.text(`Preferred Domain: ${app.preferredDomain || 'Pending Selection'}`, rightX, rightY);
      rightY += 12;
      doc.text(`Lead Architects: ${app.assignedDeveloper || 'Liam & Alex'}`, rightX, rightY);
      rightY += 12;
      doc.text(`Current Stage: Stage ${app.currentStage || 1}`, rightX, rightY);

      y = Math.max(y + 20, rightY + 20);

      // --- Items Table ---
      doc.rect(40, y, 515, 20).fill('#041610');
      doc.fillColor('#ffd43b').font('Helvetica-Bold').fontSize(8);
      doc.text('LINE ITEM & SERVICE DESCRIPTION', 50, y + 6);
      doc.text('ORIGINAL', 330, y + 6, { width: 70, align: 'right' });
      doc.text('AMOUNT DUE', 435, y + 6, { width: 100, align: 'right' });

      y += 24;
      const cur = billing.currency || 'INR';

      // Item 1: Free Labor
      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(9).text('Website Design & Full Responsive Layout', 50, y);
      doc.fillColor(textMuted).font('Helvetica').fontSize(8).text('Handcrafted architecture • 100% Free Labor Pledge', 50, y + 12);
      doc.text(`${cur} ${Number(billing.designLaborOriginal || 18000).toFixed(2)}`, 330, y + 4, { width: 70, align: 'right' });
      doc.fillColor(accentGreen).font('Helvetica-Bold').fontSize(9).text(`${cur} 0.00 (Waived)`, 435, y + 4, { width: 100, align: 'right' });

      y += 32;
      doc.rect(40, y, 515, 0.5).fill(borderColor);
      y += 8;

      // Item 2: Domain
      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(9).text(`1-Year Direct Wholesale Domain Registration (${app.preferredDomain})`, 50, y);
      doc.fillColor(textMuted).font('Helvetica').fontSize(8).text('Direct ICANN wholesale registry allocation • At-Cost', 50, y + 12);
      doc.text(`${cur} ${Number(billing.domainCost || 1199).toFixed(2)}`, 435, y + 4, { width: 100, align: 'right' });

      y += 32;
      doc.rect(40, y, 515, 0.5).fill(borderColor);
      y += 8;

      // Item 3: Hosting
      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(9).text('Dedicated LiteSpeed NVMe Edge Node & Free SSL', 50, y);
      doc.fillColor(textMuted).font('Helvetica').fontSize(8).text('Direct cloud compute & Cloudflare Authoritative DNS setup', 50, y + 12);
      doc.text(`${cur} ${Number(billing.hostingCost || 1801).toFixed(2)}`, 435, y + 4, { width: 100, align: 'right' });

      y += 36;
      doc.rect(40, y, 515, 1).fill('#041610');
      y += 10;

      // Totals
      const totX = 330;
      doc.fillColor(textDark).font('Helvetica-Bold').fontSize(9).text('Total Project Cost:', totX, y);
      doc.text(`${cur} ${Number(billing.totalCost || 3000).toFixed(2)}`, 435, y, { width: 100, align: 'right' });
      y += 16;

      doc.fillColor(accentGreen).font('Helvetica-Bold').fontSize(9).text('Paid / Verified Amount:', totX, y);
      doc.text(`${cur} ${Number(billing.paidAmount || 0).toFixed(2)}`, 435, y, { width: 100, align: 'right' });
      y += 16;

      doc.fillColor(accentGold).font('Helvetica-Bold').fontSize(10).text('Remaining Balance Due:', totX, y);
      doc.text(`${cur} ${Number(billing.remainingBalance || 0).toFixed(2)}`, 435, y, { width: 100, align: 'right' });
      y += 24;

      // Verified Payments List
      if (Array.isArray(billing.payments) && billing.payments.length > 0) {
        doc.rect(40, y, 515, 18).fill('#f1f5f9');
        doc.fillColor(textDark).font('Helvetica-Bold').fontSize(8).text('VERIFIED TRANSACTIONS & RECEIPTS', 50, y + 5);
        y += 22;

        billing.payments.forEach(p => {
          doc.fillColor(textDark).font('Helvetica-Bold').fontSize(8).text(`${p.milestone} • Ref: ${p.reference || 'N/A'}`, 50, y);
          doc.fillColor(textMuted).font('Helvetica').fontSize(8).text(`${new Date(p.createdAt).toLocaleDateString('en-IN')} via ${p.paymentMethod}`, 260, y);
          doc.fillColor(accentGreen).font('Helvetica-Bold').fontSize(8).text(`${cur} ${Number(p.amount).toFixed(2)}`, 435, y, { width: 100, align: 'right' });
          y += 14;
        });
      }

      // Footer
      const footerY = 770;
      doc.rect(40, footerY, 515, 0.75).fill('#e5e7eb');
      doc.fillColor('#9ca3af').font('Helvetica').fontSize(7.5)
        .text('WebNavi Technologies • Sovereign Project Management • Direct ICANN Wholesale Gateway', 40, footerY + 8, { align: 'center', width: 515 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateInvoicePdf,
  generateProjectInvoicePdf,
};

