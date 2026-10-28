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
