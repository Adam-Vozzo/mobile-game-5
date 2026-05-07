// ============================================================================
// easter-eggs.js  -  "Make the Cat Dizzy!" tiny surprise moments
// ----------------------------------------------------------------------------
// Self-contained module. Adds 5 subtle delighters via the window.MTCD hook
// API. Does not modify game state in ways that would conflict with other
// modules. Exposes a small debug surface on window.MTCD.eggs.
// ============================================================================
(function () {
    'use strict';

    if (!window.MTCD || !window.MTCD.HOOKS) {
        console.warn('[easter-eggs] window.MTCD not available; module disabled.');
        return;
    }

    const MTCD = window.MTCD;
    const { HOOKS, FX } = MTCD;
    const G = MTCD.G;
    const { rand, dist, TAU } = MTCD;

    const FIRST_LOOP_KEY = 'mtcd_first_loop_done';

    // ---------- Shared state ----------
    const state = {
        meowMode: false,                     // toggled by Konami
        // Lazy cat: track laser stillness while drawing.
        laserStillT: 0,
        lastLx: 0,
        lastLy: 0,
        zSpawnCooldown: 0,                   // throttle Z spawns to once per stillness
        // Combo endurance accumulation
        comboHeldT: 0,
        enduranceShown: false,
        // Triple-click ring buffer
        clicks: [],                          // {x, y, t}
        // Floating ghosts for the ghost-cat egg
        ghosts: [],                          // {x, y, age, life}
    };

    function audioSafe() {
        try { return MTCD.audio && MTCD.audio(); } catch (e) { return null; }
    }

    function playSafe(name, ...args) {
        const A = audioSafe();
        if (!A || !A.SFX || typeof A.SFX[name] !== 'function') return;
        try { A.SFX[name](...args); } catch (e) { /* ignore */ }
    }

    // ===== Egg 1: Lazy Cat (sleepy Z drifts up from the closest cat) =====
    // Trigger: laser held still (within 8 px) for ~6 seconds while drawing.
    HOOKS.onUpdate.push((dt) => {
        if (G.stage !== 'playing') {
            state.laserStillT = 0;
            state.zSpawnCooldown = Math.max(0, state.zSpawnCooldown - dt);
            return;
        }
        const lx = G.laser.x, ly = G.laser.y;
        if (G.laser.active && G.laser.drawing) {
            if (Math.hypot(lx - state.lastLx, ly - state.lastLy) < 8) {
                state.laserStillT += dt;
            } else {
                state.laserStillT = 0;
            }
        } else {
            state.laserStillT = 0;
        }
        state.lastLx = lx; state.lastLy = ly;
        state.zSpawnCooldown = Math.max(0, state.zSpawnCooldown - dt);

        if (state.laserStillT > 6 && state.zSpawnCooldown <= 0) {
            const cat = nearestCat(lx, ly);
            if (cat) {
                FX.floatText(cat.x + 18, cat.y - (cat.size || 20) - 8, 'Z', '#9bb6ff', 22);
                FX.spawnSparkles(cat.x, cat.y - (cat.size || 20), 4, '#9bb6ff');
                playSafe('purr');
                state.zSpawnCooldown = 1.6;
                state.laserStillT = 5; // re-arm for repeat ~every 1-2s while held
            } else {
                state.zSpawnCooldown = 1.0;
            }
        }
    });

    function nearestCat(x, y) {
        let best = null, bestD = Infinity;
        const cats = G.cats || [];
        for (const c of cats) {
            if (!c || c.captured) continue;
            const d = dist(x, y, c.x, c.y);
            if (d < bestD) { bestD = d; best = c; }
        }
        return best;
    }

    // ===== Egg 2: Konami code (UUDDLRLRBA) =====
    // Trigger: keyboard sequence ↑↑↓↓←→←→BA → meow mode.
    const KONAMI = [
        'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
        'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
        'b', 'a',
    ];
    let konamiIdx = 0;

    window.addEventListener('keydown', (e) => {
        const key = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const expected = KONAMI[konamiIdx];
        if (key === expected) {
            konamiIdx++;
            if (konamiIdx === KONAMI.length) {
                konamiIdx = 0;
                triggerMeowMode();
            }
        } else {
            // Allow restart if first key matches
            konamiIdx = (key === KONAMI[0]) ? 1 : 0;
        }
    });

    function triggerMeowMode() {
        const sz = MTCD.canvasSize();
        state.meowMode = true;
        // Rainbow flash sequence
        const colors = ['255,80,120', '255,200,80', '120,220,120', '120,200,255', '180,120,255'];
        colors.forEach((c, i) => setTimeout(() => FX.flash(c, 0.55), i * 90));
        FX.spawnConfetti(sz.W / 2, sz.H / 2, 80, { spread: 420, lifeMin: 1.0, lifeMax: 1.8 });
        FX.shockwave(sz.W / 2, sz.H / 2, 'rgba(255,255,255,0.7)', Math.max(sz.W, sz.H) * 0.7, 0.9);
        FX.floatText(sz.W / 2, sz.H * 0.4, 'MEOW MODE!', '#ff5cd2', 44);
        FX.shake(8, 0.5);
        // Chord + a meow
        const A = audioSafe();
        if (A && A.SFX) {
            try {
                if (A.SFX.capture) A.SFX.capture();
                setTimeout(() => A.SFX.meow && A.SFX.meow(), 220);
            } catch (e) { /* ignore */ }
        }
    }

    // While meow mode is on, every loop spawns a couple of bonus hearts.
    HOOKS.onLoopComplete.push((cat, area, points) => {
        if (!state.meowMode || !cat) return;
        // Spawn pink "heart-ish" sparkles
        FX.spawnSparkles(cat.x, cat.y, 6, '#ff77c8');
        FX.floatText(cat.x + rand(-20, 20), cat.y - 40, '<3', '#ff77c8', 20);
    });

    // ===== Egg 3: Triple click in empty space → ghost cat =====
    // Trigger: 3 clicks within 600 ms within 60 px, no live cat within 80 px.
    function recordClick(x, y) {
        const now = performance.now();
        state.clicks.push({ x, y, t: now });
        // Drop entries older than 600 ms
        while (state.clicks.length && now - state.clicks[0].t > 600) state.clicks.shift();
        if (state.clicks.length >= 3) {
            const a = state.clicks[state.clicks.length - 3];
            const b = state.clicks[state.clicks.length - 2];
            const c = state.clicks[state.clicks.length - 1];
            const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
            const tightX = Math.max(
                Math.abs(a.x - cx), Math.abs(b.x - cx), Math.abs(c.x - cx));
            const tightY = Math.max(
                Math.abs(a.y - cy), Math.abs(b.y - cy), Math.abs(c.y - cy));
            if (tightX < 60 && tightY < 60 && !catNear(cx, cy, 80)) {
                spawnGhostCat(cx, cy);
                state.clicks.length = 0;
            }
        }
    }

    function catNear(x, y, r) {
        const cats = G.cats || [];
        for (const c of cats) {
            if (!c || c.captured) continue;
            if (dist(x, y, c.x, c.y) < r) return true;
        }
        return false;
    }

    function getCanvasPoint(e) {
        const canvas = document.getElementById('game');
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        const cx = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
        const cy = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
        if (cx == null || cy == null) return null;
        const sx = canvas.width / r.width, sy = canvas.height / r.height;
        return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
    }

    document.addEventListener('mousedown', (e) => {
        const p = getCanvasPoint(e);
        if (p) recordClick(p.x, p.y);
    });
    document.addEventListener('touchstart', (e) => {
        const p = getCanvasPoint(e);
        if (p) recordClick(p.x, p.y);
    }, { passive: true });

    function spawnGhostCat(x, y) {
        state.ghosts.push({ x, y, age: 0, life: 2.0 });
        FX.spawnSparkles(x, y, 14, '#bcdcff');
        FX.shockwave(x, y, 'rgba(200,220,255,0.8)', 90, 0.5);
        playSafe('purr');
    }

    HOOKS.onUpdate.push((dt) => {
        for (let i = state.ghosts.length - 1; i >= 0; i--) {
            state.ghosts[i].age += dt;
            if (state.ghosts[i].age >= state.ghosts[i].life) state.ghosts.splice(i, 1);
        }
    });

    HOOKS.onDraw.push((ctx) => {
        if (!state.ghosts.length) return;
        for (const g of state.ghosts) {
            const t = g.age / g.life;
            const alpha = Math.max(0, Math.min(Math.min(1, t * 3),
                1 - Math.max(0, (t - 0.7) / 0.3))) * 0.7;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#e8f0ff';
            ctx.beginPath(); ctx.ellipse(g.x, g.y, 14, 16, 0, 0, TAU); ctx.fill();
            // Ears
            ctx.beginPath();
            ctx.moveTo(g.x - 9, g.y - 12); ctx.lineTo(g.x - 4, g.y - 22); ctx.lineTo(g.x - 1, g.y - 13);
            ctx.moveTo(g.x + 9, g.y - 12); ctx.lineTo(g.x + 4, g.y - 22); ctx.lineTo(g.x + 1, g.y - 13);
            ctx.fill();
            // Eyes
            ctx.fillStyle = '#3a4a8a';
            ctx.beginPath();
            ctx.arc(g.x - 4, g.y - 4, 1.6, 0, TAU);
            ctx.arc(g.x + 4, g.y - 4, 1.6, 0, TAU);
            ctx.fill();
            // Waving paw
            ctx.strokeStyle = '#e8f0ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(g.x + 11, g.y + 2);
            ctx.lineTo(g.x + 11 + Math.cos(g.age * 8) * 8, g.y - 4);
            ctx.stroke();
            ctx.restore();
        }
    });

    // ===== Egg 4: First loop ever (persisted) =====
    // Trigger: first onLoopComplete after a fresh install.
    HOOKS.onLoopComplete.push((cat, area, points) => {
        let done = false;
        try { done = localStorage.getItem(FIRST_LOOP_KEY) === '1'; } catch (e) { done = true; }
        if (done || !cat) return;
        try { localStorage.setItem(FIRST_LOOP_KEY, '1'); } catch (e) { /* ignore */ }
        const sz = MTCD.canvasSize();
        FX.spawnConfetti(sz.W / 2, sz.H * 0.5, 60,
            { spread: 380, lifeMin: 1.0, lifeMax: 1.8 });
        FX.floatText(sz.W / 2, sz.H * 0.32, 'WELCOME, RANGER!', '#ffec5e', 38);
        FX.flash('255,236,180', 0.45);
        FX.shockwave(sz.W / 2, sz.H * 0.5, 'rgba(255,236,128,0.7)',
            Math.max(sz.W, sz.H) * 0.5, 0.8);
        playSafe('capture');
    });

    // ===== Egg 5: Long combo sustain (>0 for 30s cumulative in a level) =====
    HOOKS.onLevelStart.push(() => {
        state.comboHeldT = 0;
        state.enduranceShown = false;
    });

    HOOKS.onUpdate.push((dt) => {
        if (G.stage !== 'playing' || state.enduranceShown) return;
        if ((G.combo | 0) > 0 && (G.comboTimer || 0) > 0) {
            state.comboHeldT += dt;
            if (state.comboHeldT >= 30) {
                state.enduranceShown = true;
                showEndurance();
            }
        }
    });

    function showEndurance() {
        const sz = MTCD.canvasSize();
        FX.floatText(sz.W / 2, sz.H * 0.35, 'ENDURANCE!', '#ffb84d', 40);
        FX.spawnConfetti(sz.W / 2, sz.H * 0.35, 40,
            { color: '#ffb84d', spread: 260 });
        FX.spawnSparkles(sz.W / 2, sz.H * 0.35, 18, '#ffec5e');
        FX.shake(5, 0.3);
        FX.flash('255,184,77', 0.35);
        playSafe('levelComplete');
    }

    // ---------- Debug surface ----------
    MTCD.eggs = {
        meowMode: () => triggerMeowMode(),
        spawnGhost: (x, y) => {
            const sz = MTCD.canvasSize();
            spawnGhostCat(x == null ? sz.W / 2 : x, y == null ? sz.H / 2 : y);
        },
        resetFirstLoop: () => {
            try { localStorage.removeItem(FIRST_LOOP_KEY); } catch (e) { /* ignore */ }
        },
        state,
    };
})();
