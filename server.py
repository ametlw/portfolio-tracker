"""Portfolio tracker server. Run: python server.py  →  http://localhost:8765"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import sys
import threading
import webbrowser
from datetime import date, timedelta

from flask import Flask, Response, jsonify, request, send_from_directory

import prices as fy
import data as vr

KOK = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(KOK, "static"), static_url_path="/static")
PORT = int(os.environ.get("PANEL_PORT", "8765"))


# ---------------------------------------------------------------- security
# The server binds to 127.0.0.1 so it is only reachable from this computer. In addition:
#  - Host header check: blocks other websites from reaching the panel via DNS rebinding.
#  - Origin check + JSON requirement on write requests: blocks other open websites from
#    sending actions to the panel through your browser (CSRF).
#  - Security headers (CSP etc.): make injecting outside code into the page harder.
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024   # upload size limit for backups
IZINLI_HOST = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
IZINLI_KOKEN = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' https://s3.tradingview.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' wss://ws.okx.com:8443",
    "frame-src https://*.tradingview.com https://*.tradingview-widget.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


@app.before_request
def _guvenlik_kontrolu():
    if request.host not in IZINLI_HOST:
        return jsonify({"hata": "Invalid host"}), 403
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        koken = request.headers.get("Origin")
        if koken and koken not in IZINLI_KOKEN:
            return jsonify({"hata": "Cross-site request rejected"}), 403
        if not request.is_json:
            return jsonify({"hata": "Request must be JSON"}), 415
    return None


@app.after_request
def _guvenlik_basliklari(yanit):
    yanit.headers["Content-Security-Policy"] = CSP
    yanit.headers["X-Content-Type-Options"] = "nosniff"
    yanit.headers["X-Frame-Options"] = "DENY"
    yanit.headers["Referrer-Policy"] = "no-referrer"
    yanit.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    yanit.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.path.startswith("/api/"):
        yanit.headers["Cache-Control"] = "no-store"
    return yanit


def hata(mesaj, kod=400):
    return jsonify({"hata": mesaj}), kod


def sayi(x, ad, pozitif=True):
    try:
        f = float(x)
    except (TypeError, ValueError):
        raise ValueError(f"{ad} must be a number")
    if pozitif and f <= 0:
        raise ValueError(f"{ad} must be greater than zero")
    return f


def tarih(x):
    if not x:
        return date.today().isoformat()
    return date.fromisoformat(str(x)[:10]).isoformat()


# ---------------------------------------------------------------- main state

def durum_hesapla(kaydet=True):
    with vr._KILIT:
        v = vr.oku()
        degisti = vr.vadesi_gecenleri_kapat(v)
        degisti |= vr.baslangic_belirle(v)
        d = vr.degerle(v)
        if kaydet and (v["varliklar"] or v["ayarlar"].get("baslangic_nakit")):
            vr.eksikleri_tamamla(v, d)          # fill days missed while closed using closing prices
            if v["ayarlar"].get("baslangic_usdtry") is None:
                v["ayarlar"]["baslangic_usdtry"] = d["usdtry"]
            vr.gun_kaydi(v, d, date.today())   # today: live (finalized after the close)
            degisti = True
        canli_kz = vr.kz_degeri(v, d["toplam"], vr.net_yatirim(v)) if v["ayarlar"].get("baslangic_bakiye") is not None else None
        if kaydet and (v["varliklar"] or v["ayarlar"].get("baslangic_nakit")):
            vr.gun_ici_ekle(v, d["toplam"], canli_kz)
            degisti = True
        if degisti:
            vr.yaz(v)
        s = vr.seri(v)
        bas = float(v["ayarlar"].get("baslangic_bakiye") or 0)
        varlik_seri, sinif_seri = vr.varlik_serileri(v, s, d["kalemler"])
        hisse_sembolleri = [k["sembol"] for k in d["kalemler"] if k["sinif"] == "hisse" and k["acik"]] + \
                           [w["sembol"] for w in v["izleme"] if w["sinif"] == "hisse"]
        uzatilmis = {k: {"fiyat": f, "zaman": z} for k, (f, z) in fy.uzatilmis_toplu(hisse_sembolleri).items() if f}
        sonuc = {
            "bugun": date.today().isoformat(),
            "ayarlar": v["ayarlar"],
            "usdtry": d["usdtry"],
            "toplam": d["toplam"], "nakit": d["nakit"], "sinif": d["sinif"],
            "kz": canli_kz, "net_yatirim": vr.net_yatirim(v),
            "eksik_fiyat": d["eksik_fiyat"],
            "varliklar": d["kalemler"],
            "islemler": sorted(v["islemler"], key=lambda x: x["tarih"], reverse=True),
            "nakit_hareketleri": sorted(v["nakit_hareketleri"], key=lambda x: x["tarih"], reverse=True),
            "izleme": d["izleme"],
            "seri": [{k: r[k] for k in ("tarih", "toplam", "kz", "net_yatirim", "usdtry")} for r in s],
            "takvim": vr.gunluk_takvim(s, bas),
            "performans": vr.performans(v, s),
            "katki": {p: vr.katki(v, s, d["kalemler"], p) for p in ("bugun", "hafta", "ay", "baslangic")},
            "varlik_seri": varlik_seri, "sinif_seri": sinif_seri,
            "gun_ici": v.get("gun_ici", {}).get(date.today().isoformat(), []),
            "uzatilmis": uzatilmis,
            "olaylar": list(reversed(v.get("olaylar", [])))[:1000],
            "vadeli": {**d["vadeli"],
                       "islemler": sorted(vr.vadeli_islemleri(v), key=lambda i: i.get("kapanis_tarih") or i.get("acilis_tarih") or "", reverse=True),
                       "hareketler": sorted(vr.vadeli_hareketleri(v), key=lambda h: h["tarih"], reverse=True),
                       "ayar": (v.get("vadeli") or {}).get("ayar", {})},
        }
    # display currency rates (fetched outside the data lock: network only, nothing is written)
    sonuc.update(kur_bilgisi(sonuc["seri"], v["ayarlar"]["baslangic_tarihi"]))
    return sonuc


# Display currencies: Yahoo/Binance symbol whose price is USD per 1 unit.
KUR_SEMBOL = {"EUR": "EURUSD=X", "BTC": "BTC-USD", "ETH": "ETH-USD", "USDT": "USDT-USD"}


def kur_bilgisi(seri: list, baslangic_tarihi: str) -> dict:
    """{'kurlar': {EUR: usd per unit, ...}, 'baslangic_kurlar': {...}}, and each seri row gets its day's 'kurlar'.
    A currency whose rate can't be fetched is simply left out (the page then shows USD)."""
    fiyatlar = fy.toplu(list(KUR_SEMBOL.values()))
    simdi = {b: fiyatlar[s][0] for b, s in KUR_SEMBOL.items() if fiyatlar.get(s, (None,))[0]}
    bas = date.fromisoformat(baslangic_tarihi)
    ilk = min([bas] + [date.fromisoformat(r["tarih"]) for r in seri[:1]])
    with ThreadPoolExecutor(max_workers=4) as ex:
        seriler = dict(zip(KUR_SEMBOL, ex.map(lambda s: fy.kapanis_serisi(s, ilk, date.today()), KUR_SEMBOL.values())))

    def gun(tarih):
        out = {}
        for b in KUR_SEMBOL:
            k = vr._kapanis(seriler.get(b) or {}, tarih) if tarih < date.today() else None
            if k or simdi.get(b):
                out[b] = k or simdi[b]
        return out

    for r in seri:
        r["kurlar"] = gun(date.fromisoformat(r["tarih"]))
    return {"kurlar": simdi, "baslangic_kurlar": gun(bas)}


