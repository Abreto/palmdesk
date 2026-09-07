# Container Images

The `Container Images` workflow builds two Linux x86_64 images:

- `ghcr.io/abreto/palmdesk-web`
- `ghcr.io/abreto/palmdesk-backend`

Pull requests build and check both images. Pushes to `main`, or a manual run on
`main`, publish `sha-<full-commit>` and `latest` tags using `GITHUB_TOKEN`.
Use the immutable commit tag when selecting a production release.

The web image uses the checked-out PalmDesk commit. The backend is fetched at
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
host. Builds need no production credentials. Public HTTPS and TURN are separate
deployment services; these images do not configure either service.

To build locally with Node.js 22.16+, Git, tar, and Docker:

```bash
node --test containers/test/deployment.test.mjs
node containers/prepare.mjs /tmp/palmdesk-image-context
docker build --platform linux/amd64 -f /tmp/palmdesk-image-context/backend/Dockerfile -t palmdesk-backend:local /tmp/palmdesk-image-context
docker build --platform linux/amd64 -f /tmp/palmdesk-image-context/web/Dockerfile -t palmdesk-web:local /tmp/palmdesk-image-context
```

The context path must be new. The web sources come from Git `HEAD`, so commit
frontend changes before building. No desktop application is packaged by this
workflow. Image builds and adapter tests do not replace real database,
device, mobile, or TURN integration checks.
