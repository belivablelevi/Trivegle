# Trivegle 🧠

**Talk to strangers. Out-think them.**

Trivegle is a trivia practice app that works like Omegle and OMOGLE. You get matched with a random stranger, play three rounds of trivia, chat between rounds, and the winner "mogs" the loser and climbs the leaderboard.

## Features

- **Sign in required** with **Google, Facebook or Discord**. Only the provider's account ID is stored: no real name, email or photo. Players choose a unique nickname, and that's all strangers see.
- **Random 1v1 matchmaking** ("Battle a stranger") plus a **Next stranger** button, Omegle-style.
- **Multi-round battles:** 3 rounds × 3 questions across 8 categories. Faster answers earn bonus points, and **the final round is worth double**.
- **Chat break between rounds** with a random conversation topic ("Pineapple on pizza: yes or no?"). Chat stays open after the match so players can say GG.
- **Elo leaderboard:** wins, losses, draws, best streak and accuracy. Beating higher-rated players is worth more. Leaving mid-match counts as a forfeit.
- **Text mode or Camera mode.** Text mode (the default, 13+) is chat only. Camera mode (18+, opt-in) adds Omegle-style video: two equal-sized cameras stacked on the left (stranger on top, you below), with the game and chat beside them:
  - Camera players are only matched with other camera players.
  - Video goes directly between the two players (WebRTC); it never passes through or gets stored on the server.
  - The stranger's video starts **blurred** until you tap Reveal, and your mic starts muted.
  - You can turn your camera off, mute, or hide the stranger at any time. Reporting or blocking cuts the video instantly.
- **Practice mode** against an Easy, Medium or Hard bot. It's unranked and always labelled as a bot.
- **Safety:** 13+ age gate, profanity filter, link and contact-handle stripping, chat rate limiting, report (saves the chat transcript) and block (you're never matched with that player again).
- **Monetization built in:** configurable ad slots (landing, queue, results; never during questions), an auto-generated `ads.txt`, a "Trivegle+" upsell, and an "Advertise with us" page.

## Run it

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # same, restarts on file changes
npm test             # unit + match engine + end-to-end socket tests
```

With no sign-in providers configured, local development shows a **Dev sign-in** button so you can test right away. Open two browser windows (one normal, one private) and sign in as two different nicknames to play against yourself. Camera mode needs `localhost` or HTTPS, because browsers only allow camera access on secure pages.

## Configuration

| Env var | Purpose |
|---------|---------|
| `PORT` | HTTP port (default `3000`) |
| `PUBLIC_URL` | Your site's public URL, e.g. `https://trivegle.com`. Used for sign-in callback URLs and secure cookies |
| `SESSION_SECRET` | Long random string used to sign login cookies. **Required in production** (`openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Turns on "Continue with Google" |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` | Turns on "Continue with Facebook" (Facebook calls these App ID / App Secret) |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Turns on "Continue with Discord" |
| `DEV_LOGIN` | `1` forces the dev sign-in button on. It's on automatically in development when no providers are set. **Never enable it in production** |
| `ADSENSE_CLIENT` | e.g. `ca-pub-1234567890123456`. Turns on Google AdSense and `/ads.txt` |
| `ADSENSE_SLOT_LANDING` / `ADSENSE_SLOT_QUEUE` / `ADSENSE_SLOT_RESULTS` | AdSense slot IDs for each placement |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | Optional TURN server for camera mode. Without one, video fails for players on some strict networks (school, office, some mobile carriers); chat and the game still work |

Without AdSense settings, each slot shows a house ad that opens the "Advertise" modal.

## Setting up sign-in

Each provider only appears on the sign-in screen once its two env vars are set. The callback URL is always `PUBLIC_URL/auth/<provider>/callback`. For local testing that's `http://localhost:3000/auth/google/callback`, and so on.

**Google**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **OAuth consent screen**, and set up an External app (name, support email, privacy policy link).
2. Go to **Credentials** → Create credentials → **OAuth client ID** → Web application.
3. Add the authorized redirect URI `https://YOUR_DOMAIN/auth/google/callback` (plus the localhost one for testing).
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Trivegle only asks for the `openid` scope, so Google's app verification isn't needed.

**Facebook**
1. Go to [Meta for Developers](https://developers.facebook.com/apps) → Create app → choose "Authenticate and request data from users with Facebook Login".
2. Under Facebook Login → Settings, add the valid OAuth redirect URI `https://YOUR_DOMAIN/auth/facebook/callback`.
3. Under App settings → Basic, add a privacy policy URL and data-deletion instructions (Meta requires both to go Live). Then copy the App ID and App Secret.
4. Only `public_profile` is requested, so no App Review is needed.

**Discord**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application → **OAuth2**.
2. Add the redirect `https://YOUR_DOMAIN/auth/discord/callback`, then copy the client ID and reset/copy the client secret.

**Adding another provider** (Apple, Twitch, X…): add one entry to `PROVIDERS` in `server/auth.js` with its authorize URL, token URL, scope and a function that returns the user's account ID.

**Banning a player:** reports in `data/reports.jsonl` include the reported player's ID. Set `"banned": true` on that player in `data/players.json` and restart. They're signed out and can't sign back in with that account.

## Data

Player data is saved to `data/players.json` and reports to `data/reports.jsonl`. Both are gitignored.

## Project layout

```
server/
  index.js       entry point
  app.js         Express + Socket.IO: matchmaking, chat, reports, REST API
  match.js       the match engine (rounds, questions, scoring, breaks, forfeits); doesn't touch sockets
  bot.js         practice bot with easy/medium/hard accuracy and speed
  questions.js   question bank (8 categories) and chat-break topics
  auth.js        sign-in with Google / Facebook / Discord, signed session cookies
  store.js       JSON-file player store (linked accounts, ratings, stats)
  elo.js         rating math
  moderation.js  chat/name filtering and rate limiting
public/          single-page frontend (vanilla JS, no build step)
docs/
  MONETIZATION.md      how Trivegle makes money
  ADVERTISING_PLAN.md  how Trivegle gets players
test/            node:test suites
```

## Adding questions

Add entries to `BANK` in `server/questions.js` as `[question, correct, wrong1, wrong2, wrong3]`. Choices are shuffled for each match. Each category needs at least 3 questions. A new category key becomes a new round theme automatically, which is also how a **sponsored category** works.

## Before going to production

- Swap the JSON store for Postgres or Redis if you run more than one server process (and use the Socket.IO Redis adapter).
- **Camera mode:** add a TURN server (e.g. Twilio, Cloudflare or self-hosted coturn) and an automated video-moderation provider before promoting camera mode widely. The 18+ checkbox is self-declared; consider real age verification.
- Add a moderation API and a review workflow for `data/reports.jsonl`.
- Set `SESSION_SECRET` and `PUBLIC_URL`, and don't set `DEV_LOGIN`.
- Add a privacy policy, terms of service and a consent banner (required by AdSense in the EU/UK). See `docs/MONETIZATION.md`.
- Put it behind HTTPS (e.g. Render, Railway or Fly.io; they all run `npm start` as-is).
