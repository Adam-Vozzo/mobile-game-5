(() => {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const overlay = document.getElementById('overlay');
    const overlayCard = document.getElementById('overlay-card');
    const startBtn = document.getElementById('start-btn');
    const meterFill = document.getElementById('meter-fill');
    const loopCountEl = document.getElementById('loop-count');
    const levelEl = document.getElementById('level');
    const timeEl = document.getElementById('time');

    let W = 0, H = 0, DPR = 1;

    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * DPR;
        canvas.height = H * DPR;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    // ---------- Game state ----------
    const state = {
        running: false,
        won: false,
        time: 0,
        level: 1,
        loopCount: 0,
        dizziness: 0,         // 0..1
        target: 1,            // win at this dizziness
        drainRate: 0.04,      // per second
        cat: null,
        laser: { x: W / 2, y: H / 2, vx: 0, vy: 0, active: false, lastMove: 0 },
        trail: [],            // {x, y, t}
        particles: [],
        floats: [],           // floating text ("+1!", etc.)
        background: { stars: [] },
    };

    // Random pretty stars/specks for ambience
    for (let i = 0; i < 60; i++) {
        state.background.stars.push({
            x: Math.random() * 2000,
            y: Math.random() * 2000,
            r: Math.random() * 1.6 + 0.3,
            a: Math.random() * 0.6 + 0.2,
            tw: Math.random() * Math.PI * 2,
        });
    }

    // ---------- Cat ----------
    function createCat() {
        return {
            x: W / 2,
            y: H / 2 + 60,
            vx: 0,
            vy: 0,
            facing: 1,         // 1 = right, -1 = left
            size: Math.min(W, H) * 0.085,
            rotation: 0,
            spinVel: 0,        // angular velocity (radians/s)
            wobble: 0,
            walkPhase: 0,
            mood: 'curious',   // 'curious' | 'chasing' | 'dizzy' | 'kayoed'
            moodTimer: 0,
            wanderTarget: null,
            tailPhase: 0,
        };
    }

    // ---------- Input ----------
    function setLaser(x, y) {
        const now = performance.now();
        const last = state.trail[state.trail.length - 1];
        state.laser.vx = last ? (x - last.x) : 0;
        state.laser.vy = last ? (y - last.y) : 0;
        state.laser.x = x;
        state.laser.y = y;
        state.laser.active = true;
        state.laser.lastMove = now;
        state.trail.push({ x, y, t: now });
        // Bound trail
        const cutoff = now - 2500;
        while (state.trail.length && state.trail[0].t < cutoff) state.trail.shift();
        // Try to detect closed loop
        if (state.running && !state.won) detectLoop();
    }

    function pointerHandler(e) {
        const t = e.touches ? e.touches[0] : e;
        if (!t) return;
        const rect = canvas.getBoundingClientRect();
        setLaser(t.clientX - rect.left, t.clientY - rect.top);
        e.preventDefault();
    }
    canvas.addEventListener('mousemove', pointerHandler);
    canvas.addEventListener('mousedown', pointerHandler);
    canvas.addEventListener('touchstart', pointerHandler, { passive: false });
    canvas.addEventListener('touchmove', pointerHandler, { passive: false });
    canvas.addEventListener('mouseleave', () => { state.laser.active = false; });

    // ---------- Loop detection ----------
    // Look back through the trail, find a recent point near the current one.
    // The polygon between them is the loop. If the cat is inside and the area
    // is big enough, register a loop.
    function detectLoop() {
        const trail = state.trail;
        if (trail.length < 12) return;
        const cur = trail[trail.length - 1];
        const minSeparation = 8; // need to have wandered at least this many points
        const maxLookback = trail.length - minSeparation;

        // Search for the closing point. Prefer the oldest (largest loop).
        let bestIdx = -1;
        let bestDist = Infinity;
        const closeRadius = 36;
        for (let i = 0; i < maxLookback; i++) {
            const p = trail[i];
            const dx = p.x - cur.x;
            const dy = p.y - cur.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < closeRadius * closeRadius) {
                // Pick the earliest match that has enough path length
                bestIdx = i;
                bestDist = d2;
                break;
            }
        }
        if (bestIdx === -1) return;

        const poly = trail.slice(bestIdx);
        if (poly.length < 10) return;

        // Compute signed area (shoelace) - reject tiny loops
        let area2 = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            area2 += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
        }
        const area = Math.abs(area2) * 0.5;
        const cat = state.cat;
        const minArea = cat.size * cat.size * 1.6;
        if (area < minArea) return;

        // Path length sanity check (avoid degenerate jitter loops)
        let len = 0;
        for (let i = 1; i < poly.length; i++) {
            const dx = poly[i].x - poly[i - 1].x;
            const dy = poly[i].y - poly[i - 1].y;
            len += Math.sqrt(dx * dx + dy * dy);
        }
        if (len < cat.size * 4) return;

        if (!pointInPolygon(cat.x, cat.y, poly)) return;

        registerLoop(poly, area);

        // Trim trail so we don't re-trigger immediately on the same path
        state.trail = state.trail.slice(-3);
    }

    function pointInPolygon(x, y, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function registerLoop(poly, area) {
        const cat = state.cat;
        state.loopCount++;
        // Reward scales mildly with loop tightness (smaller loops slightly easier)
        // but we cap to avoid trivial micro-loops paying out big
        const baseGain = 0.12;
        const tightnessBonus = Math.max(0, 1 - area / (cat.size * cat.size * 20)) * 0.06;
        const gain = baseGain + tightnessBonus;
        state.dizziness = Math.min(1, state.dizziness + gain);

        // Direction of the loop -> spin direction
        let signed = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            signed += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
        }
        const dir = signed > 0 ? -1 : 1; // canvas y is flipped
        cat.spinVel += dir * (5 + state.level * 0.5);
        cat.mood = 'dizzy';
        cat.moodTimer = 1.4;

        // Particles around the cat
        for (let i = 0; i < 18; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 80 + Math.random() * 140;
            state.particles.push({
                x: cat.x, y: cat.y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - 40,
                life: 0.8 + Math.random() * 0.4,
                age: 0,
                color: pickConfettiColor(),
                size: 2 + Math.random() * 3,
            });
        }
        state.floats.push({
            x: cat.x, y: cat.y - cat.size - 10,
            text: '+ Dizzy!',
            age: 0, life: 1.0,
        });

        // Win check
        if (state.dizziness >= state.target) winLevel();
    }

    function pickConfettiColor() {
        const c = ['#ffd84d', '#ff6e3b', '#ff3b6e', '#9b6cff', '#6cd2ff', '#4dffb6'];
        return c[(Math.random() * c.length) | 0];
    }

    // ---------- Game flow ----------
    function startGame() {
        state.cat = createCat();
        state.dizziness = 0;
        state.loopCount = 0;
        state.time = 0;
        state.level = 1;
        state.drainRate = 0.04;
        state.trail.length = 0;
        state.particles.length = 0;
        state.floats.length = 0;
        state.running = true;
        state.won = false;
        hideOverlay();
    }

    function winLevel() {
        state.won = true;
        state.running = false;
        // Big celebration
        const cat = state.cat;
        cat.mood = 'kayoed';
        cat.spinVel = 0;
        for (let i = 0; i < 80; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 100 + Math.random() * 260;
            state.particles.push({
                x: cat.x, y: cat.y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - 120,
                life: 1.4 + Math.random() * 0.8,
                age: 0,
                color: pickConfettiColor(),
                size: 2.5 + Math.random() * 4,
                gravity: 320,
            });
        }
        setTimeout(showWinOverlay, 900);
    }

    function nextLevel() {
        state.level++;
        state.dizziness = 0;
        state.loopCount = 0;
        state.trail.length = 0;
        state.drainRate = 0.04 + state.level * 0.02;
        state.cat = createCat();
        state.cat.size = Math.max(28, Math.min(W, H) * 0.085 - state.level * 2);
        state.running = true;
        state.won = false;
        hideOverlay();
    }

    function showWinOverlay() {
        overlayCard.innerHTML = `
            <h1>The cat is dizzy!</h1>
            <p class="result">
                Loops drawn:
                <span class="big">${state.loopCount}</span>
                in ${state.time.toFixed(1)}s on level ${state.level}
            </p>
            <button id="next-btn">Level ${state.level + 1} →</button>
        `;
        overlay.classList.add('show');
        document.getElementById('next-btn').addEventListener('click', nextLevel);
    }

    function hideOverlay() {
        overlay.classList.remove('show');
    }

    startBtn.addEventListener('click', startGame);

    // ---------- Update ----------
    function updateCat(dt) {
        const cat = state.cat;
        if (!cat) return;

        cat.moodTimer -= dt;

        // Spin physics
        cat.rotation += cat.spinVel * dt;
        cat.spinVel *= Math.pow(0.18, dt); // decay

        // Decide mood
        const laser = state.laser;
        const dx = laser.x - cat.x;
        const dy = laser.y - cat.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const interestRange = 360 + state.level * 20;

        if (cat.moodTimer > 0 && cat.mood === 'dizzy') {
            // wobble while dizzy
            cat.wobble = Math.min(1, cat.wobble + dt * 4);
        } else {
            cat.wobble = Math.max(0, cat.wobble - dt * 2);
            if (laser.active && dist < interestRange) {
                cat.mood = 'chasing';
            } else {
                cat.mood = 'curious';
            }
        }

        // Movement
        const baseSpeed = 90 + state.level * 25;
        const dizzyFactor = 1 - state.dizziness * 0.55;
        let ax = 0, ay = 0;
        if (cat.mood === 'chasing' && dist > 4) {
            const k = baseSpeed * dizzyFactor / dist;
            ax = dx * k;
            ay = dy * k;
            cat.facing = dx >= 0 ? 1 : -1;
        } else if (cat.mood === 'curious') {
            // gentle wander
            if (!cat.wanderTarget || Math.hypot(cat.wanderTarget.x - cat.x, cat.wanderTarget.y - cat.y) < 30) {
                cat.wanderTarget = {
                    x: 100 + Math.random() * (W - 200),
                    y: 160 + Math.random() * (H - 260),
                };
            }
            const wdx = cat.wanderTarget.x - cat.x;
            const wdy = cat.wanderTarget.y - cat.y;
            const wd = Math.hypot(wdx, wdy) || 1;
            const wk = baseSpeed * 0.35 * dizzyFactor / wd;
            ax = wdx * wk;
            ay = wdy * wk;
            cat.facing = wdx >= 0 ? 1 : -1;
        } else if (cat.mood === 'dizzy') {
            // staggers a bit
            ax = Math.cos(cat.rotation * 2) * 30 * dizzyFactor;
            ay = Math.sin(cat.rotation * 2) * 30 * dizzyFactor;
        }

        // Smoothed velocity
        cat.vx += (ax - cat.vx) * Math.min(1, dt * 6);
        cat.vy += (ay - cat.vy) * Math.min(1, dt * 6);
        cat.x += cat.vx * dt;
        cat.y += cat.vy * dt;

        // Walls
        const margin = cat.size + 6;
        if (cat.x < margin) { cat.x = margin; cat.vx *= -0.4; }
        if (cat.x > W - margin) { cat.x = W - margin; cat.vx *= -0.4; }
        if (cat.y < margin + 80) { cat.y = margin + 80; cat.vy *= -0.4; }
        if (cat.y > H - margin) { cat.y = H - margin; cat.vy *= -0.4; }

        // Walk animation phase from speed
        const speed = Math.hypot(cat.vx, cat.vy);
        cat.walkPhase += dt * (4 + speed * 0.04);
        cat.tailPhase += dt * 3;
    }

    function updateParticles(dt) {
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i];
            p.age += dt;
            if (p.age >= p.life) { state.particles.splice(i, 1); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            const g = p.gravity || 220;
            p.vy += g * dt;
            p.vx *= Math.pow(0.6, dt);
        }
        for (let i = state.floats.length - 1; i >= 0; i--) {
            const f = state.floats[i];
            f.age += dt;
            f.y -= 30 * dt;
            if (f.age >= f.life) state.floats.splice(i, 1);
        }
    }

    function updateDizziness(dt) {
        if (!state.running) return;
        state.dizziness = Math.max(0, state.dizziness - state.drainRate * dt);
    }

    // ---------- Render ----------
    function drawBackground(t) {
        // Subtle drifting starfield
        ctx.save();
        for (const s of state.background.stars) {
            const x = (s.x + t * 6) % (W + 40) - 20;
            const y = (s.y + t * 3) % (H + 40) - 20;
            const a = s.a * (0.6 + 0.4 * Math.sin(s.tw + t * 1.5));
            ctx.globalAlpha = a;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(x, y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        // Floor circle
        const cx = W / 2, cy = H * 0.7;
        const grd = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(W, H) * 0.7);
        grd.addColorStop(0, 'rgba(255,255,255,0.05)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }

    function drawTrail() {
        const trail = state.trail;
        if (trail.length < 2) return;
        const now = performance.now();
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Glow underlay
        for (let pass = 0; pass < 2; pass++) {
            ctx.beginPath();
            for (let i = 0; i < trail.length; i++) {
                const p = trail[i];
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            if (pass === 0) {
                ctx.strokeStyle = 'rgba(255, 50, 70, 0.18)';
                ctx.lineWidth = 22;
                ctx.shadowBlur = 30;
                ctx.shadowColor = '#ff2244';
            } else {
                ctx.strokeStyle = 'rgba(255, 200, 210, 0.85)';
                ctx.lineWidth = 3;
                ctx.shadowBlur = 0;
            }
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    function drawLaser() {
        const laser = state.laser;
        if (!laser.active) return;
        // Outer glow
        ctx.save();
        const g = ctx.createRadialGradient(laser.x, laser.y, 0, laser.x, laser.y, 40);
        g.addColorStop(0, 'rgba(255, 60, 80, 0.85)');
        g.addColorStop(0.4, 'rgba(255, 30, 60, 0.35)');
        g.addColorStop(1, 'rgba(255, 0, 30, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(laser.x, laser.y, 40, 0, Math.PI * 2);
        ctx.fill();
        // Core
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 16;
        ctx.shadowColor = '#ff2244';
        ctx.beginPath();
        ctx.arc(laser.x, laser.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawCat() {
        const cat = state.cat;
        if (!cat) return;
        ctx.save();
        ctx.translate(cat.x, cat.y);
        // Wobble when dizzy
        const wob = cat.wobble;
        ctx.rotate(cat.rotation + Math.sin(performance.now() * 0.015) * 0.05 * wob);

        const s = cat.size / 50; // base sprite designed at 50px radius
        ctx.scale(s * cat.facing, s);
        drawCatSprite(cat.walkPhase, cat.tailPhase, wob);

        ctx.restore();

        // Dizzy stars circling overhead (in world space, no rotation)
        if (state.dizziness > 0.2 || cat.wobble > 0.1) {
            const n = 3;
            const t = performance.now() * 0.004;
            const radius = cat.size * 0.95;
            ctx.save();
            ctx.translate(cat.x, cat.y - cat.size * 0.9);
            for (let i = 0; i < n; i++) {
                const a = t + (i / n) * Math.PI * 2;
                const sx = Math.cos(a) * radius * 0.7;
                const sy = Math.sin(a) * radius * 0.25;
                drawStar(sx, sy, 6 + Math.sin(t * 2 + i) * 1.5, '#ffd84d');
            }
            ctx.restore();
        }
    }

    function drawCatSprite(walkPhase, tailPhase, wob) {
        // All drawn around (0,0) facing right, ~100px tall
        const bodyColor = '#f6a83d';
        const bodyDark = '#d8852a';
        const belly = '#ffe1b2';
        const ear = '#f6a83d';
        const earInner = '#ff8aa9';

        // Tail (behind body) - sways
        ctx.save();
        ctx.translate(-32, -2);
        const sway = Math.sin(tailPhase) * 0.4 + (wob ? Math.sin(tailPhase * 3) * 0.3 * wob : 0);
        ctx.rotate(sway - 0.4);
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-22, -8, -36, -22);
        ctx.quadraticCurveTo(-30, -10, -22, 4);
        ctx.quadraticCurveTo(-10, 2, 0, 6);
        ctx.closePath();
        ctx.fill();
        // Tail tip
        ctx.fillStyle = bodyDark;
        ctx.beginPath();
        ctx.arc(-34, -22, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Legs - front + back, walk phase
        ctx.fillStyle = bodyColor;
        const legBob = Math.sin(walkPhase) * 3;
        const legBob2 = Math.sin(walkPhase + Math.PI) * 3;
        roundedRect(-20, 18 - Math.max(0, legBob2), 10, 14 + Math.max(0, legBob2), 4);
        roundedRect(-4, 18 - Math.max(0, legBob), 10, 14 + Math.max(0, legBob), 4);
        roundedRect(12, 18 - Math.max(0, legBob2), 10, 14 + Math.max(0, legBob2), 4);

        // Body
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 8, 28, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        // Belly
        ctx.fillStyle = belly;
        ctx.beginPath();
        ctx.ellipse(2, 14, 18, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        // Body stripes
        ctx.fillStyle = bodyDark;
        ctx.globalAlpha = 0.6;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.ellipse(-10 + i * 10, 4, 2, 5, 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Head
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(18, -6, 18, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        // Cheeks
        ctx.fillStyle = belly;
        ctx.beginPath();
        ctx.ellipse(20, 0, 12, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Ears
        ctx.fillStyle = ear;
        ctx.beginPath();
        ctx.moveTo(7, -16);
        ctx.lineTo(12, -28);
        ctx.lineTo(18, -18);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(22, -18);
        ctx.lineTo(28, -28);
        ctx.lineTo(32, -14);
        ctx.closePath();
        ctx.fill();
        // Inner ears
        ctx.fillStyle = earInner;
        ctx.beginPath();
        ctx.moveTo(10, -18);
        ctx.lineTo(13, -25);
        ctx.lineTo(16, -19);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(24, -19);
        ctx.lineTo(28, -25);
        ctx.lineTo(30, -16);
        ctx.closePath();
        ctx.fill();

        // Eyes - if dizzy, swirly; else normal
        const dz = state.dizziness;
        const dazed = dz > 0.5 || wob > 0.3;
        if (dazed) {
            drawSpiralEye(13, -8, 3.5);
            drawSpiralEye(24, -8, 3.5);
        } else {
            // pupils that follow laser
            const lx = state.laser.x - state.cat.x;
            const ly = state.laser.y - state.cat.y;
            const ang = Math.atan2(ly, lx * state.cat.facing);
            const pupilOff = 1.2;
            const px = Math.cos(ang) * pupilOff;
            const py = Math.sin(ang) * pupilOff;
            // sclera
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(13, -8, 3.5, 0, Math.PI * 2);
            ctx.arc(24, -8, 3.5, 0, Math.PI * 2);
            ctx.fill();
            // pupils
            ctx.fillStyle = '#1a0f2e';
            ctx.beginPath();
            ctx.arc(13 + px, -8 + py, 2.2, 0, Math.PI * 2);
            ctx.arc(24 + px, -8 + py, 2.2, 0, Math.PI * 2);
            ctx.fill();
            // glints
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(13.6 + px, -8.7 + py, 0.7, 0, Math.PI * 2);
            ctx.arc(24.6 + px, -8.7 + py, 0.7, 0, Math.PI * 2);
            ctx.fill();
        }

        // Nose
        ctx.fillStyle = '#ff6e3b';
        ctx.beginPath();
        ctx.moveTo(18, -2);
        ctx.lineTo(20, -2);
        ctx.lineTo(19, 0);
        ctx.closePath();
        ctx.fill();
        // Mouth
        ctx.strokeStyle = '#5a2a08';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(19, 0.5);
        ctx.lineTo(19, 2.5);
        ctx.moveTo(19, 2.5);
        ctx.quadraticCurveTo(16, 4.5, 14, 2.5);
        ctx.moveTo(19, 2.5);
        ctx.quadraticCurveTo(22, 4.5, 24, 2.5);
        ctx.stroke();

        // Whiskers
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(15, 1); ctx.lineTo(4, -1);
        ctx.moveTo(15, 2.5); ctx.lineTo(3, 3);
        ctx.moveTo(23, 1); ctx.lineTo(34, -1);
        ctx.moveTo(23, 2.5); ctx.lineTo(34, 3);
        ctx.stroke();
    }

    function drawSpiralEye(cx, cy, r) {
        ctx.save();
        ctx.translate(cx, cy);
        // sclera
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        // spiral
        ctx.strokeStyle = '#1a0f2e';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        const t0 = performance.now() * 0.006;
        for (let a = 0; a < Math.PI * 4; a += 0.2) {
            const rr = (a / (Math.PI * 4)) * r * 0.9;
            const x = Math.cos(a + t0) * rr;
            const y = Math.sin(a + t0) * rr;
            if (a === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    }

    function drawStar(x, y, r, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
            const a2 = a + Math.PI / 5;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
        }
        ctx.closePath();
        ctx.shadowBlur = 8;
        ctx.shadowColor = color;
        ctx.fill();
        ctx.restore();
    }

    function roundedRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
    }

    function drawParticles() {
        for (const p of state.particles) {
            const a = 1 - (p.age / p.life);
            ctx.save();
            ctx.globalAlpha = Math.max(0, a);
            ctx.fillStyle = p.color;
            ctx.shadowBlur = 6;
            ctx.shadowColor = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            ctx.restore();
        }
        for (const f of state.floats) {
            const a = 1 - (f.age / f.life);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle = '#ffd84d';
            ctx.font = 'bold 18px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.shadowBlur = 8;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.fillText(f.text, f.x, f.y);
            ctx.restore();
        }
    }

    // ---------- HUD ----------
    function updateHud() {
        meterFill.style.width = (state.dizziness * 100).toFixed(1) + '%';
        loopCountEl.textContent = 'Loops: ' + state.loopCount;
        levelEl.textContent = 'Level: ' + state.level;
        timeEl.textContent = 'Time: ' + state.time.toFixed(1) + 's';
    }

    // ---------- Main loop ----------
    let lastT = performance.now();
    function frame(now) {
        let dt = (now - lastT) / 1000;
        if (dt > 0.05) dt = 0.05;
        lastT = now;
        const t = now / 1000;

        // Update
        if (state.running) state.time += dt;
        if (state.cat) updateCat(dt);
        updateParticles(dt);
        updateDizziness(dt);

        // Render
        ctx.clearRect(0, 0, W, H);
        drawBackground(t);
        drawTrail();
        drawCat();
        drawParticles();
        drawLaser();
        updateHud();

        requestAnimationFrame(frame);
    }

    // Pre-game: draw a sleeping/waiting cat in the middle so it's not blank
    state.cat = createCat();
    requestAnimationFrame(frame);
})();
