# Elephante Brief

**The pulse of U.S.–China tech, finance and cultural change**, for professionals whose decisions span both countries.
Live at [brief.elephantepress.com](https://brief.elephantepress.com).

Elephante Brief watches official Chinese outlets and U.S., Hong Kong and Chinese media, keeps only what will change
what a U.S.–China professional believes or does in the next 90 days (or how they read the other side), and writes
every selected story with an **English headline and summary, then a Chinese (简体) headline and summary**. Reports of
the same event are grouped, a hot list ranks what many independent sources are discussing, and a daily edition comes
out every morning at **07:00 Beijing time** (weekly on Mondays at 10:00, monthly on the 1st at 10:30).

## How selection works

Every item is scored twice, independently, on four axes (`industry/prompts/selection-score.md`):

| Axis | Points | What it asks |
|---|---|---|
| Stakes | 0–3 | The higher of two readings: cross-border stakes in trade, capital, tech, policy, people or culture *between* the two countries; or significance as U.S./Chinese business, markets, policy or tech news, with no China angle needed (3 = the day's top story such as a Fed decision, big tech earnings, launches or deals, major AI or regulation news; 2 = significant sector news; 1 = minor). |
| Speaker's cost of being wrong | 0–3 | Primary documents, regulations, filings, named on-record officials and money committed score high; anonymous sourcing, punditry and PR low. For culture: real sales, box office, bookings, search spikes. |
| Seam asymmetry | 0–2 | Big in one language, thin or framed differently in the other (tagged `one-side-only`). |
| Quiet signal | 0–2 | Low heat, high stakes: draft rules, procurement, licensing, personnel and hiring shifts (tagged `quiet-signal`). |

The score is 10 × the sum (0–100), capped at 20 only for items that are neither cross-border nor major business, markets, policy or tech news. Asymmetry and quiet signal are bonuses. An item is selected when the two
scores average at least its source tier's threshold (`industry/selection.ts`) and grouping confirms it is not a repeat.
Cultural signals are tagged `culture`.

**Claims ledger.** The structure step extracts every checkable claim or forecast (speaker, claim, deadline, quote) and
tags the item `claim`. List the claims due for checking 30 and 90 days later with:

```bash
node --env-file=.env scripts/claims-due.ts            # due today, ±3 days
node --env-file=.env scripts/claims-due.ts --days 90 --window 7 --json
```

**Editor's picks from X bookmarks** (`modules/x-bookmarks`). Every 15 minutes the worker reads the editor's new X
bookmarks (X API v2, OAuth 2.0 user login). X's terms do not allow republishing post text, so none is ever public:

- A bookmark that links an article brings in **only the article**, as source “X — Editor's picks” (T1): title and
  description from the link card, page fetched from the publisher. It is always selected, tagged `editor-pick`
  (topic “Editor's Picks”), and its “Why it matters” line ends with “Editor's pick: <link to the post>”.
- A bookmark with no article link is kept privately under “X — Editor's bookmarks”, a heat-only source: admin only,
  with no page and absent from the lists, RSS, API and reports. It only adds heat to the story it belongs to.

Both kinds count as positive gold labels. Reads are billed and count against the `x_api` budget (200 a day by
default; adjust it in the admin). Set `X_CLIENT_ID`, `X_CLIENT_SECRET` and `X_REDIRECT_URI` in `.env`, then log in once:

```bash
docker compose run --rm worker node scripts/x-auth.ts
node --env-file=.env modules/x-bookmarks/scripts/gold.ts   # add the picks to .data/gold.jsonl as "select" labels
```

## Where things live

| Path | What |
|---|---|
| `site/` | Name, copy, edition times (`site.ts`), models (`models.ts`), brand, terms and privacy pages, changelog |
| `industry/` | Categories and tags (`taxonomy.ts`), topics, seed sources, prompts, thresholds |
| `apps/`, `packages/` | The engine: web, API, worker, and the shared backend |
| `setup-server.sh` | One-shot setup on the production droplet |
| `docs/` | Engine documentation (architecture, selection and calibration, sources, deployment) |

## Run it

On the server (Ubuntu/Debian droplet, DNS for `brief.elephantepress.com` pointing at it):

```bash
curl -fsSLO https://raw.githubusercontent.com/egggc/elephante-brief-wire/main/setup-server.sh
bash setup-server.sh <OPENROUTER_API_KEY>
```

It checks ports 80/443, adds swap if there is none, installs Docker and Node 24 only if missing, clones into
`~/elephante-brief-wire`, writes `.env`, checks every seed feed from the server, starts the stack behind Caddy (HTTPS)
and prints the admin password. It does not touch `~/elephante-brief` or the crontab.

Locally: `node scripts/init-env.ts --llm-key <key>` then `docker compose up -d --build` (http://localhost:3000).

Checks after a change:

```bash
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/elephante_test npm test
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000
```

## Model

Every step uses MiniMax M2.5 through OpenRouter's OpenAI-compatible API (`LLM_BASE_URL`, `LLM_MODEL`,
`LLM_API_KEY` in `.env`). Steps can be switched one by one in the admin under “Models & evals”.

## License

The code is MIT-licensed (see `LICENSE` and `NOTICE`; this site is built on an open-source news-site engine).
Original articles belong to their publishers; by default the site shows only summaries and links to the originals.
