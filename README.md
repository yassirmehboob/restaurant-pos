This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Sale sessions require MongoDB Atlas or a MongoDB replica set with transaction support.
The application does not convert a standalone MongoDB server automatically. Configure
the server first, then set `MONGODB_URI` in `.env.local` (for an initialized local
`rs0`, use `mongodb://127.0.0.1:27017/restaurant-pos?replicaSet=rs0`).

Use **Start / Close Sale** to choose a counter, sale date, and opening cash. That date
continues past midnight until closing. Shared logins share a shift; separate accounts
and counters can run simultaneously. Closing permits another shift on the same date.
The closing screen shows both the overall balance and expected physical cash.

Each account can enable optional two-factor authentication under **Security / 2FA**.
Enter the current password, scan the setup QR code in an authenticator app (or enter
the setup key manually), verify a six-digit code, and save the eight recovery codes. Login
then requires the password plus an authenticator code or an unused recovery code.
Disabling 2FA requires the password and a valid second factor. Enabling/disabling
revokes other sessions. Setup expires after ten minutes; login/security verification
is limited to ten attempts per account per five-minute window.

Authenticator keys are encrypted using a key derived from `AUTH_SECRET`; recovery
codes are hashed and consumed once. Keep `AUTH_SECRET` stable and backed up securely:
changing it invalidates sessions and prevents decrypting existing authenticator keys.
The authenticator follows [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238).

Run `npm test` for financial calculation/date tests. `npm run test:db` uses the URI
from `.env.local`, creates an isolated test database, and removes it afterward.
The concurrent closing test requires a replica set and is skipped on standalone MongoDB.
The full feature specification is in [RESTAURANT_POS_CODEX_PLAN.md](RESTAURANT_POS_CODEX_PLAN.md).

The local security review, fixes, test results, and deployment notes are documented in
[SECURITY_REVIEW.md](SECURITY_REVIEW.md). Restart the application after installing dependency
security updates. Logout revokes the current token; password/access changes revoke older
sessions. Owner username/password changes require current credentials and 2FA when enabled.

Production load-test results and before/after performance measurements are in
[performance/REPORT.md](performance/REPORT.md). After `npm run build`, run
`npm run test:load -- --label=local --orders=10000 --seconds=6 --concurrency=2,10,25 --writes=30`.
The runner uses an isolated temporary database and a separate localhost production server,
checks payment integrity, writes JSON metrics, and removes its test database afterward.
Add `--soak=60` for a one-minute mixed two-counter run.

Owners can configure optional automatic kitchen progress under **Setup → Kitchen Timing**.
Manual mode is the default. Preparing starts after the configured seconds from sending
the order to kitchen; Ready follows the configured minutes after preparation starts.
Manual controls remain available in both modes. Timing changes also apply to waiting
and preparing orders that already exist.

`npm run dev` and `npm start` launch both Next.js and a kitchen timing worker with
15-second checks. Restart an already running server after this update to start the worker.
Production hosts that launch Next directly or use serverless hosting must run
`npm run worker:kitchen` as a separate, supervised, always-on Node process with the same
environment/database. The kitchen page also catches up overdue orders on refresh.
Keep the app/worker running for automatic changes while kitchen browsers are closed.

Kitchen Display shows waiting, preparing, and ready orders from every open counter's
sale session. These orders remain visible for five hours after their sale closes,
including when no counters remain open. Older sessions are hidden from the kitchen
display; their orders remain in history.

Waiter accounts open **Waiter Orders** (`/waiter`) without starting a cashier sale.
They select a table, browse items/deals and sizes, add quantities/instructions,
and submit orders. They can revise their own pending requests until a cashier,
admin, or owner confirms them in **Waiter Approval** (`/waiter-requests`).
Confirmation locks the request and creates one kitchen order in the confirming
cashier's open sale. Concurrent edits or duplicate approvals cannot overwrite it.
Waiter accounts use only the waiter workspace, including existing accounts with
older POS grants, so cashier approval and bill visibility cannot be bypassed.

