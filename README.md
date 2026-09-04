# Fitness Companion

A personal training companion that builds each session around what you
actually have today — your equipment, your time, how sore you are, what's
injured, and how much energy you've got — then walks you through it with
timers and rep targets, and tracks your progression session to session.

Your own Claude (or Gemini) key sits behind it, on a small server you run.
The phone and the laptop both talk to that server, so they share one training
history and one API key.

---

## The short version

```bash
git clone <this repo> && cd fitnessCompanion
npm install
cp .env.example .env      # add AUTH_TOKEN and ANTHROPIC_API_KEY
npm run build
npm start                 # http://localhost:8080
```

Open the URL on your laptop. That's the local setup; to reach it from a
hotel or anywhere else, deploy it to Cloudflare — see
[From anywhere](#from-anywhere--deploy-to-cloudflare).

Requires Node 22.5 or newer (it uses the built-in `node:sqlite`, so there is
no native module to compile — it runs on a Raspberry Pi without a toolchain).

---

## What it does

**Builds a session from today's constraints.** Pick your equipment, how long
you have, what's sore, what's injured, and how you feel. You get a complete
session — warm-up, main work, accessories, core — that fits the time you gave
it and avoids anything that loads an injured joint.

**Runs the session.** Timed work gets a countdown; rep work shows the target
and lets you log what you actually did. Rest timers start automatically. The
screen stays awake, and the countdown keeps correct time even if you lock the
phone mid-rest.

**Explains every exercise.** Tap any exercise name for how to do it, three
form cues, and a link to a video demonstration.

**Pitches it at the right level.** A beginner/intermediate/advanced setting
decides where in the rep range you start, how close to failure you work, and
how technical a variation you get. Without it the planner has no signal and
defaults everyone to the easiest option.

**Two ways to change a session, and only one of them costs anything.**

*Free and instant* — **Harder**, **Easier**, **+15 min**, **−15 min**,
**Different exercises**, and per-exercise **Swap** / **Remove** from the
exercise sheet. These are deterministic: the planner already knows how to
shift difficulty, move the clock, and pick another movement of the same
pattern. No model, no tokens, no waiting.

*The AI box* — for what the buttons cannot express. *"My left shoulder has
been pinching on anything overhead for two weeks but it's fine on horizontal
pressing — keep the volume but work around it, and give me something for the
rotator cuff at the end."* That needs judgement, and costs about half a cent.

After you finish, it asks how the session went on a five-point scale plus an
optional note.

That rating is not decoration. The **planner itself** reads it and adjusts the
next session's intensity with no AI call at all: rate a session "too easy" and
the next one comes back with lower reps-in-reserve, harder variations, and a
bumped experience level. The note goes into the training digest the model
sees.

Note the lever is intensity, not volume — the session has a fixed time budget,
so adding sets would only crowd exercises out of the same 45 minutes.

**Tracks progression.** Every logged set feeds an estimated 1RM and a double
progression rule: work up the rep range at a fixed load, then add load and
drop back down. Three sessions without improvement triggers a 10% deload.

**Talks to you.** A chat tab where you can ask why a session looks the way it
does, or what to do about a niggle.

---

## How it keeps the API bill down

This was a design constraint, not an afterthought. The single biggest saving
is that **most sessions never call the model at all.**

The routing ladder, cheapest first:

| # | Path | Cost | When |
|---|------|------|------|
| 1 | Plan cache | zero | Identical request seen in the last 12h |
| 2 | Deterministic planner | zero | No free-text note — the common case |
| 3 | Planner draft + AI patch | ~½¢ | You wrote a note, or asked for AI input |

Everything the model would otherwise reason about — filtering by equipment,
excluding exercises that load an injured joint, avoiding sore muscles,
picking loads from your history, fitting the time budget — is deterministic
code. The model is only consulted when you say something that code can't
interpret, like *"shoulder felt off yesterday, go easy on pressing."*

When it *is* consulted, four things keep the call small:

- **A frozen, cached prompt prefix.** The rules and the exercise catalog
  (~2,030 tokens) are byte-identical on every request and cached for an hour,
  so repeat calls bill that portion at roughly a tenth of the input rate.
- **A training digest instead of raw logs.** Your history is compressed to a
  ~70-token summary — cadence, key lifts and their trend, under-trained
  muscles, standing notes — and rebuilt only when you log a session. Sending
  raw logs would be tens of thousands of tokens per call, and almost none of
  it changes the answer.
- **Patches, not plans.** The model receives the deterministic draft and
  returns only the operations that improve it — usually none. A full plan
  would be 1,000+ output tokens; a patch is typically under 200.
- **Low effort by default.** Planning is a well-specified structured task, so
  `AI_PLAN_EFFORT=low`. Raise it if sessions feel shallow.

Rough cost of one AI-assisted session on the default `claude-sonnet-5`, from
the measured prompt sizes above:

```
cached prefix   2,030 tok  ×  $0.20/M   =  $0.00041
fresh input       210 tok  ×  $2.00/M   =  $0.00042
output (patch)    150 tok  ×  $10.00/M  =  $0.00150
                                           --------
                                           ~$0.0023   (~2,100 calls per $5)
```

Same call without prompt caching would be about **2.5× more**; without the
patch shape, about **5× more**. A session built by the planner alone is free.

**Picking a model — cheaper is not always cheaper.** Prompt caching has a
minimum prefix length that varies *non-monotonically* by model, and a prompt
below it silently never caches (no error — just full price on every token,
every call). This app's system prompt is ~2,030 tokens:

| Model | Cache minimum | Caches here? | Per call |
|---|---:|---|---:|
| Claude Opus 5 | 512 | yes | $0.0058 |
| **Claude Sonnet 5** (default) | 1,024 | yes | **$0.0023** |
| Claude Haiku 4.5 | 4,096 | **no** | $0.0030 |

Haiku is the cheapest per token and the *second most expensive* per call,
because it is the only one of the three that cannot cache this prompt. Check
the cache minimum before switching `AI_MODEL`, and confirm afterwards that the
**You** tab still shows a non-zero cache hit rate.

Two safety nets:

- `AI_MONTHLY_BUDGET_USD` (default `$5`) is a hard rolling-30-day ceiling.
  When you hit it, AI calls stop and sessions fall back to the deterministic
  planner — the app never stops working, it just stops spending.
- Any AI failure — bad key, network, rate limit, refusal — degrades to the
  planner rather than erroring.

---

## On your phone

Both devices talk to the same server, so pick how the phone reaches it.

### Same Wi-Fi (simplest)

1. Find your computer's LAN address (`ipconfig getifaddr en0` on macOS,
   `hostname -I` on Linux).
