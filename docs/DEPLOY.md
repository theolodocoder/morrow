# Deploying Morrow (one free Oracle Cloud VM)

Everything runs on one Oracle Cloud "Always Free" Ampere VM with Docker Compose. Caddy serves HTTPS and routes
`https://<domain>` to the web app and `wss://collab.<domain>` to live editing. The API, collab and Postgres are
not reachable from the internet. Why this shape, and what we gave up for "free": `docs/superpowers/plans/2026-10-21-free-hosting-deploy-plan.md`.

| File                                    | What it is                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `docker-compose.prod.yml`               | caddy, postgres, migrate (one-shot), api, collab, web; admin via a profile |
| `apps/{web,api,collab}/Dockerfile`      | the images (`apps/api/Dockerfile --target migrate` is the migration job)   |
| `deploy/Caddyfile`                      | HTTPS, routing, HSTS, WebSocket-friendly timeouts                          |
| `deploy/.env.production.example`        | every setting, with comments; copy to `.env.production` on the server      |
| `deploy/backup.sh`, `deploy/restore.md` | nightly dump to Cloudflare R2, how to restore and test it                  |
| `.github/workflows/deploy.yml`          | manual deploy over SSH plus a smoke check                                  |

Every compose command needs the env file:

```sh
c() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }   # put it in ~/.bashrc
```

## 1. Accounts (all free)

Oracle Cloud (needs a real credit or debit card; Always Free never charges it), Cloudflare, Resend, an uptime
monitor (UptimeRobot, StatusCake or Better Stack), and GitHub (already have it).

## 2. Create the VM

1. Oracle console → Compute → Instances → Create. Image: **Canonical Ubuntu 24.04 (aarch64)**. Shape:
   **VM.Standard.A1.Flex**, **2 OCPU / 12 GB**. Boot volume **100 GB**. Add your SSH public key.
   If you get "Out of host capacity", retry later or try another availability domain. The home region can't be changed.
2. Open the ports. **The VCN security list is the real firewall**: VCN → Security Lists → default → Ingress:
   TCP **80** and **443** from `0.0.0.0/0`. Leave 22 as it is. Nothing else should be open.
   - Don't edit the VM's iptables for this. Ports published by Docker are DNATed through the `FORWARD` chain, which
     Docker manages. The image's `INPUT` rules (and `ufw`) don't apply to them, in either direction: they don't
     block them, and they don't protect them. So **never add `ports:` to a service without a `127.0.0.1:` prefix**
     (the admin console does this right). Otherwise the service is on the internet, whatever ufw says.
   - Never run `netfilter-persistent save` after Docker is installed. It would freeze Docker's dynamic rules into
     `/etc/iptables/rules.v4`, and they'd clash on the next boot. If you need host firewall changes, make them
     before installing Docker.
   - After the first deploy, check from another machine that `https://<domain>` answers. If it doesn't,
     `sudo iptables -L FORWARD -n --line-numbers` should show Docker's chains above Oracle's final `REJECT`.
