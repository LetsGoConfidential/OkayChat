# OkayChat.in

OkayChat is a WhatsApp-first business communication workspace: conversations, contacts, leads, campaigns, and follow-up automation in one simple product.

## Current foundation

- `apps/web`: Next.js + React + TypeScript user interface. Includes a responsive Home dashboard, persisted Inbox, contacts/leads, campaigns, automations, analytics, template sync, and manual WhatsApp Cloud API connection setup.
- `apps/api`: NestJS REST API with registration, login, rotating refresh sessions, logout, protected current-user and workspace endpoints, and health endpoints.
- `packages/db`: PostgreSQL schema, migrations, and the generated Prisma client exported as the `@okaychat/db` workspace package for API type/runtime safety.
- `.env.example`: environment-variable names for the application and infrastructure.

Account creation, login, workspace membership and invitations, contacts, leads, conversations, messages, campaign drafts, and inbound assignment automations are persisted through the API. The Leads panel presents a stage-based pipeline with contact-linked lead creation, estimated values, and persisted stage moves; only owners, admins, and managers can access lead operations. These records are scoped to the active workspace, and sensitive writes create audit events. Inbox reads/replies through the API; Open, Snoozed, and Closed filters update conversation status; internal team notes are stored and audited separately from customer messages. Authenticated SSE streams carry workspace-scoped change notifications over Redis Pub/Sub, and the web Inbox reloads affected data when events arrive. Workspace managers can assign conversations to members from the Inbox. Owners/admins can create seven-day, single-use invitation links; tokens are hashed at rest, role assignment is restricted, invitees must sign in with the invited email, and owners/admins can revoke pending invites. Invite links are displayed for manual sharing; an email delivery adapter is not configured yet. Outbound text and approved-template sends are committed with an outbox row and audit event in one database transaction, then queued in BullMQ with up to five attempts and exponential backoff. A dispatcher retries pending Redis handoffs and reconciles stale queued jobs; provider status webhooks update message and outbox states. Campaign drafts store a workspace-scoped audience and approved template. Launch requires every selected contact to be opted in, a connected channel, and an approved template without dynamic variables. Each recipient is recorded separately, consent is checked again immediately before sending, and progress reports sent, failed, skipped, and queued counts. Campaign dispatch retries persisted jobs after temporary Redis failures. Contact records store WhatsApp consent as UNKNOWN, OPTED_IN, or OPTED_OUT, with the timestamp and source of the latest status; changes are audited. Managers can create inbound-message rules that assign a conversation to a workspace member; the webhook applies this assignment only when there is no existing assignee. Analytics reports workspace counts, seven-day message activity, and contact source totals from persisted data. Owners/admins can sync WhatsApp templates from connected Meta channels; the Inbox can send approved templates with text body variables. A channel can be connected with a Meta Cloud API access token; tokens are AES-256-GCM encrypted at rest.

Conversation assignments generate persisted, recipient-scoped in-app notifications with unread tracking and mark-read actions. Each workspace receives a persisted Free billing account; owners/admins can view its plan and current workspace counts. The plan prices shown in Billing are proposal-stage only, and checkout, invoices, and payment webhooks are not enabled.

## Local setup

Prerequisites: Node.js 20+, pnpm 11+, and Docker Desktop (or PostgreSQL 15+ and Redis 7+ installed locally).

1. Copy `.env.example` to `.env`. The example uses the local credentials from `docker-compose.yml`; replace the placeholder JWT secret before sharing or deploying the environment. Set `TOKEN_ENCRYPTION_KEY` to a base64-encoded random 32-byte key before connecting WhatsApp.
2. Start local infrastructure from the repository root with `docker compose up -d` and wait for both containers to report healthy.
3. Install workspace dependencies with `pnpm install`, then generate the Prisma client with `pnpm db:generate`.
4. Apply the committed PostgreSQL migrations with `pnpm db:migrate`. Production deployments should use `pnpm db:deploy`; never use `migrate dev` in production.
5. Start the API in one terminal with `pnpm dev:api`, then start the web app with `pnpm dev` in another terminal. Confirm the API at http://localhost:4000/api/v1/health before creating an account at http://localhost:3000/login.

The web sign-up page reports an explicit API-unavailable message if the API cannot be reached. If registration fails after the API is healthy, inspect the API terminal for database connection, migration, or validation errors.

Run `pnpm typecheck` to check both TypeScript applications and `pnpm build` to create production builds. Prisma Client is generated into `packages/db/generated/client` and imported by the API through the `@okaychat/db` workspace package.

## Architecture and tenant safety

Every business-owned record carries `workspaceId` directly or is reached through a parent with a workspace relationship. The API must derive the active workspace from an authenticated membership, never trust a client-supplied workspace ID alone, and scope every read/write to that membership. Use database row-level security as defense in depth before production. Owners/admins manage workspace and billing; managers operate leads/campaigns/analytics; agents work assigned conversations. Add authorization guards per endpoint and immutable audit events for sensitive changes.

Use short-lived access tokens and rotating refresh tokens in secure, httpOnly cookies. Protected API requests also check the live session record, so logout, refresh rotation, expiry, and workspace switching invalidate older access tokens immediately. The API rejects browser requests whose `Origin` differs from `WEB_ORIGIN`; requests without an Origin header remain available for server-to-server integrations such as Meta webhooks. Hash passwords with Argon2id; encrypt Meta tokens with a managed key service. Verify Meta webhook signatures, deduplicate provider message IDs, and enqueue outbound work through Redis/BullMQ with idempotency keys and retry/backoff. A transactional outbox recovers pending Redis handoffs and stale queued jobs; status webhooks reconcile persisted message states. Exactly-once provider delivery is not guaranteed if a worker stops after Meta accepts a send but before the provider message ID is committed, so add provider-supported idempotency or operational reconciliation before relying on automatic replay for high-stakes messaging. Realtime conversation updates should publish only after successful persistence. Keep the Meta Graph API behind a `WhatsAppProvider` interface so onboarding, inbox, templates, campaigns, and webhooks do not depend on provider-specific payloads. Use an AI gateway boundary with explicit workspace policy, redaction, and usage metering; AI output must not send without a human or configured automation policy.

