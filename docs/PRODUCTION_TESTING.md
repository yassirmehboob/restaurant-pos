# Production testing — 8 November 2026

Release assessment: **hold production release pending dependency remediation and deployment/device acceptance checks below.** Automated application checks passed after fixing a Windows production-build error. This is not a claim that every browser interaction, integration, or deployment configuration has been tested.

## Executed checks

| Check | Result |
| --- | --- |
| `npm.cmd test` | 135 passed; zero failures/skips |
| `npm.cmd run test:db` | 156 passed; zero failures; one skipped |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed, including TypeScript and page generation |
| `node scripts/production-smoke.mjs` | 19 passed against a localhost production server |
| Production load and payment soak | 1,328 scenario requests; zero failures |
| Online `npm.cmd audit --json` | 12 affected packages: two high, ten moderate, zero critical |

The skipped database check tests standalone MongoDB failure handling; the configured database is a replica set. Database suites create temporary databases. They exercise transaction/concurrency integrity, permissions and tenant isolation, session revocation, 2FA, reports, discounts/coupons, weight pricing, cash drawers, payment reversal, QR/waiter ordering, kitchen progress/printing, SMS queues, signage, backup/restore, and offline translation. They do not prove equivalent coverage for every UI control.

HTTP smoke checks cover public login/signup/manifest responses, redirects for eleven protected pages, anonymous rejection for four private endpoints, forged-session rejection, and security headers. They send only GET requests. The temporary smoke server was stopped after testing.

## Fixed build blocker

Turbopack interpreted the translation child-process path as a module under its virtual `/ROOT` directory and failed the production build on Windows. `lib/translation/nllb.ts` now marks the working-directory lookup with `turbopackIgnore`, consistent with existing runtime filesystem code. The final production build and targeted lint passed. The production trace includes `lib/translation/nllb-worker.mjs` and `clean.mjs`. Offline model inference passed in the database suite; inference through the built production server was not separately exercised.

## Load results

Command:

```powershell
npm.cmd run test:load -- --label=preproduction-2026-11-08 --orders=10000 --seconds=6 --concurrency=2,10,25 --writes=30 --soak=60
```

The runner seeded 10,000 orders, 120 products, and two open counters in an isolated database and launched a separate localhost production server.

| Scenario | Concurrency | Requests | Failures | p95 latency |
| --- | ---: | ---: | ---: | ---: |
| Counter operations | 2 | 111 | 0 | 209 ms |
| Counter operations | 10 | 111 | 0 | 865 ms |
| Counter operations | 25 | 96 | 0 | 2,838 ms |
| Reporting | 4 | 17 | 0 | 2,854 ms |
| Two-counter mixed workload, 60 seconds | 2 | 933 | 0 | 303 ms |
| Paid checkout | 2 | 30 | 0 | 117 ms |
| Paid checkout | 10 | 30 | 0 | 983 ms |

Payment reconciliation: 98 successful checkouts, 98 payments, 98 unique correctly paid orders, total collected 24,500. Peak server memory was approximately 722 MB. Temporary benchmark database removal was confirmed. These local measurements do not establish production capacity or long-term stability; reporting and 25-request concurrency warrant measurement on the intended host against an agreed latency target.

## Release blockers and remaining acceptance checks

