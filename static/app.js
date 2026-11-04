/* Portfolio tracker — front end */
"use strict";

// ================================================================== state
let D = null;
let PARA = yerelOku("para") || "USD";
let DAGILIM = "sinif";
let KATKI = "ay";
let VSINIF = yerelOku("vsinif") || "kripto";
let AY = null;
let GFILTRE = "";
const ARALIK = { ana: 0, sinif: 0 };
const GRAFIK = {};
const CANLI = {};            // live crypto prices: {"BTC-USD": 77000}
let SERIT = [];
let CEKMECE = null;          // {tur: "varlik"|"izleme", id}
let LW = null;               // open lightweight-chart instance

const AYLAR = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AYK = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GUNLER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SINIF_AD = { nakit: "Cash", kripto: "Crypto", hisse: "Stocks", opsiyon: "Options" };
const SINIF_TEK = { nakit: "cash", kripto: "crypto", hisse: "stock", opsiyon: "option" };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const SINIF_RENK = () => ({ nakit: css("--c-nakit"), kripto: css("--c-kripto"), hisse: css("--c-hisse"), opsiyon: css("--c-opsiyon") });
const KATEGORIK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const DIGER = "#6f7891";

function yerelOku(k) { try { return localStorage.getItem(k); } catch { return null; } }
function yerelYaz(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

// ================================================================== helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kur = () => (D && D.usdtry) || 1;
const nf = (min, max) => new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
const cevir = (usd) => (usd === null || usd === undefined ? usd : PARA === "TL" ? usd * kur() : usd);

function paraHam(x, { isaret = false, ondalik = null } = {}) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const abs = Math.abs(x), d = ondalik ?? (abs >= 1000 ? 0 : 2);
  const on = x < 0 ? "−" : (isaret && x > 0 ? "+" : "");
  return `${on}${PARA === "TL" ? "₺" : "$"}${nf(d, d).format(abs)}`;
}
function para(usd, { isaret = false, kurla = null, ondalik = null } = {}) {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return "—";
  return paraHam(PARA === "TL" ? usd * (kurla || kur()) : usd, { isaret, ondalik });
}
function fiyatYaz(f) {
  if (f === null || f === undefined || Number.isNaN(f)) return "—";
  const abs = Math.abs(f), d = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return "$" + nf(d, d).format(f);
}
function yuzde(x, isaret = true) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${isaret && x > 0 ? "+" : x < 0 ? "−" : ""}${nf(2, 2).format(Math.abs(x))}%`;
}
const isaretSinif = (x) => (x > 0.004 ? "poz" : x < -0.004 ? "neg" : "");
const miktarYaz = (q) => nf(0, 8).format(q);
function tarihTR(iso, yil = false) {
  const d = new Date(iso + "T00:00:00");
  return `${AYK[d.getMonth()]} ${d.getDate()}${yil ? ", " + d.getFullYear() : ""}`;
}
const bugunISO = () => (D ? D.bugun : new Date().toISOString().slice(0, 10));
function gunFarki(iso) { return Math.round((new Date(iso + "T00:00:00") - new Date(bugunISO() + "T00:00:00")) / 86400000); }
const okxSembol = (s) => s.replace(/-USD$/, "-USDT");
const gunEkle = (g) => new Date(new Date(bugunISO() + "T00:00:00").getTime() + g * 86400000 + 43200000).toISOString().slice(0, 10);

async function api(yontem, url, govde) {
  const r = await fetch(url, { method: yontem, headers: { "Content-Type": "application/json" },
    body: govde === undefined ? undefined : (typeof govde === "string" ? govde : JSON.stringify(govde)) });
  let j = {};
  try { j = await r.json(); } catch { /* empty response */ }
  if (!r.ok) throw new Error(j.hata || `Server error (${r.status})`);
  return j;
}
function bildir(mesaj) {
  const b = $("#bildirim"); b.textContent = mesaj; b.style.display = "block";
  clearTimeout(bildir._t); bildir._t = setTimeout(() => (b.style.display = "none"), 2600);
}

// ================================================================== Black-Scholes (options calculator)
function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const Ncdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
function bs(S, K, T, iv, tur, r = 0.04) {
  if (!(S > 0)) return 0;
  if (T <= 0 || !(iv > 0)) return tur === "put" ? Math.max(K - S, 0) : Math.max(S - K, 0);
  const st = iv * Math.sqrt(T), d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / st, d2 = d1 - st;
  return tur === "put" ? K * Math.exp(-r * T) * Ncdf(-d2) - S * Ncdf(-d1) : S * Ncdf(d1) - K * Math.exp(-r * T) * Ncdf(d2);
}
function zimniVol(p, S, K, T, tur) {
  if (!(p > 0) || !(S > 0) || T <= 0) return null;
  let lo = 0.01, hi = 6;
  if (bs(S, K, T, hi, tur) < p) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (bs(S, K, T, m, tur) > p) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

// ================================================================== P&L series (in display currency)
function kzSerisi() {
  const ay = D.ayarlar, bas = ay.baslangic_bakiye || 0, basKur = ay.baslangic_usdtry || kur();
  return D.seri.map((r) => {
    const k = r.usdtry || kur();
    const kz = PARA === "TL" ? r.toplam * k - bas * basKur - r.net_yatirim * k : r.kz;
    return { tarih: r.tarih, kz, toplam: PARA === "TL" ? r.toplam * k : r.toplam };
  });
}
function baslangicToplam() {
  const a = D.ayarlar;
  return PARA === "TL" ? (a.baslangic_bakiye || 0) * (a.baslangic_usdtry || kur()) : (a.baslangic_bakiye || 0);
}
function gunlukDegisim() {
  const out = {};
  let oncekiKz = 0, oncekiToplam = baslangicToplam();
  for (const r of kzSerisi()) {
    const fark = r.kz - oncekiKz;
    out[r.tarih] = { kz: fark, yuzde: oncekiToplam ? (fark / oncekiToplam) * 100 : null };
    oncekiKz = r.kz; oncekiToplam = r.toplam;
  }
  return out;
}

// ================================================================== loading
async function yukle(yenile = false, oto = false) {
  const btn = $("#yenile-btn"); btn.classList.add("donuyor");
  try {
    D = await api("GET", "/api/durum" + (yenile ? "?yenile=1" : ""));
    canliUygula(false);
    ciz(oto);
    okxAboneOl();
  } catch (e) {
    bildir("Could not load data: " + e.message);
  } finally { btn.classList.remove("donuyor"); }
}

function ciz(oto = false) {
  if (!D) return;
  const bugun = new Date(D.bugun + "T00:00:00");
  $("#tarih-cip").textContent = `${AYK[bugun.getMonth()]} ${bugun.getDate()}`;
  $("#kur-cip").textContent = D.usdtry ? nf(2, 2).format(D.usdtry) : "—";
  if (!AY) AY = { y: bugun.getFullYear(), m: bugun.getMonth() };
  const u = $("#uyari-serit");
  if (u) {
    if (!D.varliklar.length && !D.ayarlar.baslangic_nakit && !D.nakit_hareketleri.length) {
      u.style.display = "block";
      u.innerHTML = `Welcome. To get started, open <b>Settings</b> (top right) and enter your starting cash and start date, then add your positions under <b>Holdings</b> (buys are deducted from cash; for positions you already held before the start date, untick "Deduct from cash").`;
    } else if (D.eksik_fiyat.length) {
      u.style.display = "block";
      u.innerHTML = `No live price for: <b>${D.eksik_fiyat.map(esc).join(", ")}</b>. Valued at cost for now. For an accurate value use <b>Enter price manually</b> in the card menu.`;
    } else u.style.display = "none";
  }
  const aktif = yerelOku("sayfa") || "ana";
  anaEkran(); varliklarSayfasi(); izlemeSayfasi(); takvim(); aylikTablo(); gecmisSayfasi(); senaryoPozisyonlari();
  if (aktif === "grafik") grafikSayfasi();
  if (CEKMECE && !oto) cekmeceYenile();  // don't reset an open chart on auto-refresh
  seritCiz();
}

// ================================================================== shared charts
function grafikKur(ad, secici, cfg) {
  if (typeof Chart === "undefined" || !$(secici)) return;
  if (GRAFIK[ad]) GRAFIK[ad].destroy();
  GRAFIK[ad] = new Chart($(secici), cfg);
}
function eksenPara(v) { return `${v < 0 ? "−" : ""}${PARA === "TL" ? "₺" : "$"}${nf(0, 0).format(Math.abs(v))}`; }
function eksen() {
  return { grid: { color: "rgba(255,255,255,0.05)", drawTicks: false }, border: { display: false },
    ticks: { color: css("--text-3"), padding: 8, font: { size: 11 } } };
}
const sifirCizgisi = { id: "sifir", beforeDatasetsDraw(ch) {
  const y = ch.scales.y.getPixelForValue(0), { left, right, top, bottom } = ch.chartArea, c = ch.ctx;
  if (y < top || y > bottom) return;
  c.save(); c.strokeStyle = "rgba(255,255,255,0.22)"; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(left, y); c.lineTo(right, y); c.stroke(); c.restore();
} };
/** P&L line in the overview style: blue fill above zero, red below */
function kzCizgi(ad, secici, etiketler, degerler, { isaretli = null, ipucu = null } = {}) {
  const az = degerler.length <= 14;
  const cfg = {
    type: "line",
    data: { labels: etiketler, datasets: [{ data: degerler, borderColor: css("--accent"), borderWidth: 2, tension: 0.25,
      pointRadius: degerler.map((_, i) => (i === isaretli ? 6 : az ? 3 : 0)), pointHoverRadius: 5,
      pointBackgroundColor: degerler.map((_, i) => (i === isaretli ? "#fff" : css("--accent"))),
      pointBorderColor: css("--panel"), pointBorderWidth: 2,
      fill: { target: "origin", above: "rgba(63,142,240,0.14)", below: "rgba(236,93,93,0.14)" } }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      scales: { x: { ...eksen(), grid: { display: false }, ticks: { ...eksen().ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { ...eksen(), ticks: { ...eksen().ticks, callback: eksenPara, maxTicksLimit: 6 } } },
      plugins: { legend: { display: false }, tooltip: { displayColors: false, bodyColor: "#fff", titleColor: css("--text-2"),
        callbacks: { label: ipucu || ((c) => `P&L: ${paraHam(c.raw, { isaret: true })}`) } } } },
    plugins: [sifirCizgisi],
  };
  grafikKur(ad, secici, cfg);
}
function sifirdanBaslat(noktalar) {
  if (!noktalar.length || Math.abs(noktalar[0][1]) < 0.01) return noktalar;
  const ilk = noktalar[0][0], once = new Date(new Date(ilk + "T00:00:00").getTime() - 43200000).toISOString().slice(0, 10);
  return [[once, 0]].concat(noktalar);
}
function aralikKes(noktalar, gun) {
  if (!gun) return noktalar;
  const sinir = gunEkle(-gun);
  return noktalar.filter((p) => p[0] >= sinir);
}
function donutCiz(ad, secici, veri) {
  const toplam = veri.reduce((t, x) => t + x.deger, 0);
  grafikKur(ad, secici, {
    type: "doughnut",
    data: { labels: veri.map((x) => x.ad), datasets: [{ data: veri.map((x) => x.deger), backgroundColor: veri.map((x) => x.renk),
      borderColor: css("--panel"), borderWidth: 2, hoverOffset: 4, borderRadius: 3 }] },
    options: { cutout: "72%", responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${para(c.raw)} (${nf(1, 1).format((c.raw / toplam) * 100)}%)` } } } },
  });
  return toplam;
}
const lejantHTML = (veri, toplam) => veri.length ? veri.map((x) => `
  <div class="lejant-satir"><span class="nokta" style="background:${x.renk}"></span>
    <span class="ad">${esc(x.ad)}</span><span class="num">${para(x.deger)}</span>
    <span class="yuzde num">${nf(1, 1).format((x.deger / toplam) * 100)}%</span></div>`).join("") : `<div class="etiket">No holdings yet.</div>`;
function renklendir(liste) {
  liste.sort((a, b) => b.deger - a.deger);
  let l = liste;
  if (liste.length > 8) { l = liste.slice(0, 7); l.push({ ad: "Other", deger: liste.slice(7).reduce((t, x) => t + x.deger, 0), diger: true }); }
  return l.map((x, i) => ({ ...x, renk: x.diger ? DIGER : KATEGORIK[i] }));
}

// ================================================================== OVERVIEW
function anaEkran() {
  const ay = D.ayarlar, p = D.performans || {};
  $("#k-toplam").textContent = para(D.toplam);
  $("#k-toplam-alt").textContent = ay.baslangic_bakiye ? `Start ${para(ay.baslangic_bakiye, { kurla: ay.baslangic_usdtry })} · ${tarihTR(ay.baslangic_tarihi, true)}` : "";
  kpiKz();
  $("#k-nakit").textContent = para(D.nakit);
  $("#k-nakit-alt").textContent = D.toplam ? `${nf(0, 1).format((D.nakit / D.toplam) * 100)}% of portfolio` : "";

  let veri;
  if (DAGILIM === "sinif") {
    const r = SINIF_RENK();
    veri = ["nakit", "kripto", "hisse", "opsiyon"].filter((k) => D.sinif[k] > 0.005).map((k) => ({ ad: SINIF_AD[k], deger: D.sinif[k], renk: r[k] }));
  } else {
    veri = renklendir([{ ad: "Cash", deger: D.nakit }].concat(D.varliklar.filter((v) => v.acik && v.deger > 0).map((v) => ({ ad: v.ad, deger: v.deger }))).filter((x) => x.deger > 0.005));
  }
  const toplam = donutCiz("donut", "#donut", veri);
  $("#donut-toplam").textContent = para(toplam);
  $("#lejant").innerHTML = lejantHTML(veri, toplam);

  let s = kzSerisi().map((r) => [r.tarih, r.kz]);
  s = aralikKes(s, ARALIK.ana);
  if (!ARALIK.ana) s = [["Start", 0]].concat(s);
  kzCizgi("kz", "#kz-grafik", s.map((q) => (q[0] === "Start" ? q[0] : tarihTR(q[0]))), s.map((q) => q[1]));

  const hucre = (ad, o) => `<div><span class="etiket">${ad}</span><b class="${o ? isaretSinif(o.kz) : ""}">${o ? yuzde(o.yuzde) : "—"}</b>
      <div class="alt-yazi num">${o ? para(o.kz, { isaret: true }) : ""}</div></div>`;
  const top = p.toplam_kz !== undefined ? { kz: p.toplam_kz, yuzde: p.toplam_yuzde } : null;
  $("#donem").innerHTML = hucre("Daily", p.gunluk) + hucre("Weekly", p.haftalik) + hucre("Monthly", p.aylik) + hucre("Total", top);
  const satir = (a, b, sn = "") => `<div class="liste-satir"><span class="etiket">${a}</span><span class="num ${sn}">${b}</span></div>`;
  $("#risk").innerHTML = satir("Peak balance", para(p.en_yuksek_bakiye)) +
    satir("Max drawdown (from peak)", p.maks_dusus !== undefined ? `${nf(2, 2).format(p.maks_dusus)}%` : "—", p.maks_dusus > 0 ? "neg" : "") +
    satir("Starting balance", para(ay.baslangic_bakiye, { kurla: ay.baslangic_usdtry })) +
    satir("Net deposits / withdrawals", para(D.net_yatirim, { isaret: true }));

  gunIciGrafik();
  katkiGrafik();
}
function kpiKz() {
  const s = kzSerisi(), son = s[s.length - 1];
  const kz = son ? son.kz : null;
  const el = $("#k-kz"); el.textContent = kz === null ? "—" : paraHam(kz, { isaret: true }); el.className = "buyuk " + isaretSinif(kz);
  const bas = baslangicToplam();
  $("#k-kz-alt").textContent = kz !== null && bas ? `${yuzde((kz / bas) * 100)} since start` : "";
  const g = gunlukDegisim()[D.bugun];
  const b = $("#k-bugun"); b.textContent = g ? paraHam(g.kz, { isaret: true }) : "—"; b.className = "buyuk " + (g ? isaretSinif(g.kz) : "");
  $("#k-bugun-alt").textContent = g && g.yuzde !== null ? yuzde(g.yuzde) : "No entry for today yet";
}
function bosGoster(kanvasSec, metin) {
  const cv = $(kanvasSec), kap = cv.parentElement;
  let bos = kap.querySelector(".bos-durum");
  if (metin) {
    if (!bos) { bos = document.createElement("div"); bos.className = "bos-durum"; kap.appendChild(bos); }
    bos.textContent = metin; cv.style.display = "none"; return true;
  }
  if (bos) bos.remove();
  cv.style.display = "block"; return false;
}
function gunIciGrafik() {
  const n = (D.gun_ici || []).filter((x) => x.kz !== null && x.zaman.slice(0, 10) === D.bugun);
  $("#gun-ici-not").textContent = n.length ? `${n.length} ${n.length === 1 ? "sample" : "samples"} · every 2 min while the panel is open` : "";
  if (bosGoster("#gun-ici-grafik", n.length < 2 ? "Today's P&L is drawn here while the panel stays open." : null)) {
    if (GRAFIK.gunici) { GRAFIK.gunici.destroy(); delete GRAFIK.gunici; }
    return;
  }
  // baseline is yesterday's closing P&L → chart shows today's change
  const s = D.seri.filter((r) => r.tarih < D.bugun);
  const taban = s.length ? s[s.length - 1].kz : 0;
  kzCizgi("gunici", "#gun-ici-grafik", n.map((x) => x.zaman.slice(11, 16)), n.map((x) => cevir(x.kz - taban)),
    { ipucu: (c) => `Today: ${paraHam(c.raw, { isaret: true })}` });
}
function katkiGrafik() {
  const veri = (D.katki[KATKI] || []).slice().sort((a, b) => b.kz - a.kz);
  if (bosGoster("#katki-grafik", veri.length ? null : "No change in this period yet.")) {
    if (GRAFIK.katki) { GRAFIK.katki.destroy(); delete GRAFIK.katki; }
    return;
  }
  $("#katki-grafik").parentElement.style.height = Math.max(160, veri.length * 34 + 40) + "px";
  const d = veri.map((x) => cevir(x.kz));
  grafikKur("katki", "#katki-grafik", {
    type: "bar",
    data: { labels: veri.map((x) => x.ad), datasets: [{ data: d, backgroundColor: d.map((x) => (x >= 0 ? css("--pos") : css("--neg"))),
      borderRadius: 4, borderSkipped: false, barThickness: 16 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      scales: { x: { ...eksen(), ticks: { ...eksen().ticks, callback: eksenPara, maxTicksLimit: 6 } },
        y: { ...eksen(), grid: { display: false }, ticks: { ...eksen().ticks, color: css("--text-2"), font: { size: 12 } } } },
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: (c) => paraHam(c.raw, { isaret: true }) } } } },
  });
}

