# Mail (hello@gacoka.com)

The dashboard's Mail section (`#mail`) is a mail client for `hello@gacoka.com`
and its aliases. Mail is stored by a self-hosted [Stalwart](https://stalw.art)
server (v0.16, AGPL) running beside the API. Outgoing mail goes out through
Resend's free SMTP relay (100 messages a day, 3,000 a month) so it reaches
Gmail and Outlook inboxes instead of spam. Resend adds no open or click
tracking and no unsubscribe header. Brevo was tried first and dropped: its
free plan forces a tracking pixel, rewrites every link and adds an Unsubscribe
header, which makes personal mail look like marketing. Phone and desktop mail apps can use the same mailbox
over IMAP and SMTP.

## How it fits together

```
Internet ──25──▶ stalwart ◀── JMAP (http://stalwart:8080, docker network) ── api ◀── browser (#mail)
                    │  ▲
                    │  └── 993 IMAP / 465 SMTP ── phone and desktop mail apps
                    └── outgoing ──465──▶ smtp.resend.com ──▶ recipient
```

| Piece | Where | Holds |
|---|---|---|
| `stalwart` container | `docker-compose.yml` | Messages, folders, keywords (read, starred, labels, `$other`), sending identities and signatures, the Sieve filter script, scheduled submissions, aliases, catch-all |
| `api/src/services/jmap.js` | JMAP adapter | Session, batched calls, upload and download |
| `api/src/services/mail.js` | Mail domain module | Everything the UI does |
| `api/src/services/mailAdmin.js` | Stalwart admin adapter | Aliases, catch-all, DNS records |
| `api/src/routes/mail.js` | `/api/mail/*` | HTTP layer, behind the sign-in gate |
| `api/src/lib/mail*.js`, `sieve.js` | Pure modules | Search parsing, Sieve compilation, HTML safety, reply construction |
| Postgres `mail_*` tables | Migration 023 | Label names and colours, filters, templates, contacts, sender preferences, follow-ups, settings |
| `public/js/mail*.js` | Frontend | List and reader, composer, settings |

Design decisions:

- **Undo send and send later** use Stalwart's delayed delivery (FUTURERELEASE). A
  sent message waits on the server for the undo window or until its scheduled
  time. Cancelling moves it back to Drafts. Scheduled mail goes out even when
  no browser is open.
- **Filters and the split inbox** compile to one Sieve script that Stalwart runs
  at delivery, so they also apply to mail read on a phone. Mail that the spam
  filter classifies as spam skips the script, so a filter can't pull spam out of
  Junk.
- **Received HTML** renders in an iframe that can't run scripts. Remote images
  are blocked until you choose to load them, once or always for a sender.
  Quoted text in replies has remote images removed.
- **Attachments** of types that could run as a web page (HTML, SVG) always
  download instead of opening, because they would otherwise run on the
  gacoka.com origin.

## Environment (`/var/www/app/.env`)

| Variable | Used by | Value |
|---|---|---|
| `MAIL_JMAP_URL` | api | `http://stalwart:8080` |
| `MAIL_USER` | api | `hello@gacoka.com` |
| `MAIL_PASSWORD` | api, CLI | Mailbox password, also used by phone mail apps (16 or more characters) |
| `MAIL_ADMIN_USER` | api, CLI | `admin@gacoka.com` |
| `MAIL_ADMIN_PASSWORD` | api, CLI, stalwart | Stalwart administrator password |
| `MAIL_RELAY_HOST` | CLI | `smtp.resend.com` |
| `MAIL_RELAY_PORT` | CLI | `465` (implicit TLS) |
| `MAIL_RELAY_USER` | CLI | `resend` |
| `MAIL_RELAY_SECRET` | stalwart | The Resend API key. Only the stalwart container reads it. |

Without the `MAIL_*` variables, the Mail section shows "Mail isn't set up on
this server yet" and the rest of the dashboard is unaffected.

## First-time setup

1. Create the data directories. Stalwart runs as UID 2000.

       sudo mkdir -p /var/www/app/mail/etc /var/www/app/mail/data
       sudo chown -R 2000:2000 /var/www/app/mail

2. Open the mail ports.

       sudo ufw allow 25/tcp comment 'SMTP in'
       sudo ufw allow 465/tcp comment 'SMTP submission'
       sudo ufw allow 993/tcp comment 'IMAP'

3. Add the variables above to `.env` and deploy. Generate the passwords with
   `openssl rand -base64 24` and don't print them.
4. Run Stalwart's setup, restart it, then configure it.

       docker exec current-api-1 node src/cli/mail.mjs bootstrap
       docker restart current-stalwart-1 && sleep 5
       docker exec current-api-1 node src/cli/mail.mjs configure

5. Publish the DNS records at Hostinger. To list them, run:

       docker exec current-api-1 node src/cli/mail.mjs dns

   Replace any old MX, SPF and DMARC records. Keep Resend's sending records
   (`resend._domainkey` TXT, `send` and `rsend` CNAMEs), but leave Resend's
   **receiving** turned off: its MX record would take incoming mail away
   from Stalwart.

6. Check the result in Mail Settings → Setup and delivery. Every row should
   show OK; reverse DNS is optional.

## Maintenance

| Task | Command or place |
|---|---|
| Change the mailbox password | Edit `MAIL_PASSWORD` in `.env`, then run `docker compose up -d api` and `docker exec current-api-1 node src/cli/mail.mjs set-password` |
| Re-apply the server configuration | `docker exec current-api-1 node src/cli/mail.mjs configure` (idempotent) |
| Logs | `docker logs current-stalwart-1` |
| Back up mail | Copy `/var/www/app/mail/data` while Stalwart is stopped, or snapshot the VPS. Postgres backups cover labels, filters and templates. |
| Upgrade Stalwart | Change the image tag in `docker-compose.yml` (pinned to `v0.16`) and read the release notes first |

## Using it from a phone or laptop

| Setting | Value |
|---|---|
| Incoming (IMAP) | `mail.gacoka.com`, port 993, SSL/TLS |
| Outgoing (SMTP) | `mail.gacoka.com`, port 465, SSL/TLS |
| Username | `hello@gacoka.com` |
| Password | `MAIL_PASSWORD` |

## Troubleshooting

- **Nothing arrives.** Check the MX record, confirm `ufw status` lists port
  25, and read `docker logs current-stalwart-1`.
- **Sent mail lands in spam.** Check Mail Settings → Setup and delivery, where
  SPF, DKIM and DMARC must all show OK. Then check that Resend shows the domain
  as authenticated.
- **"Daily sending limit reached."** Resend's free plan allows 100 messages a
  day and 3,000 a month. The daily limit resets at midnight UTC.
- **No certificate for mail.gacoka.com.** The `A mail` record must point at the
  VPS, and Traefik must route
  `http://mail.gacoka.com/.well-known/acme-challenge/*` to Stalwart. Look for
  `acme` in the Stalwart logs.

  Traefik and Stalwart each get their own certificate for `mail.gacoka.com`.
  Traefik's covers `https://mail.gacoka.com`, which redirects to the webmail;
  Stalwart's covers IMAP (993) and SMTP (465). Traefik uses the TLS-ALPN
  challenge on port 443 (`traefik/traefik.yml`), because an HTTP challenge
  would make Traefik answer every `/.well-known/acme-challenge/` request on
  port 80 itself, and Stalwart's challenge would never reach Stalwart.