The owner controls **Show menu prices and bill summary on waiter screens** under
**Setup → Business Profile → Waiter screens**. It defaults to off and excludes
prices and summaries from waiter device payloads. Cashiers always see summaries.
Waiter status refreshes every five seconds while the screen is open. Browser
notifications are opt-in and need HTTPS (localhost is suitable for desktop tests).
On iPadOS 16.4+, add the app to the Home Screen, launch it there, and select
**Enable notifications**. See [Apple's Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

For background notifications, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
`VAPID_SUBJECT` in both the app and kitchen worker environments, then restart them.
Generate a stable pair with `npx web-push generate-vapid-keys`; use a real contact
URI such as `mailto:owner@your-restaurant.example` for the subject. Keep the private
key in deployment secrets. Without these variables, on-screen and foreground
browser alerts work; the UI explains that background alerts need configuration.
Push payloads contain only a generic update alert, with no order numbers, amounts,
customer details, tables, or statuses. Actual order details require signing in.
Notifications stop for expired/revoked sessions or disabled/changed accounts;
opening the waiter screen renews an existing device subscription for the current
login. Supported push services are Apple, Google, Mozilla, and Windows.

SMS subscriptions and paid-order messages are configured by the owner under
**Setup → Business Profile → SMS messaging**. Set `SMS_API` in `.env.local` to the
gateway base URL; the sender posts to `{SMS_API}/v1/messages`. Paste the token
assigned to this business (without `Bearer`) into the subscription field. It is
stored encrypted in the business record using `AUTH_SECRET`, bound to that
business, and excluded from normal database selections and client responses.
Keep `AUTH_SECRET` stable and backed up; changing it requires replacing stored
SMS tokens as well as reconfiguring existing encrypted authenticator secrets.

Both **Enable SMS sending** and **Send SMS after payment** must be on. Both default
to off. Build a message using the dynamic-field buttons and sample preview, then
save. Supported fields include customer/restaurant names, order number, currency,
amount paid, order total, payment method/date, customer phone, and table name.
Use `{{customer_name}}` and the other double-brace placeholders shown in the editor.
Templates allow 1,000 characters; rendered messages allow 1,600.
**Send SMS after payment** controls whether payment receipt messages are sent.
The separate **Include opt-out instructions** switch controls the API's
`includeOptOut` boolean, stored as `smsIncludeOptOut` for each business. It defaults
to on for existing and new businesses. Turning only opt-out instructions off
still sends payment messages, with `includeOptOut: false`. The gateway adds the
STOP / START text when this flag is true; the app does not duplicate it in `body`.
The preview shows sample opt-out wording. Changes also apply to pending messages
when they are submitted. Messages send the configured
`evidenceReference` (default `customer-acknowledgement`). Set that reference to the
value associated with the customer's acknowledgement at your gateway.

Successful full payment queues one receipt per order, for both existing orders
and immediate takeaway payments. The queue is committed in the same database
transaction as payment, and delivery happens afterward. No SMS is sent for failed
payments. Select a customer with a valid phone on the order; Pakistani `03...`
mobile numbers are normalized to `+92...`, and other numbers must be international.
Missing/invalid numbers are marked skipped in recent message history.

Restart `npm run dev` or `npm start` after this update: these commands now launch
the SMS queue worker alongside Next.js and the kitchen worker. For hosts that
launch Next.js directly, run `npm run worker:sms` as a separate supervised Node
process with the same database, `AUTH_SECRET`, and `SMS_API` environment variables.
Queue checks run every five seconds. Turning either SMS switch off skips pending
messages before their next submission; requests already in flight cannot be recalled.

**Setup → SMS History** (`/settings/sms`) is a separate owner-only page with search,
message-type and queue-state filters, pagination, and ten-second refreshes. Its
**API status** column shows the exact top-level `status` value returned by the
gateway, alongside separate **HTTP** and **Queue state** columns. Text, numeric,
and boolean API statuses are captured; malformed, empty, missing, or unsupported
responses are identified explicitly. Old messages show **Not recorded** because
their response bodies were previously discarded. Restart the SMS worker to capture
API statuses for new submissions. Only the status field is retained, with token
values redacted; complete responses and authorization headers are not stored.

The **Submitted** queue state means an HTTP success response, not confirmed handset
delivery. API status is the response returned at submission time; no delivery-status
polling or webhook is implied. Since no provider
idempotency or delivery-status API was supplied, failures and uncertain submissions
are not automatically resent. Timeouts, 5xx responses, and interrupted sends are
marked **Uncertain** to avoid duplicate texts. Full gateway error bodies and
subscription tokens are never written into message logs. Tests use a mocked sender
and isolated databases; they do not send live SMS.

Delivery orders also support **Business Profile → Delivery messages** with three
independently customizable messages: **Order placed**, **Out for delivery**, and
**Delivered**. Each has its own sending toggle, opt-out toggle, template editor,
dynamic-field buttons, and customer preview. Delivery toggles default to off.
They share the business's existing SMS subscription token, acknowledgement
reference, and master **Enable SMS sending** switch. They work independently of
the payment receipt switch. Delivery completion sends only the Delivered message,
even when payment receipts are also enabled; it does not add a payment SMS.

Saving a new delivery order queues **Order placed**. On the order detail page,
cashiers or staff with both order-view and order-edit permissions can select
**Out for delivery** once the kitchen marks the order ready, then **Mark delivered**
when the customer receives it. Each transition and its SMS queue entry commit
together, with one message per order and stage. Editing an order does not send
another placed message; dispatched deliveries cannot be edited. Kitchen-ready
updates alone do not indicate that an order has left the restaurant.

**Mark delivered** always opens a popup. Unpaid delivery orders open **Receive
payment & deliver**. Successful payment, Delivered status, and the one Delivered
SMS queue entry commit together. Cancelling or failing payment leaves the order
out for delivery with no Delivered SMS. New delivery orders cannot be prepaid
through the ordinary payment controls. Existing already-paid delivery orders
still require an explicit **Confirm delivered** popup, without collecting another
payment. Delivery templates can include `{{delivery_address}}`,
`{{delivery_area}}`, `{{delivery_charge}}`, `{{delivery_status}}`, `{{event_at}}`, and
`{{business_phone}}`, alongside the existing customer/order fields. Cancelled or
converted-away delivery orders have pending delivery messages skipped.

Restart the app and SMS worker after this update. Startup automatically replaces
the old one-message-per-order SMS index with a per-order, per-message-type index,
preserving existing receipt records. The sender checks each delivery stage's own
sending and opt-out preferences before submission. SMS History labels the
message type so delivery updates can be distinguished from payment receipts.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Backups and restore

Open Setup > Backups & Restore for manual backups, daily/weekly/interval schedules, last-counter-closing backups, optional Google Drive copies, and verified restoration into a separate database. Restart the app to start the new backup worker. See [backup setup and recovery](docs/BACKUPS.md) for storage, keys, permissions, migration and recovery commands.

