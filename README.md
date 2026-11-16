# WSA — Wall Street for Assem

A live multi-screen market desk for a Wall Street analyst: market sessions, rates, commodities, people moves, New York events, a news traffic light, and **Jarvis**, a small voice assistant.

## Screens

| Key | Screen | What's on it |
|---|---|---|
| 1 | **Desk** | Greeting, market sessions timeline with countdowns (12 markets), markets overview, news radar, today & tomorrow in New York, the wire, live TV, Treasury curve, SOFR & spreads |
| 2 | **The Street** | Big names in the news (Dimon, Solomon, Fink, Gundlach…), people moves (hires, promotions, exits), Bluesky market voices, StockTwits trending, X accounts to follow |
| 3 | **Markets** | Advanced chart, US movers, commodities board, S&P heatmap, Treasury curve (today / 1w / 1m), credit & funding (SOFR, HY/IG/BBB OAS, 2s10s, breakevens), FX cross rates |
| 4 | **Events** | Today, tomorrow, in-person NYC events, 60-day calendar with filters (Fed, data, earnings, auctions, conferences), global economic calendar, event directories |
| 5 | **Radar** | Stories clustered across ~25 feeds. 2 outlets = green, 3–4 = amber, 5+ = red with toast, chime, desktop notification and (optionally) Jarvis reading it aloud |
| 6 | **Kit** | Bond calculator, 60-term lexicon, microfinance metrics, data sources, Excel shortcuts, watchlist, notes |

**Several monitors:** each screen has its own link (`#desk`, `#street`, `#markets`, `#events`, `#radar`, `#kit`). Open them in separate windows, or press **Pop out ↗**.

## Jarvis

Click the orb or press **J**, then speak. Tick **Always listening** to wake it by saying “Jarvis”. Press **/** to type a command.

- `desk` · `street` · `markets` · `events` · `radar` · `kit` · `next screen`
- `chart gold` · `chart the ten year` · `chart Nvidia` · `show bitcoin`
- `brief me` · `what's hot` · `what did I miss`
- `what's on today` · `what's on tomorrow`
- `when does London open` · `is Tokyo open` · `time in Hong Kong`
- `define convexity` · `what is a greenshoe`
- `note call Sarah about the BBB deal` · `add JPM to my watchlist`
- `play TV` · `stop TV` · `read alerts` · `full screen` · `stop`

Voice works in Chrome and Edge (and Safari 17+). The browser asks for the microphone once.

## How fresh is the data

| Cadence | What | Source |
|---|---|---|
| Live | Ticker tape, quotes, charts, movers, heatmap, breaking news, economic calendar | TradingView widgets |
| Live | Bloomberg / Yahoo Finance streams | YouTube |
| Every second | Clocks, session status and countdowns | In the page |
| ~10 min | Radar, wire, people, moves, Bluesky, StockTwits, auctions, earnings, CFA Society NY events | `scripts/fetch_all.py` in GitHub Actions |
| Daily | Treasury curve, SOFR, credit spreads | US Treasury, FRED |

GitHub's scheduler can run a few minutes late at busy times.

## Setup (once)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Actions → Refresh data and deploy → Run workflow.** After a minute the site is live at `https://<user>.github.io/wallstreet/`.

## Editing

- Name in the greeting: `OWNER_NAME` at the top of `assets/app.js`.
- Curated calendar: `data/events.json` (US Eastern times).
- People tracked, news feeds, Bluesky voices: lists at the top of each section in `scripts/fetch_all.py`.
- Chart symbols Jarvis knows: `SYM` in `assets/app.js`.
