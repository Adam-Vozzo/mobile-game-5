// ============================================================================
// settings.js — Quick settings panel for "Make the Cat Dizzy!"
// ----------------------------------------------------------------------------
// Self-contained module. Adds a small gear button (top-left of canvas) and a
// modal panel with sliders + reset buttons. Pauses the game while open.
//
// VOLUME NOTE: The audio module (game.js) does not expose its masterGain, only
// audio().setMuted(boolean). We therefore implement SFX volume as a 5-step
// slider where any non-zero level is treated as "unmuted" and 0 is "muted".
// We persist the chosen level to localStorage.mtcd_sfx_volume so the slider
// position survives reloads. Music volume is the same idea, persisted to
// localStorage.mtcd_music_volume; the music module reads localStorage
// 'mtcd_muted' for its mute decision so we keep it in sync.
// ============================================================================
(function () {
    'use strict';

    if (!window.MTCD || !window.MTCD.HOOKS) {
        console.warn('[settings] window.MTCD not available; module disabled.');
        return;
    }

    const MTCD = window.MTCD;
    const HOOKS = MTCD.HOOKS;

    // 5 stepped levels (0%, 25%, 50%, 75%, 100%). Default level 3 (60%).
    const STEPS = [0, 25, 50, 75, 100];
    const DEFAULT_LEVEL = 3; // 60%

    // ---------- Persistence ----------
    function loadVol(key) {
        try {
            const raw = localStorage.getItem(key);
            if (raw == null) return STEPS[DEFAULT_LEVEL];
            const v = parseInt(raw, 10);
            if (isNaN(v)) return STEPS[DEFAULT_LEVEL];
            return clamp(v, 0, 100);
        } catch (_) { return STEPS[DEFAULT_LEVEL]; }
    }
    function saveVol(key, v) {
        try { localStorage.setItem(key, String(v)); } catch (_) {}
    }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    // ---------- State ----------
    const state = {
        sfxVol: loadVol('mtcd_sfx_volume'),
        musicVol: loadVol('mtcd_music_volume'),
        open: false,
        openT: 0,
        phase: 0,
        pausedByUs: false,
        // Cached hit rects, recomputed each draw.
        gearRect: { x: 0, y: 0, w: 0, h: 0 },
        closeRect: { x: 0, y: 0, w: 0, h: 0 },
        sfxMinusRect: null, sfxPlusRect: null,
        musMinusRect: null, musPlusRect: null,
        btnRects: [], // { rect, action, danger }
        panelRect: null,
        // Confirmation state for destructive actions.
        confirmAction: null, // string id awaiting second click
        confirmT: 0, // seconds remaining before confirm clears
    };

    // Apply initial mute state based on saved volumes.
    applyAudioState();

    function applyAudioState() {
        try {
            const A = MTCD.audio && MTCD.audio();
            if (A && typeof A.setMuted === 'function') {
                A.setMuted(state.sfxVol === 0);
            }
        } catch (_) {}
        try {
            // music.js reads mtcd_muted; treat music vol == 0 as muted, else
            // honor whatever the user previously set via existing mute toggle.
            // We only force the key to '1' when *both* sfx & music are zero
            // to avoid stomping the player's prior preference unexpectedly.
            if (state.musicVol === 0) {
                localStorage.setItem('mtcd_muted', '1');
            } else if (state.sfxVol > 0) {
                localStorage.setItem('mtcd_muted', '0');
            }
        } catch (_) {}
    }

    // ---------- Helpers ----------
    function size() {
        const s = MTCD.canvasSize();
        return { W: s.W || window.innerWidth || 800, H: s.H || window.innerHeight || 600 };
    }
    function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
    function pointInRect(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

    function roundedPath(c, x, y, w, h, r) {
        const rr = Math.min(r, Math.min(w, h) * 0.5);
        c.beginPath();
        c.moveTo(x + rr, y);
        c.arcTo(x + w, y, x + w, y + rr, rr);
        c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        c.arcTo(x, y + h, x, y + h - rr, rr);
        c.arcTo(x, y, x + rr, y, rr);
        c.closePath();
    }

    // ---------- Open / close ----------
    function open() {
        if (state.open) return;
        state.open = true;
        state.openT = 0;
        state.confirmAction = null;
        if (MTCD.G && !MTCD.G.paused) { MTCD.G.paused = true; state.pausedByUs = true; }
        else { state.pausedByUs = false; }
        try { const A = MTCD.audio && MTCD.audio(); if (A && A.SFX && A.SFX.click) A.SFX.click(); } catch (_) {}
    }
    function close() {
        if (!state.open) return;
        state.open = false;
        state.confirmAction = null;
        if (state.pausedByUs && MTCD.G) MTCD.G.paused = false;
        state.pausedByUs = false;
        try { const A = MTCD.audio && MTCD.audio(); if (A && A.SFX && A.SFX.click) A.SFX.click(); } catch (_) {}
    }

    // ---------- Volume adjustment ----------
    function stepVol(cur, dir) {
        // Find nearest step then move dir.
        let idx = 0, best = Infinity;
        for (let i = 0; i < STEPS.length; i++) {
            const d = Math.abs(STEPS[i] - cur);
            if (d < best) { best = d; idx = i; }
        }
        idx = clamp(idx + dir, 0, STEPS.length - 1);
        return STEPS[idx];
    }
    function adjustSfx(dir) {
        state.sfxVol = stepVol(state.sfxVol, dir);
        saveVol('mtcd_sfx_volume', state.sfxVol);
        applyAudioState();
        try { const A = MTCD.audio && MTCD.audio(); if (A && A.SFX && A.SFX.click) A.SFX.click(); } catch (_) {}
    }
    function adjustMusic(dir) {
        state.musicVol = stepVol(state.musicVol, dir);
        saveVol('mtcd_music_volume', state.musicVol);
        applyAudioState();
    }

    // ---------- Reset actions ----------
    function resetTutorial() {
        try { localStorage.removeItem('mtcd_tutorial_done'); } catch (_) {}
    }
    function resetCatdex() {
        try { localStorage.removeItem('mtcd_catdex'); } catch (_) {}
    }
    function resetAchievements() {
        try {
            localStorage.removeItem('mtcd_achievements');
            localStorage.removeItem('mtcd_ach_totalCaptures');
            localStorage.removeItem('mtcd_ach_catnipped');
            localStorage.removeItem('mtcd_first_loop_done');
        } catch (_) {}
    }
    function resetAll() {
        try {
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf('mtcd_') === 0) toRemove.push(k);
            }
            for (const k of toRemove) localStorage.removeItem(k);
        } catch (_) {}
        // Re-apply saved-now-defaulted volumes so audio state stays sane.
        state.sfxVol = STEPS[DEFAULT_LEVEL];
        state.musicVol = STEPS[DEFAULT_LEVEL];
        applyAudioState();
    }

    // Trigger an action; if it's destructive, require a second click within 3s.
    function triggerAction(id) {
        const destructive = id !== 'tutorial';
        if (destructive && state.confirmAction !== id) {
            state.confirmAction = id;
            state.confirmT = 3;
            return;
        }
        state.confirmAction = null;
        if (id === 'tutorial') resetTutorial();
        else if (id === 'catdex') resetCatdex();
        else if (id === 'achievements') resetAchievements();
        else if (id === 'all') resetAll();
        try { const A = MTCD.audio && MTCD.audio(); if (A && A.SFX && A.SFX.click) A.SFX.click(); } catch (_) {}
    }

    // ---------- Per-frame ----------
    HOOKS.onUpdate.push((dt) => {
        state.phase += dt;
        const target = state.open ? 1 : 0;
        state.openT = state.openT + (target - state.openT) * Math.min(1, dt * 9);
        if (!state.open && state.openT < 0.001) state.openT = 0;
        if (state.open && state.openT > 0.999) state.openT = 1;
        if (state.confirmT > 0) {
            state.confirmT -= dt;
            if (state.confirmT <= 0) state.confirmAction = null;
        }
    });

    // ---------- Drawing ----------
    function drawGear(c) {
        const { W } = size();
        const sz = 40, margin = 14;
        // Top-left of canvas (avoid top-right pause btn / bottom-right paw).
        const x = margin;
        const y = margin;
        state.gearRect = { x, y, w: sz, h: sz };

        c.save();
        c.shadowColor = 'rgba(0,0,0,0.4)';
        c.shadowBlur = 10;
        c.shadowOffsetY = 2;

        const grd = c.createLinearGradient(x, y, x, y + sz);
        grd.addColorStop(0, 'rgba(54, 36, 82, 0.92)');
        grd.addColorStop(1, 'rgba(28, 18, 46, 0.92)');
        c.fillStyle = grd;
        roundedPath(c, x, y, sz, sz, 10);
        c.fill();
        c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;

        c.strokeStyle = 'rgba(255,255,255,0.18)';
        c.lineWidth = 1;
        roundedPath(c, x + 0.5, y + 0.5, sz - 1, sz - 1, 10);
        c.stroke();

        // Gear glyph (rotates slowly).
        const cx = x + sz / 2, cy = y + sz / 2;
        c.translate(cx, cy);
        c.rotate(state.phase * 0.6);
        c.fillStyle = '#ffd84d';
        c.font = '700 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('⚙', 0, 1);
        c.restore();
    }

    function drawSliderRow(c, label, x, y, w, vol, setMinus, setPlus) {
        const rowH = 40;
        c.fillStyle = '#fff';
        c.font = '600 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(label, x, y + rowH * 0.5);

        // Buttons + bar on the right half.
        const btnSize = 32;
        const barX = x + 160;
        const barW = w - 160 - btnSize * 2 - 24;
        const barY = y + rowH * 0.5 - 6;
        const barH = 12;
        const minusX = barX - btnSize - 8;
        const plusX = barX + barW + 8;

        // Minus button.
        c.fillStyle = 'rgba(255,255,255,0.10)';
        roundedPath(c, minusX, y + 4, btnSize, btnSize, 8);
        c.fill();
        c.fillStyle = '#fff';
        c.font = '700 18px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('−', minusX + btnSize * 0.5, y + 4 + btnSize * 0.5 + 1);
        const minusRect = { x: minusX, y: y + 4, w: btnSize, h: btnSize };

        // Bar background.
        c.fillStyle = 'rgba(255,255,255,0.10)';
        roundedPath(c, barX, barY, barW, barH, barH * 0.5);
        c.fill();
        // Filled portion.
        const fillW = barW * (vol / 100);
        if (fillW > 0) {
            c.fillStyle = vol === 0 ? 'rgba(255, 60, 110, 0.65)' : '#ffd84d';
            roundedPath(c, barX, barY, fillW, barH, barH * 0.5);
            c.fill();
        }
        // Step ticks.
        for (let i = 0; i < STEPS.length; i++) {
            const tx = barX + (STEPS[i] / 100) * barW;
            c.fillStyle = 'rgba(255,255,255,0.35)';
            c.fillRect(tx - 1, barY - 2, 2, barH + 4);
        }
        // Value label to the right of plus.
        // Plus button.
        c.fillStyle = 'rgba(255,255,255,0.10)';
        roundedPath(c, plusX, y + 4, btnSize, btnSize, 8);
        c.fill();
        c.fillStyle = '#fff';
        c.font = '700 18px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('+', plusX + btnSize * 0.5, y + 4 + btnSize * 0.5 + 1);
        const plusRect = { x: plusX, y: y + 4, w: btnSize, h: btnSize };

        // Numeric label below or beside.
        c.fillStyle = 'rgba(220,215,235,0.7)';
        c.font = '500 12px system-ui, sans-serif';
        c.textAlign = 'left';
        c.fillText(`${vol}%${vol === 0 ? '  (muted)' : ''}`, x, y + rowH + 4);

        return { minusRect, plusRect };
    }

    function drawActionButton(c, x, y, w, h, label, danger, awaitingConfirm) {
        let bg, border, txt;
        if (awaitingConfirm) {
            bg = 'rgba(255, 60, 110, 0.30)';
            border = 'rgba(255, 100, 130, 0.85)';
            txt = '#ffffff';
        } else if (danger) {
            bg = 'rgba(255, 60, 110, 0.18)';
            border = 'rgba(255, 100, 130, 0.55)';
            txt = '#ffd0dc';
        } else {
            bg = 'rgba(255,255,255,0.10)';
            border = 'rgba(255,255,255,0.20)';
            txt = '#ffffff';
        }
        c.fillStyle = bg;
        roundedPath(c, x, y, w, h, 10);
        c.fill();
        c.strokeStyle = border;
        c.lineWidth = 1;
        roundedPath(c, x + 0.5, y + 0.5, w - 1, h - 1, 10);
        c.stroke();
        c.fillStyle = txt;
        c.font = '600 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(awaitingConfirm ? 'Click again to confirm' : label, x + w * 0.5, y + h * 0.5 + 1);
    }

    function drawPanel(c) {
        if (state.openT <= 0) return;
        const { W, H } = size();
        const phase = smoothstep(state.openT);

        // Backdrop.
        c.save();
        c.fillStyle = `rgba(8, 4, 18, ${0.62 * phase})`;
        c.fillRect(0, 0, W, H);
        c.restore();

        // Panel layout.
        const pw = Math.min(W * 0.92, 480);
        const ph = Math.min(H * 0.92, 560);
        const px = (W - pw) * 0.5;
        const slide = (1 - phase) * 24;
        const py = (H - ph) * 0.5 + slide;
        state.panelRect = { x: px, y: py, w: pw, h: ph };

        c.save();
        c.globalAlpha = phase;

        // Background gradient + border.
        c.shadowColor = 'rgba(0,0,0,0.55)';
        c.shadowBlur = 28;
        c.shadowOffsetY = 8;
        const grd = c.createLinearGradient(px, py, px, py + ph);
        grd.addColorStop(0, 'rgba(38, 26, 60, 0.96)');
        grd.addColorStop(1, 'rgba(18, 10, 30, 0.96)');
        c.fillStyle = grd;
        roundedPath(c, px, py, pw, ph, 18);
        c.fill();
        c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
        c.strokeStyle = 'rgba(255,255,255,0.10)';
        c.lineWidth = 1;
        roundedPath(c, px + 0.5, py + 0.5, pw - 1, ph - 1, 18);
        c.stroke();

        // Title.
        c.fillStyle = '#fff';
        c.font = '800 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.fillText('Settings', px + 22, py + 18);

        // Close button (top-right).
        const cs = 36;
        const cbx = px + pw - cs - 14;
        const cby = py + 14;
        state.closeRect = { x: cbx, y: cby, w: cs, h: cs };
        c.fillStyle = 'rgba(255, 60, 100, 0.18)';
        roundedPath(c, cbx, cby, cs, cs, 10);
        c.fill();
        c.strokeStyle = 'rgba(255, 100, 130, 0.55)';
        roundedPath(c, cbx + 0.5, cby + 0.5, cs - 1, cs - 1, 10);
        c.stroke();
        c.fillStyle = '#fff';
        c.font = '700 22px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('×', cbx + cs * 0.5, cby + cs * 0.5 + 1);

        // Volume sliders.
        const innerX = px + 22;
        const innerW = pw - 44;
        let cy = py + 64;

        const sfxRects = drawSliderRow(c, 'SFX Volume', innerX, cy, innerW, state.sfxVol);
        state.sfxMinusRect = sfxRects.minusRect;
        state.sfxPlusRect = sfxRects.plusRect;
        cy += 64;

        const musRects = drawSliderRow(c, 'Music Volume', innerX, cy, innerW, state.musicVol);
        state.musMinusRect = musRects.minusRect;
        state.musPlusRect = musRects.plusRect;
        cy += 78;

        // Divider.
        c.strokeStyle = 'rgba(255,255,255,0.08)';
        c.beginPath();
        c.moveTo(innerX, cy); c.lineTo(innerX + innerW, cy);
        c.stroke();
        cy += 14;

        // Action buttons stacked.
        const btnH = 40;
        const gap = 10;
        const actions = [
            { id: 'tutorial', label: 'Reset Tutorial', danger: false },
            { id: 'catdex', label: 'Reset Catdex', danger: false },
            { id: 'achievements', label: 'Reset Achievements', danger: false },
            { id: 'all', label: 'Reset All Progress', danger: true },
        ];
        state.btnRects = [];
        for (const a of actions) {
            drawActionButton(c, innerX, cy, innerW, btnH, a.label, a.danger, state.confirmAction === a.id);
            state.btnRects.push({ rect: { x: innerX, y: cy, w: innerW, h: btnH }, action: a.id });
            cy += btnH + gap;
        }

        // Footer hint.
        c.fillStyle = 'rgba(220,215,235,0.5)';
        c.font = '500 11px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('Esc or click outside to close', px + pw * 0.5, py + ph - 18);

        c.restore();
    }

    HOOKS.onDrawHUD.push((c) => {
        if (MTCD.G && MTCD.G.stage !== 'levelComplete') drawGear(c);
        if (state.openT > 0) drawPanel(c);
    });

    // ---------- Input ----------
    function getCanvas() { return document.getElementById('game'); }
    function eventToCanvas(e) {
        const canvas = getCanvas();
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
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }

    function handlePress(e) {
        const p = eventToCanvas(e);
        if (!p) return;

        if (state.open) {
            if (pointInRect(p.x, p.y, state.closeRect)) { close(); stop(e); return; }
            if (pointInRect(p.x, p.y, state.sfxMinusRect)) { adjustSfx(-1); stop(e); return; }
            if (pointInRect(p.x, p.y, state.sfxPlusRect))  { adjustSfx(+1); stop(e); return; }
            if (pointInRect(p.x, p.y, state.musMinusRect)) { adjustMusic(-1); stop(e); return; }
            if (pointInRect(p.x, p.y, state.musPlusRect))  { adjustMusic(+1); stop(e); return; }
            for (const b of state.btnRects) {
                if (pointInRect(p.x, p.y, b.rect)) { triggerAction(b.action); stop(e); return; }
            }
            // Click outside the panel rect closes; click inside (not on a control) just clears confirm.
            if (state.panelRect && !pointInRect(p.x, p.y, state.panelRect)) {
                close(); stop(e); return;
            }
            // Inside panel but not on a button: cancel pending confirm and swallow.
            state.confirmAction = null;
            stop(e);
            return;
        }

        // Panel closed: only the gear is interactive.
        if (pointInRect(p.x, p.y, state.gearRect)) { open(); stop(e); }
    }

    document.addEventListener('mousedown', handlePress, true);
    document.addEventListener('touchstart', handlePress, { capture: true, passive: false });

    document.addEventListener('keydown', (e) => {
        if (!state.open) return;
        if (e.key === 'Escape') {
            close();
            e.preventDefault(); e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        }
    }, true);

    // ---------- Public surface ----------
    MTCD.settings = {
        open,
        close,
        isOpen: () => state.open,
        getSfxVolume: () => state.sfxVol,
        getMusicVolume: () => state.musicVol,
    };
})();
