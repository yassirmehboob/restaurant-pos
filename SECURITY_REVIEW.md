# Security review — 28 October 2026

Scope: local source review, current npm advisories, authentication/2FA, account permissions,
tenant isolation, payments, uploads, exports, response headers, and production-build HTTP checks.
Database tests used isolated temporary databases and removed them afterward. No restaurant
orders, accounts, or financial records were changed by the tests.

## Confirmed issues fixed

| Finding | Fix |
| --- | --- |
| Critical/high dependency advisories: six affected packages, including Next.js | Upgraded Next.js and eslint-config-next from 16.3.0 to 16.4.3, Zod to 4.6.6, and patched transitive dependencies. Final online `npm audit` reports zero known vulnerabilities. |
| Stored XSS through a counter name in the owner's close-counter popup | Use SweetAlert's `titleText` instead of its HTML-capable `title`. Order cancellation titles also use text. A malicious image/event-handler payload was checked in Chromium and remained literal text. |
| Copied session cookies remained usable after logout | Give each login a unique JWT ID and persist a hash of logged-out tokens until their expiration. Session reads reject revoked tokens. |
| Password resets and account security changes left older sessions valid | Atomically increment the account's authentication version on password, username, role, permission, and active-state changes. Other sessions are rejected immediately on their next authenticated request. |
| Owner credential changes required only an existing session | Username/password changes now require the current password and, when enabled, an unused authenticator/recovery code. The current owner receives a renewed session; older sessions are invalidated. |
| Registration accepted passwords that bcrypt silently truncates | Apply a shared 72-byte UTF-8 password limit across signup, login, account creation/reset, and 2FA password verification. |
| Missing rate limits on registration and owner counter-close verification | Apply database-backed five-minute attempt limits. Existing login and 2FA limits remain in force. |
| Upload validation trusted the submitted MIME type | Check PNG/JPEG/WebP magic bytes, claimed MIME type, file type and size before storing. Recheck stored content before serving, refuse unsupported content, and return `nosniff` and private/no-store headers. |
| CSV quoting did not stop spreadsheet formula execution | Prefix formula-like string cells with an apostrophe, including formulas after whitespace/control characters. Preserve numeric cells and CSV escaping. |
| Unbounded/invalid payment values could overflow or round fractional cents | Share finite, safely bounded, two-decimal payment validation between existing-order and new takeaway checkout. |
| Status updates trusted a TypeScript-only enum | Validate status inputs at runtime, reject prototype keys, limit cancellation reasons, and prohibit completing an unpaid order. Show failed transition messages in the UI. |
| Some database errors exposed internal details | Return generic messages for database-specific error classes while preserving deliberate application validation messages. |
| Missing browser defense headers | Add MIME sniffing protection, anti-framing policy, object/base restrictions, referrer/permissions policies, and remove the framework identification header. |
| Example signing secret could pass the old length-only validation | Reject known placeholder AUTH_SECRET values. No configured secret was printed or changed. |

Next.js advisory examples: [Windows remote code execution](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)
and [Server Actions denial of service](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r).
Authorization review followed the [OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
and the installed Next.js data-security guide.

## Validation

- `npm test`: 37 passed.
- `npm run test:db`: 30 passed, 1 skipped. The skipped test specifically exercises standalone MongoDB; the configured server is a replica set.
- The security database suite was rerun after the final payment/CSV changes: all 7 checks passed.
- `npm run lint`, targeted lint after the final changes, and `npm run build`: passed.
- Online `npm audit --json`: 0 known vulnerabilities, including development dependencies.
- Production HTTP checks on a temporary localhost-only server: login returned 200; protected reports/images returned 401; protected pages redirected to login; a forged owner cookie was rejected. Security headers were present and X-Powered-By was absent.
- Chromium popup check: an injected counter-name image/event-handler payload did not execute.
- Tracked-file check: only `.env.example` is tracked; no private-key or credential-bearing MongoDB URI patterns were found in scanned tracked application source. This was a focused pattern check, not an exhaustive secrets scan.

Regression coverage includes anonymous access, staff privilege escalation attempts, cross-restaurant
orders/categories/images/payments, server-calculated pricing, underpayment and stale quotes,
simultaneous payment requests, owner/staff password changes, cookie replay after logout, MFA code
replay and one-use recovery codes, image spoofing, CSV formulas, and payment numeric edge cases.

## Applying the updates and limits

- Restart any running development server. For deployment, rebuild and restart the application so
  the patched Next.js runtime and response headers are loaded; an already-running process retains
  its old loaded code. The temporary HTTP verification server was stopped after the checks.
- Use HTTPS in production, keep MongoDB private, and back up the stable AUTH_SECRET securely.
  Do not casually rotate AUTH_SECRET: existing authenticator keys are encrypted with a key derived
  from it. The review did not change that secret or enroll/disable any real account's 2FA.
- Legacy passwords longer than 72 UTF-8 bytes require a reset under the new consistent limit.
- Same-business cashiers can still edit/collect other cashiers' orders when granted the relevant
  permissions. This is the established workflow, not a tenant-isolation bypass.
- This was not an external penetration test or review of hosting/TLS certificates, router/firewall
  settings, backups, operating-system patches, or database credentials. Zero known dependency
  advisories does not guarantee that the application has no undiscovered vulnerabilities.
