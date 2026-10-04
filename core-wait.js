// core-wait aus dem CORE Master Style Book (Stand 03.10.2026), Kapitel 07 Wartezeiten und 10.3.
// Unverändert übernommen; Quelle im Buch: packages/core-wait/ (produktionsreif). Nicht hier ändern.
// CORE Wartezeiten – Canvas-Animationen, framework-unabhängig.
// Quelle: CORE Wartezeiten.dc.html (Design-Referenz). Keine Abhängigkeiten.
function buildK() {
    const TAU = Math.PI * 2, D = Math.PI / 180;
    const cl = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x, lerp = (a, b, t) => a + (b - a) * t, fr = x => x - Math.floor(x);
    const hash = k => fr(Math.sin(k * 12.9898 + 78.233) * 43758.5453);
    const bez = (x1, y1, x2, y2) => { const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by; return x => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, u = x; for (let i = 0; i < 22; i++) { const v = ((ax * u + bx) * u + cx) * u; if (Math.abs(v - x) < 1e-4) break; if (v < x) lo = u; else hi = u; u = (lo + hi) / 2; } return ((ay * u + by) * u + cy) * u; }; };
    const E_IN = bez(.2, .7, .2, 1), E_ANL = bez(.45, 0, .55, 1), E_SW = bez(.5, 0, .15, 1);
    const backOut = x => { const k = 1.9; x = cl(x) - 1; return 1 + (k + 1) * x * x * x + k * x * x; };
    const RG = {}, rgb = h => RG[h] || (RG[h] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
    const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); t = cl(t); return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ',' + Math.round(A[2] + (B[2] - A[2]) * t) + ')'; };
    const rgba = (h, a) => { const A = rgb(h); return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + a + ')'; };
    const base = { ink: '#0e1c1b', core: '#0f7a73', deep: '#0a4d48', hi: '#2db3a5', soft: '#a6d8d0', mute: '#8fa3a0' };
    const PAL = {
      light: { ...base, bg: '#f3f6f5', track: '#dfe7e6', eye: '#f3f6f5' },
      white: { ...base, bg: '#ffffff', track: '#e6eceb', eye: '#ffffff' },
      dark: { bg: '#0c1716', ink: '#eef5f4', core: '#2db3a5', deep: '#0f7a73', hi: '#7fd6cb', soft: '#1f4440', track: '#1b2c2a', mute: '#546664', eye: '#0c1716' },
      petrol: { bg: '#0f7a73', ink: '#ffffff', core: '#a6d8d0', deep: '#0a4d48', hi: '#cfe9e5', soft: '#2a8a83', track: '#2f8c85', mute: '#a6d8d0', eye: '#0f7a73' },
      inkbg: { bg: '#0e1c1b', ink: '#eef5f4', core: '#2db3a5', deep: '#0f7a73', hi: '#7fd6cb', soft: '#1f4440', track: '#263836', mute: '#546664', eye: '#0e1c1b' }
    };
    const L2A = -25 * D, L2B = 295 * D;
    const band = (c, r0, r1, a0, a1, col) => { c.beginPath(); c.arc(0, 0, r1, a0, a1); c.arc(0, 0, Math.max(0, r0), a1, a0, true); c.closePath(); c.fillStyle = col; c.fill(); };
    const disc = (c, x, y, r, col) => { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, TAU); c.fillStyle = col; c.fill(); };
    const rr = (c, x, y, w, h, r) => { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    const snake = (c, pts, w0, w1, c0, c1, pw) => { const n = pts.length; if (n < 2) return; c.lineCap = 'round'; c.lineJoin = 'round'; for (let i = n - 2; i >= 0; i--) { const f = i / Math.max(1, n - 2); c.lineWidth = Math.max(.05, w0 + (w1 - w0) * f); c.strokeStyle = c1 ? mix(c0, c1, Math.pow(f, pw || 2)) : c0; c.beginPath(); c.moveTo(pts[i + 1][0], pts[i + 1][1]); c.lineTo(pts[i][0], pts[i][1]); c.stroke(); } };
    const seg = (c, s) => { if (s[3] === null) { disc(c, s[1], s[2], s[5], s[6]); return; } c.lineCap = 'round'; c.lineWidth = s[5]; c.strokeStyle = s[6]; c.beginPath(); c.moveTo(s[1], s[2]); c.lineTo(s[3], s[4]); c.stroke(); };
    const eye = (c, x, y, dx, dy, r, P, t, seed) => { const bl = fr(t / 3.3 + seed) < .045 ? .15 : 1; c.save(); c.translate(x, y); c.rotate(Math.atan2(dy, dx)); c.translate(r * .18, -r * .42); c.scale(1, bl); disc(c, 0, 0, r * .36, P.eye); disc(c, r * .14, 0, r * .19, P.ink); c.restore(); };

    const drawItem = (c, ty0, gl, col, m, da, al, P) => {
          const ty = ty0, glyph = ty === 5 || ty === 6, W = [9, 9, 11, 11, 10, 9, 9, 8.4, 9, 6.5, 11, 7.5, 8][ty], H = [11.5, 11.5, 8.5, 8.5, 10, 9, 9, 8.4, 11.5, 6.5, 6.5, 13, 8][ty], Dd = 4;
          const bw = lerp(W, Dd, m), bh = lerp(H, Dd, m), br = lerp(ty === 7 || ty === 9 ? W / 2 : ty === 12 ? 2.2 : 1.6, Dd / 2, m);
          c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.1; c.lineCap = 'round'; c.lineJoin = 'round';
          if (glyph) { c.globalAlpha = al * da; c.font = '500 ' + (gl.length > 2 ? 5.5 : 8) + 'px "Geist Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(gl, 0, .4); c.globalAlpha = al * m; rr(c, -bw / 2, -bh / 2, bw, bh, br); c.fill(); }
          else {
            rr(c, -bw / 2, -bh / 2, bw, bh, br);
            if (ty === 1 || ty === 7 || ty === 9) c.fill(); else { c.stroke(); if (m > 0) { c.globalAlpha = al * m; c.fill(); } }
            c.globalAlpha = al * da; c.beginPath();
            if (ty === 7) { c.save(); c.rotate(-.35); c.beginPath(); c.ellipse(0, 0, 7.6, 2.3, 0, -.1, Math.PI + .1); c.stroke(); c.restore(); }
            else if (ty === 8) { c.moveTo(W / 2 - 3.2, -H / 2); c.lineTo(W / 2 - 3.2, -H / 2 + 3.2); c.lineTo(W / 2, -H / 2 + 3.2); c.moveTo(-W / 2 + 1.8, H / 2 - 1.8); c.lineTo(-1, 1.2); c.lineTo(1.2, 3.2); c.lineTo(2.4, 2.2); c.lineTo(W / 2 - 1.8, H / 2 - 1.8); c.stroke(); c.font = '600 3.2px "Geist Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('JPG', -.6, -2.2); }
            else if (ty === 9) { disc(c, -1.2, -1.2, 1.1, rgba(P.bg, .55)); }
            else if (ty === 10) { disc(c, -W / 2 + 2, 0, .9, P.bg); c.moveTo(-W / 2 + 4, -1.2); c.lineTo(W / 2 - 1.8, -1.2); c.moveTo(-W / 2 + 4, 1.2); c.lineTo(W / 2 - 3.5, 1.2); c.stroke(); }
            else if (ty === 11) { c.moveTo(-W / 2, -H / 2 + 4.5); c.lineTo(W / 2, -H / 2 + 4.5); c.moveTo(-W / 2 + 1.6, -H / 2 + 1.5); c.lineTo(-W / 2 + 1.6, -H / 2 + 3); c.moveTo(-W / 2 + 1.6, -H / 2 + 6); c.lineTo(-W / 2 + 1.6, -H / 2 + 8.5); c.stroke(); }
            else if (ty === 12) { rr(c, -W / 2 + 1.7, -H / 2 + 1.7, W - 3.4, H - 3.4, 1.2); c.moveTo(-W / 2 + 2.6, -H / 2 + 4.2); c.lineTo(-W / 2 + 4.2, -H / 2 + 2.6); c.stroke(); }
            else if (ty === 0) { c.moveTo(W / 2 - 3.2, -H / 2); c.lineTo(W / 2 - 3.2, -H / 2 + 3.2); c.lineTo(W / 2, -H / 2 + 3.2); [-1, 1.5, 4].forEach((ly, j) => { c.moveTo(-W / 2 + 2.2, ly); c.lineTo(W / 2 - (j === 2 ? 4 : 2.2), ly); }); c.stroke(); }
            else if (ty === 1) { c.fillStyle = P.bg; c.font = '600 3.6px "Geist Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PDF', 0, 1.2); c.fillRect(-W / 2 + 2, -H / 2 + 2.2, W - 4, .8); }
            else if (ty === 2) { c.moveTo(-W / 2 + 1.6, H / 2 - 1.6); c.lineTo(-1.2, -.6); c.lineTo(1.4, 1.8); c.lineTo(2.8, .7); c.lineTo(W / 2 - 1.6, H / 2 - 1.6); c.stroke(); disc(c, W / 2 - 3, -H / 2 + 2.8, 1.1, col); }
            else if (ty === 3) { c.moveTo(-W / 2 + .6, -H / 2); c.lineTo(-W / 2 + 1.2, -H / 2 - 1.8); c.lineTo(-W / 2 + 4.4, -H / 2 - 1.8); c.lineTo(-W / 2 + 5.4, -H / 2); c.stroke(); }
            else { [-W / 6, W / 6].forEach(lx => { c.moveTo(lx, -H / 2); c.lineTo(lx, H / 2); }); [-H / 6, H / 6].forEach(ly => { c.moveTo(-W / 2, ly); c.lineTo(W / 2, ly); }); c.stroke(); }
          }
    };
    const A = {
      ring(c, w, h, t, P, S, o) {
        const s = Math.min(w, h) / 48 * (o.fill || .6); c.translate(w / 2, h / 2); c.scale(s, s);
        band(c, 19.5, 24, L2A, L2B, P.track); band(c, 10.5, 15.5, 0, TAU, P.track);
        const th = x => { const q = x / 1.6, k = Math.floor(q), u = q - k; let p; if (u < .8) p = E_SW(u / .8) - .05 * Math.sin(Math.PI * cl(u / .3)); else { const v = (u - .8) / .2; p = 1 + .06 * Math.sin(v * TAU) * (1 - v) * (1 - v); } return (k + p) * TAU - Math.PI / 2; };
        const hd = th(t), pts = [], L = o.len;
        for (let i = 0; i < 34; i++) { let a = Math.min(th(t - i * .0075 * L), hd - i * .026 * L); a = Math.max(a, hd - 4.6 * Math.min(L, 1.25)); pts.push([13 * Math.cos(a), 13 * Math.sin(a)]); }
        snake(c, pts, 5, 1.2, P.ink, P.track, 2.2);
        disc(c, 0, 0, 6.5 * (1 + .07 * Math.sin(t * TAU / 1.6 + 1.2)), P.core);
      },
      wave(c, w, h, t, P, S, o) {
        const b = Math.min(h, w * .34), L = Math.min(w * .84, w * .56 * o.len), N = 42, om = TAU / .9;
        const hx = w / 2 + L / 2 + L * .03 * Math.sin(t * om), cy = h / 2, Am = b * .17, pts = [];
        for (let i = 0; i < N; i++) { const f = i / (N - 1), env = .18 + .82 * cl(i / 9); pts.push([hx - f * L, cy + Am * env * Math.sin(t * om - f * TAU * 1.25)]); }
        const w0 = Math.max(1.6, b * .13);
        snake(c, pts, w0, w0 * .32, P.ink, P.track, 2.4);
        disc(c, pts[0][0], pts[0][1], w0 * .62, P.ink);
        if (b > 40) eye(c, pts[0][0], pts[0][1], pts[0][0] - pts[2][0], pts[0][1] - pts[2][1], w0 * .62, P, t, .3);
      },
      ouro(c, w, h, t, P, S, o) {
        const s = Math.min(w, h) / 48 * .56, T = 3.2, q = t / T, k = Math.floor(q), u = q - k;
        const run = cl((u - .12) / .84), sr = Math.sin(Math.PI * run), tilt = .22 * sr * sr, hold = cl(u / .14);
        c.translate(w / 2, h / 2);
        c.save(); c.translate(0, 29 * s); c.scale(1, .16); disc(c, 0, 0, (21 - 5 * tilt) * s, mix(P.bg, P.ink, .06 + .05 * (1 - tilt / .22))); c.restore();
        c.translate(0, -tilt * 14 * s); c.scale(s, s); c.rotate(-.1 * sr); c.scale(1, 1 - tilt);
        const wv = cl(u / .34); if (wv < 1) { c.lineWidth = 1.8 * (1 - wv); c.strokeStyle = mix(P.core, P.bg, wv); c.beginPath(); c.arc(0, 0, 7 + 22 * E_IN(wv), 0, TAU); c.stroke(); }
        band(c, 10.5, 15.5, 0, TAU, P.ink);
        let H = 289 + 360 * E_SW(cl((u - .38) / .54)) + 8 * Math.sin(Math.PI * hold), Tl = -19 + 280 * E_SW(cl((u - .1) / .44)) + 80 * E_IN(cl((u - .6) / .36));
        Tl = Math.min(Tl, H - 14); H += k * 360; Tl += k * 360;
        const n = Math.max(8, Math.round((H - Tl) / 3)), pts = [];
        for (let i = 0; i < n; i++) { const a = (H - (H - Tl) * i / (n - 1)) * D; pts.push([21.75 * Math.cos(a), 21.75 * Math.sin(a)]); }
        snake(c, pts, 4.5, 3.4, P.ink, null);
        disc(c, 0, 0, 6.5 * (1 + .16 * Math.sin(Math.PI * hold)), P.core);
      },
      orbit(c, w, h, t, P, S, o) {
        const s = Math.min(w, h) / 48 * .6; c.translate(w / 2, h / 2); c.scale(s, s);
        const g = c.createRadialGradient(0, 0, 1, 0, 0, 24); g.addColorStop(0, rgba(P.core, .32)); g.addColorStop(1, rgba(P.core, 0)); c.fillStyle = g; c.fillRect(-26, -26, 52, 52);
        const orbs = [{ R: 14, inc: 64 * D, Om: t * .24, ph: t * TAU / 1.9, dir: 1, col: P.ink }, { R: 21.5, inc: -58 * D, Om: 1.3 - t * .16, ph: t * TAU / 2.7 + 2, dir: -1, col: P.hi }];
        const proj = (ob, a) => { const x = ob.R * Math.cos(a), y0 = ob.R * Math.sin(a), z = y0 * Math.sin(ob.inc), y = y0 * Math.cos(ob.inc), co = Math.cos(ob.Om), si = Math.sin(ob.Om), f = 70 / (70 - z); return [(x * co - y * si) * f, (x * si + y * co) * f, z, f]; };
        const segs = [];
        for (const ob of orbs) {
          let p = proj(ob, 0); for (let i = 1; i <= 72; i++) { const q = proj(ob, i / 72 * TAU); segs.push([(p[2] + q[2]) / 2, p[0], p[1], q[0], q[1], .3, P.track]); p = q; }
          const hd = ob.dir * (ob.ph - .42 * Math.sin(ob.ph)), N = 30; let pr = null;
          for (let i = 0; i < N; i++) { const q = proj(ob, hd - ob.dir * i * .07 * o.len), f = i / (N - 1); if (pr) { const z = (pr[2] + q[2]) / 2; segs.push([z, pr[0], pr[1], q[0], q[1], lerp(3.6, .7, f) * q[3], mix(ob.col, P.bg, cl(-z / ob.R * .5 + .08) + f * f * .55)]); } else segs.push([q[2] + .01, q[0], q[1], null, null, 2.1 * q[3], mix(ob.col, P.bg, cl(-q[2] / ob.R * .5))]); pr = q; }
        }
        segs.sort((a, b) => a[0] - b[0]);
        let i = 0; for (; i < segs.length && segs[i][0] < 0; i++) seg(c, segs[i]);
        const cr = 6.5 * (1 + .05 * Math.sin(t * 2.6)), gr = c.createRadialGradient(-2.2, -2.6, .4, 0, 0, cr); gr.addColorStop(0, P.hi); gr.addColorStop(.55, P.core); gr.addColorStop(1, P.deep); c.fillStyle = gr; c.beginPath(); c.arc(0, 0, cr, 0, TAU); c.fill();
        for (; i < segs.length; i++) seg(c, segs[i]);
      },
      einzug(c, w, h, t, P, S, o) {
        const s = Math.min(w, h) / 48 * .42; c.translate(w / 2, h / 2); c.scale(s, s);
        const Dt = .26, L = 1.5, k1 = Math.floor(t / Dt), k0 = Math.floor((t - L - .4) / Dt); let gulp = 0;
        for (let k = k0; k <= k1; k++) {
          const tk = k * Dt, u = (t - tk) / L;
          if (u >= 1) { const e = t - tk - L; if (e < .3) gulp += Math.sin(Math.PI * e / .3); continue; }
          if (u < 0) continue;
          const a0 = hash(k) * TAU, r0 = 36 + hash(k + 31) * 16, sp = 1.5 + hash(k + 7) * 1.6, M = Math.max(4, Math.round(13 * o.len)), pts = [];
          for (let j = 0; j < M; j++) { const v = u - j * .024; if (v < 0) break; const r = 6 + (r0 - 6) * (1 - v * v), a = a0 + sp * v * v; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
          const fd = cl(u / .18), c0 = fd < 1 ? mix(P.bg, P.ink, fd) : mix(P.ink, P.core, cl((u - .45) / .4));
          snake(c, pts, lerp(1.2, 2.2, u), .3, c0, P.bg, 1.4);
        }
        const q = t / 2.4, rot = (Math.floor(q) + E_ANL(fr(q))) * Math.PI;
        band(c, 19.5, 24, L2A + rot, L2B + rot, P.ink); band(c, 10.5, 15.5, 0, TAU, P.ink);
        disc(c, 0, 0, 6.5 * (1 + .15 * gulp), P.core);
      },
      abgleich(c, w, h, t, P, S, o) {
        const Ax = Math.min(w * .4, h * .9), Ay = Ax * 1.3; c.translate(w / 2, h / 2);
        const pt = s => { const sn = Math.sin(s), d = 1 + sn * sn; return [Ax * Math.cos(s) / d, Ay * sn * Math.cos(s) / d, sn]; };
        c.lineWidth = 1; c.strokeStyle = P.track; c.beginPath(); for (let i = 0; i <= 96; i++) { const p = pt(i / 96 * TAU); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); } c.stroke();
        const om = TAU / 3.4, g = t * om - .22 * Math.sin(2 * t * om), sA = g, sB = g + Math.PI / 2;
        const wrap = x => { x = ((x % TAU) + TAU) % TAU; return x > Math.PI ? x - TAU : x; };
        let pr = 0, pl = 0; for (const s of [sA, sB]) { const a = wrap(s), b2 = wrap(s - Math.PI); pr += Math.exp(-a * a * 5); pl += Math.exp(-b2 * b2 * 5); }
        const nb = Ax * .085;
        c.save(); c.translate(-Ax * .56, 0); const k1 = 1 + .18 * pl; c.scale(k1, k1); c.fillStyle = P.ink; rr(c, -nb, -nb, nb * 2, nb * 2, nb * .35); c.fill(); c.restore();
        disc(c, Ax * .56, 0, nb * 1.1 * (1 + .18 * pr), P.core);
        const segs = [];
        [[sA, P.ink], [sB, P.core]].forEach(([s0, col], si) => { const N = 30; let p0 = null; for (let i = 0; i < N; i++) { const p = pt(s0 - i * .055 * o.len), f = i / (N - 1); if (p0) segs.push([(p[2] + p0[2]) / 2 + si * .001, p0[0], p0[1], p[0], p[1], Ax * .062 * (1 + .22 * p[2]) * lerp(1, .3, f), mix(col, P.bg, f * f * .7)]); p0 = p; } const h0 = pt(s0); segs.push([h0[2] + .02, h0[0], h0[1], null, null, Ax * .04 * (1 + .22 * h0[2]), col]); });
        segs.sort((a, b) => a[0] - b[0]); segs.forEach(s => seg(c, s));
      },
      snake(c, w, h, t, P, S, o) {
        const C = 26, R = 11, DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]], key = (x, y) => x + y * C, inb = (x, y) => x >= 0 && y >= 0 && x < C && y < R;
        const blocked = () => { const b = S.body, s = new Set(); for (let i = 0; i < b.length - (S.grow > 0 ? 0 : 1); i++) s.add(key(b[i][0], b[i][1])); return s; };
        const flood = (st, bl) => { const seen = new Set([key(st[0], st[1])]), q = [st]; let n = 0; while (q.length && n < 400) { const [x, y] = q.pop(); n++; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy, kk = key(nx, ny); if (inb(nx, ny) && !bl.has(kk) && !seen.has(kk)) { seen.add(kk); q.push([nx, ny]); } } } return n; };
        const spawn = () => { const occ = new Set(S.body.map(b => key(b[0], b[1]))); for (let i = 0; i < 400; i++) { const x = Math.floor(Math.random() * C), y = Math.floor(Math.random() * R); if (!occ.has(key(x, y))) return [x, y]; } return [0, 0]; };
        const decide = () => {
          const b = S.body, hx = b[0][0], hy = b[0][1], bl = blocked(), prev = new Map([[key(hx, hy), null]]), q = [[hx, hy]];
          const dirs = [S.dir, ...DIRS.filter(d => d[0] !== S.dir[0] || d[1] !== S.dir[1])];
          let qi = 0, found = null;
          while (qi < q.length) { const [x, y] = q[qi++]; if (x === S.food[0] && y === S.food[1]) { found = [x, y]; break; } for (const [dx, dy] of dirs) { const nx = x + dx, ny = y + dy, kk = key(nx, ny); if (inb(nx, ny) && !bl.has(kk) && !prev.has(kk)) { prev.set(kk, [x, y]); q.push([nx, ny]); } } }
          const bl2 = new Set(bl); bl2.add(key(hx, hy));
          let step = null;
          if (found) { let cur = found; for (;;) { const pv = prev.get(key(cur[0], cur[1])); if (!pv || (pv[0] === hx && pv[1] === hy)) break; cur = pv; } step = cur; if (flood(step, bl2) < Math.min(b.length + 4, 60)) step = null; }
          if (!step) { let best = -1; for (const [dx, dy] of dirs) { const nx = hx + dx, ny = hy + dy; if (!inb(nx, ny) || bl.has(key(nx, ny))) continue; const f = flood([nx, ny], bl2) + Math.random() * .5; if (f > best) { best = f; step = [nx, ny]; } } }
          return step;
        };
        if (!S.body) { S.body = [[5, 5], [4, 5], [3, 5], [2, 5]]; S.dir = [1, 0]; S.grow = 0; S.p = 0; S.score = 0; S.mode = 'run'; S.fx = []; S.food = spawn(); S.ft = 0; S.next = decide(); o.text('snakeScore', '0000'); }
        const dt = o.dt; S.ft += dt; S.fx.forEach(f => f.t += dt); S.fx = S.fx.filter(f => f.t < .5);
        if (S.mode === 'run') {
          S.p += dt / .115; let guard = 0;
          while (S.p >= 1 && guard++ < 6) {
            S.p -= 1;
            if (!S.next) { S.mode = 'shed'; S.st = 0; S.p = 0; break; }
            const nx = S.next; S.dir = [nx[0] - S.body[0][0], nx[1] - S.body[0][1]]; S.body.unshift(nx); if (S.grow > 0) S.grow--; else S.body.pop();
            if (nx[0] === S.food[0] && nx[1] === S.food[1]) { S.score++; S.grow += 2; S.fx.push({ x: nx[0], y: nx[1], t: 0 }); o.text('snakeScore', String(S.score).padStart(4, '0')); if (S.body.length + S.grow >= 42) { S.mode = 'shed'; S.st = 0; S.p = 0; S.grow = 0; break; } S.food = spawn(); S.ft = 0; }
            S.next = decide();
          }
        } else {
          S.st += dt; while (S.st > .035 && S.body.length > 3) { S.st -= .035; const tl = S.body.pop(); S.fx.push({ x: tl[0], y: tl[1], t: 0, small: 1 }); }
          if (S.body.length <= 3 && S.st > .45) { S.mode = 'run'; S.p = 0; S.food = spawn(); S.ft = 0; S.next = decide(); }
        }
        const cell = Math.min((w - 28) / C, (h - 28) / R), ox = (w - cell * C) / 2, oy = (h - cell * R) / 2, X = x => ox + (x + .5) * cell, Y = y => oy + (y + .5) * cell;
        for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) disc(c, X(x), Y(y), Math.max(.8, cell * .05), P.track);
        if (S.mode === 'run') { const fx = X(S.food[0]), fy = Y(S.food[1]), sc = backOut(S.ft / .4) * (1 + .06 * Math.sin(t * 5)), z = cell * .27 * sc; c.save(); c.translate(fx, fy); c.lineWidth = cell * .085; c.strokeStyle = P.core; c.lineJoin = 'round'; rr(c, -z, -z, 2 * z, 2 * z, z * .3); c.stroke(); c.beginPath(); c.moveTo(-z, -z * .25); c.lineTo(z, -z * .25); c.stroke(); c.restore(); }
        for (const f of S.fx) { const e = f.t / .5; c.lineWidth = cell * .07 * (1 - e); c.strokeStyle = mix(P.core, P.bg, e); c.beginPath(); c.arc(X(f.x), Y(f.y), cell * (f.small ? .15 + .3 * e : .3 + .8 * E_IN(e)), 0, TAU); c.stroke(); }
        const b = S.body, n = b.length, run = S.mode === 'run' && S.next, p = run ? S.p : 0, nx = run ? S.next : b[0];
        const pts = [[lerp(X(b[0][0]), X(nx[0]), p), lerp(Y(b[0][1]), Y(nx[1]), p)]];
        for (let i = 0; i < n - 1; i++) pts.push([X(b[i][0]), Y(b[i][1])]);
        const tl = b[n - 1], t2 = b[n - 2] || tl, tp = (S.grow > 0 || !run) ? 0 : p; pts.push([lerp(X(tl[0]), X(t2[0]), tp), lerp(Y(tl[1]), Y(t2[1]), tp)]);
        snake(c, pts, cell * .68, cell * .4, P.ink, P.core, 1.6);
        const hx = pts[0][0], hy = pts[0][1], dx = run ? nx[0] - b[0][0] : S.dir[0], dy = run ? nx[1] - b[0][1] : S.dir[1];
        const tq = fr(t / 2.3);
        if (tq < .14 && run) { const e = Math.sin(Math.PI * tq / .14), L = cell * .55 * e, x0 = cell * .35; c.save(); c.translate(hx, hy); c.rotate(Math.atan2(dy, dx)); c.strokeStyle = P.core; c.lineWidth = cell * .06; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, 0); c.lineTo(x0 + L, 0); c.lineTo(x0 + L + cell * .12 * e, -cell * .1 * e); c.moveTo(x0 + L, 0); c.lineTo(x0 + L + cell * .12 * e, cell * .1 * e); c.stroke(); c.restore(); }
        disc(c, hx, hy, cell * .4, P.ink);
        eye(c, hx, hy, dx, dy, cell * .4, P, t, .6);
      },
      start(c, w, h, t, P, S, o) {
        const eo = x => 1 - Math.pow(1 - x, 3), io = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
        const CY = 8;
        if (S.ph == null) S.ph = o.dt === 0 ? 6 : 0;
        S.ph = (S.ph + o.dt) % CY; const ph = S.ph;
        const s = Math.min(h / 420, w / 640) * 2.6, z = s / 2.6, cx = w / 2, ky = h * .45, tI = .45;
        const ex = cl((ph - 6.6) / .6), GA = o.alpha * (1 - eo(ex)), zs = 1 + .06 * eo(ex);
        for (let i = 0; i < 34; i++) { const dp = .3 + .7 * fr(i * .618 + .41), x = fr(i * .377 + .2 - t * .012 * dp) * (w + 40) - 20, y = h * (.04 + .92 * fr(i * .7548 + .6)) + 5 * Math.sin(t * .6 + i); c.globalAlpha = o.alpha * cl(ph / .8) * (1 - ex); disc(c, x, y, (.8 + 1.6 * dp) * z, mix(P.bg, P.track, .4 + .6 * dp)); }
        c.globalAlpha = GA; c.translate(cx, ky); c.scale(zs, zs); c.translate(-cx, -ky);
        const fs = Math.round(17 * s), L = ['C', 'O', 'R', 'E']; c.font = '600 ' + fs + 'px Geist, sans-serif';
        const adv = L.map(l => c.measureText(l).width), sp = fs * .05, ww = adv.reduce((a, b) => a + b, 0) + sp * 3;
        const gW = 55 * s + ww, sl = io(cl((ph - tI - 1.55) / .75)), mx = cx + sl * (-gW / 2 + 24 * s), tx0 = cx - gW / 2 + 55 * s;
        const e1 = ph - tI, e2 = ph - tI - .2, e3 = ph - tI - .6, e4 = e3 - .95;
        const bump = e4 > 0 ? (e4 < .15 ? eo(e4 / .15) : Math.exp(-(e4 - .15) * 5)) : 0;
        c.save(); c.translate(mx, ky); c.scale(s * (1 + .05 * bump), s * (1 + .05 * bump));
        if (e2 > 0) { const k = .55 + .45 * backOut(cl(e2 / .6)), sw = io(cl(e2 / .55)); c.save(); c.scale(k, k); band(c, 10.5, 15.5, -Math.PI / 2, -Math.PI / 2 + TAU * sw, P.ink); c.restore(); }
        if (e3 > 0) {
          const f = io(cl(e3 / .95)), a1 = L2A + (L2B - L2A) * f; band(c, 19.5, 24, L2A, a1, P.ink);
          if (f < 1) disc(c, 21.75 * Math.cos(a1), 21.75 * Math.sin(a1), 2.25 + 1 * Math.sin(Math.PI * f), P.ink);
        }
        if (e1 > 0) {
          for (let i = 0; i < 2; i++) { const q = (e1 - i * .14) / .9; if (q <= 0 || q >= 1) continue; c.globalAlpha = GA * (1 - q); c.lineWidth = 1.1 * (1 - q) + .2; c.strokeStyle = P.core; c.beginPath(); c.arc(0, 0, 6.5 + 22 * eo(q), 0, TAU); c.stroke(); }
          c.globalAlpha = GA; disc(c, 0, 0, 6.5 * (backOut(cl(e1 / .45)) + .05 * Math.sin(t * TAU / 2.2) * cl(e1)), P.core);
        }
        c.restore();
        c.textBaseline = 'middle'; c.font = '600 ' + fs + 'px Geist, sans-serif'; let lx = tx0;
        L.forEach((l, i) => { const li = cl((ph - tI - 1.75 - i * .08) / .45); if (li > 0) { c.globalAlpha = GA * li; c.fillStyle = P.ink; c.fillText(l, lx, ky + (1 - eo(li)) * 12 * z + fs * .04); } lx += adv[i] + sp; });
        const st = cl((ph - tI - 2.3) / .4);
        if (st > 0) {
          const u = cl((ph - tI - 2.4) / 2.3), pr = cl(u + .035 * Math.sin(u * TAU * 3)), done = u >= 1;
          const lab = done ? 'Bereit' : pr < .33 ? 'Module werden geladen' : pr < .7 ? 'Verbindung zu srv-core-01' : 'Arbeitsplatz wird vorbereitet';
          const f2 = Math.max(12, Math.round(13.5 * z)), y1 = ky + 24 * s + 50 * z, bw = Math.min(240 * z, w * .5);
          c.globalAlpha = GA * st; c.font = '500 ' + f2 + 'px Geist, sans-serif'; c.textAlign = 'center';
          if (done) { const tw = c.measureText(lab).width, ck = cx - tw / 2 - 12 * z; c.fillStyle = P.core; c.fillText(lab, cx + 4 * z, y1); c.lineWidth = 1.8 * z; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = P.core; c.beginPath(); c.moveTo(ck - 4 * z, y1); c.lineTo(ck - 1 * z, y1 + 3 * z); c.lineTo(ck + 4.5 * z, y1 - 3.5 * z); c.stroke(); }
          else { c.fillStyle = mix(P.ink, P.bg, .28); c.fillText(lab + ' …', cx, y1); }
          c.textAlign = 'left'; c.lineCap = 'round'; c.lineWidth = 2 * z; c.strokeStyle = P.track; c.beginPath(); c.moveTo(cx - bw / 2, y1 + 22 * z); c.lineTo(cx + bw / 2, y1 + 22 * z); c.stroke();
          if (pr > 0) { c.strokeStyle = P.core; c.beginPath(); c.moveTo(cx - bw / 2, y1 + 22 * z); c.lineTo(cx - bw / 2 + bw * pr, y1 + 22 * z); c.stroke(); }
        }
      },
      zustrom(c, w, h, t, P, S, o) {
        const eo = x => 1 - Math.pow(1 - x, 3), io = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
        const CY = 11.2, TS = 4.6, tI = 5.4, N = 120, GL = ['{ }', '#', '§', '@', '</>', '01', '%', '.csv', '&', '→', '.pdf', 'Σ', '42', '.xml', '€', 'mm', '€', 'mm', '.jpeg', '12 mm'], TY = [0, 1, 8, 1, 8, 2, 3, 4, 5, 6, 9, 10, 11, 12, 5, 9, 12, 10, 6, 8, 1, 11];
        if (S.ph == null) { S.ph = o.dt === 0 ? 9.9 : 0; S.tq = 0; }
        S.ph = (S.ph + o.dt) % CY; const ph = S.ph;
        if (!S.it) { S.it = []; for (let i = 0; i < N; i++) { const ts = .3 + (TS - .3) * Math.pow(i / (N - 1), 1 / 2.4); S.it.push({ ts, du: lerp(3, .7, Math.pow(ts / TS, 1.2)), ty: i < 7 ? 7 : TY[Math.floor(hash(i * 2.7 + 5) * TY.length)], a0: hash(i * 7.1 + 1) * TAU, R: .3 + .85 * hash(i * 3.9 + 4), sp: (hash(i + 9) - .5) * 2.6, r0: hash(i * 5.9) * TAU, rs: (hash(i * 2.3) - .5) * 9, ry: 1 + 5 * hash(i * 6.1), k0: i < 7 ? 1.6 + 1.2 * hash(i * 4.1) : .8 + 1.6 * Math.pow(hash(i * 4.1), 2), gl: GL[Math.floor(hash(i * 8.3) * GL.length)] }); } }
        const I = cl(ph / tI) ** 2, pre = ph < tI;
        S.tq += o.dt * (.12 + 1.3 * (pre ? I : Math.max(0, 1 - (ph - tI) / .8)));
        const s = Math.min(h / 420, w / 640) * 2.6, z = s / 2.6, cx = w / 2, ky = h * .45, hd = Math.hypot(w, h) / 2;
        const wb = pre ? 1 - I : 0, vx = cx + Math.sin(t * .55) * w * .07 * wb, vy = ky + Math.cos(t * .42) * h * .06 * wb;
        const ex = cl((ph - 10.4) / .6), GA = o.alpha * (1 - eo(ex)), zs = 1 + .06 * eo(ex);
        const sh = pre ? Math.pow(I, 4) * 3 * z : 0; c.translate(Math.sin(t * 53) * sh, Math.cos(t * 47) * sh);
        const g = u => (1 / (1 + 8 * Math.pow(u, 1.25)) - 1 / 9) * 9 / 8, ic = q => q < .5 ? mix(P.ink, P.hi, q * 2) : mix(P.hi, P.core, (q - .5) * 2);
        const e1 = ph - tI, e2 = e1 - .15, e3 = e1 - .5, e4 = e3 - .95, st0 = cl(ph / .6) * (pre ? 1 : Math.max(0, 1 - e1 / .8));
        if (st0 > 0) {
          const NR = 9; for (let k = 0; k < NR; k++) { const q = S.tq * .5 + k / NR, u = fr(q), ord = Math.floor(q) * NR - k, gg = g(u), r = hd * 1.15 * gg, wd = Math.max(.5, 4.5 * s * 2.4 * gg), rot = ord * 33 * D + t * .4;
            c.globalAlpha = GA * st0 * (.15 + .5 * I) * cl(u / .12) * (1 - cl((u - .8) / .2)); c.save(); c.translate(vx, vy); band(c, r - wd / 2, r + wd / 2, L2A + rot, L2B + rot, mix(P.track, ord % 3 ? P.track : P.deep, .7)); c.restore(); }
          c.lineCap = 'round'; for (let i = 0; i < 70; i++) { const u = fr(S.tq * (.8 + .6 * hash(i * 1.3)) + hash(i * 9.7)), a = hash(i * 4.4 + 2) * TAU, r1 = hd * 1.1 * g(u), r2 = hd * 1.1 * g(Math.max(0, u - .015 - .07 * I));
            c.globalAlpha = GA * st0 * (.25 + .55 * I) * cl(u / .1); c.strokeStyle = mix(P.track, P.ink, .25 + .4 * hash(i)); c.lineWidth = (.6 + 1.2 * (1 - u)) * z; c.beginPath(); c.moveTo(vx + r1 * Math.cos(a), vy + r1 * Math.sin(a)); c.lineTo(vx + r2 * Math.cos(a), vy + r2 * Math.sin(a)); c.stroke(); }
        }
        let n = 0, hit = 0;
        const pos = (it, u) => { const r = hd * it.R * g(u), a = it.a0 + it.sp * u; return [vx + r * Math.cos(a), vy + r * Math.sin(a)]; };
        if (pre) for (let i = N - 1; i >= 0; i--) {
          const it = S.it[i], u = (ph - it.ts) / it.du;
          if (u >= 1) { n++; hit += Math.exp(-(ph - it.ts - it.du) * 9); continue; }
          if (u <= 0) continue;
          const gg = g(u), [x, y] = pos(it, u), col = ic(1 - gg), m = io(cl((u - .55) / .35)), fi = cl(u / .07), da = 1 - cl(m * 1.6), sz = s * it.k0 * 2.2 * lerp(.1, 1, gg);
          if (it.du < 1.6 && u > .05) { const pts = []; for (let j = 0; j < 6; j++) pts.push(pos(it, Math.max(0, u - j * .025 * (1.8 - it.du)))); c.globalAlpha = GA * fi * .45; snake(c, pts, 4.5 * sz / s * z * 1.2, .1, col, P.bg, 1.2); }
          c.save(); c.translate(x, y); c.rotate(it.r0 + it.rs * u); c.scale(sz * lerp(Math.cos(it.r0 + it.ry * u * 3), 1, m), sz); c.globalAlpha = GA * fi;
          drawItem(c, it.ty, it.gl, col, m, da, GA * fi, P);
          c.restore();
        } else n = N;
        if (e1 > 0 && e1 < .6) { c.globalAlpha = GA * .32 * Math.pow(1 - e1 / .6, 2); const fg = c.createRadialGradient(cx, ky, 0, cx, ky, hd); fg.addColorStop(0, P.hi); fg.addColorStop(1, rgba(P.core, 0)); c.fillStyle = fg; c.fillRect(-10, -10, w + 20, h + 20); }
        c.globalAlpha = GA; c.translate(cx, ky); c.scale(zs, zs); c.translate(-cx, -ky);
        const fs = Math.round(17 * s), L = ['C', 'O', 'R', 'E']; c.font = '600 ' + fs + 'px Geist, sans-serif';
        const adv = L.map(l => c.measureText(l).width), sp = fs * .05, ww = adv.reduce((a, b) => a + b, 0) + sp * 3;
        const gW = 55 * s + ww, sl = io(cl((e1 - 1.5) / .75)), mx = (pre ? vx : cx) + sl * (-gW / 2 + 24 * s), tx0 = cx - gW / 2 + 55 * s;
        const bump = e4 > 0 ? (e4 < .15 ? eo(e4 / .15) : Math.exp(-(e4 - .15) * 5)) : 0;
        c.save(); c.translate(mx, pre ? vy : ky); c.scale(s * (1 + .05 * bump), s * (1 + .05 * bump));
        if (e2 > 0) { const k = .55 + .45 * backOut(cl(e2 / .6)), sw = io(cl(e2 / .55)); c.save(); c.scale(k, k); band(c, 10.5, 15.5, -Math.PI / 2, -Math.PI / 2 + TAU * sw, P.ink); c.restore(); }
        if (e3 > 0) { const f = io(cl(e3 / .95)), a1 = L2A + (L2B - L2A) * f; band(c, 19.5, 24, L2A, a1, P.ink); if (f < 1) disc(c, 21.75 * Math.cos(a1), 21.75 * Math.sin(a1), 2.25 + 1 * Math.sin(Math.PI * f), P.ink); }
        if (e1 > 0) for (let i = 0; i < 3; i++) { const q = (e1 - i * .12) / 1; if (q <= 0 || q >= 1) continue; c.globalAlpha = GA * (1 - q); c.lineWidth = 1.4 * (1 - q) + .2; c.strokeStyle = i === 1 ? P.hi : P.core; c.beginPath(); c.arc(0, 0, 6.5 + 40 * eo(q), 0, TAU); c.stroke(); }
        const pc = .12 + .68 * Math.sqrt(n / N), cr = e1 > 0 ? 6.5 * lerp(.8, 1, backOut(cl(e1 / .45))) + .3 * Math.sin(t * TAU / 2.2) * cl(e1) : 6.5 * pc * (1 + .08 * Math.min(2, hit)) * (1 + .1 * Math.sin(t * (4 + 14 * I)));
        const gw = e1 > 0 ? Math.max(0, 1 - e1 / .6) : cl(ph / .4) * (.2 + .7 * I);
        c.globalAlpha = GA * .14 * gw; disc(c, 0, 0, cr * 2.8, P.core); c.globalAlpha = GA * .28 * gw; disc(c, 0, 0, cr * 1.6, P.core);
        c.globalAlpha = GA * cl(ph / .4); disc(c, 0, 0, cr, P.core);
        c.restore(); c.globalAlpha = GA;
        c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '600 ' + fs + 'px Geist, sans-serif'; let lx = tx0;
        L.forEach((l, i) => { const li = cl((e1 - 1.7 - i * .08) / .45); if (li > 0) { c.globalAlpha = GA * li; c.fillStyle = P.ink; c.fillText(l, lx, ky + (1 - eo(li)) * 12 * z + fs * .04); } lx += adv[i] + sp; });
        const st = cl((e1 - 2.25) / .4);
        if (st > 0) {
          const u = cl((e1 - 2.35) / 1.9), pr = cl(u + .035 * Math.sin(u * TAU * 3)), done = u >= 1;
          const lab = done ? 'Bereit' : pr < .33 ? 'Module werden geladen' : pr < .7 ? 'Verbindung zu srv-core-01' : 'Arbeitsplatz wird vorbereitet';
          const f2 = Math.max(12, Math.round(13.5 * z)), y1 = ky + 24 * s + 50 * z, bw = Math.min(240 * z, w * .5);
          c.globalAlpha = GA * st; c.font = '500 ' + f2 + 'px Geist, sans-serif'; c.textAlign = 'center';
          if (done) { const tw = c.measureText(lab).width, ck = cx - tw / 2 - 12 * z; c.fillStyle = P.core; c.fillText(lab, cx + 4 * z, y1); c.lineWidth = 1.8 * z; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = P.core; c.beginPath(); c.moveTo(ck - 4 * z, y1); c.lineTo(ck - 1 * z, y1 + 3 * z); c.lineTo(ck + 4.5 * z, y1 - 3.5 * z); c.stroke(); }
          else { c.fillStyle = mix(P.ink, P.bg, .28); c.fillText(lab + ' …', cx, y1); }
          c.textAlign = 'left'; c.lineCap = 'round'; c.lineWidth = 2 * z; c.strokeStyle = P.track; c.beginPath(); c.moveTo(cx - bw / 2, y1 + 22 * z); c.lineTo(cx + bw / 2, y1 + 22 * z); c.stroke();
          if (pr > 0) { c.strokeStyle = P.core; c.beginPath(); c.moveTo(cx - bw / 2, y1 + 22 * z); c.lineTo(cx - bw / 2 + bw * pr, y1 + 22 * z); c.stroke(); }
        }
      },
      sort(c, w, h, t, P, S, o) {
        const N = 12, val = i => .2 + .8 * i / (N - 1);
        const swapsOf = arr => { const a = arr.slice(), sw = []; for (let i = 1; i < a.length; i++) { let j = i; while (j > 0 && a[j - 1] > a[j]) { sw.push([j, a[j]]); const x = a[j]; a[j] = a[j - 1]; a[j - 1] = x; j--; } } return sw; };
        const shuf = () => { const a = [...Array(N).keys()]; for (let i = N - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; } return a; };
        if (!S.arr) { S.arr = shuf(); S.sw = swapsOf(S.arr); S.k = 0; S.p = 0; S.mode = 'sort'; S.d = 0; }
        const dt = o.dt;
        if (S.mode === 'sort') {
          if (S.k >= S.sw.length) { S.mode = 'done'; S.d = 0; }
          else { S.p += dt / .2; while (S.p >= 1) { S.p -= 1; const j = S.sw[S.k][0], a = S.arr, x = a[j]; a[j] = a[j - 1]; a[j - 1] = x; S.k++; if (S.k >= S.sw.length) { S.mode = 'done'; S.d = 0; S.p = 0; break; } if (S.sw[S.k][1] !== S.sw[S.k - 1][1]) S.p -= .6; } }
        } else if (S.mode === 'done') { S.d += dt; if (S.d > 2) { S.mode = 'shuffle'; S.d = 0; S.perm = shuf(); } }
        else { S.d += dt; if (S.d > 1.35) { S.arr = S.perm; S.sw = swapsOf(S.arr); S.k = 0; S.p = -.4; S.mode = 'sort'; } }
        const tot = Math.min(w * .8, h * 1.7), slot = tot / N, bw = slot * .6, x0 = (w - tot) / 2 + slot / 2, base = h * .76, Hm = h * .52;
        c.strokeStyle = P.track; c.lineWidth = 1; c.beginPath(); c.moveTo((w - tot) / 2, base + 4.5); c.lineTo((w + tot) / 2, base + 4.5); c.stroke();
        const bar = (x, v, lift, col) => { const hh = v * Hm; c.fillStyle = col; rr(c, x0 + x * slot - bw / 2, base - hh - lift, bw, hh, Math.min(bw * .3, 4)); c.fill(); };
        if (S.mode === 'sort') {
          const cur = S.k < S.sw.length ? S.sw[S.k] : null, pp = E_ANL(cl(S.p)); let mv = null;
          S.arr.forEach((id, pos) => { if (cur && pos === cur[0]) { mv = [pos - pp, val(id), Hm * .14 * Math.sin(Math.PI * pp) + Hm * .04]; return; } bar(cur && pos === cur[0] - 1 ? pos + pp : pos, val(id), 0, P.ink); });
          if (mv) bar(mv[0], mv[1], mv[2], P.core);
        } else if (S.mode === 'done') {
          const xw = -2 + (N + 4) * cl(S.d / 1.3);
          S.arr.forEach((id, pos) => { const g = Math.exp(-((pos - xw) ** 2) / 1.4), past = cl(xw - pos); bar(pos, val(id), Hm * .12 * g, mix(P.ink, P.core, Math.max(g, past * .75))); });
        } else {
          const list = S.arr.map((id, pos) => { const to = S.perm.indexOf(id), pr = E_SW(cl((S.d - pos * .045) / .75)), dir = to > pos ? 1 : -.35; return [Math.sin(Math.PI * pr) * dir, lerp(pos, to, pr), val(id), pr, dir]; });
          list.sort((a, b) => a[0] - b[0]).forEach(([lf, x, v, pr, dir]) => { const col = mix(P.ink, P.core, .75 * (1 - pr)); bar(x, v, lf * Hm * .16, dir < 0 ? mix(P.ink, P.bg, .28 * Math.sin(Math.PI * pr)) : col); });
        }
      },
      tunnel(c, w, h, t, P, S, o) {
        const s = Math.min(w, h) / 48 * .5, N = 11, T = 3.8, vx = w / 2 + Math.sin(t * .55) * w * .08, vy = h / 2 + Math.cos(t * .42) * h * .07;
        const pr = 3 * s * (1 + .14 * Math.sin(t * 3.2)), g = c.createRadialGradient(vx, vy, 0, vx, vy, pr * 5); g.addColorStop(0, rgba(P.core, .45)); g.addColorStop(1, rgba(P.core, 0)); c.fillStyle = g; c.fillRect(0, 0, w, h); disc(c, vx, vy, pr, P.core);
        const L = []; for (let k = 0; k < N; k++) { const q = t / T + k / N; L.push([fr(q), Math.floor(q) * N - k]); }
        L.sort((a, b) => a[0] - b[0]);
        for (const [u, ord] of L) {
          const Z = 7 - 6.4 * u, f = 1 / Z, e = Math.pow(u, 1.6), cx = lerp(vx, w / 2, e), cy = lerp(vy, h / 2, e), r = 21.75 * s * f * 1.1, wd = 4.5 * s * f * 1.1, rot = ord * 33 * D + t * .4;
          const col = mix(((ord % 3) + 3) % 3 === 0 ? P.core : P.ink, P.bg, 1 - cl(u / .4));
          c.save(); c.globalAlpha = o.alpha * (1 - cl((u - .8) / .2)); c.translate(cx, cy); band(c, r - wd / 2, r + wd / 2, L2A + rot, L2B + rot, col); c.restore();
        }
      },
      ablauf(c, w, h, t, P, S, o) {
        const eo = x => 1 - Math.pow(1 - x, 3), io = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2, WH = '#ffffff', dt = o.dt, still = dt === 0;
        const ORD = ['start', 'sammeln', 'bearbeitung', 'fertig'], MS = o.msgs && o.msgs.length ? o.msgs : ['Starte CORE', 'Prüfe Fakten', 'Lade Stammdaten', 'Verbinde Quellen'], MD = 1.5;
        const GAP = 5 * D, BL = 13 * D, TC = 1.4, IV = .32, DU = 1.7, TY = [0, 1, 8, 2, 10, 5, 6, 9, 12, 4, 3, 11, 5, 1, 0, 6], GL = ['€', 'mm', '#', '§', '01', '.pdf', '42', '%', '.csv', '12 mm'];
        const s = Math.min(h / 420, w / 640) * 2.6, z = s / 2.6, cx = w / 2, ky = h * .42, R0 = Math.hypot(w, h) / 2 / s + 12;
        if (!S.init) Object.assign(S, { init: 1, step: null, e: 0, te: 0, hd: L2B, tl: L2A, vh: 0, vt: 0, wB: 0, wBo: 0, cap: 0, items: [], acc: 0, hit: 0, lab: '', labP: '', labT: 9, out: 0, cnt: 0, built: 1 });
        let want = ORD.includes(o.step) ? o.step : null;
        if (!want) { const du = { start: .3 + MS.length * MD, sammeln: 5, bearbeitung: 5 }[S.step]; want = !S.step ? 'start' : S.step !== 'fertig' && S.te > du ? ORD[ORD.indexOf(S.step) + 1] : S.step; }
        if (want !== S.step) {
          const first = !S.step; S.step = want; S.te = 0; S.built = want === 'start' && first ? 0 : 1; o.text && o.text('step', want);
          if (want === 'bearbeitung') { if (first) S.tl = S.hd - 90 * D; S.b0 = S.hd; }
          if (want === 'fertig') { let tl0 = S.tl, hd0 = S.hd, mh = S.vh, mt = Math.max(0, S.vt); if (first) { tl0 = L2A; hd0 = L2A + 90 * D; mh = -1; mt = 0; }
            const L = hd0 - tl0, X = Math.max(mt * .35, 200 * D - (TAU - GAP - L)), TF = tl0 + X, H1 = TF + TAU - GAP, sp = H1 - hd0;
            S.F = { tl0, hd0, TF, H1, mh: mh < 0 ? 1.6 * sp : Math.min(2.5 * sp, Math.max(0, mh * TC)), mt: Math.min(2.5 * X, mt * TC) }; }
        }
        if (still) { S.e = 9; S.te = Math.max(S.te, S.step === 'start' ? 1.6 : 20); S.built = 1; }
        S.e += dt; S.te += dt; const te = S.te, st = S.step, F = S.F, kk = still ? 1 : 1 - Math.exp(-dt * 4);
        S.wB += ((st === 'bearbeitung' ? 1 : 0) - S.wB) * kk; S.wBo += ((st === 'bearbeitung' || st === 'fertig' ? 1 : 0) - S.wBo) * kk;
        const ph0 = S.hd, pt0 = S.tl; let k = -1, clk = 0, bk = 0;
        if (st === 'start' && !S.built) { S.tl = L2A; S.hd = L2A + (L2B - L2A) * io(cl((te - .5) / .95)); if (te > 1.45) S.built = 1; }
        else if (st === 'start' || st === 'sammeln') { const n = Math.ceil((S.tl - L2A - 30 * D) / TAU) * TAU, q = still ? 1 : 1 - Math.exp(-dt * 3.5); S.tl += (L2A + n - S.tl) * q; S.hd += (L2B + n - S.hd) * q; }
        else if (st === 'bearbeitung') { const q = te / 1.8, kq = Math.floor(q), u = q - kq, rot = S.b0 + te * TAU / 3.2, SG = 160 * D, kf = still ? 1 : 1 - Math.exp(-dt * (3 + 5 * cl(te / 1.2)));
          S.hd += (rot + (kq + io(cl(u / .6))) * SG - S.hd) * kf; S.tl += (rot + (kq + io(cl((u - .4) / .6))) * SG - 90 * D - S.tl) * kf; }
        else { const u = cl(te / TC), H = (p0, p1, m) => (2 * u ** 3 - 3 * u * u + 1) * p0 + (u ** 3 - 2 * u * u + u) * m + (-2 * u ** 3 + 3 * u * u) * p1;
          k = te - TC; S.tl = H(F.tl0, F.TF, F.mt); const bo = cl((te - TC + .25) / .22); bk = 1 - Math.pow(1 - bo, 4);
          S.hd = k > 0 ? F.TF + TAU - GAP * (1 - E_IN(cl(k / .06))) : H(F.hd0, F.H1, F.mh); clk = k > 0 ? Math.exp(-k * 12) * Math.sin(Math.min(k * 36, Math.PI)) : 0; }
        if (dt > 0) { S.vh += ((S.hd - ph0) / dt - S.vh) * .3; S.vt += ((S.tl - pt0) / dt - S.vt) * .3; }
        S.cap += ((st === 'bearbeitung' || st === 'fertig' || (st === 'start' && !S.built && te > .5) ? 1 : 0) - S.cap) * (still ? 1 : 1 - Math.exp(-dt * 6));
        const G = (S.hd + S.tl + TAU) / 2;
        if (!still && st === 'sammeln') { S.acc += dt; while (S.acc > IV) { S.acc -= IV; const j = S.cnt++; S.items.push({ t0: S.e - S.acc, j, a0: G + (hash(j * 3.7 + 1) - .5) * 200 * D }); } }
        S.hit *= still ? 1 : Math.exp(-dt * 7);
        let glint = 0;
        S.items = S.items.filter(it => { const u = (S.e - it.t0) / DU; if (u >= 1) { S.hit += 1; return false; } it.u = u; const pa = cl((u - .72) / .1); if (pa > 0 && pa < 1) glint = Math.max(glint, Math.sin(Math.PI * pa)); return true; });
        const kc = k - 1.95, fl = k - 2.35, s2 = cl((k - .07) / .95), s1 = cl((k - 1.07) / .75), t2 = cl((k - .9) / .25), t1 = cl((k - 1.77) / .22);
        const AC = F ? F.TF + TAU : 0, h2 = AC + TAU * io(s2), h1 = h2 + TAU * io(s1), qq = (k > 0 ? Math.exp(-k * 6.5) : 0) + (kc > 0 ? Math.exp(-kc * 8) * .45 : 0);
        if (!still && st === 'fertig' && (o.loop || !ORD.includes(o.step)) && k > 5) { S.out += dt / .5; if (S.out >= 1) { for (const key in S) delete S[key]; return; } }
        const GA = o.alpha * (still ? 1 : eo(cl(S.e / .5))) * (1 - eo(cl(S.out))), zi = 1 + .06 * (1 - eo(cl(S.e / 1.1)));
        const bt = st === 'start' && !S.built ? te : 9, cb = cl(bt / .45), r1s = io(cl((bt - .15) / .55)), r1k = .55 + .45 * backOut(cl((bt - .15) / .6));
        const glow = (r0, r1, hd, tl, al) => { if (al <= 0) return; c.save(); c.shadowColor = WH; c.shadowBlur = 7 * s; for (let j = 0; j < 24; j++) { c.globalAlpha = GA * al * Math.pow(1 - j / 24, 1.6); band(c, r0, r1, hd - tl * (j + 1) / 24, hd - tl * j / 24 + .004, WH); } c.restore(); };
        const dot = (r, an, al) => { if (al <= 0) return; c.save(); c.shadowColor = WH; c.shadowBlur = 8 * s; c.globalAlpha = GA * al; disc(c, r * Math.cos(an), r * Math.sin(an), 2, WH); c.restore(); };
        const sheen = (v, al) => { if (v <= 0 || v >= 1) return; c.save(); c.rotate(-.6); const x = -40 + 80 * io(v), lg = c.createLinearGradient(x - 9, 0, x + 9, 0); lg.addColorStop(0, rgba(WH, 0)); lg.addColorStop(.5, rgba(WH, al)); lg.addColorStop(1, rgba(WH, 0)); c.globalAlpha = GA; c.fillStyle = lg; c.fillRect(-40, -40, 80, 80); c.restore(); };
        const shx = (Math.sin(t * 71) + .6 * Math.sin(t * 113)) * 2.4 * z * qq, shy = (Math.cos(t * 59) + .6 * Math.cos(t * 97)) * 2 * z * qq;
        c.globalAlpha = GA; c.save(); c.translate(cx + shx, ky + shy); c.rotate(.035 * clk + .03 * qq * Math.sin(t * 83)); const sc = s * zi * (1 - .04 * clk); c.scale(sc, sc);
        if (k > 0 && k < .6) for (let i = 0; i < 2; i++) { const v = cl((k - i * .1) / .5); if (v <= 0 || v >= 1) continue; c.globalAlpha = GA * .4 * (1 - v); c.lineWidth = .55; c.strokeStyle = i ? P.hi : P.ink; c.beginPath(); c.arc(0, 0, 24 + 7 * eo(v), 0, TAU); c.stroke(); }
        const br = .5 + .5 * Math.sin(t * TAU / 2.4), hp = Math.min(1.4, S.hit), ca = kc > 0 ? Math.exp(-kc * 2.2) : 0, fw = st === 'fertig' ? cl(te / .8) : 0;
        const halo = (.1 + .08 * br) * cb * (1 - fw) + .2 * hp + (kc > 0 ? cl(kc / .25) * (.12 + .4 * ca + .03 * Math.sin(t * 2.2)) : 0);
        if (halo > 0) { const hg = c.createRadialGradient(0, 0, 4, 0, 0, 6.5 + 12 * (1 - ca * .4)); hg.addColorStop(0, rgba(P.hi, Math.min(1, halo))); hg.addColorStop(1, rgba(P.hi, 0)); c.globalAlpha = GA; c.fillStyle = hg; c.beginPath(); c.arc(0, 0, 20, 0, TAU); c.fill(); }
        c.globalAlpha = GA; const th = .7 * clk;
        if (S.hd - S.tl > .002) band(c, 19.5 + th, 24 - th, S.tl, S.hd, P.ink);
        const cap = 2.25 * S.cap * (1 - bk) * (st === 'start' && !S.built ? 1 + .45 * Math.sin(Math.PI * cl((te - .5) / .95)) : 1);
        if (k <= 0 && S.hd - S.tl > .01 && cap > .05) disc(c, 21.75 * Math.cos(S.hd), 21.75 * Math.sin(S.hd), cap, P.ink);
        if (r1s > 0) { c.save(); c.scale(r1k, r1k); band(c, 10.5, 15.5, -Math.PI / 2, -Math.PI / 2 + TAU * r1s, P.ink); c.restore(); }
        const bw = S.wBo * (st === 'fertig' ? 1 - cl((k - 2.35) / .5) : 1);
        if (bw > .01) { const b0 = S.hd - 9 * D, b1 = S.hd - 1 * D + BL * bk; c.globalAlpha = GA * bw; band(c, 20.7, 22.8, b0, b1, P.core); if (bk < 1) disc(c, 21.75 * Math.cos(b1), 21.75 * Math.sin(b1), 1.05, P.core); c.globalAlpha = GA; }
        const cr = 6.5 * backOut(cb) * (1 + .04 * Math.sin(t * TAU / 2.4) * (1 - fw) + .07 * hp) * (1 - .08 * clk + .1 * (kc > 0 ? Math.sin(Math.PI * cl(kc / .35)) : 0));
        disc(c, 0, 0, cr, mix(P.core, WH, .12 * br * (1 - fw) + .35 * Math.min(1, S.hit) + .85 * ca));
        c.save(); c.globalCompositeOperation = 'source-atop';
        const sp = .2 + .25 * cl(k / .3); c.globalAlpha = GA * sp * cb; band(c, 22.9, 24.5, 196 * D, 250 * D, WH); band(c, 14.5, 15.5, 196 * D, 250 * D, WH); c.globalAlpha = GA * (sp + .1) * cb; disc(c, -2.3, -2.3, 1.5, WH);
        if (glint > 0) { c.globalAlpha = GA * .7 * glint; band(c, 19.5, 24.5, S.hd - 14 * D, S.hd, WH); band(c, 19.5, 24.5, S.tl, S.tl + 14 * D, WH); }
        if (st === 'fertig') { sheen(k / .55, .7); sheen((fl - .1) / .8, .55); } else if (S.built) sheen(fr(t / 3.6) / .3, .45);
        c.restore();
        if (st === 'start') { const mi = Math.floor((te - .3) / MD); if (mi >= 1) { const v = cl((te - .3 - mi * MD) / .9); if (v < 1) glow(10.5, 15.5, -Math.PI / 2 + TAU * io(v), 1.8 * Math.sin(Math.PI * Math.min(1, v * 1.6)) + .2, .8 * Math.min(1, v * 6) * (1 - cl((v - .9) / .1))); } }
        if (S.wB > .01) { const gh = -t * TAU / 2.2 + Math.PI; c.save(); c.shadowColor = WH; c.shadowBlur = 6 * s; for (let j = 0; j < 20; j++) { c.globalAlpha = GA * .6 * S.wB * Math.pow(1 - j / 20, 1.6); band(c, 10.5, 15.5, gh + 1.6 * j / 20 - .004, gh + 1.6 * (j + 1) / 20, WH); } c.restore(); }
        if (s2 > 0 && s2 < 1) glow(19.5, 24, h2, 1.9 * Math.sin(Math.PI * Math.min(1, s2 * 1.6)) + .2, .95 * Math.min(1, s2 * 6) * (1 - cl((s2 - .92) / .08)));
        if (t2 > 0 && t2 < 1) dot(lerp(21.75, 13, io(t2)), h2, Math.sin(Math.PI * t2));
        if (s1 > 0 && s1 < 1) glow(10.5, 15.5, h1, 2.1 * Math.sin(Math.PI * Math.min(1, s1 * 1.6)) + .2, .95 * Math.min(1, s1 * 6) * (1 - cl((s1 - .9) / .1)));
        if (t1 > 0 && t1 < 1) dot(lerp(13, 0, io(t1)), h1, Math.sin(Math.PI * t1));
        if (fl > 0 && fl < .9) { const v = fl / .9, al = .32 * Math.sin(Math.PI * cl(v / .25)) * (1 - v); c.save(); c.shadowColor = WH; c.shadowBlur = 10 * s; c.globalAlpha = GA * al; band(c, 19.5, 24, 0, TAU, WH); band(c, 10.5, 15.5, 0, TAU, WH); c.restore(); }
        const gx = 21.75 * Math.cos(G), gy = 21.75 * Math.sin(G);
        S.items.forEach(it => {
          const u = it.u, j = it.j, ty = TY[Math.floor(hash(j * 2.9 + 4) * TY.length)], gl = GL[Math.floor(hash(j * 8.3) * GL.length)], k0 = .9 + .6 * hash(j * 5.1), d0 = Math.atan2(Math.sin(it.a0 - G), Math.cos(it.a0 - G));
          let x, y, sz, m;
          if (u < .8) { const v = Math.pow(u / .8, 1.7), a0 = G + d0, rr2 = 21.75 + (R0 - 21.75) * .32, ca2 = G + d0 * .25, p0x = R0 * Math.cos(a0), p0y = R0 * Math.sin(a0), qx = rr2 * Math.cos(ca2), qy = rr2 * Math.sin(ca2);
            x = (1 - v) * (1 - v) * p0x + 2 * v * (1 - v) * qx + v * v * gx; y = (1 - v) * (1 - v) * p0y + 2 * v * (1 - v) * qy + v * v * gy; sz = k0 * lerp(1.25, .3, Math.pow(v, 1.2)); m = io(cl((v - .55) / .45)); }
          else { const v = E_IN(cl((u - .8) / .2)); x = gx * (1 - v); y = gy * (1 - v); sz = k0 * .3 * (1 - .3 * v); m = 1; }
          const col = u > .8 ? mix(P.hi, WH, .4) : mix(P.ink, P.hi, cl(u * 1.4)), fi = cl(u / .1) * (1 - cl((u - .94) / .06));
          c.save(); c.translate(x, y); c.rotate((hash(j) - .5) * 2 * (1 - m)); c.scale(sz, sz); drawItem(c, ty, gl, col, m, 1 - cl(m * 1.6), GA * fi, P); c.restore();
        });
        c.restore();
        let lab;
        if (st === 'start') { const mi = Math.floor((te - .3) / MD); lab = te < .3 ? '' : MS.length < 2 || mi < 1 ? MS[0] : MS[1 + (mi - 1) % (MS.length - 1)]; }
        else if (st === 'fertig') lab = k > 2.45 ? o.label || 'Fertig' : '';
        else lab = o.label || (st === 'sammeln' ? 'Sammle Details' : 'In Bearbeitung');
        if (lab !== S.lab) { S.labP = S.lab; S.lab = lab; S.labT = 0; S.labF = st === 'fertig'; }
        S.labT = still ? 9 : S.labT + dt;
        const f2 = Math.max(12, Math.round(13.5 * z)), y0 = ky + 24 * s + 26 * z, base = mix(P.ink, P.bg, .28);
        c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '500 ' + f2 + 'px Geist, sans-serif';
        const drawLab = (L, al, dy, fin, shv) => { if (!L || al <= 0) return; const tw = c.measureText(L).width, dw = fin ? 0 : 14.4 * z, x0 = cx - (tw + dw) / 2, y = y0 + dy; c.globalAlpha = GA * al;
          if (shv > 0 && shv < 1) { const sx = x0 - 30 * z + (tw + 60 * z) * shv, lg = c.createLinearGradient(sx - 24 * z, 0, sx + 24 * z, 0); lg.addColorStop(0, base); lg.addColorStop(.5, mix(P.ink, WH, .6)); lg.addColorStop(1, base); c.fillStyle = lg; } else c.fillStyle = base;
          c.fillText(L, x0, y); if (!fin) for (let i = 0; i < 3; i++) { c.globalAlpha = GA * al * (.25 + .75 * Math.max(0, Math.sin((t * 1.6 - i * .22) * Math.PI))); disc(c, x0 + tw + 4 * z + i * 4.2 * z, y + f2 * .28, 1.5 * z, base); } };
        if (S.labT < .4) { const v = eo(cl(S.labT / .35)); drawLab(S.labP, 1 - v, -8 * z * v, S.labP === (o.label || 'Fertig') && !S.labF, 0); }
        const li = cl((S.labT - .12) / .4); drawLab(S.lab, li, 6 * z * (1 - eo(li)), st === 'fertig', st === 'fertig' ? cl((S.labT - .2) / .8) : fr(t / 2.6) / .55);
        c.textAlign = 'left';
      },
      sammeln(c, w, h, t, P, S, o) { return A.ablauf(c, w, h, t, P, S, { ...o, step: 'sammeln' }); },
      bearbeitung(c, w, h, t, P, S, o) { return A.ablauf(c, w, h, t, P, S, { ...o, step: 'bearbeitung' }); },
      fertig(c, w, h, t, P, S, o) { return A.ablauf(c, w, h, t, P, S, { ...o, step: 'fertig', loop: true }); },
      ok(c, w, h, t, P, S, o) {
        const s = Math.min(w, h) / 48 * (o.fill || .56), u = fr(t / 3.4); c.translate(w / 2, h / 2); c.scale(s, s);
        const fade = cl(u / .06) * (1 - cl((u - .9) / .1)); c.globalAlpha = o.alpha * fade;
        const cz = E_SW(cl((u - .1) / .3)), a1 = L2B + (TAU - (L2B - L2A)) * cz, q = cl((u - .38) / .5), sw = cl((u - .4) / .1), col = mix(P.core, P.ok, sw);
        const wv = cl((u - .4) / .4); if (wv > 0 && wv < 1) { c.lineWidth = 1.6 * (1 - wv); c.strokeStyle = mix(P.ok, P.bg, wv); c.beginPath(); c.arc(0, 0, 24 + 14 * E_IN(wv), 0, TAU); c.stroke(); }
        band(c, 19.5, 24, L2A, a1, mix(P.ink, P.ok, sw * .9)); if (cz < 1) disc(c, 21.75 * Math.cos(a1), 21.75 * Math.sin(a1), 2.25 + Math.sin(Math.PI * cz), P.ink);
        band(c, 10.5, 15.5, 0, TAU, P.ink);
        const r = 6.5 + 3 * backOut(q); disc(c, 0, 0, r, col);
        const k = E_IN(cl((u - .5) / .18)); if (k > 0) { const pts = [[-3.4, .2], [-1, 2.6], [3.6, -2.4]], L1 = Math.hypot(2.4, 2.4), L2 = Math.hypot(4.6, 5), d = k * (L1 + L2); c.lineWidth = 1.7; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = P.bg; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); if (d <= L1) { const f = d / L1; c.lineTo(lerp(pts[0][0], pts[1][0], f), lerp(pts[0][1], pts[1][1], f)); } else { const f = (d - L1) / L2; c.lineTo(pts[1][0], pts[1][1]); c.lineTo(lerp(pts[1][0], pts[2][0], f), lerp(pts[1][1], pts[2][1], f)); } c.stroke(); }
      },
      err(c, w, h, t, P, S, o) {
        const s = Math.min(w, h) / 48 * (o.fill || .56), u = fr(t / 3.6), hit = u - .36;
        const fade = cl(u / .06) * (1 - cl((u - .9) / .1)), sh = hit > 0 ? Math.sin(hit * 3.6 * 40) * Math.exp(-hit * 3.6 * 5) * 2.6 : 0, ec = cl(hit / .06);
        c.translate(w / 2, h / 2); c.scale(s, s); c.translate(sh, 0); c.globalAlpha = o.alpha * fade;
        const rot = E_ANL(cl(u / .36)) * TAU * 1.15 - (hit > 0 ? .25 * Math.exp(-hit * 18) : 0);
        band(c, 19.5, 24, L2A + rot, L2B + rot, mix(P.ink, P.err, ec)); band(c, 10.5, 15.5, 0, TAU, P.ink);
        disc(c, 0, 0, 6.5 + 2.6 * backOut(cl(hit / .25)) * ec, mix(P.core, P.err, ec));
        const ex = cl((hit - .06) / .1); if (ex > 0) { c.globalAlpha = o.alpha * fade * ex; c.fillStyle = P.bg; rr(c, -1.1, -5, 2.2, 6, 1.1); c.fill(); disc(c, 0, 3.6, 1.25, P.bg); }
      },
      leer(c, w, h, t, P, S, o) {
        const s = Math.min(w, h) / 48 * (o.fill || .5), br = 1 + .035 * Math.sin(t * TAU / 3.2); c.translate(w / 2, h / 2);
        c.save(); c.translate(0, 30 * s); c.scale(1, .16); disc(c, 0, 0, 20 * s * br, mix(P.bg, P.ink, .07)); c.restore();
        c.scale(s, s); band(c, 19.5, 24, L2A, L2B, P.track);
        disc(c, 0, 0, 6.5 * (.97 + .03 * br), mix(P.core, P.bg, .3));
        const hA = -Math.PI / 2 + .06 * Math.sin(t * .9), pts = []; for (let i = 0; i < 40; i++) { const a = hA - i / 39 * 5.2; pts.push([13 * br * Math.cos(a), 13 * br * Math.sin(a)]); }
        snake(c, pts, 5 * br, 1.3, P.ink, P.track, 2.2);
        const hx = pts[0][0], hy = pts[0][1]; disc(c, hx, hy, 3.1 * br, P.ink);
        c.lineWidth = .7; c.lineCap = 'round'; c.strokeStyle = P.bg; c.beginPath(); c.arc(hx + .6, hy - .9, 1, .15 * Math.PI, .85 * Math.PI); c.stroke();
        c.fillStyle = P.mute; c.textBaseline = 'middle';
        for (let k = 0; k < 3; k++) { const q = fr(t / 3.6 + k / 3); c.globalAlpha = o.alpha * Math.sin(Math.PI * q); c.font = '600 ' + (3 + 4 * q).toFixed(2) + 'px Geist, sans-serif'; c.fillText('z', hx + 4 + q * 9 + Math.sin(q * 6 + k) * 1.2, hy - 4 - q * 13); }
      },
      prog(c, w, h, t, P, S, o) {
        const u = fr(t / 16); let p = cl(u / .86); p = cl(p + .018 * Math.sin(p * 29) * p * (1 - p) * 4);
        o.text('progCount', Math.round(p * 48213).toLocaleString('de-DE') + ' von 48.213 Artikeln'); o.text('progPct', Math.round(p * 100) + ' %');
        const y = h / 2, x0 = 7, x1 = w - 7, xe = lerp(x0, x1, p), lw = Math.min(7, h * .32);
        c.lineCap = 'round'; c.lineWidth = lw; c.strokeStyle = P.track; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
        const pts = []; for (let x = xe, i = 0; x > x0 - 3; x -= 3, i++) { const env = cl(i / 3) * (1 - cl((i - 10) / 18)); pts.push([Math.max(x0, x), y + lw * .3 * env * Math.sin(t * 10 - i * .55)]); }
        if (pts.length > 1) snake(c, pts, lw, lw, P.core, null);
        const hr = lw * .82; disc(c, xe, y, hr, P.deep); eye(c, xe, y, 1, 0, hr, P, t, .1);
      }
    };
    return { A, PAL };
  
}
const { A, PAL } = buildK();
const ST = { light: ['#2f7d3a', '#c0392b'], white: ['#2f7d3a', '#c0392b'], dark: ['#7fd08a', '#ef8a7e'], inkbg: ['#7fd08a', '#ef8a7e'], petrol: ['#cfe9e5', '#ffd4cc'] };
for (const k in ST) Object.assign(PAL[k], { ok: ST[k][0], err: ST[k][1] });

