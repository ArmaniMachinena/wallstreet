"""WSA data refresher. Runs in GitHub Actions every ~10 minutes.

Writes into site/data/:
  wire.json     latest market & central-bank headlines
  radar.json    news traffic light: stories clustered across outlets
  social.json   big names in the news, people moves, Bluesky voices, StockTwits trending
  curve.json    US Treasury par curve today / 1 week / 1 month ago
  credit.json   FRED series: SOFR, HY & IG OAS, 2s10s, 10y breakeven
  live_events.json  Treasury auctions, earnings (today/tomorrow), CFA Society NY events

Standard library only. Every source is optional: a failing source is logged and
skipped, and the previous file is kept when a section comes back empty.
"""
import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
DATA = ROOT / "data"
DATA.mkdir(parents=True, exist_ok=True)
NOW = datetime.now(timezone.utc)
UA = "Mozilla/5.0 (compatible; WSA/3.0; +https://github.com)"
LOG = []
PREV_BASE = os.environ.get("PREV_BASE", "")  # live site URL, to carry radar history between runs


def log(msg):
    LOG.append(msg)
    print(msg, file=sys.stderr)


def get(url, timeout=20, headers=None):
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_json(url, **kw):
    return json.loads(get(url, **kw).decode("utf-8", "replace"))


def write(name, obj):
    obj = dict(obj)
    obj["fetched_at"] = NOW.isoformat(timespec="seconds")
    (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1))


def keep_or_write(name, obj, key):
    """Write unless the main list came back empty and an older file exists."""
    if not obj.get(key) and (DATA / name).exists():
        log(f"{name}: empty, keeping previous")
        return
    write(name, obj)


# ---------------------------------------------------------------- RSS helpers
ATOM = "{http://www.w3.org/2005/Atom}"


def parse_date(text):
    if not text:
        return None
    text = text.strip()
    try:
        d = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def clean(t):
    t = re.sub(r"<[^>]+>", "", t or "")
    t = t.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"').replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", t).strip()


