// ============================================================
// weather.js — Per-scene atmospheric/weather particles
// Plugs into the window.MTCD hook API; never touches game.js.
// ============================================================
(() => {
    'use strict';

    // Defensive: wait for the hook API. Script tag goes after game.js,
    // so MTCD should already exist — but bail safely otherwise.
    const MTCD = window.MTCD;
    if (!MTCD || !MTCD.HOOKS || !MTCD.G) {
        console.warn('[weather] window.MTCD not available; weather disabled.');
        return;
    }

    const { G, HOOKS, canvasSize, rand, randInt, choice, clamp, TAU } = MTCD;

    // ------------------------------------------------------------------
    // Tunables
    // ------------------------------------------------------------------
    const COUNTS = {
        livingRoom: { dust: 38, embers: 10 },
        garden:     { leaves: 22, pollen: 26 },
        kitchen:    { steam: 16, motes: 28 },
        bedroom:    { zzz: 14, stars: 28 },
        attic:      { dust: 44, web: 6 },
        arena:      { sparks: 26, tremor: 18 },
    };

    // ------------------------------------------------------------------
    // Particle storage
    // ------------------------------------------------------------------
    let particles = [];           // active particle list
    let currentScene = null;      // scene we're currently configured for
    let timer = 0;                // accumulator for periodic emitters

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    function size() {
        // canvasSize() may return zero before first resize; fall back gracefully.
        const s = canvasSize();
        return { W: s.W || window.innerWidth || 800, H: s.H || window.innerHeight || 600 };
    }

    function wrapX(p, W, pad = 20) {
        if (p.x < -pad) p.x = W + pad;
        else if (p.x > W + pad) p.x = -pad;
    }

    // ------------------------------------------------------------------
    // Per-scene spawn factories
    // ------------------------------------------------------------------
    function spawnDustMote(W, H, opts = {}) {
        return {
            kind: 'dust',
            x: rand(0, W),
            y: rand(0, H),
            vx: rand(-6, 6),
            vy: rand(-14, -4),                    // drift upward
            r: rand(0.8, 2.2),
            a: rand(0.18, 0.42),
            tw: rand(0, TAU),                     // twinkle phase
            twSpd: rand(0.6, 1.6),
            color: opts.color || '255, 220, 160', // warm
            big: !!opts.big,
        };
    }

    function spawnEmber(W, H) {
        return {
            kind: 'ember',
            x: rand(W * 0.05, W * 0.95),
            y: H + rand(0, 30),
            vx: rand(-10, 10),
            vy: rand(-50, -28),                   // rises
            r: rand(1.2, 2.4),
            life: rand(2.4, 4.5),
            age: 0,
            wob: rand(0, TAU),
            wobSpd: rand(1.4, 2.6),
        };
    }

    function spawnLeaf(W, H, atTop = false) {
        const tilt = rand(-0.3, 0.3);
        return {
            kind: 'leaf',
            x: rand(0, W),
            y: atTop ? rand(-40, -10) : rand(-H * 0.2, H),
            vx: rand(-8, 8),
            vy: rand(18, 36),                     // falls
            ang: rand(0, TAU),
            angVel: rand(-1.2, 1.2),
            sway: rand(0, TAU),
            swaySpd: rand(0.8, 1.6),
            swayAmp: rand(10, 26),
            len: rand(7, 12),
            color: choice(['#e8a13a', '#d96a2c', '#c5b03a', '#7fa83a', '#a8c95a']),
            tiltBase: tilt,
        };
    }

    function spawnPollen(W, H) {
        return {
            kind: 'pollen',
            x: rand(0, W),
            y: rand(0, H),
            vx: rand(-12, 12),
            vy: rand(-6, 8),
            r: rand(1.0, 2.0),
            a: rand(0.25, 0.55),
            tw: rand(0, TAU),
            twSpd: rand(1.0, 2.4),
            color: choice(['255, 230, 130', '255, 200, 220', '255, 240, 180']),
        };
    }

    function spawnSteam(W, H, atSource = false) {
        // Pot is hidden near bottom-left.
        const px = W * 0.12 + rand(-10, 10);
        const py = H * 0.86 + rand(-6, 6);
        return {
            kind: 'steam',
            x: atSource ? px : rand(0, W * 0.5),
            y: atSource ? py : rand(H * 0.3, H * 0.86),
            vx: rand(-4, 8),
            vy: rand(-22, -12),
            r: rand(10, 22),
            life: rand(3.5, 6.0),
            age: atSource ? 0 : rand(0, 2.0),
            wob: rand(0, TAU),
            wobSpd: rand(0.4, 1.0),
        };
    }

    function spawnMoonMote(W, H) {
        return {
            kind: 'moonmote',
            x: rand(0, W),
            y: rand(0, H * 0.85),
            vx: rand(-4, 4),
            vy: rand(-6, 0),
            r: rand(0.6, 1.6),
            a: rand(0.2, 0.5),
            tw: rand(0, TAU),
            twSpd: rand(1.2, 2.6),
        };
    }

    function spawnZ(W, H, atRest = false) {
        return {
            kind: 'zzz',
            x: rand(W * 0.15, W * 0.85),
            y: atRest ? rand(0, H) : rand(H * 0.5, H),
            vx: rand(8, 22),                      // up-right drift
            vy: rand(-26, -14),
            life: rand(3.0, 5.5),
            age: atRest ? rand(0, 2.0) : 0,
            size: rand(14, 26),
            wob: rand(0, TAU),
            wobSpd: rand(0.8, 1.6),
        };
    }

    function spawnStarShine(W, H) {
        return {
            kind: 'star',
            x: rand(0, W),
            y: rand(0, H * 0.7),
            r: rand(0.6, 1.4),
            a: rand(0.25, 0.55),
            tw: rand(0, TAU),
            twSpd: rand(1.0, 2.2),
        };
    }

    function spawnAtticDust(W, H) {
        // Heavy dust lit by sunbeams — more visible than living-room dust.
        return {
            kind: 'atticdust',
            x: rand(0, W),
            y: rand(0, H),
            vx: rand(-4, 6),
            vy: rand(-10, 4),                     // mostly slow drift
            r: rand(1.0, 2.6),
            a: rand(0.18, 0.5),
            tw: rand(0, TAU),
            twSpd: rand(0.5, 1.2),
        };
    }

    function spawnCobwebGlint(W, H) {
        return {
            kind: 'cobweb',
            x: rand(W * 0.05, W * 0.95),
            y: rand(0, H * 0.6),
            vx: rand(-2, 2),
            vy: rand(8, 16),                      // slow fall
            len: rand(14, 26),
            a: rand(0.18, 0.4),
            tw: rand(0, TAU),
            twSpd: rand(0.6, 1.4),
        };
    }

    function spawnArenaSpark(W, H) {
        return {
            kind: 'arenaspark',
            x: rand(0, W),
            y: rand(H * 0.15, H * 0.9),
            vx: rand(-30, 30),
            vy: rand(-30, 30),
            life: rand(0.6, 1.5),
            age: 0,
            r: rand(1.0, 2.2),
        };
    }

    function spawnTremor(W, H) {
        return {
            kind: 'tremor',
            x: rand(W * 0.05, W * 0.95),
            y: H - rand(0, 10),
            vx: rand(-12, 12),
            vy: rand(-90, -50),                   // bounce up
            life: rand(0.7, 1.4),
            age: 0,
            r: rand(1.4, 3.0),
            g: 320,                               // gravity
        };
    }

    // ------------------------------------------------------------------
    // Scene reset — populate full particle set for the active scene
    // ------------------------------------------------------------------
    function resetForScene(scene) {
        currentScene = scene;
        particles = [];
        const { W, H } = size();

        const cfg = COUNTS[scene];
        if (!cfg) return; // unknown scene — leave empty

        if (scene === 'livingRoom') {
            for (let i = 0; i < cfg.dust; i++) particles.push(spawnDustMote(W, H));
            for (let i = 0; i < cfg.embers; i++) {
                const p = spawnEmber(W, H);
                p.age = rand(0, p.life);          // pre-age so they're staggered
                p.y = rand(H * 0.4, H);
                particles.push(p);
            }
        } else if (scene === 'garden') {
            for (let i = 0; i < cfg.leaves; i++) particles.push(spawnLeaf(W, H));
            for (let i = 0; i < cfg.pollen; i++) particles.push(spawnPollen(W, H));
        } else if (scene === 'kitchen') {
            for (let i = 0; i < cfg.steam; i++) particles.push(spawnSteam(W, H));
            for (let i = 0; i < cfg.motes; i++) particles.push(spawnMoonMote(W, H));
        } else if (scene === 'bedroom') {
            for (let i = 0; i < cfg.zzz; i++) particles.push(spawnZ(W, H, true));
            for (let i = 0; i < cfg.stars; i++) particles.push(spawnStarShine(W, H));
        } else if (scene === 'attic') {
            for (let i = 0; i < cfg.dust; i++) particles.push(spawnAtticDust(W, H));
            for (let i = 0; i < cfg.web; i++) particles.push(spawnCobwebGlint(W, H));
        } else if (scene === 'arena') {
            for (let i = 0; i < cfg.sparks; i++) {
                const p = spawnArenaSpark(W, H);
                p.age = rand(0, p.life);
                particles.push(p);
            }
            for (let i = 0; i < cfg.tremor; i++) {
                const p = spawnTremor(W, H);
                p.age = rand(0, p.life);
                particles.push(p);
            }
        }
    }

    // ------------------------------------------------------------------
    // Update loop
    // ------------------------------------------------------------------
    function update(dt) {
        // Detect scene changes outside of onLevelStart (e.g. menu transitions).
        if (G.scene !== currentScene) {
            resetForScene(G.scene);
        }

        // Pause atmospherics during the level-complete celebration so confetti reads cleanly.
        if (G.stage === 'levelComplete') return;

        const { W, H } = size();
        timer += dt;

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];

            switch (p.kind) {
                // ---------- Living room ----------
                case 'dust': {
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.tw += p.twSpd * dt;
                    wrapX(p, W);
                    if (p.y < -8) {
                        p.y = H + 8;
                        p.x = rand(0, W);
                    }
                    break;
                }
                case 'ember': {
                    p.age += dt;
                    p.wob += p.wobSpd * dt;
                    p.x += (p.vx + Math.sin(p.wob) * 12) * dt;
                    p.y += p.vy * dt;
                    p.vy += -8 * dt;             // accelerate upward (buoyant)
                    if (p.age >= p.life || p.y < -10) {
                        particles[i] = spawnEmber(W, H);
                    }
                    break;
                }

                // ---------- Garden ----------
                case 'leaf': {
                    p.sway += p.swaySpd * dt;
                    p.x += (p.vx + Math.cos(p.sway) * p.swayAmp * 0.06) * dt;
                    p.y += p.vy * dt;
                    p.ang += p.angVel * dt;
                    if (p.y > H + 20) {
                        Object.assign(p, spawnLeaf(W, H, true));
                    }
                    wrapX(p, W);
                    break;
                }
                case 'pollen': {
                    p.tw += p.twSpd * dt;
                    p.x += (p.vx + Math.sin(p.tw) * 6) * dt;
                    p.y += (p.vy + Math.cos(p.tw * 0.7) * 4) * dt;
                    wrapX(p, W);
                    if (p.y < -10) p.y = H + 10;
                    else if (p.y > H + 10) p.y = -10;
                    break;
                }

                // ---------- Kitchen ----------
                case 'steam': {
                    p.age += dt;
                    p.wob += p.wobSpd * dt;
                    p.x += (p.vx + Math.sin(p.wob) * 10) * dt;
                    p.y += p.vy * dt;
                    p.r += 6 * dt;                // expand
                    if (p.age >= p.life || p.y < -40) {
                        particles[i] = spawnSteam(W, H, true);
                    }
                    break;
                }
                case 'moonmote': {
                    p.tw += p.twSpd * dt;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    wrapX(p, W);
                    if (p.y < -6) p.y = H + 6;
                    else if (p.y > H + 6) p.y = -6;
                    break;
                }

                // ---------- Bedroom ----------
                case 'zzz': {
                    p.age += dt;
                    p.wob += p.wobSpd * dt;
                    p.x += (p.vx + Math.sin(p.wob) * 8) * dt;
                    p.y += p.vy * dt;
                    if (p.age >= p.life || p.y < -30) {
                        particles[i] = spawnZ(W, H, false);
                    }
                    break;
                }
                case 'star': {
                    p.tw += p.twSpd * dt;
                    // stationary twinkle — re-roll occasionally
                    break;
                }

                // ---------- Attic ----------
                case 'atticdust': {
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.tw += p.twSpd * dt;
                    wrapX(p, W);
                    if (p.y < -8) p.y = H + 8;
                    else if (p.y > H + 8) p.y = -8;
                    break;
                }
                case 'cobweb': {
                    p.tw += p.twSpd * dt;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    if (p.y > H + 20) {
                        Object.assign(p, spawnCobwebGlint(W, H));
                        p.y = -20;
                    }
                    wrapX(p, W);
                    break;
                }

                // ---------- Arena ----------
                case 'arenaspark': {
                    p.age += dt;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.vx *= Math.pow(0.6, dt);    // crackle dampening
                    p.vy *= Math.pow(0.6, dt);
                    if (p.age >= p.life) {
                        particles[i] = spawnArenaSpark(W, H);
                    }
                    break;
                }
                case 'tremor': {
                    p.age += dt;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.vy += p.g * dt;
                    if (p.age >= p.life || p.y > H + 20) {
                        particles[i] = spawnTremor(W, H);
                    }
                    break;
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Draw — runs in shaken world space, behind cats
    // ------------------------------------------------------------------
    function draw(c) {
        if (!particles.length) return;
        const { W, H } = size();

        c.save();

        for (const p of particles) {
            switch (p.kind) {
                case 'dust': {
                    const tw = 0.65 + 0.35 * Math.sin(p.tw);
                    c.globalCompositeOperation = 'lighter';
                    c.fillStyle = `rgba(${p.color}, ${p.a * tw})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r, 0, TAU);
                    c.fill();
                    break;
                }
                case 'ember': {
                    const t = p.age / p.life;
                    const a = (1 - t) * 0.85;
                    c.globalCompositeOperation = 'lighter';
                    // Hot core fades from yellow to deep orange to red.
                    const r = 255;
                    const g = Math.floor(180 * (1 - t * 0.7));
                    const b = Math.floor(60 * (1 - t));
                    c.fillStyle = `rgba(${r},${g},${b},${a})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r * (1 + t * 0.4), 0, TAU);
                    c.fill();
                    // soft halo
                    c.fillStyle = `rgba(255,140,40,${a * 0.25})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r * 3.5, 0, TAU);
                    c.fill();
                    break;
                }

                case 'leaf': {
                    c.save();
                    c.translate(p.x, p.y);
                    // tilt by velocity direction so they "lean" as they fall/sway
                    const dirAng = Math.atan2(p.vy, p.vx + Math.cos(p.sway) * p.swayAmp * 0.06);
                    c.rotate(dirAng + p.tiltBase + p.ang * 0.15);
                    c.globalAlpha = 0.85;
                    c.fillStyle = p.color;
                    c.beginPath();
                    c.ellipse(0, 0, p.len, p.len * 0.5, 0, 0, TAU);
                    c.fill();
                    // stem
                    c.strokeStyle = 'rgba(60,40,20,0.6)';
                    c.lineWidth = 1;
                    c.beginPath();
                    c.moveTo(-p.len, 0);
                    c.lineTo(p.len, 0);
                    c.stroke();
                    c.restore();
                    break;
                }
                case 'pollen': {
                    const tw = 0.6 + 0.4 * Math.sin(p.tw);
                    c.globalCompositeOperation = 'lighter';
                    c.fillStyle = `rgba(${p.color}, ${p.a * tw})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r, 0, TAU);
                    c.fill();
                    break;
                }

                case 'steam': {
                    const t = p.age / p.life;
                    // Fade in then out.
                    const a = Math.sin(Math.PI * clamp(t, 0, 1)) * 0.32;
                    c.globalCompositeOperation = 'source-over';
                    c.fillStyle = `rgba(220, 230, 240, ${a})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r, 0, TAU);
                    c.fill();
                    break;
                }
                case 'moonmote': {
                    const tw = 0.55 + 0.45 * Math.sin(p.tw);
                    c.globalCompositeOperation = 'lighter';
                    c.fillStyle = `rgba(200, 230, 255, ${p.a * tw})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r, 0, TAU);
                    c.fill();
                    break;
                }

                case 'zzz': {
                    const t = p.age / p.life;
                    // fade in fast, fade out slow
                    const a = (t < 0.15 ? t / 0.15 : (1 - t) / 0.85) * 0.7;
                    c.globalCompositeOperation = 'source-over';
                    c.save();
                    c.translate(p.x, p.y);
                    c.rotate(Math.sin(p.wob) * 0.2);
                    c.fillStyle = `rgba(200, 180, 255, ${clamp(a, 0, 1)})`;
                    c.font = `bold ${p.size}px sans-serif`;
                    c.textAlign = 'center';
                    c.textBaseline = 'middle';
                    c.fillText('z', 0, 0);
                    c.restore();
                    break;
                }
                case 'star': {
                    const tw = 0.4 + 0.6 * Math.sin(p.tw);
                    c.globalCompositeOperation = 'lighter';
                    c.fillStyle = `rgba(255, 240, 220, ${p.a * tw})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r, 0, TAU);
                    c.fill();
                    // tiny cross sparkle on bright frames
                    if (tw > 0.85) {
                        c.strokeStyle = `rgba(255,240,220,${p.a * 0.5})`;
                        c.lineWidth = 0.6;
                        c.beginPath();
                        c.moveTo(p.x - p.r * 3, p.y);
                        c.lineTo(p.x + p.r * 3, p.y);
                        c.moveTo(p.x, p.y - p.r * 3);
                        c.lineTo(p.x, p.y + p.r * 3);
                        c.stroke();
                    }
                    break;
                }

                case 'atticdust': {
                    const tw = 0.6 + 0.4 * Math.sin(p.tw);
                    c.globalCompositeOperation = 'lighter';
                    c.fillStyle = `rgba(255, 210, 140, ${p.a * tw})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r, 0, TAU);
                    c.fill();
                    break;
                }
                case 'cobweb': {
                    const tw = 0.55 + 0.45 * Math.sin(p.tw);
                    c.globalCompositeOperation = 'lighter';
                    c.strokeStyle = `rgba(220, 230, 255, ${p.a * tw})`;
                    c.lineWidth = 1;
                    c.beginPath();
                    c.moveTo(p.x - p.len * 0.5, p.y);
                    c.lineTo(p.x + p.len * 0.5, p.y + 2);
                    c.stroke();
                    // glint dot
                    c.fillStyle = `rgba(255,255,255,${p.a * tw * 0.9})`;
                    c.beginPath();
                    c.arc(p.x, p.y + 1, 1.2, 0, TAU);
                    c.fill();
                    break;
                }

                case 'arenaspark': {
                    const t = p.age / p.life;
                    const a = (1 - t) * 0.9;
                    c.globalCompositeOperation = 'lighter';
                    c.fillStyle = `rgba(255, 60, 90, ${a})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r, 0, TAU);
                    c.fill();
                    // jagged crackle line
                    c.strokeStyle = `rgba(255, 120, 140, ${a * 0.7})`;
                    c.lineWidth = 1;
                    c.beginPath();
                    c.moveTo(p.x - 4, p.y);
                    c.lineTo(p.x - 1, p.y - 2);
                    c.lineTo(p.x + 2, p.y + 1);
                    c.lineTo(p.x + 5, p.y - 1);
                    c.stroke();
                    break;
                }
                case 'tremor': {
                    const t = p.age / p.life;
                    const a = (1 - t) * 0.7;
                    c.globalCompositeOperation = 'source-over';
                    c.fillStyle = `rgba(120, 90, 70, ${a})`;
                    c.beginPath();
                    c.arc(p.x, p.y, p.r, 0, TAU);
                    c.fill();
                    break;
                }
            }
        }

        c.restore();
    }

    // ------------------------------------------------------------------
    // Hook registration
    // ------------------------------------------------------------------
    HOOKS.onLevelStart.push(() => {
        // G.scene has already been updated by the time this fires.
        resetForScene(G.scene);
    });
    HOOKS.onUpdate.push((dt) => update(dt));
    HOOKS.onDraw.push((c) => draw(c));

    // Initial seed (in case we never see an onLevelStart, e.g. on menu boot).
    resetForScene(G.scene);

})();