@app.get("/")
def anasayfa():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/durum")
def api_durum():
    if request.args.get("yenile"):
        fy.onbellegi_temizle()
    return jsonify(durum_hesapla())


# ---------------------------------------------------------------- market data

@app.get("/api/mum")
def api_mum():
    sembol = (request.args.get("sembol") or "").strip().upper()
    if not sembol:
        return hata("Symbol is required")
    aralik = "1w" if request.args.get("aralik") == "1w" else "1d"
    once = request.args.get("once") or None
    if once:
        try:
            once = date.fromisoformat(once).isoformat()
        except ValueError:
            return hata("Invalid date")
    return jsonify(fy.grafik_mumlari(sembol, aralik, once))


@app.get("/api/fiyat")
def api_fiyat():
    sembol = (request.args.get("sembol") or "").strip().upper()
    son, onceki = fy.son_ve_onceki(sembol)
    if son is None:
        return hata(f"No price found for {sembol}", 404)
    return jsonify({"sembol": sembol, "fiyat": son, "onceki": onceki})


@app.get("/api/opsiyon/vadeler")
def api_vadeler():
    sembol = (request.args.get("sembol") or "").strip().upper()
    return jsonify(fy.vadeler(sembol))


@app.get("/api/opsiyon/zincir")
def api_zincir():
    sembol = (request.args.get("sembol") or "").strip().upper()
    vade, tur = request.args.get("vade"), request.args.get("tur", "put")
    if not sembol or not vade:
        return hata("Symbol and expiration are required")
    return jsonify(fy.zincir_tablo(sembol, vade, "call" if tur == "call" else "put"))


@app.get("/api/serit")
def api_serit():
    sem = {"NQ1!": "NQ=F", "ES1!": "ES=F", "BTC": "BTC-USD", "ETH": "ETH-USD"}
    with ThreadPoolExecutor(max_workers=4) as ex:
        f = dict(zip(sem.values(), ex.map(lambda s: fy.anlik(s) if s.endswith("=F") else fy.son_ve_onceki(s), sem.values())))
    return jsonify([{"ad": ad, "sembol": s, "fiyat": f.get(s, (None, None))[0], "onceki": f.get(s, (None, None))[1]}
                    for ad, s in sem.items()])


# ---------------------------------------------------------------- holdings and trades

