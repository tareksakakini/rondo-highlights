# Rondo Highlights

**Football highlights, back to back.** Pick a competition and a round, press *Play all*, and every match's highlights play one after another. You can also build your own queue, choose short or extended cuts, and see only what's licensed in your country.

In football, a *rondo* is the passing drill where the ball keeps circulating without stopping. The logo is five players in a passing circle around a play button.

## Competitions

| | Fixtures from | Highlights from |
|---|---|---|
| Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League | football-data.org (free tier) | league, broadcaster and club channels |
| Europa League, Nations League | Highlightly (free plan: 100 requests/day), because football-data.org's free tier doesn't include them | CBS Sports Golazo Europe, FOX, TUDN (Nations League), club and federation channels |
| World Cup 2026 | football-data.org (free tier) | FIFA, FOX Soccer, federation channels (archive, ingested once) |
| Euros | football-data.org if your plan includes it | UEFA, FOX, federation channels (hidden until there are highlights) |

## Quick start

```bash
npm install
npm run sample     # offline snapshot: PL, Bundesliga, UCL, UEL and Nations League rounds (real videos)
npm run dev        # http://localhost:5173
```

## Live data

1. Put your keys in `.env` (see `.env.example`):
   - `FOOTBALL_DATA_KEY`: free at football-data.org.
   - `YOUTUBE_API_KEY`: from Google Cloud with **YouTube Data API v3** enabled.
   - `HIGHLIGHTLY_API_KEY`: free at highlightly.net (Europa League and Nations League fixtures). Without it those two competitions are left as published.
2. Run:

```bash
npm run ingest                         # last ~10 days of uploads, every competition
npm run ingest -- --since=2026-08-15   # backfill the season so far (reads deeper into busy channels)
npm run ingest -- --only=WC            # force an archive competition again
npm run ingest -- --only=PL,CL --dry   # preview without writing
npm run ingest -- --only=EL,UNL --refresh-fixtures   # re-download Highlightly fixtures now
npm run ingest -- --since=2026-08-15 --fresh=EL,UNL   # rebuild after a matching fix (drops earlier matches)
```

**Highlightly budget:** fixtures are cached in `public/data/cache/highlightly-<CODE>-<season>.json`. The full list is re-downloaded about once a day (100 matches per request, so ~5 requests for both competitions), and in between only the dates of recent unfinished matches are re-fetched for scores. That's roughly 10–25 of the 100 daily requests. If Highlightly is down, the cached fixtures are used.

**Misses:** `public/data/cache/unmatched.json` lists, per competition, videos that looked like match highlights but that no fixture claimed. It's the first place to look when a match is missing its highlights (usually a new spelling of a team name).

**Quota:** the ingest never uses `search.list`, which costs 100 units a call. It reads each channel's uploads playlist at 1 unit per 50 videos, and re-checks stored videos at 1 unit per 50. Channel ids are looked up once a week and kept in `cache/channels.json`. A full run costs about 150 units of the 10,000 you get per day, a quick run (`--quick`) about 5–60, and a backfill up to about 1,000. A busy Saturday comes to roughly 2,000–3,000 in all.

## Global audience

Highlight rights are sold country by country. US broadcasters, for example, limit their videos to the US, while league and club channels are usually worldwide.

