/**
 * Tableau de bord fondateur — page unique (HTML + CSS + JS), servie par la Lambda admin.
 *
 * Règles de sécurité de ce fichier :
 *  - CSP stricte (nonce) : aucun handler inline, aucun style inline dans le HTML généré ;
 *  - toute donnée venant de l'API passe par `esc()` avant d'entrer dans le DOM ;
 *  - le JS client n'utilise ni backtick ni `${` (il vit dans un String.raw).
 */

const CSS = String.raw`
:root{--bg:#f3f4f6;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#5dc705;--accent-d:#3f8f00;--warn:#d97706;--money:#2563eb;--danger:#dc2626;--chip:#eef2f7}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f14;--card:#141a22;--text:#e5e7eb;--muted:#94a3b8;--line:#243041;--chip:#1c2633}}
*{box-sizing:border-box}html,body{margin:0}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);font-size:14px}
button,input,select,textarea{font:inherit;color:inherit}
.hidden{display:none!important}
.top{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;padding:8px 12px}
.brand{font-weight:800;color:var(--accent-d);font-size:17px}
.tabs{display:flex;gap:4px;overflow-x:auto;flex:1;scrollbar-width:none}
.tab{border:0;background:transparent;padding:8px 12px;border-radius:8px;color:var(--muted);cursor:pointer;white-space:nowrap;font-weight:600}
.tab.on{background:var(--chip);color:var(--text)}
.wrap{max-width:1100px;margin:0 auto;padding:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}
h2{margin:0 0 10px;font-size:16px}h3{margin:0 0 8px;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.kpi b{display:block;font-size:21px}.kpi span{color:var(--muted);font-size:12px}.kpi i{display:block;font-style:normal;font-size:11px;color:var(--muted);margin-top:2px}
.up{color:var(--accent-d)}.down{color:var(--danger)}
.btn{background:var(--text);color:var(--bg);border:0;border-radius:8px;padding:9px 14px;cursor:pointer;font-weight:600}
.btn.green{background:var(--accent);color:#0b2200}.btn.red{background:var(--danger);color:#fff}.btn.ghost{background:var(--chip);color:var(--text)}
.btn:disabled{opacity:.5;cursor:default}
input,select,textarea{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:9px 10px;width:100%}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.chip{border:1px solid var(--line);background:var(--chip);border-radius:999px;padding:5px 11px;cursor:pointer;font-size:12px;font-weight:600;color:var(--muted)}
.chip.on{background:var(--accent);border-color:var(--accent);color:#0b2200}
.feed{list-style:none;margin:0;padding:0}
.ev{border-bottom:1px solid var(--line);padding:10px 4px;cursor:pointer}
.ev.fresh{animation:fresh 2.2s ease-out}
@keyframes fresh{from{background:rgba(93,199,5,.25)}to{background:transparent}}
.ev-h{display:flex;gap:8px;align-items:flex-start}
.tag{flex:none;font-size:11px;font-weight:700;border-radius:6px;padding:3px 7px;background:var(--chip);color:var(--muted)}
.tag.money{background:rgba(37,99,235,.15);color:var(--money)}.tag.alert{background:rgba(217,119,6,.18);color:var(--warn)}.tag.info{background:rgba(93,199,5,.18);color:var(--accent-d)}
.ev-t{flex:1;font-weight:600}.ev-s{color:var(--muted);font-size:12px;margin-top:2px}.ev-d{color:var(--muted);font-size:11px;flex:none;white-space:nowrap}
.ev-body{margin-top:8px;display:none;background:var(--chip);border-radius:8px;padding:8px 10px}
.ev.open .ev-body{display:block}
.kv{display:grid;grid-template-columns:150px 1fr;gap:3px 10px;font-size:12px}.kv div:nth-child(odd){color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted);font-weight:600;font-size:12px}
.r{text-align:right}.scroll{overflow-x:auto}
tr.click{cursor:pointer}tr.click:hover{background:var(--chip)}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;z-index:20}
@media(min-width:700px){.modal{align-items:center}}
.sheet{background:var(--card);border-radius:16px 16px 0 0;padding:18px;width:100%;max-width:520px;max-height:92vh;overflow:auto}
@media(min-width:700px){.sheet{border-radius:16px}}
.muted{color:var(--muted)}.small{font-size:12px}
.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:10px;z-index:40;max-width:90vw}
.toast.err{background:var(--danger);color:#fff}
.login{max-width:380px;margin:12vh auto;padding:0 14px}
.err{color:var(--danger);font-size:13px;margin-top:8px}
svg.chart{width:100%;height:120px;display:block}svg.chart rect{fill:var(--accent)}svg.chart rect.b2{fill:var(--money)}
.legend{font-size:11px;color:var(--muted);margin-top:4px}
.switch{display:flex;align-items:center;gap:6px}.switch input{width:auto}
.between{justify-content:space-between}.mt{margin-top:12px}.mv{margin:12px 0}.my8{margin:8px 0}.grow{flex:1}.w170{max-width:170px}.w120{max-width:120px}
`;

