/* Futures (perps; crypto or Hyperliquid stocks): open positions, trade form (built-in calculator), journal, stats, mini calendar.
   Separate wallet (like on an exchange): money is moved in from cash or from outside; trades run inside the wallet.
   Loaded after app.js; uses its helpers (D, para, modalAc, api…). */
"use strict";

const CANLI_V = {};          // live OKX perp prices: {"BTC-USD": 77000}
let VD_AY = null;            // month shown in the mini calendar {y, m}
const VD_FILTRE = { sembol: "", yon: "", etiket: "" };
let VD_SONRA = null;         // dialog to open after the wallet is set up
const vdAd = (s) => String(s || "").replace(/-USD$/, "");
const vdHisse = (i) => i.piyasa === "hisse";
const vdSwap = (s) => vdAd(s) + "-USDT-SWAP";
const vdYon = (i) => (i.yon === "long" ? 1 : -1);
let VD_KURULUM_ATLANDI = false;   // don't ask again this session after "skip for now"
const vdKasaYok = () => !D.vadeli.hareketler.length && !D.vadeli.islemler.length;

// ---------------------------------------------------------------- calculations
function vdFiyat(i) { return CANLI_V[i.sembol] || i.fiyat || null; }
const vdMarj = (i) => (i.hizli ? 0 : (i.giris * i.buyukluk) / Math.max(i.kaldirac || 1, 1e-9));
function vdAcikKz(i) { const f = vdFiyat(i); return f ? (f - i.giris) * i.buyukluk * vdYon(i) : null; }
function vdGerceklesen(i) { return i.hizli ? i.sonuc : (i.cikis - i.giris) * i.buyukluk * vdYon(i) - (i.komisyon || 0); }
function vdRisk0(i) { return i.hizli || !i.stop ? null : Math.abs(i.giris - i.stop) * i.buyukluk; }
function vdLikidasyon(giris, kaldirac, yon) {
  if (!kaldirac || kaldirac <= 1) return null;
  return yon === "long" ? giris * (1 - 1 / kaldirac + 0.005) : giris * (1 + 1 / kaldirac - 0.005);
}
function vdOzet() {
  const vd = D.vadeli, acik = vd.pozisyonlar.map((p) => vdAcikKz(p)).filter((x) => x !== null);
  const acikKz = acik.reduce((t, x) => t + x, 0);
  const ozs = vd.cuzdan + acikKz, marj = vd.pozisyonlar.reduce((t, p) => t + vdMarj(p), 0);
  const seri = D.sinif_seri.vadeli || [];
  const kz = seri.length ? seri[seri.length - 1][1] + (acikKz - vd.acik_kz) : 0;   // add the live price difference
  const onceki = seri.filter((p) => p[0] < D.bugun);
  const dunKz = onceki.length ? onceki[onceki.length - 1][1] : 0;
  return { ozs, acikKz, kz, marj, serbest: ozs - marj, bugun: seri.length ? kz - dunKz : 0 };
}
function vdKapali() {
  return D.vadeli.islemler.filter((i) => i.durum === "kapali")
    .map((i) => ({ ...i, kz: vdGerceklesen(i), R: vdRisk0(i) ? vdGerceklesen(i) / vdRisk0(i) : null }));
}
function vdIstat(l) {
  const kaz = l.filter((i) => i.kz > 0), kay = l.filter((i) => i.kz < 0);
  const topKaz = kaz.reduce((t, i) => t + i.kz, 0), topKay = -kay.reduce((t, i) => t + i.kz, 0);
  const R = l.filter((i) => i.R !== null);
  return { n: l.length, kazanma: l.length ? (kaz.length / l.length) * 100 : null, net: topKaz - topKay,
    pf: topKay ? topKaz / topKay : (topKaz ? Infinity : null),
    ortKaz: kaz.length ? topKaz / kaz.length : null, ortKay: kay.length ? -topKay / kay.length : null,
    ortR: R.length ? R.reduce((t, i) => t + i.R, 0) / R.length : null,
    enIyi: l.reduce((a, i) => (!a || i.kz > a.kz ? i : a), null), enKotu: l.reduce((a, i) => (!a || i.kz < a.kz ? i : a), null) };
}
function vdGrupla(l, anahtar) {
  const g = {};
  l.forEach((i) => { const k = anahtar(i) || "—"; (g[k] ||= []).push(i); });
  return Object.entries(g).map(([ad, x]) => ({ ad, ...vdIstat(x) })).sort((a, b) => b.net - a.net);
}

