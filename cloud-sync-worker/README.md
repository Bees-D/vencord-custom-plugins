# Cloud Sync Worker

Cloudflare Worker + D1 database backing the CloudSync plugin.

```sh
npx wrangler d1 create vencord-cloud-sync      # put the id in wrangler.toml
npx wrangler d1 execute vencord-cloud-sync --remote --file schema.sql
npx wrangler deploy
printf %s "<key>" | npx wrangler secret put SYNC_KEY
```

The key is never stored in this repo. Discord user IDs are public, so the key is what stops strangers from reading or overwriting someone's saved settings.