3. Add 4 GB of swap. It's a safety net for `next build` while the site is running:
   ```sh
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
4. Install Docker and security updates:
   ```sh
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER            # log out and back in
   sudo apt-get install -y unattended-upgrades rclone && sudo dpkg-reconfigure -plow unattended-upgrades
   ```
   Container logs rotate already (10 MB × 5 per service, set in the compose file).
5. Oracle may reclaim a VM that stays idle (CPU, network and memory all under 20% for 7 days). Real traffic avoids
   that. An account unused for 30 days can be closed, so log in now and then.

## 3. Free domain and DNS

1. Register a free name at DigitalPlat (a `<name>.dpdns.org` subdomain; sign in with GitHub). In parallel, apply for an
   `eu.org` name as the long-term home. Approval takes weeks to months; switching later is one env change plus a
   rebuild.
2. Add the domain to Cloudflare (free plan) and set the nameservers DigitalPlat shows to Cloudflare's.
3. In Cloudflare DNS, add two records, both **DNS only (grey cloud)**. Cloudflare's proxy would time out idle
   WebSockets and get in the way of Let's Encrypt:
   - `A  <domain>         → <VM public IP>`
   - `A  collab.<domain>  → <VM public IP>`

## 4. Email (Resend)

Resend → Domains → add `<domain>` and add the DNS records it lists (SPF/DKIM TXT, MX for bounces) in Cloudflare.
Once it shows verified, create an API key (sending access only) and set `RESEND_API_KEY` and
`EMAIL_FROM="Morrow <hello@<domain>>"`. The free plan allows 3,000 emails a month, 100 a day. Without a key,
Morrow sends no email, and invitations still work by link.

## 5. Voice rooms: STUN now, TURN later

Voice rooms are peer to peer (at most 8 speakers). The template's default,
`NEXT_PUBLIC_ICE_SERVERS=[{"urls":"stun:stun.cloudflare.com:3478"}]`, uses Cloudflare's free STUN server. That's
enough for most home and office networks. Peers behind strict NATs (some mobile carriers, corporate networks) need
a TURN relay, and they can't join voice until we add one.

**Don't put TURN credentials in `NEXT_PUBLIC_ICE_SERVERS`.** The value is inlined into public JavaScript when the web
image is built. Anyone could copy the credentials and relay their own traffic through our TURN quota. Cloudflare
Realtime TURN credentials also expire, and voice would quietly break when they did.

The follow-up (not built yet): a signed-in, rate-limited `POST /api/v1/voice/ice-servers` that calls Cloudflare's
`POST https://rtc.live.cloudflare.com/v1/turn/keys/<key id>/credentials/generate` server-side with a ~4 h TTL. The
TURN key id and API token stay in the API's env, and the browser fetches fresh `iceServers` when it joins a room. Until
then, any change to `NEXT_PUBLIC_ICE_SERVERS` needs a rebuild (`c up -d --build`).

## 6. First deploy

```sh
git clone https://github.com/<owner>/morrow.git ~/morrow && cd ~/morrow
cp deploy/.env.production.example .env.production && chmod 600 .env.production
nano .env.production       # MORROW_DOMAIN, the secrets, email, ICE servers, backups
c up -d --build --wait     # first build ≈ 10–15 min on 2 OCPU; postgres → migrate → api → collab → web → caddy
c ps                       # everything healthy; migrate "Exited (0)"
```

Generate secrets with `openssl rand -base64 48`, and `POSTGRES_PASSWORD` with `openssl rand -hex 32` (it goes
into a URL). Caddy gets the Let's Encrypt certificates on first start. Keep the `caddy_data` volume, or a
re-issue can run into Let's Encrypt's rate limits.

Then check it by hand: sign up, create a work, type, publish, open the public link in a private window, invite a
second account and write together.

Staff console (optional): `c --profile admin up -d --build admin`. It's never exposed publicly. Open it through
an SSH tunnel with `ssh -L 3002:127.0.0.1:3002 <vm>`, then go to http://localhost:3002. Staff need two-factor.

### Later deploys

GitHub → Actions → **deploy** → Run workflow → the ref. It SSHes in and checks out the ref. If backups are
configured, it takes a fresh dump (`deploy/backup.sh`) before migrations can run. Then it runs `up -d --build --wait`,
prunes old images, then checks `https://<domain>/`, `/api/auth/ok` (web → api) and
`https://collab.<domain>/healthz` from outside. One-time setup: create a deploy key pair, put the public half in
the VM user's `~/.ssh/authorized_keys`, and add secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
`DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <ip>`, checked against the VM's real key) and the variable
`MORROW_DOMAIN` (in the `production` environment, where you can also require approval).

Images are built on the VM itself, which keeps the setup simple but takes CPU from the live site for a few
minutes. Later: build arm64 images in CI and push them to GHCR, so the VM only pulls.

Deploy off-peak. Restarting collab disconnects live editors for a few seconds. Collab flushes every open
document on shutdown, editors reconnect and resync, and nothing is lost.

## 7. Backups and the restore test

