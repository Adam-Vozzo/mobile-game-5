// ============================================================
// hotzones.js  --  Bonus "hot zone" multiplier areas
// ----------------------------------------------------------------
// Spawns 1-2 translucent pulsing zones on the field during play.
// If a player closes a loop on a cat whose centre lies inside a
// zone, the zone is consumed and the player earns a bonus
// multiplier on top of the loop points (+ extra confetti and
// a celebratory sting). Self-contained module — plugs into the
// window.MTCD hook API; never touches game.js.
// ============================================================
(function () {
    'use strict';

    // ---------------- Defensive bootstrap -------------------------
    const MTCD = window.MTCD;
    if (!MTCD || !MTCD.HOOKS || !MTCD.G || !MTCD.FX) {
        console.warn('[hotzones] window.MTCD not available; module disabled.');
        return;
    }

    const { G, FX, HOOKS, canvasSize, rand, choice, clamp, TAU } = MTCD;

    // ---------------- Tunables ------------------------------------
    const MAX_ZONES         = 2;     // max concurrent zones in normal play
    const MAX_ZONES_BOSS    = 1;     // fewer during boss waves
    const SPAWN_MIN         = 2.4;   // seconds between spawn attempts (min)
    const SPAWN_MAX         = 4.6;   // seconds between spawn attempts (max)
    const FIRST_SPAWN_DELAY = 1.6;   // wait a beat after level start
    const APPEAR_DUR        = 0.45;  // grow-in
    const FADE_DUR          = 0.9;   // fade-out (last portion of life)
    const RADIUS_MIN        = 70;
    const RADIUS_MAX        = 110;
    const MIN_SEPARATION    = 180;   // keep zones from overlapping much
    const SPAWN_TRIES       = 8;

    // 2x most common, 3x rare, 5x very rare.
    // Cumulative weights for clean sampling.
    const MULT_TABLE = [
        { mult: 2, color: '#7cd6ff', cw: 0.70 },
        { mult: 3, color: '#ff66cc', cw: 0.95 },
        { mult: 5, color: '#ffd84d', cw: 1.00 },
    ];

    function rollMultiplier() {
        const r = Math.random();
        for (const e of MULT_TABLE) if (r <= e.cw) return e;
        return MULT_TABLE[0];
    }

    // ---------------- State ---------------------------------------
    /** @type {Array<{x:number,y:number,radius:number,mult:number,color:string,age:number,life:number,fading:boolean}>} */
    let zones = [];
    let spawnTimer = FIRST_SPAWN_DELAY;

    // ---------------- Helpers -------------------------------------
    function size() {
        const s = canvasSize();
        return {
            W: s.W || window.innerWidth || 800,
            H: s.H || window.innerHeight || 600,
        };
    }

    function isPlaying() {
        return G.stage === 'playing';
    }

    function bossWave() {
        return Array.isArray(G.cats) && G.cats.some(c => c && c.type && c.type.isBoss);
    }

    function maxZonesForWave() {
        return bossWave() ? MAX_ZONES_BOSS : MAX_ZONES;
    }

    function pickSpawnPoint(W, H, radius) {
        // Margins keep zone fully visible. Bias toward lower 2/3 of field
        // (where cats roam) but still leave room near the top.
        for (let i = 0; i < SPAWN_TRIES; i++) {
            const x = rand(W * 0.15, W * 0.85);
            const y = rand(H * 0.30, H * 0.85);
            // Reject if too close to an existing zone.
            let ok = true;
            for (const z of zones) {
                const d = Math.hypot(z.x - x, z.y - y);
                if (d < (z.radius + radius) * 0.6 + MIN_SEPARATION * 0.3) {
                    ok = false; break;
                }
            }
            if (ok) return { x, y };
        }
        return null;
    }

    function spawnZone() {
        const { W, H } = size();
        const radius = rand(RADIUS_MIN, RADIUS_MAX);
        const pt = pickSpawnPoint(W, H, radius);
        if (!pt) return false;

        const m = rollMultiplier();
        const life = rand(6.0, 9.0);
        zones.push({
            x: pt.x,
            y: pt.y,
            radius,
            mult: m.mult,
            color: m.color,
            age: 0,
            life,
            fading: false,
        });

        // Soft puff of sparkles to telegraph the appearance.
        try {
            FX.spawnSparkles(pt.x, pt.y, 14, m.color);
        } catch (e) { /* ignore */ }
        return true;
    }

    // ---------------- Spawn cadence -------------------------------
    function tickSpawn(dt) {
        if (!isPlaying()) return;
        spawnTimer -= dt;
        if (spawnTimer > 0) return;

        if (zones.length < maxZonesForWave()) {
            spawnZone();
        }
        spawnTimer = rand(SPAWN_MIN, SPAWN_MAX);
        // During boss waves, slow the cadence further.
        if (bossWave()) spawnTimer *= 1.6;
    }

    // ---------------- Update --------------------------------------
    function update(dt) {
        tickSpawn(dt);

        // Age zones; cull expired/consumed.
        for (let i = zones.length - 1; i >= 0; i--) {
            const z = zones[i];
            z.age += dt;
            if (z.age >= z.life) zones.splice(i, 1);
        }
    }

    // ---------------- Hit testing ---------------------------------
    function consumedByLoop(cat) {
        if (!cat) return null;
        // Iterate newest-first so a fresh zone wins ties (feels snappier).
        for (let i = zones.length - 1; i >= 0; i--) {
            const z = zones[i];
            // Don't allow zones that are already fading out to be consumed.
            if (z.fading) continue;
            const d = Math.hypot(cat.x - z.x, cat.y - z.y);
            if (d <= z.radius) return { z, idx: i };
        }
        return null;
    }

    // ---------------- Loop completion handler ---------------------
    HOOKS.onLoopComplete.push((cat, area, points) => {
        if (!cat || !isPlaying()) return;
        const hit = consumedByLoop(cat);
        if (!hit) return;
        const { z, idx } = hit;

        // Bonus = (mult - 1) * points  ->  multiplies *total* loop points by mult.
        const basePoints = (typeof points === 'number' && isFinite(points)) ? points : 100;
        const extra = Math.max(1, Math.round(basePoints * (z.mult - 1)));

        // Direct score bump per the task spec.
        try {
            MTCD.G.score += extra;
        } catch (e) { /* ignore */ }

        // Floating text + flash + sting.
        try { FX.floatText(z.x, z.y - 18, `+${extra}  HOT ZONE!`, z.color, 22); } catch (e) {}
        try { FX.floatText(cat.x, cat.y - (cat.size || 28) - 50, `BONUS ×${z.mult}!`, z.color, 18); } catch (e) {}
        try { FX.shockwave(z.x, z.y, z.color, z.radius * 3.0, 0.55); } catch (e) {}
        try { FX.spawnConfetti(z.x, z.y, 30, { color: z.color, spread: 280, lifeMin: 0.9, lifeMax: 1.6, gravity: 240 }); } catch (e) {}
        try { FX.spawnSparkles(z.x, z.y, 22, '#ffffff'); } catch (e) {}
        try { FX.spawnSparkles(z.x, z.y, 14, z.color); } catch (e) {}
        try { FX.shake(4 + z.mult, 0.22); } catch (e) {}
        try { FX.flash(hexToRgbCsv(z.color), 0.15 + z.mult * 0.04); } catch (e) {}

        // Positive sting: a higher-pitched loopClose echo.
        try {
            const a = MTCD.audio && MTCD.audio();
            if (a && a.SFX && a.SFX.loopClose) a.SFX.loopClose(Math.min(8, z.mult + 3));
            if (a && a.SFX && a.SFX.comboUp) a.SFX.comboUp(z.mult * 2);
        } catch (e) { /* audio errors are non-fatal */ }

        // Despawn (consumed) — simply remove from list so it doesn't fade
        // in place; the shockwave + confetti carry the visual punctuation.
        zones.splice(idx, 1);
    });

    // ---------------- Level start: reset --------------------------
    HOOKS.onLevelStart.push(() => {
        zones = [];
        spawnTimer = FIRST_SPAWN_DELAY;
    });

    // ---------------- Update tick ---------------------------------
    HOOKS.onUpdate.push((dt) => {
        if (!isFinite(dt) || dt <= 0) return;
        update(dt);
    });

    // ---------------- Render --------------------------------------
    // onDraw runs BEFORE cats are drawn (game.js renders fireHook('onDraw')
    // and then iterates cats), so zones naturally sit behind the cats.
    HOOKS.onDraw.push((ctx) => {
        if (!zones.length) return;
        if (!isPlaying()) return;

        ctx.save();
        // Additive-ish glow so zones feel luminous over the scene.
        ctx.globalCompositeOperation = 'lighter';

        for (const z of zones) {
            renderZone(ctx, z);
        }

        ctx.restore();
    });

    function renderZone(ctx, z) {
        // Phase envelope:
        //   appear: 0 .. APPEAR_DUR        (scale + alpha grow in)
        //   hold:   APPEAR_DUR .. life-FADE_DUR
        //   fade:   life-FADE_DUR .. life
        const t = z.age;
        const life = z.life;
        let phaseAlpha = 1;
        let phaseScale = 1;
        if (t < APPEAR_DUR) {
            const u = t / APPEAR_DUR;
            phaseScale = 0.4 + 0.6 * u;
            phaseAlpha = u;
        } else if (t > life - FADE_DUR) {
            const u = clamp((life - t) / FADE_DUR, 0, 1);
            phaseAlpha = u;
            phaseScale = 1 + (1 - u) * 0.25;     // gently expand as it fades
            z.fading = true;
        } else {
            z.fading = false;
        }

        // Pulsing animation per spec.
        const pulse = 1 + 0.08 * Math.sin(t * 4);
        const pulseAlpha = 0.85 + 0.15 * Math.sin(t * 4);
        const r = z.radius * pulse * phaseScale;
        const a = phaseAlpha * pulseAlpha;

        const rgb = hexToRgbCsv(z.color);

        // Outer soft halo (radial gradient for inner glow).
        const grd = ctx.createRadialGradient(z.x, z.y, r * 0.05, z.x, z.y, r);
        grd.addColorStop(0,   `rgba(${rgb}, ${0.55 * a})`);
        grd.addColorStop(0.55, `rgba(${rgb}, ${0.22 * a})`);
        grd.addColorStop(1,   `rgba(${rgb}, 0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(z.x, z.y, r, 0, TAU);
        ctx.fill();

        // Translucent fill disk.
        ctx.globalAlpha = 0.18 * a;
        ctx.fillStyle = `rgba(${rgb}, 1)`;
        ctx.beginPath();
        ctx.arc(z.x, z.y, r * 0.85, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Inner ring (bright stroke).
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(${rgb}, ${0.9 * a})`;
        ctx.beginPath();
        ctx.arc(z.x, z.y, r * 0.78, 0, TAU);
        ctx.stroke();

        // Outer dashed ring (rotates slowly for life).
        ctx.save();
        ctx.translate(z.x, z.y);
        ctx.rotate(t * 0.6);
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = `rgba(255,255,255,${0.55 * a})`;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.96, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Center label "x2" / "x3" / "x5".
        // Switch composite back to source-over for crisp text.
        const prevOp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.translate(z.x, z.y);
        const labelScale = pulse;
        ctx.scale(labelScale, labelScale);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        const label = '×' + z.mult; // "×N"
        // Drop shadow.
        ctx.globalAlpha = 0.55 * a;
        ctx.fillStyle = '#000';
        ctx.fillText(label, 2, 3);
        // Outline.
        ctx.globalAlpha = a;
        ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
        ctx.strokeText(label, 0, 0);
        // White inner fill.
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, 0, 0);
        ctx.restore();
        ctx.globalCompositeOperation = prevOp;
    }

    // ---------------- Tiny color helper ---------------------------
    // Convert "#rrggbb" or "#rgb" to "r,g,b" CSV string for rgba() use.
    function hexToRgbCsv(hex) {
        if (typeof hex !== 'string') return '255,255,255';
        let h = hex.trim();
        if (h[0] === '#') h = h.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (h.length !== 6) return '255,255,255';
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        if ([r, g, b].some(n => Number.isNaN(n))) return '255,255,255';
        return `${r},${g},${b}`;
    }

    // Suppress unused-import lint for `choice` (kept for future variants).
    void choice;
})();
