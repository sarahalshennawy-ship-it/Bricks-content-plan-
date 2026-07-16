const crypto = require("crypto");

// Vercel gives us the raw body via req.body already parsed as an object by
// default for JSON content-type. We need the RAW string to verify the HMAC,
// so we disable the default body parser for this function.
module.exports.config = {
  api: { bodyParser: false }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signatureHeader, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

const TIER_CONTENT = {
  blueprint: {
    subject: "Your Bricks Blueprint is here 🎉",
    driveUrl: process.env.BLUEPRINT_DRIVE_URL || "REPLACE_WITH_BLUEPRINT_DRIVE_LINK",
    bookingUrl: null
  },
  consultation: {
    subject: "Welcome to your Bricks Consultation Package 🎉",
    driveUrl: process.env.CONSULTATION_DRIVE_URL || "REPLACE_WITH_CONSULTATION_DRIVE_LINK",
    bookingUrl: process.env.BOOKING_URL || "REPLACE_WITH_BOOKING_LINK"
  }
};

async function sendDeliveryEmail({ to, name, tier }) {
  const content = TIER_CONTENT[tier];
  if (!content) throw new Error(`Unknown tier: ${tier}`);

  const greeting = name ? `Hi ${name},` : "Hi,";
  const bookingLine = content.bookingUrl
    ? `<p>Book your two consultation sessions here: <a href="${content.bookingUrl}">${content.bookingUrl}</a></p>`
    : "";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#2C1F17">
      <h2>${greeting}</h2>
      <p>Thank you for your purchase! Here is everything you need to get started:</p>
      <p><a href="${content.driveUrl}" style="display:inline-block;background:#ff6b35;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Access Your Files</a></p>
      ${bookingLine}
      <p>If you have any questions, just reply to this email.</p>
      <p>— The Bricks &amp; Co Team</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.SENDER_EMAIL || "Bricks & Co <hello@bricksmedia.org>",
      to: [to],
      subject: content.subject,
      html
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers["x-hmac-signature"];

  const valid = verifySignature(rawBody, signature, process.env.ZIINA_WEBHOOK_SECRET);
  if (!valid) {
    console.error("Ziina webhook: invalid signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const paymentIntentId = event.id || event.payment_intent_id || (event.data && event.data.id);
  if (!paymentIntentId) {
    console.error("Ziina webhook: no payment intent id in payload", event);
    res.status(400).json({ error: "Missing payment intent id" });
    return;
  }

  // Defense in depth: don't trust the webhook payload's status field alone.
  // Re-fetch the payment intent directly from Ziina to confirm it actually succeeded.
  const verifyRes = await fetch(`https://api-v2.ziina.com/api/payment_intent/${paymentIntentId}`, {
    headers: { "Authorization": `Bearer ${process.env.ZIINA_API_KEY}` }
  });
  const intent = await verifyRes.json();

  if (!verifyRes.ok || intent.status !== "completed") {
    // Not a successful payment (could be a failure/cancel event) - nothing to deliver.
    res.status(200).json({ received: true, action: "ignored", status: intent.status });
    return;
  }

  let packed;
  try {
    packed = JSON.parse(intent.message);
  } catch (e) {
    console.error("Ziina webhook: could not parse packed message", intent.message);
    res.status(200).json({ received: true, action: "error", detail: "unparseable message" });
    return;
  }

  const { tier, email, name } = packed;

  try {
    await sendDeliveryEmail({ to: email, name, tier });
    res.status(200).json({ received: true, action: "delivered", tier, email });
  } catch (err) {
    console.error("Delivery email failed:", err);
    // Return 200 anyway so Ziina doesn't endlessly retry - but log loudly since
    // this means a paying customer did NOT get their files automatically.
    res.status(200).json({ received: true, action: "delivery_failed", error: String(err) });
  }
};