// ---------------------------------------------------------------- page
function vadeliSayfasi() {
  const vd = D.vadeli, o = vdOzet(), ay = vd.ayar || {};
  const kapali = vdKapali();
  let uyari = "";
  const dunKasa = o.ozs - o.bugun;   // limit as a percentage of the wallet
  if (ay.gunluk_limit && dunKasa > 0) {
    const bugunYzd = (o.bugun / dunKasa) * 100;
    if (bugunYzd <= -ay.gunluk_limit) uyari = `<div class="uyari-serit vd-limit">⛔ <b>Daily loss limit reached</b> (${yuzde(bugunYzd)} / limit −${nf(0, 1).format(ay.gunluk_limit)}%). Consider not opening new trades today.</div>`;
    else if (bugunYzd <= -ay.gunluk_limit * 0.7) uyari = `<div class="uyari-serit">⚠ Approaching your daily loss limit: ${yuzde(bugunYzd)} / limit −${nf(0, 1).format(ay.gunluk_limit)}%</div>`;
  }
  $("#v-icerik").innerHTML = `
    <div class="izgara k4">
      <div class="kart"><div class="etiket">Futures wallet</div><div class="buyuk" data-canli="vd-ozs">${para(o.ozs)}</div>
        <div class="alt-yazi" data-canli="vd-serbest">Available ${para(o.serbest)} · margin ${para(o.marj)}</div></div>
      <div class="kart"><div class="etiket">Open P&amp;L</div><div class="buyuk ${isaretSinif(o.acikKz)}" data-canli="vd-acik">${para(o.acikKz, { isaret: true })}</div>
        <div class="alt-yazi">${vd.pozisyonlar.length} open position${vd.pozisyonlar.length === 1 ? "" : "s"}</div></div>
      <div class="kart"><div class="etiket">Today</div><div class="buyuk ${isaretSinif(o.bugun)}" data-canli="vd-bugun">${para(o.bugun, { isaret: true })}</div>
        <div class="alt-yazi">${ay.gunluk_limit ? `Daily limit: −${nf(0, 1).format(ay.gunluk_limit)}% of the wallet` : "vs. yesterday's close"}</div></div>
      <div class="kart"><div class="etiket">Total P&amp;L</div><div class="buyuk ${isaretSinif(o.kz)}" data-canli="vd-kz">${para(o.kz, { isaret: true })}</div>
        <div class="alt-yazi">Realized + open</div></div>
    </div>
    ${uyari}
    <div class="ara-ust" style="margin-top:22px"><h2>Open positions</h2>
      <div class="btnlar">
        <button class="btn ana" data-vd="islem">+ Trade</button><button class="btn" data-vd="hizli">Quick result</button>
        <button class="btn" data-vd="yatir">Deposit</button><button class="btn" data-vd="cek">Withdraw</button>
        <button class="btn" data-vd="duzelt">Adjust balance</button><button class="btn" data-vd="hareketler">Transfers</button>
        <button class="ikon-btn" data-vd="ayar" title="Futures settings">⚙</button>
      </div></div>
    ${vdKasaYok() ? `<div class="kart vd-kurulum"><div><h3>Set up your futures wallet</h3>
      <p class="aciklama">How much is in your futures account on the exchange? Enter it once; trades then run inside this wallet and don't touch your cash.
      Pick "from outside" if the money is already on the exchange or comes from your bank, "from cash" if you move it from the panel's cash.</p></div>
      <button class="btn ana" data-vd="kur">Set up wallet</button></div>` : ""}
    <div id="vd-acik">${vdAcikHTML()}</div>
    <div class="bosluk"></div>
    <div class="izgara k2">
      <div class="kart"><div class="kart-bas"><h3>Futures calendar</h3>
          <div class="ay-nav"><button class="ikon-btn" data-vd="ay-geri">‹</button><span id="vd-ay-ad"></span><button class="ikon-btn" data-vd="ay-ileri">›</button></div></div>
        <div id="vd-takvim"></div></div>
      <div class="kart"><div class="kart-bas"><h3>Stats</h3><span class="etiket">${kapali.length} closed trade${kapali.length === 1 ? "" : "s"}</span></div>
        <div id="vd-istat"></div></div>
    </div>
    <div class="bosluk"></div>
    <div class="kart"><div class="kart-bas"><h3>Trade journal</h3><div class="btnlar" id="vd-filtre"></div></div>
      <div id="vd-gunluk"></div></div>`;
  vdTakvim(); vdIstatCiz(); vdGunlukCiz();
  if (VD_SONRA) { const f = VD_SONRA; VD_SONRA = null; setTimeout(f, 50); }
}

function vdAcikHTML() {
  const l = D.vadeli.pozisyonlar;
  if (!l.length) return `<div class="bos-durum">No open futures positions. Open one with <b>+ Trade</b>, or add a closed trade's result with <b>Quick result</b>.</div>`;
  return `<div class="kart-izgara">${l.map((p) => {
    const f = vdFiyat(p), kz = vdAcikKz(p), canli = CANLI_V[p.sembol];
    const marjYzd = kz !== null && p.marj ? (kz / p.marj) * 100 : null;
    const lik = p.likidasyon, likMesafe = lik && f ? Math.abs(f / lik - 1) * 100 : null;
    const mesafe = (h) => (h && f ? yuzde(((h - f) / f) * 100) : "—");
    return `<div class="vkart ${likMesafe !== null && likMesafe < 5 ? "vd-tehlike" : ""}">
      <div class="vkart-bas"><div><div class="vkart-ad">${esc(vdAd(p.sembol))}${vdHisse(p) ? ' <span class="rozet">stock</span>' : ""} <span class="rozet ${p.yon === "long" ? "poz" : "neg"}">${p.yon.toUpperCase()}</span>
          ${p.kaldirac ? `<span class="rozet">${nf(0, 1).format(p.kaldirac)}x</span>` : ""}${canli ? `<span class="canli-isaret" title="${vdHisse(p) ? "Hyperliquid" : "Live (OKX perp)"}"></span>` : ""}</div>
        <div class="vkart-sembol">${tarihTR(p.acilis_tarih)} · ${miktarYaz(p.buyukluk)} ${esc(vdAd(p.sembol))}${p.etiket ? ` · ${esc(p.etiket)}` : ""}</div></div>
        <button class="menu-btn" data-vd-menu="${p.id}" aria-label="Options">⋯</button></div>
      <div class="vkart-deger"><span class="orta ${isaretSinif(kz)}" data-canli="vd-kz-${p.id}">${para(kz, { isaret: true })}</span>
        <span class="rozet ${isaretSinif(kz)}" data-canli="vd-yzd-${p.id}">${marjYzd !== null ? yuzde(marjYzd) + " of margin" : "—"}</span></div>
      <div class="vd-mini">
        <div><span>Entry</span><b>${fiyatYaz(p.giris)}</b></div>
        <div><span>Current</span><b data-canli="vd-f-${p.id}">${fiyatYaz(f)}</b></div>
        <div><span>Size</span><b>${para(p.buyukluk_usd)}</b></div>
        <div><span>Margin</span><b>${para(p.marj)}</b></div>
        <div><span>Stop${p.stop ? ` · ${mesafe(p.stop)}` : ""}</span><b>${p.stop ? fiyatYaz(p.stop) : "—"}</b></div>
        <div><span>Target${p.hedef ? ` · ${mesafe(p.hedef)}` : ""}</span><b>${p.hedef ? fiyatYaz(p.hedef) : "—"}</b></div>
        <div><span>Liquidation ~${likMesafe !== null ? ` · ${nf(1, 1).format(likMesafe)}% away` : ""}</span><b class="${likMesafe !== null && likMesafe < 10 ? "neg" : ""}">${lik ? fiyatYaz(lik) : "—"}</b></div>
        <div><span>Risk at stop</span><b class="${p.risk ? "neg" : ""}">${p.risk ? para(-p.risk) : "—"}</b></div>
      </div>
      <div class="btnlar" style="margin-top:12px"><button class="btn kucuk ana" data-vd-kapat="${p.id}">Close</button><button class="btn kucuk" data-vd-duzenle="${p.id}">Edit</button></div>
    </div>`; }).join("")}</div>`;
}

