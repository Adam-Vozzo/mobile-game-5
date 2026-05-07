// ============================================================
// tutorial.js  --  First-time-player tutorial overlay
// ----------------------------------------------------------------
// On a fresh device (no localStorage.mtcd_tutorial_done): walks the
// player through level 1 with subtle in-canvas nudges (rotating
// arrow, fading hints, rally text). Any keydown skips. Plugs into
// window.MTCD hooks; never touches game.js.
// ============================================================
(function () {
    'use strict';

    const MTCD = window.MTCD;
    if (!MTCD || !MTCD.HOOKS || !MTCD.G || !MTCD.FX) {
        console.warn('[tutorial] window.MTCD not available; module disabled.');
        return;
    }

    const { G, FX, HOOKS, canvasSize, dist, clamp, TAU } = MTCD;

    // ---------------- Constants -----------------------------------
    const STORAGE_KEY     = 'mtcd_tutorial_done';
    const ARROW_RADIUS    = 70;     // px around cat
    const ARROW_SPAN      = Math.PI * 0.9; // arc length (radians)
    const ARROW_THICK     = 7;
    const ARROW_COLOR     = '#ffd84d';
    const PIP_HINT_DUR    = 2.5;
    const RALLY_DUR       = 2.0;
    const TEXT_FONT       = 'bold 18px system-ui, -apple-system, sans-serif';
    const RALLY_FONT      = 'bold 22px system-ui, -apple-system, sans-serif';

    // ---------------- State ---------------------------------------
    /** @type {'idle'|'arrow'|'pip-hint'|'rally'|'done'} */
    let phase = 'idle';
    let target = null;        // current cat to highlight
    let phaseT = 0;           // seconds into current phase (for fades / timeouts)
    let active = false;       // true while tutorial is running this run

    // ---------------- Helpers -------------------------------------
    function isDone() {
        try { return localStorage.getItem(STORAGE_KEY) === '1'; }
        catch (e) { return false; }
    }

    function markDone() {
        try { localStorage.setItem(STORAGE_KEY, '1'); }
        catch (e) { /* ignore */ }
    }

    function liveCats() {
        return Array.isArray(G.cats) ? G.cats.filter(c => c && !c.captured) : [];
    }

    function pickNearestCat() {
        const cats = liveCats();
        if (!cats.length) return null;
        const lx = (G.laser && G.laser.x) || canvasSize().W / 2;
        const ly = (G.laser && G.laser.y) || canvasSize().H / 2;
        let best = cats[0];
        let bestD = dist(lx, ly, best.x, best.y);
        for (let i = 1; i < cats.length; i++) {
            const d = dist(lx, ly, cats[i].x, cats[i].y);
            if (d < bestD) { bestD = d; best = cats[i]; }
        }
        return best;
    }

    function ensureTarget() {
        if (!target || target.captured) target = pickNearestCat();
        return target;
    }

    function setPhase(p) {
        phase = p;
        phaseT = 0;
    }

    function dismiss() {
        active = false;
        setPhase('done');
        target = null;
    }

    function skip() {
        if (active) markDone();
        dismiss();
    }

    function reset() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        dismiss();
    }

    // ---------------- Hook subscriptions --------------------------
    HOOKS.onLevelStart.push((n) => {
        if (n !== 1 || isDone()) { dismiss(); return; }
        active = true;
        target = null; // resolve lazily once cats are placed
        setPhase('arrow');
    });

    HOOKS.onLoopComplete.push((cat) => {
        if (!active) return;
        if (phase === 'arrow') {
            target = cat || ensureTarget();
            setPhase('pip-hint');
        }
    });

    HOOKS.onCapture.push((cat) => {
        if (!active) return;
        // Level cleared? Mark done and tear down.
        if ((G.capturesLeft | 0) <= 0) {
            markDone();
            dismiss();
            return;
        }
        // First capture (still in pip-hint or arrow) -> show rally.
        if (phase === 'pip-hint' || phase === 'arrow') {
            // Switch target to next live cat (if any) for any leftover arrow draws.
            target = pickNearestCat();
            setPhase('rally');
        } else if (phase === 'rally') {
            // Subsequent captures during rally — nudge target along.
            target = pickNearestCat();
        }
    });

    HOOKS.onUpdate.push((dt) => {
        if (!active) return;
        phaseT += dt;
        if (phase === 'pip-hint' && phaseT >= PIP_HINT_DUR) {
            // Pip hint timed out: fall back to circling arrow on a live cat
            // so the player still gets a nudge if they linger between loops.
            setPhase('arrow');
            target = pickNearestCat();
        } else if (phase === 'rally' && phaseT >= RALLY_DUR) {
            setPhase('idle'); // quiet until level-complete event tears down
        }
    });

    // World-space draw (shakes with camera) — arrow + near-cat hints.
    HOOKS.onDraw.push((ctx) => {
        if (!active) return;
        if (phase === 'arrow') drawArrowPhase(ctx);
        else if (phase === 'pip-hint') drawPipHintPhase(ctx);
    });

    // HUD-space draw (steady) — rally banner.
    HOOKS.onDrawHUD.push((ctx) => {
        if (!active) return;
        if (phase === 'rally') drawRallyPhase(ctx);
    });

    // Any key press dismisses. (S is documented; any keydown works.)
    window.addEventListener('keydown', (e) => {
        if (!active) return;
        // Don't intercept modifier-only chord (e.g. devtools).
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        skip();
    }, { passive: true });

    // ---------------- Drawing -------------------------------------
    function drawArrowPhase(ctx) {
        const cat = ensureTarget();
        if (!cat) return;
        const t = performance.now() / 1000;
        // Pulsing alpha: 0.55..1.0 at ~1.6Hz.
        const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * Math.PI * 1.6));
        const startA = (t * 0.9) % TAU;     // slow CCW rotation
        const endA   = startA + ARROW_SPAN;
        const r      = ARROW_RADIUS + Math.sin(t * 3) * 4;

        ctx.save();
        ctx.translate(cat.x, cat.y);
        ctx.globalAlpha = pulse;

        // Glow underlay
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowBlur = 14;
        ctx.shadowColor = ARROW_COLOR;
        ctx.strokeStyle = ARROW_COLOR;
        ctx.lineWidth = ARROW_THICK;

        // Curved arc body
        ctx.beginPath();
        ctx.arc(0, 0, r, startA, endA, false);
        ctx.stroke();

        // Arrowhead at endA
        const hx = Math.cos(endA) * r;
        const hy = Math.sin(endA) * r;
        // Tangent direction (CCW arc -> tangent rotated +90deg)
        const tx = -Math.sin(endA);
        const ty =  Math.cos(endA);
        const head = 14;
        ctx.beginPath();
        ctx.moveTo(hx + tx * head, hy + ty * head);
        ctx.lineTo(hx - tx * head * 0.3 + Math.cos(endA) * head * 0.7,
                   hy - ty * head * 0.3 + Math.sin(endA) * head * 0.7);
        ctx.lineTo(hx - tx * head * 0.3 - Math.cos(endA) * head * 0.7,
                   hy - ty * head * 0.3 - Math.sin(endA) * head * 0.7);
        ctx.closePath();
        ctx.fillStyle = ARROW_COLOR;
        ctx.fill();

        ctx.restore();

        // Caption: "Hold and draw a loop" below the cat.
        const sz = canvasSize();
        const labelY = clamp(cat.y + (cat.size || 30) + ARROW_RADIUS + 24, 40, sz.H - 20);
        drawShadowText(ctx, 'Hold and draw a loop', cat.x, labelY, TEXT_FONT, ARROW_COLOR, pulse);
    }

    function drawPipHintPhase(ctx) {
        const cat = ensureTarget();
        if (!cat) return;
        // Fade-in 0..0.25s, hold, fade-out last 0.6s.
        const a = clamp(phaseT < 0.25 ? phaseT / 0.25
                : (PIP_HINT_DUR - phaseT) / 0.6, 0, 1);
        const sz = canvasSize();
        const sizeR = cat.size || 30;
        const pipY = cat.y - sizeR - 22; // matches drawCatHUD position
        const hintX = clamp(cat.x + 90, 60, sz.W - 60);
        const hintY = clamp(pipY - 8, 30, sz.H - 30);

        drawShadowText(ctx, 'Nice!', cat.x, cat.y - sizeR - 60,
            'bold 24px system-ui, -apple-system, sans-serif', '#ffec5e', a);
        drawShadowText(ctx, 'fill all the pips!', hintX, hintY, TEXT_FONT, '#ffffff', a);

        // Curved arrow from hint -> pip ring.
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#ffd84d';
        ctx.fillStyle = '#ffd84d';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 6; ctx.shadowColor = '#000';
        ctx.beginPath();
        ctx.moveTo(hintX - 50, hintY + 4);
        ctx.quadraticCurveTo((hintX - 50 + cat.x) / 2, hintY - 16, cat.x + 14, pipY + 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cat.x + 14, pipY + 2);
        ctx.lineTo(cat.x + 22, pipY - 4);
        ctx.lineTo(cat.x + 22, pipY + 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawRallyPhase(ctx) {
        const sz = canvasSize();
        const a = clamp(phaseT < 0.2 ? phaseT / 0.2
                : (RALLY_DUR - phaseT) / 0.5, 0, 1);
        drawShadowText(ctx, 'Catch them all!', sz.W / 2, sz.H * 0.82,
            RALLY_FONT, '#ffec5e', a);
    }

    function drawShadowText(ctx, text, x, y, font, color, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Drop shadow
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillText(text, x + 2, y + 2);
        // Outline for legibility on bright backgrounds
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(text, x, y);
        // Body
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    // ---------------- Debug surface -------------------------------
    MTCD.tutorial = {
        reset,
        skip,
        get phase() { return phase; },
        get active() { return active; },
    };

    // Reference unused float helper to keep linter quiet (it's available
    // for future variants that want spawned-and-forget text).
    void FX.floatText;
})();
