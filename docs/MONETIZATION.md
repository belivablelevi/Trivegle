# Trivegle monetization plan

Trivegle makes money the way "random stranger" sites (Omegle-style, OMOGLE) usually do: **display ads on a free product with lots of short, repeat sessions**. On top of that it adds things trivia makes possible: sponsored rounds, cosmetic upgrades and tournaments.

**Rule #1: never pay-to-win.** Rating has to come from skill, or the leaderboard means nothing and players leave.

---

## 1. Revenue streams (in launch order)

| # | Stream | When | What's already in the code |
|---|--------|------|-----------------------------|
| 1 | **Display ads** (AdSense, then a header-bidding network) | Day 1 | Three ad slots: landing sidebar, matchmaking queue and results screen. Set them with env vars (see README). `/ads.txt` is generated automatically. Until a network is set up, each slot shows a house ad saying "Advertise with us". |
| 2 | **Trivegle+ subscription** ($3.99/mo or $29.99/yr) | Once you have about 1k daily users | "Coming soon" modal, plus a `profile.plus` flag that already hides ads. |
| 3 | **Sponsored categories** ("Science round, presented by ___") | Once you have about 5k daily users | The question bank is organized by category, so a sponsor's category is just one more entry in `BANK`. |
| 4 | **Sponsored weekly tournaments** (brand pays for the prize pool and title) | Once you have about 10k daily users | The Elo leaderboard is the base. Still needed: a time-boxed season leaderboard. |
| 5 | **Cosmetic shop** (one-time purchases: name colors, "mogged" banners, emoji reactions) | After Trivegle+ | Not built yet. |
| 6 | **Rewarded video** ("watch an ad → reroll a category in practice") | Optional | Not built yet. Only ever for practice mode, never ranked. |

### Where ads go (and where they never go)

- ✅ **Landing page sidebar**: the person isn't playing yet.
- ✅ **Matchmaking queue**: they're waiting anyway, so this has the highest viewability.
- ✅ **Results screen**: a natural pause, and the "Next stranger" button is right next to it.
- ❌ **Never during a question.** Ads there would cost people points, and players would rightly call it unfair.
- ❌ **No pop-ups or interstitials between rounds.** The chat break is the social hook. Keep it clean.

---

## 2. Trivegle+ (subscription)

Everything is cosmetic or a convenience:

- No ads
- Animated name flair and a profile badge next to your name in matchmaking
- Pick your categories in **practice** mode (ranked stays random)
- Match history and per-category accuracy stats
- Custom win banner ("YOU MOGGED 🗿" variants)

**Implementation:** use Stripe Checkout with a Stripe webhook that sets `player.plus = true` in the store. Add a `POST /api/stripe/webhook` route and verify signatures. Never trust the client to say someone has paid.

**Price check:** $3.99/mo matches typical "remove ads + cosmetics" pricing for casual web games. If about 1–3% of monthly users subscribe, Trivegle+ can bring in as much as ads do.

---

## 3. Rough revenue model (assumptions, not promises)

Assumptions: about 6 pageviews per session (each match adds a queue screen and a results screen), 2 ad slots viewed per pageview, and a blended display CPM of **$1.50**. Young, global gaming traffic earns much less than US adult traffic.

| Daily active users | Ad impressions / month | Ad revenue / mo | Trivegle+ at 1.5% of MAU | Total / mo |
|---|---|---|---|---|
| 1,000 | ~360k | ~$540 | ~$180 | **~$720** |
| 10,000 | ~3.6M | ~$5,400 | ~$1,800 | **~$7,200** |
| 50,000 | ~18M | ~$27,000 | ~$9,000 | **~$36,000** + sponsorships |

Sponsorships (sections 1.3 and 1.4) usually pay a flat fee, roughly $500–$5,000 per sponsored category per month depending on traffic. Track them separately.

---

## 4. Compliance checklist (do this before turning ads on)

- **Age:** the site requires 13+ (checked on the landing page). Don't knowingly collect data from children under 13 (COPPA). Because many players will be teenagers, **serve non-personalized ads by default**, and have a lawyer review this before scaling.
- **EU/UK consent:** AdSense requires a Google-certified consent management platform (CMP) for EEA/UK visitors. Turn on Google's built-in "Privacy & messaging" CMP or a third-party one.
- **Privacy policy and terms:** required by AdSense, Stripe, Google sign-in and Facebook Login (Meta also requires data-deletion instructions). List what's stored: your sign-in provider's account ID (no name, email or photo), nickname, rating and stats, and chat transcripts attached to reports.
- **Sign-in helps sales:** because every player has a real account, bans stick and abuse drops. That's a selling point when pitching sponsors.
- **Moderation:** advertisers won't buy on an unmoderated chat site. That's a big part of why the original Omegle shut down. What's built: profanity filter, link and contact-handle stripping, rate limiting, report with transcript, block. Before scaling, add a moderation API (e.g. OpenAI or Perspective) and a human review queue for `data/reports.jsonl`.
- **Camera mode is 18+ and opt-in.** It's the riskiest feature on the site, so:
  - **Run ads in text mode first.** Advertisers are far more cautious about live video next to their brand. Treat camera-mode inventory as a separate, lower-priority bucket until moderation is proven.
  - **Add automated video moderation** (e.g. Hive, Sightengine or AWS Rekognition sampling frames) before promoting camera mode. Video is peer-to-peer, so the client would have to send occasional snapshots for checking.
  - **Consider real age verification** for camera mode. The checkbox is self-declared. Some regions (e.g. the UK Online Safety Act) expect more for live video with strangers.
  - **Budget for a TURN relay:** about $0.40–$0.80 per GB relayed through a hosted provider. Only the ~10–20% of connections that can't go direct use it.
- **Trivegle+ perk idea:** a "camera filters & backgrounds" pack. It's cosmetic, and it makes camera mode more comfortable for camera-shy players.