// ================================================================== HOLDINGS
function sinifOzeti(sinif) {
  const l = D.varliklar.filter((v) => v.acik && v.sinif === sinif);
  const deger = l.reduce((t, v) => t + (v.deger || 0), 0);
  const seri = D.sinif_seri[sinif] || [];
  const kz = seri.length ? seri[seri.length - 1][1] : 0;
  const onceki = seri.filter((p) => p[0] < D.bugun);
  const bugun = seri.length && seri[seri.length - 1][0] === D.bugun ? kz - (onceki.length ? onceki[onceki.length - 1][1] : 0) : 0;
  return { l, deger, kz, bugun, sayi: l.length };
}

function varliklarSayfasi() {
  const r = SINIF_RENK();
  $("#v-ozet").innerHTML = ["kripto", "hisse", "opsiyon"].map((s) => {
    const o = sinifOzeti(s);
    return `<div class="kart tiklanir ${s === VSINIF ? "secili" : ""}" data-sinif-git="${s}">
      <div class="etiket"><span class="nokta" style="display:inline-block;background:${r[s]};margin-right:6px"></span>${SINIF_AD[s]} · ${o.sayi} ${o.sayi === 1 ? "position" : "positions"}</div>
      <div class="buyuk" data-canli="sinif-${s}">${para(o.deger)}</div>
      <div class="alt-yazi ${isaretSinif(o.kz)}" data-canli="sinif-kz-${s}">${o.kz ? para(o.kz, { isaret: true }) + " since first buy" : "—"}</div></div>`;
  }).join("") + `<div class="kart tiklanir" data-nakit-gecmis="1"><div class="etiket"><span class="nokta" style="display:inline-block;background:${r.nakit};margin-right:6px"></span>Cash</div>
    <div class="buyuk">${para(D.nakit)}</div><div class="alt-yazi">Click for deposit/withdrawal history</div></div>`;

  $$("#v-alt-sekmeler button").forEach((b) => b.classList.toggle("aktif", b.dataset.sinif === VSINIF));
  $("#sinif-ekle-btn").textContent = `+ Add ${SINIF_TEK[VSINIF]}`;

  const o = sinifOzeti(VSINIF);
  const kapali = D.varliklar.filter((v) => !v.acik && v.sinif === VSINIF);
  $("#v-icerik").innerHTML = `
    <div class="izgara k4">
      <div class="kart"><div class="etiket">${SINIF_AD[VSINIF]} value</div><div class="buyuk" data-canli="sk-deger">${para(o.deger)}</div><div class="alt-yazi">${o.sayi} open ${o.sayi === 1 ? "position" : "positions"}</div></div>
      <div class="kart"><div class="etiket">P&amp;L (since first buy)</div><div class="buyuk ${isaretSinif(o.kz)}" data-canli="sk-kz">${para(o.kz, { isaret: true })}</div><div class="alt-yazi">Realized + open positions</div></div>
      <div class="kart"><div class="etiket">Today</div><div class="buyuk ${isaretSinif(o.bugun)}" data-canli="sk-bugun">${para(o.bugun, { isaret: true })}</div><div class="alt-yazi">vs. yesterday's close</div></div>
      <div class="kart"><div class="etiket">Share of portfolio</div><div class="buyuk">${D.toplam ? nf(1, 1).format((o.deger / D.toplam) * 100) : "0"}%</div><div class="alt-yazi">Total ${para(D.toplam)}</div></div>
    </div>
    <div class="bosluk"></div>
    <div class="izgara k-ana">
      <div class="kart"><div class="kart-bas"><h3>Allocation</h3></div>
        <div class="dagilim"><div class="donut-kap"><canvas id="s-donut"></canvas>
          <div class="donut-merkez"><div><div class="etiket">${SINIF_AD[VSINIF]}</div><div class="orta">${para(o.deger)}</div></div></div></div>
          <div class="lejant" id="s-lejant"></div></div></div>
      <div class="kart"><div class="kart-bas"><h3>${SINIF_AD[VSINIF]} P&amp;L</h3>
          <div class="secim aralik" data-hedef="sinif">${[["7", "1W"], ["30", "1M"], ["90", "3M"], ["0", "All"]].map(([g, a]) => `<button data-g="${g}" class="${+g === ARALIK.sinif ? "aktif" : ""}">${a}</button>`).join("")}</div></div>
        <div class="grafik-kap"><canvas id="sinif-grafik"></canvas></div></div>
    </div>
    <div class="ara-ust" style="margin-top:22px"><h2>Positions</h2></div>
    ${o.l.length ? `<div class="kart-izgara">${o.l.sort((a, b) => (b.deger || 0) - (a.deger || 0)).map(varlikKarti).join("")}</div>`
      : `<div class="bos-durum">No ${SINIF_TEK[VSINIF]} positions yet. Start with <b>+ Add ${SINIF_TEK[VSINIF]}</b>.</div>`}
    ${kapali.length ? `<details class="kapali-poz"><summary>Closed ${SINIF_TEK[VSINIF]} positions (${kapali.length})</summary>
      <div class="kart"><table class="tablo"><thead><tr><th>Asset</th><th>First buy</th><th>Last trade</th><th class="sag-hiza">Realized P&amp;L</th><th></th></tr></thead><tbody>
      ${kapali.map((v) => { const isl = D.islemler.filter((i) => i.varlik_id === v.id).map((i) => i.tarih).sort();
        return `<tr><td>${esc(v.ad)}</td><td>${isl.length ? tarihTR(isl[0], true) : "—"}</td><td>${isl.length ? tarihTR(isl[isl.length - 1], true) : "—"}</td>
        <td class="sag-hiza num ${isaretSinif(v.gerceklesen)}">${para(v.gerceklesen, { isaret: true })}</td>
        <td class="sag-hiza"><button class="btn kucuk" data-detay="${v.id}">History</button></td></tr>`; }).join("")}
      </tbody></table></div></details>` : ""}`;

  const veri = renklendir(o.l.filter((v) => v.deger > 0).map((v) => ({ ad: v.ad, deger: v.deger })));
  const t = donutCiz("sdonut", "#s-donut", veri);
  $("#s-lejant").innerHTML = lejantHTML(veri, t);
  const s = aralikKes(sifirdanBaslat(D.sinif_seri[VSINIF] || []), ARALIK.sinif);
  if (!bosGoster("#sinif-grafik", s.length ? null : `No ${SINIF_TEK[VSINIF]} buys yet.`)) {
    kzCizgi("sinif", "#sinif-grafik", s.map((p) => tarihTR(p[0])), s.map((p) => cevir(p[1])));
  }
}

function uzatilmisHTML(sembol, regular) {
  const u = D.uzatilmis && D.uzatilmis[sembol];
  const seans = piyasaDurumu().seans;
  if (!u || !u.fiyat || seans === "acik" || !regular || Math.abs(u.fiyat / regular - 1) < 0.0001) return "";
  const etiket = seans === "oncesi" ? "Pre-market" : seans === "sonrasi" ? "After hours" : "Last extended";
  const fark = (u.fiyat / regular - 1) * 100;
  return `<div class="uzatilmis-satir"><span class="rozet uyari">${etiket}</span><b class="num">${fiyatYaz(u.fiyat)}</b><span class="num ${isaretSinif(fark)}">${yuzde(fark)}</span></div>`;
}

function varlikKarti(v) {
  const pay = D.toplam ? ((v.deger || 0) / D.toplam) * 100 : 0;
  const kaynak = v.fiyat_kaynagi === "elle" ? ` <span class="rozet uyari" title="Manually entered price">manual</span>` :
    v.fiyat_kaynagi === "maliyet" ? ` <span class="rozet uyari" title="No live price, valued at cost">at cost</span>` : "";
  const kot = kotasyonUyari(v);
  const canli = v.sinif === "kripto" && CANLI[v.sembol] ? `<span class="canli-isaret" title="Live (OKX)"></span>` : "";
  let alt;
  if (v.sinif === "opsiyon") {
    const o = v.opsiyon, gun = gunFarki(o.vade);
    alt = `${o.tur === "put" ? "Put" : "Call"} · ${nf(0, 2).format(o.strike)} · ${tarihTR(o.vade)} · <b class="${gun <= 14 ? "neg" : ""}">${gun} days</b>`;
  } else alt = esc(v.sembol);
  const hedefGeldi = (v.kar_al_durum || []).some((h) => h.geldi && !h.tamam);
  const tp = (v.kar_al_durum || []).map((h) => {
    const etiket = h.tip === "kat" ? `${nf(0, 2).format(h.deger)}x` : fiyatYaz(h.deger);
    const durum = h.tamam ? `<span class="rozet">done</span>` : h.geldi ? `<span><span class="rozet uyari">target hit</span> <button class="btn kucuk ana" data-tp-sat="${v.id}|${h.id}">I sold</button></span>` :
      `<span>${h.ilerleme !== null && h.ilerleme !== undefined ? nf(0, 0).format(h.ilerleme * 100) + "%" : ""}</span>`;
    return `<div class="hedef"><div class="hedef-ust"><span>Take profit ${etiket} → ${fiyatYaz(h.hedef_fiyat)} · sell ${nf(0, 0).format(h.yuzde)}%</span>${durum}</div>
      <div class="cubuk ${h.tamam || h.geldi ? "tamam" : ""}"><i style="width:${(h.tamam ? 1 : h.ilerleme || 0) * 100}%"></i></div></div>`;
  }).join("");
  const kd = v.kademeli_durum && v.kademeli_durum.seviyeler.length ? `
    <div class="hedef"><div class="hedef-ust"><span>Scaled buys · ${para(v.kademeli_durum.toplam_tutar)}</span><span>avg ${fiyatYaz(v.kademeli_durum.ort_maliyet)}</span></div>
    <div class="kademe">${v.kademeli_durum.seviyeler.map((k) => k.tamam ? `<span class="rozet">${fiyatYaz(k.fiyat)} ✓</span>` :
      k.geldi ? `<span class="rozet uyari">${fiyatYaz(k.fiyat)} hit</span><button class="btn kucuk ana" data-kd-al="${v.id}|${k.id}">I bought</button>` :
      `<span class="rozet">${fiyatYaz(k.fiyat)} · ${para(k.tutar)}</span>`).join("")}</div></div>` : "";
  const sag = v.sinif === "opsiyon" ? `<div><span>Underlying</span><b class="num">${fiyatYaz(v.dayanak_fiyat)}</b></div>` :
    `<div><span>Daily</span><b class="num ${isaretSinif(v.gunluk_yuzde)}" data-canli="gun-${v.id}">${yuzde(v.gunluk_yuzde)}</b></div>`;
  return `<div class="vkart ${hedefGeldi ? "vurgu" : ""}" data-detay="${v.id}">
    <div class="vkart-bas"><div><div class="vkart-ad">${esc(v.ad)}${kaynak}${kot ? ` <span class="rozet uyari" title="${esc(kot)}">unreliable price</span>` : ""}${canli}</div><div class="vkart-sembol">${alt}</div></div>
      <button class="menu-btn" data-menu="${v.id}" aria-label="Options">⋯</button></div>
    <div class="vkart-deger"><span class="orta" data-canli="deger-${v.id}">${para(v.deger)}</span>
      <span class="rozet ${isaretSinif(v.kz)}" data-canli="kz-${v.id}">${para(v.kz, { isaret: true })} · ${yuzde(v.kz_yuzde)}</span></div>
    <div class="mini">
      <div><span>${ETIKET[v.sinif].kisa}</span><b class="num">${miktarYaz(v.miktar)}</b></div>
      <div><span>${v.sinif === "opsiyon" ? "Current premium" : "Current"}</span><b class="num" data-canli="fiyat-${v.id}">${fiyatYaz(v.fiyat)}</b></div>
      <div><span>${v.sinif === "opsiyon" ? "Avg premium" : "Avg cost"}</span><b class="num">${fiyatYaz(v.ort_maliyet)}</b></div>
      ${sag}
      <div><span>Cost</span><b class="num">${para(v.maliyet)}</b></div>
      <div><span>Portfolio share</span><b class="num">${nf(1, 1).format(pay)}%</b></div>
    </div>
    ${v.sinif === "hisse" ? uzatilmisHTML(v.sembol, v.fiyat) : ""}
    ${tp || kd ? `<div class="cizgi"></div>${tp}${kd}` : ""}
    ${v.not ? `<div class="alt-yazi" style="margin-top:8px">${esc(v.not)}</div>` : ""}
  </div>`;
}

/** Returns an explanation if the option price looks unreliable, else null. */
function kotasyonUyari(v) {
  const k = v.kotasyon;
  if (!k || k.durum === "iyi") return null;
  if (k.durum === "genis") return `Bid ${fiyatYaz(k.alis)} / ask ${fiyatYaz(k.satis)}: spread ${nf(0, 0).format(((k.satis - k.alis) / k.fiyat) * 100)}%. Valued at mid; a real sale would fill closer to the bid.`;
  if (k.durum === "alis_yok") return `No bid (0). Valued at the last trade price (${fiyatYaz(k.son)}), which may be stale.`;
  return `No bid/ask quote. Valued at the last trade price (${fiyatYaz(k.son)}), which may be stale.`;
}

