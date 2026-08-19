// Shared delivery logic used by BOTH the Ziina webhook (real payments) and
// create-payment.js (100%-off coupon purchases, which never touch Ziina and
// therefore never trigger the webhook). Keeping this in one shared file
// means both paths stay in sync automatically.

const crypto = require("crypto");

const CONTENT_TOOL_URL = "https://plan.bricksmedia.org";
const SITE_URL = process.env.SITE_URL || "https://bricks-assessment.vercel.app";

// Automatically issues a Content Plan Generator access code, valid for 30
// days, by calling the content generator's own issue-code endpoint. Retries
// once with a fresh random code on the rare chance of a name collision.
//
// callsAllowed is 34: 4 for the initial full 30-day plan (3 content batches
// + 1 summary), plus 30 calls of headroom so the customer can regenerate
// individual days from the calendar as often as they like without hitting
// the cap - regenerating one day is a small, cheap call, not a full re-run.
async function issueContentToolCode(attempt = 0) {
  if (attempt > 1) return null; // give up after 2 tries, deliver without the code

  const code = "BRICKS-" + crypto.randomBytes(5).toString("hex").toUpperCase();

  try {
    const res = await fetch(`${CONTENT_TOOL_URL}/api/issue-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": process.env.CONTENT_ADMIN_SECRET
      },
      body: JSON.stringify({ code, callsAllowed: 34, validDays: 30 })
    });

    if (res.status === 409) {
      return issueContentToolCode(attempt + 1);
    }
    if (!res.ok) {
      const detail = await res.text();
      console.error("issueContentToolCode failed:", res.status, detail);
      return null;
    }
    return code;
  } catch (err) {
    console.error("issueContentToolCode error:", err);
    return null;
  }
}

const TIER_CONTENT = {
  blueprint: {
    subject: "Your Bricks Blueprint is here",
    driveUrl: process.env.BLUEPRINT_DRIVE_URL || "REPLACE_WITH_BLUEPRINT_DRIVE_LINK",
    bookingUrl: null,
    includeContentTool: true
  },
  consultation: {
    subject: "Welcome to your Bricks Consultation Package",
    driveUrl: process.env.CONSULTATION_DRIVE_URL || "REPLACE_WITH_CONSULTATION_DRIVE_LINK",
    bookingUrl: process.env.BOOKING_URL || "REPLACE_WITH_BOOKING_LINK",
    includeContentTool: true
  },
  upgrade: {
    subject: "Your Bricks Consultation Upgrade is confirmed",
    driveUrl: null,
    bookingUrl: process.env.BOOKING_URL || "REPLACE_WITH_BOOKING_LINK",
    includeContentTool: false
  }
};

async function sendDeliveryEmail({ to, name, tier, contentToolCode }) {
  const content = TIER_CONTENT[tier];
  if (!content) throw new Error("Unknown tier: " + tier);

  const greeting = name ? ("Hi " + name + ",") : "Hi,";

  const filesLine = content.driveUrl
    ? '<p><a href="' + content.driveUrl + '" style="display:inline-block;background:#764ba2;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Access Your Files</a></p>'
    : "";

  const bookingLine = content.bookingUrl
    ? '<p>Book your consultation session(s) here: <a href="' + content.bookingUrl + '">' + content.bookingUrl + '</a></p>'
    : "";

  const contentToolLine = (content.includeContentTool && contentToolCode)
    ? '<div style="background:#f1ecfa;border-radius:10px;padding:16px 20px;margin:20px 0">' +
        '<p style="margin:0 0 8px 0"><b>Your AI Content Plan Generator access:</b></p>' +
        '<p style="margin:0 0 8px 0">Tool link: <a href="' + CONTENT_TOOL_URL + '">' + CONTENT_TOOL_URL + '</a></p>' +
        '<p style="margin:0">Your access code: <span style="font-family:monospace;font-size:16px;font-weight:bold;background:#fff;padding:2px 8px;border-radius:4px">' + contentToolCode + '</span></p>' +
        '<p style="margin:8px 0 0 0;font-size:12px;color:#888">This code is valid for 30 days. Generate your full 30-day plan, then regenerate any individual day as often as you like.</p>' +
      '</div>'
    : (content.includeContentTool
        ? '<p style="color:#a8402e">We\'re finishing setting up your Content Plan Generator access - you\'ll get a follow-up email with your code shortly.</p>'
        : "");

  const upgradeUpsell = (tier === "blueprint")
    ? '<div style="background:linear-gradient(135deg,#667eea,#764ba2);border-radius:14px;padding:28px 24px;margin:28px 0;text-align:center">' +
        '<p style="margin:0 0 6px 0;color:#ffd700;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Ready to go further?</p>' +
        '<p style="margin:0 0 16px 0;color:#ffffff;font-size:22px;font-weight:900;line-height:1.3">Don\'t just have the tools - have someone build the plan with you.</p>' +
        '<table role="presentation" style="margin:0 auto 18px;text-align:left" cellpadding="0" cellspacing="0">' +
          '<tr><td style="color:#ffd700;font-size:15px;padding:4px 8px 4px 0;vertical-align:top">&#10003;</td><td style="color:#ffffff;font-size:15px;padding:4px 0">A baseline strategy session (45-60 min) - we review your actual numbers together</td></tr>' +
          '<tr><td style="color:#ffd700;font-size:15px;padding:4px 8px 4px 0;vertical-align:top">&#10003;</td><td style="color:#ffffff;font-size:15px;padding:4px 0">A progress-check session 30 days later - we adjust what\'s working and fix what isn\'t</td></tr>' +
          '<tr><td style="color:#ffd700;font-size:15px;padding:4px 8px 4px 0;vertical-align:top">&#10003;</td><td style="color:#ffffff;font-size:15px;padding:4px 0">A custom action plan built specifically for your business - not generic advice</td></tr>' +
          '<tr><td style="color:#ffd700;font-size:15px;padding:4px 8px 4px 0;vertical-align:top">&#10003;</td><td style="color:#ffffff;font-size:15px;padding:4px 0">Direct access to a real strategist who already knows your toolkit results</td></tr>' +
        '</table>' +
        '<p style="margin:0 0 4px 0"><span style="color:#cbb8e8;font-size:16px;text-decoration:line-through">$199</span> <span style="color:#ffd700;font-size:30px;font-weight:900"> $50</span></p>' +
        '<p style="margin:0 0 20px 0;color:#e8ddf5;font-size:12px">Exclusive upgrade price - for Blueprint owners only</p>' +
        '<a href="' + SITE_URL + '/upgrade.html?email=' + encodeURIComponent(to) + (name ? "&name=" + encodeURIComponent(name) : "") + '" style="display:inline-block;background:#ffd700;color:#1a1a1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:900;font-size:16px">Claim My $50 Upgrade &#8594;</a>' +
      '</div>'
    : "";

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">' +
      '<h2>' + greeting + '</h2>' +
      '<p>Thank you for your purchase! Here is everything you need to get started:</p>' +
      filesLine +
      contentToolLine +
      upgradeUpsell +
      bookingLine +
      '<p>If you have any questions, just reply to this email.</p>' +
      '<p>- The Bricks Team</p>' +
    '</div>';

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.SENDER_EMAIL || "Bricks <hello@bricksmedia.org>",
      to: [to],
      subject: content.subject,
      html: html
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("Resend error: " + err);
  }
}

async function deliverPurchase(opts) {
  const email = opts.email, name = opts.name, tier = opts.tier;
  let contentToolCode = null;
  if (TIER_CONTENT[tier] && TIER_CONTENT[tier].includeContentTool) {
    contentToolCode = await issueContentToolCode();
    if (!contentToolCode) {
      console.error("Could not auto-issue content tool code for " + email + " (tier: " + tier + ") - manual follow-up needed via admin.html");
    }
  }
  await sendDeliveryEmail({ to: email, name: name, tier: tier, contentToolCode: contentToolCode });
  return contentToolCode;
}

module.exports = { issueContentToolCode, sendDeliveryEmail, deliverPurchase, TIER_CONTENT, CONTENT_TOOL_URL };
