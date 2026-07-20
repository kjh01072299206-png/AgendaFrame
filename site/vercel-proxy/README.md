# AgendaFrame Vercel edge proxy

This deployment keeps the production AgendaFrame application and its D1/R2
bindings on the existing Sites runtime. Vercel provides a stable public edge
URL and forwards every path, query string, API request, and admin route to that
validated origin.

This is intentionally a proxy deployment, not a database or object-storage
migration. A native Vercel migration would require replacing Cloudflare D1,
R2, Worker bindings, and the current deployment pipeline.

## Custom domain

The intended canonical domain is `agendaframe.com`, with
`www.agendaframe.com` redirected to the apex domain. Add both domains to this
Vercel project after registration, apply the DNS records Vercel reports, and
set `NEXT_PUBLIC_SITE_URL=https://agendaframe.com` on the Sites production
build. The application worker already accepts these exact origins for
authenticated admin requests.