function varlikMenusu(id, dugme) {
  kapatAcilir();
  const v = D.varliklar.find((x) => x.id === id);
  const m = document.createElement("div"); m.className = "acilir";
  const sec = [["detay", "Details and chart"], ["al", "Add buy"], ["sat", "Sell"], ["karal", "Take-profit targets"], ["kademeli", "Scaled buy plan"],
    ["elle", v.sinif === "opsiyon" ? "Enter premium manually" : "Enter price manually"], ["paylas", "Share card"], ["duzenle", "Edit"], ["sil", "Delete"]];
  if (v.sinif === "opsiyon") sec.splice(1, 0, ["senaryo", "Open in calculator"]);
  m.innerHTML = sec.map(([k, a]) => `<button data-islem="${k}" class="${k === "sil" ? "tehlike" : ""}">${a}</button>`).join("");
  dugme.closest(".vkart").appendChild(m);
  m.addEventListener("click", (e) => { e.stopPropagation(); const k = e.target.dataset.islem; if (!k) return; kapatAcilir(); varlikIslemi(v, k); });
}
function varlikIslemi(v, k) {
  ({ detay: () => cekmeceAc("varlik", v.id), al: () => alimModal(v), sat: () => satisModal(v), karal: () => karAlModal(v),
    kademeli: () => kademeliModal(v, "varlik"), elle: () => elleFiyatModal(v), duzenle: () => duzenleModal(v), sil: () => silModal(v),
    senaryo: () => senaryoyaYukle(v), paylas: () => paylasimModal(v) })[k]();
}
function kapatAcilir() { $$(".acilir").forEach((x) => x.remove()); }

// ================================================================== DRAWER (detail panel)
function cekmeceAc(tur, id) {
  if (LW) { LW.chart.remove(); LW = null; }
  CEKMECE = { tur, id };
  $("#cekmece").classList.add("acik"); $("#cekmece-perde").classList.add("acik");
  $("#cekmece").scrollTop = 0;
  cekmeceYenile();
}
function cekmeceKapat() {
  CEKMECE = null; $("#cekmece").classList.remove("acik"); $("#cekmece-perde").classList.remove("acik");
  if (LW) { LW.chart.remove(); LW = null; }
  if (GRAFIK.varlikkz) { GRAFIK.varlikkz.destroy(); delete GRAFIK.varlikkz; }
}
function cekmeceYenile() {
  if (!CEKMECE) return;
  const c = $("#cekmece"), kaydir = c.scrollTop;
  if (LW) { LW.chart.remove(); LW = null; }
  if (CEKMECE.tur === "varlik") {
    const v = D.varliklar.find((x) => x.id === CEKMECE.id);
    if (!v) return cekmeceKapat();
    const isl = D.islemler.filter((i) => i.varlik_id === v.id);
    const opsiyon = v.sinif === "opsiyon";
    const dugmeler = [["al", "Add buy"], ["sat", "Sell"], ["karal", "Take profit"], ["kademeli", "Scaled buys"], ["elle", opsiyon ? "Set premium" : "Set price"], ["paylas", "Share"], ["duzenle", "Edit"]];
    const kot = opsiyon && v.acik ? v.kotasyon : null, kotU = opsiyon ? kotasyonUyari(v) : null;
    if (opsiyon) dugmeler.unshift(["senaryo", "Open in calculator"]);
    const tp = (v.kar_al_durum || []), kd = (v.kademeli_durum || {}).seviyeler || [];
    c.innerHTML = `
      <div class="cekmece-bas"><div><div class="etiket">${SINIF_AD[v.sinif]}${v.acik ? "" : " · closed"}</div><h2>${esc(v.ad)}</h2>
        <div class="vkart-sembol">${opsiyon ? `${v.opsiyon.tur === "put" ? "Put" : "Call"} · ${nf(0, 2).format(v.opsiyon.strike)} · ${tarihTR(v.opsiyon.vade, true)} · ${gunFarki(v.opsiyon.vade)} days` : esc(v.sembol)}</div></div>
        <button class="ikon-btn" data-cekmece-kapat aria-label="Close">✕</button></div>
      <div class="vkart-deger"><span class="buyuk">${v.acik ? para(v.deger) : para(v.gerceklesen, { isaret: true })}</span>
        ${v.acik ? `<span class="rozet ${isaretSinif(v.kz)}">${para(v.kz, { isaret: true })} · ${yuzde(v.kz_yuzde)}</span>` : `<span class="etiket">realized P&amp;L</span>`}</div>
      ${v.acik ? `<div class="mini"><div><span>${ETIKET[v.sinif].kisa}</span><b class="num">${miktarYaz(v.miktar)}</b></div><div><span>Current</span><b class="num">${fiyatYaz(v.fiyat)}</b></div>
        <div><span>Avg cost</span><b class="num">${fiyatYaz(v.ort_maliyet)}</b></div><div><span>Realized</span><b class="num ${isaretSinif(v.gerceklesen)}">${para(v.gerceklesen, { isaret: true })}</b></div>
        ${opsiyon ? `<div><span>Underlying</span><b class="num">${fiyatYaz(v.dayanak_fiyat)}</b></div><div><span>Multiple</span><b class="num">${v.ort_maliyet ? nf(2, 2).format(v.fiyat / v.ort_maliyet) + "x" : "—"}</b></div>` : ""}</div>` : ""}
      ${kot ? `<div class="mini" style="margin-top:8px"><div><span>Bid</span><b class="num">${fiyatYaz(kot.alis)}</b></div><div><span>Ask</span><b class="num">${fiyatYaz(kot.satis)}</b></div>
        <div><span>Last trade</span><b class="num">${fiyatYaz(kot.son)}</b></div><div><span>Spread</span><b class="num">${kot.alis > 0 && kot.satis > 0 ? nf(0, 1).format(((kot.satis - kot.alis) / kot.fiyat) * 100) + "%" : "—"}</b></div></div>` : ""}
      ${kotU ? `<div class="uyari-serit" style="display:block;margin:10px 0 0">${esc(kotU)}</div>` : ""}
      ${v.sinif === "hisse" ? uzatilmisHTML(v.sembol, v.fiyat) : ""}
      ${v.acik ? `<div class="btnlar" style="margin-top:14px">${dugmeler.map(([k, a]) => `<button class="btn kucuk ${k === "senaryo" ? "ana" : ""}" data-cekmece-islem="${k}">${a}</button>`).join("")}</div>` : ""}
      <div class="bolum"><h4>P&amp;L (since first buy)</h4><div class="grafik-kap kisa"><canvas id="varlik-kz"></canvas></div></div>
      ${opsiyon ? "" : `<div class="bolum">${lwBaslik()}<div class="lw-kap" id="lw-kap"><div class="bos-durum" style="border:0">Loading…</div></div>
        <div class="lejant-cizgi"><span><i style="border-color:#f0efec"></i>Avg cost</span><span><i style="border-color:${css("--warn")}"></i>Take profit</span>
        <span><i style="border-color:${css("--accent")}"></i>Scaled buy</span><span>▲ buy · ▼ sell</span></div></div>`}
      ${v.acik && (tp.length || kd.length) ? `<div class="bolum"><h4>Plans</h4>
        ${tp.map((h) => `<div class="liste-satir"><span>Take profit ${h.tip === "kat" ? nf(0, 2).format(h.deger) + "x" : ""} → ${fiyatYaz(h.hedef_fiyat)} · ${nf(0, 0).format(h.yuzde)}%</span>
          <span>${h.tamam ? '<span class="rozet">done</span>' : h.geldi ? `<button class="btn kucuk ana" data-tp-sat="${v.id}|${h.id}">I sold</button>` : `<span class="etiket">${nf(0, 0).format((h.ilerleme || 0) * 100)}%</span>`}</span></div>`).join("")}
        ${kd.map((k) => `<div class="liste-satir"><span>Level ${fiyatYaz(k.fiyat)} · ${para(k.tutar)}</span>
          <span>${k.tamam ? '<span class="rozet">bought</span>' : k.geldi ? `<button class="btn kucuk ana" data-kd-al="${v.id}|${k.id}">I bought</button>` : `<span class="etiket">${k.uzaklik !== null && k.uzaklik !== undefined ? nf(1, 1).format(k.uzaklik) + "% away" : ""}</span>`}</span></div>`).join("")}</div>` : ""}
      <div class="bolum"><h4>Trade history</h4>
        <table class="tablo"><thead><tr><th>Date</th><th>Type</th><th class="sag-hiza">Quantity</th><th class="sag-hiza">Price</th><th class="sag-hiza">Amount</th><th></th></tr></thead><tbody>
        ${isl.map((i) => { const t = i.miktar * i.fiyat * (opsiyon ? 100 : 1);
          return `<tr><td>${tarihTR(i.tarih, true)}</td><td>${i.tip === "al" ? "Buy" : "Sell"}${i.nakit_etkisi === false ? ' <span class="rozet">initial</span>' : ""}${i.otomatik ? ' <span class="rozet">expiry</span>' : ""}</td>
          <td class="sag-hiza num">${miktarYaz(i.miktar)}</td><td class="sag-hiza num">${fiyatYaz(i.fiyat)}</td><td class="sag-hiza num">${para(t)}</td>
          <td class="sag-hiza"><button class="btn kucuk tehlike" data-islem-sil="${i.id}">Delete</button></td></tr>`; }).join("")}</tbody></table></div>
      <div class="bolum"><button class="btn kucuk tehlike" data-cekmece-islem="sil">Delete asset and its trades</button></div>`;
    const s = sifirdanBaslat(D.varlik_seri[v.id] || []);
    if (!bosGoster("#varlik-kz", s.length ? null : "No data yet.")) kzCizgi("varlikkz", "#varlik-kz", s.map((p) => tarihTR(p[0])), s.map((p) => cevir(p[1])));
    if (!opsiyon) fiyatGrafigi(v.sembol, { islemler: isl, ort: v.acik ? v.ort_maliyet : null, karAl: v.acik ? tp : [], kademe: v.acik ? kd : [], kripto: v.sinif === "kripto" });
  } else {
    const w = D.izleme.find((x) => x.id === CEKMECE.id);
    if (!w) return cekmeceKapat();
    const f = (w.sinif === "kripto" && CANLI[w.sembol]) || w.fiyat;
    c.innerHTML = `
      <div class="cekmece-bas"><div><div class="etiket">Watchlist · ${SINIF_AD[w.sinif]}</div><h2>${esc(w.ad)}</h2><div class="vkart-sembol">${esc(w.sembol)}</div></div>
        <button class="ikon-btn" data-cekmece-kapat aria-label="Close">✕</button></div>
      <div class="vkart-deger"><span class="buyuk">${fiyatYaz(f)}</span><span class="rozet ${isaretSinif(w.gunluk_yuzde)}">${yuzde(w.gunluk_yuzde)} today</span></div>
      ${w.sinif === "hisse" ? uzatilmisHTML(w.sembol, w.fiyat) : ""}
      ${w.hedef_fiyat ? `<div class="mini"><div><span>Target buy</span><b class="num">${fiyatYaz(w.hedef_fiyat)}</b></div><div><span>To target</span><b class="num">${f ? (f <= w.hedef_fiyat ? "at target" : nf(1, 1).format((f / w.hedef_fiyat - 1) * 100) + "% above") : "—"}</b></div>
        ${w.eklenme ? `<div><span>Added</span><b class="num">${tarihTR(w.eklenme.slice(0, 10), true)}</b></div>` : ""}</div>` : ""}
      ${w.aciklama ? `<p style="margin-top:12px;color:var(--text-2);white-space:pre-wrap">${esc(w.aciklama)}</p>` : ""}
      <div class="btnlar" style="margin-top:12px"><button class="btn kucuk ana" data-aldim="${w.id}">I bought</button><button class="btn kucuk" data-izleme-plan="${w.id}">Scaled buys</button>
        <button class="btn kucuk" data-izleme-duzenle="${w.id}">Edit</button><button class="btn kucuk tehlike" data-izleme-sil="${w.id}">Delete</button></div>
      <div class="bolum">${lwBaslik()}<div class="lw-kap" id="lw-kap"><div class="bos-durum" style="border:0">Loading…</div></div>
        <div class="lejant-cizgi"><span><i style="border-color:${css("--pos")}"></i>Target buy</span><span><i style="border-color:${css("--accent")}"></i>Scaled buy</span></div></div>`;
    fiyatGrafigi(w.sembol, { hedef: w.hedef_fiyat, kademe: ((w.kademeli_durum || {}).seviyeler || []), kripto: w.sinif === "kripto" });
  }
  c.scrollTop = kaydir;
}

let LW_ARALIK = yerelOku("lw_aralik") === "1w" ? "1w" : "1d";
let LW_SECENEK = null;
const lwBaslik = () => `<div class="kart-bas" style="margin-bottom:10px"><h4 style="margin:0">Price chart <span class="etiket" id="lw-kaynak"></span></h4>
  <div class="secim kucuk-secim" id="lw-aralik"><button data-lw="1d" class="${LW_ARALIK === "1d" ? "aktif" : ""}">Daily</button><button data-lw="1w" class="${LW_ARALIK === "1w" ? "aktif" : ""}">Weekly</button></div></div>`;

async function fiyatGrafigi(sembol, secenek = {}) {
  const { islemler = [], ort = null, karAl = [], kademe = [], hedef = null, kripto = false } = secenek;
  LW_SECENEK = { sembol, secenek };
  const kap = $("#lw-kap");
  if (!kap) return;
  if (typeof LightweightCharts === "undefined") { kap.innerHTML = `<div class="bos-durum" style="border:0">Chart library failed to load.</div>`; return; }
  const istek = CEKMECE && CEKMECE.id, aralik = LW_ARALIK;
  const getir = (once) => api("GET", `/api/mum?sembol=${encodeURIComponent(sembol)}&aralik=${aralik}${once ? "&once=" + once : ""}`)
    .catch(() => ({ mumlar: [], kaynak: "", daha_var: false }));
  const ilk = await getir(null);
  let mumlar = ilk.mumlar || [];
  const kap2 = $("#lw-kap");
  if (!kap2 || !CEKMECE || CEKMECE.id !== istek || aralik !== LW_ARALIK) return;
  if (!mumlar.length) { kap2.innerHTML = `<div class="bos-durum" style="border:0">Could not load price history for ${esc(sembol)}.</div>`; return; }
  const kaynakYaz = (k, ilkTarih) => { const e = $("#lw-kaynak"); if (e) e.textContent = `· ${k} · from ${tarihTR(ilkTarih, true)}`; };
  kaynakYaz(ilk.kaynak, mumlar[0].time);
  kap2.innerHTML = "";
  if (LW) { LW.chart.remove(); LW = null; }
  const chart = LightweightCharts.createChart(kap2, {
    autoSize: true, layout: { background: { color: css("--panel") }, textColor: css("--text-2"), fontSize: 11 },
    grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
    rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, crosshair: { mode: 0 },
    localization: { locale: "en-US", priceFormatter: (x) => fiyatYaz(x) },
  });
  const seri = chart.addCandlestickSeries({ upColor: css("--pos"), downColor: css("--neg"), borderVisible: false,
    wickUpColor: css("--pos"), wickDownColor: css("--neg") });
  const isaretKoy = () => {
    const bas = mumlar[0].time;
    const enYakin = (t) => { let son = mumlar[0].time; for (const m of mumlar) { if (m.time <= t) son = m.time; else break; } return son; };
    seri.setMarkers(islemler.filter((i) => i.tarih >= bas).sort((a, b) => a.tarih.localeCompare(b.tarih)).map((i) => ({
      time: enYakin(i.tarih), position: i.tip === "al" ? "belowBar" : "aboveBar", color: i.tip === "al" ? css("--pos") : css("--neg"),
      shape: i.tip === "al" ? "arrowUp" : "arrowDown", text: `${i.tip === "al" ? "Buy" : "Sell"} ${fiyatYaz(i.fiyat)}`,
    })));
  };
  seri.setData(mumlar); isaretKoy();
  const cizgi = (fiyat, renk, baslik) => fiyat && seri.createPriceLine({ price: fiyat, color: renk, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: baslik });
  cizgi(ort, "#f0efec", "Avg cost");
  (karAl || []).filter((h) => !h.tamam).forEach((h) => cizgi(h.hedef_fiyat, css("--warn"), `Take profit ${h.yuzde}%`));
  (kademe || []).filter((k) => !k.tamam).forEach((k) => cizgi(k.fiyat, css("--accent"), `Scaled buy`));
  cizgi(hedef, css("--pos"), "Target buy");
  // show the last year on open (3 years on weekly)
  const goster = aralik === "1w" ? 156 : 365;
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, mumlar.length - goster), to: mumlar.length + 3 });
  // load older candles when scrolling left
  let dahaVar = ilk.daha_var, yukleniyor = false;
  chart.timeScale().subscribeVisibleLogicalRangeChange(async (r) => {
    if (!r || r.from > 20 || !dahaVar || yukleniyor) return;
    yukleniyor = true;
    const eski = await getir(mumlar[0].time);
    if (!LW || LW.chart !== chart) return;
    const yeni = (eski.mumlar || []).filter((m) => m.time < mumlar[0].time);
    dahaVar = eski.daha_var && yeni.length > 0;
    if (yeni.length) {
      const gorunen = chart.timeScale().getVisibleLogicalRange();
      mumlar = yeni.concat(mumlar);
      seri.setData(mumlar); isaretKoy();
      if (gorunen) chart.timeScale().setVisibleLogicalRange({ from: gorunen.from + yeni.length, to: gorunen.to + yeni.length });
      kaynakYaz(eski.kaynak || ilk.kaynak, mumlar[0].time);
          }
    yukleniyor = false;
  });
  LW = { chart, seri, sembol, son: { ...mumlar[mumlar.length - 1] }, kripto };
}

