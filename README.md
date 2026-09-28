# Rondo Highlights

**Football highlights, back to back.** Pick a competition and a round, press *Play all*, and every match's highlights play one after another. You can also build your own queue, choose short or extended cuts, and see only what's licensed in your country.

In football, a *rondo* is the passing drill where the ball keeps circulating without stopping. The logo is five players in a passing circle around a play button.

## Competitions

| | Fixtures from | Highlights from |
|---|---|---|
| Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League | football-data.org (free tier) | league, broadcaster and club channels |
| Europa League, Nations League | **no free fixture feed**, so matches are discovered from highlight titles (`scripts/lib/videos.mjs`) | CBS Sports Golazo Europe, FOX, club and federation channels |
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
2. Run:

```bash
npm run ingest                         # last ~10 days of uploads, every competition
npm run ingest -- --since=2026-08-15   # backfill the season so far (reads deeper into busy channels)
npm run ingest -- --only=WC            # force an archive competition again
npm run ingest -- --only=PL,CL --dry   # preview without writing
```

**Quota:** the ingest never uses `search.list`, which costs 100 units a call. It reads each channel's uploads playlist at 1 unit per 50 videos, and re-checks stored videos at 1 unit per 50. A normal run costs a few hundred units of the 10,000 you get per day, and a backfill costs up to about 1,000.

## Global audience

Highlight rights are sold country by country. US broadcasters, for example, limit their videos to the US, while league and club channels are usually worldwide.

- The ingest keeps **every** embeddable video along with its YouTube country restrictions, stored as `allow`/`block` lists.
- The site works out the visitor's country the way YouTube does, from their internet connection. A Netlify GeoIP redirect sends `/geo.json` to `/geo/<CC>.json`; `scripts/gen-geo.mjs` generates those files and `public/_redirects` at build time. No function or third-party lookup is involved.
- If that's unavailable (for example in local dev), it falls back to the browser's time zone. Visitors can always override the country in Settings.
- After repeated embed errors, the site suggests checking the country setting.
- It then only offers cuts that play there. Matches with no playable cut are grouped under "Not available in …".

## How highlights are found

`scripts/lib/match.mjs` handles fixture competitions, and `scripts/lib/videos.mjs` handles title-discovered ones.

1. For each competition, read recent uploads from the trusted channels in `scripts/config.mjs`. The list is priority-ordered: broadcasters first, then official league channels, then clubs and national teams.
2. Drop non-highlights: compilations, "classic" replays, women's and youth games, qualifiers, friendlies, cup ties, pressers, tunnel cams and Shorts. Also drop anything not embeddable, and titles that name a different competition.
3. Match a video to a fixture when **both teams** appear in the title as whole words (with aliases like *Spurs*, *Man Utd*, *Atleti*, *Inglaterra*) and it was **published within 5 days after kick-off**.
   - For Europa League and Nations League there are no fixtures, so "A vs B" / "A 2-1 B" is parsed from the title. Videos about the same pair of teams within a few days become one match.
   - Rounds come from "MD 1" in titles, or from date windows.
4. Classify each cut as **extended** if the title says so or it runs 7 minutes or more. Otherwise the longest cut is extended if it's at least twice the length of the shortest.
5. Merge with earlier runs, and re-check stored videos so deleted or de-embedded ones disappear.

Run `npm test` to check the matcher against real titles and run the whole ingest against mocked APIs.

## Project layout

```
scripts/        config.mjs (competitions + channels), ingest.mjs, build-sample.mjs, lib/
public/data/    generated JSON (index.json + <CODE>/<round>.json)
src/            React app: App.tsx, components/, lib/playback.ts (queue/autoplay), lib/region.ts (country detection)
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
