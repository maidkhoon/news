# BazaarNexa Feature Roadmap

## Product direction

BazaarNexa is an India and crypto research app with dedicated market and cricket experiences. Complete feature work before the consolidated device test and Android release build.

## Prioritized roadmap

### P0 — Core data and navigation
- [ ] Verify article/category feeds for India and Crypto.
- [ ] Fix and validate category filters and article detail navigation.
- [ ] Make Sensex and Nifty 50 sections useful with real market data.
- [ ] Add a dedicated Cricket Hub with fixtures, match details and score cards.

### P1 — Unified live ticker bars
**User decision:** Start with free/low-cost data providers. Tickers should support both continuous auto-scroll and manual swipe.

- [ ] India ticker: Nifty 50, Sensex, and selected indices/stocks; show value, absolute change, percentage change and market open/closed state.
- [ ] Crypto ticker: BTC, ETH and a configurable shortlist; show INR price and 24-hour percentage change.
- [ ] Cricket ticker: live matches, team abbreviations, score/wickets/overs and match state; show upcoming or completed state when no match is live.
- [ ] Contextual behavior: the India section shows the India ticker, Crypto shows crypto assets, and Cricket shows match scores. Home may show a compact mixed ticker if useful.
- [ ] Reusable ticker component with auto-scroll, manual horizontal swipe, tap-to-open details, accessible touch targets and reduced-motion behavior.
- [ ] Display last-updated time and clearly distinguish live, delayed, stale and unavailable data.
- [ ] Respect provider rate limits and cache server-side; do not expose provider secrets in the mobile app.
- [ ] Define graceful fallback when a provider is unavailable; never present stale data as current.

### P1 — Accounts and premium
- [ ] Complete sign-in/sign-out and profile management.
- [ ] Verify server-side premium access and subscription entitlement behavior.
- [ ] Implement subscription lifecycle reconciliation before public release.

### P1 — Notifications
- [ ] Push notifications for relevant cricket match events and user-selected market/news updates.
- [ ] User preferences, permission handling and deep links to relevant content.

### P1 — Security and reliability
- [ ] Add API rate limiting and appropriate request validation.
- [ ] Test profile permissions and premium-content authorization.
- [ ] Add API error handling, loading states, empty states and observability.

### P2 — UI polish and release
- [ ] Fix Android status-bar/safe-area overlap without changing the approved visual design.
- [ ] Verify responsive layouts, ticker motion, accessibility and dark theme on real devices.
- [ ] Run backend, mobile and admin integration/regression tests.
- [ ] Produce the final Android build only after feature freeze and test sign-off.

## Live data implementation plan

1. **Provider evaluation:** compare free/low-cost providers for Indian indices/stocks, crypto INR prices and cricket scores. Record quotas, refresh limits, attribution requirements, latency, terms of use and whether market data is real-time or delayed.
2. **Provider abstraction:** implement server-side provider adapters so providers can be replaced without changing mobile UI. Keep secrets in Render environment variables.
3. **Normalized API:** expose a stable endpoint for ticker snapshots with asset type, symbol, display name, price/score, absolute and percentage change where applicable, status, source, timestamp and stale indicator.
4. **Caching and refresh:** cache results server-side and refresh at provider-appropriate intervals. Do not poll third-party providers independently from every device.
5. **Mobile component:** build a reusable horizontal ticker supporting auto-scroll plus manual swipe, pause on touch, tap-through details, accessibility and reduced motion.
6. **Section integration:** connect India, Crypto and Cricket screens to their relevant ticker datasets; keep article/news feeds separate from price/score data.
7. **Validation:** test valid responses, missing data, rate limits, provider outages, stale timestamps, timezone/market-session transitions and empty live-match windows.
8. **Release gate:** complete feature QA and regression testing first; resolve status-bar overlap and then create the consolidated Android build.

## Data integrity requirements

- Do not label data “LIVE” unless the provider and timestamp support that claim.
- Display delayed-data disclosures when applicable.
- Show currency and units explicitly (e.g. INR, index points, runs/wickets/overs).
- Avoid inventing or interpolating prices or scores when the provider has no data.
- Confirm provider pricing, terms and production suitability before depending on it.