// ================================================================== WATCHLIST
function izlemeSayfasi() {
  const l = D.izleme;
  if (!l.length) {
    $("#izleme-liste").innerHTML = `<div class="bos-durum" style="grid-column:1/-1">Your watchlist is empty. Use <b>+ Add</b> for stocks or coins you want to buy, with your reason and target price.</div>`;
    return;
  }
  $("#izleme-liste").innerHTML = l.map((w) => {
    const f = w.sinif === "kripto" && CANLI[w.sembol] ? CANLI[w.sembol] : w.fiyat;
    const hedefte = f !== null && f !== undefined && w.hedef_fiyat && f <= w.hedef_fiyat;
    const kd = w.kademeli_durum && w.kademeli_durum.seviyeler.length ? `
      <div class="hedef"><div class="hedef-ust"><span>Scaled buys · ${para(w.kademeli_durum.toplam_tutar)}</span><span>avg ${fiyatYaz(w.kademeli_durum.ort_maliyet)}</span></div>
      <div class="kademe">${w.kademeli_durum.seviyeler.map((k) => `<span class="rozet ${k.geldi ? "uyari" : ""}">${fiyatYaz(k.fiyat)} · ${para(k.tutar)}${k.geldi ? " · hit" : k.uzaklik !== null && k.uzaklik !== undefined ? ` · ${nf(1, 1).format(k.uzaklik)}%` : ""}</span>`).join("")}</div></div>` : "";
    return `<div class="vkart ${hedefte ? "vurgu" : ""}" data-izleme-detay="${w.id}">
      <div class="vkart-bas"><div><div class="vkart-ad">${esc(w.ad)}${w.sinif === "kripto" && CANLI[w.sembol] ? '<span class="canli-isaret"></span>' : ""}</div><div class="vkart-sembol">${esc(w.sembol)} · ${SINIF_AD[w.sinif] || ""}</div></div>
        <button class="menu-btn" data-izleme-menu="${w.id}" aria-label="Options">⋯</button></div>
      <div class="vkart-deger"><span class="orta" data-canli="izf-${w.id}">${fiyatYaz(f)}</span><span class="rozet ${isaretSinif(w.gunluk_yuzde)}">${yuzde(w.gunluk_yuzde)} today</span></div>
      ${w.hedef_fiyat ? `<div class="mini"><div><span>Target buy</span><b class="num">${fiyatYaz(w.hedef_fiyat)}</b></div>
        <div><span>To target</span><b class="num ${hedefte ? "poz" : ""}">${hedefte ? "at target" : f ? nf(1, 1).format((f / w.hedef_fiyat - 1) * 100) + "% above" : "—"}</b></div></div>` : ""}
      ${w.sinif === "hisse" ? uzatilmisHTML(w.sembol, w.fiyat) : ""}
      ${w.aciklama ? `<div class="alt-yazi" style="margin-top:10px;color:var(--text-2)">${esc(w.aciklama)}</div>` : ""}
      ${kd ? `<div class="cizgi"></div>${kd}` : ""}
      <div class="btnlar" style="margin-top:12px"><button class="btn kucuk ana" data-aldim="${w.id}">I bought</button><button class="btn kucuk" data-izleme-plan="${w.id}">Scaled buys</button></div>
    </div>`;
  }).join("");
}
function izlemeMenusu(id, dugme) {
  kapatAcilir();
  const m = document.createElement("div"); m.className = "acilir";
  m.innerHTML = `<button data-k="detay">Details and chart</button><button data-k="duzenle">Edit</button><button data-k="sil" class="tehlike">Delete</button>`;
  dugme.closest(".vkart").appendChild(m);
  m.addEventListener("click", (e) => {
    e.stopPropagation(); const k = e.target.dataset.k; if (!k) return; kapatAcilir();
    const w = D.izleme.find((x) => x.id === id);
    if (k === "detay") cekmeceAc("izleme", id); else if (k === "duzenle") izlemeModal(w); else izlemeSil(w);
  });
}
async function izlemeSil(w) {
  if (!confirm(`Remove ${w.ad} from the watchlist?`)) return;
  await api("DELETE", `/api/izleme/${w.id}`); if (CEKMECE && CEKMECE.id === w.id) cekmeceKapat(); yukle();
}

// ================================================================== OPTIONS CALCULATOR
const S = { sembol: "", fiyat: null, tur: "put", vade: "", strike: null, adet: 1, prim: null, iv: null, zincir: [] };

function senaryoPozisyonlari() {
  const l = D.varliklar.filter((v) => v.sinif === "opsiyon" && v.acik);
  const sec = $("#s-yukle"), onceki = sec.value;
  sec.innerHTML = `<option value="">Load from my positions…</option>` + l.map((v) => `<option value="${v.id}">${esc(v.ad)} · ×${v.miktar}</option>`).join("");
  sec.value = onceki;
}
async function senaryoGetir(sembol, korunacak = null) {
  sembol = (sembol || "").trim().toUpperCase();
  if (!sembol) return;
  S.sembol = sembol; $("#s-sembol").value = sembol;
  $("#s-durum").textContent = "Loading price and expirations…";
  S.fiyat = null;
  try { S.fiyat = (await api("GET", `/api/fiyat?sembol=${encodeURIComponent(sembol)}`)).fiyat; } catch { /* handled below */ }
  if (!S.fiyat && korunacak && korunacak.fiyat) S.fiyat = korunacak.fiyat;
  $("#s-fiyat").textContent = S.fiyat ? fiyatYaz(S.fiyat) : "—";
  let vadeler = [];
  try { vadeler = await api("GET", `/api/opsiyon/vadeler?sembol=${encodeURIComponent(sembol)}`); } catch { /* none */ }
  const sec = $("#s-vade");
  if (vadeler.length) {
    sec.innerHTML = vadeler.filter((v) => gunFarki(v) >= 0).map((v) => `<option value="${v}">${tarihTR(v, true)} · ${gunFarki(v)} days</option>`).join("") + `<option value="elle">Enter date manually…</option>`;
  } else sec.innerHTML = `<option value="elle">Enter date manually</option>`;
  const istenen = korunacak && korunacak.vade;
  if (istenen && vadeler.includes(istenen)) sec.value = istenen;
  else if (istenen) { sec.value = "elle"; $("#s-vade-elle").value = istenen; }
  else if (vadeler.length) {   // default: expiration closest to ~30 days out
    const h = vadeler.filter((v) => gunFarki(v) >= 0);
    sec.value = h.reduce((a, b) => (Math.abs(gunFarki(b) - 30) < Math.abs(gunFarki(a) - 30) ? b : a), h[0]);
  }
  $("#s-durum").textContent = !S.fiyat ? "Could not load the price. You can enter strike and premium manually."
    : !vadeler.length ? "Could not load expirations, enter the date manually." : "";
  await senaryoVade(korunacak);
}
async function senaryoVade(korunacak = null) {
  const sec = $("#s-vade").value;
  S.vade = sec === "elle" ? $("#s-vade-elle").value : sec;
  $("#s-vade-elle").classList.toggle("gizli", sec !== "elle");
  S.zincir = [];
  if (S.vade && sec !== "elle" && S.sembol) {
    try { S.zincir = await api("GET", `/api/opsiyon/zincir?sembol=${encodeURIComponent(S.sembol)}&vade=${S.vade}&tur=${S.tur}`); } catch { /* none */ }
  }
  const ss = $("#s-strike"), istenen = korunacak && korunacak.strike;
  if (S.zincir.length) {
    const yakin = S.fiyat ? S.zincir.reduce((a, b) => (Math.abs(b.strike - S.fiyat) < Math.abs(a.strike - S.fiyat) ? b : a)).strike : S.zincir[0].strike;
    ss.innerHTML = S.zincir.map((z) => `<option value="${z.strike}">${nf(0, 2).format(z.strike)} · premium ${fiyatYaz(z.orta)}${z.iv > 0.01 ? ` · IV ${nf(0, 0).format(z.iv * 100)}%` : ""}</option>`).join("") + `<option value="elle">Enter manually…</option>`;
    if (istenen && S.zincir.some((z) => z.strike === istenen)) ss.value = String(istenen);
    else if (istenen) { ss.value = "elle"; $("#s-strike-elle").value = istenen; }
    else ss.value = String(yakin);
  } else {
    ss.innerHTML = `<option value="elle">Enter manually</option>`;
    if (istenen) $("#s-strike-elle").value = istenen;
  }
  senaryoStrike(korunacak);
}
function senaryoStrike(korunacak = null) {
  const v = $("#s-strike").value;
  $("#s-strike-elle").classList.toggle("gizli", v !== "elle");
  S.strike = v === "elle" ? Number(String($("#s-strike-elle").value).replace(",", ".")) || null : Number(v);
  const z = S.zincir.find((x) => x.strike === S.strike);
  const T = S.vade ? Math.max(gunFarki(S.vade), 0) / 365 : 0;
  if (korunacak) {
    $("#s-prim").value = korunacak.prim ? +korunacak.prim.toFixed(4) : (z ? +z.orta.toFixed(4) : "");
    let iv = z && z.iv > 0.01 ? z.iv : null;
    if (!iv && korunacak.guncel && S.fiyat && S.strike && T > 0) iv = zimniVol(korunacak.guncel, S.fiyat, S.strike, T, S.tur);
    if (iv) $("#s-iv").value = +(iv * 100).toFixed(1);
  } else if (z) {
    $("#s-prim").value = +z.orta.toFixed(4);
    let iv = z.iv > 0.01 ? z.iv : null;
    if (!iv && S.fiyat && T > 0) iv = zimniVol(z.orta, S.fiyat, S.strike, T, S.tur);
    if (iv) $("#s-iv").value = +(iv * 100).toFixed(1);
  }
  if (!$("#s-iv").value) $("#s-iv").value = 60;
  senaryoKaydiricilariKur();
}
function senaryoKaydiricilariKur() {
  S.adet = Math.max(1, Number($("#s-adet").value) || 1);
  S.prim = Number(String($("#s-prim").value).replace(",", ".")) || 0;
  S.iv = (Number(String($("#s-iv").value).replace(",", ".")) || 60) / 100;
  const S0 = S.fiyat || S.strike || 100;
  const f = $("#s-f"); f.min = Math.max(0.01, S0 * 0.3).toFixed(2); f.max = (S0 * 1.7).toFixed(2);
  f.step = "any"; f.value = S0;
  const gun = S.vade ? Math.max(gunFarki(S.vade), 0) : 0;
  const t = $("#s-t"); t.min = 0; t.max = gun; t.value = 0;
  const v = $("#s-v"); v.min = 5; v.max = Math.max(200, Math.round(S.iv * 250)); v.value = Math.round(S.iv * 100);
  senaryoHesapla();
}
function senaryoHesapla() {
  const kutu = $("#s-ozet");
  if (!S.strike || !S.vade || !D) {
    kutu.innerHTML = `<div style="grid-column:1/-1"><span class="etiket">Type a symbol and press Load, then pick an expiration and strike. Or load one of your positions above.</span></div>`;
    if (GRAFIK.senaryo) { GRAFIK.senaryo.destroy(); delete GRAFIK.senaryo; }
    ["#s-f-etiket", "#s-t-etiket", "#s-v-etiket"].forEach((x) => ($(x).textContent = "—"));
    return;
  }
  const Sx = Number($("#s-f").value), gunSec = Number($("#s-t").value), iv = Number($("#s-v").value) / 100;
  const toplamGun = Math.max(gunFarki(S.vade), 0), c = 100 * S.adet, maliyet = S.prim * c;
  const S0 = S.fiyat || S.strike;
  $("#s-f-etiket").textContent = `${fiyatYaz(Sx)} · ${yuzde((Sx / S0 - 1) * 100)}`;
  $("#s-t-etiket").textContent = `${tarihTR(gunEkle(gunSec), true)} · ${toplamGun - gunSec} days left`;
  $("#s-v-etiket").textContent = `${nf(0, 0).format(iv * 100)}%${Math.round(iv * 100) !== Math.round(S.iv * 100) ? ` (entered ${nf(0, 0).format(S.iv * 100)}%)` : ""}`;
  const degerGun = (g) => bs(Sx, S.strike, Math.max(toplamGun - g, 0) / 365, iv, S.tur) * c;
  const deger = degerGun(gunSec), kz = deger - maliyet;
  const basaBas = S.tur === "put" ? S.strike - S.prim : S.strike + S.prim;
  const T = toplamGun / 365, r = 0.04;
  let olas = null;
  if (T > 0 && iv > 0 && S0 > 0 && basaBas > 0) {
    const d2 = (Math.log(S0 / basaBas) + (r - iv * iv / 2) * T) / (iv * Math.sqrt(T));
    olas = (S.tur === "put" ? Ncdf(-d2) : Ncdf(d2)) * 100;
  }
  kutu.innerHTML = `
    <div><span class="etiket">Option value</span><div class="orta">${para(deger)}</div><div class="alt-yazi">cost ${para(maliyet)} · per share ${fiyatYaz(deger / c)}</div></div>
    <div><span class="etiket">P&amp;L</span><div class="orta ${isaretSinif(kz)}">${para(kz, { isaret: true })}</div><div class="alt-yazi">${maliyet ? `${nf(2, 2).format(deger / maliyet)}x · ${yuzde((kz / maliyet) * 100)}` : ""}</div></div>
    <div><span class="etiket">Breakeven (at expiry)</span><div class="orta">${fiyatYaz(basaBas)}</div><div class="alt-yazi">${yuzde((basaBas / S0 - 1) * 100)} from current price</div></div>
    <div><span class="etiket">Probability of profit</span><div class="orta">${olas !== null ? nf(0, 0).format(olas) + "%" : "—"}</div><div class="alt-yazi">at expiry, at ${nf(0, 0).format(iv * 100)}% IV</div></div>`;
  const adim = toplamGun > 120 ? Math.ceil(toplamGun / 120) : 1;
  const gunler = []; for (let g = 0; g <= toplamGun; g += adim) gunler.push(g);
  if (gunler[gunler.length - 1] !== toplamGun) gunler.push(toplamGun);
  const isaretli = gunler.findIndex((g) => g >= gunSec);
  kzCizgi("senaryo", "#s-grafik", gunler.map((g) => tarihTR(gunEkle(g))), gunler.map((g) => cevir(degerGun(g) - maliyet)), {
    isaretli, ipucu: (c2) => `P&L: ${paraHam(c2.raw, { isaret: true })}`,
  });
}
async function senaryoyaYukle(v) {
  sayfaGoster("senaryo"); cekmeceKapat();
  S.tur = v.opsiyon.tur;
  $$("#s-tur button").forEach((b) => b.classList.toggle("aktif", b.dataset.tur === S.tur));
  $("#s-adet").value = v.miktar;
  await senaryoGetir(v.opsiyon.dayanak, { vade: v.opsiyon.vade, strike: v.opsiyon.strike, prim: v.ort_maliyet, guncel: v.fiyat, fiyat: v.dayanak_fiyat });
  $("#s-yukle").value = v.id;
  $("#s-durum").textContent = `${v.ad}: premium = your average cost (${fiyatYaz(v.ort_maliyet)}); P&L is based on it.`;
}

