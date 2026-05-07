// ============================================================================
// catdex.js — Cat collection screen for "Make the Cat Dizzy!"
// ----------------------------------------------------------------------------
// Self-contained module. Subscribes to window.MTCD hooks, persists a per-type
// capture counter to localStorage, renders an in-canvas Catdex panel, and
// pauses gameplay while open.
// ============================================================================
(function () {
    'use strict';

    // Defensive guard. game.js attaches MTCD synchronously when its <script>
    // executes, so by the time this loads (after src/music.js per index.html)
    // it should be present, but bail safely otherwise.
    if (!window.MTCD || !window.MTCD.HOOKS) {
        console.warn('[catdex] window.MTCD not available; module disabled.');
        return;
    }

    const MTCD = window.MTCD;
    const HOOKS = MTCD.HOOKS;
    const STORAGE_KEY = 'mtcd_catdex';

    // ---------- Cat type catalog ----------
    // Mirrors game.js CAT_TYPES so we can list everything (even un-caught)
    // without poking the game module's internals.
    const CAT_TYPES = [
        { id: 'ginger',      name: 'Tabby',       loops: 2, body: '#f6a83d', dark: '#d8852a', isBoss: false },
        { id: 'black',       name: 'Shadow Cat',  loops: 3, body: '#2a223a', dark: '#15101f', isBoss: false, eyeColor: '#ffd84d' },
        { id: 'white',       name: 'Snowpaw',     loops: 2, body: '#f5efff', dark: '#cdc4dd', isBoss: false, eyeColor: '#7cd6ff' },
        { id: 'calico',      name: 'Patches',     loops: 2, body: '#f6a83d', dark: '#1a1418', isBoss: false, patches: true },
        { id: 'kitten',      name: 'Kitten',      loops: 1, body: '#a07b50', dark: '#7b5c34', isBoss: false, kitten: true },
        { id: 'persian',     name: 'Persian',     loops: 4, body: '#e6d8ba', dark: '#b8a883', isBoss: false, fluffy: true,  eyeColor: '#ff8aa9' },
        { id: 'sphynx',      name: 'Sphynx',      loops: 3, body: '#e8b89a', dark: '#b88770', isBoss: false, wrinkled: true },
        { id: 'bengal',      name: 'Bengal',      loops: 3, body: '#e8a437', dark: '#3d2a18', isBoss: false, eyeColor: '#4dffb6' },
        { id: 'tuxedo',      name: 'Tuxedo',      loops: 2, body: '#1a1418', dark: '#0a0508', isBoss: false },
        { id: 'siamese',     name: 'Siamese',     loops: 4, body: '#e8d4ba', dark: '#5a4030', isBoss: false, eyeColor: '#7cd6ff' },
        { id: 'russianblue', name: 'Russian Blue',loops: 3, body: '#6e7e8a', dark: '#4a5260', isBoss: false, eyeColor: '#4dffb6' },
        { id: 'ragdoll',     name: 'Ragdoll',     loops: 3, body: '#f5e0c0', dark: '#6a4830', isBoss: false, fluffy: true, eyeColor: '#7cd6ff' },
        { id: 'maine',       name: 'Maine Boss',  loops: 6, body: '#3d2a18', dark: '#22150a', isBoss: true,  fluffy: true },
    ];
    // Lookup by id (used to merge new/unknown types we see at capture time).
    const knownIds = new Set(CAT_TYPES.map((t) => t.id));

    // ---------- Persistence ----------
    function loadCounts() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            const obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
            // Coerce values to non-negative integers; drop garbage.
            const out = {};
            for (const k of Object.keys(obj)) {
                const v = obj[k] | 0;
                if (v > 0 && typeof k === 'string') out[k] = v;
            }
            return out;
        } catch (e) {
            return {};
        }
    }
    function saveCounts() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
        } catch (e) { /* ignore quota errors */ }
    }
    const counts = loadCounts();

    // ---------- UI state ----------
    const ui = {
        open: false,
        // Anim 0..1 (slide / fade in)
        openT: 0,
        // Last computed hit rects (canvas-local). Recomputed every draw.
        toggleRect: { x: 0, y: 0, w: 0, h: 0 },
        closeRect: { x: 0, y: 0, w: 0, h: 0 },
        // Hover state for the toggle button (for a tiny pulse).
        toggleHover: false,
        // Wall-clock-ish phase used for portrait whisker shimmer / hover pulses.
        phase: 0,
        // Whether we've previously asked the game to pause (so we don't stomp
        // a user-initiated pause when we close).
        pausedByUs: false,
    };

    // ---------- Helpers ----------
    function size() {
        const s = MTCD.canvasSize();
        return {
            W: s.W || window.innerWidth || 800,
            H: s.H || window.innerHeight || 600,
        };
    }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

    function roundedPath(c, x, y, w, h, r) {
        const rr = Math.min(r, Math.min(w, h) * 0.5);
        c.beginPath();
        c.moveTo(x + rr, y);
        c.lineTo(x + w - rr, y);
        c.arcTo(x + w, y, x + w, y + rr, rr);
        c.lineTo(x + w, y + h - rr);
        c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        c.lineTo(x + rr, y + h);
        c.arcTo(x, y + h, x, y + h - rr, rr);
        c.lineTo(x, y + rr);
        c.arcTo(x, y, x + rr, y, rr);
        c.closePath();
    }

    function pointInRect(x, y, r) {
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    // ---------- Open / close ----------
    function open() {
        if (ui.open) return;
        ui.open = true;
        ui.openT = 0;
        // Pause gameplay (only if not already paused) and remember whose call
        // it was so we don't accidentally unpause on close.
        if (MTCD.G && !MTCD.G.paused) {
            MTCD.G.paused = true;
            ui.pausedByUs = true;
        } else {
            ui.pausedByUs = false;
        }
        try {
            const A = MTCD.audio && MTCD.audio();
            if (A && A.SFX && A.SFX.click) A.SFX.click();
        } catch (e) { /* ignore */ }
    }
    function close() {
        if (!ui.open) return;
        ui.open = false;
        if (ui.pausedByUs && MTCD.G) {
            MTCD.G.paused = false;
        }
        ui.pausedByUs = false;
        try {
            const A = MTCD.audio && MTCD.audio();
            if (A && A.SFX && A.SFX.click) A.SFX.click();
        } catch (e) { /* ignore */ }
    }

    // ---------- Hooks: capture counter ----------
    HOOKS.onCapture.push((cat /*, bonus */) => {
        if (!cat || !cat.type || !cat.type.id) return;
        const id = cat.type.id;
        counts[id] = (counts[id] | 0) + 1;
        saveCounts();
        // If this is a brand-new type the catalog hasn't heard of, append it
        // so it shows up in the grid. We'll have to rely on cat.type for color
        // info since we have nothing else to go on.
        if (!knownIds.has(id)) {
            knownIds.add(id);
            CAT_TYPES.push({
                id,
                name: cat.type.name || id,
                loops: cat.type.loops | 0 || 1,
                body: cat.type.body || '#888',
                dark: cat.type.dark || '#444',
                isBoss: !!cat.type.isBoss,
            });
        }
    });

    // ---------- Hooks: per-frame anim ----------
    HOOKS.onUpdate.push((dt) => {
        ui.phase += dt;
        const target = ui.open ? 1 : 0;
        // Critically-damped-ish ease towards target.
        ui.openT = lerp(ui.openT, target, Math.min(1, dt * 9));
        if (!ui.open && ui.openT < 0.001) ui.openT = 0;
        if (ui.open && ui.openT > 0.999) ui.openT = 1;
    });

    // ---------- Drawing: cat portrait (~64x64) ----------
    // cx, cy is the center of the portrait area; r is roughly the head radius.
    function drawPortrait(c, cx, cy, r, type, opts) {
        const silhouette = !!(opts && opts.silhouette);
        const t = (opts && opts.t) || 0;

        c.save();

        // Drop a tiny ground shadow for depth.
        c.fillStyle = 'rgba(0,0,0,0.30)';
        c.beginPath();
        c.ellipse(cx, cy + r * 0.95, r * 0.85, r * 0.18, 0, 0, Math.PI * 2);
        c.fill();

        const body = silhouette ? '#1a1326' : type.body;
        const dark = silhouette ? '#0c0816' : type.dark;
        const earInner = silhouette ? '#0c0816' : '#ff8aa9';

        // Ears — triangles, drawn first so head sits in front.
        c.fillStyle = body;
        c.beginPath();
        c.moveTo(cx - r * 0.75, cy - r * 0.25);
        c.lineTo(cx - r * 0.55, cy - r * 1.05);
        c.lineTo(cx - r * 0.20, cy - r * 0.55);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(cx + r * 0.75, cy - r * 0.25);
        c.lineTo(cx + r * 0.55, cy - r * 1.05);
        c.lineTo(cx + r * 0.20, cy - r * 0.55);
        c.closePath();
        c.fill();

        // Inner ear pink triangles.
        c.fillStyle = earInner;
        c.beginPath();
        c.moveTo(cx - r * 0.60, cy - r * 0.40);
        c.lineTo(cx - r * 0.55, cy - r * 0.85);
        c.lineTo(cx - r * 0.32, cy - r * 0.55);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(cx + r * 0.60, cy - r * 0.40);
        c.lineTo(cx + r * 0.55, cy - r * 0.85);
        c.lineTo(cx + r * 0.32, cy - r * 0.55);
        c.closePath();
        c.fill();

        // Head ellipse (slightly wider than tall).
        c.fillStyle = body;
        c.beginPath();
        c.ellipse(cx, cy, r * 1.05, r * 0.95, 0, 0, Math.PI * 2);
        c.fill();

        // Calico patches — a couple of dark splotches over the body.
        if (!silhouette && type.patches) {
            c.fillStyle = dark;
            c.beginPath();
            c.ellipse(cx - r * 0.55, cy - r * 0.10, r * 0.30, r * 0.25, -0.4, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.ellipse(cx + r * 0.40, cy + r * 0.20, r * 0.28, r * 0.22, 0.3, 0, Math.PI * 2);
            c.fill();
        }

        // Persian / Maine fluff: outer poof outline.
        if (!silhouette && type.fluffy) {
            c.strokeStyle = body;
            c.lineWidth = r * 0.18;
            c.beginPath();
            c.ellipse(cx, cy + r * 0.05, r * 1.18, r * 1.05, 0, 0, Math.PI * 2);
            c.stroke();
        }

        // Sphynx wrinkles: a couple of thin brow lines.
        if (!silhouette && type.wrinkled) {
            c.strokeStyle = dark;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(cx - r * 0.45, cy - r * 0.30);
            c.quadraticCurveTo(cx, cy - r * 0.42, cx + r * 0.45, cy - r * 0.30);
            c.moveTo(cx - r * 0.40, cy - r * 0.18);
            c.quadraticCurveTo(cx, cy - r * 0.30, cx + r * 0.40, cy - r * 0.18);
            c.stroke();
        }

        // Eyes — two dots. Silhouettes get nothing; bosses get a glint.
        if (!silhouette) {
            const eyeColor = type.eyeColor || '#1a0f1f';
            c.fillStyle = eyeColor;
            c.beginPath();
            c.arc(cx - r * 0.30, cy - r * 0.05, r * 0.10, 0, Math.PI * 2);
            c.arc(cx + r * 0.30, cy - r * 0.05, r * 0.10, 0, Math.PI * 2);
            c.fill();
            // Highlights for eyes that aren't black.
            if (eyeColor !== '#1a0f1f') {
                c.fillStyle = '#ffffff';
                c.beginPath();
                c.arc(cx - r * 0.27, cy - r * 0.10, r * 0.035, 0, Math.PI * 2);
                c.arc(cx + r * 0.33, cy - r * 0.10, r * 0.035, 0, Math.PI * 2);
                c.fill();
            }

            // Tiny pink nose (triangle pointing down).
            c.fillStyle = '#ff8aa9';
            c.beginPath();
            c.moveTo(cx - r * 0.07, cy + r * 0.18);
            c.lineTo(cx + r * 0.07, cy + r * 0.18);
            c.lineTo(cx, cy + r * 0.30);
            c.closePath();
            c.fill();

            // Mouth — small "w" curve under the nose.
            c.strokeStyle = dark;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(cx, cy + r * 0.30);
            c.quadraticCurveTo(cx - r * 0.10, cy + r * 0.42, cx - r * 0.20, cy + r * 0.36);
            c.moveTo(cx, cy + r * 0.30);
            c.quadraticCurveTo(cx + r * 0.10, cy + r * 0.42, cx + r * 0.20, cy + r * 0.36);
            c.stroke();

            // Whiskers — three thin lines per side, with a little wave.
            c.strokeStyle = 'rgba(255,255,255,0.65)';
            c.lineWidth = 1;
            const wob = Math.sin(t * 1.6) * r * 0.04;
            for (let i = -1; i <= 1; i++) {
                const oy = i * r * 0.10;
                c.beginPath();
                c.moveTo(cx - r * 0.20, cy + r * 0.20 + oy);
                c.lineTo(cx - r * 0.85, cy + r * 0.18 + oy + wob);
                c.stroke();
                c.beginPath();
                c.moveTo(cx + r * 0.20, cy + r * 0.20 + oy);
                c.lineTo(cx + r * 0.85, cy + r * 0.18 + oy + wob);
                c.stroke();
            }
        } else {
            // Silhouette gets a "???" sigil in the middle of the face.
            c.fillStyle = 'rgba(255,255,255,0.55)';
            c.font = `700 ${Math.round(r * 0.85)}px system-ui, -apple-system, sans-serif`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('?', cx, cy + r * 0.05);
        }

        // BOSS tag for boss types (drawn whether captured or silhouette so
        // players know what they're aiming for).
        if (type.isBoss) {
            const tagW = r * 1.1;
            const tagH = r * 0.34;
            const tx = cx - tagW * 0.5;
            const ty = cy + r * 0.95;
            c.fillStyle = '#ff3b6e';
            roundedPath(c, tx, ty, tagW, tagH, tagH * 0.4);
            c.fill();
            c.fillStyle = '#ffffff';
            c.font = `800 ${Math.round(tagH * 0.65)}px system-ui, -apple-system, sans-serif`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('BOSS', cx, ty + tagH * 0.55);
        }

        c.restore();
    }

    // ---------- Drawing: toggle button (HUD) ----------
    function drawToggleButton(c) {
        const { W, H } = size();
        const w = 92, h = 40;
        const margin = 14;
        const x = W - w - margin;
        // Sit above the bottom edge; keep clear of any soft-bar areas.
        const y = H - h - margin;
        ui.toggleRect = { x, y, w, h };

        c.save();
        // Soft shadow.
        c.shadowColor = 'rgba(0,0,0,0.4)';
        c.shadowBlur = 10;
        c.shadowOffsetY = 2;

        // Background pill.
        const grd = c.createLinearGradient(x, y, x, y + h);
        grd.addColorStop(0, 'rgba(54, 36, 82, 0.92)');
        grd.addColorStop(1, 'rgba(28, 18, 46, 0.92)');
        c.fillStyle = grd;
        roundedPath(c, x, y, w, h, 12);
        c.fill();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;

        // Border with a soft pulse so people notice the button.
        const pulse = 0.5 + 0.5 * Math.sin(ui.phase * 2.2);
        c.strokeStyle = `rgba(255, 216, 77, ${0.35 + 0.25 * pulse})`;
        c.lineWidth = 1;
        roundedPath(c, x + 0.5, y + 0.5, w - 1, h - 1, 12);
        c.stroke();

        // Paw icon — central dot + 4 toes.
        const px = x + 18;
        const py = y + h * 0.5;
        c.fillStyle = '#ffd84d';
        c.beginPath();
        c.ellipse(px, py + 3, 7, 5.5, 0, 0, Math.PI * 2);
        c.fill();
        for (let i = 0; i < 4; i++) {
            const ang = -Math.PI / 2 + (i - 1.5) * 0.55;
            const tx = px + Math.cos(ang) * 9;
            const ty = py + Math.sin(ang) * 9 - 1;
            c.beginPath();
            c.arc(tx, ty, 2.4, 0, Math.PI * 2);
            c.fill();
        }

        // Label.
        c.fillStyle = '#fff';
        c.font = '700 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText('Catdex', x + 34, y + h * 0.5 + 1);

        c.restore();
    }

    // ---------- Drawing: full Catdex panel ----------
    function drawPanel(c) {
        if (ui.openT <= 0) return;
        const { W, H } = size();
        const phase = smoothstep(ui.openT);

        // 1) Translucent dark backdrop covering the whole canvas.
        c.save();
        c.fillStyle = `rgba(8, 4, 18, ${0.62 * phase})`;
        c.fillRect(0, 0, W, H);
        c.restore();

        // 2) Panel rect — 88% of canvas, centered.
        const pw = Math.min(W * 0.88, 980);
        const ph = Math.min(H * 0.88, 760);
        const px = (W - pw) * 0.5;
        // Slide in from below ~24px while fading.
        const slide = (1 - phase) * 24;
        const py = (H - ph) * 0.5 + slide;

        c.save();
        c.globalAlpha = phase;

        // Soft shadow under the panel.
        c.shadowColor = 'rgba(0,0,0,0.55)';
        c.shadowBlur = 28;
        c.shadowOffsetY = 8;

        // Background gradient.
        const grd = c.createLinearGradient(px, py, px, py + ph);
        grd.addColorStop(0, 'rgba(38, 26, 60, 0.96)');
        grd.addColorStop(1, 'rgba(18, 10, 30, 0.96)');
        c.fillStyle = grd;
        roundedPath(c, px, py, pw, ph, 18);
        c.fill();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;

        // 1px white border at low opacity.
        c.strokeStyle = 'rgba(255,255,255,0.10)';
        c.lineWidth = 1;
        roundedPath(c, px + 0.5, py + 0.5, pw - 1, ph - 1, 18);
        c.stroke();

        // 3) Title.
        c.fillStyle = '#ffffff';
        c.font = '800 30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.fillText('Catdex', px + 26, py + 20);

        // Subtitle: X / Y caught (using number of distinct types caught).
        const totalTypes = CAT_TYPES.length;
        let caughtTypes = 0;
        let totalCaught = 0;
        for (const t of CAT_TYPES) {
            const n = counts[t.id] | 0;
            if (n > 0) caughtTypes++;
            totalCaught += n;
        }
        c.fillStyle = 'rgba(220, 215, 235, 0.75)';
        c.font = '500 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.fillText(`${caughtTypes} / ${totalTypes} species discovered  ·  ${totalCaught} total captures`, px + 26, py + 56);

        // 4) Close button (top-right of panel) — 44px tap target.
        const closeSize = 44;
        const cbx = px + pw - closeSize - 16;
        const cby = py + 16;
        ui.closeRect = { x: cbx, y: cby, w: closeSize, h: closeSize };
        c.fillStyle = 'rgba(255, 60, 100, 0.18)';
        roundedPath(c, cbx, cby, closeSize, closeSize, 12);
        c.fill();
        c.strokeStyle = 'rgba(255, 100, 130, 0.55)';
        c.lineWidth = 1;
        roundedPath(c, cbx + 0.5, cby + 0.5, closeSize - 1, closeSize - 1, 12);
        c.stroke();
        c.fillStyle = '#ffffff';
        c.font = '700 28px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('×', cbx + closeSize * 0.5, cby + closeSize * 0.5 + 1);

        // 5) Card grid.
        // Layout: 2 cols on narrow (panel < ~620 wide), else 4 cols.
        const cols = pw < 620 ? 2 : 4;
        const gridX = px + 22;
        const gridYTop = py + 92;
        const gridW = pw - 44;
        const gap = 14;
        const cardW = (gridW - gap * (cols - 1)) / cols;
        const cardH = 140;

        // Clip the grid area so cards don't escape the panel.
        c.save();
        roundedPath(c, gridX - 4, gridYTop - 4, gridW + 8, ph - (gridYTop - py) - 22, 12);
        c.clip();

        for (let i = 0; i < CAT_TYPES.length; i++) {
            const t = CAT_TYPES[i];
            const col = i % cols;
            const row = (i / cols) | 0;
            const cx = gridX + col * (cardW + gap);
            const cy = gridYTop + row * (cardH + gap);
            drawCard(c, cx, cy, cardW, cardH, t);
        }
        c.restore();

        c.restore();
    }

    function drawCard(c, x, y, w, h, type) {
        const n = counts[type.id] | 0;
        const caught = n > 0;

        c.save();

        // Card background — slightly different tint for caught vs silhouette.
        const grd = c.createLinearGradient(x, y, x, y + h);
        if (caught) {
            grd.addColorStop(0, 'rgba(60, 44, 96, 0.85)');
            grd.addColorStop(1, 'rgba(30, 22, 54, 0.85)');
        } else {
            grd.addColorStop(0, 'rgba(28, 22, 46, 0.85)');
            grd.addColorStop(1, 'rgba(16, 12, 30, 0.85)');
        }
        c.fillStyle = grd;
        roundedPath(c, x, y, w, h, 12);
        c.fill();

        // Subtle border. Caught cats get a coloured accent.
        c.lineWidth = 1;
        c.strokeStyle = caught
            ? 'rgba(255, 216, 77, 0.30)'
            : 'rgba(255, 255, 255, 0.06)';
        roundedPath(c, x + 0.5, y + 0.5, w - 1, h - 1, 12);
        c.stroke();

        // Boss cards: a thin red top stripe.
        if (type.isBoss) {
            c.fillStyle = caught ? 'rgba(255, 60, 110, 0.85)' : 'rgba(255, 60, 110, 0.4)';
            roundedPath(c, x, y, w, 4, 2);
            c.fill();
        }

        // Portrait on the left.
        const portR = 30;
        const portCx = x + portR + 20;
        const portCy = y + h * 0.5;
        drawPortrait(c, portCx, portCy, portR, type, {
            silhouette: !caught,
            t: ui.phase + (type.id.charCodeAt(0) || 0), // de-sync whisker waves
        });

        // Info column on the right.
        const infoX = portCx + portR + 18;
        const infoW = (x + w) - infoX - 14;

        // Name / "???" header.
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.font = '700 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.fillStyle = caught ? '#ffffff' : 'rgba(220, 215, 235, 0.55)';
        const titleStr = caught ? type.name : '???';
        c.fillText(truncate(c, titleStr, infoW), infoX, y + 18);

        // Caught: "Caught: N"
        c.font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.fillStyle = caught ? '#ffd84d' : 'rgba(220, 215, 235, 0.4)';
        c.fillText(caught ? `Caught: ${n}` : 'Not yet seen', infoX, y + 44);

        // Difficulty row — loops needed to capture, drawn as little dots.
        c.font = '500 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.fillStyle = 'rgba(220, 215, 235, 0.7)';
        c.fillText(`Loops: ${type.loops}`, infoX, y + 66);

        // Loop pip dots.
        const dotY = y + 90;
        const maxDots = Math.min(type.loops, 8);
        for (let i = 0; i < maxDots; i++) {
            const dx = infoX + i * 12;
            c.fillStyle = caught
                ? (i < type.loops ? '#ffd84d' : 'rgba(255,255,255,0.15)')
                : 'rgba(255,255,255,0.20)';
            c.beginPath();
            c.arc(dx + 4, dotY + 4, 3, 0, Math.PI * 2);
            c.fill();
        }
        if (type.loops > 8) {
            c.fillStyle = 'rgba(220,215,235,0.7)';
            c.fillText(`+${type.loops - 8}`, infoX + 8 * 12 + 4, dotY - 1);
        }

        // Boss tag (text) at bottom-right of card.
        if (type.isBoss) {
            c.textAlign = 'right';
            c.font = '800 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
            c.fillStyle = '#ff3b6e';
            c.fillText('BOSS', x + w - 12, y + h - 18);
        }

        c.restore();
    }

    function truncate(c, str, maxW) {
        if (!str) return '';
        if (c.measureText(str).width <= maxW) return str;
        const ell = '…';
        let lo = 0, hi = str.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (c.measureText(str.slice(0, mid) + ell).width <= maxW) lo = mid;
            else hi = mid - 1;
        }
        return str.slice(0, lo) + ell;
    }

    // ---------- Hook: HUD draw ----------
    HOOKS.onDrawHUD.push((c) => {
        // Always draw the toggle button (even at the menu) so players can
        // browse their collection any time. Hide it during level-complete
        // celebrations to avoid stealing focus.
        if (MTCD.G && MTCD.G.stage !== 'levelComplete') {
            drawToggleButton(c);
        }
        // Panel renders on top, only when (partially) open.
        if (ui.openT > 0) drawPanel(c);
    });

    // ---------- Input: clicks ----------
    // We listen on document so we can intercept clicks on the close button
    // before the canvas itself gets them. We translate to canvas-local coords
    // via getBoundingClientRect on the #game canvas.
    function getCanvas() {
        return document.getElementById('game');
    }
    function eventToCanvas(e) {
        const canvas = getCanvas();
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        let cx, cy;
        if (e.touches && e.touches.length) {
            cx = e.touches[0].clientX;
            cy = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length) {
            cx = e.changedTouches[0].clientX;
            cy = e.changedTouches[0].clientY;
        } else {
            cx = e.clientX;
            cy = e.clientY;
        }
        if (cx === undefined) return null;
        return { x: cx - r.left, y: cy - r.top };
    }

    function handlePress(e) {
        const p = eventToCanvas(e);
        if (!p) return;

        if (ui.open) {
            // Close button has top priority while the panel is up.
            if (pointInRect(p.x, p.y, ui.closeRect)) {
                close();
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation();
                }
                return;
            }
            // Any other click while open: swallow it so the game's laser
            // doesn't start drawing behind the backdrop. (Clicks outside the
            // panel are simply absorbed; we don't close — players use the ×.)
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
            return;
        }

        // Panel closed: only the toggle button is interactive.
        if (pointInRect(p.x, p.y, ui.toggleRect)) {
            open();
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
        }
    }

    // Register on document so we run *before* canvas-bound listeners (capture
    // phase) and can stop propagation if needed.
    document.addEventListener('mousedown', handlePress, true);
    document.addEventListener('touchstart', handlePress, { capture: true, passive: false });

    // Esc closes the Catdex (without stomping the game's pause toggle, since
    // game.js only handles Esc when stage === 'playing'; we run before it via
    // capture and bail out cleanly otherwise).
    document.addEventListener('keydown', (e) => {
        if (!ui.open) return;
        if (e.key === 'Escape') {
            close();
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
        }
    }, true);

    // ---------- Public surface (debug) ----------
    MTCD.catdex = {
        open,
        close,
        isOpen: () => ui.open,
        counts: () => Object.assign({}, counts),
        types: () => CAT_TYPES.map((t) => ({
            id: t.id, name: t.name, loops: t.loops, isBoss: !!t.isBoss,
        })),
        reset: () => {
            for (const k of Object.keys(counts)) delete counts[k];
            saveCounts();
        },
    };
})();
