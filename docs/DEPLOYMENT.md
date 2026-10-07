# Deployment and recovery

The current delivery is local functionality plus deployment preparation, as requested. The user subsequently requested [private GitHub source hosting](https://github.com/yunke-l/assignment-management-platform); [Actions](https://github.com/yunke-l/assignment-management-platform/actions/workflows/ci.yml) records the hosted checks for each commit. No DNS, TLS certificate or public application environment has been provisioned. Docker is not installed on the local verification host. The CI `container` job checks Dockerfile/Compose configuration, builds the production image, migrates an isolated PostgreSQL database, starts the app, checks compiled assets/API/security headers and validates the Caddy configuration. Require that job to pass for the commit being deployed; it does not provision or verify public TLS.

## Production shape

One built Node application serves both `/api` and the Vite build from the same origin. Caddy terminates HTTPS and proxies to the application. PostgreSQL has a private Docker network and a persistent volume, with no host port. `TRUST_PROXY=true` trusts exactly one reverse proxy; do not expose the app port directly. The provided stack is a single application instance, so its in-process login rate limiter is not distributed.

Production requires PostgreSQL and an exact HTTPS `WEB_ORIGIN`. Demo seeding is refused. Session cookies are HttpOnly, Secure and SameSite=Lax; state-changing browser requests must have the expected Origin. No JWT secret is needed; session and invitation tokens are random opaque values stored as SHA-256 hashes.

The supplied PostgreSQL 17 image uses Debian Bookworm with system locales. Fresh clusters explicitly require SCRAM password authentication for both network and Unix-socket connections; maintenance tools inside the database container receive the same password through `PGPASSWORD`. Keep the Compose environment private. Initialization settings do not modify an existing volume. If upgrading an earlier Alpine-based cluster, retain its previous image for backup and restore into a fresh Bookworm volume; do not change the libc/locale environment underneath an existing database directory.

## First deployment

Install Docker with Compose on your chosen host and point a domain to it. From the repository root:

```sh
cp deploy/production.env.example .env.production
openssl rand -hex 32
```

Put the generated value in `POSTGRES_PASSWORD`, set `DOMAIN`, and choose a unique `RELEASE_TAG`. Keep the env file out of version control. Use a hexadecimal password with this Compose URL template.

```sh
docker compose --env-file .env.production -f compose.production.yaml build app
docker compose --env-file .env.production -f compose.production.yaml up -d db
docker compose --env-file .env.production -f compose.production.yaml run --rm app node apps/api/dist/database/cli.js migrate
docker compose --env-file .env.production -f compose.production.yaml up -d app proxy
docker compose --env-file .env.production -f compose.production.yaml ps
```

Migrations are an explicit release step and run in one transaction under an advisory lock. Never edit an applied migration. Check `https://YOUR_DOMAIN/api/health`, then open the site. Check application and proxy logs without printing environment variables.

Create the first real teacher with the operator CLI:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec app node apps/api/dist/database/accounts.js invite-teacher teacher@your-domain.example
```

Share the resulting one-use code privately. It expires after 48 hours and only the specified email can register as a teacher. The teacher chooses their password in the site's registration screen, creates a class, and generates student invitations. No public teacher registration exists. The operator CLI does not send email automatically.

## Releases and rollback

1. Run `npm run check`, real PostgreSQL tests and `npm run test:e2e`; require CI success.
2. Keep the previous image release tag and create a database backup before migration.
3. Build the new immutable release image. Run the migration command, then deploy the new app. If migration fails, its transaction rolls back; leave the old app running and fix the migration in a new release.
4. Check health, sign in, create a throwaway class and validate normal use. Remove any unpublished test draft through the UI.
5. For an application-only regression with a backward-compatible schema, restore the previous `RELEASE_TAG` and run `up -d --no-build app`. Verify that the tag already exists locally or pull it from your image registry.
6. Do not roll back this session migration to the original JWT starter: its authentication and membership rules differ. For an incompatible schema rollback, stop application writes and restore the paired backup into a fresh database, then deploy the matching image. Restoring an old backup discards later writes; choose a restore point deliberately.

## Verified local recovery

Run `npm run test:recovery` for a self-contained drill with synthetic PGlite data. The script creates a new fixture under `.local/recovery-drill-*`, writes an assignment and submission through the API, closes the database cleanly, copies it, and opens the copy in a separate fresh directory using the same PGlite version. It compares all ten table counts and logical data digests, checks migrations, revokes restored credentials, and verifies fresh logins and preserved teacher/student results. It does not open `.local/database` or read a database URL from `.env`.

This drill passed locally; [recovery.json](evidence/recovery.json) records its environment and assertions. Copying a running database directory is not this procedure. See [PGlite close](https://pglite.dev/docs/api#close) for clean shutdown. This local offline copy does not establish cross-version compatibility or production PostgreSQL recovery.

## Production PostgreSQL backup and restore drill

Run backups on the database host or with matching PostgreSQL 17 client tools. The following uses the database container's `pg_dump`; use a new output filename for every backup. Backups contain private user and answer data. Keep access restricted, copy encrypted backups off-host, and define retention with the deployment owner.

```sh
mkdir -p .local/backups
docker compose --env-file .env.production -f compose.production.yaml exec -T db pg_dump -U classwork -d classwork --format=custom --no-owner --no-acl > .local/backups/classwork-before-release.dump
```

Restore into a **new** database, never directly over the live one:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T db createdb -U classwork classwork_restore_check
docker compose --env-file .env.production -f compose.production.yaml exec -T db pg_restore -U classwork -d classwork_restore_check --no-owner --no-acl --exit-on-error < .local/backups/classwork-before-release.dump
docker compose --env-file .env.production -f compose.production.yaml exec -T db psql -U classwork -d classwork_restore_check -c 'SELECT count(*) FROM schema_migrations; SELECT count(*) FROM users; SELECT count(*) FROM assignments; SELECT count(*) FROM submissions;'
```

Point a separate application instance at `classwork_restore_check`, with an isolated origin, and verify teacher reports and student results. Record the backup timestamp, counts and restore duration. Before using a restored database for live traffic, revoke restored sessions and invitations:

```sql
UPDATE sessions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;
UPDATE invitations SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;
```

This PostgreSQL restore procedure is supplied but has not yet been exercised on a Docker host. Never report production recovery as verified until this drill succeeds in the target environment.

## Operations

- `/api/health` checks database connectivity; it returns a non-success status when the database is unavailable.
- Responses and structured logs include a request ID. Logs contain method, path, status and duration; do not add passwords, cookies, request bodies or invitation codes to logs.
- Sessions expire after seven days. Logout revokes the current session; changing a password revokes all sessions. `accounts.js revoke-user EMAIL` revokes current sessions but does not disable the account or prevent another login.
- Periodically run `accounts.js prune-sessions` to remove sessions expired or revoked more than 30 days ago.
- On database outages, reads show retry controls. For an uncertain answer submission, keep the page open and retry unchanged answers; the same request ID is reused. Reloading/reopening the assignment retrieves any committed result. Do not retry with fabricated scores or overwrite submissions.
- File uploads, manual grading, public self-registration, distributed rate limiting, email delivery and automatic password recovery are outside this release.

References: [PostgreSQL backup](https://www.postgresql.org/docs/17/backup-dump.html), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Playwright web server](https://playwright.dev/docs/test-webserver).