const JS = String.raw`
(function () {
  "use strict";
  var BASE = location.pathname.replace(/\/+$/, "");
  var $ = function (id) { return document.getElementById(id); };
  var TYPES = {
    signup: ["Inscription", "info"], login: ["Connexion", "info"], app_open: ["Ouverture", ""],
    message: ["Message", ""], payment: ["Paiement", "money"], transfer: ["Envoi", "money"],
    deposit: ["Recharge", "alert"], withdrawal: ["Retrait", "alert"],
    user_deleted: ["Suppression", "alert"], admin_action: ["Action admin", "alert"]
  };
  var state = { tab: "live", events: [], seen: {}, cursor: null, filters: {}, polls: 0, elev: null, elevUntil: 0, unread: 0, settings: null, notif: false };

  function esc(v) {
    return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fcfa(n) { return (Math.round(Number(n) || 0)).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ") + " FCFA"; }
  function num(n) { return (Math.round(Number(n) || 0)).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " "); }
  function pct(v) { return v === null || v === undefined ? "—" : (v * 100).toFixed(1).replace(".", ",") + " %"; }
  function local(iso) {
    var d = new Date(Date.parse(iso) + 3600000), p = function (n) { return String(n).padStart(2, "0"); };
    return p(d.getUTCDate()) + "/" + p(d.getUTCMonth() + 1) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
  }
  function ago(iso) {
    var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return "il y a " + s + " s";
    if (s < 3600) return "il y a " + Math.round(s / 60) + " min";
    if (s < 86400) return "il y a " + Math.round(s / 3600) + " h";
    return "il y a " + Math.round(s / 86400) + " j";
  }
  function delta(p) {
    if (p === null || p === undefined) return "";
    if (p === 0) return "= stable";
    return (p > 0 ? "▲ +" : "▼ ") + String(p).replace(".", ",") + " %";
  }
  function toast(msg, err) {
    var t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 6000 : 3000);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { "X-Requested-With": "blyp-admin" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.elevate && state.elev) headers["X-Admin-Elevation"] = state.elev;
    return fetch(BASE + "/api" + path, {
      method: opts.method || "GET",
      headers: headers,
      credentials: "same-origin",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && data.code === "SESSION_REQUIRED") { showLogin(); }
        if (!res.ok) { var e = new Error(data.error || "Erreur"); e.status = res.status; e.data = data; throw e; }
        return data;
      });
    });
  }

  /* ---------- Connexion ---------- */
  function showLogin() { $("app").classList.add("hidden"); $("login").classList.remove("hidden"); stopPolling(); }
  function showApp() { $("login").classList.add("hidden"); $("app").classList.remove("hidden"); go(state.tab); startPolling(); }

  $("loginForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    $("loginErr").textContent = "";
    api("/login", { method: "POST", body: { email: $("lEmail").value, password: $("lPass").value, totp: $("lTotp").value } })
      .then(function () { $("lPass").value = ""; $("lTotp").value = ""; showApp(); })
      .catch(function (e) { $("loginErr").textContent = e.message; });
  });
  $("logout").addEventListener("click", function () {
    api("/logout", { method: "POST", body: {} }).finally(function () { state.elev = null; showLogin(); });
  });

  /* ---------- Onglets ---------- */
  var tabs = document.querySelectorAll(".tab");
  Array.prototype.forEach.call(tabs, function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-tab")); }); });
  function go(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(tabs, function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === tab); });
    ["live", "overview", "users", "investor", "settings", "audit"].forEach(function (t) { $("p-" + t).classList.toggle("hidden", t !== tab); });
    if (tab === "live") { state.unread = 0; updateTitle(); renderFeed(); }
    if (tab === "overview") loadOverview();
    if (tab === "users") loadUsers();
    if (tab === "investor") loadInvestor();
    if (tab === "settings") loadSettings();
    if (tab === "audit") loadAudit();
  }

  /* ---------- Direct ---------- */
  function renderChips() {
    var html = "";
    Object.keys(TYPES).forEach(function (t) {
      html += '<button class="chip' + (state.filters[t] === false ? "" : " on") + '" data-t="' + t + '">' + esc(TYPES[t][0]) + "</button>";
    });
    $("chips").innerHTML = html;
    Array.prototype.forEach.call($("chips").querySelectorAll(".chip"), function (c) {
      c.addEventListener("click", function () {
        var t = c.getAttribute("data-t");
        state.filters[t] = state.filters[t] === false ? true : false;
        renderChips(); renderFeed();
      });
    });
  }
  function eventHtml(e, fresh) {
    var meta = TYPES[e.type] || [e.type, ""];
    var lines = "";
    (e.lines || []).forEach(function (l) { lines += "<div>" + esc(l[0]) + "</div><div>" + esc(l[1]) + "</div>"; });
    var openUser = e.userId ? '<div class="row"><button class="btn ghost small" data-user="' + esc(e.userId) + '">Voir la fiche</button></div>' : "";
    return '<li class="ev' + (fresh ? " fresh" : "") + '" data-id="' + esc(e.id) + '">' +
      '<div class="ev-h"><span class="tag ' + esc(e.severity === "info" ? meta[1] : e.severity) + '">' + esc(meta[0]) + "</span>" +
      '<div class="ev-t">' + esc(e.title) + '<div class="ev-s">' + esc(e.summary) + "</div></div>" +
      '<div class="ev-d" title="' + esc(local(e.at)) + '">' + esc(ago(e.at)) + "</div></div>" +
      '<div class="ev-body"><div class="kv">' + lines + "</div>" + openUser + "</div></li>";
  }
  function renderFeed(freshIds) {
    var html = "", n = 0;
    state.events.forEach(function (e) {
      if (state.filters[e.type] === false) return;
      n++;
      html += eventHtml(e, freshIds && freshIds[e.id]);
    });
    $("feed").innerHTML = html || '<li class="muted small">Aucun événement pour le moment.</li>';
    $("feedCount").textContent = n + " événement(s)";
  }
  $("feed").addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-user]");
    if (btn) { openUser(btn.getAttribute("data-user")); return; }
    var li = ev.target.closest(".ev");
    if (li) li.classList.toggle("open");
  });

  function mergeEvents(items, markFresh) {
    var fresh = {}, added = 0;
    items.forEach(function (e) {
      if (state.seen[e.id]) return;
      state.seen[e.id] = true; added++; fresh[e.id] = true;
      state.events.push(e);
    });
    state.events.sort(function (a, b) { return a.key < b.key ? 1 : a.key > b.key ? -1 : 0; });
    if (state.events.length > 400) { state.events.length = 400; }
    return { fresh: markFresh ? fresh : null, added: added };
  }
  function loadFeed(full) {
    var q = "/events?limit=" + (full || !state.cursor ? 150 : 200);
    if (!full && state.cursor) q += "&since=" + encodeURIComponent(state.cursor);
    return api(q).then(function (d) {
      var firstLoad = !state.cursor;
      var m = mergeEvents(d.items, !firstLoad);
      if (d.cursor && (!state.cursor || d.cursor > state.cursor)) state.cursor = d.cursor;
      if (m.added && !firstLoad) {
        if (state.tab === "live") renderFeed(m.fresh); else { state.unread += m.added; updateTitle(); }
        browserNotify(d.items);
      } else if (firstLoad) { renderFeed(); }
    });
  }
  function updateTitle() { document.title = (state.unread ? "(" + state.unread + ") " : "") + "Blyp — Fondateur"; }
  var timer = null;
  function startPolling() {
    stopPolling();
    state.cursor = null; state.events = []; state.seen = {}; state.polls = 0;
    loadFeed(true).catch(function () {});
    timer = setInterval(function () {
      if (document.hidden && state.polls % 4 !== 0) { state.polls++; return; }
      state.polls++;
      loadFeed(state.polls % 6 === 0).catch(function () {});
      if (state.tab === "live") { Array.prototype.forEach.call(document.querySelectorAll(".ev-d"), function () {}); }
    }, 5000);
  }
  function stopPolling() { if (timer) clearInterval(timer); timer = null; }

  /* Notifications navigateur (onglet ouvert) */
  $("notifBtn").addEventListener("click", function () {
    if (!("Notification" in window)) { toast("Navigateur non compatible", true); return; }
    Notification.requestPermission().then(function (p) { state.notif = p === "granted"; toast(state.notif ? "Alertes navigateur activées" : "Refusé"); });
  });
  function browserNotify(items) {
    if (!state.notif || !document.hidden) return;
    items.slice(0, 3).forEach(function (e) {
      if (e.type === "app_open") return;
      try { new Notification(e.title, { body: e.summary }); } catch (x) {}
    });
  }

  /* ---------- Aperçu ---------- */
  function kpi(label, value, sub, d) {
    return '<div class="kpi"><span>' + esc(label) + "</span><b>" + esc(value) + "</b><i" + (d && d.indexOf("▲") === 0 ? ' class="up"' : d && d.indexOf("▼") === 0 ? ' class="down"' : "") + ">" + esc(sub || "") + (d ? " " + esc(d) : "") + "</i></div>";
  }
  function bars(values, cls) {
    var max = Math.max.apply(null, values.concat([1])), w = 100 / values.length, out = '<svg class="chart" viewBox="0 0 100 40" preserveAspectRatio="none">';
    values.forEach(function (v, i) {
      var h = Math.max(v > 0 ? 0.8 : 0, (v / max) * 38);
      out += '<rect class="' + (cls || "") + '" x="' + (i * w + w * 0.12).toFixed(2) + '" y="' + (40 - h).toFixed(2) + '" width="' + (w * 0.76).toFixed(2) + '" height="' + h.toFixed(2) + '"></rect>';
    });
    return out + "</svg>";
  }
  function loadOverview() {
    api("/overview").then(function (o) {
      var t = o.totals, td = o.today, y = o.yesterday, a = o.actives;
      $("ovKpis").innerHTML =
        kpi("Inscrits (total)", num(t.users), num(t.deletedUsers) + " supprimés") +
        kpi("Actifs aujourd'hui", num(a.dau), "WAU " + num(a.wau) + " · MAU " + num(a.mau)) +
        kpi("Nouveaux aujourd'hui", num(td.newUsers), "hier " + num(y.newUsers)) +
        kpi("Ouvertures aujourd'hui", num(td.appOpens), "hier " + num(y.appOpens)) +
        kpi("Messages aujourd'hui", num(td.messages), "hier " + num(y.messages)) +
        kpi("Transactions aujourd'hui", num(td.txCount), "hier " + num(y.txCount)) +
        kpi("GMV aujourd'hui", fcfa(td.gmvFcfa), "hier " + fcfa(y.gmvFcfa)) +
        kpi("Recharges aujourd'hui", fcfa(td.depositVolumeFcfa), td.deposits + " recharge(s)") +
        kpi("Retraits aujourd'hui", fcfa(td.withdrawalVolumeFcfa), td.withdrawals + " retrait(s)") +
        kpi("Activation", pct(o.activationRate), "≥ 1 paiement commerçant") +
        kpi("Commerçants ayant encaissé", num(t.payingMerchants), "") +
        kpi("GMV total", fcfa(t.gmvFcfa), num(t.txCount) + " transactions");
      var s = o.series;
      $("chGmv").innerHTML = bars(s.map(function (r) { return r.gmvFcfa; })) + '<div class="legend">GMV par jour — 30 jours (max ' + esc(fcfa(Math.max.apply(null, s.map(function (r) { return r.gmvFcfa; })))) + ")</div>";
      $("chUsers").innerHTML = bars(s.map(function (r) { return r.newUsers; })) + '<div class="legend">Nouveaux inscrits par jour</div>';
      $("chActive").innerHTML = bars(s.map(function (r) { return r.activeUsers; }), "b2") + '<div class="legend">Utilisateurs actifs par jour</div>';
      $("ovMonth").innerHTML = "7 jours : " + num(o.last7.newUsers) + " inscrits · " + fcfa(o.last7.gmvFcfa) + " de GMV — 30 jours : " + num(o.last30.newUsers) + " inscrits · " + fcfa(o.last30.gmvFcfa) + " de GMV.";
    }).catch(function (e) { toast(e.message, true); });
  }
  $("floatBtn").addEventListener("click", function () {
    $("floatOut").textContent = "Calcul en cours…";
    api("/float", { method: "POST", body: {} }).then(function (f) {
      $("floatOut").textContent = "Float réel : " + fcfa(f.totalFloatFcfa) + " (clients " + fcfa(f.userBalancesFcfa) + " · commerces " + fcfa(f.commerceBalancesFcfa) + ") — " + num(f.holders) + " comptes avec solde" + (f.complete ? "" : " (partiel)");
    }).catch(function (e) { $("floatOut").textContent = e.message; });
  });

  /* ---------- Utilisateurs ---------- */
  function loadUsers() {
    var q = $("userQ").value.trim();
    $("userList").innerHTML = '<tr><td colspan="5" class="muted">Chargement…</td></tr>';
    api("/users?q=" + encodeURIComponent(q)).then(function (d) {
      var html = "";
      d.users.forEach(function (u) {
        html += '<tr class="click" data-id="' + esc(u.userId) + '"><td>' + esc((u.firstName || "") + " " + (u.lastName || "")) + (u.payBlocked ? " 🔒" : "") + (u.hasPin ? "" : ' <span class="muted small">(inscription incomplète)</span>') + "</td><td>" + esc(u.phone || "") + '</td><td class="r">' + esc(fcfa(u.balanceFcfa)) + "</td><td>" + esc((u.createdAt || "").slice(0, 10)) + "</td><td>" + (u.isMerchant ? "Pro" : "") + "</td></tr>";
      });
      $("userList").innerHTML = html || '<tr><td colspan="5" class="muted">Aucun résultat.</td></tr>';
      $("userCount").textContent = d.total + " utilisateur(s)" + (d.truncated ? " (liste partielle)" : "");
    }).catch(function (e) { toast(e.message, true); });
  }
  $("userSearch").addEventListener("submit", function (ev) { ev.preventDefault(); loadUsers(); });
  $("userList").addEventListener("click", function (ev) { var tr = ev.target.closest("tr[data-id]"); if (tr) openUser(tr.getAttribute("data-id")); });

  /* ---------- Modales ---------- */
  function modal(html) {
    var m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = '<div class="sheet">' + html + "</div>";
    m.addEventListener("click", function (ev) { if (ev.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
  }
  function ensureElevation() {
    if (state.elev && Date.now() < state.elevUntil) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var m = modal('<h2>Confirmation de sécurité</h2><p class="muted small">Action sensible : saisissez de nouveau votre mot de passe et un nouveau code de l\'application d\'authentification.</p><form id="elForm"><label>Mot de passe</label><input type="password" id="elPass" autocomplete="current-password" required><label>Code à 6 chiffres</label><input id="elTotp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required><div class="err" id="elErr"></div><div class="row mt"><button class="btn green" type="submit">Confirmer</button><button class="btn ghost" type="button" id="elCancel">Annuler</button></div></form>');
      $("elCancel").addEventListener("click", function () { m.remove(); reject(new Error("Annulé")); });
      $("elForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        api("/elevate", { method: "POST", body: { password: $("elPass").value, totp: $("elTotp").value } }).then(function (d) {
          state.elev = d.elevation; state.elevUntil = Date.now() + (d.expiresInSec - 10) * 1000; m.remove(); resolve();
        }).catch(function (e) { $("elErr").textContent = e.message; });
      });
    });
  }
  function sensitive(path, body, method) {
    return ensureElevation().then(function () {
      return api(path, { method: method || "POST", body: body, elevate: true });
    }).catch(function (e) {
      if (e && e.data && e.data.code === "ELEVATION_REQUIRED") { state.elev = null; return sensitive(path, body, method); }
      throw e;
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function openUser(id) {
    api("/users/" + encodeURIComponent(id)).then(function (d) {
      var p = d.profile, name = ((p.firstName || "") + " " + (p.lastName || "")).trim() || p.phone;
      var tx = "";
      d.transactions.slice(0, 15).forEach(function (t) {
        tx += "<tr><td>" + esc((t.createdAt || "").slice(5, 16).replace("T", " ")) + "</td><td>" + esc(t.type || "") + "</td><td>" + esc(t.counterpartyName || "") + '</td><td class="r">' + esc(num(t.amountFcfa)) + "</td></tr>";
      });
      var com = d.commerces.map(function (c) { return esc(c.name) + " (" + esc(fcfa(c.balanceFcfa)) + ")"; }).join(" · ") || "—";
      var m = modal('<h2>' + esc(name) + "</h2><div class=\"kv\"><div>Téléphone</div><div>" + esc(p.phone) + "</div><div>Compte</div><div>" + esc(p.accountId) + "</div><div>Inscrit le</div><div>" + esc((p.createdAt || "").slice(0, 10)) + "</div><div>Solde</div><div><b>" + esc(fcfa(d.balanceFcfa)) + "</b></div><div>PIN défini</div><div>" + (p.hasPin ? "oui" : "non") + "</div><div>Paiements</div><div>" + (p.payBlocked ? "BLOQUÉS" : "autorisés") + "</div><div>Commerces</div><div>" + com + "</div></div>" +
        '<div class="row mv"><button class="btn green" id="uCredit">Créditer</button><button class="btn" id="uDebit">Débiter</button><button class="btn ghost" id="uBlock">' + (p.payBlocked ? "Débloquer" : "Bloquer") + ' paiements</button><button class="btn red" id="uDelete">Supprimer</button></div>' +
        '<h3>Dernières transactions</h3><div class="scroll"><table><tbody>' + (tx || '<tr><td class="muted">Aucune.</td></tr>') + "</tbody></table></div>");
      $("uCredit").addEventListener("click", function () { m.remove(); balanceForm(d, "credit"); });
      $("uDebit").addEventListener("click", function () { m.remove(); balanceForm(d, "debit"); });
      $("uBlock").addEventListener("click", function () { m.remove(); blockForm(d); });
      $("uDelete").addEventListener("click", function () { m.remove(); deleteForm(d); });
    }).catch(function (e) { toast(e.message, true); });
  }

  function balanceForm(d, dir) {
    var p = d.profile, name = ((p.firstName || "") + " " + (p.lastName || "")).trim() || p.phone, key = uuid();
    var m = modal("<h2>" + (dir === "credit" ? "Créditer" : "Débiter") + " " + esc(name) + '</h2><p class="muted small">Solde actuel : ' + esc(fcfa(d.balanceFcfa)) + '</p><form id="bForm"><label>Montant (FCFA)</label><input id="bAmt" type="number" min="1" max="10000000" step="1" inputmode="numeric" required><label>Motif (visible dans l\'audit)</label><input id="bWhy" minlength="3" maxlength="200" required><div class="err" id="bErr"></div><div class="row"><button class="btn ' + (dir === "credit" ? "green" : "red") + '" type="submit" id="bGo">Continuer</button><button class="btn ghost" type="button" id="bNo">Annuler</button></div></form>');
    $("bNo").addEventListener("click", function () { m.remove(); });
    $("bForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var amt = parseInt($("bAmt").value, 10);
      if (!(amt >= 1)) { $("bErr").textContent = "Montant invalide"; return; }
      if (!window.confirm((dir === "credit" ? "Créditer " : "Débiter ") + fcfa(amt) + " — " + name + " ?")) return;
      $("bGo").disabled = true;
      sensitive("/users/" + encodeURIComponent(p.userId) + "/balance", { direction: dir, amountFcfa: amt, reason: $("bWhy").value, idempotencyKey: key }).then(function (r) {
        m.remove(); toast("Fait. Nouveau solde : " + fcfa(r.balanceAfterFcfa)); if (state.tab === "users") loadUsers();
      }).catch(function (e) { $("bGo").disabled = false; $("bErr").textContent = e.message; });
    });
  }
  function blockForm(d) {
    var p = d.profile, block = !p.payBlocked;
    var m = modal("<h2>" + (block ? "Bloquer" : "Débloquer") + ' les paiements</h2><form id="kForm"><label>Motif</label><input id="kWhy" maxlength="200" required><div class="err" id="kErr"></div><div class="row"><button class="btn red" type="submit">Confirmer</button><button class="btn ghost" type="button" id="kNo">Annuler</button></div></form>');
    $("kNo").addEventListener("click", function () { m.remove(); });
    $("kForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      sensitive("/users/" + encodeURIComponent(p.userId) + "/block", { blocked: block, reason: $("kWhy").value }).then(function () { m.remove(); toast("Fait"); loadUsers(); }).catch(function (e) { $("kErr").textContent = e.message; });
    });
  }
  function deleteForm(d) {
    var p = d.profile;
    var m = modal('<h2>Supprimer ce compte</h2><p class="down small"><b>Irréversible.</b> Les données du compte sont effacées ; une archive (sans PIN) est conservée.</p><p class="small">Solde : <b>' + esc(fcfa(d.balanceFcfa)) + '</b></p><form id="dForm"><label>Tapez le numéro du client pour confirmer (' + esc(p.phone) + ')</label><input id="dPhone" required><label>Motif</label><input id="dWhy" maxlength="200" required>' + (d.balanceFcfa > 0 ? '<label class="switch"><input type="checkbox" id="dForfeit"> Abandonner le solde de ' + esc(fcfa(d.balanceFcfa)) + "</label>" : "") + '<div class="err" id="dErr"></div><div class="row"><button class="btn red" type="submit">Supprimer définitivement</button><button class="btn ghost" type="button" id="dNo">Annuler</button></div></form>');
    $("dNo").addEventListener("click", function () { m.remove(); });
    $("dForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      sensitive("/users/" + encodeURIComponent(p.userId) + "/delete", { confirmPhone: $("dPhone").value, reason: $("dWhy").value, forfeitBalance: !!($("dForfeit") && $("dForfeit").checked) }).then(function () { m.remove(); toast("Compte supprimé"); loadUsers(); }).catch(function (e) { $("dErr").textContent = e.message; });
    });
  }
  $("addUser").addEventListener("click", function () {
    var m = modal('<h2>Ajouter un utilisateur</h2><p class="muted small">Le compte est créé ; le client le termine avec son code SMS et son PIN.</p><form id="aForm"><label>Téléphone</label><input id="aPhone" inputmode="tel" placeholder="6XX XX XX XX" required><label>Prénom</label><input id="aFn" maxlength="80" required><label>Nom</label><input id="aLn" maxlength="80" required><div class="err" id="aErr"></div><div class="row"><button class="btn green" type="submit">Créer</button><button class="btn ghost" type="button" id="aNo">Annuler</button></div></form>');
    $("aNo").addEventListener("click", function () { m.remove(); });
    $("aForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      sensitive("/users", { phone: $("aPhone").value, firstName: $("aFn").value, lastName: $("aLn").value }).then(function () { m.remove(); toast("Compte créé"); loadUsers(); }).catch(function (e) { $("aErr").textContent = e.message; });
    });
  });

  /* ---------- Investisseurs ---------- */
  function loadInvestor() {
    api("/investor").then(function (d) {
      var o = d.overview, t = o.totals, a = o.actives;
      $("invKpis").innerHTML =
        kpi("Inscrits", num(t.users), "") + kpi("Activation", pct(o.activationRate), "") +
        kpi("GMV total", fcfa(t.gmvFcfa), num(t.txCount) + " tx") + kpi("Recharges", fcfa(t.depositVolumeFcfa), "") +
        kpi("DAU / MAU", pct(a.stickiness), "DAU " + num(a.dau) + " · MAU " + num(a.mau)) + kpi("Commerçants actifs", num(t.payingMerchants), "");
      var rows = "";
      d.monthly.forEach(function (m) {
        rows += "<tr><td>" + esc(m.month) + '</td><td class="r">' + num(m.newUsers) + '</td><td class="r">' + num(m.mau) + '</td><td class="r">' + num(m.txCount) + '</td><td class="r">' + num(m.gmvFcfa) + '</td><td class="r">' + num(m.avgTicketFcfa) + '</td><td class="r">' + num(m.depositVolumeFcfa) + '</td><td class="r">' + num(m.messages) + "</td></tr>";
      });
      $("monthly").innerHTML = rows || '<tr><td colspan="8" class="muted">Pas encore de données.</td></tr>';
      var cr = "";
      d.cohorts.filter(function (c) { return c.size > 0; }).slice(-30).forEach(function (c) {
        var age = Math.round((Date.parse(o.day) - Date.parse(c.day)) / 86400000);
        function cell(n, k) { return age >= k ? pct(c.size ? n / c.size : null) : "—"; }
        cr += "<tr><td>" + esc(c.day) + '</td><td class="r">' + num(c.size) + '</td><td class="r">' + cell(c.d1, 1) + '</td><td class="r">' + cell(c.d7, 7) + '</td><td class="r">' + cell(c.d30, 30) + "</td></tr>";
      });
      $("cohorts").innerHTML = cr || '<tr><td colspan="5" class="muted">Pas encore de cohorte.</td></tr>';
    }).catch(function (e) { toast(e.message, true); });
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-recap]"), function (b) {
    b.addEventListener("click", function () {
      b.disabled = true;
      api("/recap", { method: "POST", body: { kind: b.getAttribute("data-recap") } }).then(function () { toast("Récap envoyé (email + notification)"); }).catch(function (e) { toast(e.message, true); }).finally(function () { b.disabled = false; });
    });
  });
  $("expEvents").addEventListener("click", function () {
    var from = $("expFrom").value, to = $("expTo").value;
    var q = [];
    if (from) q.push("from=" + from);
    if (to) q.push("to=" + to);
    location.href = BASE + "/api/export/events.csv" + (q.length ? "?" + q.join("&") : "");
  });

  /* ---------- Réglages ---------- */
  function loadSettings() {
    api("/settings").then(function (s) {
      state.settings = s;
      var html = "";
      Object.keys(TYPES).forEach(function (t) {
        var v = s.notify[t] || {};
        html += "<tr><td>" + esc(TYPES[t][0]) + '</td><td><label class="switch"><input type="checkbox" data-n="' + t + '" data-k="push"' + (v.push ? " checked" : "") + '> push</label></td><td><label class="switch"><input type="checkbox" data-n="' + t + '" data-k="email"' + (v.email ? " checked" : "") + "> email</label></td></tr>";
      });
      $("notifRows").innerHTML = html;
      $("emailCap").value = s.emailPerMinuteCap;
    }).catch(function (e) { toast(e.message, true); });
  }
  $("saveSettings").addEventListener("click", function () {
    var notify = {};
    Array.prototype.forEach.call($("notifRows").querySelectorAll("input[data-n]"), function (i) {
      var t = i.getAttribute("data-n"); notify[t] = notify[t] || {}; notify[t][i.getAttribute("data-k")] = i.checked;
    });
    api("/settings", { method: "PUT", body: { notify: notify, emailPerMinuteCap: parseInt($("emailCap").value, 10) } }).then(function () { toast("Réglages enregistrés"); }).catch(function (e) { toast(e.message, true); });
  });

  /* ---------- Journal d'audit ---------- */
  function loadAudit() {
    api("/audit").then(function (d) {
      var html = "";
      d.items.forEach(function (a) {
        html += "<tr><td>" + esc(local(a.at)) + "</td><td>" + esc(a.action) + "</td><td>" + esc(a.target || "") + "</td><td>" + esc(a.result || "") + "</td><td>" + esc(a.ip || "") + "</td></tr>";
      });
      $("auditRows").innerHTML = html || '<tr><td colspan="5" class="muted">Rien pour le moment.</td></tr>';
    }).catch(function (e) { toast(e.message, true); });
  }
  $("reportLink").setAttribute("href", BASE + "/report");
  ["investor.csv", "cohorts.csv", "users.csv", "audit.csv"].forEach(function (f) {
    var el = $("exp-" + f.replace(".", "-")); if (el) el.setAttribute("href", BASE + "/api/export/" + f);
  });

  renderChips();
  api("/me").then(showApp, showLogin);
})();
`;