@app.post("/api/varlik")
def varlik_ekle():
    b = request.get_json(force=True)
    try:
        sinif = b.get("sinif")
        if sinif not in ("kripto", "hisse", "opsiyon"):
            raise ValueError("Class must be crypto, stock or option")
        miktar = sayi(b.get("miktar"), "Quantity")
        f = sayi(b.get("fiyat"), "Buy price")
        var = {"id": vr.yeni_id(), "sinif": sinif, "ad": (b.get("ad") or "").strip(),
               "sembol": (b.get("sembol") or "").strip().upper(), "opsiyon": None,
               "elle_fiyat": None, "kar_al": [], "kademeli": [], "not": b.get("not") or ""}
        if sinif == "opsiyon":
            o = b.get("opsiyon") or {}
            dayanak = (o.get("dayanak") or "").strip().upper()
            if not dayanak:
                raise ValueError("Underlying symbol is required")
            tur = o.get("tur", "put")
            strike = sayi(o.get("strike"), "Strike")
            vade = tarih(o.get("vade"))
            var["opsiyon"] = {"dayanak": dayanak, "tur": tur, "strike": strike, "vade": vade}
            var["sembol"] = f"{dayanak} {strike:g}{'P' if tur == 'put' else 'C'} {vade[5:]}"
        elif not var["sembol"]:
            raise ValueError("Symbol is required")
        if not var["ad"]:
            var["ad"] = var["sembol"][:-4] if (sinif == "kripto" and var["sembol"].endswith("-USD")) else var["sembol"]
        if b.get("elle_fiyat") not in (None, ""):
            var["elle_fiyat"] = sayi(b["elle_fiyat"], "Current price")
    except ValueError as e:
        return hata(str(e))
    with vr._KILIT:
        v = vr.oku()
        v["varliklar"].append(var)
        v["islemler"].append({"id": vr.yeni_id(), "varlik_id": var["id"], "tarih": tarih(b.get("tarih")),
                              "tip": "al", "miktar": miktar, "fiyat": f,
                              "nakit_etkisi": bool(b.get("nakit_etkisi", True))})
        if b.get("izleme_id"):
            v["izleme"] = [w for w in v["izleme"] if w["id"] != b["izleme_id"]]
        c = 100 if sinif == "opsiyon" else 1
        vr.olay(v, "alim", f"{var['ad']} added: {miktar:g} × ${f:g}", sinif, var["id"], miktar * f * c)
        vr.gecmisi_yenile(v, v["islemler"][-1]["tarih"])
        vr.yaz(v)
    return jsonify({"ok": True, "id": var["id"]})


@app.put("/api/varlik/<vid>")
def varlik_duzenle(vid):
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        var = next((x for x in v["varliklar"] if x["id"] == vid), None)
        if not var:
            return hata("Holding not found", 404)
        try:
            if "ad" in b:
                var["ad"] = (b["ad"] or "").strip() or var["sembol"]
            if "sembol" in b and var["sinif"] != "opsiyon" and b["sembol"]:
                var["sembol"] = b["sembol"].strip().upper()
            if "elle_fiyat" in b:
                var["elle_fiyat"] = None if b["elle_fiyat"] in (None, "") else sayi(b["elle_fiyat"], "Current price")
            if "not" in b:
                var["not"] = b["not"] or ""
            if "elle_fiyat" in b:
                vr.olay(v, "duzenleme", f"{var['ad']} manual price: " + (f"${var['elle_fiyat']:g}" if var["elle_fiyat"] is not None else "cleared"), var["sinif"], vid)
            if "kar_al" in b:
                liste = []
                for h in b["kar_al"]:
                    tip = h.get("tip", "kat")
                    liste.append({"id": h.get("id") or vr.yeni_id(), "tip": tip,
                                  "deger": sayi(h.get("deger"), "Target"),
                                  "yuzde": max(1.0, min(100.0, sayi(h.get("yuzde"), "Sell %"))),
                                  "tamam": bool(h.get("tamam"))})
                var["kar_al"] = liste
                vr.olay(v, "plan", f"{var['ad']} take-profit targets updated: " +
                        (", ".join(f"{h['deger']:g}{'x' if h['tip'] == 'kat' else '$'} → {h['yuzde']:g}%" for h in liste) or "none"),
                        var["sinif"], vid)
            if "kademeli" in b:
                var["kademeli"] = [{"id": k.get("id") or vr.yeni_id(), "fiyat": sayi(k.get("fiyat"), "Price"),
                                    "tutar": sayi(k.get("tutar"), "Amount"), "tamam": bool(k.get("tamam"))}
                                   for k in b["kademeli"]]
                vr.olay(v, "plan", f"{var['ad']} scaled buy plan: " +
                        (", ".join(f"${k['fiyat']:g} × ${k['tutar']:g}" for k in var["kademeli"]) or "none"), var["sinif"], vid)
        except ValueError as e:
            return hata(str(e))
        vr.yaz(v)
    return jsonify({"ok": True})


@app.delete("/api/varlik/<vid>")
def varlik_sil(vid):
    with vr._KILIT:
        v = vr.oku()
        silinen = next((x for x in v["varliklar"] if x["id"] == vid), None)
        vr.gecmisi_yenile(v, min((x["tarih"] for x in v["islemler"] if x["varlik_id"] == vid), default=None))
        v["varliklar"] = [x for x in v["varliklar"] if x["id"] != vid]
        v["islemler"] = [x for x in v["islemler"] if x["varlik_id"] != vid]
        if silinen:
            vr.olay(v, "silme", f"{silinen['ad']} and its trades deleted", silinen["sinif"], vid)
        vr.yaz(v)
    return jsonify({"ok": True})