```sh
crontab -e
17 3 * * * /home/ubuntu/morrow/deploy/backup.sh >> /home/ubuntu/morrow-backup.log 2>&1
```

Each night `backup.sh` dumps the database, checks that the dump is readable, uploads it to R2 and deletes dumps
older than 14 days. It reads its `RCLONE_CONFIG_R2_*` / `BACKUP_*` settings from `.env.production` (create an
R2 bucket and an R2 API token scoped to it). Run it once by hand and check that the file shows up. Also turn on
Oracle's boot-volume backups (5 are free) as a second layer.

**Get alerted when backups stop.** A failing cron job is silent. Create a free check at healthchecks.io (period
1 day, grace 2 hours) and set its URL as `BACKUP_PING_URL`. The script pings it after every good backup and pings
`<url>/fail` when a backup fails. If neither arrives, healthchecks.io emails you.

Once a month, follow **`deploy/restore.md`**: restore the newest dump into a scratch database and compare the
counts with production.

## 8. Monitoring

Point the uptime monitor at `https://<domain>/`, `https://<domain>/api/auth/ok` and
`https://collab.<domain>/healthz`, at 5-minute intervals. Watch disk usage too. A cron line that emails or pings
when `df` passes 80% is enough. Docker build cache is the usual culprit (`docker builder prune`).

## Client IPs and rate limits (`TRUSTED_PROXIES`)

The API rate-limits anonymous requests (sign-in, invitation previews) per visitor IP, so it has to see the real
address. The path is two hops: **browser → Caddy → web (Next.js) → API**.

1. **Caddy** sets `X-Forwarded-For` to the address that connected to it, and it **discards** whatever the client
   sent (no `trusted_proxies` in the Caddyfile), so a visitor can't pick their own bucket.
2. **web** passes that header on unchanged, both for `/api/*` rewrites (Next's proxy doesn't append) and for
   server-rendered calls (`apps/web/src/lib/visitor.ts`).
3. **API**: the connection comes from the web container. `TRUSTED_PROXIES=172.30.0.0/24` (the compose network,
   pinned in `docker-compose.prod.yml`) trusts that hop, so the API reads the client address from the header. Nothing
   outside that network is trusted.

The value is hard-coded next to the subnet so the two can't drift. The local smoke test checked all three cases.
A forged `X-Forwarded-For` sent through Caddy was ignored. A header set by web was believed. A header from an
untrusted peer (loopback) was ignored.

Limit: this holds while clients reach Caddy over **IPv4** (Docker's iptables NAT keeps the source address).
Oracle VMs are IPv4-only by default. If you enable IPv6, Docker's userland proxy would make every IPv6 visitor
look like the network gateway, and they would share one rate-limit bucket. Bind Caddy to the host network or
enable Docker's IPv6 NAT first.

## Capacity (rough)

Estimated for 2 OCPU from the load test on an M2 Pro (`load-writers` / `load-test`, roadmap R3), not measured on the VM:

- about **50 simultaneous typists in one chapter** (one document holds at most 200 live connections),
- about **200 typists per server** spread across small rooms,
- a few hundred concurrent readers,
- voice rooms up to 8 speakers (mesh).

Memory limits: postgres 2 GB, collab 1.5 GB, web 1.5 GB, api 1 GB, caddy 256 MB. That leaves about 5 GB of the
12 GB for the OS, page cache and builds. Re-run the load tests against the VM before posting Morrow anywhere big.

## When we outgrow free (in order)

1. A second server or managed Postgres with point-in-time recovery (removes the single point of failure).
2. Cloudflare's proxy in front of the web app (caching, DDoS). Keep `collab` DNS-only, and set Caddy's
   `trusted_proxies` to Cloudflare's ranges, or every visitor shares Cloudflare's IPs.
3. Redis (Upstash) once collab runs on several instances (live fan-out) and for shared rate limits.
4. A media server (e.g. LiveKit) if voice rooms need more than 8 speakers.
5. Before moving to a scale-to-zero database (Neon, Supabase): make the API's 1-second outbox poll configurable,
   or it keeps the database awake and burns the free compute.
