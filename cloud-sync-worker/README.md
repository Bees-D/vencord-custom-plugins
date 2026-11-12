# Cloud Sync Worker

Cloudflare Worker + D1 database backing the CloudSync plugin.

```sh
npx wrangler d1 create vencord-cloud-sync      # put the id in wrangler.toml
npx wrangler d1 execute vencord-cloud-sync --remote --file schema.sql
npx wrangler deploy
```

There is no login: data is stored under each Discord user ID. To require a shared key later, run `npx wrangler secret put SYNC_KEY` and send it as the `X-Sync-Key` header.
