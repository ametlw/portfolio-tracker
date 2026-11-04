"""Portfolio data and calculations.

All data lives in veri/veri.json. Amounts are in USD.
"""
import json
import math
import os
import shutil
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import fiyat as fy

KLASOR = Path(__file__).parent / "veri"
DOSYA = KLASOR / "veri.json"
YEDEKLER = KLASOR / "yedekler"
YEDEK_GUN = 30


class _Kilit:
    """Thread + process lock, so the panel and the nightly task never write the data file at the same time."""

    def __init__(self):
        self._r = threading.RLock()
        self._derinlik = 0
        self._f = None

    def _dosya_kilitle(self):
        KLASOR.mkdir(exist_ok=True)
        self._f = open(KLASOR / ".kilit", "a+b")
        bas = time.time()
        while True:
            try:
                if os.name == "nt":
                    import msvcrt
                    self._f.seek(0)
                    msvcrt.locking(self._f.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self._f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except OSError:
                if time.time() - bas > 300:   # waited 5 min; never continue without the lock
                    self._f.close()
                    self._f = None
                    raise RuntimeError("Data file is locked by another process")
                time.sleep(0.2)

    def _dosya_birak(self):
        try:
            if os.name == "nt":
                import msvcrt
                self._f.seek(0)
                msvcrt.locking(self._f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._f.fileno(), fcntl.LOCK_UN)
        finally:
            self._f.close()
            self._f = None

    def __enter__(self):
        self._r.acquire()
        try:
            if self._derinlik == 0:
                self._dosya_kilitle()
        except BaseException:
            self._r.release()
            raise
        self._derinlik += 1
        return self

    def __exit__(self, *a):
        self._derinlik -= 1
        try:
            if self._derinlik == 0:
                self._dosya_birak()
        finally:
            self._r.release()
        return False


_KILIT = _Kilit()

SINIFLAR = ["nakit", "kripto", "hisse", "opsiyon", "vadeli"]


def yeni_id() -> str:
    return uuid.uuid4().hex[:10]


def bugun() -> date:
    return date.today()


# ---------------------------------------------------------------- read / write

def bos_veri() -> dict:
    return {"ayarlar": {"baslangic_tarihi": bugun().isoformat(), "baslangic_nakit": 0.0,
                        "baslangic_bakiye": None, "baslangic_usdtry": None},
            "varliklar": [], "islemler": [], "nakit_hareketleri": [], "izleme": [], "gunluk": {},
            "olaylar": [], "gun_ici": {}, "vadeli": {"hareketler": [], "islemler": [], "ayar": {}}}


def oku() -> dict:
    with _KILIT:
        if not DOSYA.exists():
            ilk = KLASOR / "baslangic.json"
            if ilk.exists():
                return json.loads(ilk.read_text(encoding="utf-8"))
            return bos_veri()
        v = json.loads(DOSYA.read_text(encoding="utf-8"))
        for k, d in bos_veri().items():
            v.setdefault(k, d)
        return v


def yaz(v: dict) -> None:
    with _KILIT:
        KLASOR.mkdir(exist_ok=True)
        gecici = DOSYA.with_suffix(".tmp")
        gecici.write_text(json.dumps(v, ensure_ascii=False, indent=2), encoding="utf-8")
        if DOSYA.exists():
            shutil.copyfile(DOSYA, KLASOR / "veri.yedek.json")
        gecici.replace(DOSYA)
        gunluk_yedek()


def ny_simdi() -> datetime:
    """Current New York time (to know whether the US market has closed)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).replace(tzinfo=None)
    except Exception:   # no time zone data: approximate with UTC-5
        from datetime import timezone
        return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=5)


def abd_seans_acik(ny: datetime | None = None) -> bool:
    """Is the US regular session open (weekdays 09:30–16:00 New York)? Market holidays are not considered."""
    ny = ny or ny_simdi()
    return ny.weekday() < 5 and (9, 30) <= (ny.hour, ny.minute) < (16, 0)


def kapanis_gecti_mi(gun: date) -> bool:
    """Has that day's US close (16:00 New York) passed? Needed to mark an end-of-day snapshot as final."""
    ny = ny_simdi()
    return ny.date() > gun or (ny.date() == gun and (ny.hour, ny.minute) >= (16, 15))


def gunluk_yedek() -> None:
    """Once a day: veri/yedekler/veri-YYYY-MM-DD.json; the last 30 days are kept."""
    try:
        YEDEKLER.mkdir(parents=True, exist_ok=True)
        hedef = YEDEKLER / f"veri-{bugun().isoformat()}.json"
        if not hedef.exists() and DOSYA.exists():
            shutil.copyfile(DOSYA, hedef)
        eski = sorted(YEDEKLER.glob("veri-????-??-??.json"))
        for f in eski[:-YEDEK_GUN]:
            f.unlink()
        oncesi = sorted(YEDEKLER.glob("geri-yukleme-oncesi-*.json"))
        for f in oncesi[:-10]:
            f.unlink()
    except OSError:
        pass  # if the backup fails, the main save has still succeeded


def yedek_listesi() -> list:
    if not YEDEKLER.exists():
        return []
    out = []
    for f in sorted(YEDEKLER.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        out.append({"dosya": f.name, "boyut": f.stat().st_size,
                    "zaman": datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="minutes")})
    return out


# ---------------------------------------------------------------- position math

def carpan(varlik: dict) -> float:
    return 100.0 if varlik["sinif"] == "opsiyon" else 1.0


def pozisyon(varlik: dict, islemler: list, kadar: date | None = None) -> dict:
    """Quantity, average cost and realized P&L using weighted average cost."""
    m = carpan(varlik)
    miktar = maliyet_top = gerceklesen = 0.0
    for i in sorted((x for x in islemler if x["varlik_id"] == varlik["id"]),
                    key=lambda x: (x["tarih"], x.get("sira", 0), x["tip"] == "sat")):   # same day: buys first
        if kadar and date.fromisoformat(i["tarih"]) > kadar:
            continue
        q, p = float(i["miktar"]), float(i["fiyat"])
        if i["tip"] == "al":
            miktar += q
            maliyet_top += q * p * m
        else:
            q = min(q, miktar)
            ort = maliyet_top / miktar if miktar else 0.0
            gerceklesen += q * p * m - q * ort
            maliyet_top -= q * ort
            miktar -= q
    if miktar < 1e-12:
        miktar, maliyet_top = 0.0, 0.0
    return {"miktar": miktar, "maliyet": maliyet_top,
            "ort_maliyet": (maliyet_top / miktar / m) if miktar else None,
            "gerceklesen": gerceklesen}


def satis_hatasi(varlik: dict, islemler: list) -> str | None:
    """Replaying trades in date order, is anything sold that wasn't held at the time? Returns an error message if so."""
    miktar = 0.0
    for i in sorted((x for x in islemler if x["varlik_id"] == varlik["id"]),
                    key=lambda x: (x["tarih"], x["tip"] == "sat")):   # same day: buys first
        q = float(i["miktar"])
        if i["tip"] == "al":
            miktar += q
        else:
            if q > miktar + 1e-9:
                return (f"On {i['tarih']} you held {miktar:g}, so {q:g} cannot be sold. "
                        "Check the date.")
            miktar -= q
    return None


def nakit_bakiyesi(v: dict, kadar: date | None = None) -> float:
    n = float(v["ayarlar"].get("baslangic_nakit") or 0)
    for h in v["nakit_hareketleri"]:
        if kadar and date.fromisoformat(h["tarih"]) > kadar:
            continue
        n += float(h["tutar"]) if h["tip"] == "yatir" else -float(h["tutar"])
    # money moved from cash to the futures wallet leaves cash; money withdrawn from it returns to cash
    for h in vadeli_hareketleri(v):
        if h.get("kaynak", "nakit") != "nakit" or h["tip"] == "duzelt":
            continue
        if kadar and date.fromisoformat(h["tarih"]) > kadar:
            continue
        n += -float(h["tutar"]) if h["tip"] == "yatir" else float(h["tutar"])
    vmap = {x["id"]: x for x in v["varliklar"]}
    for i in v["islemler"]:
        if not i.get("nakit_etkisi", True):
            continue
        if kadar and date.fromisoformat(i["tarih"]) > kadar:
            continue
        var = vmap.get(i["varlik_id"])
        if not var:
            continue
        tutar = float(i["miktar"]) * float(i["fiyat"]) * carpan(var)
        n += tutar if i["tip"] == "sat" else -tutar
    return n


def net_yatirim(v: dict, kadar: date | None = None) -> float:
    t = 0.0
    for h in v["nakit_hareketleri"]:
        if kadar and date.fromisoformat(h["tarih"]) > kadar:
            continue
        t += float(h["tutar"]) if h["tip"] == "yatir" else -float(h["tutar"])
    # money put into/taken out of the futures wallet from outside (bank, exchange directly) counts as investment
    for h in vadeli_hareketleri(v):
        if h.get("kaynak", "nakit") != "dis" or h["tip"] == "duzelt":
            continue
        if kadar and date.fromisoformat(h["tarih"]) > kadar:
            continue
        t += float(h["tutar"]) if h["tip"] == "yatir" else -float(h["tutar"])
    return t


# ---------------------------------------------------------------- futures (perps: crypto or stock)
# Separate wallet (like on an exchange): money is moved in from cash or from outside; trades run inside the wallet.
# Wallet balance = transfers ± adjustments + realized P&L. Open positions' margin is the wallet's "used margin".
# Futures value (counted in the portfolio) = wallet balance + open P&L.
# Trade: {id, piyasa kripto|hisse, sembol ('BTC-USD' or 'NVDA'), yon long|short, hizli (quick), durum acik|kapali,
#         acilis_tarih, kapanis_tarih, giris, cikis, buyukluk (qty), kaldirac, stop, hedef, komisyon, sonuc (quick), etiket, not}
# Transfer: {id, tarih, tip yatir|cek|duzelt, tutar (signed for adjustments), kaynak nakit|dis, not}
#   kaynak nakit: from/to the panel's cash; dis: from/to outside (money already on the exchange or from the bank → counts as investment)
MMR = 0.005   # approximate maintenance margin rate, for the liquidation estimate


def vadeli_hareketleri(v: dict) -> list:
    return (v.get("vadeli") or {}).get("hareketler", [])


def vadeli_islemleri(v: dict) -> list:
    return (v.get("vadeli") or {}).get("islemler", [])


def _yon(i: dict) -> float:
    return 1.0 if i["yon"] == "long" else -1.0


def vadeli_gerceklesen(i: dict) -> float:
    """Net P&L of a closed trade (after fees)."""
    if i.get("hizli"):
        return float(i["sonuc"])
    return (float(i["cikis"]) - float(i["giris"])) * float(i["buyukluk"]) * _yon(i) - float(i.get("komisyon") or 0)


def vadeli_acik_kz(i: dict, fiyat):
    if fiyat is None:
        return None
    return (float(fiyat) - float(i["giris"])) * float(i["buyukluk"]) * _yon(i)


def vadeli_marj(i: dict) -> float:
    """Margin tied to the position. Without leverage, 1x (full size)."""
    if i.get("hizli"):
        return 0.0
    return float(i["giris"]) * float(i["buyukluk"]) / max(float(i.get("kaldirac") or 1), 1e-9)


def vadeli_likidasyon(i: dict):
    """Approximate liquidation price on isolated margin. None without leverage or at 1x."""
    k = float(i.get("kaldirac") or 0)
    if k <= 1 or i.get("hizli"):
        return None
    g = float(i["giris"])
    return g * (1 - 1 / k + MMR) if i["yon"] == "long" else g * (1 + 1 / k - MMR)


def vadeli_risk(i: dict):
    """Loss if the stop is hit ($, positive). None without a stop."""
    if i.get("hizli") or not i.get("stop"):
        return None
    return max((float(i["giris"]) - float(i["stop"])) * _yon(i), 0.0) * float(i["buyukluk"])


def _gun_sonu_acik(i: dict, gun: date) -> bool:
    if i.get("hizli") or date.fromisoformat(i["acilis_tarih"]) > gun:
        return False
    return i["durum"] == "acik" or date.fromisoformat(i["kapanis_tarih"]) > gun


def vadeli_cuzdan(v: dict, kadar: date | None = None) -> float:
    """Wallet balance: transfers ± adjustments + P&L of closed trades (excluding open P&L)."""
    c = 0.0
    for h in vadeli_hareketleri(v):
        if kadar and date.fromisoformat(h["tarih"]) > kadar:
            continue
        c += -float(h["tutar"]) if h["tip"] == "cek" else float(h["tutar"])
    for i in vadeli_islemleri(v):
        if i["durum"] == "kapali" and (not kadar or date.fromisoformat(i["kapanis_tarih"]) <= kadar):
            c += vadeli_gerceklesen(i)
    return c


def vadeli_akis(v: dict, kadar: date | None = None) -> float:
    """Money moved into − out of the wallet (deposit/withdraw). Adjustments are P&L, not flows."""
    return sum((float(h["tutar"]) if h["tip"] == "yatir" else -float(h["tutar"])) for h in vadeli_hareketleri(v)
               if h["tip"] != "duzelt" and (not kadar or date.fromisoformat(h["tarih"]) <= kadar))


def vadeli_kz(v: dict, gun: date, deger: float) -> float:
    """Total futures P&L at the end of that day = futures value − net money moved into the wallet up to that day."""
    return deger - vadeli_akis(v, gun)


def vadeli_fiyat(i: dict, fiyatlar: dict, hl: dict):
    """Stock perp: Hyperliquid (24/7), else Yahoo. Crypto: Binance/Yahoo."""
    if i.get("piyasa") == "hisse" and hl.get(i["sembol"]):
        return hl[i["sembol"]]
    return fiyatlar.get(i["sembol"], (None, None))[0]


def vadeli_degerle(v: dict, fiyatlar: dict) -> dict:
    cuzdan = vadeli_cuzdan(v)
    acik = [i for i in vadeli_islemleri(v) if i["durum"] == "acik"]
    hl = fy.hl_fiyatlar() if any(i.get("piyasa") == "hisse" for i in acik) else {}
    pozisyonlar, acik_kz, kullanilan, eksik = [], 0.0, 0.0, []
    for i in acik:
        f = vadeli_fiyat(i, fiyatlar, hl)
        kz = vadeli_acik_kz(i, f)
        m = vadeli_marj(i)
        kullanilan += m
        if kz is None:
            eksik.append(i["sembol"].replace("-USD", "") + " (vadeli)")
        else:
            acik_kz += kz
        pozisyonlar.append({**i, "fiyat": f, "kz": kz, "buyukluk_usd": float(i["giris"]) * float(i["buyukluk"]),
                            "marj": m, "likidasyon": vadeli_likidasyon(i), "risk": vadeli_risk(i)})
    ozs = cuzdan + acik_kz
    return {"cuzdan": cuzdan, "acik_kz": acik_kz, "ozsermaye": ozs, "kullanilan_marj": kullanilan,
            "kullanilabilir": ozs - kullanilan, "pozisyonlar": pozisyonlar, "eksik": eksik}


# ---------------------------------------------------------------- prices

def varlik_fiyati(varlik: dict, fiyatlar: dict):
    """(current price, previous close, source). Options have no previous close here."""
    if varlik["sinif"] == "opsiyon":
        # Option prices update only during the US session. Outside it Yahoo can return stale or bogus bid/ask
        # (e.g. 0.05 / 8.75 → mid 4.40), so the balance stays at the last session price.
        # In session: a clean quote (bid and ask present, reasonable spread) is used and stored as the "session price";
        # otherwise manual price > last session price > last trade / bid.
        # A clean quote in the 2 hours after the close (NY 16:00–18:00) is the closing quote (no trading),
        # so it is stored too: the price stays at the close even if the panel wasn't open in the last minutes.
        o = varlik["opsiyon"]
        ny = ny_simdi()
        seans = abd_seans_acik(ny)
        kapanis_sonrasi = ny.weekday() < 5 and (16, 0) <= (ny.hour, ny.minute) < (18, 0)
        k = fy.opsiyon_kotasyon(o["dayanak"], o["vade"], float(o["strike"]), o["tur"])
        if (seans or kapanis_sonrasi) and k and k["durum"] == "iyi":
            varlik["seans_fiyati"] = {"fiyat": k["fiyat"], "zaman": ny.isoformat(timespec="minutes")}
            return k["fiyat"], None, "canlı" if seans else "seans_kapanis"
        if varlik.get("elle_fiyat") is not None:
            return float(varlik["elle_fiyat"]), None, "elle"
        sf = varlik.get("seans_fiyati") or {}
        if sf.get("fiyat"):
            return float(sf["fiyat"]), None, "seans_kapanis" if not seans else "son_guvenilir"
        if k and k["son"] > 0:   # the last trade is a real session trade
            return k["son"], None, "seans_kapanis" if not seans else "son_islem"
        if seans and k:
            return (k["alis"] if k["alis"] > 0 else k["fiyat"]), None, "son_islem"
        return None, None, "yok"
    son, onceki = fiyatlar.get(varlik["sembol"], (None, None))
    if son is not None:
        return son, onceki, "canlı"
    if varlik.get("elle_fiyat") is not None:
        return float(varlik["elle_fiyat"]), None, "elle"
    return None, None, "yok"


def sembol_listesi(v: dict) -> list:
    s = ["TRY=X"]
    for x in v["varliklar"]:
        if x["sinif"] == "opsiyon":
            s.append(x["opsiyon"]["dayanak"])
        else:
            s.append(x["sembol"])
    s += [x["sembol"] for x in v["izleme"]]
    s += [i["sembol"] for i in vadeli_islemleri(v) if i["durum"] == "acik"]
    return s


# ---------------------------------------------------------------- expired options

def vadesi_gecenleri_kapat(v: dict) -> bool:
    degisti = False
    for var in v["varliklar"]:
        if var["sinif"] != "opsiyon":
            continue
        o = var["opsiyon"]
        vade = date.fromisoformat(o["vade"])
        if vade >= bugun():
            continue
        poz = pozisyon(var, v["islemler"])
        if poz["miktar"] <= 0:
            continue
        S = fy.kapanis_tarihinde(o["dayanak"], vade)
        if S is None:
            continue  # no price yet: try again next time
        K = float(o["strike"])
        ic = max(K - S, 0.0) if o["tur"] == "put" else max(S - K, 0.0)
        v["islemler"].append({"id": yeni_id(), "varlik_id": var["id"], "tarih": vade.isoformat(),
                              "tip": "sat", "miktar": poz["miktar"], "fiyat": round(ic, 4),
                              "nakit_etkisi": True, "not": f"Vade doldu (dayanak {S:.2f})", "otomatik": True})
        olay(v, "satis", f"{var['ad']} expired, closed {'at intrinsic value' if ic > 0 else 'worthless'}: "
             f"{poz['miktar']:g} × ${ic:.2f}", "opsiyon", var["id"], poz["miktar"] * ic * 100)
        degisti = True
    return degisti


# ---------------------------------------------------------------- live valuation

def degerle(v: dict) -> dict:
    """Current value of all holdings, cash and total."""
    fiyatlar = fy.toplu(sembol_listesi(v))
    usdtry = fiyatlar.get("TRY=X", (None, None))[0] or v["ayarlar"].get("son_usdtry")
    kalemler = []
    for var in v["varliklar"]:
        poz = pozisyon(var, v["islemler"])
        f, onceki, kaynak = varlik_fiyati(var, fiyatlar)
        if f is None and poz["miktar"] and poz["ort_maliyet"]:
            f, kaynak = poz["ort_maliyet"], "maliyet"   # no price: value at cost
        m = carpan(var)
        deger = poz["miktar"] * f * m if (f is not None and poz["miktar"]) else (0.0 if not poz["miktar"] else None)
        kz = (deger - poz["maliyet"]) if (deger is not None and poz["miktar"]) else None
        dayanak = kotasyon = None
        if var["sinif"] == "opsiyon":
            dayanak = fiyatlar.get(var["opsiyon"]["dayanak"], (None, None))[0]
            if kaynak in ("canlı", "son_guvenilir", "son_islem") and poz["miktar"]:
                o = var["opsiyon"]
                kotasyon = fy.opsiyon_kotasyon(o["dayanak"], o["vade"], float(o["strike"]), o["tur"])
        kalemler.append({
            **var, **poz, "fiyat": f, "onceki": onceki, "fiyat_kaynagi": kaynak, "deger": deger,
            "kz": kz, "kz_yuzde": (kz / poz["maliyet"] * 100) if (kz is not None and poz["maliyet"]) else None,
            "gunluk_yuzde": ((f / onceki - 1) * 100) if (f and onceki) else None,
            "dayanak_fiyat": dayanak, "acik": poz["miktar"] > 0, "kotasyon": kotasyon,
            "kar_al_durum": kar_al_durumu(var, poz, f),
            "kademeli_durum": kademeli_durumu(var.get("kademeli", []), f),
        })
    nakit = nakit_bakiyesi(v)
    vd = vadeli_degerle(v, fiyatlar)
    sinif = {"nakit": nakit, "kripto": 0.0, "hisse": 0.0, "opsiyon": 0.0, "vadeli": vd["ozsermaye"]}
    eksik = list(vd["eksik"])
    for k in kalemler:
        if not k["acik"]:
            continue
        if k["fiyat_kaynagi"] in ("maliyet", "yok"):
            eksik.append(k["ad"] or k["sembol"])
        if k["deger"] is not None:
            sinif[k["sinif"]] += k["deger"]
    toplam = sum(sinif.values())
    izleme = []
    for w in v["izleme"]:
        son, onceki = fiyatlar.get(w["sembol"], (None, None))
        hedef = w.get("hedef_fiyat")
        izleme.append({**w, "fiyat": son,
                       "gunluk_yuzde": ((son / onceki - 1) * 100) if (son and onceki) else None,
                       "hedefe_uzaklik": ((son / float(hedef) - 1) * 100) if (son and hedef) else None,
                       "kademeli_durum": kademeli_durumu(w.get("kademeli", []), son)})
    return {"kalemler": kalemler, "sinif": sinif, "toplam": toplam, "nakit": nakit,
            "usdtry": usdtry, "eksik_fiyat": eksik, "izleme": izleme, "vadeli": vd}


def kar_al_durumu(var, poz, f):
    sonuc = []
    ort = poz["ort_maliyet"]
    for h in var.get("kar_al", []):
        hedef_fiyat = float(h["deger"]) * ort if (h["tip"] == "kat" and ort) else (
            float(h["deger"]) if h["tip"] == "fiyat" else None)
        ilerleme = None
        if hedef_fiyat and f is not None and ort:
            if hedef_fiyat > ort:
                ilerleme = max(0.0, min(1.0, (f - ort) / (hedef_fiyat - ort)))
        sonuc.append({**h, "hedef_fiyat": hedef_fiyat, "ilerleme": ilerleme,
                      "geldi": bool(hedef_fiyat and f is not None and f >= hedef_fiyat)})
    return sonuc


def kademeli_durumu(plan, f):
    sonuc, toplam_tutar, toplam_adet = [], 0.0, 0.0
    for k in plan:
        fiyat_k, tutar = float(k["fiyat"]), float(k["tutar"])
        toplam_tutar += tutar
        toplam_adet += tutar / fiyat_k if fiyat_k else 0
        sonuc.append({**k, "geldi": bool(f is not None and f <= fiyat_k),
                      "uzaklik": ((f / fiyat_k - 1) * 100) if (f and fiyat_k) else None})
    return {"seviyeler": sonuc, "toplam_tutar": toplam_tutar,
            "ort_maliyet": (toplam_tutar / toplam_adet) if toplam_adet else None}


# ---------------------------------------------------------------- daily snapshots

def gun_kaydi(v: dict, d: dict, gun: date, kesin: bool = False) -> None:
    """Writes the values for a given day to the journal (overwrites that day if present)."""
    ay = v["ayarlar"]
    v["gunluk"][gun.isoformat()] = {
        "toplam": round(d["toplam"], 2),
        "nakit": round(d["nakit"], 2),
        "sinif": {k: round(x, 2) for k, x in d["sinif"].items()},
        "varlik": {k["id"]: round(k["deger"], 2) for k in d["kalemler"] if k["deger"] is not None},
        "net_yatirim": round(net_yatirim(v, gun), 2),
        "usdtry": d["usdtry"],
        "zaman": datetime.now().isoformat(timespec="seconds"),
        "kesin": bool(kesin),
    }
    if d["usdtry"]:
        ay["son_usdtry"] = d["usdtry"]


# ---------------------------------------------------------------- starting balance (cost based)

def baslangic_belirle(v: dict) -> bool:
    """Starting balance = starting cash + cost of positions held before the start date.

    This way gains above cost on positions you already held show up in P&L.
    Unless the user set a value manually in Settings, it is recomputed every time
    (so it stays correct when cash changes or an older position is added later).
    """
    ay = v["ayarlar"]
    maliyetler = {}
    vmap = {x["id"]: x for x in v["varliklar"]}
    for i in v["islemler"]:
        if i.get("nakit_etkisi", True) or i["varlik_id"] not in vmap:
            continue
        tutar = float(i["miktar"]) * float(i["fiyat"]) * carpan(vmap[i["varlik_id"]])
        maliyetler[i["varlik_id"]] = maliyetler.get(i["varlik_id"], 0.0) + (tutar if i["tip"] == "al" else -tutar)
    otomatik = round(float(ay.get("baslangic_nakit") or 0) + sum(maliyetler.values()), 2)
    ay["baslangic_otomatik"] = otomatik
    yeni_varlik = {k: round(x, 2) for k, x in maliyetler.items()}
    degisti = ay.get("baslangic_varlik") != yeni_varlik
    ay["baslangic_varlik"] = yeni_varlik
    if ay.get("baslangic_bakiye_elle") and ay.get("baslangic_bakiye") is not None:
        return degisti
    if ay.get("baslangic_bakiye") != otomatik:
        ay["baslangic_bakiye"] = otomatik
        degisti = True
    return degisti


# ---------------------------------------------------------------- filling in past days

def _N(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_fiyat(S, K, T, iv, tur, r=0.04):
    if S is None or S <= 0:
        return None
    if T <= 0 or iv is None or iv <= 0:
        return max(K - S, 0.0) if tur == "put" else max(S - K, 0.0)
    st = iv * math.sqrt(T)
    d1 = (math.log(S / K) + (r + iv * iv / 2) * T) / st
    d2 = d1 - st
    if tur == "put":
        return K * math.exp(-r * T) * _N(-d2) - S * _N(-d1)
    return S * _N(d1) - K * math.exp(-r * T) * _N(d2)


def zimni_vol(p, S, K, T, tur):
    if not p or not S or T <= 0:
        return None
    lo, hi = 0.01, 6.0
    if bs_fiyat(S, K, T, hi, tur) < p:
        return None
    for _ in range(80):
        m = (lo + hi) / 2
        if bs_fiyat(S, K, T, m, tur) > p:
            hi = m
        else:
            lo = m
    return (lo + hi) / 2


def _kapanis(seri_: dict, gun: date):
    """Last close on or before gun."""
    aday = [k for k in seri_ if k <= gun.isoformat()]
    return seri_[max(aday)] if aday else None


def gun_degerle(v: dict, gun: date, seriler: dict, guncel: dict) -> dict:
    """Closing values for a past day (crypto/stocks: actual close, options: approximate)."""
    kalemler, eksik = [], []
    for var in v["varliklar"]:
        poz = pozisyon(var, v["islemler"], kadar=gun)
        if poz["miktar"] <= 0:
            continue
        f = None
        if var["sinif"] == "opsiyon":
            o = var["opsiyon"]
            K, tur, vade = float(o["strike"]), o["tur"], date.fromisoformat(o["vade"])
            dseri = seriler.get(o["dayanak"], {})
            onceki_gunler = sorted(k for k in dseri if k < bugun().isoformat())
            if onceki_gunler and onceki_gunler[-1] == gun.isoformat():
                f = fy.opsiyon_onceki_kapanis(o["dayanak"], o["vade"], K, tur)
            if f is None:
                # interpolate IV over time between the purchase day (implied by the premium paid) and today
                g = guncel.get(var["id"], {})
                S_gun = _kapanis(dseri, gun)
                iv_simdi = zimni_vol(g.get("fiyat"), g.get("dayanak"), K, max((vade - bugun()).days, 0) / 365, tur)
                alislar = sorted(i["tarih"] for i in v["islemler"] if i["varlik_id"] == var["id"] and i["tip"] == "al")
                iv_alis = None
                if alislar and poz["ort_maliyet"]:
                    alis_gun = date.fromisoformat(alislar[0])
                    iv_alis = zimni_vol(poz["ort_maliyet"], _kapanis(dseri, alis_gun), K,
                                        max((vade - alis_gun).days, 0) / 365, tur)
                if iv_alis and iv_simdi:
                    toplam_gun = max((bugun() - alis_gun).days, 1)
                    w = min(max((gun - alis_gun).days / toplam_gun, 0.0), 1.0)
                    iv = iv_alis * (1 - w) + iv_simdi * w
                else:
                    iv = iv_simdi or iv_alis
                if iv and S_gun:
                    f = bs_fiyat(S_gun, K, max((vade - gun).days, 0) / 365, iv, tur)
        else:
            f = _kapanis(seriler.get(var["sembol"], {}), gun)
        if f is None:
            f = float(var["elle_fiyat"]) if var.get("elle_fiyat") is not None else poz["ort_maliyet"]
            eksik.append(var["ad"])
        kalemler.append({"id": var["id"], "sinif": var["sinif"], "deger": poz["miktar"] * f * carpan(var)})
    nakit = nakit_bakiyesi(v, kadar=gun)
    vadeli = vadeli_cuzdan(v, kadar=gun)
    for i in vadeli_islemleri(v):
        if _gun_sonu_acik(i, gun):
            f = _kapanis(seriler.get(i["sembol"], {}), gun)
            if f is None:
                eksik.append(i["sembol"] + " (vadeli)")
            else:
                vadeli += vadeli_acik_kz(i, f)
    sinif = {"nakit": nakit, "kripto": 0.0, "hisse": 0.0, "opsiyon": 0.0, "vadeli": vadeli}
    for k in kalemler:
        sinif[k["sinif"]] += k["deger"]
    return {"kalemler": kalemler, "sinif": sinif, "toplam": sum(sinif.values()), "nakit": nakit,
            "usdtry": _kapanis(seriler.get("TRY=X", {}), gun), "eksik_fiyat": eksik}


def _kesin_mi(kayit: dict, gun: date) -> bool:
    if not kayit:
        return False
    if kayit.get("kesin"):
        return True
    try:
        return datetime.fromisoformat(kayit["zaman"]) >= datetime.combine(gun + timedelta(days=1), datetime.min.time())
    except Exception:
        return False


def gecmisi_yenile(v: dict, tarih: str | None, en_fazla_gun: int = 180) -> None:
    """A back-dated change (trade, transfer…) makes the snapshots after that date stale:
    daily entries from that date to yesterday are removed and eksikleri_tamamla rewrites them from closing prices.
    Only the range that can be refilled (the last en_fazla_gun days) is removed."""
    if not tarih:
        return
    bas = max(date.fromisoformat(str(tarih)[:10]), bugun() - timedelta(days=en_fazla_gun))
    for g in list(v["gunluk"]):
        if bas.isoformat() <= g < bugun().isoformat():
            del v["gunluk"][g]


def eksikleri_tamamla(v: dict, guncel_degerler: dict, en_fazla_gun: int = 180) -> int:
    """Writes days from the start date to yesterday that are missing or only have intraday values, using closes."""
    bas = date.fromisoformat(v["ayarlar"]["baslangic_tarihi"])
    dun = bugun() - timedelta(days=1)
    bas = max(bas, dun - timedelta(days=en_fazla_gun))
    gunler = []
    g = bas
    while g <= dun:
        if not _kesin_mi(v["gunluk"].get(g.isoformat()), g):
            gunler.append(g)
        g += timedelta(days=1)
    if not gunler:
        return 0
    semboller = {"TRY=X"}
    for var in v["varliklar"]:
        semboller.add(var["opsiyon"]["dayanak"] if var["sinif"] == "opsiyon" else var["sembol"])
    semboller |= {i["sembol"] for i in vadeli_islemleri(v) if not i.get("hizli")}
    seriler = {s: fy.kapanis_serisi(s, gunler[0], dun) for s in semboller}
    if not any(seriler.values()):
        return 0  # data source unreachable, will retry later
    guncel = {k["id"]: {"fiyat": k["fiyat"] if k["fiyat_kaynagi"] in ("canlı", "elle") else None,
                        "dayanak": k.get("dayanak_fiyat")} for k in guncel_degerler["kalemler"]}
    for g in gunler:
        d = gun_degerle(v, g, seriler, guncel)
        if d["usdtry"] is None:
            d["usdtry"] = guncel_degerler.get("usdtry")
        gun_kaydi(v, d, g, kesin=True)
    if v["ayarlar"].get("baslangic_usdtry") is None:
        v["ayarlar"]["baslangic_usdtry"] = _kapanis(seriler.get("TRY=X", {}), date.fromisoformat(v["ayarlar"]["baslangic_tarihi"]))
    return len(gunler)


# ---------------------------------------------------------------- performance

def kz_degeri(v, toplam, net_yat):
    return toplam - float(v["ayarlar"]["baslangic_bakiye"] or 0) - net_yat


def seri(v: dict) -> list:
    """[{tarih, toplam, kz, net_yatirim, usdtry}] from daily snapshots (sorted)."""
    s = []
    for g in sorted(v["gunluk"]):
        k = v["gunluk"][g]
        s.append({"tarih": g, "toplam": k["toplam"], "net_yatirim": k.get("net_yatirim", 0.0),
                  "kz": kz_degeri(v, k["toplam"], k.get("net_yatirim", 0.0)), "usdtry": k.get("usdtry"),
                  "sinif": k.get("sinif", {}), "varlik": k.get("varlik", {})})
    return s


def gunluk_takvim(s: list, baslangic: float) -> dict:
    """{tarih: {kz, yuzde}} — each day's change vs. the previous snapshot."""
    out, onceki_kz, onceki_toplam = {}, 0.0, baslangic
    for r in s:
        fark = r["kz"] - onceki_kz
        taban = onceki_toplam if onceki_toplam else None
        out[r["tarih"]] = {"kz": round(fark, 2), "yuzde": (fark / taban * 100) if taban else None,
                           "toplam": r["toplam"]}
        onceki_kz, onceki_toplam = r["kz"], r["toplam"]
    return out


def performans(v: dict, s: list) -> dict:
    if not s:
        return {}
    baslangic = float(v["ayarlar"]["baslangic_bakiye"] or 0)
    son = s[-1]
    sermaye = baslangic + son["net_yatirim"]

    def kz_gun_once(gun_sayisi):
        sinir = (date.fromisoformat(son["tarih"]) - timedelta(days=gun_sayisi)).isoformat()
        aday = [r for r in s if r["tarih"] <= sinir]
        return aday[-1]["kz"] if aday else 0.0

    def getiri(gun_sayisi):
        fark = son["kz"] - kz_gun_once(gun_sayisi)
        return {"kz": fark, "yuzde": fark / sermaye * 100 if sermaye else None}

    # equity curve adjusted for deposits/withdrawals
    ozs = [baslangic + r["kz"] for r in s]
    tepe, mdd = ozs[0], 0.0
    for x in ozs:
        tepe = max(tepe, x)
        if tepe > 0:
            mdd = max(mdd, (tepe - x) / tepe * 100)
    return {
        "toplam_kz": son["kz"], "toplam_yuzde": son["kz"] / sermaye * 100 if sermaye else None,
        "gunluk": getiri(1), "haftalik": getiri(7), "aylik": getiri(30),
        "en_yuksek_bakiye": max(r["toplam"] for r in s), "en_dusuk_kz": min(r["kz"] for r in s),
        "maks_dusus": mdd, "sermaye": sermaye,
    }


def katki(v: dict, s: list, kalemler: list, donem: str) -> list:
    """Each holding's P&L contribution in a period: value change − buys + sells."""
    if not s:
        return []
    son_tarih = date.fromisoformat(s[-1]["tarih"])
    if donem == "hafta":
        bas = son_tarih - timedelta(days=son_tarih.weekday())
    elif donem == "ay":
        bas = son_tarih.replace(day=1)
    elif donem == "bugun":
        bas = son_tarih
    else:
        bas = date.fromisoformat(v["ayarlar"]["baslangic_tarihi"])
    onceki = [r for r in s if r["tarih"] < bas.isoformat()]
    if onceki:  # baseline: last close before the period
        taban_deger, islem_sonrasi = onceki[-1]["varlik"], date.fromisoformat(onceki[-1]["tarih"])
        dahil = lambda t: t > islem_sonrasi
    else:       # baseline: values at the start
        taban_deger = v["ayarlar"].get("baslangic_varlik", {})
        bas0 = date.fromisoformat(v["ayarlar"]["baslangic_tarihi"])
        dahil = lambda t: t >= bas0
    sonuc = []
    for k in kalemler:
        al = sat = 0.0
        for i in v["islemler"]:
            if i["varlik_id"] != k["id"] or not i.get("nakit_etkisi", True):
                continue
            if not dahil(date.fromisoformat(i["tarih"])):
                continue
            tutar = float(i["miktar"]) * float(i["fiyat"]) * carpan(k)
            if i["tip"] == "al":
                al += tutar
            else:
                sat += tutar
        fark = (k["deger"] or 0.0) - float(taban_deger.get(k["id"], 0.0)) - al + sat
        if abs(fark) >= 0.005:
            sonuc.append({"id": k["id"], "ad": k["ad"] or k["sembol"], "sinif": k["sinif"], "kz": round(fark, 2)})
    # futures as one item: total futures P&L at period end − at period start
    if vadeli_hareketleri(v) or vadeli_islemleri(v):
        simdi = vadeli_kz(v, son_tarih, float(s[-1].get("sinif", {}).get("vadeli", 0.0)))
        taban = vadeli_kz(v, islem_sonrasi, float(onceki[-1].get("sinif", {}).get("vadeli", 0.0))) if onceki else 0.0
        fark = simdi - taban
        if abs(fark) >= 0.005:
            sonuc.append({"id": "vadeli", "ad": "Vadeli", "sinif": "vadeli", "kz": round(fark, 2)})
    return sorted(sonuc, key=lambda x: x["kz"])



# ---------------------------------------------------------------- event log (history)

def olay(v: dict, tip: str, mesaj: str, sinif: str | None = None, varlik_id: str | None = None,
         tutar: float | None = None) -> None:
    v.setdefault("olaylar", []).append({
        "id": yeni_id(), "zaman": datetime.now().isoformat(timespec="seconds"), "tip": tip,
        "mesaj": mesaj, "sinif": sinif, "varlik_id": varlik_id, "tutar": tutar})
    if len(v["olaylar"]) > 3000:
        v["olaylar"] = v["olaylar"][-3000:]


# ---------------------------------------------------------------- intraday points

def gun_ici_ekle(v: dict, toplam: float, kz: float | None) -> None:
    gi = v.setdefault("gun_ici", {})
    simdi = datetime.now()
    gun = simdi.date().isoformat()
    liste = gi.setdefault(gun, [])
    if liste and (simdi - datetime.fromisoformat(liste[-1]["zaman"])).total_seconds() < 60:
        liste[-1] = {"zaman": simdi.isoformat(timespec="seconds"), "toplam": round(toplam, 2),
                     "kz": None if kz is None else round(kz, 2)}
    else:
        liste.append({"zaman": simdi.isoformat(timespec="seconds"), "toplam": round(toplam, 2),
                      "kz": None if kz is None else round(kz, 2)})
    if len(liste) > 1500:
        del liste[:-1500]
    for g in list(gi):
        if g < (simdi.date() - timedelta(days=1)).isoformat():
            del gi[g]


# ---------------------------------------------------------------- holding and class P&L series

def varlik_serileri(v: dict, s: list, kalemler: list) -> tuple[dict, dict]:
    """Daily P&L since first buy for each holding and class: value + sells − buys."""
    bugun_iso = bugun().isoformat()
    canli = {k["id"]: (k["deger"] or 0.0) for k in kalemler}
    sonuc, sinif_ham = {}, {}
    for var in v["varliklar"]:
        isl = sorted((i for i in v["islemler"] if i["varlik_id"] == var["id"]), key=lambda x: x["tarih"])
        if not isl:
            continue
        ilk = isl[0]["tarih"]
        m = carpan(var)
        tarihler = sorted({r["tarih"] for r in s if r["tarih"] >= ilk} | {bugun_iso})
        nokta = []
        for t in tarihler:
            if t == bugun_iso:
                deger = canli.get(var["id"], 0.0)
            else:
                kayit = next((r for r in s if r["tarih"] == t), None)
                deger = kayit["varlik"].get(var["id"], 0.0) if kayit else 0.0
            akis = 0.0
            for i in isl:
                if i["tarih"] > t:
                    break
                tutar = float(i["miktar"]) * float(i["fiyat"]) * m
                akis += tutar if i["tip"] == "sat" else -tutar
            nokta.append([t, round(deger + akis, 2)])
        if nokta and nokta[0][0] > ilk:
            nokta.insert(0, [ilk, 0.0])
        sonuc[var["id"]] = nokta
        for t, kz in nokta:
            sinif_ham.setdefault(var["sinif"], {}).setdefault(t, {})[var["id"]] = kz
    sinif = {}
    for sn, gunler in sinif_ham.items():
        son_bilinen, out = {}, []
        for t in sorted(gunler):
            son_bilinen.update(gunler[t])
            out.append([t, round(sum(son_bilinen.values()), 2)])
        sinif[sn] = out
    # futures: daily total P&L (realized + open)
    tarihler = [h["tarih"] for h in vadeli_hareketleri(v)] + \
               [i.get("acilis_tarih") or i.get("kapanis_tarih") for i in vadeli_islemleri(v)]
    if tarihler:
        ilk = min(tarihler)
        nokta = [[r["tarih"], round(vadeli_kz(v, date.fromisoformat(r["tarih"]), float(r.get("sinif", {}).get("vadeli", 0.0))), 2)]
                 for r in s if r["tarih"] >= ilk]
        if not nokta or nokta[0][0] > ilk:
            nokta.insert(0, [ilk, 0.0])
        sinif["vadeli"] = nokta
    return sonuc, sinif
