// ============================================================
// cinematic.js — "FINAL BLOW" capture cinematic
// ----------------------------------------------------------------
// Triggers on boss captures or the final-cat-of-level capture.
// Renders a vignette + concentric ring closure + big stylized text
// for ~1.0s on top of the canvas, fully self-contained. Plugs into
// the window.MTCD hook API; never edits game.js.
// ============================================================
(function () {
    'use strict';

    const MTCD = window.MTCD;
    if (!MTCD || !MTCD.HOOKS || !MTCD.G || !MTCD.FX) {
        console.warn('[cinematic] window.MTCD not available; module disabled.');
        return;
    }

    const { G, FX, HOOKS, canvasSize, rand, clamp, TAU } = MTCD;

    // ---------------- State (single active cinematic at a time) ----
    const state = {
        active: false,
        t: 0,
        dur: 1.15,         // total length in seconds
        x: 0,
        y: 0,
        kind: 'final',     // 'boss' | 'final'
        accent: '#ff6e3b',
        title: '',
        // Pre-randomised speed-line angles (so they don't jitter every frame)
        rays: [],
        // Spawn-time of bonus confetti so we can time staggered bursts
        burstedAt2: false,
        burstedAt5: false,
    };

    // ---------------- Trigger -------------------------------------
    HOOKS.onCapture.push((cat, bonus) => {
        if (!cat || !cat.type) return;
        // Only fire on boss kills or the level-clearing capture.
        const isBoss = !!cat.type.isBoss;
        const isFinal = (G.capturesLeft | 0) === 0;
        if (!isBoss && !isFinal) return;
        // Don't restart if already mid-cinematic; allow upgrade boss > final.
        if (state.active && state.kind === 'boss') return;
        trigger(cat, isBoss);
    });

    function trigger(cat, isBoss) {
        state.active = true;
        state.t = 0;
        state.x = cat.x;
        state.y = cat.y;
        state.kind = isBoss ? 'boss' : 'final';
        state.title = isBoss ? 'BOSS DOWN!' : 'FINAL CATCH!';
        state.accent = isBoss ? '#ff3b6e' : '#ffd84d';
        state.burstedAt2 = false;
        state.burstedAt5 = false;
        // Pre-build 14 speed-line angle pairs around the cat.
        state.rays = [];
        for (let i = 0; i < 14; i++) {
            state.rays.push({
                ang: (i / 14) * TAU + rand(-0.12, 0.12),
                r0: rand(70, 110),
                r1: rand(160, 260),
                w: rand(2, 4),
            });
        }

        // Initial wallop: shake, flash, shockwaves, confetti fountain.
        FX.shake(20, 0.5);
        FX.flash('255,255,255', 0.4);
        const shockColor = isBoss ? 'rgba(255,59,110,0.95)' : 'rgba(255,216,77,0.95)';
        FX.shockwave(state.x, state.y, shockColor, 240, 0.55);
        setTimeout(() => FX.shockwave(state.x, state.y, 'rgba(255,255,255,0.7)', 360, 0.7), 90);
        setTimeout(() => FX.shockwave(state.x, state.y, state.accent + 'cc', 460, 0.85), 200);
        FX.spawnConfetti(state.x, state.y, 90, {
            spread: 420, lifeMin: 1.1, lifeMax: 2.0, gravity: 260, upward: 120,
        });
        FX.spawnConfetti(state.x, state.y, 40, {
            color: state.accent, spread: 260, lifeMin: 0.9, lifeMax: 1.6, gravity: 200,
        });
        FX.spawnSparkles(state.x, state.y, 40, '#ffffff');
        FX.spawnSparkles(state.x, state.y, 24, state.accent);

        // Stinger: thick low chord + bright top note overlay.
        try {
            const a = MTCD.audio && MTCD.audio();
            if (a && a.SFX) {
                a.SFX.capture && a.SFX.capture();
                a.SFX.purr && a.SFX.purr();
                if (isBoss) a.SFX.lineBreak && a.SFX.lineBreak();
            }
        } catch (e) { /* ignore audio errors */ }
    }

    // ---------------- Update --------------------------------------
    HOOKS.onUpdate.push((dt) => {
        if (!state.active) return;
        state.t += dt;
        const u = state.t / state.dur;

        // Staggered secondary bursts: a sparkle pop and a confetti spray.
        if (!state.burstedAt2 && state.t >= 0.22) {
            state.burstedAt2 = true;
            FX.spawnSparkles(state.x, state.y, 22, state.accent);
            FX.spawnConfetti(state.x, state.y, 30, {
                spread: 320, lifeMin: 0.8, lifeMax: 1.4, gravity: 220,
            });
        }
        if (!state.burstedAt5 && state.t >= 0.55) {
            state.burstedAt5 = true;
            FX.spawnSparkles(state.x, state.y, 18, '#ffffff');
        }

        if (u >= 1) state.active = false;
    });

    // ---------------- Render (HUD = no shake) ---------------------
    HOOKS.onDrawHUD.push((ctx) => {
        if (!state.active) return;
        const sz = canvasSize();
        const W = sz.W, H = sz.H;
        const t = state.t;
        const dur = state.dur;
        const u = clamp(t / dur, 0, 1);
        // Master fade-out tail in the last 25%.
        const tail = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;

        ctx.save();

        // ---- Vignette: inner radius shrinks then expands. ----
        const focusMin = 110, focusMax = Math.max(W, H) * 0.55;
        // shrink from max -> min during 0..0.45, hold 0.45..0.65, expand back.
        let focusR;
        if (u < 0.45) focusR = lerp(focusMax, focusMin, u / 0.45);
        else if (u < 0.65) focusR = focusMin + Math.sin((u - 0.45) / 0.2 * Math.PI) * 8;
        else focusR = lerp(focusMin, focusMax * 1.1, (u - 0.65) / 0.35);
        const vAlpha = 0.78 * tail;
        const grd = ctx.createRadialGradient(state.x, state.y, focusR * 0.25, state.x, state.y, focusR);
        grd.addColorStop(0, 'rgba(0,0,0,0)');
        grd.addColorStop(0.85, `rgba(8,4,18,${vAlpha * 0.55})`);
        grd.addColorStop(1, `rgba(2,1,6,${vAlpha})`);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);

        // ---- Concentric expanding rings (5) + 1 contracting. ----
        const ringRotate = t * 0.6;
        for (let i = 0; i < 5; i++) {
            const phase = clamp(u * 1.4 - i * 0.08, 0, 1);
            if (phase <= 0) continue;
            const r = lerp(20, 460, phase);
            const a = (1 - phase) * 0.85 * tail;
            ctx.globalAlpha = a;
            ctx.lineWidth = lerp(6, 1.5, phase);
            ctx.strokeStyle = i % 2 === 0 ? state.accent : '#ffffff';
            ctx.beginPath();
            ctx.arc(state.x, state.y, r, ringRotate + i, ringRotate + i + TAU - 0.001);
            ctx.stroke();
        }
        // Contracting ring: 0..0.6 of duration, 320 -> 30
        if (u < 0.62) {
            const cu = u / 0.62;
            const r = lerp(360, 24, cu);
            ctx.globalAlpha = (1 - cu) * 0.95 * tail;
            ctx.lineWidth = lerp(2, 8, cu);
            ctx.strokeStyle = state.accent;
            ctx.beginPath();
            ctx.arc(state.x, state.y, r, 0, TAU);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // ---- Speed lines radiating from cat. ----
        const lineFade = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
        if (lineFade > 0) {
            ctx.globalAlpha = 0.85 * lineFade * tail;
            ctx.strokeStyle = '#ffffff';
            for (const ray of state.rays) {
                ctx.lineWidth = ray.w;
                const r0 = ray.r0 + u * 90;
                const r1 = ray.r1 + u * 220;
                ctx.beginPath();
                ctx.moveTo(state.x + Math.cos(ray.ang) * r0, state.y + Math.sin(ray.ang) * r0);
                ctx.lineTo(state.x + Math.cos(ray.ang) * r1, state.y + Math.sin(ray.ang) * r1);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        // ---- Big stylized title text. ----
        // bounce-in scale: 0..0.22 grow past 1, settle to 1 by 0.35; hold; fade in tail.
        let scale;
        if (u < 0.22) scale = lerp(0.2, 1.18, u / 0.22);
        else if (u < 0.35) scale = lerp(1.18, 1.0, (u - 0.22) / 0.13);
        else scale = 1.0;
        const textAlpha = u < 0.1 ? u / 0.1 : tail;
        const tx = W / 2, ty = H * 0.42;
        ctx.translate(tx, ty);
        ctx.scale(scale, scale);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 78px system-ui, -apple-system, sans-serif';
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        // Drop shadow.
        ctx.globalAlpha = 0.55 * textAlpha;
        ctx.fillStyle = '#000';
        ctx.fillText(state.title, 4, 6);
        // Outline (accent-colored stroke).
        ctx.globalAlpha = textAlpha;
        ctx.lineWidth = 10;
        ctx.strokeStyle = state.accent;
        ctx.strokeText(state.title, 0, 0);
        // Inner white fill.
        ctx.fillStyle = '#ffffff';
        ctx.fillText(state.title, 0, 0);
        // Subtitle below.
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.globalAlpha = 0.85 * textAlpha;
        ctx.fillStyle = state.accent;
        const sub = state.kind === 'boss' ? '★  PERFECT CAPTURE  ★' : '★  LEVEL CLEAR  ★';
        ctx.fillText(sub, 0, 60);

        ctx.restore();
    });

    // Local lerp (kept defensive in case helper missing).
    function lerp(a, b, t) { return a + (b - a) * t; }
})();
