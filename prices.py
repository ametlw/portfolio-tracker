"""Price source: Yahoo Finance (yfinance), with a short cache. Crypto candles from Binance.

Stock: AAPL   Crypto: BTC-USD, ETH-USD   FX: TRY=X
Option prices come from the underlying's option chain (bid/ask midpoint).
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

_ONBELLEK: dict = {}
_KILIT = threading.Lock()
SURE = 90  # seconds


def _onbellekli(anahtar, fonk):
    simdi = time.time()
    with _KILIT:
        kayit = _ONBELLEK.get(anahtar)
        if kayit and simdi - kayit[0] < SURE:
            return kayit[1]
    try:
        deger = fonk()
    except Exception:
        deger = None
    with _KILIT:
        _ONBELLEK[anahtar] = (simdi, deger)
    return deger


def onbellegi_temizle():
    with _KILIT:
        _ONBELLEK.clear()


def _yf():
    import yfinance as yf
    return yf


def son_ve_onceki(sembol: str):
    """(last price, previous close), or (None, None) if not found.
    Crypto: Binance (last = live, previous = yesterday's daily candle close); falls back to Yahoo."""
    cift = _binance_cift(sembol)
    if cift:
        def cek_binance():
            m = _binance_klines(cift, "1d", "&limit=2")
            if len(m) < 2:
                return None
            return (m[-1]["close"], m[-2]["close"])
        b = _onbellekli(("bfiyat", cift), cek_binance)
        if b:
            return b
    def cek():
        h = _yf().Ticker(sembol).history(period="7d", interval="1d")
        k = h["Close"].dropna()
        if len(k) == 0:
            return (None, None)
        return (float(k.iloc[-1]), float(k.iloc[-2]) if len(k) >= 2 else None)
    return _onbellekli(("fiyat", sembol), cek) or (None, None)


def kapanis_tarihinde(sembol: str, gun: date):
    """Close for a given day (or the last trading day before it)."""
    def cek():
        h = _yf().Ticker(sembol).history(start=(gun - timedelta(days=7)).isoformat(),
                                         end=(gun + timedelta(days=1)).isoformat(), interval="1d")
        k = h["Close"].dropna()
        return float(k.iloc[-1]) if len(k) else None
    return _onbellekli(("kapanis", sembol, gun.isoformat()), cek)


def opsiyon_kotasyon(dayanak: str, vade: str, strike: float, tur: str):
    """{'alis' (bid), 'satis' (ask), 'son' (last), 'fiyat', 'durum'} or None.
    durum: 'iyi' (ok) | 'genis' (wide spread) | 'alis_yok' (no bid, last used) | 'son_islem' (no quote, last used)."""
    opsiyon_fiyati(dayanak, vade, strike, tur)  # warm the chain cache
    with _KILIT:
        kayit = _ONBELLEK.get(("zincir", dayanak, vade))
    z = kayit[1] if kayit else None
    if not z:
        return None
    for s in z.get(tur, []):
        if abs(float(s["strike"]) - float(strike)) < 1e-6:
            bid, ask, son = float(s.get("bid") or 0), float(s.get("ask") or 0), float(s.get("lastPrice") or 0)
            if bid > 0 and ask > 0:
                orta = (bid + ask) / 2
                genis = (ask - bid) / orta > 0.25 and (ask - bid) > 0.05
                return {"alis": bid, "satis": ask, "son": son, "fiyat": orta, "durum": "genis" if genis else "iyi"}
            if not son:
                return None
            return {"alis": bid, "satis": ask, "son": son, "fiyat": son, "durum": "alis_yok" if ask > 0 else "son_islem"}
    return None


def opsiyon_fiyati(dayanak: str, vade: str, strike: float, tur: str):
    """Per-share option price (bid/ask midpoint, else last trade)."""
    def zincir():
        z = _yf().Ticker(dayanak).option_chain(vade)
        kol = ["strike", "bid", "ask", "lastPrice", "change"]
        return {"put": z.puts[[c for c in kol if c in z.puts]].to_dict("records"),
                "call": z.calls[[c for c in kol if c in z.calls]].to_dict("records")}
    z = _onbellekli(("zincir", dayanak, vade), zincir)
    if not z:
        return None
    for s in z.get(tur, []):
        if abs(float(s["strike"]) - float(strike)) < 1e-6:
            bid, ask, son = float(s["bid"] or 0), float(s["ask"] or 0), float(s["lastPrice"] or 0)
            if bid > 0 and ask > 0:
                return (bid + ask) / 2
            return son or None
    return None


def toplu(semboller):
    """Fetches several symbols in parallel: {symbol: (last, previous)}."""
    semboller = list(dict.fromkeys(s for s in semboller if s))
    if not semboller:
        return {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        sonuc = list(ex.map(son_ve_onceki, semboller))
    return dict(zip(semboller, sonuc))


def opsiyon_onceki_kapanis(dayanak: str, vade: str, strike: float, tur: str):
    """Option close on the previous trading day (last price − daily change)."""
    opsiyon_fiyati(dayanak, vade, strike, tur)  # warm the chain cache
    with _KILIT:
        kayit = _ONBELLEK.get(("zincir", dayanak, vade))
    z = kayit[1] if kayit else None
    if not z:
        return None
    for s in z.get(tur, []):
        if abs(float(s["strike"]) - float(strike)) < 1e-6:
            son, deg = s.get("lastPrice"), s.get("change")
            if son is None or deg is None:
                return None
            onceki = float(son) - float(deg)
            return onceki if onceki > 0 else None
    return None


def kapanis_serisi(sembol: str, bas: date, bit: date) -> dict:
    """{'YYYY-MM-DD': close} — daily closes from 10 days before bas up to bit.
    Crypto: Binance daily candle closes (so daily P&L matches what you see on Binance); falls back to Yahoo."""
    if _binance_cift(sembol):
        b = binance_kapanislar(sembol, bas - timedelta(days=10), bit)
        if b:
            return b
    def cek():
        h = _yf().Ticker(sembol).history(start=(bas - timedelta(days=10)).isoformat(),
                                         end=(bit + timedelta(days=1)).isoformat(), interval="1d")
        k = h["Close"].dropna()
        return {str(i)[:10]: float(x) for i, x in k.items()}
    return _onbellekli(("seri", sembol, bas.isoformat(), bit.isoformat()), cek) or {}


# ---------------------------------------------------------------- charts and option chain

def mumlar(sembol: str, gun: int = 200) -> list:
    """Daily candles: [{time, open, high, low, close}]."""
    def cek():
        h = _yf().Ticker(sembol).history(period=f"{gun}d", interval="1d")
        h = h.dropna(subset=["Open", "High", "Low", "Close"])
        return [{"time": str(i)[:10], "open": float(r.Open), "high": float(r.High),
                 "low": float(r.Low), "close": float(r.Close)} for i, r in h.iterrows()]
    return _onbellekli(("mum", sembol, gun), cek) or []


def vadeler(sembol: str) -> list:
    return _onbellekli(("vadeler", sembol), lambda: list(_yf().Ticker(sembol).options)) or []


def zincir_tablo(sembol: str, vade: str, tur: str) -> list:
    def cek():
        z = _yf().Ticker(sembol).option_chain(vade)
        t = z.puts if tur == "put" else z.calls
        out = []
        for _, r in t.iterrows():
            bid, ask, son = float(r.get("bid") or 0), float(r.get("ask") or 0), float(r.get("lastPrice") or 0)
            out.append({"strike": float(r["strike"]), "bid": bid, "ask": ask, "son": son,
                        "orta": (bid + ask) / 2 if bid > 0 and ask > 0 else son,
                        "iv": float(r.get("impliedVolatility") or 0)})
        return out
    return _onbellekli(("ztablo", sembol, vade, tur), cek) or []


def uzatilmis(sembol: str):
    """Last price including pre/post market: (price, ISO time) or (None, None)."""
    def cek():
        h = _yf().Ticker(sembol).history(period="2d", interval="5m", prepost=True)
        k = h["Close"].dropna()
        if not len(k):
            return (None, None)
        return (float(k.iloc[-1]), k.index[-1].isoformat())
    return _onbellekli(("uzatilmis", sembol), cek) or (None, None)


def uzatilmis_toplu(semboller):
    semboller = list(dict.fromkeys(s for s in semboller if s))
    if not semboller:
        return {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        sonuc = list(ex.map(uzatilmis, semboller))
    return dict(zip(semboller, sonuc))


def anlik(sembol: str):
    """Futures: current price (1-minute bars) and previous settlement: (last, previous)."""
    def cek():
        t = _yf().Ticker(sembol)
        h = t.history(period="2d", interval="1m", prepost=True)["Close"].dropna()
        son = float(h.iloc[-1]) if len(h) else None
        onceki = None
        try:
            onceki = float(t.fast_info["previousClose"])
        except Exception:
            pass
        if not onceki or not son:
            g = son_ve_onceki(sembol)
            son = son or g[0]
            onceki = onceki or g[1]
        return (son, onceki)
    return _onbellekli(("anlik", sembol), cek) or (None, None)


# ---------------------------------------------------------------- long-history candles

def _binance_cift(sembol: str):
    """'ETH-USD' -> 'ETHUSDT'. None if not crypto."""
    if not sembol.endswith("-USD"):
        return None
    return sembol[:-4].replace("-", "") + "USDT"


def _binance_klines(cift: str, aralik: str, ek: str = "") -> list:
    """Binance public candles: [{time (UTC day), open, high, low, close}]."""
    import json as _json
    import urllib.request
    from datetime import datetime, timezone
    url = f"https://api.binance.com/api/v3/klines?symbol={cift}&interval={aralik}{ek}"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "portfolio-tracker"}), timeout=10) as r:
        ham = _json.loads(r.read().decode())
    return [{"time": datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc).date().isoformat(),
             "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4])} for k in ham]


def binance_mumlar(sembol: str, aralik: str = "1d", once: str = None) -> list:
    """Binance public daily/weekly candles (no API key). once: the 1000 candles before this date."""
    cift = _binance_cift(sembol)
    if not cift:
        return []
    def cek():
        from datetime import datetime, timezone
        ek = "&limit=1000"
        if once:
            bit = int(datetime.fromisoformat(once).replace(tzinfo=timezone.utc).timestamp() * 1000) - 1
            ek += f"&endTime={bit}"
        return _binance_klines(cift, aralik, ek)
    return _onbellekli(("binance", cift, aralik, once), cek) or []


def binance_kapanislar(sembol: str, bas: date, bit: date) -> dict:
    """Crypto daily closes from Binance: {'YYYY-MM-DD': close}. Days are UTC (close at 00:00 UTC).
    Returns {} if the pair is not on Binance or Binance is unreachable (the caller then uses Yahoo)."""
    cift = _binance_cift(sembol)
    if not cift:
        return {}
    def cek():
        from datetime import datetime, timezone
        bas_ms = int(datetime.combine(bas, datetime.min.time(), tzinfo=timezone.utc).timestamp() * 1000)
        out, bitis = {}, bit.isoformat()
        while True:   # pages of 1000
            m = _binance_klines(cift, "1d", f"&startTime={bas_ms}&limit=1000")
            for k in m:
                if k["time"] <= bitis:
                    out[k["time"]] = k["close"]
            if len(m) < 1000 or m[-1]["time"] >= bitis:
                return out
            bas_ms = int(datetime.fromisoformat(m[-1]["time"]).replace(tzinfo=timezone.utc).timestamp() * 1000) + 86400000
    return _onbellekli(("bkapanis", cift, bas.isoformat(), bit.isoformat()), cek) or {}


def yahoo_tum_mumlar(sembol: str, aralik: str = "1d") -> list:
    """Full history from Yahoo (daily or weekly)."""
    def cek():
        h = _yf().Ticker(sembol).history(period="max", interval="1wk" if aralik == "1w" else "1d")
        h = h.dropna(subset=["Open", "High", "Low", "Close"])
        out, gorulen = [], set()
        for i, r in h.iterrows():
            t = str(i)[:10]
            if t in gorulen:
                continue
            gorulen.add(t)
            out.append({"time": t, "open": float(r.Open), "high": float(r.High), "low": float(r.Low), "close": float(r.Close)})
        return out
    return _onbellekli(("ytum", sembol, aralik), cek) or []


def grafik_mumlari(sembol: str, aralik: str = "1d", once: str = None, adet: int = 1000) -> dict:
    """Crypto: Binance first, else Yahoo. Stocks: Yahoo. {mumlar, kaynak, daha_var}"""
    if _binance_cift(sembol):
        m = binance_mumlar(sembol, aralik, once)
        if m:
            return {"mumlar": m, "kaynak": "Binance", "daha_var": len(m) >= 1000}
        if once:  # no more Binance history
            return {"mumlar": [], "kaynak": "Binance", "daha_var": False}
    tum = yahoo_tum_mumlar(sembol, aralik)
    if once:
        tum = [m for m in tum if m["time"] < once]
    return {"mumlar": tum[-adet:], "kaynak": "Yahoo", "daha_var": len(tum) > adet}


# ---------------------------------------------------------------- Hyperliquid stock perps (HIP-3)
HL_DEXLER = ("xyz", "para", "io", "mkts")   # order = priority (if a stock is listed on several dexes, the first wins)


def _hl_mids(dex: str) -> dict:
    import json as _json
    import urllib.request
    istek = urllib.request.Request("https://api.hyperliquid.xyz/info",
                                   data=_json.dumps({"type": "allMids", "dex": dex}).encode(),
                                   headers={"Content-Type": "application/json", "User-Agent": "portfolio-tracker"})
    with urllib.request.urlopen(istek, timeout=8) as r:
        return _json.loads(r.read().decode())


def hl_fiyatlar() -> dict:
    """Hyperliquid stock perp mid prices: {'NVDA': 190.2, …}. They trade 24/7, so they stay current when the market is closed.
    No key needed; returns {} if unreachable (the caller falls back to Yahoo)."""
    def cek():
        def guvenli(dex):
            try:
                return _hl_mids(dex)
            except Exception:
                return {}
        with ThreadPoolExecutor(max_workers=len(HL_DEXLER)) as ex:
            sonuclar = list(ex.map(guvenli, HL_DEXLER))
        out = {}
        for mids in sonuclar:
            for k, f in (mids or {}).items():
                t = str(k).split(":")[-1].upper()
                try:
                    f = float(f)
                except (TypeError, ValueError):
                    continue
                if f > 0 and t not in out:
                    out[t] = f
        return out
    return _onbellekli(("hl",), cek) or {}