// ================================================================== CALENDAR and MONTHLY
function takvim() {
  const degisim = gunlukDegisim(), { y, m } = AY;
  $("#ay-ad").textContent = `${AYLAR[m]} ${y}`;
  const ilk = new Date(y, m, 1), sonGun = new Date(y, m + 1, 0).getDate(), bosluk = (ilk.getDay() + 6) % 7;
  const h = GUNLER.map((g) => `<div class="gun-ad">${g}</div>`); h.push(`<div class="gun-ad">Week</div>`);
  let hKz = 0, hVar = false, hBas = null, ayKz = 0, ayVar = false, enIyi = null, enKotu = null, sutun = 0;
  const s = kzSerisi();
  const toplamOnce = (iso) => { const o = s.filter((r) => r.tarih < iso); return o.length ? o[o.length - 1].toplam : baslangicToplam(); };
  const kapat = () => {
    h.push(`<div class="hucre hafta ${hVar ? isaretSinif(hKz) : ""}">${hVar ? `<span class="tutar">${paraHam(hKz, { isaret: true })}</span>${hBas ? `<span class="yzd">${yuzde((hKz / hBas) * 100)}</span>` : ""}` : `<span class="yzd">—</span>`}</div>`);
    hKz = 0; hVar = false; hBas = null; sutun = 0;
  };
  for (let i = 0; i < bosluk; i++) { h.push(`<div class="hucre bos"></div>`); sutun++; }
  for (let g = 1; g <= sonGun; g++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(g).padStart(2, "0")}`, d = degisim[iso], bg = iso === D.bugun ? "bugun" : "";
    if (d) {
      hVar = ayVar = true; hKz += d.kz; ayKz += d.kz; if (hBas === null) hBas = toplamOnce(iso);
      if (!enIyi || d.kz > enIyi.kz) enIyi = { ...d, iso };
      if (!enKotu || d.kz < enKotu.kz) enKotu = { ...d, iso };
      h.push(`<div class="hucre ${isaretSinif(d.kz)} ${bg}"><span class="no">${g}</span><span class="tutar">${paraHam(d.kz, { isaret: true })}</span><span class="yzd">${yuzde(d.yuzde)}</span></div>`);
    } else h.push(`<div class="hucre ${bg}"><span class="no">${g}</span><span class="yzd" style="opacity:.5">—</span></div>`);
    if (++sutun === 7) kapat();
  }
  if (sutun > 0) { while (sutun < 7) { h.push(`<div class="hucre bos"></div>`); sutun++; } kapat(); }
  $("#takvim").innerHTML = h.join("");
  const ayBas = toplamOnce(`${y}-${String(m + 1).padStart(2, "0")}-01`);
  const getiri = ayVar && ayBas ? (ayKz / ayBas) * 100 : null;
  const gunYaz = (o) => `${AYK[m]} ${new Date(o.iso + "T00:00:00").getDate()} · ${paraHam(o.kz, { isaret: true })}`;
  $("#ay-ozet").innerHTML = `
    <div><span class="etiket">Month P&amp;L</span><b class="${ayVar ? isaretSinif(ayKz) : ""}">${ayVar ? paraHam(ayKz, { isaret: true }) : "—"}</b></div>
    <div><span class="etiket">Return</span><b class="${getiri !== null ? isaretSinif(getiri) : ""}">${getiri !== null ? yuzde(getiri) : "—"}</b></div>
    <div><span class="etiket">Best day</span><b class="poz">${enIyi && enIyi.kz > 0 ? gunYaz(enIyi) : "—"}</b></div>
    <div><span class="etiket">Worst day</span><b class="neg">${enKotu && enKotu.kz < 0 ? gunYaz(enKotu) : "—"}</b></div>`;
}
function aylikTablo() {
  const s = kzSerisi();
  if (!s.length) { $("#aylik").innerHTML = `<div class="bos-durum">No data yet.</div>`; return; }
  const ayKapanis = {};
  s.forEach((r) => { ayKapanis[r.tarih.slice(0, 7)] = r; });
  const aylar = Object.keys(ayKapanis).sort();
  const yillar = [...new Set(aylar.map((a) => a.slice(0, 4)))].sort().reverse();
  const sonuc = {};
  let oncekiKz = 0, oncekiToplam = baslangicToplam();
  aylar.forEach((a) => {
    const r = ayKapanis[a], kz = r.kz - oncekiKz;
    sonuc[a] = { kz, yuzde: oncekiToplam ? (kz / oncekiToplam) * 100 : null, bas: oncekiToplam };
    oncekiKz = r.kz; oncekiToplam = r.toplam;
  });
  const satirlar = yillar.map((yl) => {
    let yKz = 0, yBas = null;
    const hucreler = AYK.map((_, i) => {
      const a = `${yl}-${String(i + 1).padStart(2, "0")}`, o = sonuc[a];
      if (!o) return `<td><span class="y">—</span></td>`;
      if (yBas === null) yBas = o.bas;
      yKz += o.kz;
      return `<td class="${isaretSinif(o.kz)}"><span class="k">${paraHam(o.kz, { isaret: true })}</span><span class="y">${yuzde(o.yuzde)}</span></td>`;
    }).join("");
    return `<tr><td class="yil-ad">${yl}</td>${hucreler}<td class="yil ${isaretSinif(yKz)}"><span class="k">${paraHam(yKz, { isaret: true })}</span><span class="y">${yBas ? yuzde((yKz / yBas) * 100) : ""}</span></td></tr>`;
  }).join("");
  $("#aylik").innerHTML = `<table class="aylik"><thead><tr><th></th>${AYK.map((a) => `<th>${a}</th>`).join("")}<th>Year</th></tr></thead><tbody>${satirlar}</tbody></table>`;
}

// ================================================================== HISTORY
const OLAY_SIMGE = { alim: ["▲", "var(--pos)"], satis: ["▼", "var(--neg)"], nakit: ["$", "var(--c-nakit)"], plan: ["◎", "var(--warn)"],
  izleme: ["◉", "var(--text-2)"], duzenleme: ["✎", "var(--text-2)"], silme: ["✕", "var(--neg)"], ayar: ["⚙", "var(--text-2)"] };
function gecmisSayfasi() {
  const ara = ($("#g-ara").value || "").toLocaleLowerCase("en");
  const l = (D.olaylar || []).filter((o) => (!GFILTRE || o.tip === GFILTRE) && (!ara || o.mesaj.toLocaleLowerCase("en").includes(ara)));
  if (!l.length) { $("#gecmis-liste").innerHTML = `<div class="bos-durum">${D.olaylar && D.olaylar.length ? "No entries match this filter." : "No entries yet. Every buy, sell, plan and edit you make will appear here with date and time."}</div>`; return; }
  const gruplar = {};
  l.forEach((o) => { (gruplar[o.zaman.slice(0, 10)] ||= []).push(o); });
  const dun = gunEkle(-1);
  $("#gecmis-liste").innerHTML = Object.keys(gruplar).sort().reverse().map((g) => `
    <div class="gun-grubu"><h4>${g === D.bugun ? "Today" : g === dun ? "Yesterday" : tarihTR(g, true)}</h4>
    ${gruplar[g].map((o) => { const [s, r] = OLAY_SIMGE[o.tip] || ["•", "var(--text-2)"];
      return `<div class="olay"><span class="saat num">${o.zaman.slice(11, 16)}</span><span class="simge" style="color:${r}">${s}</span>
        <span>${esc(o.mesaj)}${o.sinif && SINIF_AD[o.sinif] ? ` <span class="rozet">${SINIF_AD[o.sinif]}</span>` : ""}</span>
        <span class="num">${o.tutar !== null && o.tutar !== undefined ? para(o.tutar) : ""}</span></div>`; }).join("")}</div>`).join("");
}

// ================================================================== LIVE DATA (OKX)
let WS = null, WS_ABONE = new Set(), wsBekle = 1000, canliZaman = null;
function okxIstenen() {
  const s = new Set(["BTC-USDT", "ETH-USDT"]);
  if (D) {
    D.varliklar.filter((v) => v.sinif === "kripto" && v.acik).forEach((v) => s.add(okxSembol(v.sembol)));
    D.izleme.filter((w) => w.sinif === "kripto").forEach((w) => s.add(okxSembol(w.sembol)));
  }
  return s;
}
function okxBaglan() {
  try { WS = new WebSocket("wss://ws.okx.com:8443/ws/v5/public"); } catch { return; }
  WS_ABONE = new Set();
  WS.onopen = () => { wsBekle = 1000; okxAboneOl(); seritCiz(); WS._ping = setInterval(() => { try { WS.send("ping"); } catch { /* */ } }, 25000); };
  WS.onmessage = (e) => {
    if (e.data === "pong") return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (!m.data || !m.arg || m.arg.channel !== "tickers") return;
    for (const t of m.data) {
      const sembol = t.instId.replace(/-USDT$/, "-USD"), f = Number(t.last);
      if (f > 0) { CANLI[sembol] = f; CANLI[sembol + "_acilis"] = Number(t.sodUtc0) || Number(t.open24h) || null; }
    }
    if (!canliZaman) canliZaman = setTimeout(() => { canliZaman = null; canliUygula(true); }, 800);
  };
  WS.onclose = () => { clearInterval(WS && WS._ping); setTimeout(okxBaglan, wsBekle); wsBekle = Math.min(wsBekle * 2, 30000); };
  WS.onerror = () => { try { WS.close(); } catch { /* */ } };
}
function okxAboneOl() {
  if (!WS || WS.readyState !== 1) return;
  const yeni = [...okxIstenen()].filter((s) => !WS_ABONE.has(s));
  if (!yeni.length) return;
  WS.send(JSON.stringify({ op: "subscribe", args: yeni.map((instId) => ({ channel: "tickers", instId })) }));
  yeni.forEach((s) => WS_ABONE.add(s));
}
/** Applies live crypto prices to D and updates the affected numbers in place. */
function canliUygula(ekran) {
  if (!D) return;
  let degisti = false;
  for (const v of D.varliklar) {
    if (v.sinif !== "kripto" || !v.acik || !CANLI[v.sembol]) continue;
    const f = CANLI[v.sembol];
    if (f === v.fiyat) continue;
    const eski = v.deger || 0;
    v.fiyat_eski = v.fiyat; v.fiyat = f; v.fiyat_kaynagi = "canlı";
    v.deger = v.miktar * f; v.kz = v.deger - v.maliyet; v.kz_yuzde = v.maliyet ? (v.kz / v.maliyet) * 100 : null;
    if (v.onceki) v.gunluk_yuzde = (f / v.onceki - 1) * 100;
    const fark = v.deger - eski;
    D.sinif.kripto += fark; D.toplam += fark;
    if (D.kz !== null && D.kz !== undefined) D.kz += fark;
    const son = D.seri[D.seri.length - 1];
    if (son && son.tarih === D.bugun) { son.toplam += fark; son.kz += fark; }
    for (const ser of [D.varlik_seri[v.id], D.sinif_seri.kripto]) {
      if (ser && ser.length && ser[ser.length - 1][0] === D.bugun) ser[ser.length - 1][1] += fark;
    }
    degisti = true;
    if (ekran) yerindeGuncelle(v);
  }
  if (ekran && degisti) {
    $("#k-toplam").textContent = para(D.toplam); kpiKz();
    $("#k-nakit-alt").textContent = D.toplam ? `${nf(0, 1).format((D.nakit / D.toplam) * 100)}% of portfolio` : "";
    const o = sinifOzeti("kripto");
    const el = $(`[data-canli="sinif-kripto"]`); if (el) el.textContent = para(o.deger);
    const ek = $(`[data-canli="sinif-kz-kripto"]`); if (ek) { ek.textContent = para(o.kz, { isaret: true }) + " since first buy"; ek.className = "alt-yazi " + isaretSinif(o.kz); }
    if (VSINIF === "kripto") {
      const a = $(`[data-canli="sk-deger"]`); if (a) a.textContent = para(o.deger);
      const b = $(`[data-canli="sk-kz"]`); if (b) { b.textContent = para(o.kz, { isaret: true }); b.className = "buyuk " + isaretSinif(o.kz); }
      const c = $(`[data-canli="sk-bugun"]`); if (c) { c.textContent = para(o.bugun, { isaret: true }); c.className = "buyuk " + isaretSinif(o.bugun); }
    }
  }
  if (ekran) {
    D.izleme.filter((w) => w.sinif === "kripto" && CANLI[w.sembol]).forEach((w) => { const e = $(`[data-canli="izf-${w.id}"]`); if (e) e.textContent = fiyatYaz(CANLI[w.sembol]); });
    if (LW && LW.kripto && CANLI[LW.sembol] && LW.son) {
      const f = CANLI[LW.sembol], s = LW.son;
      s.high = Math.max(s.high, f); s.low = Math.min(s.low, f); s.close = f;
      try { LW.seri.update({ ...s }); } catch { /* */ }
    }
    seritCiz();
  }
}
function yerindeGuncelle(v) {
  const yaz = (anahtar, metin, sinif) => {
    const e = $(`[data-canli="${anahtar}-${v.id}"]`); if (!e) return;
    e.textContent = metin; if (sinif !== undefined) e.className = sinif;
    if (anahtar === "fiyat" && v.fiyat_eski) { e.classList.remove("yandi-poz", "yandi-neg"); void e.offsetWidth; e.classList.add(v.fiyat >= v.fiyat_eski ? "yandi-poz" : "yandi-neg"); }
  };
  yaz("deger", para(v.deger)); yaz("fiyat", fiyatYaz(v.fiyat), "num");
  yaz("kz", `${para(v.kz, { isaret: true })} · ${yuzde(v.kz_yuzde)}`, "rozet " + isaretSinif(v.kz));
  yaz("gun", yuzde(v.gunluk_yuzde), "num " + isaretSinif(v.gunluk_yuzde));
}

// ================================================================== MARKET CLOCK and TICKER STRIP
function piyasaDurumu() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dk = (Number(p.hour) % 24) * 60 + Number(p.minute), gun = p.weekday;
  const sure = (x) => `${Math.floor(x / 60) ? Math.floor(x / 60) + "h " : ""}${x % 60}m`;
  if (gun === "Sat" || gun === "Sun") return { seans: "kapali", metin: "Closed · weekend" };
  if (dk >= 570 && dk < 960) return { seans: "acik", metin: `Open · closes in ${sure(960 - dk)}` };
  if (dk >= 240 && dk < 570) return { seans: "oncesi", metin: `Pre-market · opens in ${sure(570 - dk)}` };
  if (dk >= 960 && dk < 1200) return { seans: "sonrasi", metin: `After hours · ends in ${sure(1200 - dk)}` };
  if (gun === "Fri" && dk >= 1200) return { seans: "kapali", metin: "Closed · opens Monday" };
  return { seans: "kapali", metin: `Closed · opens in ${sure(dk < 240 ? 570 - dk : 1440 - dk + 570)}` };
}
function piyasaCiz() {
  const d = piyasaDurumu();
  $("#piyasa-cip span").textContent = "US " + d.metin;
  $("#piyasa-cip .durum-nokta").className = "durum-nokta " + (d.seans === "acik" ? "acik" : d.seans === "kapali" ? "" : "uzatilmis");
}
async function seritYukle() { try { SERIT = await api("GET", "/api/serit"); seritCiz(); } catch { /* silent */ } }
function seritCiz() {
  const l = SERIT.length ? SERIT : [{ ad: "BTC", sembol: "BTC-USD" }, { ad: "ETH", sembol: "ETH-USD" }, { ad: "NQ1!", sembol: "NQ=F" }, { ad: "ES1!", sembol: "ES=F" }];
  $("#serit").innerHTML = l.map((x) => {
    const c = CANLI[x.sembol], f = c || x.fiyat, ref = c ? (CANLI[x.sembol + "_acilis"] || x.onceki) : x.onceki;
    const deg = f && ref ? (f / ref - 1) * 100 : null;
    return `<span class="s-oge"><span class="s-ad">${esc(x.ad)}</span><span class="s-fiyat num">${f ? nf(f >= 1000 ? 0 : 2, f >= 1000 ? 0 : 2).format(f) : "—"}</span>
      <span class="num ${isaretSinif(deg)}">${deg !== null ? yuzde(deg) : ""}</span>${c ? '<span class="canli-isaret" title="Live (OKX)"></span>' : ""}</span>`;
  }).join("") + `<span class="s-sag">${WS && WS.readyState === 1 ? "Crypto live · OKX" : "Waiting for live crypto feed"} · NQ1!/ES1! futures (Yahoo, ~10 min delayed)</span>`;
}

// ================================================================== SHARE CARD
/** Share image (1200×630) that hides amounts and shows percentages only. Without v: whole portfolio. */
function paylasimCiz(v) {
  const W = 1200, H = 630, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d"), font = (w, px) => `${w} ${px}px Inter, "Segoe UI", -apple-system, Roboto, sans-serif`;
  const POZ = css("--pos") || "#3f8ef0", NEG = css("--neg") || "#ec5d5d";
  // background
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#111a2e"); g.addColorStop(1, "#0a0f1c");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = "rgba(255,255,255,0.08)"; x.lineWidth = 2; x.strokeRect(1, 1, W - 2, H - 2);
  // top row
  x.fillStyle = "#f0efec"; x.font = font(700, 30); x.fillText("Portfolio", 60, 78);
  const mw = x.measureText("Portfolio").width; x.fillStyle = POZ; x.fillText(".", 60 + mw, 78);
  x.fillStyle = "#8a93ab"; x.font = font(500, 24); x.textAlign = "right"; x.fillText(tarihTR(D.bugun, true), W - 60, 78); x.textAlign = "left";

  let baslik, alt, yzd, satirlar = [], seri = [], kat = null;
  if (v) {
    const isl = D.islemler.filter((i) => i.varlik_id === v.id).map((i) => i.tarih).sort();
    const gun = isl.length ? -gunFarki(isl[0]) : 0;
    baslik = v.ad;
    if (v.sinif === "opsiyon") {
      const o = v.opsiyon;
      alt = `${o.dayanak} · ${o.tur === "put" ? "Put" : "Call"} ${nf(0, 2).format(o.strike)} · exp ${tarihTR(o.vade, true)}`;
      kat = v.ort_maliyet ? v.fiyat / v.ort_maliyet : null;
    } else alt = `${SINIF_AD[v.sinif]} · ${v.sembol.replace(/-USD$/, "")}`;
    yzd = v.acik ? v.kz_yuzde : (v.maliyet ? null : null);
    if (!v.acik) {   // closed position: realized / total bought
      const alis = D.islemler.filter((i) => i.varlik_id === v.id && i.tip === "al").reduce((t, i) => t + i.miktar * i.fiyat * (v.sinif === "opsiyon" ? 100 : 1), 0);
      yzd = alis ? (v.gerceklesen / alis) * 100 : null;
    }
    satirlar = [[v.sinif === "opsiyon" ? "Entry premium" : "Entry", fiyatYaz(v.ort_maliyet)], [v.sinif === "opsiyon" ? "Current premium" : "Current", fiyatYaz(v.fiyat)], ["Held", `${gun} days`]];
    const m = v.maliyet || 1;
    seri = (D.varlik_seri[v.id] || []).map((p) => (p[1] / m) * 100);
  } else {
    const bas = D.ayarlar.baslangic_bakiye || 1, p = D.performans || {};
    baslik = "Portfolio return"; alt = `Since ${tarihTR(D.ayarlar.baslangic_tarihi, true)}`;
    const son = D.seri[D.seri.length - 1]; yzd = son ? (son.kz / bas) * 100 : null;
    satirlar = [["Today", p.gunluk ? yuzde(p.gunluk.yuzde) : "—"], ["This month", p.aylik ? yuzde(p.aylik.yuzde) : "—"],
      ["Max drawdown", p.maks_dusus !== undefined ? nf(1, 1).format(p.maks_dusus) + "%" : "—"]];
    seri = [0].concat(D.seri.map((r) => (r.kz / bas) * 100));
  }
  // title
  x.fillStyle = "#ffffff"; x.font = font(700, 56); x.fillText(baslik, 60, 190);
  x.fillStyle = "#8a93ab"; x.font = font(500, 26); x.fillText(alt, 60, 234);
  // big percentage
  const renk = yzd > 0 ? POZ : yzd < 0 ? NEG : "#f0efec";
  x.fillStyle = renk; x.font = font(800, 120); x.fillText(yzd === null || yzd === undefined ? "—" : yuzde(yzd), 54, 380);
  if (kat) { x.fillStyle = "#c9cfdd"; x.font = font(600, 34); x.fillText(`${nf(2, 2).format(kat)}x`, 60, 432); }
  // bottom values
  satirlar.forEach(([a, b], i) => {
    const sx = 60 + i * 230;
    x.fillStyle = "#8a93ab"; x.font = font(500, 22); x.fillText(a, sx, 520);
    x.fillStyle = "#f0efec"; x.font = font(700, 32); x.fillText(b, sx, 560);
  });
  // small chart on the right
  if (seri.length >= 2) {
    const gx = 760, gy = 300, gw = 380, gh = 220, mn = Math.min(0, ...seri), mx = Math.max(0, ...seri), ar = mx - mn || 1;
    const px = (i) => gx + (i / (seri.length - 1)) * gw, py = (val) => gy + gh - ((val - mn) / ar) * gh;
    x.strokeStyle = "rgba(255,255,255,0.18)"; x.setLineDash([6, 6]); x.lineWidth = 2;
    x.beginPath(); x.moveTo(gx, py(0)); x.lineTo(gx + gw, py(0)); x.stroke(); x.setLineDash([]);
    x.beginPath(); seri.forEach((val, i) => (i ? x.lineTo(px(i), py(val)) : x.moveTo(px(i), py(val))));
    x.lineTo(gx + gw, py(0)); x.lineTo(gx, py(0)); x.closePath();
    x.fillStyle = yzd >= 0 ? "rgba(63,142,240,0.16)" : "rgba(236,93,93,0.16)"; x.fill();
    x.beginPath(); seri.forEach((val, i) => (i ? x.lineTo(px(i), py(val)) : x.moveTo(px(i), py(val))));
    x.strokeStyle = renk; x.lineWidth = 4; x.lineJoin = "round"; x.stroke();
    x.fillStyle = renk; x.beginPath(); x.arc(px(seri.length - 1), py(seri[seri.length - 1]), 7, 0, Math.PI * 2); x.fill();
  }
  x.fillStyle = "#5d6680"; x.font = font(500, 20); x.textAlign = "right"; x.fillText("Amounts hidden · percentages only", W - 60, H - 40); x.textAlign = "left";
  return c;
}
function paylasimModal(v = null) {
  const c = paylasimCiz(v), url = c.toDataURL("image/png");
  const ad = (v ? v.ad : "portfolio").replace(/[^\w-]+/g, "-");
  modalAc(`<h3>Share card</h3><p class="aciklama">Amounts are hidden, only percentages are shown. Download it or copy and paste it anywhere.</p>
    <img src="${url}" alt="Share card" style="width:100%;border-radius:12px;border:1px solid var(--border)">
    <div class="modal-alt"><button class="btn" data-kapat>Close</button><a class="btn" href="${url}" download="${ad}-${D.bugun}.png">Download</a><button class="btn ana" id="m-kopyala">Copy</button></div>`);
  $("#m-kopyala").addEventListener("click", () => c.toBlob(async (b) => {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); bildir("Image copied, paste it anywhere"); }
    catch { bildir("Could not copy, use Download"); }
  }, "image/png"));
}

// ================================================================== MODAL helpers
function modalAc(html, bagla) {
  const eski = $("#modal"), yeni = eski.cloneNode(false); eski.replaceWith(yeni);
  yeni.innerHTML = html + `<div class="hata-kutu" id="m-hata"></div>`;
  $("#perde").classList.add("acik");
  const ilk = $("#modal input:not([type=checkbox]), #modal select");
  if (ilk) setTimeout(() => ilk.focus(), 30);
  $$("#modal [data-kapat]").forEach((b) => b.addEventListener("click", modalKapat));
  if (bagla) bagla(yeni);
}
function modalKapat() { $("#perde").classList.remove("acik"); const e = $("#modal"), y = e.cloneNode(false); e.replaceWith(y); }
function modalHata(m) { const h = $("#m-hata"); h.textContent = m; h.style.display = "block"; }
const alan = (ad, etiket, tip = "number", deger = "", ek = "", ipucu = "") =>
  `<div class="alan ${ek}"><label for="f-${ad}" id="l-${ad}">${etiket}</label><input id="f-${ad}" name="${ad}" type="${tip}" step="any" value="${esc(deger)}" autocomplete="off">${ipucu ? `<div class="ipucu" id="i-${ad}">${ipucu}</div>` : ""}</div>`;
const secimAlan = (ad, etiket, sec, deger, ek = "") =>
  `<div class="alan ${ek}"><label for="f-${ad}">${etiket}</label><select id="f-${ad}">${sec.map(([v, a]) => `<option value="${v}" ${v === deger ? "selected" : ""}>${a}</option>`).join("")}</select></div>`;
const altBtn = (yazi = "Save") => `<div class="modal-alt"><button class="btn" data-kapat>Cancel</button><button class="btn ana" id="m-kaydet">${yazi}</button></div>`;
const val = (ad) => { const e = $(`#f-${ad}`); return e ? e.value.trim() : ""; };
const num = (ad) => { const x = val(ad).replace(",", "."); return x === "" ? null : Number(x); };
function kaydetBagla(fonk) {
  const b = $("#m-kaydet");
  const calis = async () => { b.disabled = true; try { await fonk(); modalKapat(); await yukle(); } catch (e) { modalHata(e.message); } finally { b.disabled = false; } };
  b.addEventListener("click", calis);
  $("#modal").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") calis(); });
}

// ================================================================== holding dialogs
const ETIKET = {
  kripto: { kisa: "Quantity", miktar: "Quantity (coins)", miktarIpucu: "e.g. 0.02 BTC or 1000 ADA", fiyat: "Buy price ($)", satis: "Sell price ($)", fiyatIpucu: "Per coin" },
  hisse: { kisa: "Shares", miktar: "Shares", miktarIpucu: "Number of shares", fiyat: "Buy price ($)", satis: "Sell price ($)", fiyatIpucu: "Per share" },
  opsiyon: { kisa: "Contracts", miktar: "Contracts", miktarIpucu: "1 contract = 100 shares", fiyat: "Premium ($ per share)", satis: "Sell premium ($ per share)", fiyatIpucu: "e.g. 4.07 → $407 per contract" },
};
function varlikEkleModal(on = {}) {
  modalAc(`<h3>Add holding</h3><p class="aciklama">The purchase amount is deducted from cash. The current price is fetched automatically.</p>
    <div class="form">
      ${secimAlan("sinif", "Class", [["kripto", "Crypto"], ["hisse", "Stock"], ["opsiyon", "Option"]], on.sinif || VSINIF, "tam")}
      <div class="tam form" id="f-normal" style="grid-template-columns:1fr 1fr">
        ${alan("sembol", "Symbol", "text", on.sembol || "", "", "Crypto: BTC, ETH · Stock: AAPL, MSFT")}${alan("ad", "Name (optional)", "text", on.ad || "")}</div>
      <div class="tam form" id="f-ops" style="grid-template-columns:1fr 1fr">
        ${alan("dayanak", "Underlying", "text", "", "", "e.g. AAPL")}${secimAlan("tur", "Type", [["put", "Put"], ["call", "Call"]], "put")}
        ${alan("strike", "Strike")}${alan("vade", "Expiration", "date")}</div>
      ${alan("miktar", "Quantity", "number", on.miktar || "", "", " ")}${alan("fiyat", "Buy price ($)", "number", on.fiyat || "", "", " ")}
      ${alan("tarih", "Date", "date", D.bugun)}
      <div class="alan"><label>&nbsp;</label><label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" id="f-nakit" checked style="width:auto"> Deduct from cash</label></div>
    </div><div class="onizleme" id="f-onizleme"></div>${altBtn("Add")}`, (m) => {
    const goster = () => {
      const sn = val("sinif"), op = sn === "opsiyon", e = ETIKET[sn];
      $("#f-normal").style.display = op ? "none" : "grid"; $("#f-ops").style.display = op ? "grid" : "none";
      $("#l-miktar").textContent = e.miktar; $("#i-miktar").textContent = e.miktarIpucu;
      $("#l-fiyat").textContent = e.fiyat; $("#i-fiyat").textContent = e.fiyatIpucu;
      const q = num("miktar"), f = num("fiyat"), tutar = q && f ? q * f * (op ? 100 : 1) : null;
      $("#f-onizleme").innerHTML = tutar ? `Total: <b>${para(tutar)}</b> · Cash left: <b>${para(D.nakit - ($("#f-nakit").checked ? tutar : 0))}</b>` : "Enter quantity and price.";
    };
    m.addEventListener("input", goster); m.addEventListener("change", goster); goster();
  });
  kaydetBagla(async () => {
    const sinif = val("sinif");
    let sembol = val("sembol").toUpperCase();
    if (sinif === "kripto" && sembol && !sembol.includes("-")) sembol += "-USD";
    const g = { sinif, sembol, ad: val("ad"), miktar: num("miktar"), fiyat: num("fiyat"), tarih: val("tarih"), nakit_etkisi: $("#f-nakit").checked, izleme_id: on.izleme_id };
    if (sinif === "opsiyon") g.opsiyon = { dayanak: val("dayanak").toUpperCase(), tur: val("tur"), strike: num("strike"), vade: val("vade") };
    await api("POST", "/api/varlik", g);
    VSINIF = sinif; yerelYaz("vsinif", sinif); bildir("Holding added");
  });
}
function alimModal(v, on = {}) {
  const c = v.sinif === "opsiyon" ? 100 : 1, e = ETIKET[v.sinif];
  modalAc(`<h3>${esc(v.ad)} · add buy</h3><p class="aciklama">Held: ${miktarYaz(v.miktar)} · avg cost ${fiyatYaz(v.ort_maliyet)}</p>
    <div class="form">${alan("miktar", e.miktar, "number", on.miktar ?? "")}${alan("fiyat", e.fiyat, "number", on.fiyat ?? (v.fiyat ?? ""))}
    ${alan("tarih", "Date", "date", D.bugun, "tam")}</div><div class="onizleme" id="f-onizleme"></div>${altBtn("Save buy")}`, (m) => {
    const goster = () => {
      const q = num("miktar"), f = num("fiyat");
      if (!q || !f) { $("#f-onizleme").textContent = "Enter quantity and price."; return; }
      const yeniOrt = (v.maliyet + q * f * c) / ((v.miktar + q) * c);
      $("#f-onizleme").innerHTML = `Amount <b>${para(q * f * c)}</b> · new average cost <b>${fiyatYaz(yeniOrt)}</b> · cash left <b>${para(D.nakit - q * f * c)}</b>`;
    };
    m.addEventListener("input", goster); goster();
  });
  kaydetBagla(async () => { await api("POST", "/api/islem", { varlik_id: v.id, tip: "al", miktar: num("miktar"), fiyat: num("fiyat"), tarih: val("tarih"), kademeli_id: on.kademeli_id }); bildir("Buy saved"); });
}
function satisModal(v, on = {}) {
  const c = v.sinif === "opsiyon" ? 100 : 1, e = ETIKET[v.sinif];
  modalAc(`<h3>${esc(v.ad)} · sell</h3><p class="aciklama">Held: ${miktarYaz(v.miktar)} · avg cost ${fiyatYaz(v.ort_maliyet)}</p>
    <div class="btnlar" style="margin-bottom:12px">${[25, 50, 100].map((p) => `<button class="btn kucuk" data-yuzde="${p}">${p}%</button>`).join("")}</div>
    <div class="form">${alan("miktar", e.miktar, "number", on.miktar ?? v.miktar)}${alan("fiyat", e.satis, "number", on.fiyat ?? (v.fiyat ?? ""))}
    ${alan("tarih", "Date", "date", D.bugun, "tam")}</div><div class="onizleme" id="f-onizleme"></div>${altBtn("Save sell")}`, (m) => {
    const goster = () => {
      const q = num("miktar"), f = num("fiyat");
      if (!q || f === null) { $("#f-onizleme").textContent = "Enter quantity and price."; return; }
      const kz = q * f * c - q * (v.ort_maliyet || 0) * c;
      $("#f-onizleme").innerHTML = `To cash <b>${para(q * f * c)}</b> · P&L of this sale <b class="${isaretSinif(kz)}">${para(kz, { isaret: true })}</b>`;
    };
    m.addEventListener("input", goster);
    $$("[data-yuzde]", m).forEach((b) => b.addEventListener("click", () => { $("#f-miktar").value = +(v.miktar * b.dataset.yuzde / 100).toFixed(8); goster(); }));
    goster();
  });
  kaydetBagla(async () => { await api("POST", "/api/islem", { varlik_id: v.id, tip: "sat", miktar: num("miktar"), fiyat: num("fiyat"), tarih: val("tarih"), kar_al_id: on.kar_al_id }); bildir("Sell saved"); });
}
function satirListesiModal({ baslik, aciklama, satirlar, kolonlar, yeniSatir, onizle, kaydet }) {
  const liste = satirlar.map((s) => ({ ...s }));
  const ciz2 = () => {
    $("#m-satirlar").innerHTML = liste.length ? liste.map((s, i) => `<div class="s" data-i="${i}">${kolonlar.map((k) => k.tip === "secim" ?
      `<div class="alan"><label>${k.etiket}</label><select data-k="${k.ad}">${k.secenek.map(([v, a]) => `<option value="${v}" ${s[k.ad] === v ? "selected" : ""}>${a}</option>`).join("")}</select></div>` :
      `<div class="alan"><label>${k.etiket}</label><input data-k="${k.ad}" type="number" step="any" value="${s[k.ad] ?? ""}"></div>`).join("")}
      <button class="btn kucuk tehlike" data-cikar="${i}" style="margin-bottom:2px">Delete</button></div>`).join("") : `<div class="etiket">No levels yet.</div>`;
    if (onizle) $("#f-onizleme").innerHTML = onizle(liste);
  };
  modalAc(`<h3>${baslik}</h3><p class="aciklama">${aciklama}</p><div class="satir-liste" id="m-satirlar"></div>
    <button class="btn kucuk" id="m-satir-ekle" style="margin-top:10px">+ Add level</button><div class="onizleme" id="f-onizleme"></div>${altBtn()}`, (m) => {
    const guncelle = (e) => {
      const kutu = e.target.closest(".s"); if (!kutu || !e.target.dataset.k) return;
      liste[+kutu.dataset.i][e.target.dataset.k] = e.target.tagName === "SELECT" ? e.target.value : (e.target.value === "" ? null : Number(e.target.value.replace(",", ".")));
      if (onizle) $("#f-onizleme").innerHTML = onizle(liste);
    };
    m.addEventListener("input", guncelle); m.addEventListener("change", guncelle);
    m.addEventListener("click", (e) => { if (e.target.dataset.cikar !== undefined) { liste.splice(+e.target.dataset.cikar, 1); ciz2(); } });
    $("#m-satir-ekle").addEventListener("click", () => { liste.push(yeniSatir()); ciz2(); });
    ciz2();
  });
  kaydetBagla(() => kaydet(liste));
}
function karAlModal(v) {
  satirListesiModal({
    baslik: `${v.ad} · take-profit targets`,
    aciklama: `A multiple of your cost (2 = 2x) or a price. When the price reaches the target the card is highlighted and an "I sold" button appears. Avg cost: ${fiyatYaz(v.ort_maliyet)}`,
    satirlar: v.kar_al || [],
    kolonlar: [{ ad: "tip", etiket: "Type", tip: "secim", secenek: [["kat", "Multiple (x)"], ["fiyat", "Price ($)"]] }, { ad: "deger", etiket: "Target" }, { ad: "yuzde", etiket: "Sell %" }],
    yeniSatir: () => ({ tip: "kat", deger: (v.kar_al || []).length ? 3 : 2, yuzde: 50 }),
    onizle: (l) => l.map((h) => {
      const hf = h.tip === "kat" ? (h.deger || 0) * (v.ort_maliyet || 0) : h.deger, c = v.sinif === "opsiyon" ? 100 : 1;
      const kz = hf && h.yuzde ? (hf - (v.ort_maliyet || 0)) * v.miktar * (h.yuzde / 100) * c : null;
      return `${h.tip === "kat" ? (h.deger || "?") + "x" : fiyatYaz(h.deger)} → ${fiyatYaz(hf)} · selling ${h.yuzde || "?"}% gives <b>${kz !== null ? para(kz, { isaret: true }) : "—"}</b>`;
    }).join("<br>") || "Add a level.",
    kaydet: async (l) => { await api("PUT", `/api/varlik/${v.id}`, { kar_al: l }); bildir("Targets saved"); },
  });
}
function kademeliModal(nesne, tur) {
  satirListesiModal({
    baslik: `${nesne.ad} · scaled buy plan`,
    aciklama: "For each level, a price and the amount ($) to spend there. When the price reaches a level it shows on the card.",
    satirlar: nesne.kademeli || [], kolonlar: [{ ad: "fiyat", etiket: "Price ($)" }, { ad: "tutar", etiket: "Amount ($)" }],
    yeniSatir: () => ({ fiyat: null, tutar: null }),
    onizle: (l) => {
      const g = l.filter((k) => k.fiyat > 0 && k.tutar > 0); if (!g.length) return "Add a level.";
      const t = g.reduce((a, k) => a + k.tutar, 0), adet = g.reduce((a, k) => a + k.tutar / k.fiyat, 0);
      return `If all fill: total <b>${para(t)}</b> · <b>${miktarYaz(+adet.toFixed(6))}</b> units · average cost <b>${fiyatYaz(t / adet)}</b>`;
    },
    kaydet: async (l) => { await api("PUT", tur === "varlik" ? `/api/varlik/${nesne.id}` : `/api/izleme/${nesne.id}`, { kademeli: l }); bildir("Plan saved"); },
  });
}
function elleFiyatModal(v) {
  modalAc(`<h3>${esc(v.ad)} · ${v.sinif === "opsiyon" ? "current premium" : "price"}</h3>
    <p class="aciklama">Used when no live price is available. ${v.sinif === "opsiyon" ? "Enter the per-share premium shown by your broker (e.g. 8.73)." : ""} Leave empty to clear it.</p>
    <div class="form">${alan("elle", "Price ($)", "number", v.elle_fiyat ?? "", "tam")}</div>${altBtn()}`);
  kaydetBagla(async () => { await api("PUT", `/api/varlik/${v.id}`, { elle_fiyat: val("elle") === "" ? null : num("elle") }); bildir("Saved"); });
}
function duzenleModal(v) {
  modalAc(`<h3>Edit</h3><div class="form">${alan("ad", "Name", "text", v.ad, "tam")}
    ${v.sinif !== "opsiyon" ? alan("sembol", "Symbol (Yahoo)", "text", v.sembol, "tam", "Crypto: BTC-USD · Stock: AAPL") : ""}
    <div class="alan tam"><label for="f-not">Note</label><textarea id="f-not" rows="3">${esc(v.not || "")}</textarea></div></div>${altBtn()}`);
  kaydetBagla(async () => { const b = { ad: val("ad"), not: $("#f-not").value }; if (v.sinif !== "opsiyon") b.sembol = val("sembol"); await api("PUT", `/api/varlik/${v.id}`, b); bildir("Saved"); });
}
function silModal(v) {
  if (!confirm(`Delete ${v.ad} and all its trades? If it was not entered by mistake, use "Sell" instead.`)) return;
  api("DELETE", `/api/varlik/${v.id}`).then(() => { cekmeceKapat(); yukle(); bildir("Deleted"); });
}
function nakitModal(tip) {
  modalAc(`<h3>${tip === "yatir" ? "Deposit" : "Withdraw"}</h3><p class="aciklama">Money added from or taken out to outside. It is not counted as profit or loss.</p>
    <div class="form">${alan("tutar", "Amount ($)")}${alan("tarih", "Date", "date", D.bugun)}${alan("not", "Note", "text", "", "tam")}</div>${altBtn()}`);
  kaydetBagla(async () => { await api("POST", "/api/nakit", { tip, tutar: num("tutar"), tarih: val("tarih"), not: val("not") }); bildir("Saved"); });
}
function nakitGecmisiModal() {
  const nh = D.nakit_hareketleri;
  modalAc(`<h3>Cash · ${para(D.nakit)}</h3><p class="aciklama">Starting cash ${para(D.ayarlar.baslangic_nakit)}. Buys are deducted from cash, sells are added.</p>
    <div class="btnlar" style="margin-bottom:12px"><button class="btn kucuk" data-nakit-ac="yatir">+ Deposit</button><button class="btn kucuk" data-nakit-ac="cek">− Withdraw</button></div>
    ${nh.length ? `<table class="tablo"><thead><tr><th>Date</th><th>Type</th><th>Note</th><th class="sag-hiza">Amount</th><th></th></tr></thead><tbody>
    ${nh.map((h) => `<tr><td>${tarihTR(h.tarih, true)}</td><td>${h.tip === "yatir" ? "Deposit" : "Withdrawal"}</td><td>${esc(h.not)}</td>
      <td class="sag-hiza num ${h.tip === "yatir" ? "poz" : "neg"}">${para(h.tip === "yatir" ? h.tutar : -h.tutar, { isaret: true })}</td>
      <td class="sag-hiza"><button class="btn kucuk tehlike" data-nakit-sil="${h.id}">Delete</button></td></tr>`).join("")}</tbody></table>` : `<div class="bos-durum">No deposits or withdrawals yet.</div>`}
    <div class="modal-alt"><button class="btn" data-kapat>Close</button></div>`);
}
function izlemeModal(w = null) {
  modalAc(`<h3>${w ? "Edit" : "Add to watchlist"}</h3>
    <div class="form">${secimAlan("sinif", "Class", [["kripto", "Crypto"], ["hisse", "Stock"]], w ? w.sinif : "hisse")}
      ${alan("sembol", "Symbol", "text", w ? w.sembol : "", "", "Crypto: BTC · Stock: AAPL")}${alan("ad", "Name", "text", w ? w.ad : "")}
      ${alan("hedef", "Price you want to buy at ($)", "number", w ? (w.hedef_fiyat ?? "") : "")}
      <div class="alan tam"><label for="f-aciklama">Why do you want to buy it?</label><textarea id="f-aciklama" rows="3">${esc(w ? w.aciklama : "")}</textarea></div>
    </div>${altBtn(w ? "Save" : "Add")}`);
  kaydetBagla(async () => {
    let sembol = val("sembol").toUpperCase();
    if (val("sinif") === "kripto" && sembol && !sembol.includes("-")) sembol += "-USD";
    const b = { sinif: val("sinif"), sembol, ad: val("ad") || sembol.replace(/-USD$/, ""), hedef_fiyat: val("hedef") === "" ? null : num("hedef"), aciklama: $("#f-aciklama").value };
    if (w) await api("PUT", `/api/izleme/${w.id}`, b); else await api("POST", "/api/izleme", b);
    bildir("Saved");
  });
}
function ayarModal() {
  const a = D.ayarlar;
  modalAc(`<h3>Settings and backup</h3>
    <p class="aciklama">Starting balance = starting cash + cost of positions you held before the start date. P&amp;L is measured against it. If you change the start date, past days are rebuilt from that date.</p>
    <div class="form">${alan("bnakit", "Starting cash ($)", "number", a.baslangic_nakit ?? "")}${alan("bbakiye", "Starting balance ($)", "number", a.baslangic_bakiye_elle ? (a.baslangic_bakiye ?? "") : "", "", `P&amp;L zero point. Empty = automatic (${para(a.baslangic_otomatik ?? a.baslangic_bakiye)})`)}
      ${alan("btarih", "Start date", "date", a.baslangic_tarihi || D.bugun, "tam")}</div>
    <div class="cizgi"></div>
    <div class="btnlar"><button class="btn" id="m-gunsonu">Save end-of-day snapshot now</button><a class="btn" href="/api/yedek" download>Download backup</a><button class="btn" id="m-yukle">Restore from file</button></div>
    <div class="cizgi"></div>
    <h4 style="margin:0 0 6px">Automatic daily backups</h4><p class="aciklama" style="margin-top:0">A copy is taken every day and the last 30 days are kept. Before restoring, the current state is saved separately.</p>
    <div id="m-yedekler" class="etiket">Loading…</div>
    ${altBtn()}`, () => {
    api("GET", "/api/yedekler").then((l) => {
      const el = $("#m-yedekler"); if (!el) return;
      el.innerHTML = l.length ? `<table class="tablo"><tbody>${l.map((y) => `<tr><td>${y.dosya.startsWith("geri-yukleme-oncesi") ? `State before restore · ${esc(y.zaman.replace("T", " "))}` : esc(y.dosya.replace(/^veri-/, "").replace(/\.json$/, ""))}</td>
        <td class="sag-hiza etiket">${nf(0, 0).format(y.boyut / 1024)} KB</td><td class="sag-hiza"><button class="btn kucuk" data-yedek-don="${esc(y.dosya)}">Restore</button></td></tr>`).join("")}</tbody></table>`
        : "No automatic backups yet. The first one is created on the first save.";
    }).catch((e) => { const el = $("#m-yedekler"); if (el) el.textContent = e.message; });
    $("#m-gunsonu").addEventListener("click", async () => { try { const r = await api("POST", "/api/gunsonu"); bildir(`${tarihTR(r.gun)} saved: ${para(r.toplam)}`); modalKapat(); yukle(); } catch (e) { modalHata(e.message); } });
    $("#m-yukle").addEventListener("click", () => $("#yedek-dosya").click());
  });
  kaydetBagla(async () => { await api("POST", "/api/ayarlar", { baslangic_nakit: num("bnakit"), baslangic_bakiye: num("bbakiye"), baslangic_tarihi: val("btarih") }); bildir("Settings saved"); });
}

// ================================================================== CHARTS (TradingView)
let tvYuklendi = false, TV_SEMBOL = null;
const tvSembol = (s, sinif) => (sinif === "kripto" ? "BINANCE:" + s.replace(/-USD$/, "USDT") : s);
const GOSTERGELER = [
  ["rsi", "RSI (14)", "RSI@tv-basicstudies"],
  ["ma50", "Moving average 50", { id: "MASimple@tv-basicstudies", inputs: { length: 50 } }],
  ["ma200", "Moving average 200", { id: "MASimple@tv-basicstudies", inputs: { length: 200 } }],
  ["ema21", "Exponential MA 21", { id: "MAExp@tv-basicstudies", inputs: { length: 21 } }],
  ["bb", "Bollinger Bands", "BB@tv-basicstudies"],
  ["macd", "MACD", "MACD@tv-basicstudies"],
  ["stochrsi", "Stochastic RSI", "StochasticRSI@tv-basicstudies"],
  ["hacim", "Volume", "Volume@tv-basicstudies"],
];
const grafikAyar = () => {
  const g = (D && D.ayarlar.grafik) || {};
  return { semboller: g.semboller || [], gostergeler: g.gostergeler || [] };
};
function tvAc(sembol) {
  TV_SEMBOL = sembol;
  $("#tv-kap").innerHTML = "";
  const studies = grafikAyar().gostergeler.map((k) => (GOSTERGELER.find((x) => x[0] === k) || [])[2]).filter(Boolean);
  const kur2 = () => new TradingView.widget({ autosize: true, symbol: sembol, interval: "D", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC", theme: "dark", style: "1",
    locale: "en", allow_symbol_change: true, container_id: "tv-kap", backgroundColor: "#131a2c", studies });
  if (tvYuklendi) return kur2();
  const s = document.createElement("script"); s.src = "https://s3.tradingview.com/tv.js";
  s.onload = () => { tvYuklendi = true; kur2(); };
  s.onerror = () => { $("#tv-kap").innerHTML = `<div class="bos-durum">TradingView failed to load. Check your internet connection.</div>`; };
  document.head.appendChild(s);
}
function grafikSayfasi() {
  const oto = [...new Set(D.varliklar.filter((v) => v.acik).map((v) => (v.sinif === "opsiyon" ? v.opsiyon.dayanak : tvSembol(v.sembol, v.sinif)))
    .concat(D.izleme.map((w) => tvSembol(w.sembol, w.sinif))))];
  const benim = grafikAyar().semboller;
  const kisa = (x) => x.replace(/BINANCE:|CRYPTOCAP:|NASDAQ:|NYSE:|TVC:/g, "");
  $("#tv-hizli").innerHTML =
    benim.map((x) => `<span class="ozel-sembol"><button class="btn kucuk" data-tv="${esc(x)}">${esc(kisa(x))}</button><button class="sil-x" data-tv-sil="${esc(x)}" title="Remove" aria-label="Remove">×</button></span>`).join("") +
    `<button class="btn kucuk" id="tv-ekle" title="Add your own symbol">+ Add</button>` +
    (oto.length ? `<span class="ayrac"></span>` : "") +
    oto.filter((x) => !benim.includes(x)).slice(0, 14).map((x) => `<button class="btn kucuk" data-tv="${esc(x)}">${esc(kisa(x))}</button>`).join("");
  if (!$("#tv-kap").childElementCount) tvAc(benim[0] || oto[0] || "NASDAQ:NDX");
}
async function grafikAyarKaydet(degisiklik) {
  const r = await api("POST", "/api/grafik-ayar", degisiklik);
  D.ayarlar.grafik = r.grafik;
}
function tvEkleModal() {
  modalAc(`<h3>Add quick button</h3><p class="aciklama">Type the symbol exactly as on TradingView, e.g. TVC:DXY, NASDAQ:SMH, BINANCE:ETHUSDT, CRYPTOCAP:BTC.D</p>
    <div class="form">${alan("tvs", "Symbol", "text", TV_SEMBOL || "", "tam")}</div>${altBtn("Add")}`);
  const b = $("#m-kaydet");
  const calis = async () => {
    const x = val("tvs"); if (!x) return modalHata("Enter a symbol.");
    const l = grafikAyar().semboller; if (!l.includes(x)) l.push(x);
    try { await grafikAyarKaydet({ semboller: l }); modalKapat(); grafikSayfasi(); bildir("Added"); } catch (e) { modalHata(e.message); }
  };
  b.addEventListener("click", calis);
  $("#modal").addEventListener("keydown", (e) => { if (e.key === "Enter") calis(); });
}
function gostergeModal() {
  const secili = grafikAyar().gostergeler;
  modalAc(`<h3>Default indicators</h3><p class="aciklama">The ones you pick open on every chart. Indicators added inside the chart are lost when you switch symbols, so pick the ones you want to keep here. If you change the symbol from the chart's top-left box, indicators stay anyway.</p>
    <div class="satir-liste">${GOSTERGELER.map(([k, a]) => `<label style="display:flex;gap:10px;align-items:center;padding:6px 0;cursor:pointer">
      <input type="checkbox" data-gs="${k}" ${secili.includes(k) ? "checked" : ""} style="width:auto"> ${a}</label>`).join("")}</div>${altBtn()}`);
  $("#m-kaydet").addEventListener("click", async () => {
    const l = $$("[data-gs]").filter((x) => x.checked).map((x) => x.dataset.gs);
    try { await grafikAyarKaydet({ gostergeler: l }); modalKapat(); if (TV_SEMBOL) tvAc(TV_SEMBOL); bildir("Saved"); } catch (e) { modalHata(e.message); }
  });
}

// ================================================================== events
function sayfaGoster(ad) {
  $$(".sekme").forEach((s) => s.classList.toggle("aktif", s.dataset.sayfa === ad));
  $$(".sayfa").forEach((s) => s.classList.toggle("aktif", s.id === "sayfa-" + ad));
  yerelYaz("sayfa", ad);
  if (!D) return;
  if (ad === "grafik") grafikSayfasi();
  if (ad === "ana") anaEkran();
  if (ad === "varliklar") varliklarSayfasi();
  if (ad === "senaryo") senaryoHesapla();
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a, [data-detay], [data-izleme-detay], [data-sinif-git], [data-nakit-gecmis]");
  if (!t) { if (!e.target.closest(".acilir")) kapatAcilir(); return; }
  if (t.closest(".acilir")) return;
  if (t.classList.contains("sekme")) return sayfaGoster(t.dataset.sayfa);
  if (t.dataset.para) { PARA = t.dataset.para; yerelYaz("para", PARA); $$("#para-secim button").forEach((b) => b.classList.toggle("aktif", b.dataset.para === PARA)); ciz(); return senaryoHesapla(); }
  if (t.closest("#dagilim-secim")) { DAGILIM = t.dataset.v; $$("#dagilim-secim button").forEach((b) => b.classList.toggle("aktif", b === t)); return anaEkran(); }
  const ar = t.closest(".aralik");
  if (ar && t.dataset.g !== undefined) { ARALIK[ar.dataset.hedef] = +t.dataset.g; $$("button", ar).forEach((b) => b.classList.toggle("aktif", b === t)); return ar.dataset.hedef === "ana" ? anaEkran() : varliklarSayfasi(); }
  if (t.closest("#katki-secim")) { KATKI = t.dataset.k; $$("#katki-secim button").forEach((b) => b.classList.toggle("aktif", b === t)); return katkiGrafik(); }
  if (t.closest("#g-filtre")) { GFILTRE = t.dataset.f; $$("#g-filtre button").forEach((b) => b.classList.toggle("aktif", b === t)); return gecmisSayfasi(); }
  if (t.closest("#v-alt-sekmeler")) { VSINIF = t.dataset.sinif; yerelYaz("vsinif", VSINIF); return varliklarSayfasi(); }
  if (t.dataset.sinifGit) { VSINIF = t.dataset.sinifGit; yerelYaz("vsinif", VSINIF); return varliklarSayfasi(); }
  if (t.dataset.nakitGecmis) return nakitGecmisiModal();
  if (t.dataset.nakitAc) return nakitModal(t.dataset.nakitAc);
  if (t.closest("#s-tur")) { S.tur = t.dataset.tur; $$("#s-tur button").forEach((b) => b.classList.toggle("aktif", b === t)); if (S.sembol) senaryoVade(); return; }
  if (t.id === "s-getir") return senaryoGetir($("#s-sembol").value);
  if (t.id === "yenile-btn") { seritYukle(); return yukle(true); }
  if (t.id === "ayar-btn") return ayarModal();
  if (t.id === "paylas-portfoy") return paylasimModal(null);
  if (t.id === "sinif-ekle-btn") return varlikEkleModal({ sinif: VSINIF });
  if (t.id === "yatir-btn") return nakitModal("yatir");
  if (t.id === "cek-btn") return nakitModal("cek");
  if (t.id === "izleme-ekle-btn") return izlemeModal();
  if (t.id === "ay-geri" || t.id === "ay-ileri") { const d = new Date(AY.y, AY.m + (t.id === "ay-ileri" ? 1 : -1), 1); AY = { y: d.getFullYear(), m: d.getMonth() }; return takvim(); }
  if (t.dataset.menu) { e.stopPropagation(); return varlikMenusu(t.dataset.menu, t); }
  if (t.dataset.izlemeMenu) { e.stopPropagation(); return izlemeMenusu(t.dataset.izlemeMenu, t); }
  if (t.dataset.tpSat) { const [vid, hid] = t.dataset.tpSat.split("|"), v = D.varliklar.find((x) => x.id === vid), h = v.kar_al.find((x) => x.id === hid);
    return satisModal(v, { miktar: +(v.miktar * h.yuzde / 100).toFixed(8), fiyat: v.fiyat, kar_al_id: hid }); }
  if (t.dataset.kdAl) { const [vid, kid] = t.dataset.kdAl.split("|"), v = D.varliklar.find((x) => x.id === vid), k = v.kademeli.find((x) => x.id === kid);
    return alimModal(v, { miktar: +(k.tutar / k.fiyat / (v.sinif === "opsiyon" ? 100 : 1)).toFixed(8), fiyat: k.fiyat, kademeli_id: kid }); }
  if (t.dataset.aldim) { const w = D.izleme.find((x) => x.id === t.dataset.aldim); cekmeceKapat();
    return varlikEkleModal({ sinif: w.sinif, sembol: w.sembol.replace(/-USD$/, ""), ad: w.ad, fiyat: (w.sinif === "kripto" && CANLI[w.sembol]) || w.fiyat || "", izleme_id: w.id }); }
  if (t.dataset.izlemePlan) return kademeliModal(D.izleme.find((x) => x.id === t.dataset.izlemePlan), "izleme");
  if (t.dataset.izlemeDuzenle) return izlemeModal(D.izleme.find((x) => x.id === t.dataset.izlemeDuzenle));
  if (t.dataset.izlemeSil) return izlemeSil(D.izleme.find((x) => x.id === t.dataset.izlemeSil));
  if (t.dataset.lw) {
    if (t.dataset.lw === LW_ARALIK || !LW_SECENEK) return;
    LW_ARALIK = t.dataset.lw; yerelYaz("lw_aralik", LW_ARALIK);
    $$("#lw-aralik button").forEach((b) => b.classList.toggle("aktif", b === t));
    if (LW) { LW.chart.remove(); LW = null; }
    $("#lw-kap").innerHTML = `<div class="bos-durum" style="border:0">Loading…</div>`;
    return fiyatGrafigi(LW_SECENEK.sembol, LW_SECENEK.secenek);
  }
  if (t.dataset.cekmeceKapat !== undefined) return cekmeceKapat();
  if (t.dataset.cekmeceIslem) { const v = D.varliklar.find((x) => x.id === CEKMECE.id); return varlikIslemi(v, t.dataset.cekmeceIslem); }
  if (t.dataset.islemSil) {
    if (!confirm("Delete this trade? Cash and position will be recalculated.")) return;
    return api("DELETE", `/api/islem/${t.dataset.islemSil}`).then(() => { yukle(); bildir("Trade deleted"); }).catch((err) => bildir(err.message));
  }
  if (t.dataset.yedekDon) {
    if (!confirm(`Restore backup ${t.dataset.yedekDon}? Your current data will be saved separately.`)) return;
    return api("POST", "/api/yedekler/geri", { dosya: t.dataset.yedekDon }).then(() => { modalKapat(); yukle(); bildir("Backup restored"); }).catch((err) => modalHata(err.message));
  }
  if (t.dataset.nakitSil) { if (confirm("Delete this entry?")) api("DELETE", `/api/nakit/${t.dataset.nakitSil}`).then(() => { modalKapat(); yukle(); }); return; }
  if (t.dataset.tv) return tvAc(t.dataset.tv);
  if (t.dataset.tvSil) { const l = grafikAyar().semboller.filter((x) => x !== t.dataset.tvSil); return grafikAyarKaydet({ semboller: l }).then(grafikSayfasi); }
  if (t.id === "tv-ekle") return tvEkleModal();
  if (t.id === "tv-gosterge") return gostergeModal();
  if (t.id === "tv-git") { const s = $("#tv-sembol").value.trim(); if (s) tvAc(s); return; }
  if (t.dataset.detay) return cekmeceAc("varlik", t.dataset.detay);
  if (t.dataset.izlemeDetay) return cekmeceAc("izleme", t.dataset.izlemeDetay);
});
$("#perde").addEventListener("click", (e) => { if (e.target.id === "perde") modalKapat(); });
$("#cekmece-perde").addEventListener("click", cekmeceKapat);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if ($("#perde").classList.contains("acik")) modalKapat(); else cekmeceKapat(); kapatAcilir(); } });
$("#g-ara").addEventListener("input", () => D && gecmisSayfasi());
$("#tv-sembol").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#tv-git").click(); });
$("#yedek-dosya").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (!confirm("Your current data will be replaced with this backup. Continue?")) return;
  try { await api("POST", "/api/yedek", await f.text()); modalKapat(); await yukle(); bildir("Backup restored"); } catch (err) { bildir(err.message); }
  e.target.value = "";
});
// options calculator inputs
$("#s-sembol").addEventListener("keydown", (e) => { if (e.key === "Enter") senaryoGetir(e.target.value); });
$("#s-vade").addEventListener("change", () => senaryoVade());
$("#s-vade-elle").addEventListener("change", () => { S.vade = $("#s-vade-elle").value; senaryoKaydiricilariKur(); });
$("#s-strike").addEventListener("change", () => senaryoStrike());
$("#s-strike-elle").addEventListener("input", () => { S.strike = Number(String($("#s-strike-elle").value).replace(",", ".")) || null; senaryoKaydiricilariKur(); });
["#s-adet", "#s-prim", "#s-iv"].forEach((id) => $(id).addEventListener("input", senaryoKaydiricilariKur));
["#s-f", "#s-t", "#s-v"].forEach((id) => $(id).addEventListener("input", senaryoHesapla));
$("#s-yukle").addEventListener("change", (e) => { const v = D.varliklar.find((x) => x.id === e.target.value); if (v) senaryoyaYukle(v); });

// ================================================================== startup
$$("#para-secim button").forEach((b) => b.classList.toggle("aktif", b.dataset.para === PARA));
sayfaGoster(yerelOku("sayfa") || "ana");
piyasaCiz(); setInterval(piyasaCiz, 30000);
seritCiz(); seritYukle(); setInterval(seritYukle, 60000);
yukle().then(okxBaglan);
setInterval(() => { if (!$("#perde").classList.contains("acik")) yukle(false, true); }, 2 * 60 * 1000);
// heartbeat so the background server stops when the app window closes
const nabiz = () => fetch("/api/nabiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
nabiz(); setInterval(nabiz, 20000);
