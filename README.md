# Q-Queue

A responsive React app for badminton, pickleball, and similar court queues.

Hosts can create 24-hour singles or doubles sessions, share a QR code, assign checked-in players to teams, generate round robin matches, reorder lineups and matches, mark winners, and track each player's games, wins, and losses.

## Run Locally

```bash
npm install
npm run dev
```

## Supabase Setup

The app is already wired to:

- Project URL: `https://drrxpsjkkixgphonsgrx.supabase.co`
- Publishable key: configured in `src/App.tsx`

Run `supabase-schema.sql` in the Supabase SQL editor to create the `q_queue_sessions` table and policies used for QR joiners across devices. If the table is not present, the app still works locally in the host browser and shows a Supabase sync notice.

## Checks

```bash
npm run lint
npm run build
```