export const ANIMATIONS = Object.freeze(Object.keys(A));
export const PALETTES = Object.freeze(Object.keys(PAL));
export const DEFAULTS = Object.freeze({ tempo: 1.4, length: 0.5 });

const players = new Set();
let raf = 0, last = 0;
const loop = now => {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  players.forEach(p => p._frame(dt));
  raf = players.size ? requestAnimationFrame(loop) : 0;
};
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export class CoreWaitPlayer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas; this.state = {}; this.t = 1.3; this.rt = 0;
    this.set(opts);
    players.add(this);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }
  set(opts) {
    this.opts = { anim: 'ring', palette: 'light', fill: 0, tempo: DEFAULTS.tempo, length: DEFAULTS.length, reducedMotion: null, onText: null, step: null, label: null, messages: null, ...this.opts, ...opts };
    if (!A[this.opts.anim]) throw new Error('core-wait: unbekannte Animation "' + this.opts.anim + '". Erlaubt: ' + ANIMATIONS.join(', '));
    return this;
  }
  restart() { this.state = {}; return this; }
  destroy() { players.delete(this); }
  _frame(dt) {
    const cv = this.canvas; if (!cv.isConnected) return;
    const o = this.opts, red = o.reducedMotion ?? (mq ? mq.matches : false);
    const r = cv.getBoundingClientRect(); if (r.width < 2 || r.bottom < -40 || r.top > innerHeight + 40) return;
    const sdt = red ? 0 : dt * o.tempo; this.t += sdt; this.rt += dt;
    const alpha = red ? .6 + .4 * (.5 + .5 * Math.sin(this.rt * 2.4)) : 1;
    const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight, W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); c.globalAlpha = alpha;
    c.save();
    try { A[o.anim](c, w, h, this.t, PAL[o.palette] || PAL.light, this.state, { len: o.length, dt: sdt, alpha, fill: o.fill, step: o.step, label: o.label, msgs: o.messages, text: (k, v) => o.onText && o.onText(k, v) }); }
    catch (e) { if (!this._err) { this._err = 1; console.error(e); } }
    c.restore();
  }
}

