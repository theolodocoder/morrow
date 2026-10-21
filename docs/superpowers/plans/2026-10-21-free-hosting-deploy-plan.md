# Morrow on free hosting — deploy plan

Date: 2026-10-21 · Status: approved direction (owner answers recorded below) · Constraint from the owner: everything on free plans.

Facts were checked against providers' own pages in October 2026 (sources at the end); free tiers change often, so re-check before signing up. [J] marks judgement rather than verified fact.

## Why most free platforms don't fit

Morrow's live-editing service (`apps/collab`) keeps long-lived WebSocket connections and each document's live session in memory. It must be **one always-on process** that never sleeps. Most free plans sleep (Render after 15 min idle, Koyeb scale-to-zero), cap hours (Render 750 h shared across services), cap connection length (Cloud Run 60 min), or have no free tier at all (Fly.io, Railway, Cloudflare Containers). The API also polls Postgres every second (the notification outbox), which keeps scale-to-zero databases (Neon, Supabase) awake and burns their free compute by mid-month.

## Recommendation: one Oracle Cloud "Always Free" VM [J]

One Ampere A1 VM (2 OCPU / 12 GB RAM, 100 GB disk, 10 TB/month egress) running everything with Docker Compose:

| Container   | Role                                                                                                                           | Public?                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Caddy       | HTTPS (automatic Let's Encrypt), routes `morrow.<domain>` → web, `collab.<domain>` → collab (WebSockets proxied automatically) | ports 80/443 only                   |
| web         | `next build` / `next start`                                                                                                    | via Caddy                           |
| api         | Fastify (`node --import tsx src/main.ts`)                                                                                      | internal only                       |
| collab      | Hocuspocus                                                                                                                     | via Caddy (`wss://collab.<domain>`) |
| postgres:18 | database, persistent volume                                                                                                    | internal only                       |
| migrate     | one-shot `pnpm --filter @morrow/db migrate` before api starts                                                                  | —                                   |

Rough ceiling before paying [J, untested — confirm with the repo's load-test]: ~50–150 simultaneous editors and a few hundred concurrent readers on 2 OCPU; one document is capped at 200 live connections; voice rooms ≤ 8 speakers (mesh).

**Risks you accept on this plan**

- Oracle needs a real credit/debit card at sign-up (prepaid/virtual cards rejected) but charges nothing on Always Free.
- Oracle halved the free A1 allowance in 2026 without notice; it can change again.
- Oracle may reclaim an idle VM (CPU, network and memory all < 20% for 7 days) and close accounts unused for 30 days — real traffic avoids this.
- "Out of host capacity" when creating the VM is common; you may need to retry or pick another home region (the home region can't be changed later).
- Single machine: a VM failure takes the site down until restored. Writing is never lost (Postgres + device copies), but there's downtime.
- You run Postgres yourself: backups and upgrades are on us.

**Other free services used**

- **Cloudflare (free):** DNS; R2 object storage (10 GB free) for nightly database backups; TURN for voice rooms (first 1,000 GB free per their docs). Keep the `collab` DNS record "DNS only" (grey cloud) so Cloudflare's proxy doesn't time out idle WebSockets.
- **Resend (free):** 3,000 emails/month, 100/day — needs a domain you control to verify.
- **Uptime monitoring:** UptimeRobot / StatusCake / Better Stack free tiers (check each one's commercial-use terms).
- **Not needed yet:** Redis (Upstash free 256 MB when we add multi-instance collab or shared rate limits).

**Domain — free (owner: buy nothing):** start on a free DigitalPlat name (e.g. `morrow.dpdns.org`, GitHub sign-up; delegate its nameservers to Cloudflare's free DNS so Resend can verify it), and apply for a free `eu.org` name in parallel as the longer-lived home (manual approval can take weeks–months; switching later is one env change + a redirect). DuckDNS works for the site but not for email (one TXT record only). Caveats: free-domain providers can pause or disappear, and some mail filters trust free domains less.

## Alternatives considered

- **B. Vercel Hobby (web) + the Oracle VM (api, collab, db).** Frees VM resources, but Vercel Hobby is **non-commercial only** (any financial gain, including a paid developer), has only 4 Active-CPU-hours/month (every Morrow page renders on demand), no stable egress IPs (breaks our trusted-proxy rate limiting), and can't connect repos owned by a Git organisation. Only if the VM becomes the bottleneck.
- **C. Vercel + Render free + Neon/Supabase.** Fine for a short demo, not for real users: collab sleeps after 15 min and wakes in ~1 min (editors disconnected), Render's 750 h covers only one always-on service, free databases pause, expire (Render: 30 days) or run out of compute.

## Work needed in the repo first (code tasks)

1. **Dockerfiles** for web, api, collab (and a migrate image) — none exist today. Node 22+, pnpm workspace, arm64 images.
2. **`docker-compose.prod.yml` + `Caddyfile`** with memory limits (≈ postgres 2 GB, web 1.5 GB, api 1 GB, collab 1.5 GB), `restart: unless-stopped`, health checks, start order postgres → migrate → api → collab → web (API before web is required by the reading-experience branch).
3. **`TRUSTED_PROXIES`** set to the Docker network so rate limits see the real client IP through Caddy → web → api (test it).
4. **Backups:** nightly `pg_dump -Fc | gzip` → R2 via rclone, keep 14 days; plus Oracle boot-volume backups (5 free); a monthly restore test (the collab `backup-check` CLI helps).
5. **Deploy workflow:** GitHub Actions → SSH → `git pull`, build on the VM, `docker compose up -d`. Deploy off-peak: restarting collab disconnects live editors for a few seconds (nothing is lost; they reconnect and resync).
6. **Before ever moving to a managed free database:** make the 1-second outbox poll interval configurable (or event-driven), or it will exhaust Neon's free compute.

## Step by step (once the repo work lands)

1. Create accounts: Oracle Cloud (card, never charged on Always Free), Cloudflare, Resend, GitHub (already), an uptime monitor. Register a free DigitalPlat name and point its nameservers at Cloudflare; apply for an eu.org name.
2. Create the VM: `VM.Standard.A1.Flex`, 2 OCPU / 12 GB, Ubuntu (arm64), 100 GB boot volume. Open TCP 80/443 in the VCN security list **and** in the VM's iptables (Oracle's Ubuntu images block them by default). Install Docker; enable unattended upgrades; Docker log rotation.
3. DNS: `A morrow.<domain>` and `A collab.<domain>` → the VM's public IP (DNS only).
4. Secrets on the VM (`.env.production`, never committed): `DATABASE_URL`, `AUTH_SECRET`, `TICKET_SECRET`, `INTERNAL_SECRET` (each `openssl rand -base64 48`), `WEB_ORIGIN=https://morrow.<domain>`, `COLLAB_PUBLIC_URL=wss://collab.<domain>`, `COLLAB_INTERNAL_URL=http://collab:4001`, `API_INTERNAL_URL=http://api:4000`, `ALLOWED_ORIGINS=https://morrow.<domain>`, `SITE_URL`, `TRUSTED_PROXIES`, `RESEND_API_KEY`, `EMAIL_FROM`, `BILLING_ENABLED=false`, rate-limit vars, `NEXT_PUBLIC_ICE_SERVERS` (Cloudflare TURN; build-time, so rebuild web when it changes).
5. First deploy: `docker compose -f docker-compose.prod.yml up -d --build` → migrate runs → api → collab → web. Smoke-test: sign up, write, publish, read signed-out, invite, live co-write.
6. Turn on backups and uptime checks (web `/`, API health, a WebSocket check on collab). Add a disk-usage alert.

## When we outgrow free (in order)

1. A second small paid server or managed Postgres with point-in-time recovery (removes the single point of failure).
2. Cloudflare in front of web (caching, DDoS) — free, once caching rules are set.
3. Redis (Upstash) when collab runs on several instances (live fan-out) and for shared rate limits.
4. A media server (e.g. LiveKit) if voice rooms need more than 8 speakers.

## Owner decisions (2026-10-21)

- Morrow is **non-commercial for now** — Vercel Hobby stays allowed as a fallback for the web app (alternative B) if the VM becomes the bottleneck. Revisit when anything earns money.
- **No purchases at all** — use a free domain (DigitalPlat now, eu.org applied for in parallel). Morrow will be posted publicly for people to try (non-commercial showcase).
- **Yes** to putting a card on the Oracle account (Always Free charges nothing).

## Sources

Oracle Always Free: docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm; allowance cut: infoq.com/news/2026/07/oracle-cloud-free-tier-limits/, linuxiac.com (Oracle quietly cuts free tier Ampere A1). Render: render.com/docs/free. Koyeb: koyeb.com/docs/reference/instances, koyeb.com/blog (Feb 2026 sign-up change). Fly.io: docs.fly.io/about/pricing. Railway: docs.railway.com/reference/pricing/free-trial. Google Cloud: docs.cloud.google.com/free/docs/free-cloud-features, …/run/docs/triggering/websockets. Cloudflare: developers.cloudflare.com/workers/platform/limits, /containers/pricing, /durable-objects/platform/pricing, /realtime/turn/faq, /r2/pricing, /network/websockets. Vercel: vercel.com/docs/plans/hobby, /limits/fair-use-guidelines, /limits/overview. Netlify: netlify.com/changelog (credit-based plans). Neon: neon.com/faqs/free-plan-limits-and-quotas. Supabase: supabase.com/pricing. Aiven: aiven.io/docs/platform/concepts/free-plan. Upstash: upstash.com/pricing/redis. Metered: metered.ca/pricing. Resend: resend.com/pricing. Uptime monitors: check each provider's terms.