## Initial API shape

Base path: `/api/v1`.

- `GET /health` — process health check.
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.
- `GET/POST /workspaces`, `POST /workspaces/:workspaceId/activate`, `GET/PATCH /workspaces/current`, `GET /workspaces/current/members`.
- `GET/POST /workspaces/current/invites`, `POST /workspaces/current/invites/:inviteId/revoke`, `GET /workspaces/invites/preview`, `POST /workspaces/invites/accept` — role-checked, one-time workspace invitations.
- `POST /channels/whatsapp/connect`, `GET /channels`, `POST /webhooks/meta`.
- `GET/POST /contacts`, `POST /contacts/import`, `PATCH /contacts/:id` — tenant-scoped contact management and CSV import (up to 500 rows); imports start with Unknown WhatsApp consent, while consent updates require a source note and are audited.
- `GET/POST /leads`, `PATCH /leads/:id` — workspace-scoped lead pipeline, restricted to owners, admins, and managers.
- `GET /channels`, `POST /channels/whatsapp/connect` (owner/admin only; manual channel credentials).
- `GET /conversations`, `PATCH /conversations/:id`, `GET/POST /conversations/:id/messages`, `GET/POST /conversations/:id/notes` — workspace-scoped Inbox, status actions, and private team notes.
- `GET/POST /campaigns`, `PATCH /campaigns/:id`, `GET /campaigns/:id/eligibility`, `POST /campaigns/:id/dispatch`, `GET /campaigns/:id/progress` — workspace-scoped drafts, consent/template/channel preflight, queued dispatch, per-recipient status, and delivery progress.
- `GET/POST /automations`, `PATCH /automations/:id` — create, list, and pause/activate inbound conversation assignment rules.
- `GET/POST /webhooks/meta` — Meta verification handshake and signed webhook receiver.
- `GET /analytics/overview` — workspace counts, seven-day message activity, and contact sources.
- `GET /realtime/events` — authenticated Server-Sent Events stream for the active workspace; events contain change notifications, not message contents.
- `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` — authenticated, workspace- and user-scoped in-app notifications for conversation assignments.
- `GET /templates`, `POST /templates/sync/:channelId` (owner/admin) — list locally synced templates and sync their status/components from Meta.
- `GET /billing/current` (owner/admin) — current workspace plan, membership/contact/campaign counts, and the proposal-stage plan catalog.
- `POST /conversations/:id/template` — send a synced, approved template with text body parameters and an idempotency key; freeform sends remain subject to the customer service window.

Registration requires `name`, `email`, and `password` (10+ characters), plus `workspaceName` for new workspaces. With an `inviteToken`, registration atomically creates the user and the invited workspace membership instead. Login accepts `email` and `password`. Access and rotating refresh credentials are issued as HttpOnly cookies; refresh tokens are stored only as SHA-256 hashes and revoked on rotation/logout. The web app checks `/auth/me` on protected routes and attempts one session refresh before returning to sign-in.

Workspace endpoints derive tenant context from the signed access token and re-check live membership in the database. Workspace switching requires membership and updates the active workspace on the current server-side session. Owners/admins can update workspace settings; owners/admins/managers can view the member list. Workspace creation, changes, and invite lifecycle actions are recorded in audit events. Invitation acceptance requires an authenticated account whose email matches the invitation; email verification and mail delivery are not implemented yet, so production rollout should add verified-email proof before treating email matching as identity proof. Contacts and leads use cursor pagination and workspace-bound queries; phone numbers are unique within a workspace and validated in international format. Consent status changes require a source note and create audit events. Freeform message sends require an idempotency key, a connected channel, and an open 24-hour customer service window. Template sends require an approved template synced from the conversation's WhatsApp channel; only body text variables are supported so far. Meta webhook POSTs require the raw-body HMAC signature. Outbound delivery uses BullMQ retries backed by a transactional outbox, and provider status webhooks reconcile message state. Duplicate sends remain possible if a worker crashes after provider acceptance but before saving the returned provider ID. For official request and webhook examples, use [Meta's WhatsApp Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api). For list endpoints, add rate limits. Auth endpoints still need rate limiting, email verification, password reset, device/session management, CSRF review, and automated security review before production.

## V1 implementation sequence

1. Add CSRF/rate-limit controls, verified-email proof, and invitation email delivery for the current auth and workspace foundation.
2. Add Meta Embedded Signup, template header/media/button parameters, and delivery of full persisted event payloads if clients need finer-grained updates than change notifications.
3. Add media object storage and provider-supported duplicate-send recovery to the BullMQ/outbox delivery foundation.
4. Add campaign scheduling, template variable mapping, unsubscribe handling, provider rate limits, and idempotent automation jobs; complete remaining contact and lead workflow polish.
5. Add notification email/push delivery and preferences, payment checkout/invoices/webhooks, and platform-admin authorization.
6. Add object storage, structured logs/traces, alerting, backups, privacy/export/delete flows, abuse controls, and production deployment configuration.

## Product modules

The shell includes Home, Inbox, Contacts, Leads, Campaigns, Templates, Automations, Analytics, Team, Billing, and Settings. Agency mode should be introduced as an organization relationship with explicit agency-to-client workspace grants and audit trails; never let an agency membership bypass client workspace authorization.
