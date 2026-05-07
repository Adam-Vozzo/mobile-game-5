// ============================================================================
// achievement-viewer.js — Achievements viewer screen for "Make the Cat Dizzy!"
// ----------------------------------------------------------------------------
// Self-contained module. Adds a small trophy button at top-center of the HUD
// that opens a centered panel listing all 11 achievements, mirroring the IDs
// that achievements.js persists in localStorage under "mtcd_achievements".
// ============================================================================
(function () {
    'use strict';

    if (!window.MTCD || !window.MTCD.HOOKS) {
        console.warn('[achievement-viewer] window.MTCD not available; module disabled.');
        return;
    }

    const MTCD = window.MTCD;
    const HOOKS = MTCD.HOOKS;
    const STORAGE_KEY = 'mtcd_achievements';

    // Mirror of achievements.js definitions (achievements.js doesn't expose
    // descriptions/icons, so we duplicate the catalog here intentionally).
    const ACHIEVEMENTS = [
        { id: 'first_catch',         name: 'First Catch',         desc: 'Capture your first cat.',                  icon: '🐾', color: '#ffd84d' },
        { id: 'combo_5',             name: 'On a Roll',            desc: 'Reach a 5x combo.',                        icon: '🔥', color: '#ff6e3b' },
        { id: 'combo_10',            name: 'Unstoppable',          desc: 'Reach a 10x combo.',                       icon: '⚡', color: '#7cd6ff' },
        { id: 'score_10000',         name: 'High Roller',          desc: 'Score 10,000 in a single run.',            icon: '💎', color: '#9b6cff' },
        { id: 'score_50000',         name: 'Laser Virtuoso',       desc: 'Score 50,000 in a single run.',            icon: '🌟', color: '#ffec5e' },
        { id: 'reach_level_5',       name: 'Cat Wrangler',         desc: 'Reach Level 5.',                           icon: '🎯', color: '#4dffb6' },
        { id: 'boss_slayer',         name: 'Boss Slayer',          desc: 'Capture a boss cat.',                      icon: '👑', color: '#ff3b6e' },
        { id: 'flawless_level',      name: 'Flawless',             desc: 'Clear a level without breaking your line.',icon: '✨', color: '#a4dc4d' },
        { id: 'catnip_connoisseur',  name: 'Catnip Connoisseur',   desc: 'Influence 5 cats with catnip.',            icon: '🌿', color: '#a4dc4d' },
        { id: 'persistent_pointer',  name: 'Persistent Pointer',   desc: 'Capture 25 cats across all runs.',         icon: '🏆', color: '#ffb84d' },
        { id: 'big_loop',            name: 'Big Loop Energy',      desc: 'Make a single loop with area >= 60,000.',  icon: '🌀', color: '#7cd6ff' },
    ];

    // ---------- UI state ----------
    const ui = {
        open: false,
        openT: 0,
        phase: 0,
        toggleRect: { x: 0, y: 0, w: 0, h: 0 },
        closeRect: { x: 0, y: 0, w: 0, h: 0 },
        pausedByUs: false,
    };

    // ---------- Helpers ----------
    function size() {
        const s = MTCD.canvasSize();
        return { W: s.W || window.innerWidth || 800, H: s.H || window.innerHeight || 600 };
    }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
    function pointInRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

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

    function loadUnlocked() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return new Set();
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return new Set();
            return new Set(arr.filter((s) => typeof s === 'string'));
        } catch (e) { return new Set(); }
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

    function clickSfx() {
        try {
            const A = MTCD.audio && MTCD.audio();
            if (A && A.SFX && A.SFX.click) A.SFX.click();
        } catch (e) { /* ignore */ }
    }

    // ---------- Open / close ----------
    function open() {
        if (ui.open) return;
        ui.open = true;
        ui.openT = 0;
        if (MTCD.G && !MTCD.G.paused) {
            MTCD.G.paused = true;
            ui.pausedByUs = true;
        } else {
            ui.pausedByUs = false;
        }
        clickSfx();
    }
    function close() {
        if (!ui.open) return;
        ui.open = false;
        if (ui.pausedByUs && MTCD.G) MTCD.G.paused = false;
        ui.pausedByUs = false;
        clickSfx();
    }

    // ---------- Per-frame anim ----------
    HOOKS.onUpdate.push((dt) => {
        ui.phase += dt;
        const target = ui.open ? 1 : 0;
        ui.openT = lerp(ui.openT, target, Math.min(1, dt * 9));
        if (!ui.open && ui.openT < 0.001) ui.openT = 0;
        if (ui.open && ui.openT > 0.999) ui.openT = 1;
    });

    // ---------- Toggle button (top-center HUD) ----------
    function drawToggleButton(c) {
        const { W } = size();
        const r = 18; // 36x36 circle
        const cx = W * 0.5;
        const cy = 80;
        ui.toggleRect = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };

        c.save();
        c.shadowColor = 'rgba(0,0,0,0.45)';
        c.shadowBlur = 10;
        c.shadowOffsetY = 2;

        const grd = c.createRadialGradient(cx, cy - 4, 2, cx, cy, r + 2);
        grd.addColorStop(0, 'rgba(64, 44, 96, 0.95)');
        grd.addColorStop(1, 'rgba(28, 18, 46, 0.95)');
        c.fillStyle = grd;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;

        const pulse = 0.5 + 0.5 * Math.sin(ui.phase * 2.2);
        c.strokeStyle = `rgba(255, 216, 77, ${0.40 + 0.30 * pulse})`;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(cx, cy, r - 0.75, 0, Math.PI * 2);
        c.stroke();

        c.font = '600 20px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#ffffff';
        c.fillText('🏆', cx, cy + 1);

        c.restore();
    }

    // ---------- Panel ----------
    function drawPanel(c) {
        if (ui.openT <= 0) return;
        const { W, H } = size();
        const phase = smoothstep(ui.openT);
        const unlocked = loadUnlocked();

        // Backdrop
        c.save();
        c.fillStyle = `rgba(8, 4, 18, ${0.62 * phase})`;
        c.fillRect(0, 0, W, H);
        c.restore();

        // Panel sizing — ~620x520, capped at 88% of canvas.
        const pw = Math.min(620, W * 0.88);
        const ph = Math.min(520, H * 0.88);
        const px = (W - pw) * 0.5;
        const slide = (1 - phase) * 24;
        const py = (H - ph) * 0.5 + slide;

        c.save();
        c.globalAlpha = phase;

        c.shadowColor = 'rgba(0,0,0,0.55)';
        c.shadowBlur = 28;
        c.shadowOffsetY = 8;

        const grd = c.createLinearGradient(px, py, px, py + ph);
        grd.addColorStop(0, 'rgba(38, 26, 60, 0.96)');
        grd.addColorStop(1, 'rgba(18, 10, 30, 0.96)');
        c.fillStyle = grd;
        roundedPath(c, px, py, pw, ph, 18);
        c.fill();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;

        c.strokeStyle = 'rgba(255,255,255,0.10)';
        c.lineWidth = 1;
        roundedPath(c, px + 0.5, py + 0.5, pw - 1, ph - 1, 18);
        c.stroke();

        // Title
        c.fillStyle = '#ffffff';
        c.font = '800 28px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.fillText('Achievements', px + 24, py + 20);

        // Subtitle
        const totalAch = ACHIEVEMENTS.length;
        let unlockedCount = 0;
        for (const a of ACHIEVEMENTS) if (unlocked.has(a.id)) unlockedCount++;
        c.fillStyle = 'rgba(220, 215, 235, 0.75)';
        c.font = '500 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.fillText(`${unlockedCount} / ${totalAch} unlocked`, px + 24, py + 54);

        // Close button
        const closeSize = 40;
        const cbx = px + pw - closeSize - 14;
        const cby = py + 14;
        ui.closeRect = { x: cbx, y: cby, w: closeSize, h: closeSize };
        c.fillStyle = 'rgba(255, 60, 100, 0.18)';
        roundedPath(c, cbx, cby, closeSize, closeSize, 12);
        c.fill();
        c.strokeStyle = 'rgba(255, 100, 130, 0.55)';
        c.lineWidth = 1;
        roundedPath(c, cbx + 0.5, cby + 0.5, closeSize - 1, closeSize - 1, 12);
        c.stroke();
        c.fillStyle = '#ffffff';
        c.font = '700 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('×', cbx + closeSize * 0.5, cby + closeSize * 0.5 + 1);

        // Card grid: 2 cols on wide panels, 1 col on narrow.
        const cols = pw < 520 ? 1 : 2;
        const gridX = px + 22;
        const gridYTop = py + 92;
        const gridW = pw - 44;
        const gap = 12;
        const cardW = (gridW - gap * (cols - 1)) / cols;
        const cardH = 70;

        c.save();
        roundedPath(c, gridX - 4, gridYTop - 4, gridW + 8, ph - (gridYTop - py) - 18, 12);
        c.clip();

        for (let i = 0; i < ACHIEVEMENTS.length; i++) {
            const a = ACHIEVEMENTS[i];
            const col = i % cols;
            const row = (i / cols) | 0;
            const cx = gridX + col * (cardW + gap);
            const cy = gridYTop + row * (cardH + gap);
            drawCard(c, cx, cy, cardW, cardH, a, unlocked.has(a.id));
        }
        c.restore();
        c.restore();
    }

    function drawCard(c, x, y, w, h, ach, isUnlocked) {
        c.save();

        const grd = c.createLinearGradient(x, y, x, y + h);
        if (isUnlocked) {
            grd.addColorStop(0, 'rgba(60, 44, 96, 0.85)');
            grd.addColorStop(1, 'rgba(30, 22, 54, 0.85)');
        } else {
            grd.addColorStop(0, 'rgba(28, 22, 46, 0.85)');
            grd.addColorStop(1, 'rgba(16, 12, 30, 0.85)');
        }
        c.fillStyle = grd;
        roundedPath(c, x, y, w, h, 12);
        c.fill();

        c.lineWidth = 1;
        c.strokeStyle = isUnlocked ? 'rgba(255, 216, 77, 0.32)' : 'rgba(255, 255, 255, 0.06)';
        roundedPath(c, x + 0.5, y + 0.5, w - 1, h - 1, 12);
        c.stroke();

        // Icon circle on the left.
        const iconR = 22;
        const iconCx = x + iconR + 12;
        const iconCy = y + h * 0.5;
        const accent = ach.color || '#ffd84d';
        c.fillStyle = isUnlocked ? hexToRgba(accent, 0.22) : 'rgba(255,255,255,0.04)';
        c.beginPath();
        c.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = isUnlocked ? hexToRgba(accent, 0.7) : 'rgba(255,255,255,0.10)';
        c.lineWidth = 1.25;
        c.beginPath();
        c.arc(iconCx, iconCy, iconR - 0.6, 0, Math.PI * 2);
        c.stroke();

        // Icon glyph (greyed when locked).
        c.font = '600 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.globalAlpha = isUnlocked ? 1 : 0.35;
        c.fillStyle = '#ffffff';
        c.fillText(ach.icon || '🏆', iconCx, iconCy + 1);
        c.globalAlpha = 1;

        // Lock badge overlay for locked achievements.
        if (!isUnlocked) {
            const bx = iconCx + iconR - 8;
            const by = iconCy + iconR - 8;
            c.fillStyle = 'rgba(20, 14, 32, 0.92)';
            c.beginPath();
            c.arc(bx, by, 9, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = 'rgba(255,255,255,0.28)';
            c.lineWidth = 1;
            c.beginPath();
            c.arc(bx, by, 8.5, 0, Math.PI * 2);
            c.stroke();
            c.font = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
            c.fillStyle = 'rgba(255,255,255,0.72)';
            c.fillText('🔒', bx, by + 1);
        }

        // Text column.
        const textX = iconCx + iconR + 12;
        const textW = (x + w) - textX - 12;

        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.font = '700 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.fillStyle = isUnlocked ? '#ffffff' : 'rgba(220, 215, 235, 0.55)';
        c.fillText(truncate(c, ach.name, textW), textX, y + 14);

        if (isUnlocked) {
            c.font = '500 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
            c.fillStyle = 'rgba(220, 215, 235, 0.78)';
            c.fillText(truncate(c, ach.desc, textW), textX, y + 36);
        } else {
            c.font = 'italic 500 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
            c.fillStyle = 'rgba(220, 215, 235, 0.45)';
            c.fillText(truncate(c, 'Locked — ' + ach.desc, textW), textX, y + 36);
        }

        // "Unlocked" pill on the bottom-right of unlocked cards.
        if (isUnlocked) {
            c.font = '800 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
            c.fillStyle = hexToRgba(accent, 0.95);
            c.textAlign = 'right';
            c.fillText('UNLOCKED', x + w - 12, y + h - 16);
        }

        c.restore();
    }

    function hexToRgba(hex, a) {
        if (typeof hex !== 'string') return `rgba(255,216,77,${a})`;
        let h = hex.replace('#', '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        if (h.length !== 6) return `rgba(255,216,77,${a})`;
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    // ---------- HUD draw ----------
    HOOKS.onDrawHUD.push((c) => {
        if (MTCD.G && MTCD.G.stage !== 'levelComplete') drawToggleButton(c);
        if (ui.openT > 0) drawPanel(c);
    });

    // ---------- Input ----------
    function eventToCanvas(e) {
        const canvas = document.getElementById('game');
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        let cx, cy;
        if (e.touches && e.touches.length) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
        else if (e.changedTouches && e.changedTouches.length) { cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY; }
        else { cx = e.clientX; cy = e.clientY; }
        if (cx === undefined) return null;
        return { x: cx - r.left, y: cy - r.top };
    }

    function swallow(e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }

    function handlePress(e) {
        const p = eventToCanvas(e);
        if (!p) return;
        if (ui.open) {
            if (pointInRect(p.x, p.y, ui.closeRect)) {
                close();
                swallow(e);
                return;
            }
            // Absorb every other click while panel is open.
            swallow(e);
            return;
        }
        if (pointInRect(p.x, p.y, ui.toggleRect)) {
            open();
            swallow(e);
        }
    }

    document.addEventListener('mousedown', handlePress, true);
    document.addEventListener('touchstart', handlePress, { capture: true, passive: false });

    document.addEventListener('keydown', (e) => {
        if (!ui.open) return;
        if (e.key === 'Escape') {
            close();
            swallow(e);
        }
    }, true);

    // ---------- Public surface ----------
    MTCD.achievementViewer = { open, close };
})();