@app.post("/api/islem")
def islem_ekle():
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        var = next((x for x in v["varliklar"] if x["id"] == b.get("varlik_id")), None)
        if not var:
            return hata("Holding not found", 404)
        try:
            tip = b.get("tip")
            if tip not in ("al", "sat"):
                raise ValueError("Trade type must be buy or sell")
            miktar = sayi(b.get("miktar"), "Quantity")
            f = sayi(b.get("fiyat"), "Price", pozitif=False)
            if f < 0:
                raise ValueError("Price cannot be negative")
            if tip == "al" and f == 0:
                raise ValueError("Buy price cannot be zero")
            yeni = {"id": vr.yeni_id(), "varlik_id": var["id"], "tarih": tarih(b.get("tarih")),
                    "tip": tip, "miktar": miktar, "fiyat": f, "nakit_etkisi": True, "not": b.get("not") or ""}
            if tip == "sat":
                sorun = vr.satis_hatasi(var, v["islemler"] + [yeni])
                if sorun:
                    raise ValueError(sorun)
        except ValueError as e:
            return hata(str(e))
        v["islemler"].append(yeni)
        c = 100 if var["sinif"] == "opsiyon" else 1
        neden = " (take-profit target)" if b.get("kar_al_id") else " (scaled buy plan)" if b.get("kademeli_id") else ""
        vr.olay(v, "alim" if tip == "al" else "satis",
                f"{var['ad']} {'bought' if tip == 'al' else 'sold'}: {miktar:g} × ${f:g}{neden}",
                var["sinif"], var["id"], miktar * f * c)
        # mark the take-profit / scaled-buy level as done
        for anahtar in ("kar_al", "kademeli"):
            hid = b.get(f"{anahtar}_id")
            for h in var.get(anahtar, []):
                if hid and h["id"] == hid:
                    h["tamam"] = True
        vr.gecmisi_yenile(v, yeni["tarih"])
        vr.yaz(v)
    return jsonify({"ok": True})


@app.delete("/api/islem/<iid>")
def islem_sil(iid):
    with vr._KILIT:
        v = vr.oku()
        i = next((x for x in v["islemler"] if x["id"] == iid), None)
        kalan = [x for x in v["islemler"] if x["id"] != iid]
        if i and i["tip"] == "al":
            var = next((x for x in v["varliklar"] if x["id"] == i["varlik_id"]), None)
            sorun = vr.satis_hatasi(var, kalan) if var else None
            if sorun:
                return hata("This buy can't be deleted because a later sale depends on it. Delete that sale first. (" + sorun + ")")
        v["islemler"] = kalan
        if i:
            vr.gecmisi_yenile(v, i["tarih"])
            var = next((x for x in v["varliklar"] if x["id"] == i["varlik_id"]), {})
            vr.olay(v, "silme", f"{var.get('ad', '?')} trade deleted ({'buy' if i['tip'] == 'al' else 'sell'} {i['tarih']})",
                    var.get("sinif"), i["varlik_id"])
        vr.yaz(v)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- cash

@app.post("/api/nakit")
def nakit_hareketi():
    b = request.get_json(force=True)
    try:
        tip = b.get("tip")
        if tip not in ("yatir", "cek"):
            raise ValueError("Type must be deposit or withdraw")
        tutar = sayi(b.get("tutar"), "Amount")
    except ValueError as e:
        return hata(str(e))
    with vr._KILIT:
        v = vr.oku()
        v["nakit_hareketleri"].append({"id": vr.yeni_id(), "tarih": tarih(b.get("tarih")), "tip": tip,
                                       "tutar": tutar, "not": b.get("not") or ""})
        vr.olay(v, "nakit", f"{'Deposit' if tip == 'yatir' else 'Withdrawal'}: ${tutar:,.2f}", "nakit", None,
                tutar if tip == "yatir" else -tutar)
        vr.gecmisi_yenile(v, v["nakit_hareketleri"][-1]["tarih"])
        vr.yaz(v)
    return jsonify({"ok": True})


@app.delete("/api/nakit/<nid>")
def nakit_sil(nid):
    with vr._KILIT:
        v = vr.oku()
        h = next((x for x in v["nakit_hareketleri"] if x["id"] == nid), None)
        vr.gecmisi_yenile(v, h and h["tarih"])
        v["nakit_hareketleri"] = [x for x in v["nakit_hareketleri"] if x["id"] != nid]
        vr.olay(v, "silme", "Deposit/withdrawal entry deleted", "nakit")
        vr.yaz(v)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- watchlist