- The ingest keeps **every** embeddable video along with its YouTube country restrictions, stored as `allow`/`block` lists.
- The site works out the visitor's country the way YouTube does, from their internet connection. A Netlify GeoIP redirect sends `/geo.json` to `/geo/<CC>.json`; `scripts/gen-geo.mjs` generates those files and `public/_redirects` at build time. No function or third-party lookup is involved.
- If that's unavailable (for example in local dev), it falls back to the browser's time zone. Visitors can always override the country in Settings.
- Some channels refuse embeds in a country even though the API lists no restriction (FIFA's World Cup uploads in the US). Known cases go in `EMBED_BLOCKED` in `scripts/config.mjs` and are merged into the `block` lists at ingest.
- When a video fails with an embed error anyway, the site avoids that channel for the viewer's country for a week and picks another cut. After repeated errors from different channels, it suggests checking the country setting.
- It then only offers cuts that play there. Matches with no playable cut are grouped under "Not available in …".

## How highlights are found

`scripts/lib/match.mjs` does the matching. `scripts/lib/highlightly.mjs` converts Highlightly fixtures to football-data's shape. `scripts/lib/videos.mjs` can discover matches from titles alone for a competition with no fixture feed (none use it at the moment).

1. For each competition, read recent uploads from the trusted channels in `scripts/config.mjs`. The list is priority-ordered: broadcasters first, then official league channels, then clubs and national teams.
2. Keep titles that say "highlights" (in any of several languages) or show a scoreline ("Everton 1-0 Ipswich", "OM - PSG (1-2)"). A title with only a scoreline counts when the score sits between the two team names. A running score elsewhere means a single-goal clip ("Kai Havertz strikes Arsenal 1-0 ahead of Coventry City", which NBC Sports posts for every goal), and a title that opens with a quote is an interview. Drop non-highlights: single-goal "all angles" replays, studio analysis, interviews, compilations, women's and youth games, qualifiers, friendlies, cup ties, pressers, reactions, tunnel cams, alt-angle and behind-the-scenes cuts ("Inside", "Uncut", "Matchday Live"), Shorts, and anything over 30 minutes (live streams and full matches). "Classic" replays of old matches are ruled out by the kick-off check below. Also drop anything not embeddable, and titles that name a different competition.
3. Match a video to a fixture when **both teams** appear in the title as whole words (with aliases like *Spurs*, *Man Utd*, *Atleti*, *Inglaterra*) and it was **published within 5 days after kick-off**.
   - If no fixture matches exactly, long names may differ by one letter (*Olympiacos*/*Olympiakos*, *Ferencváros*/*Ferencvarosi*). An exact match always wins over that.
   - Europa League clubs borrow names and aliases from the same club in the football-data leagues when there is one. National teams get their names in several languages from `scripts/lib/teams.mjs`.
4. Classify each cut as **extended** if the title says so or it runs 7 minutes or more. Otherwise the longest cut is extended if it's at least twice the length of the shortest.
5. Merge with earlier runs, and re-check stored videos so deleted or de-embedded ones disappear.

Run `npm test` to check the matcher against real titles and run the whole ingest against mocked APIs.

## Auto-condensed cuts

When a match has no short cut in the visitor's country, the **Short** option plays an auto-condensed cut instead: just the key moments of the extended cut. The **Auto-condense** button next to Short/Extended (on by default) switches this off, and a footnote under the round's header says which matches it applies to.

- YouTube adds automatic chapters to most extended highlights, and a chapter usually starts right at a goal (the ball goes in ~2 s before to ~10 s after the chapter start). `scripts/condense.mjs` (`npm run condense`, run by the workflow after crests) reads each extended cut's chapters from its public watch page and turns every chapter edge into a moment from 20 s before it to 25 s after (`scripts/lib/condense.mjs`). Moments less than 10 s apart are merged. Every video with chapters gets a cut; busy games can have several goals in one chapter, so a cut can skip a goal.
- Many videos have no chapters (none of TUDN's Nations League cuts did); those matches fall back to the extended cut as before.
- The result goes to `condensed.json` on the data branch (`{ videoId: { m: [[start, end], …], s: seconds } }`). Chapters are cached in `cache/chapters.json` and each watch page is read once: at most 40 a run (`CONDENSE_MAX`, or the workflow's `condense_max` input, for a backfill; YouTube cut a runner off after ~140 in one run), stopping after 3 failures in a row. Round files are not touched.
- The player (`src/components/Player.tsx`) starts at the first moment, fades the sound out as a moment ends, seeks to the next and fades back in. Scrubbing to somewhere between moments plays the rest of that video in full.
- To switch it off for everyone: delete the "Condensed cuts" step from `.github/workflows/refresh-data.yml` (without `condensed.json` updates, new matches simply fall back to extended cuts).

To try it locally against the live data: `npm run dev:live`.

## View counts and watched matches

- **View counts:** `scripts/views.mjs` (`npm run views`, a refresh workflow step after the condensed cuts) writes `views.json` on the data branch: `{ videoId: views }`, rounded to 2 significant figures. It uses the YouTube Data API's `videos.list` (part `statistics`, 1 unit per 50 videos): quick runs re-read only videos published in the last 3 days, the daily full run all of them (~35 units). The cards show the count of the cut they'd play as "1.2M YouTube views", and a round's playable matches are ordered by it, most viewed first (Play all follows that order). Spoiler-free mode keeps both the counts and the order. `scripts/early-data.js` starts loading `views.json` with the index, and prerendered pages order their cards by the views at build time (not part of the pages fingerprint), so the order rarely changes when the app takes over.
- `views.json` changes don't move the data commit (`rev`) the round files are read at, so new counts don't send visitors to uncached round files. The site reads it from the moving `data` branch, like `index.json`, and the workflow purges it on jsDelivr when it changed.
- **Watched:** the player tells the app how long each video actually played. The app keeps, per match, the furthest share played and whether it reached the end in localStorage (`rondo:watched`, `src/lib/watched.ts`, at most 800 matches). Cards show a red progress bar along the thumbnail (it stands apart from the pitch) and a green check once a highlight was played to the end (or 90% of it). It stays in the browser and is never sent.

## Project layout

```
scripts/        config.mjs (competitions + channels), ingest.mjs, build-sample.mjs, prerender.ts (pages), check-pages.mjs, lib/
public/data/    generated JSON (index.json + <CODE>/<round>.json, condensed.json, views.json)
src/            React app (built with Preact, see below): App.tsx, components/, lib/playback.ts (queue/autoplay), lib/region.ts (country detection)
docs/           landscape.md (competitor comparison)
```

## Visitor analytics

Our own, at **rondohighlights.com/stats**. It sets no cookies and stores no IP addresses.

- **What's counted:** page views, including moving between rounds inside the app, plus a few events. These are Play buttons pressed (`play`), highlights started (`video`), highlights watched to the end (`finish`), how long each highlight played (`watch`, in whole minutes by cut, for the stats page's histogram), matches added to the queue (`queue`) and settings changed (`setting`). `src/lib/track.ts` sends them from production builds to `/api/r`.
- **Visitors:** a visitor is a hash of a random daily salt, the IP and the user agent. The same person is one visitor within a day, but can't be followed from one day to the next, so multi-day totals add up each day's visitors.
- **Coming back:** the browser keeps the time of its first visit in localStorage (`rondo:first`), and a landing view sends the hours since then. The collector keeps only whole days since the first visit (0 = new, capped past 30), which gives the share of returning visitors and day-N retention (of the browsers first seen on day d, how many visited on day d + N). Browsers that already had our settings saved when this started count as returning but aren't in day-N figures. Clients that don't run JavaScript (most bots) never send anything, and the collector also drops known bot user agents.
- **Storage (Netlify Blobs, store `analytics`):**
  - `netlify/functions/collect.mjs` saves each hit as its own entry, so hits arriving together never overwrite each other.
  - `compact.mjs` (scheduled hourly) folds them into one totals record per day and deletes them.
  - `stats.mjs` (`/api/stats`) reads the totals plus hits not folded yet.
  - The counting logic is in `netlify/lib/analytics.mjs`, tested by `tests/analytics.test.mjs`.
- **Setup:** set these in Netlify under Project configuration → Environment variables:
  - `STATS_KEY`: any long random string. The stats page asks for it once per browser.
  - `STATS_TZ` (optional): an IANA time zone like `America/Los_Angeles`, so days run midnight to midnight there. The default is UTC.
- **Your own visits:** opening `/stats` with the key marks that browser `rondo:notrack`, so your own browsing isn't counted.
- **Trying it locally:** run `npm run build`, then `STATS_KEY=… netlify dev --offline --framework '#static' --dir dist` (Node 22). That serves the built site with the functions and a local blob store. Nothing is sent from `npm run dev`.

## YouTube embed rules we follow

- One player on the page.
- It auto-advances only while visible: when you scroll away it docks into a mini player of at least 200 px.
- No overlays on the player.
- The video title and channel are always shown next to it.
- Official channels only.

## Deployment

The only cost is the domain.

```
main branch ──(push)──▶ Netlify build ──▶ rondohighlights.com       (code: a few deploys a month)
data branch ◀──(every 2 h)── GitHub Actions: npm run ingest            (data: no deploys)
     ├──▶ jsDelivr CDN ──▶ fetched by the site at runtime
     └──▶ new rounds or fixtures ──▶ Netlify build hook               (pages: rarely, at most ~daily)
```

- **Code** lives on `main`. Netlify builds it with `netlify.toml`, only when code changes.
- **Data** lives on the public `data` branch. `.github/workflows/refresh-data.yml` runs the ingest, then `npm run crests`, and commits only when something changed. It has no schedule of its own: see *When the data refreshes* below. `index.json` is read from `https://cdn.jsdelivr.net/gh/<owner>/<repo>@data/index.json` (purged after each change). It names the commit that holds the dataset (`rev`), and round files are read from `…@<rev>/…`, which never changes and is cached for good; `rev` only moves when files the site reads change (not `cache/`). Crests are read at `crestsRev`, the last commit that added one, so a refresh that adds no crest leaves their URLs (and visitors' caches) alone. Both fall back to `raw.githubusercontent.com`. jsDelivr's copy of `index.json` can lag hours behind the branch even after a purge, so the site asks both sources for it and keeps the one with the later `publishedAt` (stamped by `scripts/stamp-rev.mjs`; it only goes up), and never swaps an index it is showing for an older one. `vite.config.ts` works out the repo from Netlify's `REPOSITORY_URL`, or you can set `VITE_DATA_BASE` (with an optional `{ref}` placeholder) to override it.
- **Crests** are self-hosted: `scripts/crests.mjs` downloads each crest once, stores an 80×80 WebP under `crests/` on the data branch, and points the round files at it (about a third of the original size; the originals are 200×200). A crest that fails to download keeps its original URL. Crests that are dark both around their edge and overall (Juventus, Spurs, Inter; about 20 of 250) would melt into the dark page, so the same step stores an outlined copy, `crests/<hash>-o.webp`, with a solid light outline around the shape (about 3.5 px at 80 px), and points the round files at it (`scripts/lib/crest-outline.mjs`). A crest with just a dark ring around a bright middle is left alone. The rule is checked again on every run.
- **Fast first load:**
  - `scripts/early-data.js` is inlined at the top of every page. While the HTML is still loading it fetches `index.json`, then the round the page will show (prerendered pages name it in `<meta name="rondo-route">`) and `condensed.json`, plus `/geo.json`. Without it, those waited for the JS bundle to download and start.
  - Repeat visits: the last index (if under 12 hours old) is kept in localStorage, so the round shows straight from the browser cache; the fresh index replaces it when it arrives.
  - The app is written with React but bundled with Preact (`@preact/preset-vite` aliases `react` and `react-dom` to `preact/compat`): 31 KB of JS gzipped instead of 93 KB. Types still come from `@types/react`.
  - Archivo is self-hosted from `src/fonts/` (no connections to Google), trimmed to the widths and weights the design uses (53 KB instead of 88 KB). See `src/fonts/README.md`.
  - The first two thumbnails load ahead of the rest; the web font never blocks the first paint.
- **Pages and URLs:** every competition and round has its own URL (`/premier-league/`, `/premier-league/matchweek-5/`; slugs in `src/lib/routes.ts`), and old `#/PL/md-5` links redirect there. At build time `scripts/prerender.ts` writes one HTML page per URL with its own title, description, heading and fixture list (no scores or dates), plus `sitemap.xml`, `404.html` and `pages.json`, reading the data from GitHub. The app replaces that content when it starts and keeps the title and canonical URL in step as you browse.
- **Redeploying pages:** the pages only change when competitions, rounds or who plays whom change. The last workflow step (`scripts/check-pages.mjs`) compares the data's fingerprint with the live `/pages.json` and, if they differ and the site was built more than 20 hours ago, calls the Netlify build hook in the `NETLIFY_BUILD_HOOK` secret (each production deploy costs Netlify credits). Without the secret it only logs a warning.
- **Repo secrets:** `FOOTBALL_DATA_KEY`, `YOUTUBE_API_KEY`, `HIGHLIGHTLY_API_KEY`, and `NETLIFY_BUILD_HOOK` (optional, see above). The repo must be public so the CDN can read the `data` branch; the secrets stay private.
- To backfill, open Actions → *Refresh data* → *Run workflow* and set a `since` date.

### When the data refreshes

Highlights go up about 20–60 minutes after full time, so the refresh follows the fixtures rather than a fixed timer. `.github/workflows/refresh-clock.yml` runs `scripts/refresh-clock.mjs`, which reads the fixtures on the data branch, decides with `scripts/lib/refresh-plan.mjs` and starts *Refresh data* when it's due:

| When | How often | Run |
|---|---|---|
| From 100 min after kick-off until 4 h after | every 10 min | quick, only the competitions involved |
| A finished match still without highlights | hourly for 12 h after kick-off, then every 3 h until 54 h (the Bundesliga holds Saturday 15:30 games back ~30 h) | quick, only those competitions |
| Otherwise | every 6 h | quick, every competition |
| Once a day | | full: 10 days of uploads from every channel, every stored video re-checked |

Quick runs carry on from each channel's last read and read club and federation channels at most every 30 min. The full run catches anything they missed, and re-matches recent videos after a matcher fix.

GitHub's scheduled runs are best-effort (a 2-hourly schedule ran about every 6 hours in September 2026), so the clock doesn't use them: a [cron-job.org](https://cron-job.org) job starts the *Refresh clock* workflow every 10 minutes through GitHub's API, and each run checks once and exits (a tick takes seconds and no API quota). If the ticks stop, *Refresh data* falls back to its own backup timer (every 3 h, full at 03:17 UTC); those runs cancel themselves while the clock ticks. Each refresh's title in the Actions tab says why it ran ("Refresh data · quick · just finished: Man United v Tottenham"), and its summary lists the new highlights.

- Refresh now: `npm run refresh` (a full run; needs the GitHub CLI, `gh`, signed in). Add `-- -f mode=quick` for a quick one.
- See what the clock would do, without starting anything: `node scripts/refresh-clock.mjs --dry`.
- The cron-job.org job: every 10 minutes, `POST https://api.github.com/repos/tareksakakini/rondo-highlights/actions/workflows/refresh-clock.yml/dispatches` with body `{"ref":"main"}` and headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `Content-Type: application/json`. The token is a fine-grained personal access token for this repo only, with *Actions: Read and write*. GitHub answers 204 when it starts the run. When the token expires, the ticks fail and the backup timer takes over until it's replaced.
- To pause refreshes, disable both the *Refresh clock* and *Refresh data* workflows in the Actions tab (with only the clock disabled, the backup timer still refreshes every 3 h).
- For local development, `npm run ingest` or `npm run sample` writes `public/data/`, which is gitignored on `main`.
- **Attribution:** football-data.org requires "Football data provided by the Football-Data.org API" to be shown on the site. It's in the footer, next to a credit for Highlightly.
