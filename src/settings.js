// ============================================================================
// settings.js — Quick settings panel for "Make the Cat Dizzy!"
// ----------------------------------------------------------------------------
// Self-contained module. Adds a small gear button (top-left of canvas) and a
// modal panel with stepped sliders + reset buttons. Pauses the game while open.
//
// VOLUME NOTE: game.js's Audio module only exposes setMuted(bool)/isMuted();
// its masterGain is closed over in the IIFE. So both volume "sliders" use 5
// stepped levels (0/25/50/75/100). Any non-zero level reads as "unmuted"; 0
// reads as "muted". The chosen level persists in localStorage so the slider
// position survives reload. Music volume drives localStorage 'mtcd_muted',
// which music.js polls each frame for its own master gain ramp.
// ============================================================================
(function () {
    'use strict';
    if (!window.MTCD || !window.MTCD.HOOKS) {
        console.warn('[settings] window.MTCD not available; module disabled.');
        return;
    }
    const MTCD = window.MTCD, HOOKS = MTCD.HOOKS;
    const STEPS = [0, 25, 50, 75, 100];
    const DEFAULT_VOL = 60;
    const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

    // ---------- Persistence ----------
    function loadVol(key) {
        try {
            const raw = localStorage.getItem(key);
            if (raw == null) return DEFAULT_VOL;
            const v = parseInt(raw, 10);
            return isNaN(v) ? DEFAULT_VOL : clamp(v, 0, 100);
        } catch (_) { return DEFAULT_VOL; }
    }
    const saveVol = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (_) {} };

    // ---------- State ----------
    const S = {
        sfxVol: loadVol('mtcd_sfx_volume'),
        musicVol: loadVol('mtcd_music_volume'),
        open: false, openT: 0, phase: 0, pausedByUs: false,
        gearRect: null, closeRect: null, panelRect: null,
        sfxMinus: null, sfxPlus: null, musMinus: null, musPlus: null,
        btnRects: [], confirmAction: null, confirmT: 0,
    };

    function applyAudio() {
        try {
            const A = MTCD.audio && MTCD.audio();
            if (A && typeof A.setMuted === 'function') A.setMuted(S.sfxVol === 0);
        } catch (_) {}
        try {
            // music.js reads 'mtcd_muted'. Set it based on music vol == 0,
            // but only un-mute when sfx is also non-zero (avoid stomping prior
            // user mute preference if both sliders happen to be > 0).
            if (S.musicVol === 0) localStorage.setItem('mtcd_muted', '1');
            else if (S.sfxVol > 0) localStorage.setItem('mtcd_muted', '0');
        } catch (_) {}
    }
    applyAudio();

    // ---------- Helpers ----------
    function size() {
        const s = MTCD.canvasSize();
        return { W: s.W || window.innerWidth || 800, H: s.H || window.innerHeight || 600 };
    }
    const smoothstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    const inRect = (x, y, r) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    function rpath(c, x, y, w, h, r) {
        const rr = Math.min(r, Math.min(w, h) * 0.5);
        c.beginPath();
        c.moveTo(x + rr, y);
        c.arcTo(x + w, y, x + w, y + rr, rr);
        c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        c.arcTo(x, y + h, x, y + h - rr, rr);
        c.arcTo(x, y, x + rr, y, rr);
        c.closePath();
    }
    function clk() { try { const A = MTCD.audio && MTCD.audio(); if (A && A.SFX && A.SFX.click) A.SFX.click(); } catch (_) {} }

    // ---------- Open / close ----------
    function open() {
        if (S.open) return;
        S.open = true; S.openT = 0; S.confirmAction = null;
        if (MTCD.G && !MTCD.G.paused) { MTCD.G.paused = true; S.pausedByUs = true; }
        else { S.pausedByUs = false; }
        clk();
    }
    function close() {
        if (!S.open) return;
        S.open = false; S.confirmAction = null;
        if (S.pausedByUs && MTCD.G) MTCD.G.paused = false;
        S.pausedByUs = false;
        clk();
    }

    // ---------- Volume / actions ----------
    function stepVol(cur, dir) {
        let idx = 0, best = Infinity;
        for (let i = 0; i < STEPS.length; i++) {
            const d = Math.abs(STEPS[i] - cur);
            if (d < best) { best = d; idx = i; }
        }
        return STEPS[clamp(idx + dir, 0, STEPS.length - 1)];
    }
    function adjSfx(dir)   { S.sfxVol   = stepVol(S.sfxVol, dir);   saveVol('mtcd_sfx_volume',   S.sfxVol);   applyAudio(); clk(); }
    function adjMusic(dir) { S.musicVol = stepVol(S.musicVol, dir); saveVol('mtcd_music_volume', S.musicVol); applyAudio(); }

    function resetAll() {
        try {
            const rm = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf('mtcd_') === 0) rm.push(k);
            }
            for (const k of rm) localStorage.removeItem(k);
        } catch (_) {}
        S.sfxVol = DEFAULT_VOL; S.musicVol = DEFAULT_VOL; applyAudio();
    }
    function trigger(id) {
        const destructive = id !== 'tutorial';
        if (destructive && S.confirmAction !== id) {
            S.confirmAction = id; S.confirmT = 3; return;
        }
        S.confirmAction = null;
        try {
            if (id === 'tutorial') localStorage.removeItem('mtcd_tutorial_done');
            else if (id === 'catdex') localStorage.removeItem('mtcd_catdex');
            else if (id === 'achievements') {
                localStorage.removeItem('mtcd_achievements');
                localStorage.removeItem('mtcd_ach_totalCaptures');
                localStorage.removeItem('mtcd_ach_catnipped');
                localStorage.removeItem('mtcd_first_loop_done');
            } else if (id === 'all') resetAll();
        } catch (_) {}
        clk();
    }

    // ---------- Per-frame ----------
    HOOKS.onUpdate.push((dt) => {
        S.phase += dt;
        const target = S.open ? 1 : 0;
        S.openT += (target - S.openT) * Math.min(1, dt * 9);
        if (!S.open && S.openT < 0.001) S.openT = 0;
        if (S.open && S.openT > 0.999) S.openT = 1;
        if (S.confirmT > 0) { S.confirmT -= dt; if (S.confirmT <= 0) S.confirmAction = null; }
    });

    // ---------- Drawing ----------
    function drawGear(c) {
        const sz = 40, m = 14, x = m, y = m;
        S.gearRect = { x, y, w: sz, h: sz };
        c.save();
        c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 10; c.shadowOffsetY = 2;
        const grd = c.createLinearGradient(x, y, x, y + sz);
        grd.addColorStop(0, 'rgba(54, 36, 82, 0.92)');
        grd.addColorStop(1, 'rgba(28, 18, 46, 0.92)');
        c.fillStyle = grd; rpath(c, x, y, sz, sz, 10); c.fill();
        c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
        c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
        rpath(c, x + 0.5, y + 0.5, sz - 1, sz - 1, 10); c.stroke();
        c.translate(x + sz / 2, y + sz / 2);
        c.rotate(S.phase * 0.6);
        c.fillStyle = '#ffd84d';
        c.font = '700 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('⚙', 0, 1);
        c.restore();
    }

    function drawSlider(c, label, x, y, w, vol) {
        const rowH = 40, btn = 32;
        c.fillStyle = '#fff';
        c.font = '600 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText(label, x, y + rowH * 0.5);
        const barX = x + 150, barW = w - 150 - btn * 2 - 24;
        const barY = y + rowH * 0.5 - 6, barH = 12;
        const minusX = barX - btn - 8, plusX = barX + barW + 8;

        // Minus
        c.fillStyle = 'rgba(255,255,255,0.10)'; rpath(c, minusX, y + 4, btn, btn, 8); c.fill();
        c.fillStyle = '#fff'; c.font = '700 18px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('−', minusX + btn * 0.5, y + 4 + btn * 0.5 + 1);

        // Bar bg + fill + ticks
        c.fillStyle = 'rgba(255,255,255,0.10)'; rpath(c, barX, barY, barW, barH, barH * 0.5); c.fill();
        const fillW = barW * (vol / 100);
        if (fillW > 0) {
            c.fillStyle = vol === 0 ? 'rgba(255,60,110,0.65)' : '#ffd84d';
            rpath(c, barX, barY, fillW, barH, barH * 0.5); c.fill();
        }
        for (let i = 0; i < STEPS.length; i++) {
            const tx = barX + (STEPS[i] / 100) * barW;
            c.fillStyle = 'rgba(255,255,255,0.35)';
            c.fillRect(tx - 1, barY - 2, 2, barH + 4);
        }

        // Plus
        c.fillStyle = 'rgba(255,255,255,0.10)'; rpath(c, plusX, y + 4, btn, btn, 8); c.fill();
        c.fillStyle = '#fff'; c.font = '700 18px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('+', plusX + btn * 0.5, y + 4 + btn * 0.5 + 1);

        c.fillStyle = 'rgba(220,215,235,0.7)'; c.font = '500 12px system-ui, sans-serif';
        c.textAlign = 'left';
        c.fillText(`${vol}%${vol === 0 ? '  (muted)' : ''}`, x, y + rowH + 4);

        return {
            minusRect: { x: minusX, y: y + 4, w: btn, h: btn },
            plusRect:  { x: plusX,  y: y + 4, w: btn, h: btn },
        };
    }

    function drawAction(c, x, y, w, h, label, danger, awaiting) {
        const bg = awaiting ? 'rgba(255,60,110,0.30)'
                  : danger ? 'rgba(255,60,110,0.18)' : 'rgba(255,255,255,0.10)';
        const bd = awaiting ? 'rgba(255,100,130,0.85)'
                  : danger ? 'rgba(255,100,130,0.55)' : 'rgba(255,255,255,0.20)';
        const tx = awaiting ? '#fff' : (danger ? '#ffd0dc' : '#fff');
        c.fillStyle = bg; rpath(c, x, y, w, h, 10); c.fill();
        c.strokeStyle = bd; c.lineWidth = 1; rpath(c, x + 0.5, y + 0.5, w - 1, h - 1, 10); c.stroke();
        c.fillStyle = tx;
        c.font = '600 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(awaiting ? 'Click again to confirm' : label, x + w * 0.5, y + h * 0.5 + 1);
    }

    const ACTIONS = [
        { id: 'tutorial', label: 'Reset Tutorial', danger: false },
        { id: 'catdex', label: 'Reset Catdex', danger: false },
        { id: 'achievements', label: 'Reset Achievements', danger: false },
        { id: 'all', label: 'Reset All Progress', danger: true },
    ];

    function drawPanel(c) {
        if (S.openT <= 0) return;
        const { W, H } = size(), phase = smoothstep(S.openT);
        c.save(); c.fillStyle = `rgba(8,4,18,${0.62 * phase})`; c.fillRect(0, 0, W, H); c.restore();

        const pw = Math.min(W * 0.92, 480), ph = Math.min(H * 0.92, 560);
        const px = (W - pw) * 0.5, py = (H - ph) * 0.5 + (1 - phase) * 24;
        S.panelRect = { x: px, y: py, w: pw, h: ph };

        c.save(); c.globalAlpha = phase;
        c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 28; c.shadowOffsetY = 8;
        const grd = c.createLinearGradient(px, py, px, py + ph);
        grd.addColorStop(0, 'rgba(38, 26, 60, 0.96)');
        grd.addColorStop(1, 'rgba(18, 10, 30, 0.96)');
        c.fillStyle = grd; rpath(c, px, py, pw, ph, 18); c.fill();
        c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
        c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1;
        rpath(c, px + 0.5, py + 0.5, pw - 1, ph - 1, 18); c.stroke();

        c.fillStyle = '#fff';
        c.font = '800 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'left'; c.textBaseline = 'top';
        c.fillText('Settings', px + 22, py + 18);

        const cs = 36, cbx = px + pw - cs - 14, cby = py + 14;
        S.closeRect = { x: cbx, y: cby, w: cs, h: cs };
        c.fillStyle = 'rgba(255,60,100,0.18)'; rpath(c, cbx, cby, cs, cs, 10); c.fill();
        c.strokeStyle = 'rgba(255,100,130,0.55)';
        rpath(c, cbx + 0.5, cby + 0.5, cs - 1, cs - 1, 10); c.stroke();
        c.fillStyle = '#fff'; c.font = '700 22px system-ui, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('×', cbx + cs * 0.5, cby + cs * 0.5 + 1);

        const ix = px + 22, iw = pw - 44;
        let cy = py + 64;
        let r = drawSlider(c, 'SFX Volume', ix, cy, iw, S.sfxVol);
        S.sfxMinus = r.minusRect; S.sfxPlus = r.plusRect; cy += 64;
        r = drawSlider(c, 'Music Volume', ix, cy, iw, S.musicVol);
        S.musMinus = r.minusRect; S.musPlus = r.plusRect; cy += 78;

        c.strokeStyle = 'rgba(255,255,255,0.08)';
        c.beginPath(); c.moveTo(ix, cy); c.lineTo(ix + iw, cy); c.stroke();
        cy += 14;

        const btnH = 40, gap = 10;
        S.btnRects = [];
        for (const a of ACTIONS) {
            drawAction(c, ix, cy, iw, btnH, a.label, a.danger, S.confirmAction === a.id);
            S.btnRects.push({ rect: { x: ix, y: cy, w: iw, h: btnH }, action: a.id });
            cy += btnH + gap;
        }

        c.fillStyle = 'rgba(220,215,235,0.5)'; c.font = '500 11px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('Esc or click outside to close', px + pw * 0.5, py + ph - 18);
        c.restore();
    }

    HOOKS.onDrawHUD.push((c) => {
        if (MTCD.G && MTCD.G.stage !== 'levelComplete') drawGear(c);
        if (S.openT > 0) drawPanel(c);
    });

    // ---------- Input ----------
    function evToCanvas(e) {
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
    function stop(e) {
        e.preventDefault(); e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
    function handlePress(e) {
        const p = evToCanvas(e);
        if (!p) return;
        if (S.open) {
            if (inRect(p.x, p.y, S.closeRect)) { close(); stop(e); return; }
            if (inRect(p.x, p.y, S.sfxMinus)) { adjSfx(-1); stop(e); return; }
            if (inRect(p.x, p.y, S.sfxPlus))  { adjSfx(+1); stop(e); return; }
            if (inRect(p.x, p.y, S.musMinus)) { adjMusic(-1); stop(e); return; }
            if (inRect(p.x, p.y, S.musPlus))  { adjMusic(+1); stop(e); return; }
            for (const b of S.btnRects) {
                if (inRect(p.x, p.y, b.rect)) { trigger(b.action); stop(e); return; }
            }
            if (S.panelRect && !inRect(p.x, p.y, S.panelRect)) { close(); stop(e); return; }
            S.confirmAction = null; stop(e); return;
        }
        if (inRect(p.x, p.y, S.gearRect)) { open(); stop(e); }
    }
    document.addEventListener('mousedown', handlePress, true);
    document.addEventListener('touchstart', handlePress, { capture: true, passive: false });
    document.addEventListener('keydown', (e) => {
        if (S.open && e.key === 'Escape') { close(); stop(e); }
    }, true);

    MTCD.settings = {
        open, close,
        isOpen: () => S.open,
        getSfxVolume: () => S.sfxVol,
        getMusicVolume: () => S.musicVol,
    };
})();