@app.post("/api/izleme")
def izleme_ekle():
    b = request.get_json(force=True)
    sembol = (b.get("sembol") or "").strip().upper()
    if not sembol:
        return hata("Symbol is required")
    try:
        hedef = None if b.get("hedef_fiyat") in (None, "") else sayi(b["hedef_fiyat"], "Target price")
    except ValueError as e:
        return hata(str(e))
    with vr._KILIT:
        v = vr.oku()
        v["izleme"].append({"id": vr.yeni_id(), "sembol": sembol, "ad": (b.get("ad") or sembol).strip(),
                            "sinif": b.get("sinif") if b.get("sinif") in ("kripto", "hisse") else "hisse",
                            "aciklama": b.get("aciklama") or "", "hedef_fiyat": hedef, "kademeli": [],
                            "eklenme": date.today().isoformat()})
        vr.olay(v, "izleme", f"Added to watchlist: {sembol}" + (f" (target ${hedef:g})" if hedef else ""))
        vr.yaz(v)
    return jsonify({"ok": True})


@app.put("/api/izleme/<wid>")
def izleme_duzenle(wid):
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        w = next((x for x in v["izleme"] if x["id"] == wid), None)
        if not w:
            return hata("Not found", 404)
        try:
            for k in ("ad", "aciklama"):
                if k in b:
                    w[k] = b[k] or ""
            if "sembol" in b and b["sembol"]:
                w["sembol"] = b["sembol"].strip().upper()
            if "sinif" in b and b["sinif"] in ("kripto", "hisse"):
                w["sinif"] = b["sinif"]
            if "hedef_fiyat" in b:
                w["hedef_fiyat"] = None if b["hedef_fiyat"] in (None, "") else sayi(b["hedef_fiyat"], "Target price")
            if "kademeli" in b:
                w["kademeli"] = [{"id": k.get("id") or vr.yeni_id(), "fiyat": sayi(k.get("fiyat"), "Price"),
                                  "tutar": sayi(k.get("tutar"), "Amount"), "tamam": bool(k.get("tamam"))}
                                 for k in b["kademeli"]]
                vr.olay(v, "plan", f"{w['sembol']} (watchlist) scaled buy plan updated")
        except ValueError as e:
            return hata(str(e))
        vr.yaz(v)
    return jsonify({"ok": True})


@app.delete("/api/izleme/<wid>")
def izleme_sil(wid):
    with vr._KILIT:
        v = vr.oku()
        w = next((x for x in v["izleme"] if x["id"] == wid), None)
        v["izleme"] = [x for x in v["izleme"] if x["id"] != wid]
        if w:
            vr.olay(v, "izleme", f"Removed from watchlist: {w['sembol']}")
        vr.yaz(v)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- futures

def _vadeli_sembol(x, piyasa="kripto"):
    """Crypto: 'btc', 'BTCUSDT', 'BTC-USDT-SWAP', 'BTC-USD' → 'BTC-USD'. Stock: 'nvda', 'xyz:NVDA' → 'NVDA'."""
    x = (x or "").strip().upper().replace("/", "-")
    if piyasa == "hisse":
        x = x.split(":")[-1].replace("-PERP", "").strip()
        if not x or len(x) > 12 or not all(c.isalnum() or c in ".-" for c in x):
            raise ValueError("Enter a valid stock symbol (e.g. NVDA)")
        return x
    for son in ("-USDT-SWAP", "-SWAP", "-USDT", "USDT", "-USD"):
        if x.endswith(son):
            x = x[: -len(son)]
            break
    x = x.strip("-")
    if not x or not x.replace("-", "").isalnum() or len(x) > 20:
        raise ValueError("Enter a valid symbol (e.g. BTC)")
    return x + "-USD"


def _vadeli(v):
    return v.setdefault("vadeli", {"hareketler": [], "islemler": [], "ayar": {}})


def _islem_dogrula(b, eski=None):
    """Validates the trade form and returns the dict to store."""
    yon = b.get("yon")
    if yon not in ("long", "short"):
        raise ValueError("Side must be long or short")
    piyasa = "hisse" if b.get("piyasa") == "hisse" else "kripto"
    i = {"id": (eski or {}).get("id") or vr.yeni_id(), "piyasa": piyasa, "sembol": _vadeli_sembol(b.get("sembol"), piyasa), "yon": yon,
         "etiket": (b.get("etiket") or "").strip()[:40], "not": (b.get("not") or "")[:2000]}
    if b.get("hizli"):
        i.update({"hizli": True, "durum": "kapali", "sonuc": sayi(b.get("sonuc"), "Result", pozitif=False),
                  "kapanis_tarih": tarih(b.get("kapanis_tarih"))})
        return i
    giris = sayi(b.get("giris"), "Entry price")
    kaldirac = None if b.get("kaldirac") in (None, "") else sayi(b.get("kaldirac"), "Leverage")
    if kaldirac is not None and kaldirac > 200:
        raise ValueError("Leverage can be at most 200x")
    if b.get("buyukluk") not in (None, ""):
        buyukluk = sayi(b.get("buyukluk"), "Size")
    else:   # margin × leverage / entry
        if not kaldirac:
            raise ValueError("Enter a size, or margin + leverage")
        buyukluk = sayi(b.get("marj"), "Margin") * kaldirac / giris
    i.update({"hizli": False, "giris": giris, "buyukluk": buyukluk, "kaldirac": kaldirac,
              "stop": None if b.get("stop") in (None, "") else sayi(b.get("stop"), "Stop"),
              "hedef": None if b.get("hedef") in (None, "") else sayi(b.get("hedef"), "Target"),
              "acilis_tarih": tarih(b.get("acilis_tarih")), "durum": "acik", "cikis": None,
              "kapanis_tarih": None, "komisyon": 0.0})
    if i["stop"] is not None and (i["stop"] - giris) * (1 if yon == "long" else -1) >= 0:
        raise ValueError("The stop must be " + ("below the entry on a long" if yon == "long" else "above the entry on a short"))
    if b.get("durum") == "kapali":
        _kapat(i, b)
    return i