1. Remediate and re-audit dependency findings. The high findings are `sharp` under `@huggingface/transformers` and the affected parent package. Moderate findings involve `uuid` through `exceljs`, and `minimatch` through the TypeScript ESLint chain. Package counts include parents affected through the same underlying advisory. See the saved audit for exact versions, ranges, and advisory links. No dependency upgrades or forced audit fixes were applied: the suggested changes include major upgrades/downgrades requiring compatibility testing, particularly offline inference and spreadsheet exports. The older security review's zero-advisory result no longer describes this dependency tree.
2. Run real browser acceptance on supported desktop/tablet/mobile devices: registration/login/logout/2FA, owner/cashier/waiter roles, ordering/editing/cancellation, discounts/tax/payment/reversal, sale closing, reports, QR orders, and settings. No automated browser runner is installed; HTTP and database checks do not validate clicks, layout, accessibility, browser console errors, or multi-tab behavior.
3. Confirm physical customer/kitchen receipts and cash-drawer pulses with the intended printers/QZ setup. Test disconnected printers, retries, copies, Urdu/Sindhi rendering, and category routing. Current print tests inspect generated jobs rather than operating hardware.
4. Verify live SMS, web push, and optional Google Drive authorization/upload/restore in staging with intended accounts. Queue tests and backup restoration passed, but real provider delivery and production credentials were not validated.
5. Validate HTTPS and secure-cookie behavior at the intended hostname, proxy/firewall rules, private database access, persistent uploads/backups/model directories, stable encryption keys, and supervised kitchen/SMS/backup workers with restart recovery. No hosting deployment or production-mode switch was performed.
6. Perform an off-device backup recovery drill and a longer soak on the intended host. The automated backup suite verifies restoration into a separate database; it does not establish recovery time for the real restaurant dataset.

## Evidence and rerunning

### Authenticated browser follow-up

Used the supplied owner login on the running development app at `http://localhost:3000` with headless Chrome. Credentials were supplied through standard input and were not saved in source or the report. Logged out the test sessions afterward; replaying a copied cookie after logout was rejected.

- 31 valid page visits returned HTTP 200, including POS, kitchen, orders, reports, users, customers, staff, sale sessions, coupons, audit, and settings. `/categories` intentionally redirects to `/products`. An exploratory `/payments` request returned 404; it is not a defined application route. Actual navigation links resolved successfully. Payment collection is provided through order dialogs.
- 20 browser interaction checks passed: empty-cart protection, catalog search, adding an item, server total previews, quantity increases/decreases, line notes, dine-in review totals, takeaway checkout, underpayment blocking, cash change, coupon visibility matching owner configuration, payment-method switching, cancelling checkout, delivery-required-field protection, clear-cart confirmation, POS order browsing, CSV export, customer/order search, mobile cart controls, navigation, and logout/cookie replay. Several closely related assertions are grouped in one check.
- No JavaScript page exceptions were observed during these interaction checks. Coupon code entry is disabled in this restaurant's configuration, so invalid-code entry was not exercised in the UI. Its absence was verified against the owner's setting without changing it.
- Found and fixed a phone header layout defect: the action buttons squeezed the POS title onto three lines at 390 px. At widths of 375, 390, 480, 768, and 1440 px, the corrected title stays on one line and the page has no horizontal overflow.
- The owner has an open Counter 1 sale dated 7 November 2026. Cart and checkout previews were cancelled rather than recording transactions in that shift. No test orders/payments were saved, no shifts closed, and no business settings changed. Login/logout audit events are expected. Completed transaction persistence remains covered by the isolated database and production load tests above, rather than a payment through this real owner's browser session.

This follow-up partially completes the browser acceptance item above. It does not establish every role/device workflow, full UI CRUD coverage, physical printer behavior, or live provider delivery. The dependency release blockers remain unresolved. See [authenticated browser results](test-results/2026-11-08/authenticated-browser.json).

Raw results are in [test-results/2026-11-08](test-results/2026-11-08/). Structured load data is in [preproduction-2026-11-08.json](../performance/preproduction-2026-11-08.json).

Subsequent speed testing and fixes are documented in [the speed report](../performance/SPEED_REPORT.md): matched before/after comparisons, a 50,000-order stress test, a five-minute soak, and 13,701 requests with zero failures across the three new runs. The Orders page now shows 50 cards initially, with all 500 loaded records searchable and accessible through Show more. CSV export uses a lightweight invoice query. Full-month reporting remains slower at high data volumes.

To repeat the HTTP checks, first build, start `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3219`, then run `node scripts/production-smoke.mjs`. An alternate base URL can be passed as its first argument. Stop the temporary server afterward. On this Windows machine, use `npm.cmd` because PowerShell execution policy blocks the `npm.ps1` launcher; no policy change was required.