def rss(url, limit=40):
    """Return [{title, url, published(datetime), source}] from RSS or Atom."""
    root = ET.fromstring(get(url))
    out = []
    for it in root.iter("item"):
        src = it.find("source")
        out.append({
            "title": clean(it.findtext("title")),
            "url": (it.findtext("link") or "").strip(),
            "published": parse_date(it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date")),
            "source": clean(src.text) if src is not None and src.text else None,
        })
    for it in root.iter(ATOM + "entry"):
        link = it.find(ATOM + "link")
        out.append({
            "title": clean(it.findtext(ATOM + "title")),
            "url": link.get("href", "") if link is not None else "",
            "published": parse_date(it.findtext(ATOM + "updated") or it.findtext(ATOM + "published")),
            "source": None,
        })
    return [x for x in out if x["title"] and x["url"] and x["published"]][:limit]


def gnews(query, limit=20):
    q = urllib.parse.quote(query)
    items = rss(f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en", limit)
    for x in items:
        if x["source"] and x["title"].endswith(" - " + x["source"]):
            x["title"] = x["title"][: -len(x["source"]) - 3]
    return items


def iso(d):
    return d.isoformat(timespec="seconds") if d else None


# ---------------------------------------------------------------- 1. Wire
WIRE_FEEDS = [
    ("Federal Reserve", "Central banks", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("ECB", "Central banks", "https://www.ecb.europa.eu/rss/press.html"),
    ("Bank of England", "Central banks", "https://www.bankofengland.co.uk/rss/news"),
    ("US Treasury", "Central banks", "https://home.treasury.gov/news/press-releases/feed"),
    ("CNBC", "Markets", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("CNBC Finance", "Markets", "https://www.cnbc.com/id/10000664/device/rss/rss.html"),
    ("MarketWatch", "Markets", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("Yahoo Finance", "Markets", "https://finance.yahoo.com/news/rssindex"),
    ("OilPrice", "Commodities", "https://oilprice.com/rss/main"),
]


def build_wire():
    seen, items = set(), []
    for name, cat, url in WIRE_FEEDS:
        try:
            for x in rss(url, 25):
                if x["url"] in seen:
                    continue
                seen.add(x["url"])
                items.append({"title": x["title"], "url": x["url"], "source": name, "category": cat, "published": iso(x["published"])})
        except Exception as e:  # noqa: BLE001
            log(f"wire {name}: {e}")
    items.sort(key=lambda x: x["published"], reverse=True)
    keep_or_write("wire.json", {"items": items[:120]}, "items")


# ---------------------------------------------------------------- 2. Radar (traffic light)
# Direct outlet feeds plus Google News, which tags each item with its publisher.
RADAR_FEEDS = [
    ("The New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"),
    ("The New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml"),
    ("The New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"),
    ("The Wall Street Journal", "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain"),
    ("The Wall Street Journal", "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness"),
    ("The Washington Post", "https://feeds.washingtonpost.com/rss/business"),
    ("The Washington Post", "https://feeds.washingtonpost.com/rss/politics"),
    ("Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"),
    ("Bloomberg", "https://feeds.bloomberg.com/economics/news.rss"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("CNBC", "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("Fox Business", "https://moxie.foxbusiness.com/google-publisher/markets.xml"),
    ("Financial Times", "https://www.ft.com/markets?format=rss"),
    ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
    ("Politico", "https://rss.politico.com/economy.xml"),
    ("Axios", "https://api.axios.com/feed/"),
    ("CNN", "http://rss.cnn.com/rss/money_latest.rss"),
    (None, "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en"),
    (None, "https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en"),
    (None, "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en"),
    (None, "https://news.google.com/rss/search?q=site:reuters.com+(markets+OR+business+OR+economy)+when:1d&hl=en-US&gl=US&ceid=US:en"),
    (None, "https://news.google.com/rss/search?q=site:apnews.com+(business+OR+economy+OR+markets)+when:1d&hl=en-US&gl=US&ceid=US:en"),
    (None, "https://news.google.com/rss/search?q=(Fed+OR+Treasury+OR+bonds+OR+Wall+Street)+when:1d&hl=en-US&gl=US&ceid=US:en"),
]

OUTLETS = {  # canonical name -> (short tag, desk)
    "The New York Times": ("NYT", "NY"), "New York Times": ("NYT", "NY"),
    "The Wall Street Journal": ("WSJ", "NY"), "Wall Street Journal": ("WSJ", "NY"), "WSJ": ("WSJ", "NY"),
    "Bloomberg": ("BBG", "NY"), "Bloomberg.com": ("BBG", "NY"),
    "Reuters": ("RTRS", "NY"), "Associated Press": ("AP", "NY"), "AP News": ("AP", "NY"),
    "CNBC": ("CNBC", "NY"), "MarketWatch": ("MW", "NY"), "Fox Business": ("FOXB", "NY"),
    "Barron's": ("BARR", "NY"), "Business Insider": ("BI", "NY"), "Forbes": ("FRBS", "NY"),
    "Yahoo Finance": ("YF", "NY"), "CNN": ("CNN", "NY"), "Fortune": ("FORT", "NY"),
    "The Washington Post": ("WaPo", "DC"), "Washington Post": ("WaPo", "DC"),
    "Politico": ("POL", "DC"), "POLITICO": ("POL", "DC"), "Axios": ("AXS", "DC"), "The Hill": ("HILL", "DC"),
    "Financial Times": ("FT", "LDN"), "The Economist": ("ECON", "LDN"), "BBC": ("BBC", "LDN"),
}

STOP = set("""a an the and or but of to in on at for from by with as is are was were be been being it its this that these those
his her their our your my we you they he she them us i not no yes do does did done has have had will would can could should
may might must new news says say said after before over under into out up down more most less least than then about amid
how why what who when where which while why vs via just also still amid report reports update live latest week day today
year years month months first last next per its it's s here there one two three back off""".split())


def toks(title):
    words = re.findall(r"[A-Za-z][A-Za-z'&\.\-]*|\d+(?:\.\d+)?%?", title)
    out = {}
    for w in words:
        lw = w.lower().strip(".'-")
        if lw in STOP or len(lw) < 3 and not lw[0].isdigit():
            continue
        if lw.endswith("'s"):
            lw = lw[:-2]
        if len(lw) > 4 and lw.endswith("s") and not lw.endswith("ss"):
            lw = lw[:-1]
        weight = 2.0 if w[0].isupper() or lw[0].isdigit() else 1.0
        out[lw] = max(out.get(lw, 0), weight)
    return out


def sim(a, b):
    shared = set(a) & set(b)
    if len(shared) < 2:
        return 0.0
    s = sum(min(a[k], b[k]) for k in shared)
    return s / min(sum(a.values()), sum(b.values()))


def build_radar():
    raw = []
    for outlet, url in RADAR_FEEDS:
        try:
            for x in rss(url, 60):
                name = outlet or x["source"]
                if not name or NOW - x["published"] > timedelta(hours=12):
                    continue
                if outlet is None and x["source"] and x["title"].endswith(" - " + x["source"]):
                    x["title"] = x["title"][: -len(x["source"]) - 3]
                raw.append({"title": x["title"], "url": x["url"], "outlet": name, "t": x["published"]})
        except Exception as e:  # noqa: BLE001
            log(f"radar {outlet or url[:60]}: {e}")
    # de-duplicate exact titles from the same outlet
    seen, items = set(), []
    for r in sorted(raw, key=lambda r: r["t"]):
        k = (r["outlet"], r["title"].lower())
        if k in seen:
            continue
        seen.add(k)
        r["tk"] = toks(r["title"])
        items.append(r)

    clusters = []
    for it in items:
        best, best_s = None, 0.0
        for c in clusters:
            s = max(sim(it["tk"], m["tk"]) for m in c["m"][:8])
            if s > best_s:
                best, best_s = c, s
        if best and best_s >= 0.5:
            best["m"].append(it)
        else:
            clusters.append({"m": [it]})

    prev = {}
    if PREV_BASE:
        try:
            for c in get_json(PREV_BASE.rstrip("/") + "/data/radar.json").get("clusters", []):
                for u in c.get("urls", []):
                    prev[u] = c
        except Exception as e:  # noqa: BLE001
            log(f"radar prev: {e}")

    out = []
    for c in clusters:
        by_outlet = {}
        for m in c["m"]:
            by_outlet.setdefault(m["outlet"], m)
        n = len(by_outlet)
        if n < 2:
            continue
        tags = {}
        for o, m in by_outlet.items():
            tag, desk = OUTLETS.get(o, (o[:6], "OTHER"))
            tags.setdefault(tag, {"outlet": o, "tag": tag, "desk": desk, "url": m["url"], "title": m["title"], "t": iso(m["t"])})
        n = len(tags)
        if n < 2:
            continue
        # headline: prefer a wire or NY outlet, else the earliest
        pref = ["RTRS", "AP", "BBG", "WSJ", "NYT", "CNBC", "WaPo", "FT"]
        lead = next((tags[p] for p in pref if p in tags), min(tags.values(), key=lambda v: v["t"]))
        ts = sorted(m["t"] for m in c["m"])
        urls = [m["url"] for m in c["m"]]
        old = next((prev[u] for u in urls if u in prev), None)
        first = min(ts[0], parse_date(old["first_seen"])) if old and old.get("first_seen") else ts[0]
        light = "red" if n >= 5 else "amber" if n >= 3 else "green"
        cid = old["id"] if old else hashlib.sha1(lead["url"].encode()).hexdigest()[:10]
        out.append({
            "id": cid,
            "title": lead["title"],
            "light": light,
            "outlets": n,
            "ny_outlets": sum(1 for v in tags.values() if v["desk"] in ("NY", "DC")),
            "articles": len(c["m"]),
            "last_hour": sum(1 for t in ts if NOW - t <= timedelta(hours=1)),
            "first_seen": iso(first),
            "last_seen": iso(ts[-1]),
            "sources": sorted(tags.values(), key=lambda v: v["t"]),
            "urls": urls[:40],
        })
    rank = {"red": 0, "amber": 1, "green": 2}
    out = sorted(out, key=lambda c: (rank[c["light"]], -c["outlets"], -c["last_hour"]))
    keep_or_write("radar.json", {"window_hours": 12, "scanned": len(items), "clusters": out[:60]}, "clusters")


# ---------------------------------------------------------------- 3. Social
PEOPLE = [
    ("Jamie Dimon", "CEO, JPMorgan Chase", "jpmorgan"),
    ("David Solomon", "CEO, Goldman Sachs", "GoldmanSachs"),
    ("Ted Pick", "CEO, Morgan Stanley", "MorganStanley"),
    ("Jane Fraser", "CEO, Citigroup", "Citi"),
    ("Brian Moynihan", "CEO, Bank of America", "BankofAmerica"),
    ("Larry Fink", "CEO, BlackRock", "BlackRock"),
    ("Stephen Schwarzman", "CEO, Blackstone", "blackstone"),
    ("Ken Griffin", "CEO, Citadel", "citadel"),
    ("Jeffrey Gundlach", "CEO, DoubleLine · the 'Bond King'", "TruthGundlach"),
    ("Howard Marks", "Co-founder, Oaktree", "oaktree"),
    ("Mohamed El-Erian", "Economist, Allianz adviser", "elerianm"),
    ("Ray Dalio", "Founder, Bridgewater", "RayDalio"),
    ("Bill Ackman", "CEO, Pershing Square", "BillAckman"),
    ("Warren Buffett", "Chairman, Berkshire Hathaway", None),
    ("Cathie Wood", "CEO, ARK Invest", "CathieDWood"),
    ("Kevin Warsh", "Chair, Federal Reserve", "federalreserve"),
    ("Scott Bessent", "US Treasury Secretary", "SecScottBessent"),
    ("Christine Lagarde", "President, ECB", "Lagarde"),
]

MOVES_QUERIES = [
    '("named" OR "appointed" OR "hires" OR "joins" OR "promoted" OR "taps") ("Goldman Sachs" OR "Morgan Stanley" OR JPMorgan OR Citigroup OR "Bank of America" OR "Wells Fargo" OR Barclays OR UBS OR "Deutsche Bank") when:7d',
    '("named" OR "appointed" OR "hires" OR "joins" OR "poaches") (BlackRock OR Blackstone OR Apollo OR KKR OR Carlyle OR Citadel OR "Millennium" OR "Bridgewater" OR "Elliott" OR PIMCO) when:7d',
    '("head of" OR "chief investment officer" OR "managing director") ("fixed income" OR credit OR "debt capital markets" OR "leveraged finance" OR bonds) ("hires" OR "named" OR "joins" OR "appoints") when:7d',
    '("steps down" OR "to retire" OR "departs" OR "exits" OR "succeed") (bank OR "Wall Street" OR "hedge fund" OR "asset manager") (CEO OR CFO OR president) when:7d',
    '(Lazard OR Evercore OR Jefferies OR "PJT Partners" OR Moelis OR Centerview OR Perella) ("hires" OR "joins" OR "named" OR "adds") when:14d',
]
MOVE_RE = re.compile(r"\b(nam(e|es|ed)|appoint\w*|hire[sd]?|hiring|join(s|ed|ing)?|promot\w*|tap(s|ped)|poach\w*|step(s|ped)? down|retire\w*|depart\w*|exit\w*|succeed\w*|successor|leav(e|es|ing)|new (ceo|cfo|head|chief)|elevat\w*|adds?)\b", re.I)

BLUESKY = [
    "weisenthal.bsky.social", "tracyalloway.bsky.social", "pkrugman.bsky.social", "jasonfurman.bsky.social",
    "financialtimes.com", "reuters.com", "apnews.com", "opinion.bloomberg.com",
]


def build_social():
    people = []
    for name, role, x in PEOPLE:
        try:
            items = gnews(f'"{name}" when:3d', 6)
        except Exception as e:  # noqa: BLE001
            log(f"people {name}: {e}")
            items = []
        items.sort(key=lambda i: i["published"], reverse=True)
        people.append({
            "name": name, "role": role, "x": x,
            "items": [{"title": i["title"], "url": i["url"], "source": i["source"], "published": iso(i["published"])} for i in items[:3]],
        })
        time.sleep(0.4)

    moves, seen = [], set()
    for q in MOVES_QUERIES:
        try:
            for i in gnews(q, 30):
                key = re.sub(r"\W+", " ", i["title"].lower())[:70]
                if key in seen or not MOVE_RE.search(i["title"]):
                    continue
                seen.add(key)
                moves.append({"title": i["title"], "url": i["url"], "source": i["source"], "published": iso(i["published"])})
        except Exception as e:  # noqa: BLE001
            log(f"moves: {e}")
        time.sleep(0.4)
    moves.sort(key=lambda m: m["published"], reverse=True)

    posts = []
    for h in BLUESKY:
        try:
            j = get_json(f"https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor={h}&limit=8&filter=posts_no_replies")
            for f in j.get("feed", []):
                p = f.get("post", {})
                if f.get("reason"):  # skip reposts
                    continue
                rec = p.get("record", {})
                text = (rec.get("text") or "").strip()
                if not text:
                    continue
                rkey = p.get("uri", "").rsplit("/", 1)[-1]
                a = p.get("author", {})
                posts.append({
                    "handle": a.get("handle", h), "name": a.get("displayName") or h,
                    "text": text[:400], "published": rec.get("createdAt"),
                    "url": f"https://bsky.app/profile/{a.get('handle', h)}/post/{rkey}",
                    "likes": p.get("likeCount", 0), "reposts": p.get("repostCount", 0),
                })
        except Exception as e:  # noqa: BLE001
            log(f"bluesky {h}: {e}")
    posts.sort(key=lambda p: p["published"] or "", reverse=True)

    trending = []
    try:
        j = get_json("https://api.stocktwits.com/api/2/trending/symbols.json")
        for s in j.get("symbols", [])[:20]:
            trending.append({"symbol": s.get("symbol"), "title": s.get("title"), "watchers": s.get("watchlist_count")})
    except Exception as e:  # noqa: BLE001
        log(f"stocktwits: {e}")

    obj = {"people": people, "moves": moves[:60], "posts": posts[:60], "trending": trending}
    if not any(p["items"] for p in people) and not moves and (DATA / "social.json").exists():
        log("social: empty, keeping previous")
        return
    write("social.json", obj)


# ---------------------------------------------------------------- 4. Curve & credit
def build_curve():
    rows = []
    for yr in sorted({NOW.year, (NOW - timedelta(days=40)).year}):
        url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
               f"{yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value={yr}&page&_format=csv")
        try:
            rows += list(csv.DictReader(io.StringIO(get(url).decode("utf-8-sig"))))
        except Exception as e:  # noqa: BLE001
            log(f"curve {yr}: {e}")
    if not rows:
        return
    for r in rows:
        r["_d"] = datetime.strptime(r["Date"], "%m/%d/%Y")
    rows.sort(key=lambda r: r["_d"], reverse=True)
    tenors = [k for k in rows[0].keys() if k not in ("Date", "_d")]

    def pack(r):
        pts = []
        for k in tenors:
            v = (r.get(k) or "").strip()
            if v:
                m = re.match(r"([\d.]+)\s*(Mo|Month|Mos|Yr)", k)
                if m:
                    pts.append({"tenor": m.group(1) + ("Y" if m.group(2) == "Yr" else "M"), "y": float(v)})
        return {"date": r["_d"].strftime("%Y-%m-%d"), "points": pts}

    latest = rows[0]
    wk = next((r for r in rows if (latest["_d"] - r["_d"]).days >= 7), rows[-1])
    mo = next((r for r in rows if (latest["_d"] - r["_d"]).days >= 30), rows[-1])
    write("curve.json", {"latest": pack(latest), "week": pack(wk), "month": pack(mo)})


FRED = [
    ("SOFR", "SOFR", "%"), ("BAMLH0A0HYM2", "HY OAS", "%"), ("BAMLC0A0CM", "IG OAS", "%"),
    ("BAMLC0A4CBBB", "BBB OAS", "%"), ("T10Y2Y", "2s10s", "%"), ("T10YIE", "10Y breakeven", "%"),
    ("DTWEXBGS", "Broad dollar", "idx"),
]


def build_credit():
    series = []
    for sid, label, unit in FRED:
        try:
            txt = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}").decode()
            pts = []
            for r in csv.DictReader(io.StringIO(txt)):
                d = r.get("observation_date") or r.get("DATE")
                v = r.get(sid)
                if v and v != ".":
                    pts.append([d, float(v)])
            pts = pts[-130:]
            if pts:
                series.append({"id": sid, "label": label, "unit": unit, "points": pts})
        except Exception as e:  # noqa: BLE001
            log(f"fred {sid}: {e}")
    keep_or_write("credit.json", {"series": series}, "series")


# ---------------------------------------------------------------- 5. Live events
def et_now():
    # US Eastern without zoneinfo dependency issues on minimal images
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York"))
    except Exception:  # noqa: BLE001
        return NOW - timedelta(hours=5)


def build_events():
    out = []
    # Treasury auctions
    try:
        j = get_json("https://www.treasurydirect.gov/TA_WS/securities/upcoming?format=json")
        for a in j:
            d = (a.get("auctionDate") or "")[:10]
            if not d:
                continue
            term = a.get("securityTerm") or ""
            typ = a.get("securityType") or ""
            amt = a.get("offeringAmount")
            close = a.get("closingTimeCompetitive") or ""
            hhmm = None
            m = re.search(r"(\d{1,2}):(\d{2})\s*([AP]M)", close)
            if m:
                h = int(m.group(1)) % 12 + (12 if m.group(3) == "PM" else 0)
                hhmm = f"{h:02d}:{m.group(2)}"
            note = f"${float(amt) / 1e9:.0f}B offered" if amt else "Size TBA"
            if a.get("reopening") == "Yes":
                note += " · reopening"
            out.append({"date": d, "time": hhmm or "11:30", "kind": "auction", "title": f"{term} {typ} auction",
                        "where": "US Treasury", "nyc": False, "note": note,
                        "url": "https://www.treasurydirect.gov/auctions/upcoming/"})
    except Exception as e:  # noqa: BLE001
        log(f"auctions: {e}")

    # Earnings today & tomorrow (largest by market cap)
    today = et_now().date()
    for d in (today, today + timedelta(days=1), today + timedelta(days=2)):
        if d.weekday() >= 5:
            continue
        try:
            j = get_json(f"https://api.nasdaq.com/api/calendar/earnings?date={d.isoformat()}",
                         headers={"Accept": "application/json", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"})
            rows = (j.get("data") or {}).get("rows") or []

            def cap(r):
                try:
                    return float(re.sub(r"[^\d.]", "", r.get("marketCap") or "0") or 0)
                except ValueError:
                    return 0
            for r in sorted(rows, key=cap, reverse=True)[:12]:
                t = r.get("time", "")
                when = "BMO" if "pre" in t else "AMC" if "after" in t else "TBD"
                out.append({"date": d.isoformat(), "time": "08:00" if when == "BMO" else "16:05" if when == "AMC" else None,
                            "kind": "earnings", "title": f"{r.get('symbol')} earnings ({when})",
                            "where": r.get("name", ""), "nyc": False,
                            "note": f"EPS est. {r.get('epsForecast') or '—'} · mkt cap {r.get('marketCap') or '—'}",
                            "url": f"https://www.nasdaq.com/market-activity/stocks/{(r.get('symbol') or '').lower()}/earnings"})
        except Exception as e:  # noqa: BLE001
            log(f"earnings {d}: {e}")

    # CFA Society New York (iCal)
    try:
        txt = get("https://cfany.org/events/list/?ical=1").decode("utf-8", "replace")
        txt = re.sub(r"\r?\n[ \t]", "", txt)
        for block in txt.split("BEGIN:VEVENT")[1:]:
            def f(key):
                m = re.search(rf"^{key}[^:\n]*:(.*)$", block, re.M)
                return m.group(1).strip() if m else ""
            ds = f("DTSTART")
            m = re.match(r"(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?", ds)
            if not m:
                continue
            date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            if date < today.isoformat():
                continue
            loc = re.sub(r"\\(.)", r"\1", f("LOCATION"))
            out.append({"date": date, "time": f"{m.group(4)}:{m.group(5)}" if m.group(4) else None, "kind": "nyc",
                        "title": re.sub(r"\\(.)", r"\1", f("SUMMARY")),
                        "where": loc.split(",")[0] if loc.startswith("CFA") else ("CFA Society NY · " + loc.split(",")[0]) if loc else "CFA Society NY",
                        "nyc": "virtual" not in loc.lower(), "note": "Virtual" if "virtual" in loc.lower() else "",
                        "url": f("URL") or "https://cfany.org/events/"})
    except Exception as e:  # noqa: BLE001
        log(f"cfany: {e}")

    keep_or_write("live_events.json", {"items": out}, "items")


def main():
    for step in (build_wire, build_radar, build_social, build_curve, build_credit, build_events):
        try:
            step()
        except Exception as e:  # noqa: BLE001
            log(f"{step.__name__} crashed: {e}")
    write("status.json", {"log": LOG[-80:]})
    print(f"done, {len(LOG)} warnings")


if __name__ == "__main__":
    main()