def _kapat(i, b):
    i["cikis"] = sayi(b.get("cikis"), "Exit price")
    i["kapanis_tarih"] = tarih(b.get("kapanis_tarih"))
    i["komisyon"] = 0.0 if b.get("komisyon") in (None, "") else sayi(b.get("komisyon"), "Fees", pozitif=False)
    if i["komisyon"] < 0:
        raise ValueError("Fees cannot be negative")
    if i["kapanis_tarih"] < i["acilis_tarih"]:
        raise ValueError("The close date cannot be before the open date")
    i["durum"] = "kapali"


def _ilk_tarih(i):
    return min(t for t in (i.get("acilis_tarih"), i.get("kapanis_tarih")) if t)


def _islem_ozet(i):
    ad = i["sembol"].replace("-USD", "") + (" (stock)" if i.get("piyasa") == "hisse" else "")
    return f"{ad} {'long' if i['yon'] == 'long' else 'short'}"


@app.get("/api/vadeli/fiyatlar")
def vadeli_fiyatlar():
    """Current prices of open futures positions (polled while the Futures tab is open)."""
    v = vr.oku()
    acik = [i for i in vr.vadeli_islemleri(v) if i["durum"] == "acik"]
    hl = fy.hl_fiyatlar() if any(i.get("piyasa") == "hisse" for i in acik) else {}
    fiyatlar = fy.toplu([i["sembol"] for i in acik if not (i.get("piyasa") == "hisse" and hl.get(i["sembol"]))])
    return jsonify({i["sembol"]: vr.vadeli_fiyat(i, fiyatlar, hl) for i in acik})


@app.post("/api/vadeli/islem")
def vadeli_islem_ekle():
    b = request.get_json(force=True)
    try:
        i = _islem_dogrula(b)
    except ValueError as e:
        return hata(str(e))
    with vr._KILIT:
        v = vr.oku()
        _vadeli(v)["islemler"].append(i)
        vr.gecmisi_yenile(v, _ilk_tarih(i))
        if i["durum"] == "kapali":
            kz = vr.vadeli_gerceklesen(i)
            vr.olay(v, "vadeli", f"Futures {_islem_ozet(i)} closed" + (" (quick entry)" if i.get("hizli") else ""), "vadeli", i["id"], kz)
        else:
            vr.olay(v, "vadeli", f"Futures {_islem_ozet(i)} opened: {i['buyukluk']:g} @ ${i['giris']:g}"
                    + (f" · {i['kaldirac']:g}x" if i.get("kaldirac") else ""), "vadeli", i["id"])
        vr.yaz(v)
    return jsonify({"ok": True, "id": i["id"]})


@app.put("/api/vadeli/islem/<iid>")
def vadeli_islem_duzenle(iid):
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        l = _vadeli(v)["islemler"]
        eski = next((x for x in l if x["id"] == iid), None)
        if not eski:
            return hata("Trade not found", 404)
        try:
            yeni = _islem_dogrula({**eski, "hizli": eski.get("hizli"),
                                   "durum": eski["durum"], **b}, eski)
        except ValueError as e:
            return hata(str(e))
        l[l.index(eski)] = yeni
        vr.gecmisi_yenile(v, min(_ilk_tarih(eski), _ilk_tarih(yeni)))
        vr.olay(v, "duzenleme", f"Futures {_islem_ozet(yeni)} edited", "vadeli", iid)
        vr.yaz(v)
    return jsonify({"ok": True})


@app.post("/api/vadeli/islem/<iid>/kapat")
def vadeli_islem_kapat(iid):
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        i = next((x for x in _vadeli(v)["islemler"] if x["id"] == iid), None)
        if not i or i["durum"] != "acik":
            return hata("Open trade not found", 404)
        try:
            _kapat(i, b)
        except ValueError as e:
            i.update({"durum": "acik", "cikis": None, "kapanis_tarih": None, "komisyon": 0.0})
            return hata(str(e))
        kz = vr.vadeli_gerceklesen(i)
        vr.gecmisi_yenile(v, i["kapanis_tarih"])
        vr.olay(v, "vadeli", f"Futures {_islem_ozet(i)} closed @ ${i['cikis']:g}", "vadeli", iid, kz)
        vr.yaz(v)
    return jsonify({"ok": True, "kz": kz})


