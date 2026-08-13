// Reusable order-status email templates.
//
// IMPORTANT: nothing in this file is wired to any webhook or endpoint yet.
// These are template builders only — call sites will be added once the
// Stripe webhook's order handling and Printify fulfillment are both
// confirmed working end-to-end. Do not import this from stripe-webhook.js
// until that's true.
//
// Each export takes plain order data and returns { subject, html, text } —
// pass the result straight into sendEmail() from ./resend.js.
//
// Kept deliberately simple for email-client compatibility: inline styles
// only (no <style> block, no external CSS), system font stack, single
// column, absolute image URLs.

const BRAND = {
  name: 'The DeAngelo Series',
  black: '#0A0A0A',
  bone: '#F5F5F1',
  muted: '#6b6b66',
  siteUrl: 'https://thedeangeloseries.com',
};

function layout({ preheader, bodyHtml }) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bone};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || '')}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bone};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e5e4dd;">
        <tr><td style="background:${BRAND.black};padding:28px 32px;text-align:center;">
          <span style="color:${BRAND.bone};font-size:13px;letter-spacing:.3em;text-transform:uppercase;">${BRAND.name}</span>
        </td></tr>
        <tr><td style="padding:32px;color:${BRAND.black};font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e5e4dd;color:${BRAND.muted};font-size:12px;">
          Questions? Reply to this email or contact support.<br>
          <a href="${BRAND.siteUrl}" style="color:${BRAND.muted};">${BRAND.siteUrl.replace('https://', '')}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function lineItemsHtml(items = []) {
  return items.map((it) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(it.name)} — Size ${escapeHtml(it.size)} &times; ${escapeHtml(it.quantity)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(it.amount)}</td>
    </tr>`).join('');
}

/**
 * Order received — sent as soon as payment is verified and the order is
 * safely stored in D1. Deliberately NOT gated on Printify order creation —
 * a customer whose card was charged must always get this, whether or not
 * fulfillment can start immediately. "Received," not "confirmed"/"in
 * production" — production is a separate email (inProductionTemplate) sent
 * only once Printify actually reports it.
 * @param {{orderNumber:string, customerName?:string, items:Array<{name:string,size:string,quantity:number,amount:string}>, total:string}} order
 */
export function orderConfirmedTemplate(order) {
  const greeting = order.customerName ? `Hi ${escapeHtml(order.customerName)},` : 'Hi,';
  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 20px;">We've received your order <strong>${escapeHtml(order.orderNumber)}</strong>.</p>
    <table role="presentation" width="100%" style="margin:0 0 20px;font-size:14px;">
      ${lineItemsHtml(order.items)}
      <tr><td style="padding-top:12px;font-weight:600;">Total</td><td style="padding-top:12px;font-weight:600;text-align:right;">${escapeHtml(order.total)}</td></tr>
    </table>
    <p style="margin:0;color:${BRAND.muted};">We'll email you again once your piece enters production.</p>
  `;
  return {
    subject: `Order received — ${order.orderNumber}`,
    html: layout({ preheader: `Order ${order.orderNumber} received`, bodyHtml }),
    text: `${greeting}\n\nWe've received your order ${order.orderNumber}.\n\nTotal: ${order.total}\n\nWe'll email you again once your piece enters production.`,
  };
}

/**
 * Internal support alert — sent to SUPPORT_EMAIL (not the customer) when
 * Printify order creation fails after a payment has already succeeded. The
 * customer still gets their "order received" email regardless; this is
 * purely so a human notices the order needs manual attention.
 * @param {{orderNumber:string, reason:string, orderId:string}} info
 */
