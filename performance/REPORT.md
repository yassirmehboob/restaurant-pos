# Load and performance test ? 28 October 2026

## Test setup

- Production build: Next.js 16.4.3 / Node v24.18.0; localhost HTTP, without browser rendering or real-printer traffic.
- Host: Intel(R) Core(TM) i7-10510U CPU @ 1.80GHz; 8 logical CPUs, 16 GB RAM, Windows. The load generator, application and configured local MongoDB replica set shared this development machine.
- Identical isolated fixtures: 10,000 orders, 9,970 historical payments, 120 menu items, 20 tables, two open cashier sessions and 30 active kitchen tickets. Four lines per seeded order; the month report covers almost all seeded orders.
- Real authenticated HTTP page requests and Server Action POSTs, including live cart pricing and transactional paid takeaway checkout. No test-only bypass was added to the application.
- Concurrency means simultaneous requests, not a claimed number of human users. Closed-loop clients immediately send another request when one finishes; actual cashier workloads include thinking time.
- Each comparison stage generated requests for six seconds, then drained outstanding requests. Each checkout stage submitted 30 paid orders at concurrency 2 and 10. A separate 60-second mixed workload checked sustained two-counter behavior.
- Tests created only databases whose names match pos_load_test_<random ID>. The child server received an isolated connection string and a temporary signing secret. Test servers were stopped and databases removed after each run.

## Before / after workload measurements

p95 is the approximate time within which 95% of the recorded requests completed. The reporting mix includes the dashboard, monthly report and monthly CSV export.

| Workload | Concurrent requests | Before p95 (ms) | After p95 (ms) | Before requests/sec | After requests/sec | Failures before / after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| counter-operations | 2 | 496 | 168 | 8.37 | 22.7 | 0 / 0 |
| counter-operations | 10 | 1851 | 611 | 8.42 | 23.17 | 0 / 0 |
| counter-operations | 25 | 3955 | 1445 | 8.54 | 23.05 | 0 / 0 |
| reporting | 4 | 14142 | 1766 | 0.42 | 3.57 | 0 / 0 |
| paid-takeaway-checkout | 2 | 160 | 119 | 17.04 | 24.15 | 0 / 0 |
| paid-takeaway-checkout | 10 | 1905 | 1327 | 10.71 | 21.6 | 0 / 0 |

Across the comparison stages: 230 baseline requests and 512 optimized requests, with no failures. Different request counts reflect higher throughput within the same timed windows; fixed checkout counts remained the same.

Peak sampled application-process RSS: **1808 MB before, 701 MB after**. This excludes the database and load-generator processes. RSS includes native memory and is not identical to JavaScript heap usage. Sampling was once per second; subsecond CPU estimates in raw artifacts are too coarse for capacity claims.

## Individual warm endpoint samples

These are the upper median of two warm requests after one cold request, so small timing differences are noisy. The soak run measured the warm Start Orders page at 61 ms, for example. The workload percentiles above contain more samples and are more useful under concurrency.

| Endpoint | Before warm (ms) | After warm (ms) | Response after (KB) |
| --- | ---: | ---: | ---: |
| /pos | 66 | 104 | 120.1 |
| /orders | 395 | 163 | 782.3 |
| /kitchen | 86 | 62 | 134.7 |
| /dashboard | 156 | 152 | 38.3 |
| /reports?range=MONTH | 896 | 459 | 108.8 |
| /api/reports/sales.csv?range=MONTH | 6100 | 547 | 1263.8 |

No list limits or business data were reduced to improve the comparison. The CSV still contained the full monthly report, and Placed Orders still rendered up to 500 records.

## Fixes applied

1. Reuse the two immutable Intl.DateTimeFormat instances for Pakistan dates/times instead of constructing ICU formatters for every cell or ticket. Avoid repeated parsing/formatting within formatDateTime. An isolated 2,000-timestamp batch dropped from 830 ms to 12 ms; existing timezone/date tests still passed.
2. Fetch only the fields consumed by reporting, order cards, kitchen tickets and the Current orders dialog. Monthly reporting also projects only payment method and amount from payment records. No financial totals, permissions, tenant scopes or freshness rules changed.

The sampled report query examined 10060 documents and 10060 index entries to return 10030 matching orders. The monthly report deliberately covers nearly the entire fixture; database scanning was not the dominant CSV formatting bottleneck. No speculative indexes or shared financial caches were added.

## Sustained mixed two-counter check

- 1331 requests over 60.18 seconds; 22.12 requests/sec.
- p50 88 ms, p95 180 ms, maximum 398 ms; **0 failures**.
- 54 paid takeaway checkouts were mixed with cart previews and page reads. The checkout phases afterward added another 20 successful paid orders.
- Final integrity check: 74 successful checkouts, 74 payments, 74 distinct orders, 74 correctly paid kitchen orders, Rs 18500 recorded.
- Server RSS at the start/end of the mixed stage: 636 / 619 MB; peak across the whole soak run 681 MB. This one-minute observation is not proof against long-term memory leaks.
- Baseline and optimized comparison runs each independently verified all 60 checkouts and Rs 15,000, without duplicates or incorrect balances.

## Repeat the tests

Build first, then run:

~~~powershell
npm run build
npm run test:load -- --label=local --orders=10000 --seconds=6 --concurrency=2,10,25 --writes=30
npm run test:load -- --label=soak --orders=10000 --seconds=2 --concurrency=2 --writes=10 --soak=60
~~~

The runner reads MongoDB credentials from the app environment, creates a separate temporary database, binds a separate production server to 127.0.0.1:3218, and writes metrics under performance/<label>.json. Use --port=<unused port> if necessary. Transactions require a replica set or Atlas. Do not use the scores as production hardware guarantees; the same database server still bears benchmark CPU/I/O load even though test data is isolated.

Raw artifacts: [baseline](baseline.json), [optimized](optimized.json), [soak](soak.json).

## Validation and remaining limits

- 37 unit tests passed; database suite: 30 passed and one standalone-MongoDB-specific check skipped because the configured database is a replica set.
- Targeted lint and production build passed. Existing security and transactional payment tests remained green.
- At 25 concurrent operational requests the app reached about 23.05 requests/sec and p95 1445 ms: CPU-heavy rendering still limits peak capacity. This is a stress point, not a service-level guarantee.
- Placed Orders returns about 782 KB of HTML/Flight data for 500 cards. Pagination is the next useful change for larger histories. Reporting still loads a selected range into memory; very large ranges should eventually use database aggregation and streamed CSV generation.
- WAN latency, physical counter PCs, simultaneous browser rendering, thermal printers, long-duration/multi-hour stability, failover, and production network capacity were not tested.
- Restart the running app to load the new build and formatter/query improvements. Existing restaurant data and credentials were not changed.