@app.delete("/api/vadeli/islem/<iid>")
def vadeli_islem_sil(iid):
    with vr._KILIT:
        v = vr.oku()
        vd = _vadeli(v)
        i = next((x for x in vd["islemler"] if x["id"] == iid), None)
        vd["islemler"] = [x for x in vd["islemler"] if x["id"] != iid]
        if i:
            vr.gecmisi_yenile(v, _ilk_tarih(i))
            vr.olay(v, "silme", f"Futures {_islem_ozet(i)} entry deleted", "vadeli", iid)
        vr.yaz(v)
    return jsonify({"ok": True})


@app.post("/api/vadeli/hareket")
def vadeli_hareket():
    """Transfer (deposit/withdraw) or balance adjustment. For an adjustment 'bakiye' = total balance on the exchange (incl. open P&L)."""
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        try:
            tip = b.get("tip")
            if tip not in ("yatir", "cek", "duzelt"):
                raise ValueError("Type must be yatir, cek or duzelt")
            h = {"id": vr.yeni_id(), "tarih": tarih(b.get("tarih")), "tip": tip,
                 "kaynak": "dis" if b.get("kaynak") == "dis" else "nakit", "not": (b.get("not") or "")[:500]}
            if tip == "duzelt":
                hedef = sayi(b.get("bakiye"), "Exchange balance", pozitif=False)
                if hedef < 0:
                    raise ValueError("Balance cannot be negative")
                simdi = vr.vadeli_degerle(v, fy.toplu(vr.sembol_listesi(v)))["ozsermaye"]
                h["tutar"] = round(hedef - simdi, 2)
                if abs(h["tutar"]) < 0.005:
                    return jsonify({"ok": True, "fark": 0})
            else:
                h["tutar"] = sayi(b.get("tutar"), "Amount")
                if tip == "cek":
                    serbest = vr.vadeli_degerle(v, fy.toplu(vr.sembol_listesi(v)))["kullanilabilir"]
                    if h["tutar"] > serbest + 1e-9:
                        raise ValueError(f"The futures wallet has ${max(serbest, 0):,.2f} available (excluding open positions' margin); you can't withdraw more")
        except ValueError as e:
            return hata(str(e))
        _vadeli(v)["hareketler"].append(h)
        vr.gecmisi_yenile(v, h["tarih"])
        mesaj = {"yatir": "Moved to futures wallet", "cek": "Withdrawn from futures wallet", "duzelt": "Futures wallet adjusted"}[tip]
        if tip != "duzelt" and h["kaynak"] == "dis":
            mesaj += " (from outside)" if tip == "yatir" else " (to outside)"
        vr.olay(v, "nakit" if tip != "duzelt" else "vadeli", f"{mesaj}: ${abs(h['tutar']):,.2f}", "vadeli", None,
                h["tutar"] if tip != "cek" else -h["tutar"])
        vr.yaz(v)
    return jsonify({"ok": True, "fark": h["tutar"]})


@app.delete("/api/vadeli/hareket/<hid>")
def vadeli_hareket_sil(hid):
    with vr._KILIT:
        v = vr.oku()
        vd = _vadeli(v)
        h = next((x for x in vd["hareketler"] if x["id"] == hid), None)
        if h and h["tip"] == "yatir":
            kalan = [x for x in vd["hareketler"] if x["id"] != hid]
            if vr.vadeli_cuzdan({**v, "vadeli": {**vd, "hareketler": kalan}}) < -0.005:
                return hata("Deleting this transfer would make the futures wallet negative. Delete the later withdrawals first.")
        vd["hareketler"] = [x for x in vd["hareketler"] if x["id"] != hid]
        if h:
            vr.gecmisi_yenile(v, h["tarih"])
            vr.olay(v, "silme", "Futures transfer/adjustment deleted", "vadeli")
        vr.yaz(v)
    return jsonify({"ok": True})


@app.post("/api/vadeli/ayar")
def vadeli_ayar():
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        ay = _vadeli(v)["ayar"]
        try:
            if "gunluk_limit" in b:
                ay["gunluk_limit"] = None if b["gunluk_limit"] in (None, "") else sayi(b["gunluk_limit"], "Daily limit")
                if ay["gunluk_limit"] is not None and ay["gunluk_limit"] > 100:
                    raise ValueError("The daily limit cannot exceed 100%")
            if "risk_yuzde" in b:
                ay["risk_yuzde"] = None if b["risk_yuzde"] in (None, "") else sayi(b["risk_yuzde"], "Risk %")
        except ValueError as e:
            return hata(str(e))
        vr.yaz(v)
    return jsonify({"ok": True, "ayar": ay})


# ---------------------------------------------------------------- settings, end of day, backup

