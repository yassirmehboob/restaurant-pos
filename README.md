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

Run `npm test` for financial calculation/date tests. `npm run test:db` uses the URI
from `.env.local`, creates an isolated test database, and removes it afterward.
The concurrent closing test requires a replica set and is skipped on standalone MongoDB.
The full feature specification is in [RESTAURANT_POS_CODEX_PLAN.md](RESTAURANT_POS_CODEX_PLAN.md).

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
