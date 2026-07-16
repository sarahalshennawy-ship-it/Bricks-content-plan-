// POST /api/create-payment
// Body: { tier: "blueprint" | "consultation", name: string, email: string }
// Returns: { redirect_url: string }

// Pricing in fils (1 AED = 100 fils). Update these if pricing changes.
const TIER_PRICING = {
  blueprint: { amountFils: 21900, label: "Bricks Blueprint" },      // 219 AED (~$59)
  consultation: { amountFils: 72900, label: "Bricks Consultation Package" }, // 729 AED (~$199)
  upgrade: { amountFils: 36500, label: "Consultation Upgrade" }     // 365 AED (~$99) - hidden upgrade, not linked publicly
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { tier, name, email } = req.body || {};

    if (!tier || !TIER_PRICING[tier]) {
      res.status(400).json({ error: "Invalid or missing tier" });
      return;
    }
    if (!email) {
      res.status(400).json({ error: "Missing email" });
      return;
    }

    const { amountFils, label } = TIER_PRICING[tier];
    const siteUrl = process.env.SITE_URL || "https://bricks-assessment-new.vercel.app";

    // We pack tier + email + name into the "message" field so the webhook
    // can identify who bought what once payment succeeds (Ziina's payment
    // intent object doesn't have a separate metadata field).
    const packedMessage = JSON.stringify({ tier, email, name: name || "" }).slice(0, 500);

    const ziinaRes = await fetch("https://api-v2.ziina.com/api/payment_intent", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.ZIINA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: amountFils,
        currency_code: "AED",
        message: packedMessage,
        success_url: `${siteUrl}/payment-success.html?tier=${tier}`,
        cancel_url: `${siteUrl}/`,
        failure_url: `${siteUrl}/`,
        test: process.env.ZIINA_TEST_MODE === "true"
      })
    });

    const data = await ziinaRes.json();

    if (!ziinaRes.ok) {
      console.error("Ziina payment_intent error:", data);
      res.status(502).json({ error: "Payment provider error", detail: data });
      return;
    }

    res.status(200).json({ redirect_url: data.redirect_url });
  } catch (err) {
    console.error("create-payment error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