@app.post("/api/ayarlar")
def ayarlar():
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        ay = v["ayarlar"]
        try:
            if "baslangic_nakit" in b:
                ay["baslangic_nakit"] = sayi(b["baslangic_nakit"], "Starting cash", pozitif=False)
            if b.get("baslangic_bakiye") in (None, ""):
                ay["baslangic_bakiye_elle"] = False          # left empty: compute automatically
            else:
                bk = sayi(b["baslangic_bakiye"], "Starting balance", pozitif=False)
                if bk < 0:
                    raise ValueError("Starting balance cannot be negative")
                otomatik = ay.get("baslangic_otomatik")
                elle = otomatik is None or abs(bk - otomatik) > 0.005
                ay["baslangic_bakiye_elle"] = elle
                if elle:
                    ay["baslangic_bakiye"] = bk
            if b.get("baslangic_tarihi") and tarih(b["baslangic_tarihi"]) != ay.get("baslangic_tarihi"):
                ay["baslangic_tarihi"] = tarih(b["baslangic_tarihi"])
                # when the start date changes, rebuild past days
                v["gunluk"] = {g: k for g, k in v["gunluk"].items() if g >= ay["baslangic_tarihi"]}
                for k in v["gunluk"].values():
                    k["kesin"] = False
                ay["baslangic_usdtry"] = None
        except ValueError as e:
            return hata(str(e))
        vr.baslangic_belirle(v)
        vr.olay(v, "ayar", "Start settings changed")
        vr.yaz(v)
    return jsonify({"ok": True})


@app.post("/api/grafik-ayar")
def grafik_ayar():
    """Charts tab: custom quick buttons and default indicators."""
    b = request.get_json(force=True)
    with vr._KILIT:
        v = vr.oku()
        g = v["ayarlar"].setdefault("grafik", {})
        if "semboller" in b:
            g["semboller"] = [str(x).strip()[:60] for x in b["semboller"] if str(x).strip()][:40]
        if "gostergeler" in b:
            g["gostergeler"] = [str(x)[:40] for x in b["gostergeler"]][:10]
        vr.yaz(v)
    return jsonify({"ok": True, "grafik": g})


@app.post("/api/gunsonu")
def gun_sonu():
    """End-of-day snapshot. After midnight it records the previous day."""
    from datetime import datetime
    simdi = datetime.now()
    gun = (simdi - timedelta(days=1)).date() if simdi.hour < 6 else simdi.date()
    with vr._KILIT:
        fy.onbellegi_temizle()
        v = vr.oku()
        vr.vadesi_gecenleri_kapat(v)
        vr.baslangic_belirle(v)
        d = vr.degerle(v)
        vr.gun_kaydi(v, d, gun, kesin=gun < date.today() and vr.kapanis_gecti_mi(gun))
        vr.eksikleri_tamamla(v, d)
        vr.yaz(v)
    return jsonify({"ok": True, "gun": gun.isoformat(), "toplam": d["toplam"], "eksik": d["eksik_fiyat"]})


@app.get("/api/yedek")
def yedek_indir():
    v = vr.oku()
    return Response(json.dumps(v, ensure_ascii=False, indent=2), mimetype="application/json",
                    headers={"Content-Disposition": f"attachment; filename=portfolio-backup-{date.today()}.json"})


@app.post("/api/yedek")
def yedek_yukle():
    try:
        v = json.loads(request.get_data(as_text=True))
        for k in ("ayarlar", "varliklar", "islemler", "nakit_hareketleri", "izleme", "gunluk"):
            if k not in v:
                raise ValueError(f"Backup file has no '{k}'")
    except Exception as e:
        return hata(f"Could not read backup: {e}")
    with vr._KILIT:
        _geri_yukleme_oncesi()
        vr.olay(v, "ayar", "Restored from backup file")
        vr.yaz(v)
    return jsonify({"ok": True})


def _geri_yukleme_oncesi():
    """Keep a copy of the current data before restoring (so a wrong restore can be undone)."""
    if vr.DOSYA.exists():
        vr.YEDEKLER.mkdir(parents=True, exist_ok=True)
        import shutil
        from datetime import datetime
        shutil.copyfile(vr.DOSYA, vr.YEDEKLER / f"before-restore-{datetime.now():%Y-%m-%d-%H%M%S}.json")


SON_NABIZ = {"zaman": None}


@app.post("/api/nabiz")
def nabiz():
    """Called periodically while the panel is open (lets the app window shut the server down when closed)."""
    import time as _t
    SON_NABIZ["zaman"] = _t.time()
    return jsonify({"ok": True})


@app.get("/api/yedekler")
def yedekler():
    return jsonify(vr.yedek_listesi())


@app.post("/api/yedekler/geri")
def yedekten_don():
    ad = (request.get_json(force=True) or {}).get("dosya", "")
    if "/" in ad or "\\" in ad or not ad.endswith(".json"):
        return hata("Invalid file")
    f = (vr.YEDEKLER / ad).resolve()
    if f.parent != vr.YEDEKLER.resolve() or not f.exists():
        return hata("Backup not found")
    try:
        v = json.loads(f.read_text(encoding="utf-8"))
        for k in ("ayarlar", "varliklar", "islemler", "nakit_hareketleri", "izleme", "gunluk"):
            if k not in v:
                raise ValueError(f"missing '{k}'")
    except Exception as e:
        return hata(f"Could not read backup: {e}")
    with vr._KILIT:
        _geri_yukleme_oncesi()
        vr.olay(v, "ayar", f"Restored backup {ad}")
        vr.yaz(v)
    return jsonify({"ok": True})


if __name__ == "__main__":
    if "--tarayici-acma" not in sys.argv:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    print(f"Panel running: http://localhost:{PORT}  (close this window to stop it)")
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