export function printifyFailureAlertTemplate(info) {
  const bodyHtml = `
    <p style="margin:0 0 16px;">Printify order creation failed for a paid order.</p>
    <p style="margin:0 0 8px;"><strong>Order:</strong> ${escapeHtml(info.orderNumber)}</p>
    <p style="margin:0 0 8px;"><strong>Order ID:</strong> ${escapeHtml(info.orderId)}</p>
    <p style="margin:0 0 20px;"><strong>Reason:</strong> ${escapeHtml(info.reason)}</p>
    <p style="margin:0;color:${BRAND.muted};">The customer has already received their order-received email. This order needs manual Printify fulfillment, or a fix to the product/variant mapping followed by the reconciliation script.</p>
  `;
  return {
    subject: `[Action needed] Printify order creation failed — ${info.orderNumber}`,
    html: layout({ preheader: `Printify failed for ${info.orderNumber}`, bodyHtml }),
    text: `Printify order creation failed for a paid order.\n\nOrder: ${info.orderNumber}\nOrder ID: ${info.orderId}\nReason: ${info.reason}\n\nThe customer has already received their order-received email. This order needs manual Printify fulfillment, or a fix to the product/variant mapping followed by the reconciliation script.`,
  };
}

/**
 * In production — sent when Printify (or manual fulfillment) begins making the piece.
 * @param {{orderNumber:string, customerName?:string, estimateNote?:string}} order
 */
export function inProductionTemplate(order) {
  const greeting = order.customerName ? `Hi ${escapeHtml(order.customerName)},` : 'Hi,';
  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 20px;">Your order <strong>${escapeHtml(order.orderNumber)}</strong> is now in production.</p>
    ${order.estimateNote ? `<p style="margin:0 0 20px;color:${BRAND.muted};">${escapeHtml(order.estimateNote)}</p>` : ''}
    <p style="margin:0;color:${BRAND.muted};">We'll send tracking as soon as it ships.</p>
  `;
  return {
    subject: `Your piece is in production — ${order.orderNumber}`,
    html: layout({ preheader: `Order ${order.orderNumber} is in production`, bodyHtml }),
    text: `${greeting}\n\nYour order ${order.orderNumber} is now in production.\n${order.estimateNote || ''}\n\nWe'll send tracking as soon as it ships.`,
  };
}

/**
 * Shipped — sent when Printify reports a tracking number.
 * @param {{orderNumber:string, customerName?:string, carrier:string, trackingNumber:string, trackingUrl:string}} order
 */
export function shippedTemplate(order) {
  const greeting = order.customerName ? `Hi ${escapeHtml(order.customerName)},` : 'Hi,';
  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 20px;">Your order <strong>${escapeHtml(order.orderNumber)}</strong> has shipped.</p>
    <p style="margin:0 0 8px;"><strong>Carrier:</strong> ${escapeHtml(order.carrier)}</p>
    <p style="margin:0 0 20px;"><strong>Tracking:</strong> ${escapeHtml(order.trackingNumber)}</p>
    <p style="margin:0 0 20px;">
      <a href="${escapeHtml(order.trackingUrl)}" style="display:inline-block;background:${BRAND.black};color:${BRAND.bone};padding:12px 24px;text-decoration:none;font-size:13px;letter-spacing:.1em;">Track your package</a>
    </p>
  `;
  return {
    subject: `Your order has shipped — ${order.orderNumber}`,
    html: layout({ preheader: `Order ${order.orderNumber} has shipped`, bodyHtml }),
    text: `${greeting}\n\nYour order ${order.orderNumber} has shipped.\n\nCarrier: ${order.carrier}\nTracking: ${order.trackingNumber}\n${order.trackingUrl}`,
  };
}

/**
 * Delivered — sent when the carrier confirms delivery.
 * @param {{orderNumber:string, customerName?:string}} order
 */
export function deliveredTemplate(order) {
  const greeting = order.customerName ? `Hi ${escapeHtml(order.customerName)},` : 'Hi,';
  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 20px;">Your order <strong>${escapeHtml(order.orderNumber)}</strong> has been delivered.</p>
    <p style="margin:0;color:${BRAND.muted};">All sales are final. Damage, manufacturing-defect, or incorrect-item claims must be submitted within 7 days of delivery and are subject to review — just reply to this email.</p>
  `;
  return {
    subject: `Delivered — ${order.orderNumber}`,
    html: layout({ preheader: `Order ${order.orderNumber} delivered`, bodyHtml }),
    text: `${greeting}\n\nYour order ${order.orderNumber} has been delivered.\n\nAll sales are final. Damage, manufacturing-defect, or incorrect-item claims must be submitted within 7 days of delivery and are subject to review — just reply to this email.`,
  };
}
