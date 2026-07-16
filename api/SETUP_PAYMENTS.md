# Payment automation setup — do this once

## 1. Add environment variables in Vercel
Project → Settings → Environment Variables. Add these (never commit them to GitHub):

| Name | Value |
|---|---|
| `ZIINA_API_KEY` | Your Ziina API key |
| `ZIINA_WEBHOOK_SECRET` | A random string you make up (e.g. run `openssl rand -hex 32`). Use the SAME value in step 3 below. |
| `ZIINA_TEST_MODE` | `true` while testing, `false` (or delete) when live |
| `RESEND_API_KEY` | Your Resend API key |
| `SENDER_EMAIL` | e.g. `Bricks & Co <hello@bricksmedia.org>` — must be a domain verified in Resend |
| `SITE_URL` | `https://bricks-assessment-new.vercel.app` (or your custom domain once connected) |
| `BLUEPRINT_DRIVE_URL` | Shareable Google Drive link with the Toolkit files |
| `CONSULTATION_DRIVE_URL` | Shareable Google Drive link with the Toolkit files (same as above, or a separate folder) |
| `BOOKING_URL` | Your Calendly (or similar) link for booking the 2 consultation sessions |

## 2. Verify a sending domain in Resend
Resend needs a verified domain to send email that doesn't land in spam. Use a subdomain of bricksmedia.org (e.g. `mail.bricksmedia.org`) and add the DNS records Resend gives you.

## 3. Register the webhook with Ziina (one-time)
Run this from your own terminal — NOT in any chat, since it uses your real API key:

```bash
curl --request POST \
  --url https://api-v2.ziina.com/api/webhook \
  --header 'Authorization: Bearer YOUR_ZIINA_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "url": "https://bricks-assessment-new.vercel.app/api/ziina-webhook",
    "secret": "THE_SAME_RANDOM_STRING_YOU_PUT_IN_ZIINA_WEBHOOK_SECRET"
  }'
```

## 4. Test before going live
- Keep `ZIINA_TEST_MODE=true` and go through the full flow yourself: assessment → report → click "Get Blueprint" → pay with Ziina's test flow → confirm you receive the delivery email.
- Once confirmed working, set `ZIINA_TEST_MODE=false` (or remove it) to go live.

## What happens automatically once this is set up
1. Customer clicks "Get Blueprint" or "Book Consultation" on their report
2. They're redirected to Ziina to pay
3. Ziina calls our webhook the instant payment succeeds
4. We double-check the payment status directly with Ziina (not just trusting the webhook)
5. An email goes out automatically via Resend with their files / booking link