2. On the phone, open `http://<that-address>:8080`.
3. **Share → Add to Home Screen.** You get an icon and a full-screen app.
4. Open it, go to **You**, and paste your `AUTH_TOKEN`.

Leave the server address blank if you loaded the app from the server itself.

### From anywhere — deploy to Cloudflare

This is the setup for travelling: the app lives on Cloudflare's edge, so a
hotel room at 7am needs nothing running at home. Storage is D1, Cloudflare's
SQLite, and the PWA is served from the same Worker.

You need a Cloudflare account and a domain on it (a `workers.dev` subdomain
works too if you'd rather not use your own).

```bash
npm install
npx wrangler login                    # opens a browser to authorise

npx wrangler d1 create fitness        # prints a database_id — copy it
#   paste it into packages/worker/wrangler.toml -> [[d1_databases]] database_id

npm run build                         # must precede db:init, which reads dist/
npm run db:init -w @fc/worker         # creates the tables in remote D1

cd packages/worker
npx wrangler secret put AUTH_TOKEN            # any long random string
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ANTHROPIC_WORKSPACE_ID  # only for identity-linked keys
cd ../..

npm run deploy                        # builds everything, then wrangler deploy
```

Secrets go through `wrangler secret put`, never into `wrangler.toml` — that
file is in git. Non-secret settings (model, budget, effort) live in its
`[vars]` block where you can see and change them.

**Custom domain.** In the dashboard: Workers & Pages → `fitness-companion` →
Settings → Domains & Routes → Add custom domain → `fitness.cagliyangil.com`.
Because the domain is already on Cloudflare, DNS and the certificate are
handled for you. You get HTTPS, which is also what iOS wants before it will
treat the app as properly installable.

Then open `https://fitness.cagliyangil.com` on the phone, Add to Home Screen,
and paste your `AUTH_TOKEN` in the **You** tab. Leave the server address
blank — the Worker serves the app and the API from one origin.

**Cost.** For one person this sits inside Cloudflare's free tier: Workers
allows a large daily request count and D1's free storage and row limits are
far beyond what a training log uses. Your only real spend is the Anthropic
API, which the budget cap already governs.

**Optional second lock.** Cloudflare Access can require a login before any
request reaches the Worker, on top of the bearer token. Worth it if you'd
rather the app not be publicly reachable at all.

### Working on it locally

`npm run dev` runs the Node server against a local SQLite file — fastest for
development. To exercise the real Workers runtime and a local D1 instead:

```bash
npm run db:init:local -w @fc/worker
npm run worker:dev
```

## Configuration

Everything lives in `.env` — see `.env.example` for the annotated list. The
ones worth knowing:

| Variable | Default | What it does |
|---|---|---|
| `AUTH_TOKEN` | — | Shared secret. Required unless `ALLOW_NO_AUTH=true`. |
| `ANTHROPIC_API_KEY` | — | Without it, sessions still work; chat doesn't. |
| `AI_MODEL` | `claude-sonnet-5` | Any current model id — read the cache-minimum note above before changing. |
| `AI_PLAN_EFFORT` | `low` | Thinking depth for planning. |
| `AI_MONTHLY_BUDGET_USD` | `5` | Hard 30-day ceiling. `0` disables. |
| `PLANNER_FIRST` | `true` | `false` routes every session through the model. |
| `AI_PROVIDER` | `anthropic` | Or `gemini`. |

### Switching to Gemini

Set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`. Gemini prices aren't bundled —
set `GEMINI_INPUT_USD_PER_MTOK` and `GEMINI_OUTPUT_USD_PER_MTOK` from
Google's current pricing page, or the usage ledger will report `$0`.

> The Gemini path is written against Google's REST API and typechecks, but
> has not been exercised against the live service. The Anthropic path is the
> one that's been built out properly.

---

## Architecture

```
packages/
  shared/   Types, the exercise library, progression math.
            The contract every client speaks.
  server/   The API as a Hono app, plus the planner, AI provider layer,
            patch validation and usage ledger. Storage sits behind a Store
            interface with two backends: node:sqlite and Cloudflare D1.
  worker/   Cloudflare entry point. Binds D1 and Workers Assets, then
            mounts the same Hono app.
  web/      React PWA. Talks only to the HTTP API.
```

The API is written once and runs on both runtimes — Hono works on Node and on
Workers, and every SQL query lives in `store/base.ts` against a three-method
driver, so the SQLite and D1 backends cannot drift apart. The database schema
has one definition (`store/schema.ts`); `npm run schema -w @fc/worker` renders
it to `schema.sql` for D1 migrations.

`shared/` exists so a native client doesn't have to reimplement the training
brain. Everything interesting — planning, progression, prompt construction,
cost routing — is server-side and reachable over plain HTTP.

### Adding exercises

`packages/shared/src/exercises.ts`. Each entry declares the equipment it
needs, the muscles it works, the movement pattern, and which joints it
loads — that last field is what excludes it when you flag an injury, so get
it right. The planner and the AI catalog both pick it up automatically.

### Videos

Every exercise links to a YouTube **search** for its name, which always
resolves to relevant demonstrations. To pin a specific clip, add a
`youtubeId` to that exercise's `video` field:

```ts
video: { query: "Barbell Back Squat proper form", youtubeId: "SW_C1A-rejs" },
```

I didn't hardcode video ids because I had no network access to verify them,
and a confidently wrong link to the wrong exercise is worse than a search.

---

## Development

```bash
npm run dev        # server on :8080, web on :5173 with API proxy
npm run typecheck
npm test           # planner guardrails and AI patch validation
```

The tests cover the parts where a bug would actually hurt you: that an
injured joint is never loaded, that unavailable equipment is never
prescribed, that a sore muscle is never the primary target, that the time
budget is respected in both directions, and that a hallucinated exercise from
the model is rejected rather than shown to you.

---

## The native app path

You picked "PWA first, native later," so the AI logic, exercise library, and
progression tracking all live behind the server's HTTP API rather than in the
client. A SwiftUI app would talk to the same endpoints and get the same
brain — `POST /api/plans/generate`, `POST /api/logs`, `GET /api/exercises`,
`POST /api/chat`.

What going native would buy you, and the PWA can't: HealthKit, background
audio cues between sets, Live Activities on the lock screen, and an Apple
Watch companion.

---

## Known limitations

- **The AI path hasn't run against a live API.** There was no API key in the
  environment this was built in. It typechecks against the current SDK and
  the patch-validation logic is tested with synthetic responses, but the
  first real call is yours. If it fails, the app falls back to the planner
  and the **You** tab will show zero AI calls.
- **Injury filtering is deliberately conservative.** Flagging a shoulder
  removes a lot of upper-body work. If it's stricter than you need, either
  don't flag it or edit the `stresses` tags in the exercise library.
- **Single user.** No accounts, one shared token, one training history.
- **No deload weeks or periodisation.** Progression is per-exercise; there's
  no notion of a training block or a planned deload beyond the automatic
  stall response.
