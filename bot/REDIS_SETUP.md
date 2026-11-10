# @Cudyapp: enabling shared Redis state (Vercel)

Current production project: `cudyapp-community-bot`.
Target chat: `-1003834368989`; target topic: `87621`.
Bot-token secret is already configured. **Do not replace or disclose it.**

## Current status (2026-11-10)

- Telegram webhook and delete permissions were verified with Telegram API.
- One user-authorized message (87846) was successfully deleted.
- No Redis integration or Redis environment variables are present in Vercel.
- Consequently, reactions and anti-flood are *inactive*; profanity/insult deletion can still operate without Redis.
- No automatic bans/mutes. Trigger list remains empty.

## Create storage

Use Vercel dashboard → project `cudyapp-community-bot` → **Storage / Marketplace** → **Upstash for Redis**.
Select the free plan if available, review provider terms before accepting, provision a dedicated database (suggested name: `cudyapp-moderation`) and connect *only this project* for the **Production** environment.

The current implementation expects **both** exact names:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

If the integration creates different names, map their values to those names using Vercel **Sensitive** project environment variables. Never place credentials in GitHub, an issue, a chat message, a log, or a local unencrypted file.

## Activation and verification

1. Verify the Redis integration belongs to the correct Vercel project and Production only.
2. Confirm both environment variables exist, without displaying their values.
3. Run existing Node tests before deployment.
4. Deploy the tested application to Production and check READY.
5. Confirm the webhook URL remains `https://cudyapp-community-bot.vercel.app/api/webhook`; do not re-register Telegram or alter release workflows.
6. Check only the intended forum topic. First verify normal messages are unaffected, then test a limited sequence of seven benign messages from an authorized test account. The seventh message within a rolling 20 seconds should be removed (threshold: 6), with a rate-limited warning.
7. Confirm other topics are ignored and empty triggers never elicit reactions.
8. Check errors and latency without logging message content or secrets.

## Failure behavior and maintenance

If Redis is absent or cannot be reached, **anti-flood and reactions do not run**. The bot never bans or mutes users. Its content-based profanity/insult moderation is a separate feature; disable it in `bot/config.json` if needed.

Only short-lived opaque Redis counters/deduplication keys should be stored (with TTL). Do not store raw user message text.

Existing Vercel deployment is **not** automatically updated from this repo. Publishing a GitHub PR/merge by itself does not update the live bot.

## Billing and permissions

Installing Marketplace storage can require accepting provider terms and choosing billing. Do not authorize a paid plan without the project owner's explicit permission. If the integration cannot be installed with current account permissions, keep production unchanged until the owner connects it.
