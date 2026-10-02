/* AI Server 組裝廠：SimPy 事件紀錄回放（王建皓 HW2） */
(() => {
  "use strict";
  const D = window.SIMDATA;
  const DEPTS = D.depts;
  const ST = { q: 0, w: 1, t: 2, tr: 3, bi: 4, bw: 5, gb: 6, gw: 7, sh: 8 };
  const FAM = { "1U": "#2f6fdf", "2U": "#11998e", "GPU": "#e08a00" };
  const CAT = {
    log: ["#eef2f7", "#9aa6b8"], sto: ["#eaf1fb", "#8ea6cc"], pro: ["#e9f5ef", "#7fb39a"], tst: ["#f2edf9", "#a492c4"],
    qa: ["#fbf2e8", "#c9a57c"], off: ["#f5f5f5", "#b3b3b3"], sup: ["#eceeee", "#a4a9aa"],
  };
  const TARGET = { "1U": 30, "2U": 20, "GPU": 10 };
  const DAY = 1440;
  const NOTE = {
    final2: "<b>最終佈置・加開中班（建議方案）</b>：測試技術員在 15:30–23:00 加開中班，負責燒機槽位與 GPU 測試灣的裝卸與判讀。月平均日產出 {thr} 台、GPU {gpu} 台；GPU 測試灣只有 {bayidle} 的時間處於「已燒完等人卸」。",
    final1: "<b>最終佈置・單班</b>：只有日班（08:00–15:30）有人裝卸。GPU 一輪 FCT＋燒機約 8.8 小時，上午裝上的機台下班後才燒完，整夜停在灣位等隔天卸載——GPU 月平均只有 {gpu} 台/日，測試灣有 {bayidle} 的時間在空等。",
    A2: "<b>Layout A・改善前（加開中班）</b>：部門本位的功能式佈置。產出與最終佈置相近（{thr} 台/日），但每日搬運行走 {dist} m（最終佈置約一半），搬運人員平均等待 {wait} 分，注意畫面上交錯又繞遠的搬運路線。",
  };

  // ---------- DOM
  const $ = (id) => document.getElementById(id);
  const cv = $("plan"), ctx = cv.getContext("2d");
  const daysCv = $("days"), dctx = daysCv.getContext("2d");
  const bPlay = $("bPlay"), rTime = $("rTime"), sSpeed = $("sSpeed");

  // ---------- state
  let S = null;          // current scenario runtime
  let T = 0;             // absolute sim minute
  let playing = false, lastTs = null;
  let staticLayer = null, scale = 10, dpr = 1;
  const X0 = -2, Y1 = 43, WW = 64, HH = 46; // world window (m)

  function prep(key) {
    const sc = D.scen[key];
    const geom = D.geom[sc.cfg.layout];
    const fam = new Map(sc.units.map((u) => [u[0], u[1]]));
    const rel = new Map(sc.units.map((u) => [u[0], u[2]]));
    const paths = {};
    for (const [k, pts] of Object.entries(sc.paths)) {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      paths[k] = { pts, cum, len: cum[cum.length - 1] };
    }
    const ships = sc.ev.filter((e) => e[3] === ST.sh).map((e) => [e[0], fam.get(e[1])]);
    return { key, sc, geom, fam, rel, paths, ships, T0: sc.T0, T1: sc.T1, evPtr: 0, mvPtr: 0, us: new Map(), active: [], cur: -1 };
  }

  function resetState() { S.evPtr = 0; S.mvPtr = 0; S.us = new Map(); S.active = []; S.cur = -1; }
  function advance(t) {
    if (t < S.cur) resetState();
    const ev = S.sc.ev;
    while (S.evPtr < ev.length && ev[S.evPtr][0] <= t) {
      const e = ev[S.evPtr++];
      if (e[3] === ST.sh) S.us.delete(e[1]);
      else S.us.set(e[1], { d: DEPTS[e[2]], st: e[3], k: e[4] });
    }
    const mv = S.sc.mv;
    while (S.mvPtr < mv.length && mv[S.mvPtr][1] <= t) S.active.push(mv[S.mvPtr++]);
    S.active = S.active.filter((m) => m[3] > t);
    S.cur = t;
  }

  // ---------- geometry helpers
  const sx = (x) => (x - X0) * scale;
  const sy = (y) => (Y1 - y) * scale;
  function rectOf(k) { return S.geom.depts[k]; }
  function centroid(k) { const r = rectOf(k); return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]; }
  function along(path, f, rev) {
    const L = path.len * (rev ? 1 - f : f), { pts, cum } = path;
    if (L <= 0) return pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] >= L) {
        const u = (L - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
      }
    }
    return pts[pts.length - 1];
  }

  // zones inside departments (metres)
  function zones() {
    const g = S.geom.depts, z = {};
    const tst = g.TST, gpt = g.GPUT, asm = g.ASM;
    // burn-in slots: left 58% of TST below label band
    const slots = S.sc.cfg.slots, sw = (tst[2] - tst[0]) * 0.58;
    const cols = Math.max(4, Math.round(Math.sqrt(slots * sw / Math.max(1, tst[3] - tst[1] - 2))));
    const rows = Math.ceil(slots / cols);
    const cw = sw / cols, ch = (tst[3] - tst[1] - 2.2) / rows;
    z.slot = [];
    for (let i = 0; i < slots; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      z.slot.push([tst[0] + 0.4 + cw * (c + 0.5), tst[3] - 2.0 - ch * (r + 0.5), Math.min(cw, ch) * 0.8]);
    }
    z.tstGen = [tst[0] + sw + 0.8, tst[1] + 0.5, tst[2] - 0.4, tst[3] - 1.8];
    // GPU bays
    const nb = S.sc.cfg.gpu_bays, bc = 2, br = Math.ceil(nb / bc);
    const bw = (gpt[2] - gpt[0] - 1.2) / bc, bh = (gpt[3] - gpt[1] - 5.2) / br;
    z.bay = [];
    for (let i = 0; i < nb; i++) {
      const c = i % bc, r = Math.floor(i / bc);
      z.bay.push([gpt[0] + 0.6 + bw * (c + 0.5), gpt[3] - 2.0 - bh * (r + 0.5), bw * 0.82, bh * 0.82]);
    }
    z.gptGen = [gpt[0] + 0.5, gpt[1] + 0.5, gpt[2] - 0.5, gpt[1] + 2.9];
    // assembly work spots
    const n = S.sc.cfg.layout === "A" ? 6 : 2;
    z.asm = [];
    if (n === 2) for (let i = 0; i < 2; i++) z.asm.push([asm[0] + (asm[2] - asm[0]) * (0.27 + 0.46 * i), asm[1] + (asm[3] - asm[1]) * 0.55]);
    else for (let i = 0; i < 6; i++) z.asm.push([asm[0] + (asm[2] - asm[0]) * (0.2 + 0.3 * (i % 3)), asm[1] + (asm[3] - asm[1]) * (0.62 - 0.3 * Math.floor(i / 3))]);
    z.asmGen = n === 2 ? [asm[0] + 0.5, asm[1] + 0.5, asm[2] - 0.5, asm[1] + 3.2] : [asm[0] + 0.5, asm[1] + 0.4, asm[2] - 0.5, asm[1] + 1.6];
    return z;
  }
  let Z = null;

  // ---------- static layer
  function buildStatic() {
    const w = Math.round(WW * scale * dpr), h = Math.round(HH * scale * dpr);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.scale(dpr, dpr);
    const geo = S.geom;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, WW * scale, HH * scale);
    // floor
    g.fillStyle = "#fbfbfc"; g.fillRect(sx(0), sy(40), 60 * scale, 40 * scale);
    // aisles
    g.fillStyle = "#e4e7ec";
    for (const a of geo.aisles) g.fillRect(sx(a[0]), sy(a[3]), (a[2] - a[0]) * scale, (a[3] - a[1]) * scale);
    // walkways
    if (geo.walks) {
      for (const a of geo.walks) {
        const x = sx(a[0]), y = sy(a[3]), ww = (a[2] - a[0]) * scale, hh = (a[3] - a[1]) * scale;
        g.save(); g.beginPath(); g.rect(x, y, ww, hh); g.clip();
        g.fillStyle = "#fff6d6"; g.fillRect(x, y, ww, hh);
        g.strokeStyle = "#e8b931"; g.lineWidth = 1.2;
        for (let k = -hh; k < ww + hh; k += 6) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + hh, y + hh); g.stroke(); }
        g.restore();
      }
    }
    // reserve
    g.setLineDash([5, 4]); g.strokeStyle = "#9aa3b2"; g.lineWidth = 1;
    for (const [k, r] of Object.entries(geo.reserve)) {
      g.fillStyle = "#ffffff"; g.fillRect(sx(r[0]), sy(r[3]), (r[2] - r[0]) * scale, (r[3] - r[1]) * scale);
      g.strokeRect(sx(r[0]) + 0.5, sy(r[3]) + 0.5, (r[2] - r[0]) * scale - 1, (r[3] - r[1]) * scale - 1);
      g.fillStyle = "#9aa3b2"; g.font = `${Math.max(10, scale * 0.85)}px sans-serif`; g.textAlign = "center";
      g.fillText("預留", sx((r[0] + r[2]) / 2), sy((r[1] + r[3]) / 2) + 4);
    }
    g.setLineDash([]);
    // departments
    for (const k of DEPTS) {
      const r = geo.depts[k], [fill, edge] = CAT[D.cat[k]];
      g.fillStyle = fill; g.strokeStyle = edge; g.lineWidth = 1.2;
      g.fillRect(sx(r[0]), sy(r[3]), (r[2] - r[0]) * scale, (r[3] - r[1]) * scale);
      g.strokeRect(sx(r[0]) + 0.5, sy(r[3]) + 0.5, (r[2] - r[0]) * scale - 1, (r[3] - r[1]) * scale - 1);
      g.fillStyle = "#3a4256"; g.font = `600 ${Math.max(10, scale * 0.95)}px "Noto Sans TC","Microsoft JhengHei",sans-serif`; g.textAlign = "left";
      g.fillText(D.short[k], sx(r[0]) + 5, sy(r[3]) + Math.max(13, scale * 1.15));
    }
    // slots & bays outlines
    g.strokeStyle = "#b7aed0"; g.lineWidth = 1;
    for (const s of Z.slot) { const d = s[2] * scale; g.strokeRect(sx(s[0]) - d / 2, sy(s[1]) - d / 2, d, d); }
    for (const b of Z.bay) g.strokeRect(sx(b[0]) - b[2] * scale / 2, sy(b[1]) - b[3] * scale / 2, b[2] * scale, b[3] * scale);
    // assembly spots
    g.strokeStyle = "#7fb39a"; g.lineWidth = 2.5;
    for (const p of Z.asm) {
      const x = sx(p[0]), y = sy(p[1]), rr = scale * (Z.asm.length === 2 ? 2.2 : 1.2);
      g.beginPath(); g.moveTo(x - rr, y - rr); g.lineTo(x - rr, y + rr); g.lineTo(x + rr, y + rr); g.lineTo(x + rr, y - rr); g.stroke();
    }
    // walls
    g.strokeStyle = "#2b3242"; g.lineWidth = 2.5; g.strokeRect(sx(0), sy(40), 60 * scale, 40 * scale);
    // docks
    g.fillStyle = "#2b3242";
    for (const [k, side] of Object.entries(geo.docks)) {
      const r = geo.depts[k];
      for (const f of [0.3, 0.7]) {
        if (side === "S") g.fillRect(sx(r[0] + (r[2] - r[0]) * f - 1.4), sy(0), 2.8 * scale, 0.8 * scale);
        if (side === "W") g.fillRect(sx(-0.8), sy(r[1] + (r[3] - r[1]) * f + 1.4), 0.8 * scale, 2.8 * scale);
        if (side === "E") g.fillRect(sx(60), sy(r[1] + (r[3] - r[1]) * f + 1.4), 0.8 * scale, 2.8 * scale);
      }
    }
    g.fillStyle = "#7b8496"; g.font = `${Math.max(10, scale * 0.8)}px sans-serif`; g.textAlign = "left";
    g.fillText("■ 卡車月台", sx(0), sy(-1.9));
    g.fillText("60 m × 40 m　" + geo.name, sx(14), sy(-1.9));
    g.textAlign = "right"; g.fillText("北 ↑", sx(60), sy(41.6));
    staticLayer = c;
  }

  // ---------- drawing primitives
  function token(x, y, fam, st, r) {
    const col = FAM[fam]; ctx.lineWidth = Math.max(1.2, r * 0.32);
    ctx.beginPath();
    if (fam === "1U") ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (fam === "2U") ctx.rect(x - r, y - r, 2 * r, 2 * r);
    else { const q = r * 1.35; ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath(); }
    if (st === ST.w || st === ST.tr) { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = "#ffffff"; ctx.stroke(); }
    else if (st === ST.t) { ctx.fillStyle = col + "66"; ctx.fill(); ctx.strokeStyle = col; ctx.stroke(); }
    else { ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = col; ctx.stroke(); }
  }
  function placeGrid(zone, list, sp) {
    const [x0, y0, x1, y1] = zone, cols = Math.max(1, Math.floor((x1 - x0) / sp));
    const rows = Math.max(1, Math.floor((y1 - y0) / sp)), cap = cols * rows;
    return list.map((u, i) => {
      const j = i % cap, layer = Math.floor(i / cap);
      return [u, x0 + sp * (j % cols + 0.5) + layer * 0.25, y1 - sp * (Math.floor(j / cols) + 0.5) - layer * 0.25];
    });
  }

  function draw() {
    const W = WW * scale, H = HH * scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(staticLayer, 0, 0, W, H);
    const r0 = Math.max(2.6, scale * 0.36);

    // active paths
    ctx.lineWidth = 1.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const m of S.active) {
      const p = S.paths[m[4] + ">" + m[5]]; if (!p) continue;
      ctx.strokeStyle = m[6] === "amr" ? "rgba(36,86,199,.28)" : "rgba(224,138,0,.30)";
      ctx.beginPath(); p.pts.forEach((q, i) => (i ? ctx.lineTo(sx(q[0]), sy(q[1])) : ctx.moveTo(sx(q[0]), sy(q[1])))); ctx.stroke();
    }

    // units by department
    const byDept = {};
    for (const [uid, s] of S.us) {
      if (s.st === ST.tr) continue;
      (byDept[s.d] = byDept[s.d] || []).push([uid, s]);
    }
    const order = { 1: 0, 0: 1, 2: 2 };
    for (const [d, arr] of Object.entries(byDept)) {
      const r = rectOf(d);
      const gen = [];
      for (const [uid, s] of arr) {
        const fam = S.fam.get(uid);
        if (d === "TST" && (s.st === ST.bi || s.st === ST.bw) && Z.slot[s.k]) {
          const p = Z.slot[s.k], dd = p[2] * scale;
          ctx.fillStyle = s.st === ST.bi ? "#3d4a63" : "#d9473b";
          ctx.fillRect(sx(p[0]) - dd / 2 + 1, sy(p[1]) - dd / 2 + 1, dd - 2, dd - 2);
          ctx.fillStyle = FAM[fam]; ctx.fillRect(sx(p[0]) - dd / 2 + 1, sy(p[1]) + dd / 2 - 4, dd - 2, 3);
          continue;
        }
        if (d === "GPUT" && (s.st === ST.gb || s.st === ST.gw) && Z.bay[s.k]) {
          const b = Z.bay[s.k], bw = b[2] * scale, bh = b[3] * scale, x = sx(b[0]) - bw / 2, y = sy(b[1]) - bh / 2;
          if (s.st === ST.gb) { ctx.fillStyle = "#3d4a63"; ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2); }
          else {
            ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, bw - 2, bh - 2); ctx.clip();
            ctx.fillStyle = "#f6c4bf"; ctx.fillRect(x, y, bw, bh); ctx.strokeStyle = "#d9473b"; ctx.lineWidth = 2;
            for (let k = -bh; k < bw + bh; k += 6) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k + bh, y + bh); ctx.stroke(); }
            ctx.restore();
          }
          token(sx(b[0]), sy(b[1]), "GPU", s.st === ST.gb ? ST.w : ST.q, r0 * 1.15);
          continue;
        }
        if (d === "ASM" && s.st === ST.w && s.k >= 0 && Z.asm[s.k]) { const p = Z.asm[s.k]; token(sx(p[0]), sy(p[1]), fam, ST.w, r0 * 1.2); continue; }
        gen.push([uid, s]);
      }
      gen.sort((a, b) => (order[a[1].st] ?? 3) - (order[b[1].st] ?? 3));
      let zone;
      if (d === "TST") zone = Z.tstGen; else if (d === "GPUT") zone = Z.gptGen; else if (d === "ASM") zone = Z.asmGen;
      else zone = [r[0] + 0.5, r[1] + 0.4, r[2] - 0.4, r[3] - 1.9];
      let sp = 1.25;
      while (sp > 0.5 && Math.floor((zone[2] - zone[0]) / sp) * Math.floor((zone[3] - zone[1]) / sp) < gen.length) sp -= 0.05;
      const rr = Math.min(r0, sp * scale * 0.36);
      for (const [[uid, s], x, y] of placeGrid(zone, gen, sp)) token(sx(x), sy(y), S.fam.get(uid), s.st, rr);
    }

    // carriers & moving units
    const t = T;
    for (const m of S.active) {
      const p = S.paths[m[4] + ">" + m[5]]; if (!p) continue;
      const loaded = t < m[2];
      const f = loaded ? (t - m[1]) / Math.max(0.01, m[2] - m[1]) : (t - m[2]) / Math.max(0.01, m[3] - m[2]);
      const [x, y] = along(p, Math.min(1, Math.max(0, f)), !loaded);
      const X = sx(x), Y = sy(y);
      if (m[6] === "amr") {
        ctx.fillStyle = loaded ? "#1e2a44" : "#8a93a6";
        const w = scale * 1.2, h = scale * 0.85; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(X - w / 2, Y - h / 2, w, h, 3) : ctx.rect(X - w / 2, Y - h / 2, w, h); ctx.fill();
      } else {
        for (let i = 0; i < m[9]; i++) {
          ctx.fillStyle = loaded ? "#b4560a" : "#d9a77a";
          ctx.beginPath(); ctx.arc(X + (i - (m[9] - 1) / 2) * scale * 0.9, Y, scale * 0.42, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke();
        }
      }
      if (loaded) {
        const us = m[8];
        if (us.length) us.forEach((u, i) => token(X + (i - (us.length - 1) / 2) * r0 * 1.9, Y - scale * 0.95, S.fam.get(u), ST.tr, r0 * 0.85));
        else { ctx.fillStyle = "#a07850"; ctx.fillRect(X - scale * 0.35, Y - scale * 1.2, scale * 0.7, scale * 0.55); }
      }
    }
  }

  // ---------- side panel
  const shipEl = $("ship");
  function fmtClock(t) {
    const m = ((t % DAY) + DAY) % DAY + 8 * 60;
    const hh = Math.floor(m / 60) % 24, mm = Math.floor(m % 60);
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }
  function panel() {
    const dIdx = Math.min(2, Math.floor((T - S.T0) / DAY));
    $("cDay").textContent = `第 ${dIdx + 1} 天（共 3 天）`;
    $("cTime").textContent = fmtClock(T);
    const tm = ((T % DAY) + DAY) % DAY, ph = $("cPhase");
    if (tm < 450) { ph.textContent = "日班"; ph.className = "phase"; }
    else if (tm < 900 && S.sc.cfg.test_win > 450) { ph.textContent = "中班（僅測試裝卸）"; ph.className = "phase swing"; }
    else { ph.textContent = "無人裝卸・機台持續燒機"; ph.className = "phase night"; }
    // shipped today
    const d0 = S.T0 + dIdx * DAY, cnt = { "1U": 0, "2U": 0, "GPU": 0 };
    let tot = 0;
    for (const [ts, f] of S.ships) { if (ts >= S.T0 && ts <= T) tot++; if (ts >= d0 && ts <= T && ts < d0 + DAY) cnt[f]++; }
    shipEl.innerHTML = ["1U", "2U", "GPU"].map((f) =>
      `<div class="shiprow"><span style="color:${FAM[f]};font-weight:700">${f}</span><div class="bar"><i style="width:${Math.min(100, (cnt[f] / TARGET[f]) * 100)}%;background:${FAM[f]}"></i></div><b>${cnt[f]} / ${TARGET[f]}</b></div>`).join("");
    $("kTot").textContent = tot;
    let wip = 0; for (const [uid] of S.us) if (S.rel.get(uid) <= T) wip++;
    $("kWip").textContent = wip;
    // slots & bays
    const ns = S.sc.cfg.slots, nb = S.sc.cfg.gpu_bays;
    const sState = new Array(ns).fill(""), bState = new Array(nb).fill("");
    for (const [, s] of S.us) {
      if (s.d === "TST" && (s.st === ST.bi || s.st === ST.bw) && s.k < ns) sState[s.k] = s.st === ST.bi ? "run" : "done";
      if (s.d === "GPUT" && (s.st === ST.gb || s.st === ST.gw) && s.k < nb) bState[s.k] = s.st === ST.gb ? "run" : "done";
    }
    $("slots").innerHTML = sState.map((c) => `<i class="${c}"></i>`).join("");
    $("bays").innerHTML = bState.map((c) => `<i class="${c}"></i>`).join("");
    const c = (a, v) => a.filter((x) => x === v).length;
    $("slotTxt").textContent = `燒機 ${c(sState, "run")}・待卸 ${c(sState, "done")}・空 ${c(sState, "")}`;
    $("bayTxt").textContent = `測試 ${c(bState, "run")}・待卸 ${c(bState, "done")}・空 ${c(bState, "")}`;
    // resources
    let amr = 0, man = 0; for (const m of S.active) { if (m[6] === "amr") amr++; else man += m[9]; }
    const nA = S.sc.cfg.n_amr, nH = S.sc.cfg.n_handler;
    const dots = (n, on) => Array.from({ length: n }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("");
    $("res").innerHTML = `<div class="res-row"><span>AMR</span><div class="dots">${dots(nA, amr)}</div><b>${amr}/${nA}</b></div>` +
      `<div class="res-row"><span>搬運人員</span><div class="dots">${dots(nH, man)}</div><b>${man}/${nH}</b></div>`;
    drawDays();
  }

  function drawDays() {
    const w = daysCv.clientWidth, h = 120; daysCv.width = w * dpr; daysCv.height = h * dpr;
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0); dctx.clearRect(0, 0, w, h);
    const padL = 26, padB = 20, top = 8, maxV = 70, bw = (w - padL - 10) / 3;
    const y = (v) => h - padB - (v / maxV) * (h - padB - top);
    dctx.strokeStyle = "#e2e6ec"; dctx.lineWidth = 1; dctx.fillStyle = "#7b8496"; dctx.font = "11px sans-serif"; dctx.textAlign = "right";
    for (const v of [0, 30, 60]) { dctx.beginPath(); dctx.moveTo(padL, y(v)); dctx.lineTo(w - 6, y(v)); dctx.stroke(); dctx.fillText(v, padL - 4, y(v) + 4); }
    for (let d = 0; d < 3; d++) {
      const d0 = S.T0 + d * DAY, cnt = { "1U": 0, "2U": 0, "GPU": 0 };
      for (const [ts, f] of S.ships) if (ts >= d0 && ts < d0 + DAY && ts <= T) cnt[f]++;
      let acc = 0; const x = padL + d * bw + bw * 0.22, bwid = bw * 0.56;
      for (const f of ["1U", "2U", "GPU"]) {
        if (!cnt[f]) continue;
        dctx.fillStyle = FAM[f]; dctx.fillRect(x, y(acc + cnt[f]), bwid, y(acc) - y(acc + cnt[f]) - 1); acc += cnt[f];
      }
      dctx.fillStyle = "#4a5468"; dctx.textAlign = "center"; dctx.fillText(`第${d + 1}天`, x + bwid / 2, h - 5);
      if (acc) dctx.fillText(acc, x + bwid / 2, y(acc) - 3);
    }
    dctx.strokeStyle = "#1d2433"; dctx.setLineDash([4, 3]); dctx.beginPath(); dctx.moveTo(padL, y(60)); dctx.lineTo(w - 6, y(60)); dctx.stroke(); dctx.setLineDash([]);
  }

  // ---------- legend
  function legend() {
    const L = $("legend");
    const items = [
      ["1U", "w", "1U"], ["2U", "w", "2U"], ["GPU", "w", "GPU"],
      [null, "work", "實心＝作業中"], [null, "queue", "空心＝排隊等作業"], [null, "wait", "半透明＝等搬運"],
      [null, "amr", "AMR（深色＝載貨）"], [null, "man", "搬運人員（GPU 需 2 人）"], [null, "bi", "燒機／測試中"], [null, "bw", "已燒完、等人卸"],
    ];
    if (S.geom.walks) items.push([null, "walk", "人行道（人車分流）"]);
    L.innerHTML = "";
    for (const [fam, kind, label] of items) {
      const sp = document.createElement("span"), c = document.createElement("canvas");
      c.width = 36; c.height = 36; c.style.width = "18px"; c.style.height = "18px";
      const g = c.getContext("2d"); g.scale(2, 2);
      if (fam) { tokenOn(g, 9, 9, fam, ST.w, 5.5); }
      else if (kind === "work") tokenOn(g, 9, 9, "1U", ST.w, 5.5);
      else if (kind === "queue") tokenOn(g, 9, 9, "1U", ST.q, 5.5);
      else if (kind === "wait") tokenOn(g, 9, 9, "1U", ST.t, 5.5);
      else if (kind === "amr") { g.fillStyle = "#1e2a44"; g.fillRect(2, 5, 14, 9); }
      else if (kind === "man") { g.fillStyle = "#b4560a"; g.beginPath(); g.arc(9, 9, 5.5, 0, 7); g.fill(); }
      else if (kind === "bi") { g.fillStyle = "#3d4a63"; g.fillRect(2, 2, 14, 14); }
      else if (kind === "bw") { g.fillStyle = "#f6c4bf"; g.fillRect(2, 2, 14, 14); g.strokeStyle = "#d9473b"; g.lineWidth = 2; for (let k = -14; k < 28; k += 5) { g.beginPath(); g.moveTo(2 + k, 2); g.lineTo(16 + k, 16); g.stroke(); } g.clearRect(0, 0, 2, 18); g.clearRect(16, 0, 2, 18); }
      else if (kind === "walk") { g.fillStyle = "#fff6d6"; g.fillRect(2, 2, 14, 14); g.strokeStyle = "#e8b931"; g.lineWidth = 1.5; for (let k = -14; k < 28; k += 4) { g.beginPath(); g.moveTo(2 + k, 2); g.lineTo(16 + k, 16); g.stroke(); } }
      sp.appendChild(c); sp.appendChild(document.createTextNode(label)); L.appendChild(sp);
    }
  }
  function tokenOn(g, x, y, fam, st, r) {
    const col = FAM[fam]; g.lineWidth = 1.6; g.beginPath();
    if (fam === "1U") g.arc(x, y, r, 0, Math.PI * 2);
    else if (fam === "2U") g.rect(x - r, y - r, 2 * r, 2 * r);
    else { const q = r * 1.35; g.moveTo(x, y - q); g.lineTo(x + q, y); g.lineTo(x, y + q); g.lineTo(x - q, y); g.closePath(); }
    if (st === ST.w) { g.fillStyle = col; g.fill(); } else if (st === ST.t) { g.fillStyle = col + "66"; g.fill(); g.strokeStyle = col; g.stroke(); }
    else { g.fillStyle = "#fff"; g.fill(); g.strokeStyle = col; g.stroke(); }
  }

  // ---------- summary table & note
  function fmt(v, d = 1) { return Number(v).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function table() {
    const sm = D.summary, cols = ["final2", "final1", "A2"];
    const head = ["最終佈置・加開中班", "最終佈置・單班", "Layout A・加開中班"];
    const rows = [
      ["日產出（台/日，需求 60）", "thr_day", 2, "max", 1],
      ["GPU 日產出（台/日，需求 10）", "thr_GPU", 2, "max", 1],
      ["1U 前置時間（h）", "lt_1U", 1, "min", 1], ["2U 前置時間（h）", "lt_2U", 1, "min", 1], ["GPU 前置時間（h）", "lt_GPU", 1, "min", 1],
      ["廠內在製品 WIP（台）", "wip", 1, "min", 1], ["單日達標比例", "days_met", 0, "max", 100, "%"],
      ["GPU 測試灣「燒完等人卸」時間比例", "bay_idle_occ", 0, "min", 100, "%"],
      ["每日搬運行走距離（m）", "dist_day", 0, "min", 1], ["搬運人員利用率", "u_hand", 0, "min", 100, "%"],
      ["搬運人員平均等待（分）", "w_hand", 2, "min", 1], ["AMR 利用率", "u_amr", 0, "min", 100, "%"],
    ];
    let h = "<thead><tr><th>指標（20 次重複平均）</th>" + head.map((x) => `<th>${x}</th>`).join("") + "</tr></thead><tbody>";
    for (const [lab, k, d, best, mul, unit] of rows) {
      const vals = cols.map((c) => sm[c][k] * mul);
      const b = best === "max" ? Math.max(...vals) : Math.min(...vals);
      h += `<tr><td>${lab}</td>` + vals.map((v) => `<td class="${Math.abs(v - b) < 1e-9 ? "best" : ""}">${fmt(v, d)}${unit || ""}</td>`).join("") + "</tr>";
    }
    $("tbl").innerHTML = h + "</tbody>";
  }
  function note() {
    const s = D.summary[S.key];
    $("scenNote").innerHTML = NOTE[S.key].replace("{thr}", fmt(s.thr_day, 1)).replace("{gpu}", fmt(s.thr_GPU, 1))
      .replace("{bayidle}", fmt(s.bay_idle_occ * 100, 0) + "%").replace("{dist}", fmt(s.dist_day, 0)).replace("{wait}", fmt(s.w_hand, 1));
  }

  // ---------- layout / resize
  function resize() {
    const box = cv.parentElement; const w = box.clientWidth;
    dpr = window.devicePixelRatio || 1; scale = w / WW;
    cv.width = Math.round(w * dpr); cv.height = Math.round(HH * scale * dpr);
    cv.style.height = HH * scale + "px";
    buildStatic(); render();
  }
  function render() { advance(T); draw(); panel(); rTime.value = Math.round(T - S.T0); }

  function setScenario(key, keepOffset = true) {
    const off = S ? T - S.T0 : 0;
    S = prep(key); Z = zones();
    document.querySelectorAll(".scen-btn").forEach((b) => b.classList.toggle("active", b.dataset.s === key));
    T = S.T0 + (keepOffset ? off : 0);
    rTime.max = S.T1 - S.T0 - 1;
    legend(); note(); buildStatic(); render();
  }
  function jump(j, dayIdx) {
    const d = dayIdx ?? Math.min(2, Math.floor((T - S.T0) / DAY));
    T = S.T0 + d * DAY + j; render();
  }

  // ---------- loop
  function loop(ts) {
    if (playing) {
      if (lastTs != null) {
        const dt = Math.min(0.1, (ts - lastTs) / 1000);
        T += dt * Number(sSpeed.value);
        if (T >= S.T1 - 1) { T = S.T1 - 1; setPlay(false); }
        render();
      }
      lastTs = ts;
    }
    requestAnimationFrame(loop);
  }
  function setPlay(p) { playing = p; lastTs = null; bPlay.textContent = p ? "❚❚ 暫停" : "▶ 播放"; bPlay.setAttribute("aria-label", p ? "暫停" : "播放"); }

  // ---------- events
  bPlay.addEventListener("click", () => { if (T >= S.T1 - 1) T = S.T0; setPlay(!playing); });
  rTime.addEventListener("input", () => { T = S.T0 + Number(rTime.value); render(); });
  document.querySelectorAll(".scen-btn").forEach((b) => b.addEventListener("click", () => setScenario(b.dataset.s)));
  document.querySelectorAll(".jumps .chip").forEach((b) => b.addEventListener("click", () => jump(Number(b.dataset.j))));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
    setScenario(b.dataset.go); jump(Number(b.dataset.j), 1); setPlay(false);
    document.querySelector(".viewer").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  window.addEventListener("keydown", (e) => { if (e.code === "Space" && e.target === document.body) { e.preventDefault(); bPlay.click(); } });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(resize, 120); });

  setScenario("final2", false); table(); resize(); requestAnimationFrame(loop);
})();
