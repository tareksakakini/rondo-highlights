# Rondo Highlights

**European football highlights, back to back.** Pick a league and a matchweek, press *Play all*, and every match's highlights play one after another. You can also build your own queue, and choose short or extended cuts.

In football, a *rondo* is the passing drill where the ball keeps circulating without stopping. The logo is five players in a passing circle around a play button.

## Quick start

```bash
npm install
npm run sample     # offline snapshot: PL MW5, Bundesliga MD4, UCL MD1 (real videos)
npm run dev        # http://localhost:5173
```

## Live data (all six competitions)

1. Put your keys in `.env` (see `.env.example`):
   - `FOOTBALL_DATA_KEY`: free at football-data.org. Gives fixtures and results for the Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and the Champions League.
   - `YOUTUBE_API_KEY`: from Google Cloud with **YouTube Data API v3** enabled.
2. Run:

```bash
npm run ingest                         # last ~10 days of uploads, every competition
npm run ingest -- --since=2026-08-15   # backfill the season so far (more quota, still cheap)
npm run ingest -- --only=PL,CL --dry   # preview without writing
```

The ingest writes static JSON to `public/data/`. The site is fully static, so you can deploy `dist/` anywhere (Netlify, Vercel, GitHub Pages) and run the ingest on a schedule, for example with a GitHub Actions cron.

**Quota:** the ingest never uses `search.list`, which costs 100 units a call. It reads each channel's uploads playlist at 1 unit per 50 videos. A normal run costs roughly 30–150 units of the 10,000 you get per day.

## How highlights are found

`scripts/lib/match.mjs` does the matching:

1. For each competition, read recent uploads from the trusted channels in `scripts/config.mjs`. The list is priority-ordered and US-rights aware.
2. Drop non-highlights (compilations, women's and youth games, cup ties, pressers, Shorts) and anything not embeddable or blocked in the US.
3. Match a video to a fixture when **both teams** appear in the title as whole words (using aliases like *Spurs*, *Man Utd*, *Atleti*, *M'gladbach*) and it was **published within 5 days after kick-off**.
4. Classify each cut as **extended** if the title says so or it runs 7 minutes or more. When a match only has short-ish cuts, the longest counts as extended if it's at least twice the length of the shortest.
5. Merge with earlier runs so older highlights aren't lost when they fall out of the lookback window.

Run `npm test` to check the matcher against real titles from the sample snapshot.

## Project layout

```
scripts/        config.mjs (competitions + channels), ingest.mjs, build-sample.mjs, lib/
public/data/    generated JSON (index.json + <CODE>/<round>.json)
src/            React app: App.tsx, components/, lib/playback.ts (queue/autoplay logic)
docs/           landscape.md (competitor comparison)
```

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
     └──▶ jsDelivr CDN ──▶ fetched by the site at runtime
```

- **Code** lives on `main`. Netlify builds it with `netlify.toml`, only when code changes.
- **Data** lives on the public `data` branch. `.github/workflows/refresh-data.yml` runs the ingest every 2 hours, commits only when something changed, and purges jsDelivr's cache for the changed files. The site reads `https://cdn.jsdelivr.net/gh/<owner>/<repo>@data/…` and falls back to `raw.githubusercontent.com`. `vite.config.ts` works out the repo from Netlify's `REPOSITORY_URL`, or you can set `VITE_DATA_BASE` to override it.
- **Repo secrets:** `FOOTBALL_DATA_KEY` and `YOUTUBE_API_KEY`. The repo must be public so the CDN can read the `data` branch; the secrets stay private.
- To backfill, open Actions → *Refresh data* → *Run workflow* and set a `since` date.
- For local development, `npm run ingest` or `npm run sample` writes `public/data/`, which is gitignored on `main`.
- **Attribution:** football-data.org requires "Football data provided by the Football-Data.org API" to be shown on the site. It's in the footer.
