# Trivegle 🧠

**Talk to strangers. Out-think them.**

Trivegle is a trivia practice app that works like Omegle and OMOGLE. You get matched with a random stranger, play three rounds of trivia, chat between rounds, and the winner "mogs" the loser and climbs the leaderboard.

## Features

- **Random 1v1 matchmaking** ("Battle a stranger") plus a **Next stranger** button, Omegle-style.
- **Multi-round battles:** 3 rounds × 3 questions across 8 categories. Faster answers earn bonus points, and **the final round is worth double**.
- **Chat break between rounds** with a random conversation topic ("Pineapple on pizza: yes or no?"). Chat stays open after the match so players can say GG.
- **Elo leaderboard:** wins, losses, draws, best streak and accuracy. Beating higher-rated players is worth more. Leaving mid-match counts as a forfeit.
- **Practice mode** against an Easy, Medium or Hard bot. It's unranked and always labelled as a bot.
- **Safety:** 13+ age gate, profanity filter, link and contact-handle stripping, chat rate limiting, report (saves the chat transcript) and block (you're never matched with that player again). Chat is text only.
- **Monetization built in:** configurable ad slots (landing, queue, results; never during questions), an auto-generated `ads.txt`, a "Trivegle+" upsell, and an "Advertise with us" page.

## Run it

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # same, restarts on file changes
npm test             # unit + match engine + end-to-end socket tests
```

Open two browser windows (or one normal and one private) to play against yourself.

## Configuration

| Env var | Purpose |
|---------|---------|
| `PORT` | HTTP port (default `3000`) |
| `ADSENSE_CLIENT` | e.g. `ca-pub-1234567890123456`. Turns on Google AdSense and `/ads.txt` |
| `ADSENSE_SLOT_LANDING` / `ADSENSE_SLOT_QUEUE` / `ADSENSE_SLOT_RESULTS` | AdSense slot IDs for each placement |

Without AdSense settings, each slot shows a house ad that opens the "Advertise" modal.

Player data is saved to `data/players.json` and reports to `data/reports.jsonl`. Both are gitignored.

## Project layout

```
server/
  index.js       entry point
  app.js         Express + Socket.IO: matchmaking, chat, reports, REST API
  match.js       the match engine (rounds, questions, scoring, breaks, forfeits); doesn't touch sockets
  bot.js         practice bot with easy/medium/hard accuracy and speed
  questions.js   question bank (8 categories) and chat-break topics
  store.js       JSON-file player store (ratings, stats, hashed tokens)
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
- Add a moderation API and a review workflow for `data/reports.jsonl`.
- Add a privacy policy, terms of service and a consent banner (required by AdSense in the EU/UK). See `docs/MONETIZATION.md`.
- Put it behind HTTPS (e.g. Render, Railway or Fly.io; they all run `npm start` as-is).
