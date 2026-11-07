"""End-of-day snapshot. A Windows scheduled task runs it every night at 00:30 (even if the panel is closed).

After midnight it records the previous day's close. It only marks the day as final once the
US market close (16:00 New York) has passed. Run manually: .venv\\Scripts\\python.exe end_of_day.py
"""
import sys
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import data as vr  # noqa: E402

LOG = Path(__file__).parent / "data" / "end_of_day.log"


def main():
    simdi = datetime.now()
    gun = (simdi - timedelta(days=1)).date() if simdi.hour < 6 else simdi.date()
    with vr._KILIT:
        v = vr.oku()
        vr.vadesi_gecenleri_kapat(v)
        vr.baslangic_belirle(v)
        d = vr.degerle(v)
        vr.gun_kaydi(v, d, gun, kesin=gun < date.today() and vr.kapanis_gecti_mi(gun))  # never finalize before the close
        vr.eksikleri_tamamla(v, d)
        vr.yaz(v)
    eksik = f" · valued at cost: {', '.join(d['eksik_fiyat'])}" if d["eksik_fiyat"] else ""
    return f"{gun} saved: total {d['toplam']:.2f} USD{eksik}"


if __name__ == "__main__":
    try:
        mesaj = main()
    except Exception:
        mesaj = "ERROR\n" + traceback.format_exc()
    LOG.parent.mkdir(exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M}] {mesaj}\n")
    print(mesaj)