const TABS = [
  ["live", "Direct"],
  ["overview", "Aperçu"],
  ["users", "Utilisateurs"],
  ["investor", "Investisseurs"],
  ["settings", "Alertes"],
  ["audit", "Journal"],
];

export function renderDashboard({ nonce, configured }) {
  const tabs = TABS.map(([id, label]) => `<button class="tab" data-tab="${id}">${label}</button>`).join("");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>Blyp — Fondateur</title>
<style nonce="${nonce}">${CSS}</style></head><body>
<div id="login" class="login hidden">
  <div class="card">
    <div class="brand">Blyp · Fondateur</div>
    <p class="muted small">${configured ? "Accès réservé. Mot de passe + code de l'application d'authentification." : "Tableau de bord non configuré sur ce serveur."}</p>
    <form id="loginForm" ${configured ? "" : "class=\"hidden\""} autocomplete="on">
      <label for="lEmail">Email</label><input id="lEmail" type="email" autocomplete="username" required>
      <label for="lPass">Mot de passe</label><input id="lPass" type="password" autocomplete="current-password" required>
      <label for="lTotp">Code à 6 chiffres</label><input id="lTotp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required>
      <div class="err" id="loginErr"></div>
      <div class="row"><button class="btn green" type="submit">Entrer</button></div>
    </form>
  </div>
</div>

<div id="app" class="hidden">
  <div class="top"><span class="brand">Blyp</span><div class="tabs">${tabs}</div><button class="btn ghost" id="logout">Quitter</button></div>
  <div class="wrap">

    <section id="p-live">
      <div class="card">
        <div class="row between"><h2>En direct</h2><div class="row"><span class="muted small" id="feedCount"></span><button class="btn ghost" id="notifBtn">Alertes navigateur</button></div></div>
        <div class="chips" id="chips"></div>
        <ul class="feed" id="feed"></ul>
      </div>
    </section>

    <section id="p-overview" class="hidden">
      <div class="grid" id="ovKpis"></div>
      <div class="card mt"><div id="chGmv"></div></div>
      <div class="grid"><div class="card"><div id="chUsers"></div></div><div class="card"><div id="chActive"></div></div></div>
      <div class="card"><div class="small muted" id="ovMonth"></div></div>
      <div class="card"><h3>Float réel (somme de tous les soldes)</h3><div class="row"><button class="btn ghost" id="floatBtn">Calculer maintenant</button><span class="small" id="floatOut"></span></div></div>
    </section>

    <section id="p-users" class="hidden">
      <div class="card">
        <div class="row between"><h2>Utilisateurs</h2><button class="btn green" id="addUser">+ Ajouter</button></div>
        <form id="userSearch" class="row"><input id="userQ" class="grow" placeholder="Nom, téléphone ou ID de compte"><button class="btn" type="submit">Chercher</button></form>
        <div class="muted small" class="muted small my8" id="userCount"></div>
        <div class="scroll"><table><thead><tr><th>Nom</th><th>Téléphone</th><th class="r">Solde</th><th>Inscrit</th><th></th></tr></thead><tbody id="userList"></tbody></table></div>
      </div>
    </section>

    <section id="p-investor" class="hidden">
      <div class="grid" id="invKpis"></div>
      <div class="card">
        <h2>Évolution mensuelle</h2>
        <div class="scroll"><table><thead><tr><th>Mois</th><th class="r">Inscrits</th><th class="r">MAU</th><th class="r">Tx</th><th class="r">GMV</th><th class="r">Ticket moy.</th><th class="r">Recharges</th><th class="r">Messages</th></tr></thead><tbody id="monthly"></tbody></table></div>
      </div>
      <div class="card">
        <h2>Rétention par cohorte</h2>
        <div class="scroll"><table><thead><tr><th>Inscrits le</th><th class="r">Taille</th><th class="r">J+1</th><th class="r">J+7</th><th class="r">J+30</th></tr></thead><tbody id="cohorts"></tbody></table></div>
      </div>
      <div class="card">
        <h2>Présenter / exporter</h2>
        <div class="row"><a class="btn" id="reportLink" target="_blank" rel="noopener">Rapport imprimable (PDF)</a>
          <a class="btn ghost" id="exp-investor-csv">Indicateurs mensuels (CSV)</a>
          <a class="btn ghost" id="exp-cohorts-csv">Cohortes (CSV)</a>
          <a class="btn ghost" id="exp-users-csv">Utilisateurs (CSV)</a>
          <a class="btn ghost" id="exp-audit-csv">Audit (CSV)</a></div>
        <h3 class="mt">Journal des événements (CSV)</h3>
        <div class="row"><input type="date" id="expFrom" class="w170"><input type="date" id="expTo" class="w170"><button class="btn ghost" id="expEvents">Télécharger</button></div>
        <h3 class="mt">Tester les récaps (envoi immédiat par email + notification)</h3>
        <div class="row"><button class="btn ghost" data-recap="daily">Jour</button><button class="btn ghost" data-recap="weekly">Semaine</button><button class="btn ghost" data-recap="monthly">Mois</button></div>
      </div>
    </section>

    <section id="p-settings" class="hidden">
      <div class="card">
        <h2>Alertes</h2>
        <p class="muted small">Chaque événement peut vous alerter par notification sur votre téléphone (compte Blyp admin) et/ou par email. Les recharges, retraits, suppressions et actions admin sont toujours envoyés par email sans limite.</p>
        <table><tbody id="notifRows"></tbody></table>
        <label for="emailCap">Plafond d'emails par minute (événements courants)</label>
        <input id="emailCap" class="w120" type="number" min="1" max="200">
        <div class="row mt"><button class="btn green" id="saveSettings">Enregistrer</button></div>
      </div>
    </section>

    <section id="p-audit" class="hidden">
      <div class="card">
        <h2>Journal d'audit (14 jours)</h2>
        <div class="scroll"><table><thead><tr><th>Date</th><th>Action</th><th>Cible</th><th>Résultat</th><th>IP</th></tr></thead><tbody id="auditRows"></tbody></table></div>
      </div>
    </section>

  </div>
</div>
<script nonce="${nonce}">${JS}</script>
</body></html>`;
}
