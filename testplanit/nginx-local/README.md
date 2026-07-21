# Local nginx overrides

This directory is bind-mounted into the nginx container at `/etc/nginx/local`
(see the `nginx` service in `docker-compose.prod.yml`), and `nginx.conf` loads
every `*.conf` here via:

```nginx
include /etc/nginx/local/*.conf;
```

Use it for **per-deployment** nginx config that should not be committed —
typically custom, branded error pages. Everything here is gitignored **except**
this README and any `*.example` file, so your customizations survive
`git pull` and container rebuilds without living in version control.

> The include does **not** enable `proxy_intercept_errors`. An included file can
> therefore only restyle errors nginx generates itself — chiefly **502 / 504**
> (shown when the app is down or redeploying) and any nginx-level 404/500.
> Responses proxied from the app (its own 404/500, API routes, RSC/data fetches,
> missing assets) pass through untouched. `503` is reserved for maintenance mode.

## Custom error pages — quick start

1. Copy the example config into an active one (the `.example` suffix is inert;
   only real `*.conf` files are loaded):

   ```bash
   cp nginx-local/error-pages.conf.example nginx-local/error-pages.conf
   ```

2. Drop your self-contained HTML pages in `nginx-local/error-pages/`. The example
   expects `404.html`, `500.html`, and `502.html`. Make them **fully
   self-contained** (inline CSS/SVG, no dependency on the app being up — a 502
   page is shown precisely when the app is down).

3. Apply — nginx uses a bind mount, so no image rebuild is needed:

   ```bash
   docker compose -f docker-compose.prod.yml up -d --force-recreate nginx
   ```

To verify the config parses before reloading:

```bash
docker exec testplanit-nginx nginx -t
```
