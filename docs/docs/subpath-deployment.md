---
title: Serving under a subpath
sidebar_position: 7
---

# Serving TestPlanIt under a subpath

By default TestPlanIt expects to own a hostname, such as
`https://testplanit.example.com`. It can instead be served under a path on a
shared host, such as `https://example.com/testplanit`, so that other
applications keep the rest of the domain.

This page covers what is different about such an install. Everything else in
[Deploying with Docker](./deployment.md) and
[Kubernetes (Helm)](./kubernetes-deployment.md) still applies.

## How it works

The path prefix is compiled into the application at build time. Next.js
inlines it into the browser bundle, so an image built for the root cannot be
switched to a prefix with an environment variable, and an image built for one
prefix cannot serve another. A subpath install therefore needs its own image
build, with the `BASE_PATH` build argument set.

At runtime three settings must agree with that build:

| Setting                      | Root install          | Subpath install (`/testplanit`)           |
| ---------------------------- | --------------------- | ----------------------------------------- |
| `BASE_PATH` (build argument) | unset                 | `/testplanit`                             |
| `APP_URL`                    | optional              | `https://example.com/testplanit`          |
| `NEXTAUTH_URL`               | `https://example.com` | `https://example.com/testplanit/api/auth` |

`APP_URL` is the public address of the install, prefix included. Every link the
server writes (emails, webhook payloads, SAML and OAuth redirects, SCIM
locations) starts from it.

`NEXTAUTH_URL` is read by the authentication library, which takes its own
route from the path of that URL. At the root it is the origin, as before.
Under a prefix it must name the authentication route in full, ending in
`/api/auth`. If `APP_URL` is left unset the server derives it from
`NEXTAUTH_URL` by removing that suffix.

The prefix must start with `/` and must not end with one. A nested prefix such
as `/tools/testplanit` works the same way.

## Building the image

Build from the repository root with the prefix as a build argument. Both the
server and the workers image take it.

```bash
docker buildx bake -f testplanit/docker-bake.hcl selfhost \
  --set "*.args.BASE_PATH=/testplanit"
```

With Docker Compose, set `BASE_PATH` in the build environment and build
instead of pulling:

```bash
BASE_PATH=/testplanit docker compose -f docker-compose.prod.yml build
```

A malformed value fails the build with a message naming the problem.

The published Docker images run the standalone server, which carries the
build-time configuration with it. When running `next start` directly instead
(for example from a source checkout), export the same `BASE_PATH` at run time
as well: `next start` re-reads `next.config.ts`, and without the variable it
serves the prefixed build at the root.

## Docker Compose

In `.env.production`:

```bash
APP_URL="https://example.com/testplanit"
NEXTAUTH_URL="https://example.com/testplanit/api/auth"
```

Then start the stack with `--build` so the prefixed image is used. Health
checks and the maintenance page keep working: the bundled nginx forwards every
path to the application, and the application answers under the prefix.

### Bundled file storage and a prefix named `testplanit`

The bundled nginx serves the storage bucket at `/testplanit/` on the same host,
because `testplanit` is the default bucket name. That collides with an
application prefix of the same name. Choose one of:

- **Use direct S3 or another storage endpoint.** Set `AWS_PUBLIC_ENDPOINT_URL`
  to a host or route that is not under the application prefix. Nothing in
  `nginx.conf` needs to change.
- **Narrow the storage route.** Object keys always start with `uploads/`, so
  change the storage `location /testplanit/` block in `nginx.conf` to
  `location /testplanit/uploads/`. nginx picks the longest matching location,
  so file URLs keep working and every other path under `/testplanit/` reaches
  the application. The block itself carries a comment with the same
  instruction.

A prefix with a different name does not collide and needs no change.

## Kubernetes (Helm)

Point the chart at the prefixed image and set `basePath`:

```yaml
image:
  repository: registry.example.com/testplanit
  tag: 1.2.0-testplanit

appUrl: https://example.com/testplanit
basePath: /testplanit

ingress:
  host: example.com
```

The chart derives the rest: the ingress path becomes `/testplanit`, the
readiness probe becomes `/testplanit/api/health`, `NEXTAUTH_URL` gets the
`/api/auth` suffix, and the storage route stays host-rooted at
`ingress.minioPath`. Rendering fails if `appUrl` does not end with `basePath`.

## Reverse proxies and load balancers

Forward requests to the container **with the prefix intact**. The application
expects to see `/testplanit/...` on every request and answers nothing at the
root. Stripping the prefix at the proxy, which many AWS ALB and nginx examples
do by default, is the most common misconfiguration: the first page loads and
every API call and redirect then fails.

An nginx example that keeps the prefix:

```nginx
location /testplanit/ {
    proxy_pass http://testplanit:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}
```

Note the absence of a trailing path on `proxy_pass`, which is what keeps the
URI unchanged. For an AWS Application Load Balancer, use a path-pattern rule
`/testplanit/*` whose target group points at the container port, and do not
add a rewrite action.

## Clients and integrations

Give every client the full prefixed address as the server URL:

- CLI: `testplanit config set --url https://example.com/testplanit`
- MCP server: `TESTPLANIT_API_URL=https://example.com/testplanit`
- Playwright and WebdriverIO reporters, and the API client package: `baseUrl`
  with the prefix
- Jira Forge app: the instance URL field

Inbound webhook URLs, OAuth callback URLs and the SAML callback URL shown in
the admin screens already include the prefix. Register those values with the
provider as displayed.

## Cookies on a shared host

Under a prefix every cookie TestPlanIt sets is scoped to that path: the
session, CSRF and callback cookies of the authentication library, the locale
preference, the passwordless verifier, and the read-replica stickiness marker.
Another application on the same host, even one that uses the same
authentication library and cookie names, neither sees nor overwrites them.
Over HTTPS the CSRF cookie uses a `__Secure-` name instead of the `__Host-`
name used at the root, because `__Host-` cookies cannot be scoped to a path.
At the root install nothing changes.

## Checking an install

After deploying, confirm from outside the proxy that:

- `https://example.com/testplanit/api/health` returns the health document.
- `https://example.com/testplanit/` redirects to the localized sign-in page
  under the prefix, not to `https://example.com/en-US/signin`.
- Signing in lands under the prefix, and the browser's network panel shows
  every `/api/` request under `/testplanit/api/`.
- A request to `https://example.com/api/health` is **not** answered by
  TestPlanIt. If it is, the proxy is stripping the prefix.
