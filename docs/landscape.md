# Competitive landscape (hands-on check, 27 Sept 2026)

I opened each site's match pages; claims below are what I saw, not marketing copy.

| | Coverage | How you browse | Plays a whole round back to back | Queue | Short vs extended | Spoiler-free | Ads |
|---|---|---|---|---|---|---|---|
| **Rondo** | Big 5, UCL, UEL, Nations League, World Cup (Euros when on) | Competition → round | **Yes, across channels** | **Yes, plays through, cross-competition** | Global preference + per-match pin + fallback | Toggle; YouTube title can flash | None |
| [spoilerfreehighlights.com](https://spoilerfreehighlights.com/) | Big 5 + UCL | By date | No | "Saved" bookmarks (local), not a playlist | **Yes, per match** (e.g. club "Condensed" + ESPN FC "Extended") | Always; custom controls hide YouTube's UI | None seen |
| [SpoilSports](https://spoilsports.net/) | PL, La Liga, Serie A, Ligue 1, MLS, Scottish Prem… | By date / team follow | No | No | No | Always; player preloaded off-screen and muted | None seen |
| [MatchReplays](https://matchreplays.com/) | Big 5 + UCL | Match pages, league pages | No | No | One video per match | No, scores shown | Google ads |
| [FootyRoom](https://footyroom.co/) | Very broad (incl. internationals) | Match pages | No | No | One main video + related clips (tunnel cam, pressers) | Toggle | Heavy ads |
| [DailyGoal](https://dailygoal.tv/) | 50+ leagues, plus an app | By league / match | No | No | No | No | Google ads |
| **Official YouTube compilations** | One league each | Channel | **Yes, as one fixed video** (NBC *PL Review: Matchweek 5* 52 min; Bundesliga *All Highlights MD4* 33 min; CBS *All Goals MD1* 45 min) | No | No (one fixed edit) | No | YouTube ads |
| Match of the Day (BBC) | Premier League | TV/iPlayer | Yes, the gold standard | No | No | No | None, **UK only** |

## Verdict

**Rondo's added value is real but narrow: it's the only one that turns a matchweek into a continuous, customizable show.**

- **Unique:** "Play all" across different channels, a queue that actually plays (and mixes leagues), and matchweek framing. Nobody else I checked does any of these.
- **Incremental:** short/extended choice. spoilerfreehighlights.com already offers both cuts per match; Rondo's edge is a global setting with automatic fallback.
- **Table stakes, and we're behind:** spoiler-free. Three competitors do it better because the YouTube title never shows on their players.
- **Coverage (updated):** Europa League, Nations League and the World Cup are now covered, and each visitor only sees cuts licensed in their country. Still missing: Conference League and domestic cups.
- **Not a moat:** data. MatchReplays uses the same football-data.org + YouTube approach, and spoilerfreehighlights could add a "play all" button quickly.

## What would widen the gap

1. **Close the spoiler leak** by using `controls=0` with our own controls in spoiler-free mode (the API documents that option). The alternative, a cover over the player, would break YouTube's no-overlay rule.
2. **"Best first" ordering without spoilers:** rank a round by a hidden watchability score (goals, late winners, red cards) and let "skip the 0-0s" work blind.
3. **Follow teams → auto-queue:** every Monday, your teams across all leagues are queued, extended cut for your club and short for the rest.
4. **Resume and watched marks,** so you can come back to a half-finished matchweek.
5. **Broader coverage:** Conference League and domestic cups. (Europa League, Nations League and the World Cup are done.)
6. **Lean-back / TV mode:** fullscreen continuous play, plus a keyboard/remote-friendly layout.