function vdTakvim() {
  if (!VD_AY) { const b = new Date(D.bugun + "T00:00:00"); VD_AY = { y: b.getFullYear(), m: b.getMonth() }; }
  const { y, m } = VD_AY, gunluk = {};
  vdKapali().forEach((i) => { gunluk[i.kapanis_tarih] = (gunluk[i.kapanis_tarih] || { kz: 0, n: 0 }); gunluk[i.kapanis_tarih].kz += i.kz; gunluk[i.kapanis_tarih].n++; });
  $("#vd-ay-ad").textContent = `${AYLAR[m]} ${y}`;
  const bosluk = (new Date(y, m, 1).getDay() + 6) % 7, son = new Date(y, m + 1, 0).getDate();
  let ayKz = 0, gun = 0, kazanan = 0;
  const h = GUNLER.map((g) => `<div class="gun-ad">${g}</div>`);
  for (let i = 0; i < bosluk; i++) h.push(`<div class="vd-hucre bos"></div>`);
  for (let g = 1; g <= son; g++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(g).padStart(2, "0")}`, d = gunluk[iso];
    if (d) { ayKz += d.kz; gun++; if (d.kz > 0) kazanan++; }
    h.push(`<div class="vd-hucre ${d ? isaretSinif(d.kz) : ""} ${iso === D.bugun ? "bugun" : ""}" title="${d ? `${d.n} trade${d.n === 1 ? "" : "s"}` : ""}">
      <span class="no">${g}</span>${d ? `<span class="tutar">${paraHam(cevir(d.kz), { isaret: true, ondalik: Math.abs(cevir(d.kz)) >= 100 ? 0 : 2 })}</span>` : ""}</div>`);
  }
  $("#vd-takvim").innerHTML = `<div class="vd-takvim">${h.join("")}</div>
    <div class="ozet-cipleri" style="margin-top:12px">
      <div><span class="etiket">Month P&amp;L</span><b class="${isaretSinif(ayKz)}">${gun ? para(ayKz, { isaret: true }) : "—"}</b></div>
      <div><span class="etiket">Trading days</span><b>${gun || "—"}</b></div>
      <div><span class="etiket">Green days</span><b>${gun ? `${kazanan}/${gun}` : "—"}</b></div></div>`;
}

function vdIstatCiz() {
  const l = vdKapali();
  if (!l.length) { $("#vd-istat").innerHTML = `<div class="bos-durum">As you close trades, win rate, profit factor and results by tag appear here.</div>`; return; }
  const s = vdIstat(l), pf = s.pf === Infinity ? "∞" : s.pf === null ? "—" : nf(2, 2).format(s.pf);
  const satir = (a, b, sn = "") => `<div class="liste-satir"><span class="etiket">${a}</span><span class="num ${sn}">${b}</span></div>`;
  const grup = (baslik, g) => `<table class="tablo vd-grup"><thead><tr><th>${baslik}</th><th class="sag-hiza">Trades</th><th class="sag-hiza">Win rate</th><th class="sag-hiza">Net</th></tr></thead><tbody>
    ${g.map((x) => `<tr><td>${esc(x.ad)}</td><td class="sag-hiza">${x.n}</td><td class="sag-hiza">${x.kazanma !== null ? nf(0, 0).format(x.kazanma) + "%" : "—"}</td>
      <td class="sag-hiza num ${isaretSinif(x.net)}">${para(x.net, { isaret: true })}</td></tr>`).join("")}</tbody></table>`;
  $("#vd-istat").innerHTML = `
    <div class="vd-istat-ust">
      <div><span class="etiket">Win rate</span><b>${s.kazanma !== null ? nf(0, 1).format(s.kazanma) + "%" : "—"}</b></div>
      <div><span class="etiket">Profit factor</span><b>${pf}</b></div>
      <div><span class="etiket">Net P&amp;L</span><b class="${isaretSinif(s.net)}">${para(s.net, { isaret: true })}</b></div>
      <div><span class="etiket">Avg. R</span><b class="${s.ortR !== null ? isaretSinif(s.ortR) : ""}">${s.ortR !== null ? (s.ortR > 0 ? "+" : "") + nf(2, 2).format(s.ortR) + "R" : "—"}</b></div>
    </div>
    ${satir("Average win", s.ortKaz !== null ? para(s.ortKaz, { isaret: true }) : "—", "poz")}
    ${satir("Average loss", s.ortKay !== null ? para(s.ortKay, { isaret: true }) : "—", "neg")}
    ${satir("Best trade", s.enIyi ? `${esc(vdAd(s.enIyi.sembol))} ${para(s.enIyi.kz, { isaret: true })}` : "—")}
    ${satir("Worst trade", s.enKotu ? `${esc(vdAd(s.enKotu.sembol))} ${para(s.enKotu.kz, { isaret: true })}` : "—")}
    <details class="vd-detay"><summary>By side, symbol and tag</summary>
      ${grup("Side", vdGrupla(l, (i) => (i.yon === "long" ? "Long" : "Short")))}
      ${grup("Symbol", vdGrupla(l, (i) => vdAd(i.sembol)))}
      ${grup("Tag", vdGrupla(l, (i) => i.etiket))}
    </details>`;
}

function vdGunlukCiz() {
  const tum = D.vadeli.islemler;
  const sec = (ad, etiket, l) => `<select class="kucuk-secim" data-vd-filtre="${ad}"><option value="">${etiket}</option>${l.map((x) => `<option value="${esc(x)}" ${VD_FILTRE[ad] === x ? "selected" : ""}>${esc(ad === "sembol" ? vdAd(x) : x === "long" ? "Long" : x === "short" ? "Short" : x)}</option>`).join("")}</select>`;
  $("#vd-filtre").innerHTML = sec("sembol", "All symbols", [...new Set(tum.map((i) => i.sembol))].sort()) +
    sec("yon", "Long + Short", ["long", "short"]) + sec("etiket", "All tags", [...new Set(tum.map((i) => i.etiket).filter(Boolean))].sort());
  const l = tum.filter((i) => (!VD_FILTRE.sembol || i.sembol === VD_FILTRE.sembol) && (!VD_FILTRE.yon || i.yon === VD_FILTRE.yon) && (!VD_FILTRE.etiket || i.etiket === VD_FILTRE.etiket));
  if (!l.length) { $("#vd-gunluk").innerHTML = `<div class="bos-durum">${tum.length ? "No trades match this filter." : "No futures trades yet."}</div>`; return; }
  $("#vd-gunluk").innerHTML = `<div class="tablo-kap"><table class="tablo"><thead><tr><th>Date</th><th>Symbol</th><th>Side</th><th class="sag-hiza">Entry → Exit</th>
      <th class="sag-hiza">Leverage</th><th class="sag-hiza">P&amp;L</th><th class="sag-hiza">R</th><th>Tag</th><th>Note</th><th></th></tr></thead><tbody>
    ${l.map((i) => {
      const acik = i.durum === "acik", kz = acik ? vdAcikKz(D.vadeli.pozisyonlar.find((p) => p.id === i.id) || i) : vdGerceklesen(i);
      const r0 = vdRisk0(i), R = !acik && r0 ? kz / r0 : null;
      return `<tr><td>${tarihTR(acik ? i.acilis_tarih : i.kapanis_tarih, true)}${acik ? ' <span class="rozet uyari">open</span>' : ""}</td>
        <td><b>${esc(vdAd(i.sembol))}</b></td><td><span class="rozet ${i.yon === "long" ? "poz" : "neg"}">${i.yon === "long" ? "Long" : "Short"}</span></td>
        <td class="sag-hiza num">${i.hizli ? '<span class="etiket">quick entry</span>' : `${fiyatYaz(i.giris)} → ${acik ? "…" : fiyatYaz(i.cikis)}`}</td>
        <td class="sag-hiza">${i.kaldirac ? nf(0, 1).format(i.kaldirac) + "x" : "—"}</td>
        <td class="sag-hiza num ${isaretSinif(kz)}">${kz !== null ? para(kz, { isaret: true }) : "—"}</td>
        <td class="sag-hiza num ${R !== null ? isaretSinif(R) : ""}">${R !== null ? (R > 0 ? "+" : "") + nf(1, 1).format(R) + "R" : "—"}</td>
        <td>${i.etiket ? `<span class="rozet">${esc(i.etiket)}</span>` : ""}</td><td class="vd-not" title="${esc(i.not)}">${esc(i.not)}</td>
        <td class="sag-hiza"><button class="menu-btn" data-vd-menu="${i.id}" aria-label="Options">⋯</button></td></tr>`;
    }).join("")}</tbody></table></div>`;
}

// ---------------------------------------------------------------- live (OKX perp)
function vdOkxIstenen() { return D && D.vadeli ? D.vadeli.pozisyonlar.filter((p) => !vdHisse(p)).map((p) => vdSwap(p.sembol)) : []; }
/** While the Futures tab is open, polls prices every 20 s (stock perps from Hyperliquid; crypto too if OKX isn't connected). */
setInterval(async () => {
  if (!D || !D.vadeli || !D.vadeli.pozisyonlar.length || VSINIF !== "vadeli" || !$("#vd-acik") || document.hidden) return;
  try {
    const f = await api("GET", "/api/vadeli/fiyatlar");
    for (const p of D.vadeli.pozisyonlar) if (f[p.sembol] && (vdHisse(p) || !CANLI_V[p.sembol])) CANLI_V[p.sembol] = f[p.sembol];
    vdCanliUygula();
  } catch { /* silent */ }
}, 20000);
function vdCanliUygula() {
  if (!D || !D.vadeli || VSINIF !== "vadeli" || !$("#vd-acik")) return;
  const o = vdOzet(), yaz = (k, metin, sinif) => { const e = $(`[data-canli="${k}"]`); if (!e) return; e.textContent = metin; if (sinif !== undefined) e.className = e.className.replace(/\b(poz|neg)\b/g, "").trim() + (sinif ? " " + sinif : ""); };
  yaz("vd-ozs", para(o.ozs)); yaz("vd-serbest", `Available ${para(o.serbest)} · margin ${para(o.marj)}`); yaz("vd-acik", para(o.acikKz, { isaret: true }), isaretSinif(o.acikKz));
  yaz("vd-bugun", para(o.bugun, { isaret: true }), isaretSinif(o.bugun)); yaz("vd-kz", para(o.kz, { isaret: true }), isaretSinif(o.kz));
  for (const p of D.vadeli.pozisyonlar) {
    const kz = vdAcikKz(p);
    yaz(`vd-kz-${p.id}`, para(kz, { isaret: true }), isaretSinif(kz));
    yaz(`vd-yzd-${p.id}`, kz !== null && p.marj ? yuzde((kz / p.marj) * 100) + " of margin" : "—", isaretSinif(kz));
    yaz(`vd-f-${p.id}`, fiyatYaz(vdFiyat(p)));
  }
}

// ---------------------------------------------------------------- menus and dialogs
function vdMenu(id, dugme) {
  kapatAcilir();
  const i = D.vadeli.islemler.find((x) => x.id === id), acik = i.durum === "acik";
  const m = document.createElement("div"); m.className = "acilir";
  const sec = (acik ? [["kapat", "Close"]] : []).concat([["duzenle", "Edit"], ["sil", "Delete"]]);
  m.innerHTML = sec.map(([k, a]) => `<button data-islem="${k}" class="${k === "sil" ? "tehlike" : ""}">${a}</button>`).join("");
  (dugme.closest(".vkart") || dugme.closest("td")).appendChild(m);
  if (dugme.closest("td")) { dugme.closest("td").style.position = "relative"; m.style.top = "30px"; m.style.right = "0"; }
  m.addEventListener("click", (e) => { e.stopPropagation(); const k = e.target.dataset.islem; if (!k) return; kapatAcilir();
    ({ kapat: () => vdKapatModal(i), duzenle: () => (i.hizli ? vdHizliModal(i) : vdIslemModal(i)), sil: () => vdSilModal(i) })[k](); });
}

const vdEtiketListe = () => `<datalist id="vd-etiketler">${[...new Set(D.vadeli.islemler.map((i) => i.etiket).filter(Boolean))].map((e) => `<option value="${esc(e)}">`).join("")}</datalist>`;
const vdYonSecim = (yon) => `<div class="alan"><label>Side</label><div class="ikili tam-gen" id="vd-yon">
  <button type="button" data-yon="long" class="${yon === "long" ? "aktif" : ""}">Long</button><button type="button" data-yon="short" class="${yon === "short" ? "aktif" : ""}">Short</button></div></div>`;
const vdPiyasaSecim = (p) => `<div class="alan"><label>Market</label><div class="ikili tam-gen" id="vd-piyasa">
  <button type="button" data-piyasa="kripto" class="${p !== "hisse" ? "aktif" : ""}">Crypto</button><button type="button" data-piyasa="hisse" class="${p === "hisse" ? "aktif" : ""}" title="Hyperliquid stock perps">Stock</button></div></div>`;
function vdPiyasaBagla() {
  const ipucu = () => { const h = ($("#vd-piyasa .aktif") || {}).dataset?.piyasa === "hisse", e = $("#i-sembol"); if (e) e.textContent = h ? "e.g. NVDA, TSLA, AAPL (Hyperliquid)" : "e.g. BTC, ETH, SOL"; };
  $$("#vd-piyasa button").forEach((b) => b.addEventListener("click", () => { $$("#vd-piyasa button").forEach((x) => x.classList.toggle("aktif", x === b)); ipucu(); }));
  ipucu();
  return () => ($("#vd-piyasa .aktif") || {}).dataset?.piyasa || "kripto";
}
function vdYonBagla(cb) {
  $$("#vd-yon button").forEach((b) => b.addEventListener("click", () => { $$("#vd-yon button").forEach((x) => x.classList.toggle("aktif", x === b)); cb && cb(); }));
  return () => ($("#vd-yon .aktif") || {}).dataset?.yon || "long";
}

/** Trade form: open a position (or enter a closed trade in detail). Built-in calculator: liquidation, risk, R/R, suggested margin. */
function vdIslemModal(i = null) {
  if (!i && vdKasaYok() && !VD_KURULUM_ATLANDI) return vdAktarModal("yatir", { kurulum: true, sonra: () => vdIslemModal() });
  const ay = D.vadeli.ayar || {}, kapali = i && i.durum === "kapali";
  const marj = i && i.kaldirac ? (i.giris * i.buyukluk) / i.kaldirac : "";
  modalAc(`<h3>${i ? "Edit futures trade" : "Futures trade"}</h3>
    <p class="aciklama">Margin comes from your futures wallet and P&amp;L goes back to it. Enter a stop to see your risk and a suggested margin.</p>
    <div class="form">
      ${vdPiyasaSecim(i ? i.piyasa : "kripto")}
      ${alan("sembol", "Symbol", "text", i ? vdAd(i.sembol) : "", "", "e.g. BTC, ETH, SOL")}
      ${vdYonSecim(i ? i.yon : "long")}
      ${alan("giris", "Entry price ($)", "number", i ? i.giris : "")}
      ${alan("kaldirac", "Leverage (x)", "number", i ? i.kaldirac ?? "" : "")}
      ${alan("marj", "Margin ($)", "number", marj !== "" ? +marj.toFixed(2) : "", "", "Collateral you put on the position")}
      ${alan("acilis_tarih", "Open date", "date", i ? i.acilis_tarih : D.bugun)}
      ${alan("stop", "Stop ($)", "number", i ? i.stop ?? "" : "")}
      ${alan("hedef", "Target ($)", "number", i ? i.hedef ?? "" : "")}
      <div class="alan tam vd-onizleme" id="vd-onizleme"></div>
      ${i ? "" : secimAlan("durum", "Status", [["acik", "Open position"], ["kapali", "Closed (past trade)"]], "acik", "tam")}
      <div class="alan ${kapali ? "" : "gizli"}" data-kapali>${`<label for="f-cikis">Exit price ($)</label><input id="f-cikis" type="number" step="any" value="${kapali ? i.cikis : ""}">`}</div>
      <div class="alan ${kapali ? "" : "gizli"}" data-kapali><label for="f-kapanis_tarih">Close date</label><input id="f-kapanis_tarih" type="date" value="${kapali ? i.kapanis_tarih : D.bugun}"></div>
      <div class="alan ${kapali ? "" : "gizli"}" data-kapali><label for="f-komisyon">Fees + funding ($)</label><input id="f-komisyon" type="number" step="any" value="${kapali ? i.komisyon || "" : ""}"></div>
      <div class="alan"><label for="f-etiket">Tag</label><input id="f-etiket" list="vd-etiketler" value="${esc(i ? i.etiket : "")}" placeholder="breakout, FOMO…" autocomplete="off">${vdEtiketListe()}</div>
      <div class="alan tam"><label for="f-not">Note</label><textarea id="f-not" rows="2">${esc(i ? i.not : "")}</textarea></div>
    </div>${altBtn(i ? "Save" : "Add")}`);
  const yon = vdYonBagla(onizle), piyasa = vdPiyasaBagla();
  const canliDoldur = async () => {
    const s = val("sembol").toUpperCase(); if (!s || val("giris")) return;
    const ks = piyasa() === "hisse" ? s : s.replace(/-?USDT?$/, "") + "-USD";
    let f = CANLI_V[ks] || CANLI[ks];
    if (!f) { try { f = (await api("GET", "/api/fiyat?sembol=" + encodeURIComponent(ks))).fiyat; } catch { /* symbol not found */ } }
    if (f && !val("giris")) { $("#f-giris").value = +Number(f).toPrecision(8); onizle(); }
  };
  $("#f-sembol").addEventListener("blur", () => { if (!i) canliDoldur(); });
  ["giris", "kaldirac", "marj", "stop", "hedef", "cikis", "komisyon"].forEach((a) => $(`#f-${a}`) && $(`#f-${a}`).addEventListener("input", onizle));
  if ($("#f-durum")) $("#f-durum").addEventListener("change", () => { $$("[data-kapali]").forEach((e) => e.classList.toggle("gizli", val("durum") !== "kapali")); onizle(); });
  function onizle() {
    const g = num("giris"), k = num("kaldirac"), m = num("marj"), st = num("stop"), h = num("hedef"), y = yon(), s = y === "long" ? 1 : -1;
    const kasa = vdOzet(), ozs = kasa.ozs > 0 ? kasa.ozs : D.toplam, riskYzd = ay.risk_yuzde || 1;   // risk as a percentage of the wallet
    if (!g || !k || !m) { $("#vd-onizleme").innerHTML = `<span class="etiket">Enter the entry, leverage and margin to see size, liquidation and risk here.</span>`; return; }
    const b = (m * k) / g, lik = vdLikidasyon(g, k, y);
    const risk = st ? Math.max((g - st) * s, 0) * b : null, kazanc = h ? (h - g) * s * b : null;
    const yanlisStop = st && (st - g) * s >= 0, stopLikSonra = st && lik && (y === "long" ? st <= lik : st >= lik);
    let oneri = "";
    if (st && !yanlisStop && ozs > 0) {
      const hedefRisk = (ozs * riskYzd) / 100, b2 = hedefRisk / Math.abs(g - st), m2 = (b2 * g) / k;
      oneri = `<div class="vd-oneri">Suggested margin for ${nf(0, 2).format(riskYzd)}% risk: <b>${para(m2)}</b> <button type="button" class="btn kucuk" id="vd-oneri-uygula">Apply</button></div>`;
    }
    let sonuc = "";
    if (val("durum") === "kapali" || kapali) {
      const c = num("cikis");
      if (c) { const kz = (c - g) * s * b - (num("komisyon") || 0); sonuc = `<div><span class="etiket">Result</span><b class="${isaretSinif(kz)}">${para(kz, { isaret: true })}</b></div>`; }
    }
    $("#vd-onizleme").innerHTML = `<div class="vd-onizleme-izgara">
        <div><span class="etiket">Size</span><b>${para(b * g)}</b><small>${miktarYaz(+b.toFixed(6))} coin</small></div>
        <div><span class="etiket">Liquidation ~</span><b class="${stopLikSonra ? "neg" : ""}">${lik ? fiyatYaz(lik) : "—"}</b><small>${lik ? yuzde(((lik - g) / g) * 100) : ""}</small></div>
        <div><span class="etiket">At stop</span><b class="neg">${risk !== null && !yanlisStop ? para(-risk) : "—"}</b><small>${risk && ozs > 0 && !yanlisStop ? nf(1, 2).format((risk / ozs) * 100) + "% of wallet" : ""}</small></div>
        <div><span class="etiket">At target</span><b class="poz">${kazanc !== null ? para(kazanc, { isaret: true }) : "—"}</b><small>${risk && kazanc && !yanlisStop ? "R/R 1:" + nf(1, 2).format(kazanc / risk) : ""}</small></div>
        ${sonuc}</div>
      ${yanlisStop ? `<div class="neg" style="margin-top:6px">The stop must be ${y === "long" ? "below" : "above"} the entry.</div>` : ""}
      ${stopLikSonra ? `<div class="neg" style="margin-top:6px">⚠ The stop is past the liquidation price: you'd be liquidated before the stop. Lower the leverage.</div>` : ""}
      ${!i && val("durum") !== "kapali" && m > kasa.serbest + 0.005 ? `<div class="uyari-yazi vd-oneri" style="margin-top:6px">The wallet has ${para(Math.max(kasa.serbest, 0))} available; this margin needs ${para(m - Math.max(kasa.serbest, 0))} more.
        <button type="button" class="btn kucuk" id="vd-eksik-aktar">Move the shortfall from cash</button></div>` : ""}
      ${oneri}`;
    const u = $("#vd-oneri-uygula");
    const ea = $("#vd-eksik-aktar");
    if (ea) ea.addEventListener("click", async () => {
      ea.disabled = true;
      try { await api("POST", "/api/vadeli/hareket", { tip: "yatir", tutar: +(m - Math.max(kasa.serbest, 0)).toFixed(2), kaynak: "nakit", not: "Margin shortfall for a trade" });
        await yukle(); bildir("Shortfall moved from cash"); onizle(); } catch (err) { modalHata(err.message); ea.disabled = false; }
    });
    if (u) u.addEventListener("click", () => { const hedefRisk = (ozs * riskYzd) / 100; $("#f-marj").value = +((hedefRisk / Math.abs(g - st)) * g / k).toFixed(2); onizle(); });
  }
  onizle();
  kaydetBagla(async () => {
    const b = { piyasa: piyasa(), sembol: val("sembol"), yon: yon(), giris: num("giris"), kaldirac: num("kaldirac"), marj: num("marj"),
      stop: num("stop"), hedef: num("hedef"), acilis_tarih: val("acilis_tarih"), etiket: $("#f-etiket").value, not: $("#f-not").value };
    if (i) b.buyukluk = b.kaldirac && b.marj ? (b.marj * b.kaldirac) / b.giris : i.buyukluk;
    const kapaliMi = kapali || val("durum") === "kapali";
    if (kapaliMi) Object.assign(b, { durum: "kapali", cikis: num("cikis"), kapanis_tarih: $("#f-kapanis_tarih").value, komisyon: num("komisyon") });
    if (i) await api("PUT", `/api/vadeli/islem/${i.id}`, b); else await api("POST", "/api/vadeli/islem", b);
    bildir(i ? "Updated" : kapaliMi ? "Trade saved" : "Position opened");
  });
}

function vdHizliModal(i = null) {
  if (!i && vdKasaYok() && !VD_KURULUM_ATLANDI) return vdAktarModal("yatir", { kurulum: true, sonra: () => vdHizliModal() });
  modalAc(`<h3>${i ? "Edit quick entry" : "Quick result"}</h3><p class="aciklama">Enter only a closed trade's result; it's added to your futures wallet (or deducted if negative). Use <b>+ Trade</b> for detailed stats.</p>
    <div class="form">${vdPiyasaSecim(i ? i.piyasa : "kripto")}${vdYonSecim(i ? i.yon : "long")}${alan("sembol", "Symbol", "text", i ? vdAd(i.sembol) : "", "", "e.g. BTC")}
      ${alan("sonuc", "Result ($)", "number", i ? i.sonuc : "", "", "Negative for a loss: −25")}${alan("kapanis_tarih", "Date", "date", i ? i.kapanis_tarih : D.bugun)}
      <div class="alan"><label for="f-etiket">Tag</label><input id="f-etiket" list="vd-etiketler" value="${esc(i ? i.etiket : "")}" autocomplete="off">${vdEtiketListe()}</div>
      ${alan("not", "Note", "text", i ? i.not : "", "tam")}</div>${altBtn(i ? "Save" : "Add")}`);
  const yon = vdYonBagla(), piyasa = vdPiyasaBagla();
  kaydetBagla(async () => {
    const b = { hizli: true, piyasa: piyasa(), sembol: val("sembol"), yon: yon(), sonuc: num("sonuc"), kapanis_tarih: val("kapanis_tarih"), etiket: $("#f-etiket").value, not: val("not") };
    if (i) await api("PUT", `/api/vadeli/islem/${i.id}`, b); else await api("POST", "/api/vadeli/islem", b);
    bildir("Saved");
  });
}

function vdKapatModal(i) {
  const p = D.vadeli.pozisyonlar.find((x) => x.id === i.id) || i, f = vdFiyat(p);
  modalAc(`<h3>${esc(vdAd(i.sembol))} ${i.yon === "long" ? "long" : "short"}: close</h3>
    <p class="aciklama">Entry ${fiyatYaz(i.giris)} · ${miktarYaz(i.buyukluk)} coin${i.kaldirac ? ` · ${nf(0, 1).format(i.kaldirac)}x` : ""}</p>
    <div class="form">${alan("cikis", "Exit price ($)", "number", f ? +f.toFixed(6) : "")}${alan("kapanis_tarih", "Close date", "date", D.bugun)}
      ${alan("komisyon", "Fees + funding ($)", "number", "", "", "Total fees shown by the exchange. Leave empty if unknown.")}
      <div class="alan tam vd-onizleme" id="vd-kapat-sonuc"></div></div>${altBtn("Close")}`);
  const goster = () => { const c = num("cikis"); if (!c) { $("#vd-kapat-sonuc").innerHTML = ""; return; }
    const kz = (c - i.giris) * i.buyukluk * vdYon(i) - (num("komisyon") || 0), r0 = vdRisk0(i);
    $("#vd-kapat-sonuc").innerHTML = `<span class="etiket">Result</span> <b class="${isaretSinif(kz)}">${para(kz, { isaret: true })}</b>${r0 ? ` · <b class="${isaretSinif(kz)}">${(kz > 0 ? "+" : "") + nf(2, 2).format(kz / r0)}R</b>` : ""}`; };
  ["cikis", "komisyon"].forEach((a) => $(`#f-${a}`).addEventListener("input", goster)); goster();
  kaydetBagla(async () => { const r = await api("POST", `/api/vadeli/islem/${i.id}/kapat`, { cikis: num("cikis"), kapanis_tarih: val("kapanis_tarih"), komisyon: num("komisyon") });
    bildir(`Closed: ${para(r.kz, { isaret: true })}`); });
}

function vdSilModal(i) {
  modalAc(`<h3>Delete futures trade</h3><p class="aciklama">${esc(vdAd(i.sembol))} ${i.yon === "long" ? "long" : "short"} and its effect on the balance will be deleted. This can't be undone.</p>
    <div class="modal-alt"><button class="btn" data-kapat>Cancel</button><button class="btn tehlike" id="m-kaydet">Delete</button></div>`);
  kaydetBagla(async () => { await api("DELETE", `/api/vadeli/islem/${i.id}`, {}); bildir("Deleted"); });
}

function vdAktarModal(tip, { kurulum = false, sonra = null } = {}) {
  const yatir = tip === "yatir", o = vdOzet();
  const kaynaklar = yatir ? [["dis", "From outside (already on the exchange or from the bank)"], ["nakit", "From the panel's cash"]]
    : [["nakit", "To the panel's cash"], ["dis", "To outside (bank)"]];
  modalAc(`<h3>${kurulum ? "Set up your futures wallet" : yatir ? "Deposit to futures wallet" : "Withdraw from futures wallet"}</h3>
    <p class="aciklama">${kurulum ? "How much is in your futures account on the exchange? Trades run inside this wallet and don't touch your cash."
      : yatir ? `Panel cash: ${para(D.nakit)}.` : `Available in the wallet: ${para(Math.max(o.serbest, 0))} (excluding open positions' margin).`}</p>
    <div class="form">${alan("tutar", kurulum ? "Amount in your futures wallet ($)" : "Amount ($)")}${alan("tarih", "Date", "date", D.bugun)}
      ${secimAlan("kaynak", yatir ? "Where does the money come from?" : "Where does the money go?", kaynaklar, kaynaklar[0][0], "tam")}
      ${alan("not", "Note", "text", "", "tam")}</div>
    <div class="ipucu" style="margin-top:8px">Money from outside counts as a new deposit and doesn't affect P&amp;L. Moving money from cash doesn't change the total.</div>
    <div class="modal-alt">${kurulum && sonra ? `<button class="btn" id="vd-atla">Skip for now</button>` : `<button class="btn" data-kapat>Cancel</button>`}<button class="btn ana" id="m-kaydet">${kurulum ? "Set up wallet" : yatir ? "Deposit" : "Withdraw"}</button></div>`);
  const atla = $("#vd-atla");
  if (atla) atla.addEventListener("click", () => { modalKapat(); VD_KURULUM_ATLANDI = true; sonra(); });
  kaydetBagla(async () => {
    await api("POST", "/api/vadeli/hareket", { tip, tutar: num("tutar"), tarih: val("tarih"), kaynak: val("kaynak"), not: val("not") || (kurulum ? "Wallet setup" : "") });
    bildir(kurulum ? "Futures wallet set up" : "Saved");
    if (sonra) VD_SONRA = sonra;
  });
}

function vdDuzeltModal() {
  const o = vdOzet();
  modalAc(`<h3>Adjust balance</h3>
    <p class="aciklama">Enter your total futures balance on the exchange (including open P&amp;L). The difference is booked as P&amp;L (funding, fees or small trades you didn't enter).</p>
    <div class="form">${alan("bakiye", "Total balance on the exchange ($)", "number", "", "tam", `Wallet in the panel: ${para(o.ozs)}`)}${alan("not", "Note", "text", "", "tam")}</div>
    <div class="vd-onizleme" id="vd-fark"></div>${altBtn("Adjust")}`);
  $("#f-bakiye").addEventListener("input", () => { const b = num("bakiye"); $("#vd-fark").innerHTML = b === null ? "" : `Difference: <b class="${isaretSinif(b - o.ozs)}">${para(b - o.ozs, { isaret: true })}</b>`; });
  kaydetBagla(async () => { const r = await api("POST", "/api/vadeli/hareket", { tip: "duzelt", bakiye: num("bakiye"), not: val("not") });
    bildir(r.fark ? `Adjusted: ${para(r.fark, { isaret: true })}` : "Balance already matches"); });
}

function vdHareketlerModal() {
  const l = D.vadeli.hareketler, ad = { yatir: "Deposit", cek: "Withdrawal", duzelt: "Adjustment" };
  modalAc(`<h3>Wallet transfers</h3><p class="aciklama">Deposits, withdrawals and balance adjustments. Trades are in the journal.</p>
    ${l.length ? `<table class="tablo"><thead><tr><th>Date</th><th>Type</th><th>Note</th><th class="sag-hiza">Amount</th><th></th></tr></thead><tbody>
    ${l.map((h) => { const t = h.tip === "cek" ? -h.tutar : h.tutar;
      return `<tr><td>${tarihTR(h.tarih, true)}</td><td>${ad[h.tip]}${h.tip !== "duzelt" && h.kaynak === "dis" ? ' <span class="rozet">outside</span>' : ""}</td><td>${esc(h.not)}</td>
      <td class="sag-hiza num ${isaretSinif(t)}">${para(t, { isaret: true })}</td><td class="sag-hiza"><button class="btn kucuk tehlike" data-vd-hareket-sil="${h.id}">Delete</button></td></tr>`; }).join("")}</tbody></table>`
      : `<div class="bos-durum">No entries.</div>`}
    <div class="modal-alt"><button class="btn" data-kapat>Close</button></div>`);
}

function vdAyarModal() {
  const ay = D.vadeli.ayar || {};
  modalAc(`<h3>Futures settings</h3>
    <div class="form">${alan("gunluk_limit", "Daily loss limit (%)", "number", ay.gunluk_limit ?? "", "", "Warns when the day's futures loss reaches this % of the wallet. Empty: off.")}
      ${alan("risk_yuzde", "Risk per trade (%)", "number", ay.risk_yuzde ?? 1, "", "% of the wallet; used for the suggested margin")}</div>${altBtn()}`);
  kaydetBagla(async () => { await api("POST", "/api/vadeli/ayar", { gunluk_limit: val("gunluk_limit"), risk_yuzde: val("risk_yuzde") }); bildir("Saved"); });
}

// ---------------------------------------------------------------- clicks
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-vd], [data-vd-menu], [data-vd-kapat], [data-vd-duzenle], [data-vd-hareket-sil]");
  if (!t || !D || t.closest(".acilir")) return;
  if (t.dataset.vdMenu) { e.stopPropagation(); return vdMenu(t.dataset.vdMenu, t); }
  if (t.dataset.vdKapat) return vdKapatModal(D.vadeli.islemler.find((x) => x.id === t.dataset.vdKapat));
  if (t.dataset.vdDuzenle) return vdIslemModal(D.vadeli.islemler.find((x) => x.id === t.dataset.vdDuzenle));
  if (t.dataset.vdHareketSil) return api("DELETE", `/api/vadeli/hareket/${t.dataset.vdHareketSil}`, {})
    .then(() => { modalKapat(); yukle(); bildir("Deleted"); }).catch((err) => modalHata(err.message));
  const k = t.dataset.vd;
  if (k === "ay-geri" || k === "ay-ileri") { const d = new Date(VD_AY.y, VD_AY.m + (k === "ay-ileri" ? 1 : -1), 1); VD_AY = { y: d.getFullYear(), m: d.getMonth() }; return vdTakvim(); }
  ({ islem: () => vdIslemModal(), hizli: () => vdHizliModal(), yatir: () => vdAktarModal("yatir"), cek: () => vdAktarModal("cek"),
    kur: () => vdAktarModal("yatir", { kurulum: true }), duzelt: vdDuzeltModal, hareketler: vdHareketlerModal, ayar: vdAyarModal })[k]?.();
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("[data-vd-filtre]");
  if (s) { VD_FILTRE[s.dataset.vdFiltre] = s.value; vdGunlukCiz(); }
});
