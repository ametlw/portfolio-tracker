"""Portfolio tracker — app window.

The desktop shortcut runs this with .venv\\Scripts\\pythonw.exe (no console window):
  1) Starts the panel server in the background if it is not running.
  2) Opens the panel in an Edge (or Chrome) "app" window: no address bar or tabs.
  3) When the window closes, stops the server if this script started it.
Errors are written to data\\app.log.
"""
import os
import socket
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from datetime import datetime
from pathlib import Path

KLASOR = Path(__file__).resolve().parent
sys.path.insert(0, str(KLASOR))
os.chdir(KLASOR)

PORT = 8765
ADRES = f"http://127.0.0.1:{PORT}"
LOG = KLASOR / "data" / "app.log"
PROFIL = KLASOR / "data" / ".window"   # separate browser profile for the window (remembers size/position)


def log(mesaj):
    LOG.parent.mkdir(exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {mesaj}\n")


def calisiyor_mu():
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.5):
            return True
    except OSError:
        return False


def sunucuyu_baslat():
    import server  # noqa: E402  (same folder)

    def calis():
        try:
            server.app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True, use_reloader=False)
        except Exception:
            log("Server error:\n" + traceback.format_exc())

    threading.Thread(target=calis, daemon=True).start()
    for _ in range(150):          # wait up to 30 s
        if calisiyor_mu():
            return True
        time.sleep(0.2)
    return False


def tarayici_bul():
    adaylar = []
    for kok in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if kok:
            adaylar += [Path(kok) / "Microsoft/Edge/Application/msedge.exe",
                        Path(kok) / "Google/Chrome/Application/chrome.exe"]
    for a in adaylar:
        if a.exists():
            return str(a)
    return None


def main():
    biz_baslattik = False
    if not calisiyor_mu():
        if not sunucuyu_baslat():
            log("Server did not start within 30 s.")
            return
        biz_baslattik = True

    exe = tarayici_bul()
    if not exe:
        # no Edge/Chrome: open the default browser; the server cannot stop with the window then.
        log("Edge/Chrome not found, opening the default browser.")
        webbrowser.open(ADRES)
        if biz_baslattik:
            while True:
                time.sleep(3600)
        return

    PROFIL.mkdir(parents=True, exist_ok=True)
    p = subprocess.Popen([exe, f"--app={ADRES}", f"--user-data-dir={PROFIL}", "--no-first-run",
                          "--no-default-browser-check", "--window-size=1500,950"])
    if not biz_baslattik:
        return
    # Stop the server when the window closes. Two signals: the browser process ended, or the panel
    # has sent no heartbeat for 3 min (if Edge keeps running in the background, the process may not end).
    import server
    baslangic = time.time()
    surec_hemen_bitti = False
    while True:
        time.sleep(5)
        son = server.SON_NABIZ["zaman"]
        if p.poll() is not None:
            # If the browser process ends within seconds it may have handed the window to another
            # process: rely on the heartbeat only.
            if time.time() - baslangic < 15:
                surec_hemen_bitti = True
            elif not surec_hemen_bitti:
                break
        if son and time.time() - son > 180:
            break
        if not son and surec_hemen_bitti and time.time() - baslangic > 120:
            break   # the window never opened
    log("Window closed, stopping the server.")
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("Hata:\n" + traceback.format_exc())
