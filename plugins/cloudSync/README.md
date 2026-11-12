# Cloud Sync

Syncs Theme Studio (styles and replaced images), Everything Moves, Custom Background, and local friend nicknames across devices, saved under your Discord account ID on the group's Cloudflare Worker (`cloud-sync-worker/`).

Paste the group's sync key into the plugin settings once per device. Sync runs on start, a few seconds after a change, and every 5 minutes. The newest change wins per plugin. Whether a plugin is enabled, and the Theme Studio editor position, stay per device. Images over 1.9 MB stay on the device they were added on.
