# Container Images

The `Container Images` workflow builds two Linux x86_64 images:

- `ghcr.io/abreto/tenori-web`
- `ghcr.io/abreto/tenori-backend`

Pull requests build and check both images. Pushes to `main`, or a manual run on
`main`, publish `sha-<full-commit>` and `latest` tags using `GITHUB_TOKEN`.
Use the immutable commit tag when selecting a production release.

## Migration from PalmDesk

The v0.0.9 preview renames the images to `ghcr.io/abreto/tenori-web` and
`ghcr.io/abreto/tenori-backend`. Existing `ghcr.io/abreto/palmdesk-web` and
`ghcr.io/abreto/palmdesk-backend` images and their published tags remain available
during the transition; the renamed workflow publishes future builds only under
`tenori-*`. Existing deployments can keep using their pinned old image tags until
they deliberately switch. New image publication and deployment are separate
operator actions; this rename does not publish images or update a running service.

When switching, update both image references to the same commit tag. Keep the
existing MySQL database/user, Redis, secrets, volumes and service configuration.
No database rename or data migration is required. The existing `palmdesk:*`
Redis keys are retained for compatibility. Keep
`NODE_APP_RELEASE_PROJECT_NAME=palmdesk-server` (or your existing custom value):
the pinned upstream backend derives its device Redis keys from this variable,
so it remains a storage namespace rather than adopting the new product name.

The new official address is `https://tenori.abreto.icu`. During the transition,
serve `https://palmdesk.abreto.icu` from the same web frontend and backend without
redirecting API or WebSocket requests. Use this backend configuration, retaining
any other explicitly allowed origins:

```dotenv
PUBLIC_ORIGIN=https://tenori.abreto.icu
EXTRA_ALLOWED_ORIGINS=https://palmdesk.abreto.icu
ALLOW_ELECTRON_ORIGIN=true
```

Both hostnames need DNS, HTTPS certificates and routing for `/`, `/api/` and
`/socket.io/` (including WebSocket Upgrade) to the same deployment and single
backend process. Abreto adds the new DNS record in Cloudflare and confirms both
hosts before release. Keep the old hostname active for existing apps, bookmarks
and QR invitations. Browser clients use the origin they were opened on, while
new desktop packages default to Tenori; explicit saved service overrides still
take priority. Browser storage is per origin, so users may need to reconnect and
reapply preferences on the new hostname. Verify old/new host-controller pairings
and TURN on physical devices before retiring the alias. See the
[service configuration guide](../docs/SERVICE_CONFIGURATION.md).

## Builds and configuration

The web image uses the checked-out Tenori commit. The backend is fetched at
the exact commit in `backend.lock.json`. Its deployment adapter exposes device
routes and remote-desktop signaling, and preserves existing database tables
during initialization. The backend still requires MySQL and Redis.

`ALLOW_ELECTRON_ORIGIN=true` (the default) permits the exact `null` and
`file://` origins used by packaged Electron HTTP requests and WebSocket
upgrades. Setting it to `false` rejects both; other origins must match the
configured web origins. This compatibility setting is not authentication.

After the first publish, set each package's visibility to **Public** in its
GitHub package settings to allow anonymous pulls from a VPS. Container packages
are initially private even when their source repository is public.

The production Compose configuration, `.env`, database passwords, Tunnel
credentials, TURN credentials, and persistent data remain on the deployment
host. Builds need no production credentials. Public HTTPS is configured on the
deployment host. The backend can issue Cloudflare or coturn credentials at runtime;
see [turn.env.example](backend/turn.env.example) and the
[service configuration guide](../docs/SERVICE_CONFIGURATION.md#turn).
The default `TURN_PROVIDER=none` permits local direct-connection development.
Remote sessions currently require one backend process; Redis alone does not
provide multi-process Socket.IO routing.

To build locally with Node.js 22.16+, Git, tar, and Docker:

```bash
node --test containers/test/*.test.mjs
node containers/prepare.mjs /tmp/tenori-image-context
docker build --platform linux/amd64 -f /tmp/tenori-image-context/backend/Dockerfile -t tenori-backend:local /tmp/tenori-image-context
docker build --platform linux/amd64 -f /tmp/tenori-image-context/web/Dockerfile -t tenori-web:local /tmp/tenori-image-context
```

The context path must be new. The web sources come from Git `HEAD`, so commit
frontend changes before building. No desktop application is packaged by this
workflow. Image builds and adapter tests do not replace real database,
device, mobile, or TURN integration checks.
