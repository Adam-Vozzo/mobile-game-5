// ============================================================================
// achievements.js  -  "Make the Cat Dizzy!" achievements / medals system
// ----------------------------------------------------------------------------
// Self-contained module. Subscribes to window.MTCD hooks, persists unlocked
// achievement IDs to localStorage, and renders juicy in-canvas popups.
// ============================================================================
(function () {
    'use strict';

    // Wait until MTCD hook API exists. game.js sets it on script load, so this
    // should already be present, but guard anyway.
    if (!window.MTCD || !window.MTCD.HOOKS) {
        console.warn('[achievements] window.MTCD not available; module disabled.');
        return;
    }

    const MTCD = window.MTCD;
    const HOOKS = MTCD.HOOKS;
    const FX = MTCD.FX;
    const STORAGE_KEY = 'mtcd_achievements';

    // ---------- Persistence ----------
    function loadUnlocked() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return new Set();
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return new Set();
            return new Set(arr.filter((s) => typeof s === 'string'));
        } catch (e) {
            return new Set();
        }
    }
    function saveUnlocked(set) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
        } catch (e) { /* ignore quota errors */ }
    }

    const unlocked = loadUnlocked();

    // ---------- Achievement definitions ----------
    // Each unlock function returns true to fire the popup. They are evaluated
    // from the relevant hooks below; the per-run counters are stored on `state`.
    const ACHIEVEMENTS = [
        {
            id: 'first_catch',
            name: 'First Catch',
            desc: 'Capture your very first cat.',
            icon: '🐾',
            color: '#ffd84d',
            check: (ev, ctx) => ev === 'capture' && ctx.totalCaptures >= 1,
        },
        {
            id: 'combo_5',
            name: 'On a Roll',
            desc: 'Reach a 5x combo.',
            icon: '🔥',
            color: '#ff6e3b',
            check: (ev) => ev === 'loop' && (MTCD.G.combo | 0) >= 5,
        },
        {
            id: 'combo_10',
            name: 'Unstoppable',
            desc: 'Reach a 10x combo.',
            icon: '⚡',
            color: '#7cd6ff',
            check: (ev) => ev === 'loop' && (MTCD.G.combo | 0) >= 10,
        },
        {
            id: 'score_10000',
            name: 'High Roller',
            desc: 'Reach a score of 10,000.',
            icon: '💎',
            color: '#9b6cff',
            check: () => (MTCD.G.score | 0) >= 10000,
        },
        {
            id: 'score_50000',
            name: 'Laser Virtuoso',
            desc: 'Reach a score of 50,000.',
            icon: '🌟',
            color: '#ffec5e',
            check: () => (MTCD.G.score | 0) >= 50000,
        },
        {
            id: 'reach_level_5',
            name: 'Cat Wrangler',
            desc: 'Reach Level 5.',
            icon: '🎯',
            color: '#4dffb6',
            check: (ev) => ev === 'levelStart' && (MTCD.G.level | 0) >= 5,
        },
        {
            id: 'boss_slayer',
            name: 'Boss Slayer',
            desc: 'Capture a boss cat.',
            icon: '👑',
            color: '#ff3b6e',
            check: (ev, ctx) => ev === 'capture' && ctx.cat && ctx.cat.type && ctx.cat.type.isBoss,
        },
        {
            id: 'flawless_level',
            name: 'Flawless',
            desc: 'Clear a level without a single line break.',
            icon: '✨',
            color: '#a4dc4d',
            check: (ev, ctx) =>
                ev === 'capture' &&
                MTCD.G.capturesLeft === 0 &&
                ctx.breaksThisLevel === 0,
        },
        {
            id: 'catnip_connoisseur',
            name: 'Catnip Connoisseur',
            desc: 'Get 5 cats high on catnip.',
            icon: '🌿',
            color: '#a4dc4d',
            check: (ev, ctx) => ev === 'catnip' && ctx.catnipped >= 5,
        },
        {
            id: 'persistent_pointer',
            name: 'Persistent Pointer',
            desc: 'Capture 25 cats overall.',
            icon: '🏆',
            color: '#ffb84d',
            check: (ev, ctx) => ev === 'capture' && ctx.totalCaptures >= 25,
        },
        {
            id: 'big_loop',
            name: 'Big Loop Energy',
            desc: 'Close a single loop covering 60,000+ pixels².',
            icon: '🌀',
            color: '#7cd6ff',
            check: (ev, ctx) => ev === 'loop' && ctx.area >= 60000,
        },
    ];

    // ---------- Persistent / per-run counters ----------
    const state = {
        // Persistent across runs
        totalCaptures: parseInt(localStorage.getItem('mtcd_ach_totalCaptures') || '0', 10) || 0,
        catnipped: parseInt(localStorage.getItem('mtcd_ach_catnipped') || '0', 10) || 0,
        // Per-level
        breaksThisLevel: 0,
        // Track which cats we've already counted for catnip (per run)
        catnipSeen: new WeakSet(),
    };
    function persistCounters() {
        try {
            localStorage.setItem('mtcd_ach_totalCaptures', String(state.totalCaptures));
            localStorage.setItem('mtcd_ach_catnipped', String(state.catnipped));
        } catch (e) { /* ignore */ }
    }

    // ---------- Popup queue ----------
    // Multiple unlocks in quick succession are queued and shown one after
    // another so they never overlap.
    const popups = []; // { ach, t (seconds since shown), dur }
    const POPUP_DUR = 3.6;     // total seconds visible
    const POPUP_W = 280;
    const POPUP_H = 78;
    const POPUP_MARGIN = 16;

    function tryUnlock(ev, ctx) {
        for (const ach of ACHIEVEMENTS) {
            if (unlocked.has(ach.id)) continue;
            let ok = false;
            try { ok = !!ach.check(ev, ctx); } catch (e) { ok = false; }
            if (!ok) continue;
            unlocked.add(ach.id);
            saveUnlocked(unlocked);
            queuePopup(ach);
        }
    }

    function queuePopup(ach) {
        popups.push({ ach, t: 0, dur: POPUP_DUR });

        // Audio: success chord. SFX.capture() exists per hook API. Guard in
        // case audio context isn't unlocked yet (will simply no-op).
        try {
            const A = MTCD.audio && MTCD.audio();
            if (A && A.SFX) {
                if (A.SFX.capture) A.SFX.capture();
                else if (A.SFX.loopClose) A.SFX.loopClose(3);
            }
        } catch (e) { /* ignore */ }

        // Sparkles where the popup lives. We don't know its exact position
        // until draw, but spawn near the top-right region of the canvas.
        try {
            const sz = MTCD.canvasSize();
            const sx = sz.W - POPUP_MARGIN - POPUP_W * 0.5;
            const sy = POPUP_MARGIN + POPUP_H * 0.5;
            FX.spawnSparkles(sx, sy, 18, ach.color || '#ffd84d');
        } catch (e) { /* ignore */ }
    }

    // ---------- Hook subscriptions ----------
    HOOKS.onLevelStart.push((n) => {
        state.breaksThisLevel = 0;
        // Re-evaluate level-start gated achievements ("Reach Level 5", etc.)
        tryUnlock('levelStart', {});
    });

    HOOKS.onLineBreak.push((reason) => {
        state.breaksThisLevel++;
    });

    HOOKS.onLoopComplete.push((cat, area, points) => {
        // Catnip approximation: if a non-captured cat has moodTimer > 3 it was
        // freshly catnip'd. Count once per cat per run via WeakSet.
        if (cat && cat.moodTimer > 3 && !state.catnipSeen.has(cat) && !cat.captured) {
            state.catnipSeen.add(cat);
            state.catnipped++;
            persistCounters();
            tryUnlock('catnip', { cat, area, points });
        }
        tryUnlock('loop', { cat, area: area || 0, points: points || 0 });
    });

    HOOKS.onCapture.push((cat, bonus) => {
        state.totalCaptures++;
        persistCounters();
        tryUnlock('capture', {
            cat,
            bonus: bonus || 0,
            totalCaptures: state.totalCaptures,
            breaksThisLevel: state.breaksThisLevel,
        });
    });

    HOOKS.onUpdate.push((dt) => {
        if (!popups.length) return;
        // Advance only the front popup. Drop it when finished.
        popups[0].t += dt;
        if (popups[0].t >= popups[0].dur) {
            popups.shift();
        }
    });

    // ---------- HUD rendering ----------
    HOOKS.onDrawHUD.push((ctx) => {
        if (!popups.length) return;
        const sz = MTCD.canvasSize();
        const W = sz.W;
        const p = popups[0];
        drawPopup(ctx, p, W);
    });

    // Smoothstep ease for slide-in / slide-out
    function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

    function drawPopup(ctx, p, W) {
        const ach = p.ach;
        const t = p.t;
        const dur = p.dur;
        const slideIn = 0.45;
        const slideOut = 0.45;
        let phase;
        if (t < slideIn) {
            phase = smoothstep(t / slideIn);            // 0 -> 1
        } else if (t > dur - slideOut) {
            phase = 1 - smoothstep((t - (dur - slideOut)) / slideOut); // 1 -> 0
        } else {
            phase = 1;
        }
        const offX = (1 - phase) * (POPUP_W + POPUP_MARGIN + 8);

        const x = W - POPUP_W - POPUP_MARGIN + offX;
        const y = POPUP_MARGIN;
        const w = POPUP_W;
        const h = POPUP_H;
        const r = 12;

        ctx.save();

        // Soft drop shadow
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 4;

        // Card background gradient
        const grd = ctx.createLinearGradient(x, y, x, y + h);
        grd.addColorStop(0, 'rgba(38, 24, 58, 0.96)');
        grd.addColorStop(1, 'rgba(20, 12, 32, 0.96)');
        ctx.fillStyle = grd;
        roundedPath(ctx, x, y, w, h, r);
        ctx.fill();

        // Reset shadow before further strokes
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // Colored left accent stripe
        ctx.fillStyle = ach.color || '#ffd84d';
        roundedPath(ctx, x, y, 5, h, 2);
        ctx.fill();

        // Subtle outline
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        roundedPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
        ctx.stroke();

        // Pulsing icon halo (lives during hold phase)
        const iconCx = x + 30;
        const iconCy = y + h * 0.5;
        const pulse = 0.5 + 0.5 * Math.sin(t * 6);
        const haloR = 18 + pulse * 4;
        const halo = ctx.createRadialGradient(iconCx, iconCy, 4, iconCx, iconCy, haloR);
        halo.addColorStop(0, hexToRgba(ach.color || '#ffd84d', 0.45));
        halo.addColorStop(1, hexToRgba(ach.color || '#ffd84d', 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(iconCx, iconCy, haloR, 0, Math.PI * 2);
        ctx.fill();

        // Icon glyph
        ctx.font = '600 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(ach.icon || '🏆', iconCx, iconCy + 1);

        // "ACHIEVEMENT UNLOCKED" eyebrow
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = hexToRgba(ach.color || '#ffd84d', 0.95);
        ctx.fillText('ACHIEVEMENT UNLOCKED', x + 60, y + 12);

        // Name
        ctx.font = '700 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(truncate(ctx, ach.name, w - 70), x + 60, y + 26);

        // Description
        ctx.font = '500 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = 'rgba(220, 215, 235, 0.78)';
        ctx.fillText(truncate(ctx, ach.desc, w - 70), x + 60, y + 48);

        ctx.restore();
    }

    function roundedPath(ctx, x, y, w, h, r) {
        const rr = Math.min(r, Math.min(w, h) * 0.5);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.arcTo(x + w, y, x + w, y + rr, rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        ctx.lineTo(x + rr, y + h);
        ctx.arcTo(x, y + h, x, y + h - rr, rr);
        ctx.lineTo(x, y + rr);
        ctx.arcTo(x, y, x + rr, y, rr);
        ctx.closePath();
    }

    function truncate(ctx, str, maxW) {
        if (!str) return '';
        if (ctx.measureText(str).width <= maxW) return str;
        const ell = '…';
        let lo = 0, hi = str.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(str.slice(0, mid) + ell).width <= maxW) lo = mid;
            else hi = mid - 1;
        }
        return str.slice(0, lo) + ell;
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

    // ---------- Public surface (debug / inspect) ----------
    // Expose a tiny read-only API on MTCD without polluting globals.
    MTCD.achievements = {
        all: () => ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc })),
        unlocked: () => Array.from(unlocked),
        reset: () => {
            unlocked.clear();
            saveUnlocked(unlocked);
            try {
                localStorage.removeItem('mtcd_ach_totalCaptures');
                localStorage.removeItem('mtcd_ach_catnipped');
            } catch (e) { /* ignore */ }
            state.totalCaptures = 0;
            state.catnipped = 0;
            state.breaksThisLevel = 0;
        },
    };
})();
