// ============================================================
// yarn.js — Bouncing yarn balls as ambient field elements.
// Plugs into the window.MTCD hook API; never touches game.js.
// ============================================================
(() => {
    'use strict';

    const MTCD = window.MTCD;
    if (!MTCD || !MTCD.HOOKS || !MTCD.G) {
        console.warn('[yarn] window.MTCD not available; yarn balls disabled.');
        return;
    }

    const { G, FX, HOOKS, canvasSize, rand, randInt, choice, clamp, dist, TAU } = MTCD;

    // ---- Tunables ----
    const MAX_BALLS    = 2;
    const RADIUS_RANGE = [12, 18];
    const INIT_SPEED   = 80;        // gentle initial speed (px/s)
    const DAMPEN       = 0.85;      // wall bounce energy loss
    const FRICTION     = 0.985;     // per-second-equivalent friction factor
    const MIN_SPEED    = 18;        // creep speed — yarn never fully stops
    const NUDGE_RADIUS_PAD = 24;    // laser must come within radius + this
    const NUDGE_BASE   = 60;        // baseline kick when laser brushes ball
    const NUDGE_DECAY  = 0.45;      // seconds between nudges per ball
    const ATTRACT_RANGE = 200;      // cats within this distance drift toward yarn
    const COLORS = ['#ff5566', '#5aa9ff', '#5ed27a', '#d65aff'];  // red, blue, green, magenta
    const TRAIL_LEN = 6;

    // ---- Module state ----
    let balls = [];
    // Cached laser previous position so we can derive movement direction
    // even when the engine doesn't expose laser velocity.
    let laserPrev = { x: 0, y: 0, has: false };
    let laserVel  = { x: 0, y: 0 };

    function size() {
        const s = canvasSize();
        return { W: s.W || window.innerWidth || 800, H: s.H || window.innerHeight || 600 };
    }

    function spawnBall(W, H) {
        const r = rand(RADIUS_RANGE[0], RADIUS_RANGE[1]);
        const ang = rand(0, TAU);
        return {
            x: rand(r + 30, W - r - 30),
            y: rand(140, H - r - 60),
            vx: Math.cos(ang) * INIT_SPEED,
            vy: Math.sin(ang) * INIT_SPEED,
            radius: r,
            color: choice(COLORS),
            age: 0,
            spin: rand(-1.6, 1.6),
            rot: rand(0, TAU),
            nudgeCD: 0,
            boost: 0,
            trail: [],
        };
    }

    function resetForLevel() {
        balls = [];
        const { W, H } = size();
        const n = randInt(0, MAX_BALLS); // 0..2 inclusive
        for (let i = 0; i < n; i++) balls.push(spawnBall(W, H));
    }

    // ---- Update ----
    function update(dt) {
        if (G.stage !== 'playing') {
            laserPrev.has = false;   // avoid bogus velocity spike on resume
            return;
        }

        const { W, H } = size();

        // Laser velocity from previous-frame position
        if (G.laser) {
            if (laserPrev.has && dt > 0) {
                laserVel.x = (G.laser.x - laserPrev.x) / dt;
                laserVel.y = (G.laser.y - laserPrev.y) / dt;
            } else { laserVel.x = 0; laserVel.y = 0; }
            laserPrev.x = G.laser.x; laserPrev.y = G.laser.y; laserPrev.has = true;
        }

        const fric = Math.pow(FRICTION, dt * 60);  // dt-independent friction
        const top = 130;                            // keep below HUD

        for (const b of balls) {
            b.age += dt;
            b.nudgeCD = Math.max(0, b.nudgeCD - dt);
            b.boost = Math.max(0, b.boost - dt);

            // Laser proximity nudge — kick along laser movement direction
            if (G.laser && G.laser.active && b.nudgeCD <= 0) {
                const d = dist(G.laser.x, G.laser.y, b.x, b.y);
                if (d < b.radius + NUDGE_RADIUS_PAD) {
                    const lvm = Math.hypot(laserVel.x, laserVel.y);
                    let nx, ny;
                    if (lvm > 30) {
                        nx = laserVel.x / lvm; ny = laserVel.y / lvm;
                    } else {
                        // Laser hovering — push outward from laser
                        const odx = b.x - G.laser.x, ody = b.y - G.laser.y;
                        const od = Math.hypot(odx, ody) || 1;
                        nx = odx / od; ny = ody / od;
                    }
                    const kick = NUDGE_BASE + clamp(lvm * 0.12, 0, 140);
                    b.vx += nx * kick; b.vy += ny * kick;
                    b.spin += rand(-3, 3);
                    b.nudgeCD = NUDGE_DECAY;
                    if (FX && FX.spawnSparkles) FX.spawnSparkles(b.x, b.y, 4, b.color);
                }
            }

            // Integrate + friction
            b.x += b.vx * dt; b.y += b.vy * dt;
            b.rot += b.spin * dt;
            b.vx *= fric; b.vy *= fric;

            // Re-energize occasionally so the ball doesn't park in a corner
            if (Math.hypot(b.vx, b.vy) < MIN_SPEED && Math.random() < 0.4 * dt) {
                const a = rand(0, TAU);
                b.vx += Math.cos(a) * 60; b.vy += Math.sin(a) * 60;
            }

            // Bounce off canvas edges (with dampening + occasional spin shake)
            if (b.x - b.radius < 0)      { b.x = b.radius;      b.vx = Math.abs(b.vx) * DAMPEN;  b.spin += rand(-2, 2); }
            else if (b.x + b.radius > W) { b.x = W - b.radius;  b.vx = -Math.abs(b.vx) * DAMPEN; b.spin += rand(-2, 2); }
            if (b.y - b.radius < top)    { b.y = top + b.radius; b.vy = Math.abs(b.vy) * DAMPEN; b.spin += rand(-2, 2); }
            else if (b.y + b.radius > H) { b.y = H - b.radius;  b.vy = -Math.abs(b.vy) * DAMPEN; b.spin += rand(-2, 2); }

            b.trail.push({ x: b.x, y: b.y });
            if (b.trail.length > TRAIL_LEN) b.trail.shift();

            // Soft cat attraction — only when laser isn't actively drawing
            if (G.cats && (!G.laser || !G.laser.drawing)) {
                for (const cat of G.cats) {
                    if (cat.captured || cat.attackState) continue;
                    const cd = dist(cat.x, cat.y, b.x, b.y);
                    if (cd < ATTRACT_RANGE && cd > 12) {
                        const t = clamp(1 - cd / ATTRACT_RANGE, 0, 1);
                        const blend = 0.04 + t * 0.12;
                        if (!cat.wanderTarget) cat.wanderTarget = { x: b.x, y: b.y };
                        else {
                            cat.wanderTarget.x += (b.x - cat.wanderTarget.x) * blend;
                            cat.wanderTarget.y += (b.y - cat.wanderTarget.y) * blend;
                        }
                    }
                }
            }
        }
    }

    // ---- Draw (in shaken world space) ----
    function draw(c) {
        if (!balls.length) return;
        c.save();
        for (const b of balls) {
            const r = b.radius, rot = b.rot;

            // Motion blur trail
            c.fillStyle = b.color;
            for (let i = 0; i < b.trail.length - 1; i++) {
                const p = b.trail[i];
                c.globalAlpha = (i / b.trail.length) * 0.25;
                c.beginPath(); c.arc(p.x, p.y, r * (0.6 + i * 0.06), 0, TAU); c.fill();
            }
            c.globalAlpha = 1;

            // Shadow (grounds the ball)
            c.fillStyle = 'rgba(0,0,0,0.32)';
            c.beginPath(); c.ellipse(b.x, b.y + r * 0.85, r * 0.85, r * 0.32, 0, 0, TAU); c.fill();

            // Boost glow
            if (b.boost > 0) {
                c.globalCompositeOperation = 'lighter';
                c.globalAlpha = 0.35 * (b.boost / 0.6);
                c.fillStyle = b.color;
                c.beginPath(); c.arc(b.x, b.y, r * 1.7, 0, TAU); c.fill();
                c.globalAlpha = 1;
                c.globalCompositeOperation = 'source-over';
            }

            // Main ball gradient
            const grd = c.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.15, b.x, b.y, r * 1.05);
            grd.addColorStop(0, lighten(b.color, 0.45));
            grd.addColorStop(1, b.color);
            c.fillStyle = grd;
            c.beginPath(); c.arc(b.x, b.y, r, 0, TAU); c.fill();

            // Yarn weave: cross-hatched arcs + loose strand
            c.strokeStyle = darken(b.color, 0.35);
            c.lineWidth = 1.1; c.lineCap = 'round';
            for (let k = 0; k < 3; k++) {
                const off = rot + (k * TAU) / 3;
                c.beginPath(); c.arc(b.x, b.y, r * 0.78, off + 0.1, off + Math.PI - 0.1); c.stroke();
                c.beginPath(); c.arc(b.x, b.y, r * 0.55, off + 0.6, off + Math.PI + 0.4); c.stroke();
            }
            c.beginPath();
            c.moveTo(b.x + Math.cos(rot * 1.7) * r * 0.6, b.y + Math.sin(rot * 1.7) * r * 0.6);
            c.quadraticCurveTo(
                b.x + Math.cos(rot) * r * 1.1, b.y + Math.sin(rot) * r * 1.1,
                b.x + Math.cos(rot + 0.9) * r * 1.3, b.y + Math.sin(rot + 0.9) * r * 1.3
            );
            c.stroke();
        }
        c.restore();
    }

    // ---- Color helpers (cheap hex tweaks for shading) ----
    function hexRgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    function lighten(hex, t) { const [r, g, b] = hexRgb(hex); const m = c => Math.round(c + (255 - c) * t); return `rgb(${m(r)},${m(g)},${m(b)})`; }
    function darken(hex, t)  { const [r, g, b] = hexRgb(hex); const k = 1 - t; return `rgb(${(r * k) | 0},${(g * k) | 0},${(b * k) | 0})`; }

    // ---- Capture bonus near yarn ball ----
    function onCaptureNearYarn(cat) {
        if (!balls.length || !cat) return;
        for (const b of balls) {
            const d = dist(cat.x, cat.y, b.x, b.y);
            if (d < 110) {
                G.score += 50;
                if (FX && FX.floatText) FX.floatText(b.x, b.y - 10, 'Bonus! +50', b.color, 16);
                if (FX && FX.spawnSparkles) FX.spawnSparkles(b.x, b.y, 14, b.color);
                // Excited bounce on the yarn ball
                const a = rand(0, TAU);
                b.vx += Math.cos(a) * 220;
                b.vy += Math.sin(a) * 220;
                b.spin += rand(-6, 6);
                b.boost = 0.6;
                break;
            }
        }
    }

    // ---- Hook registration ----
    HOOKS.onLevelStart.push(() => resetForLevel());
    HOOKS.onUpdate.push((dt) => update(dt));
    HOOKS.onDraw.push((c) => draw(c));
    HOOKS.onCapture.push((cat /*, bonus */) => onCaptureNearYarn(cat));

})();
