# Speed and load testing — 8 November 2026

The Orders page now sends substantially less data and renders 50 cards initially. All 500 records loaded by the existing query remain searchable, with **Show more orders** to reveal the rest. CSV export fetches invoice fields directly rather than loading every item and calculating unused product/payment summaries.

No restaurant records or credentials were changed. Benchmarks use a separate temporary database, signing secret, and localhost production server. The configured MongoDB server and local CPU are still shared with other processes, so timing varies with other machine activity.

## Matched 10,000-order comparison

Both runs use ten-second read stages, 2/10/25/50 simultaneous requests, and 60 checkouts each at concurrency 2 and 10. Concurrency measures simultaneous requests, not human cashiers.

| Scenario | Concurrency | Before p95 | After p95 | Before req/s | After req/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Counter operations | 2 | 181 ms | 110 ms | 20.72 | 34.74 |
| Counter operations | 10 | 727 ms | 763 ms | 20.70 | 32.16 |
| Counter operations | 25 | 1,713 ms | 1,689 ms | 19.34 | 29.47 |
| Counter operations | 50 | 3,714 ms | 1,657 ms | 18.36 | 40.35 |
| Reporting | 4 | 2,154 ms | 1,451 ms | 3.28 | 4.43 |
| Paid checkout | 2 | 87 ms | 123 ms | 26.53 | 25.55 |
| Paid checkout | 10 | 1,331 ms | 1,421 ms | 20.19 | 19.59 |

The comparison made 1,007 requests before and 1,569 afterward, with zero failures. Each run reconciled 120 payments to 120 unique correctly paid orders, totaling Rs 30,000. Payment latency did not consistently improve; no faster-payment claim is supported by this comparison.

Orders response size fell from 1,100.3 KB to 230.7 KB (about 79% smaller). Warm Orders samples fell from 219 ms to 121 ms. The full monthly CSV remained 1,158.8 KB; its warm samples fell from 603 ms to 380 ms. These endpoint samples use only two warm requests and are less reliable than the workload percentiles. Peak sampled server RSS was 869 MB before and 841 MB after.

Raw evidence: [before](speed-before.json), [after](speed-after.json).

## 50,000-order stress and five-minute soak

The larger run completed **11,125 scenario requests with zero failures**, including reads, price previews, reporting, and transactional payments. It verified **758 payments, 758 distinct correctly paid orders, and Rs 189,500 collected**, with no duplicate or missing payments. The temporary server stopped and benchmark database removal was confirmed.

| Scenario | Concurrent requests | Requests | p95 | Throughput |
| --- | ---: | ---: | ---: | ---: |
| Counter operations | 2 | 300 | 138 ms | 29.95 req/s |
| Counter operations | 10 | 453 | 326 ms | 44.76 req/s |
| Counter operations | 25 | 500 | 647 ms | 48.59 req/s |
| Counter operations | 50 | 512 | 1,227 ms | 49.04 req/s |
| Reporting | 4 | 13 | 7,131 ms | 1.11 req/s |
| Mixed two-counter workload, 300 seconds | 2 | 8,947 | 127 ms | 29.82 req/s |
| Paid checkout burst | 2 | 200 | 154 ms | 20.67 req/s |
| Paid checkout burst | 10 | 200 | 1,647 ms | 17.40 req/s |

During the soak, cart previews had p95 43 ms, POS page reads 105 ms, order-list reads 140 ms, kitchen reads 133 ms, and the 358 mixed-in checkouts 150 ms. Server RSS moved from 1,072 MB to 1,099 MB during this stage; peak across the complete run was 1,157 MB. Five minutes cannot establish absence of long-term memory leaks.

The full-month report remains a bottleneck at this scale: four sampled concurrent report requests had p95 7.13 seconds, while monthly CSV requests had p95 3.18 seconds. The CSV contained about 5.74 MB of invoice data. Only 13 requests were sampled in the reporting stage, so its percentile is coarse. A ten-request checkout burst also produced a 6.86-second maximum despite no failures. The results support responsive normal two-counter work, not uniformly subsecond performance at every stress level.

Next capacity work should focus on database aggregation for large reports and transactional write contention. No shared financial-result cache was introduced. Large reports should use a narrower date range or run outside peak service; intended-host and multi-hour tests are still needed before making a capacity guarantee.

Raw evidence: [large stress/soak](speed-large-soak.json). Across all three runs in this pass: **13,701 requests**, **998 reconciled checkouts**, zero scenario failures. Endpoint warmups and optional browser traffic are additional and excluded from these counts.

## Regression coverage

- Production build, TypeScript, full lint, and 135 unit tests passed.
- Reporting/security database tests: 19 passed. The new export regression compares invoice membership, order, amounts, and legacy dates with the original report. Existing security checks cover authorization, tenant separation, spreadsheet formula protection, concurrent payment integrity, and revoked sessions.
- A Chrome check against the synthetic 50,000-order production server passed: first render shows 50 cards; all 500 loaded orders can be revealed; search finds an order beyond the initial 50; payment filtering works; the Orders page fits a phone viewport. No JavaScript page errors were observed.
- The load runner now records latency per route and exits unsuccessfully if any scenario request fails, while retaining the result artifact.

## Repeating the test

```powershell
npm.cmd run build
npm.cmd run test:load -- --label=speed-check --orders=10000 --seconds=10 --concurrency=2,10,25,50 --writes=60
npm.cmd run test:load -- --label=large-check --orders=50000 --seconds=10 --concurrency=2,10,25,50 --writes=200 --soak=300
```

Optional browser validation requires Chrome and a locally installed `playwright-core`. Add `--browser-module=<path-to-playwright-core/index.mjs>` to the load command. This tooling is not a production dependency; the temporary installation used for this run is removed afterward.

Use the production build (`npm.cmd start` or the existing `start-pos.bat`) for normal operation. These tests do not switch or restart the currently running restaurant app. Development-mode timings are not represented by these results.

These local runs do not prove WAN/device responsiveness, printer throughput, multi-hour stability, or production host capacity. The earlier dependency-security findings remain a separate release blocker.
