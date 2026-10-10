# Backend Architecture

## Current deployment

- Runtime: Node.js with Express 5 (ES modules)
- Hosting: Render web service (`backend/` as the service root)
- Database and authentication: Supabase
- Main entry point: `src/server.js`
- Routes: `src/routes/`
- Middleware: `src/middleware/`
- Integrations and shared infrastructure: `src/lib/`

## Current route groups

- `/api/articles` — published article listing, category filtering, detail and premium access
- `/api/categories` — category listing
- `/api/users` — authenticated profile endpoint
- `/api/devices` — authenticated push-device registration
- `/api/notifications` — authenticated notification listing
- `/api/subscriptions` — subscription status and Google Play verification
- `/api/admin` — admin-protected article operations

## Refactoring principles

1. Preserve existing routes and response contracts unless a separately reviewed change explicitly changes them.
2. Keep the Supabase service-role key server-side only.
3. Make changes in small pull requests, with additive database migrations where needed.
4. Keep provider API calls in integration/service modules, not inside route handlers.
5. Validate inputs at API boundaries and return safe, consistent errors without leaking credentials or provider responses.
6. Keep secrets in Render environment variables; never commit `.env` files or API keys.
7. Run syntax/type checks and smoke-test health, categories, article filters, authentication, admin access and subscription verification before merging.

## Refactor phases

### Phase 1 — Shared authentication (this PR)

- Centralize bearer-token extraction and Supabase user validation.
- Reuse the middleware across user, device, notification, subscription and admin routes.
- Preserve `req.authUser`, `req.user`, and `req.adminProfile` compatibility.

### Phase 2 — Error handling and observability

- Add a consistent not-found and error response strategy.
- Add request IDs and structured logs that exclude authorization headers, tokens and secrets.
- Improve health checks to distinguish process health from database/provider health without exposing internals.

### Phase 3 — Service boundaries and ingestion reliability

- Separate article/category/subscription business logic from HTTP route handlers where this reduces duplication.
- Prevent overlapping scheduled ingestion runs and handle shutdown cleanly.
- Track provider failures and last successful ingestion; do not fabricate content when providers fail.

### Phase 4 — Tests and operational hardening

- Add automated tests for auth middleware, article filtering, premium access and subscription verification.
- Add API smoke tests and a documented Render/Supabase release checklist.
- Review rate limiting, CORS allow-list, request validation and database query performance.

## Current limitations to address in later phases

- Authentication logic had been duplicated across several routes.
- API error response patterns are not yet fully standardized.
- News ingestion is scheduled in the web process; overlapping runs and graceful shutdown need explicit handling.
- The existing health endpoint confirms that the process responds but does not actively check database connectivity.