export const mount = (canvas, opts) => new CoreWaitPlayer(canvas, opts);

// <core-wait anim="ring" palette="light" fill=".98" tempo="1.4" length=".5"></core-wait>
// anim="ablauf": step="start|sammeln|bearbeitung|fertig" (ohne step: automatisch), label="…", messages="Starte CORE|Prüfe Fakten|…"; Schrittwechsel als Event key "step".
// Text-Ausgaben (snakeScore, progPct, progCount) kommen als Event "core-wait-text" {key, value}.
if (typeof customElements !== 'undefined' && !customElements.get('core-wait')) {
  customElements.define('core-wait', class extends HTMLElement {
    static get observedAttributes() { return ['anim', 'palette', 'fill', 'tempo', 'length', 'reduced-motion', 'step', 'label', 'messages']; }
    connectedCallback() {
      if (!this.style.display) this.style.display = 'block';
      if (!this._cv) { this._cv = document.createElement('canvas'); this._cv.style.cssText = 'width:100%;height:100%;display:block'; this.appendChild(this._cv); }
      this._p = new CoreWaitPlayer(this._cv, this._read());
    }
    disconnectedCallback() { this._p && this._p.destroy(); this._p = null; }
    attributeChangedCallback() { this._p && this._p.set(this._read()); }
    restart() { this._p && this._p.restart(); }
    _read() {
      const g = (n, d) => this.hasAttribute(n) ? this.getAttribute(n) : d, rm = g('reduced-motion', null);
      return { anim: g('anim', 'ring'), palette: g('palette', 'light'), fill: +g('fill', 0) || 0, tempo: +g('tempo', DEFAULTS.tempo) || DEFAULTS.tempo, length: +g('length', DEFAULTS.length) || DEFAULTS.length,
        reducedMotion: rm === null ? null : rm !== 'false', step: g('step', null), label: g('label', null), messages: g('messages', null) ? g('messages', '').split('|').map(x => x.trim()).filter(Boolean) : null, onText: (key, value) => this.dispatchEvent(new CustomEvent('core-wait-text', { detail: { key, value }, bubbles: true })) };
    }
  });
}
