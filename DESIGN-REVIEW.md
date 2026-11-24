# OkayChat V1 page and launch review

Reviewed 24 November 2026 against the current Next.js page components and API wiring. The local browser can show the sign-up/sign-in page. The other workspace pages are behind authentication, and their live data could not be inspected because the API, PostgreSQL, and Redis are not running in this environment. They have been reviewed from their source components and styles, not visually verified with live workspace data.

## What each page is for

| Page | Current design and purpose | Current readiness |
|---|---|---|
| Sign in / create workspace | Split layout: product promise on the left and a short account form on the right. Registration asks for name, business, email, and a 10+ character password. | Visual foundation is present. Signup cannot finish until the API and database are running. Terms and Privacy links currently point to page fragments, not published policy pages. |
| Onboarding | Guides a new workspace toward connecting WhatsApp. | Route exists; verify each step with a connected API and a new account. |
| Home | Workspace welcome, WhatsApp connection callout, KPI cards, recent conversations, and a shortcut to the Inbox. | Wired to persisted analytics and conversation data; currently empty until a workspace has activity. |
| Inbox | Shared conversation list and conversation detail with status filters, assignment, replies, private notes, and approved templates. | Core UI and API flows exist. Verify live updates, small-screen layout, keyboard navigation, and failure/retry states. |
| Contacts | Searchable contact table, accessible add-contact dialog, CSV import, and WhatsApp consent state. | Core persisted workflows exist. Consent begins Unknown; continue refining bulk-edit and duplicate handling. |
| Leads | Sales pipeline and stage changes linked to contacts. | Persisted workflow exists. Verify the visual pipeline at narrow widths and clarify stage names and empty-state actions. |
| Campaigns | Draft form, searchable audience selection, consent status, template selection, preflight blockers, launch confirmation, and recipient progress. | Dispatch foundation is implemented. Only approved templates without dynamic variables/media/buttons are supported; scheduling, unsubscribe handling, rate limits, and template variable mapping remain. |
| Templates | Synced WhatsApp templates with approval status. | API-backed sync exists. Verify sync/loading/error states against Meta credentials and add a more direct path from a blocked campaign to template setup. |
| Automations | Basic inbound assignment rules, with activation and pause controls. | Foundation exists for this narrow rule type. Broader workflow builder, testing/preview, and idempotent job handling remain. |
| Analytics | Workspace KPIs, seven-day inbound/outbound activity, and lead/contact source breakdown. | Persisted-data view exists. Validate metric definitions, empty states, date ranges, and export before launch. |
| Team | Workspace member list and invite/revoke flow. Invite links are copied for manual sharing. | Core flow exists. Email delivery and verified-email proof remain. |
| Settings | Workspace and manual WhatsApp Cloud API connection form. | Token is encrypted at rest, but setup is manual. Meta Embedded Signup and connection health/recovery UX remain. |
| Billing | Current-plan summary, workspace usage counts, plan cards, and an explicit payments-not-connected notice. | Persisted workspace subscription and plan/usage read API are implemented. Prices are proposal-stage; no checkout, invoice, payment, or subscription webhook exists. Only owners/admins see the page. |
| Notifications | Bell opens a workspace panel with unread count, assignment notices, timestamps, mark-read, and mark-all-read actions. | Persisted in-app notification foundation is implemented for manual and automated conversation assignment. Email/push delivery and notification preferences remain. |
| Platform Admin | Read-only summary cards and a recent-workspaces table, kept in a SYSTEM navigation group. | Protected overview API requires an explicit `PLATFORM_ADMIN_EMAILS` allowlist, omits member email addresses, and audits every overview access. No global edit, impersonation, or tenant-data access actions are provided. |

## Design review: changes before a customer launch

1. **Make setup and errors recoverable.** Finish the local API/database setup, test registration and login end to end, and show clear connection, loading, empty, validation, and retry states throughout the workspace.
2. **Remove unfinished affordances.** Wire global search and help, and finish Billing checkout/invoice flows before selling paid plans. Add real Terms and Privacy pages.
3. **Complete trust and safety basics.** Add verified email, rate limits, password reset/session management, CSRF review, and security review. Keep WhatsApp consent evidence and opt-out enforcement visible and auditable.
4. **Finish WhatsApp onboarding and campaign safeguards.** Add Embedded Signup, provider status/health recovery, variable mapping and supported media/buttons, unsubscribe handling, scheduling, and provider rate limits. Exercise webhook failures and delivery retries with Meta test credentials.
5. **Close operational readiness.** Add production monitoring/alerts, backups and restore drills, deployment configuration, privacy export/delete flows, and a production migration runbook.
6. **Do a visual/accessibility pass after backend setup.** Review every authenticated page at desktop and mobile widths; verify focus order, labels, contrast, loading skeletons, and empty/error screens with real workspace data.

## Immediate signup blocker

The page posts to `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:4000/api/v1`). The frontend currently runs on port 3000, but no API process is listening on port 4000. This environment also has no Docker, PostgreSQL, or Redis installation. I added `docker-compose.yml` and updated the local setup steps; after Docker is installed, start Postgres/Redis, apply Prisma migrations, and run the API before retrying account creation.

