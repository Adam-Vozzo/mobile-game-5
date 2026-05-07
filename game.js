(() => {
'use strict';

// ============================================================
// Make the Cat Dizzy! — Pokémon Ranger style
// ============================================================

// ---------- Canvas / DPR ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
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

// ---------- Global state ----------
const G = {
    stage: 'menu',          // 'menu' | 'playing' | 'levelComplete' | 'gameOver'
    time: 0,
    levelTime: 0,
    level: 1,
    score: 0,
    bestScore: parseInt(localStorage.getItem('mtcd_best') || '0', 10),
    combo: 0,
    comboTimer: 0,
    cats: [],
    capturesLeft: 0,
    laser: {
        x: W / 2, y: H / 2,
        active: false,
        drawing: false,
        energy: 1,
        radius: 5,
    },
    trail: [],              // active trail (only while drawing)
    ghostTrails: [],        // recently-broken trails, fade out
    particles: [],
    floats: [],
    shockwaves: [],
    shakeX: 0, shakeY: 0,
    shakeT: 0,
    shakeAmp: 0,
    flash: 0,
    flashColor: '255,255,255',
    hitstop: 0,
    slowmo: 1,
    bg: { stars: [], dust: [] },
    flow: 0,                // smoothed combo intensity for visual juice
};
window.G = G; // expose for tinkering

// Background ambient
for (let i = 0; i < 70; i++) {
    G.bg.stars.push({
        x: Math.random() * 2000, y: Math.random() * 2000,
        r: Math.random() * 1.6 + 0.3, a: Math.random() * 0.6 + 0.2,
        tw: Math.random() * Math.PI * 2,
    });
}
for (let i = 0; i < 40; i++) {
    G.bg.dust.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        r: Math.random() * 1.2 + 0.3,
        a: Math.random() * 0.3 + 0.05,
    });
}

// ---------- Audio (Web Audio synth) ----------
const Audio = (() => {
    let actx = null;
    let masterGain = null;
    let muted = localStorage.getItem('mtcd_muted') === '1';

    function ensure() {
        if (actx) return;
        actx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = actx.createGain();
        masterGain.gain.value = muted ? 0 : 0.6;
        masterGain.connect(actx.destination);
    }

    function setMuted(m) {
        muted = m;
        localStorage.setItem('mtcd_muted', m ? '1' : '0');
        if (masterGain) masterGain.gain.value = m ? 0 : 0.6;
    }
    function isMuted() { return muted; }

    function envelope(node, t0, attack, decay, sustain, release, peak = 1) {
        const g = node.gain;
        g.cancelScheduledValues(t0);
        g.setValueAtTime(0, t0);
        g.linearRampToValueAtTime(peak, t0 + attack);
        g.linearRampToValueAtTime(sustain * peak, t0 + attack + decay);
        g.linearRampToValueAtTime(0, t0 + attack + decay + release);
    }

    function tone(freq, duration, type = 'sine', volume = 0.3, slide = 0) {
        ensure();
        const t0 = actx.currentTime;
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + duration);
        envelope(gain, t0, 0.005, 0.02, 0.5, duration - 0.025, volume);
        osc.connect(gain).connect(masterGain);
        osc.start(t0);
        osc.stop(t0 + duration + 0.05);
    }

    function noise(duration, volume = 0.2, filterFreq = 1200) {
        ensure();
        const t0 = actx.currentTime;
        const buf = actx.createBuffer(1, actx.sampleRate * duration, actx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
        const src = actx.createBufferSource();
        src.buffer = buf;
        const filter = actx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = filterFreq;
        filter.Q.value = 0.6;
        const gain = actx.createGain();
        envelope(gain, t0, 0.005, 0.05, 0.4, duration, volume);
        src.connect(filter).connect(gain).connect(masterGain);
        src.start(t0);
    }

    function chord(freqs, duration, type = 'triangle', volume = 0.18) {
        for (const f of freqs) tone(f, duration, type, volume / freqs.length * 1.2);
    }

    // SFX library
    const SFX = {
        laserStart() { tone(880, 0.12, 'sawtooth', 0.18, 220); },
        laserEnd() { tone(440, 0.08, 'sawtooth', 0.14, -180); },
        loopClose(combo) {
            const base = 540 + Math.min(combo, 12) * 60;
            tone(base, 0.08, 'triangle', 0.22, 240);
            tone(base * 1.5, 0.08, 'triangle', 0.16, 180);
        },
        capture() {
            chord([523, 659, 784, 1046], 0.5, 'triangle', 0.32);
            setTimeout(() => chord([659, 784, 988, 1318], 0.6, 'triangle', 0.3), 120);
        },
        levelComplete() {
            const seq = [523, 659, 784, 1046, 1318];
            seq.forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.28), i * 90));
        },
        meow() {
            ensure();
            const t0 = actx.currentTime;
            const osc = actx.createOscillator();
            const gain = actx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(420, t0);
            osc.frequency.linearRampToValueAtTime(720, t0 + 0.08);
            osc.frequency.linearRampToValueAtTime(380, t0 + 0.32);
            const filter = actx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 1500;
            envelope(gain, t0, 0.02, 0.1, 0.5, 0.25, 0.18);
            osc.connect(filter).connect(gain).connect(masterGain);
            osc.start(t0);
            osc.stop(t0 + 0.5);
        },
        purr() { noise(0.3, 0.04, 90); },
        hiss() { noise(0.4, 0.18, 4000); },
        lineBreak() {
            tone(220, 0.25, 'sawtooth', 0.3, -180);
            noise(0.18, 0.18, 2400);
        },
        attack() {
            tone(160, 0.16, 'square', 0.22, -60);
            noise(0.1, 0.18, 800);
        },
        comboUp(combo) {
            tone(660 + combo * 30, 0.06, 'square', 0.14);
        },
        click() { tone(900, 0.04, 'square', 0.1); },
    };

    return { ensure, SFX, setMuted, isMuted };
})();

// Resume audio on first interaction (browser autoplay rules)
let audioUnlocked = false;
function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    Audio.ensure();
}

// ---------- Utility ----------
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => (a + Math.random() * (b - a + 1)) | 0;
const choice = arr => arr[(Math.random() * arr.length) | 0];
const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        if (((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

function polygonArea(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    }
    return Math.abs(a) * 0.5;
}

function polygonSigned(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    }
    return a;
}

// Segment intersection (for cat-attack -> trail)
function segIntersect(p1, p2, p3, p4) {
    const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (denom === 0) return false;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ---------- Effects ----------
const FX = {
    shake(amp, dur = 0.4) {
        G.shakeAmp = Math.max(G.shakeAmp, amp);
        G.shakeT = Math.max(G.shakeT, dur);
    },
    flash(color = '255,255,255', strength = 0.5) {
        G.flash = Math.max(G.flash, strength);
        G.flashColor = color;
    },
    hitstop(t) { G.hitstop = Math.max(G.hitstop, t); },
    slowmo(s, t = 0.4) {
        G.slowmo = Math.min(G.slowmo, s);
        setTimeout(() => { G.slowmo = 1; }, t * 1000);
    },
    spawnConfetti(x, y, n = 18, opts = {}) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const sp = (opts.minSpeed || 80) + Math.random() * (opts.spread || 200);
            G.particles.push({
                x, y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - (opts.upward || 60),
                life: rand(opts.lifeMin || 0.7, opts.lifeMax || 1.4),
                age: 0,
                color: opts.color || pickConfettiColor(),
                size: rand(2, 5),
                gravity: opts.gravity == null ? 280 : opts.gravity,
                shape: opts.shape || 'square',
                rot: Math.random() * TAU,
                rotV: rand(-6, 6),
            });
        }
    },
    spawnSparkles(x, y, n = 8, color = '#ffd84d') {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const sp = 40 + Math.random() * 120;
            G.particles.push({
                x, y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                life: rand(0.4, 0.8),
                age: 0,
                color,
                size: rand(1.5, 3),
                gravity: 20,
                shape: 'sparkle',
                rot: 0, rotV: rand(-4, 4),
            });
        }
    },
    floatText(x, y, text, color = '#ffd84d', size = 18) {
        G.floats.push({ x, y, text, age: 0, life: 1.1, color, size, vy: -36 });
    },
    shockwave(x, y, color = '#fff', radius = 200, dur = 0.5) {
        G.shockwaves.push({ x, y, age: 0, life: dur, color, radius });
    },
};

function pickConfettiColor() {
    return choice(['#ffd84d', '#ff6e3b', '#ff3b6e', '#9b6cff', '#6cd2ff', '#4dffb6', '#ffeb3b']);
}

// ---------- Hooks / extension API ----------
// Other scripts (loaded via index.html) can subscribe to these hooks to add
// content without editing game.js directly. Exposed on window.MTCD.
const HOOKS = {
    onLevelStart: [],
    onCapture: [],
    onLoopComplete: [],
    onLineBreak: [],
    onUpdate: [],
    onDraw: [],
    onDrawHUD: [],
    onAttack: [],
};
function fireHook(name, ...args) {
    const arr = HOOKS[name];
    if (!arr) return;
    for (const fn of arr) {
        try { fn(...args); } catch (e) { console.error('hook', name, e); }
    }
}
window.MTCD = {
    G, FX, HOOKS, fireHook,
    audio: () => Audio,
    canvasSize: () => ({ W, H }),
    rand, randInt, choice, clamp, lerp, dist, TAU,
};

// ---------- Scenes ----------
function roundedRectFill(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r);
    c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h);
    c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r);
    c.arcTo(x, y, x + r, y, r);
    c.closePath();
    c.fill();
}

const SCENES = {
    livingRoom: {
        name: 'Living Room', accent: '#ff6e3b',
        draw(c, time) {
            const sofaY = H * 0.85;
            c.fillStyle = 'rgba(80, 50, 90, 0.5)';
            roundedRectFill(c, W * 0.08, sofaY - 100, W * 0.84, 200, 24);
            c.fillStyle = 'rgba(60, 35, 70, 0.55)';
            roundedRectFill(c, W * 0.06, sofaY - 60, W * 0.18, 120, 14);
            roundedRectFill(c, W * 0.76, sofaY - 60, W * 0.18, 120, 14);
            const lx = W * 0.14, ly = 90;
            const grd = c.createRadialGradient(lx, ly, 0, lx, ly, H * 0.6);
            grd.addColorStop(0, 'rgba(255, 220, 150, 0.16)');
            grd.addColorStop(1, 'rgba(255, 220, 150, 0)');
            c.fillStyle = grd;
            c.fillRect(0, 0, W, H);
        },
    },
    garden: {
        name: 'Garden', accent: '#4dffb6',
        draw(c, time) {
            const baseY = H - 30;
            c.fillStyle = 'rgba(90, 180, 120, 0.35)';
            for (let i = 0; i < W; i += 6) {
                const h = 14 + Math.sin(i * 0.3 + time * 1.5) * 4 + ((i * 7919) % 6);
                c.fillRect(i, baseY - h, 3, h);
            }
            for (let i = 0; i < 4; i++) {
                const bx = (W * (i + 1) / 5) + Math.sin(time * 0.6 + i) * 30;
                const by = H * 0.35 + Math.sin(time * 1.4 + i * 2) * 20;
                drawButterfly(c, bx, by, time + i);
            }
        },
    },
    kitchen: {
        name: 'Kitchen', accent: '#7cd6ff',
        draw(c, time) {
            const tileSize = 44;
            c.strokeStyle = 'rgba(255,255,255,0.05)';
            c.lineWidth = 1;
            const oy = H * 0.65;
            for (let y = oy; y < H; y += tileSize) {
                for (let x = 0; x < W; x += tileSize) c.strokeRect(x, y, tileSize, tileSize);
            }
            const wx = W * 0.7, wy = H * 0.18, ww = 160, wh = 120;
            c.fillStyle = 'rgba(120, 180, 255, 0.06)';
            c.fillRect(wx, wy, ww, wh);
            c.strokeStyle = 'rgba(120, 180, 255, 0.18)';
            c.strokeRect(wx, wy, ww, wh);
            c.beginPath();
            c.moveTo(wx + ww/2, wy); c.lineTo(wx + ww/2, wy + wh);
            c.moveTo(wx, wy + wh/2); c.lineTo(wx + ww, wy + wh/2);
            c.stroke();
        },
    },
    bedroom: {
        name: 'Bedroom', accent: '#9b6cff',
        draw(c, time) {
            c.fillStyle = 'rgba(70, 45, 110, 0.55)';
            roundedRectFill(c, W * 0.12, H - 200, W * 0.76, 160, 18);
            c.fillStyle = 'rgba(160, 130, 220, 0.4)';
            roundedRectFill(c, W * 0.16, H - 184, W * 0.18, 50, 10);
            roundedRectFill(c, W * 0.66, H - 184, W * 0.18, 50, 10);
            const mx = W * 0.85, my = H * 0.15;
            const grd = c.createRadialGradient(mx, my, 10, mx, my, 100);
            grd.addColorStop(0, 'rgba(255,240,200,0.7)');
            grd.addColorStop(1, 'rgba(255,240,200,0)');
            c.fillStyle = grd;
            c.beginPath();
            c.arc(mx, my, 50, 0, TAU);
            c.fill();
        },
    },
    attic: {
        name: 'Attic', accent: '#f6a83d',
        draw(c, time) {
            c.strokeStyle = 'rgba(110, 70, 40, 0.5)';
            c.lineWidth = 16;
            for (let i = 0; i < 4; i++) {
                const x = W * (i + 1) / 5;
                c.beginPath();
                c.moveTo(x - 40, 0);
                c.lineTo(x + 80, H);
                c.stroke();
            }
            c.fillStyle = 'rgba(140, 90, 50, 0.5)';
            roundedRectFill(c, W * 0.06, H - 130, 110, 100, 6);
            roundedRectFill(c, W * 0.78, H - 110, 130, 90, 6);
        },
    },
    arena: {
        name: 'Boss Arena', accent: '#ff3b6e',
        draw(c, time) {
            const pulse = 0.5 + 0.5 * Math.sin(time * 2);
            const r = Math.min(W, H) * 0.45;
            const grd = c.createRadialGradient(W/2, H*0.6, r * 0.3, W/2, H*0.6, r);
            grd.addColorStop(0, `rgba(255,60,90,${0.18 + 0.06 * pulse})`);
            grd.addColorStop(1, 'rgba(255,60,90,0)');
            c.fillStyle = grd;
            c.beginPath();
            c.ellipse(W/2, H*0.6, r, r * 0.4, 0, 0, TAU);
            c.fill();
            c.fillStyle = 'rgba(40, 25, 35, 0.7)';
            for (let i = 0; i < 6; i++) {
                const a = i / 6 * TAU;
                const px = W/2 + Math.cos(a) * r * 0.85;
                const py = H*0.6 + Math.sin(a) * r * 0.36;
                roundedRectFill(c, px - 14, py - 60, 28, 100, 6);
            }
        },
    },
};

function drawButterfly(c, x, y, t) {
    const flap = Math.sin(t * 12) * 0.8;
    c.save();
    c.translate(x, y);
    c.scale(flap, 1);
    c.fillStyle = 'rgba(255, 200, 230, 0.7)';
    c.beginPath();
    c.ellipse(-6, 0, 6, 4, 0, 0, TAU);
    c.ellipse(6, 0, 6, 4, 0, 0, TAU);
    c.fill();
    c.restore();
}

const SCENE_ORDER = ['livingRoom', 'garden', 'kitchen', 'bedroom', 'attic', 'arena'];
G.scene = 'livingRoom';

// ---------- Power-ups ----------
const POWERUP_TYPES = {
    catnip: {
        name: 'Catnip', color: '#a4dc4d', icon: 'leaf', radius: 16,
        pickup(p) {
            for (const cat of G.cats) {
                if (cat.captured) continue;
                if (dist(p.x, p.y, cat.x, cat.y) < 280) {
                    cat.spinVel += 8 * (Math.random() < 0.5 ? -1 : 1);
                    cat.mood = 'dizzy';
                    cat.moodTimer = 4;
                    cat.captureProgress = Math.min(cat.type.loops - 0.0001, cat.captureProgress + 0.5);
                }
            }
            FX.shockwave(p.x, p.y, 'rgba(164,220,77,0.9)', 320, 0.6);
            FX.spawnConfetti(p.x, p.y, 24, { color: '#a4dc4d', spread: 200 });
            FX.floatText(p.x, p.y - 18, 'CATNIP!', '#a4dc4d', 18);
            if (audioUnlocked) Audio.SFX.purr();
        },
    },
    treat: {
        name: 'Treat', color: '#ffb84d', icon: 'fish', radius: 14,
        pickup(p) {
            for (const cat of G.cats) {
                if (cat.captured) continue;
                cat.wanderTarget = { x: p.x, y: p.y };
                cat.attackCooldown = Math.max(cat.attackCooldown, 3);
                cat.mood = 'curious';
            }
            FX.shockwave(p.x, p.y, 'rgba(255,184,77,0.8)', 240, 0.5);
            FX.spawnSparkles(p.x, p.y, 12, '#ffb84d');
            FX.floatText(p.x, p.y - 18, 'YUM!', '#ffb84d', 18);
            if (audioUnlocked) Audio.SFX.meow();
        },
    },
    heart: {
        name: 'Bonus', color: '#ff3b6e', icon: 'heart', radius: 12,
        pickup(p) {
            G.score += 250;
            FX.spawnConfetti(p.x, p.y, 14, { color: '#ff3b6e' });
            FX.floatText(p.x, p.y - 18, '+250', '#ff3b6e', 22);
            if (audioUnlocked) Audio.SFX.loopClose(2);
        },
    },
    slowmo: {
        name: 'Slow-Mo', color: '#7cd6ff', icon: 'clock', radius: 14,
        pickup(p) {
            FX.slowmo(0.4, 1.6);
            FX.shockwave(p.x, p.y, 'rgba(124,214,255,0.9)', 280, 0.5);
            FX.flash('124,214,255', 0.3);
            FX.floatText(p.x, p.y - 18, 'SLOW-MO', '#7cd6ff', 20);
        },
    },
};

const Powerups = {
    list: [],
    spawnTimer: 0,
    reset() { this.list.length = 0; this.spawnTimer = rand(4, 7); },
    spawn(typeId, x, y) {
        const def = POWERUP_TYPES[typeId];
        if (!def) return;
        this.list.push({
            type: def, typeId, x, y,
            age: 0, life: 9.5,
            bob: Math.random() * TAU,
        });
    },
    update(dt) {
        if (G.stage !== 'playing') return;
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnTimer = rand(5, 9);
            const t = choice(Object.keys(POWERUP_TYPES));
            this.spawn(t, rand(W * 0.12, W * 0.88), rand(H * 0.3, H * 0.85));
        }
        for (let i = this.list.length - 1; i >= 0; i--) {
            const p = this.list[i];
            p.age += dt;
            p.bob += dt * 3;
            if (p.age >= p.life) { this.list.splice(i, 1); continue; }
            if (G.laser.active && dist(G.laser.x, G.laser.y, p.x, p.y) < p.type.radius + 14) {
                p.type.pickup(p);
                this.list.splice(i, 1);
            }
        }
    },
    draw(c) {
        for (const p of this.list) {
            const fade = p.age > p.life - 1 ? (p.life - p.age) : 1;
            const y = p.y + Math.sin(p.bob) * 4;
            c.save();
            c.globalAlpha = fade;
            const grd = c.createRadialGradient(p.x, y, 0, p.x, y, 36);
            grd.addColorStop(0, p.type.color + 'cc');
            grd.addColorStop(1, p.type.color + '00');
            c.fillStyle = grd;
            c.beginPath();
            c.arc(p.x, y, 36, 0, TAU);
            c.fill();
            c.shadowBlur = 12;
            c.shadowColor = p.type.color;
            drawPowerupIcon(c, p.x, y, p.type.icon, p.type.color);
            c.restore();
        }
    },
};

function drawPowerupIcon(c, x, y, icon, color) {
    c.save();
    c.translate(x, y);
    c.fillStyle = color;
    c.lineWidth = 1.5;
    if (icon === 'leaf') {
        c.beginPath();
        c.moveTo(0, -10);
        c.quadraticCurveTo(10, -4, 8, 8);
        c.quadraticCurveTo(0, 12, -8, 8);
        c.quadraticCurveTo(-10, -4, 0, -10);
        c.fill();
        c.beginPath();
        c.moveTo(0, -8); c.lineTo(0, 10);
        c.strokeStyle = 'rgba(0,0,0,0.4)';
        c.stroke();
    } else if (icon === 'fish') {
        c.beginPath();
        c.ellipse(0, 0, 12, 6, 0, 0, TAU);
        c.fill();
        c.beginPath();
        c.moveTo(11, 0); c.lineTo(18, -6); c.lineTo(18, 6); c.closePath();
        c.fill();
        c.fillStyle = '#1a0f2e';
        c.beginPath();
        c.arc(-6, -1, 1.2, 0, TAU);
        c.fill();
    } else if (icon === 'heart') {
        c.beginPath();
        c.moveTo(0, 4);
        c.bezierCurveTo(-12, -8, -10, -14, 0, -6);
        c.bezierCurveTo(10, -14, 12, -8, 0, 4);
        c.fill();
    } else if (icon === 'clock') {
        c.beginPath();
        c.arc(0, 0, 10, 0, TAU);
        c.fill();
        c.strokeStyle = '#1a0f2e';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, 0); c.lineTo(0, -7);
        c.moveTo(0, 0); c.lineTo(6, 0);
        c.stroke();
    }
    c.restore();
}

HOOKS.onLevelStart.push(() => Powerups.reset());
HOOKS.onUpdate.push((dt) => Powerups.update(dt));
HOOKS.onDraw.push((c) => Powerups.draw(c));

// ---------- Cat types ----------
// Each cat type has unique visuals, behavior parameters, and capture difficulty.
const CAT_TYPES = {
    ginger: {
        id: 'ginger', name: 'Tabby', loops: 2,
        body: '#f6a83d', dark: '#d8852a', belly: '#ffe1b2', stripes: true,
        speedBase: 95, speedLevel: 25, interest: 360,
        attackChance: 0.0035, attackKind: 'swipe',
        size: 1.0,
    },
    black: {
        id: 'black', name: 'Shadow Cat', loops: 3,
        body: '#2a223a', dark: '#15101f', belly: '#5a4a6a', stripes: false,
        speedBase: 145, speedLevel: 30, interest: 460,
        attackChance: 0.008, attackKind: 'pounce',
        size: 0.95, eyeColor: '#ffd84d', glow: true,
    },
    white: {
        id: 'white', name: 'Snowpaw', loops: 2,
        body: '#f5efff', dark: '#cdc4dd', belly: '#ffffff', stripes: false,
        speedBase: 120, speedLevel: 25, interest: 280,
        attackChance: 0.001, attackKind: 'flee',
        size: 0.95, eyeColor: '#7cd6ff',
    },
    calico: {
        id: 'calico', name: 'Patches', loops: 2,
        body: '#f6a83d', dark: '#1a1418', belly: '#ffffff', stripes: false,
        patches: true,
        speedBase: 110, speedLevel: 25, interest: 360,
        attackChance: 0.005, attackKind: 'zigzag',
        size: 1.0,
    },
    kitten: {
        id: 'kitten', name: 'Kitten', loops: 1,
        body: '#a07b50', dark: '#7b5c34', belly: '#fff0d0', stripes: true,
        speedBase: 165, speedLevel: 30, interest: 420,
        attackChance: 0.002, attackKind: 'dart',
        size: 0.65,
    },
    persian: {
        id: 'persian', name: 'Persian', loops: 4,
        body: '#e6d8ba', dark: '#b8a883', belly: '#fff7e6', stripes: false,
        fluffy: true,
        speedBase: 70, speedLevel: 18, interest: 260,
        attackChance: 0.004, attackKind: 'swipe',
        size: 1.15, eyeColor: '#ff8aa9',
    },
    maine: {
        id: 'maine', name: 'Maine Boss', loops: 6,
        body: '#3d2a18', dark: '#22150a', belly: '#a07d50', stripes: true,
        fluffy: true,
        speedBase: 80, speedLevel: 18, interest: 480,
        attackChance: 0.012, attackKind: 'roar',
        size: 1.5, isBoss: true,
    },
    sphynx: {
        id: 'sphynx', name: 'Sphynx', loops: 3,
        body: '#e8b89a', dark: '#b88770', belly: '#f8d4b8', stripes: false,
        wrinkled: true,
        speedBase: 110, speedLevel: 22, interest: 380,
        attackChance: 0.006, attackKind: 'phase',
        size: 1.0,
    },
};

// ---------- Cat entity ----------
function createCat(typeId, x, y) {
    const t = CAT_TYPES[typeId] || CAT_TYPES.ginger;
    const baseSize = Math.min(W, H) * 0.085 * t.size;
    return {
        type: t,
        x, y,
        vx: 0, vy: 0,
        facing: Math.random() < 0.5 ? -1 : 1,
        size: baseSize,
        rotation: 0,
        spinVel: 0,
        wobble: 0,
        walkPhase: Math.random() * TAU,
        tailPhase: Math.random() * TAU,
        captureProgress: 0,    // 0..type.loops
        captured: false,
        captureFlash: 0,
        attackCooldown: rand(2, 5),
        attackState: null,     // null | { kind, t, dur, dx, dy, ... }
        wanderTarget: null,
        moodTimer: 0,
        mood: 'curious',
        meowCooldown: rand(2, 6),
        phaseAlpha: 1,
        phaseTimer: 0,
    };
}

function updateCat(cat, dt) {
    if (cat.captured) {
        // Drift up and shrink, will be removed elsewhere
        cat.vy += -120 * dt;
        cat.x += cat.vx * dt;
        cat.y += cat.vy * dt;
        cat.rotation += 4 * dt;
        cat.size *= Math.pow(0.4, dt);
        cat.captureFlash = Math.max(0, cat.captureFlash - dt * 2);
        return;
    }

    cat.moodTimer -= dt;
    cat.attackCooldown -= dt;
    cat.meowCooldown -= dt;
    cat.captureFlash = Math.max(0, cat.captureFlash - dt * 2);

    // Random meow
    if (cat.meowCooldown <= 0) {
        cat.meowCooldown = rand(4, 10);
        if (Math.random() < 0.4 && audioUnlocked) Audio.SFX.meow();
    }

    // Spin physics
    cat.rotation += cat.spinVel * dt;
    cat.spinVel *= Math.pow(0.18, dt);

    // Sphynx phase / fade in-out
    if (cat.type.attackKind === 'phase') {
        cat.phaseTimer += dt;
        cat.phaseAlpha = 0.55 + 0.45 * Math.sin(cat.phaseTimer * 1.4);
    }

    const laser = G.laser;
    const dx = laser.x - cat.x, dy = laser.y - cat.y;
    const d = Math.hypot(dx, dy);
    const interestRange = cat.type.interest + G.level * 20;

    // Attack triggers
    if (!cat.attackState && cat.attackCooldown <= 0 && laser.drawing && d < interestRange * 0.8) {
        beginAttack(cat, dx, dy, d);
    }

    // Mood / movement intent
    let ax = 0, ay = 0;
    if (cat.attackState) {
        updateAttack(cat, dt);
        ax = cat.attackState.ax || 0;
        ay = cat.attackState.ay || 0;
    } else if (cat.moodTimer > 0 && cat.mood === 'dizzy') {
        cat.wobble = Math.min(1, cat.wobble + dt * 4);
        ax = Math.cos(cat.rotation * 2) * 30;
        ay = Math.sin(cat.rotation * 2) * 30;
    } else {
        cat.wobble = Math.max(0, cat.wobble - dt * 2);
        const baseSpeed = cat.type.speedBase + G.level * cat.type.speedLevel;
        const dizzyFactor = 1 - clamp(cat.captureProgress / cat.type.loops, 0, 1) * 0.4;
        if (laser.active && laser.drawing && d < interestRange) {
            cat.mood = 'chasing';
            const k = baseSpeed * dizzyFactor / Math.max(d, 1);
            ax = dx * k; ay = dy * k;
            cat.facing = dx >= 0 ? 1 : -1;

            // White cat (flee) actually runs AWAY when laser is super close
            if (cat.type.attackKind === 'flee' && d < 140) {
                ax = -dx * k * 1.4;
                ay = -dy * k * 1.4;
            }
        } else {
            cat.mood = 'curious';
            if (!cat.wanderTarget || dist(cat.x, cat.y, cat.wanderTarget.x, cat.wanderTarget.y) < 40) {
                cat.wanderTarget = {
                    x: rand(80, W - 80),
                    y: rand(160, H - 80),
                };
            }
            const wdx = cat.wanderTarget.x - cat.x;
            const wdy = cat.wanderTarget.y - cat.y;
            const wd = Math.hypot(wdx, wdy) || 1;
            const wk = baseSpeed * 0.35 * dizzyFactor / wd;
            ax = wdx * wk; ay = wdy * wk;
            cat.facing = wdx >= 0 ? 1 : -1;
        }
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

    const speed = Math.hypot(cat.vx, cat.vy);
    cat.walkPhase += dt * (4 + speed * 0.04);
    cat.tailPhase += dt * 3;
}

function beginAttack(cat, dx, dy, d) {
    const kind = cat.type.attackKind;
    cat.attackCooldown = rand(2.5, 5.5) - G.level * 0.1;
    if (kind === 'swipe') {
        cat.attackState = { kind, t: 0, dur: 0.6, dx, dy, telegraphTime: 0.35 };
    } else if (kind === 'pounce') {
        cat.attackState = { kind, t: 0, dur: 0.55, dx, dy, telegraphTime: 0.3 };
        cat.spinVel += 2;
    } else if (kind === 'roar') {
        cat.attackState = { kind, t: 0, dur: 0.9, telegraphTime: 0.4 };
    } else if (kind === 'zigzag') {
        cat.attackState = { kind, t: 0, dur: 0.7, dir: Math.random() < 0.5 ? -1 : 1, telegraphTime: 0.2 };
    } else if (kind === 'dart') {
        cat.attackState = { kind, t: 0, dur: 0.4, dx, dy, telegraphTime: 0.15 };
    } else if (kind === 'phase') {
        cat.attackState = { kind, t: 0, dur: 0.6, dx, dy, telegraphTime: 0.25 };
    } else if (kind === 'flee') {
        cat.attackState = { kind, t: 0, dur: 0.5, dx, dy, telegraphTime: 0.0 };
    }
    if (audioUnlocked && Math.random() < 0.6) Audio.SFX.hiss();
}

function updateAttack(cat, dt) {
    const a = cat.attackState;
    a.t += dt;
    const phase = a.t < a.telegraphTime ? 'telegraph' : 'strike';
    if (a.kind === 'swipe' || a.kind === 'pounce' || a.kind === 'dart' || a.kind === 'phase') {
        if (phase === 'strike') {
            const baseSpeed = a.kind === 'pounce' ? 460 : a.kind === 'dart' ? 600 : a.kind === 'phase' ? 320 : 320;
            const len = Math.hypot(a.dx, a.dy) || 1;
            a.ax = a.dx / len * baseSpeed;
            a.ay = a.dy / len * baseSpeed;
            // On first frame of strike, do the line-cut check
            if (!a.struck) {
                a.struck = true;
                tryBreakTrail(cat, a);
                FX.shake(4, 0.18);
                if (audioUnlocked) Audio.SFX.attack();
            }
        }
    } else if (a.kind === 'roar') {
        if (phase === 'strike' && !a.struck) {
            a.struck = true;
            // Roar breaks any nearby trail
            const radius = cat.size * 4;
            tryBreakTrailRadius(cat, radius);
            FX.shake(12, 0.45);
            FX.shockwave(cat.x, cat.y, '#ff6e3b', radius, 0.45);
            if (audioUnlocked) Audio.SFX.attack();
        }
    } else if (a.kind === 'zigzag') {
        if (phase === 'strike') {
            a.ax = a.dir * 240 * Math.cos(a.t * 14);
            a.ay = -200;
            if (!a.struck) {
                a.struck = true;
                tryBreakTrail(cat, a);
                if (audioUnlocked) Audio.SFX.attack();
            }
        }
    } else if (a.kind === 'flee') {
        a.ax = 0; a.ay = 0;
    }
    if (a.t >= a.dur) cat.attackState = null;
}

function tryBreakTrail(cat, atk) {
    const trail = G.trail;
    if (trail.length < 4 || !G.laser.drawing) return;
    // Strike line from cat to attack vector for 60..160 px
    const len = Math.hypot(atk.dx, atk.dy) || 1;
    const sx = cat.x, sy = cat.y;
    const ex = cat.x + atk.dx / len * cat.size * 4.5;
    const ey = cat.y + atk.dy / len * cat.size * 4.5;
    const p1 = { x: sx, y: sy }, p2 = { x: ex, y: ey };
    for (let i = 1; i < trail.length; i++) {
        if (segIntersect(p1, p2, trail[i - 1], trail[i])) {
            breakTrail('attack');
            return;
        }
    }
}

function tryBreakTrailRadius(cat, r) {
    const trail = G.trail;
    if (trail.length < 4 || !G.laser.drawing) return;
    for (const p of trail) {
        if (dist(p.x, p.y, cat.x, cat.y) < r) {
            breakTrail('attack');
            return;
        }
    }
}

// ---------- Cat drawing ----------
function drawCat(cat) {
    const t = cat.type;
    ctx.save();
    ctx.globalAlpha = cat.phaseAlpha;
    ctx.translate(cat.x, cat.y);

    // Capture flash halo
    if (cat.captureFlash > 0) {
        const r = cat.size * (1.2 + (1 - cat.captureFlash) * 0.5);
        const grd = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
        grd.addColorStop(0, `rgba(255,255,255,${0.7 * cat.captureFlash})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
    }

    const wob = cat.wobble;
    ctx.rotate(cat.rotation + Math.sin(performance.now() * 0.015) * 0.05 * wob);
    const s = cat.size / 50;
    ctx.scale(s * cat.facing, s);
    drawCatSprite(cat, wob);
    ctx.restore();

    // Capture progress ring (in world space, no rotation)
    drawCatHUD(cat);

    // Attack telegraphs
    if (cat.attackState && cat.attackState.t < cat.attackState.telegraphTime) {
        drawAttackTelegraph(cat);
    }

    // Dizzy stars
    if (cat.captureProgress / t.loops > 0.4 || cat.wobble > 0.1) {
        const n = 3;
        const tt = performance.now() * 0.004;
        const radius = cat.size * 0.95;
        ctx.save();
        ctx.translate(cat.x, cat.y - cat.size * 0.9);
        for (let i = 0; i < n; i++) {
            const a = tt + (i / n) * TAU;
            const sx = Math.cos(a) * radius * 0.7;
            const sy = Math.sin(a) * radius * 0.25;
            drawStar(sx, sy, 6 + Math.sin(tt * 2 + i) * 1.5, '#ffd84d');
        }
        ctx.restore();
    }
}

function drawCatSprite(cat, wob) {
    const t = cat.type;
    const bodyColor = t.body;
    const bodyDark = t.dark;
    const belly = t.belly;
    const ear = bodyColor;
    const earInner = '#ff8aa9';

    // Tail (behind body)
    ctx.save();
    ctx.translate(-32, -2);
    const sway = Math.sin(cat.tailPhase) * 0.4 + (wob ? Math.sin(cat.tailPhase * 3) * 0.3 * wob : 0);
    ctx.rotate(sway - 0.4);
    ctx.fillStyle = bodyColor;
    if (t.fluffy) {
        // Fluffy tail
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-26, -10, -42, -28);
        ctx.quadraticCurveTo(-32, -8, -22, 6);
        ctx.quadraticCurveTo(-10, 4, 0, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = bodyDark;
        ctx.beginPath();
        ctx.arc(-40, -28, 8, 0, TAU);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-22, -8, -36, -22);
        ctx.quadraticCurveTo(-30, -10, -22, 4);
        ctx.quadraticCurveTo(-10, 2, 0, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = bodyDark;
        ctx.beginPath();
        ctx.arc(-34, -22, 5, 0, TAU);
        ctx.fill();
    }
    ctx.restore();

    // Legs
    ctx.fillStyle = bodyColor;
    const legBob = Math.sin(cat.walkPhase) * 3;
    const legBob2 = Math.sin(cat.walkPhase + Math.PI) * 3;
    roundedRect(-20, 18 - Math.max(0, legBob2), 10, 14 + Math.max(0, legBob2), 4);
    roundedRect(-4, 18 - Math.max(0, legBob), 10, 14 + Math.max(0, legBob), 4);
    roundedRect(12, 18 - Math.max(0, legBob2), 10, 14 + Math.max(0, legBob2), 4);

    // Body
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    if (t.fluffy) {
        ctx.ellipse(0, 8, 32, 22, 0, 0, TAU);
    } else {
        ctx.ellipse(0, 8, 28, 18, 0, 0, TAU);
    }
    ctx.fill();
    // Belly
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(2, 14, 18, 10, 0, 0, TAU);
    ctx.fill();

    // Stripes
    if (t.stripes) {
        ctx.fillStyle = bodyDark;
        ctx.globalAlpha = 0.6;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.ellipse(-10 + i * 10, 4, 2, 5, 0.3, 0, TAU);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    // Calico patches
    if (t.patches) {
        ctx.fillStyle = bodyDark;
        ctx.beginPath();
        ctx.ellipse(-12, 6, 8, 6, 0.3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(8, 12, 8, 5, -0.2, 0, TAU);
        ctx.fill();
    }

    // Sphynx wrinkles
    if (t.wrinkled) {
        ctx.strokeStyle = bodyDark;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 0.6;
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(0, 8 + i * 2, 18 - i * 2, Math.PI * 1.05, Math.PI * 1.95);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Head
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    if (t.fluffy) {
        ctx.ellipse(18, -6, 22, 20, 0, 0, TAU);
    } else {
        ctx.ellipse(18, -6, 18, 16, 0, 0, TAU);
    }
    ctx.fill();
    // Cheeks
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(20, 0, 12, 8, 0, 0, TAU);
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
    ctx.fillStyle = earInner;
    ctx.beginPath();
    ctx.moveTo(10, -18); ctx.lineTo(13, -25); ctx.lineTo(16, -19); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(24, -19); ctx.lineTo(28, -25); ctx.lineTo(30, -16); ctx.closePath();
    ctx.fill();

    // Eyes
    const eyeColor = t.eyeColor || '#1a0f2e';
    const dazed = (cat.captureProgress / t.loops) > 0.5 || wob > 0.3 || cat.attackState;
    if (dazed && !cat.attackState) {
        drawSpiralEye(13, -8, 3.5);
        drawSpiralEye(24, -8, 3.5);
    } else if (cat.attackState) {
        // Angry eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(13, -8, 3.5, 0, TAU); ctx.arc(24, -8, 3.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = eyeColor;
        ctx.beginPath();
        ctx.ellipse(13, -8, 1.4, 3, 0, 0, TAU);
        ctx.ellipse(24, -8, 1.4, 3, 0, 0, TAU);
        ctx.fill();
        // Angry brows
        ctx.strokeStyle = bodyDark;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(9, -13); ctx.lineTo(16, -10);
        ctx.moveTo(28, -10); ctx.lineTo(21, -13);
        ctx.stroke();
    } else {
        const lx = G.laser.x - cat.x;
        const ly = G.laser.y - cat.y;
        const ang = Math.atan2(ly, lx * cat.facing);
        const px = Math.cos(ang) * 1.2;
        const py = Math.sin(ang) * 1.2;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(13, -8, 3.5, 0, TAU); ctx.arc(24, -8, 3.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = eyeColor;
        ctx.beginPath();
        ctx.arc(13 + px, -8 + py, 2.2, 0, TAU);
        ctx.arc(24 + px, -8 + py, 2.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(13.6 + px, -8.7 + py, 0.7, 0, TAU);
        ctx.arc(24.6 + px, -8.7 + py, 0.7, 0, TAU);
        ctx.fill();
        if (t.glow) {
            ctx.shadowBlur = 8;
            ctx.shadowColor = eyeColor;
            ctx.fillStyle = eyeColor;
            ctx.beginPath();
            ctx.arc(13 + px, -8 + py, 1.0, 0, TAU);
            ctx.arc(24 + px, -8 + py, 1.0, 0, TAU);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    // Nose
    ctx.fillStyle = '#ff6e3b';
    ctx.beginPath();
    ctx.moveTo(18, -2); ctx.lineTo(20, -2); ctx.lineTo(19, 0);
    ctx.closePath();
    ctx.fill();
    // Mouth
    ctx.strokeStyle = '#5a2a08';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (cat.attackState) {
        // Open mouth (snarl)
        ctx.moveTo(15, 3); ctx.quadraticCurveTo(19, 7, 23, 3);
    } else {
        ctx.moveTo(19, 0.5); ctx.lineTo(19, 2.5);
        ctx.moveTo(19, 2.5); ctx.quadraticCurveTo(16, 4.5, 14, 2.5);
        ctx.moveTo(19, 2.5); ctx.quadraticCurveTo(22, 4.5, 24, 2.5);
    }
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

function drawCatHUD(cat) {
    // Capture pip ring above the cat showing N segments
    const t = cat.type;
    const r = cat.size + 14;
    const cx = cat.x;
    const cy = cat.y - cat.size - 22;
    const segments = t.loops;
    const segGap = 0.06;
    const total = TAU - Math.PI * 0.6; // partial arc on top
    const startA = -Math.PI / 2 - total / 2;
    const segLen = (total - segGap * (segments - 1)) / segments;

    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < segments; i++) {
        const a0 = startA + i * (segLen + segGap);
        const a1 = a0 + segLen;
        const filled = i < cat.captureProgress;
        ctx.lineWidth = 5;
        ctx.strokeStyle = filled ? '#ffd84d' : 'rgba(255,255,255,0.18)';
        if (filled) {
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#ffb84d';
        }
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    // Boss tag
    if (t.isBoss) {
        ctx.fillStyle = '#ff3b6e';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('BOSS', cx, cy - r - 4);
    }
    ctx.restore();
}

function drawAttackTelegraph(cat) {
    const a = cat.attackState;
    const t01 = clamp(a.t / a.telegraphTime, 0, 1);
    ctx.save();
    if (a.kind === 'roar') {
        const r = cat.size * 4 * t01;
        ctx.strokeStyle = `rgba(255,110,59,${0.5 * (1 - t01)})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cat.x, cat.y, r, 0, TAU);
        ctx.stroke();
    } else if (a.dx !== undefined) {
        const len = Math.hypot(a.dx, a.dy) || 1;
        const ux = a.dx / len, uy = a.dy / len;
        const reach = cat.size * 4.5;
        ctx.strokeStyle = `rgba(255,60,90,${0.7 * t01})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(cat.x, cat.y);
        ctx.lineTo(cat.x + ux * reach, cat.y + uy * reach);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.restore();
}

function drawSpiralEye(cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
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
        const a = -Math.PI / 2 + i * (TAU / 5);
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

// ---------- Laser / trail / loop detection ----------
function startDrawing(x, y) {
    G.laser.drawing = true;
    G.laser.active = true;
    G.laser.x = x; G.laser.y = y;
    G.trail = [{ x, y, t: performance.now() }];
    if (audioUnlocked) Audio.SFX.laserStart();
}

function continueDrawing(x, y) {
    G.laser.x = x; G.laser.y = y;
    G.laser.active = true;
    if (G.laser.drawing) {
        const trail = G.trail;
        const last = trail[trail.length - 1];
        if (!last || dist(last.x, last.y, x, y) > 1.5) {
            trail.push({ x, y, t: performance.now() });
            // Cap trail length
            if (trail.length > 600) trail.shift();
            detectLoop();
        }
    }
}

function endDrawing() {
    if (G.laser.drawing) {
        // Convert active trail to a fading ghost trail
        if (G.trail.length > 4) {
            G.ghostTrails.push({ pts: G.trail.slice(), age: 0, life: 0.6, broken: false });
        }
        G.trail = [];
        G.laser.drawing = false;
        if (audioUnlocked) Audio.SFX.laserEnd();
    }
}

function breakTrail(reason) {
    if (!G.laser.drawing) return;
    if (G.trail.length > 4) {
        G.ghostTrails.push({ pts: G.trail.slice(), age: 0, life: 0.5, broken: true });
    }
    G.trail = [];
    G.laser.drawing = false;
    G.combo = 0; G.comboTimer = 0;
    FX.shake(8, 0.3);
    FX.flash('255,80,80', 0.45);
    FX.spawnSparkles(G.laser.x, G.laser.y, 12, '#ff5566');
    FX.floatText(G.laser.x, G.laser.y - 16, 'LINE BROKEN!', '#ff5566', 16);
    if (audioUnlocked) Audio.SFX.lineBreak();
    fireHook('onLineBreak', reason);
}

// Loop detection: when current point closes near an earlier point, test
// each cat for containment within the resulting polygon.
function detectLoop() {
    const trail = G.trail;
    if (trail.length < 12 || !G.laser.drawing) return;
    const cur = trail[trail.length - 1];
    const minSeparation = 8;
    const maxLookback = trail.length - minSeparation;
    let bestIdx = -1;
    const closeRadius = 36;
    for (let i = 0; i < maxLookback; i++) {
        const p = trail[i];
        const dx = p.x - cur.x, dy = p.y - cur.y;
        if (dx * dx + dy * dy < closeRadius * closeRadius) {
            bestIdx = i;
            break;
        }
    }
    if (bestIdx === -1) return;
    const poly = trail.slice(bestIdx);
    if (poly.length < 10) return;
    const area = polygonArea(poly);
    let len = 0;
    for (let i = 1; i < poly.length; i++) {
        const dx = poly[i].x - poly[i - 1].x, dy = poly[i].y - poly[i - 1].y;
        len += Math.hypot(dx, dy);
    }
    const minArea = 1500;
    if (area < minArea || len < 120) return;

    let anyHit = false;
    for (const cat of G.cats) {
        if (cat.captured) continue;
        const minCatArea = cat.size * cat.size * 1.6;
        if (area < minCatArea) continue;
        if (!pointInPolygon(cat.x, cat.y, poly)) continue;
        registerLoop(cat, poly, area);
        anyHit = true;
    }

    if (anyHit) {
        // Trim trail to leftover so we don't immediately retrigger
        G.trail = G.trail.slice(-3);
    }
}

function registerLoop(cat, poly, area) {
    cat.captureProgress += 1;
    const signed = polygonSigned(poly);
    const dir = signed > 0 ? -1 : 1;
    cat.spinVel += dir * (4 + G.level * 0.5);
    cat.mood = 'dizzy';
    cat.moodTimer = 1.2;
    cat.captureFlash = 1;

    // Combo
    G.combo += 1;
    G.comboTimer = 2.5;
    const comboMult = 1 + Math.min(G.combo - 1, 12) * 0.15;
    const points = Math.round(100 * comboMult);
    G.score += points;
    if (audioUnlocked) {
        Audio.SFX.loopClose(G.combo);
        if (G.combo > 1) Audio.SFX.comboUp(G.combo);
    }

    FX.spawnConfetti(cat.x, cat.y, 20, { color: pickConfettiColor() });
    FX.spawnSparkles(cat.x, cat.y, 14, '#ffd84d');
    FX.shockwave(cat.x, cat.y, 'rgba(255,200,80,0.8)', cat.size * 2.5, 0.5);
    FX.floatText(cat.x, cat.y - cat.size - 30, `+${points}${G.combo > 1 ? ` ×${G.combo}` : ''}`, '#ffd84d', 18);
    FX.shake(3, 0.18);
    fireHook('onLoopComplete', cat, area, points);

    if (cat.captureProgress >= cat.type.loops) {
        captureCat(cat);
    }
}

function captureCat(cat) {
    cat.captured = true;
    cat.vx = (Math.random() - 0.5) * 80;
    cat.vy = -260;
    G.capturesLeft -= 1;
    const bonus = 500 + cat.type.loops * 200;
    G.score += bonus;
    // Layered capture FX: triple shockwave, gold + scene-accent confetti,
    // hearts shooting up, expanding ring of stars
    const accent = (SCENES[G.scene] && SCENES[G.scene].accent) || '#ffec5e';
    FX.spawnConfetti(cat.x, cat.y, 70, { spread: 360, lifeMin: 1.0, lifeMax: 2.0, gravity: 320 });
    FX.spawnConfetti(cat.x, cat.y, 30, { color: accent, spread: 220, lifeMin: 0.8, lifeMax: 1.6 });
    FX.spawnSparkles(cat.x, cat.y, 28, '#ffd84d');
    // Heart burst
    for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
        const sp = 200 + Math.random() * 100;
        G.particles.push({
            x: cat.x, y: cat.y - cat.size * 0.4,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 1.4, age: 0, color: '#ff8aa9',
            size: 5, gravity: 80, shape: 'heart',
            rot: 0, rotV: rand(-3, 3),
        });
    }
    FX.shockwave(cat.x, cat.y, 'rgba(255,110,59,0.9)', cat.size * 5, 0.7);
    setTimeout(() => FX.shockwave(cat.x, cat.y, 'rgba(255,236,180,0.7)', cat.size * 3, 0.5), 80);
    setTimeout(() => FX.shockwave(cat.x, cat.y, accent + 'cc', cat.size * 2.2, 0.4), 160);
    FX.flash('255,236,180', 0.55);
    FX.shake(14, 0.4);
    FX.hitstop(0.14);
    FX.slowmo(0.35, 0.55);
    FX.floatText(cat.x, cat.y - cat.size - 40, `${cat.type.name.toUpperCase()} CAUGHT! +${bonus}`, '#ffec5e', 22);
    if (audioUnlocked) { Audio.SFX.capture(); Audio.SFX.purr(); }
    fireHook('onCapture', cat, bonus);

    if (G.capturesLeft <= 0) {
        setTimeout(levelComplete, 900);
    }
}

// ---------- Levels ----------
function levelSpec(n) {
    // Return list of cat types to spawn
    if (n === 1) return ['ginger', 'kitten'];
    if (n === 2) return ['ginger', 'white', 'kitten'];
    if (n === 3) return ['calico', 'black', 'kitten'];
    if (n === 4) return ['white', 'sphynx', 'calico'];
    if (n === 5) return ['black', 'persian', 'kitten', 'kitten'];
    if (n === 6) return ['sphynx', 'sphynx', 'calico', 'white'];
    if (n === 7) return ['ginger', 'black', 'persian', 'kitten'];
    if (n === 8) return ['maine']; // boss
    // Beyond: scale up
    const types = ['ginger', 'black', 'white', 'calico', 'kitten', 'persian', 'sphynx'];
    const out = [];
    const count = Math.min(6, 3 + ((n - 9) / 2 | 0));
    for (let i = 0; i < count; i++) out.push(choice(types));
    if (n % 4 === 0) out.push('maine');
    return out;
}

function startLevel(n) {
    G.level = n;
    G.levelTime = 0;
    G.cats = [];
    G.trail = [];
    G.ghostTrails = [];
    G.particles = [];
    G.floats = [];
    G.shockwaves = [];
    G.combo = 0;
    G.comboTimer = 0;
    const spec = levelSpec(n);
    G.capturesLeft = spec.length;
    spec.forEach((typeId, i) => {
        const angle = (i / spec.length) * TAU + Math.random() * 0.4;
        const cx = W / 2, cy = H * 0.55;
        const r = Math.min(W, H) * 0.25;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        G.cats.push(createCat(typeId, x, y));
    });
    // Pick a scene for this level: bosses go to arena, others rotate
    const spec2 = levelSpec(n);
    if (spec2.some(t => CAT_TYPES[t] && CAT_TYPES[t].isBoss)) {
        G.scene = 'arena';
    } else {
        G.scene = SCENE_ORDER[(n - 1) % (SCENE_ORDER.length - 1)];
    }
    G.stage = 'playing';
    hideOverlay();
    if (audioUnlocked) Audio.SFX.click();
    fireHook('onLevelStart', n);
}

function levelComplete() {
    G.stage = 'levelComplete';
    if (G.score > G.bestScore) {
        G.bestScore = G.score;
        localStorage.setItem('mtcd_best', G.score.toString());
    }
    if (audioUnlocked) Audio.SFX.levelComplete();
    showLevelCompleteOverlay();
}

// ---------- UI / overlay ----------
const overlay = document.getElementById('overlay');
const overlayCard = document.getElementById('overlay-card');
const meterFill = document.getElementById('meter-fill');
const loopCountEl = document.getElementById('loop-count');
const levelEl = document.getElementById('level');
const timeEl = document.getElementById('time');
const meterLabelEl = document.getElementById('meter-label');

function showMenuOverlay() {
    overlayCard.innerHTML = `
        <h1>Make the Cat Dizzy!</h1>
        <p class="subtitle">Pokémon Ranger style — but with a cat and a laser pointer</p>
        <ol class="howto">
            <li><strong>Hold</strong> the mouse / finger and <strong>draw closed loops</strong> around the cat.</li>
            <li>Each loop fills a capture pip. Fill them all to catch the cat.</li>
            <li>If you release, get hissed at, or crossed by an attack — your line breaks!</li>
            <li>Bigger loops, faster combos = more points. Catch every cat to win the level.</li>
        </ol>
        <div class="best-row">${G.bestScore > 0 ? `Best: <strong>${G.bestScore}</strong>` : ''}</div>
        <button id="start-btn">Start</button>
        <button id="mute-btn" class="ghost">${Audio.isMuted() ? '🔇 Sound off' : '🔊 Sound on'}</button>
    `;
    overlay.classList.add('show');
    document.getElementById('start-btn').addEventListener('click', () => {
        unlockAudio();
        G.score = 0;
        startLevel(1);
    });
    document.getElementById('mute-btn').addEventListener('click', (e) => {
        Audio.setMuted(!Audio.isMuted());
        e.target.textContent = Audio.isMuted() ? '🔇 Sound off' : '🔊 Sound on';
    });
}

function showLevelCompleteOverlay() {
    const isBossLevel = G.cats.some(c => c.type.isBoss);
    overlayCard.innerHTML = `
        <h1>${isBossLevel ? 'Boss caught!' : 'Level cleared!'}</h1>
        <p class="result">
            Score
            <span class="big">${G.score}</span>
            ${G.bestScore === G.score && G.score > 0 ? '<span class="best-tag">NEW BEST</span>' : ''}
        </p>
        <div class="stat-row">
            <div><span class="lbl">Level</span><span class="val">${G.level}</span></div>
            <div><span class="lbl">Time</span><span class="val">${G.levelTime.toFixed(1)}s</span></div>
            <div><span class="lbl">Best</span><span class="val">${G.bestScore}</span></div>
        </div>
        <button id="next-btn">Level ${G.level + 1} →</button>
    `;
    overlay.classList.add('show');
    document.getElementById('next-btn').addEventListener('click', () => {
        startLevel(G.level + 1);
    });
}

function hideOverlay() { overlay.classList.remove('show'); }

function updateHud() {
    if (G.stage === 'playing' && G.cats.length) {
        // Aggregate progress over all alive cats
        const remaining = G.cats.filter(c => !c.captured);
        const totalLoops = remaining.reduce((a, c) => a + c.type.loops, 0);
        const doneLoops = remaining.reduce((a, c) => a + c.captureProgress, 0);
        const allLoops = G.cats.reduce((a, c) => a + c.type.loops, 0);
        const allDone = G.cats.reduce((a, c) => a + (c.captured ? c.type.loops : c.captureProgress), 0);
        const pct = allLoops ? (allDone / allLoops) : 0;
        meterFill.style.width = (pct * 100).toFixed(1) + '%';
        meterLabelEl.textContent = `Capture`;
        loopCountEl.textContent = `Score: ${G.score}`;
        levelEl.textContent = `Level: ${G.level}`;
        timeEl.textContent = G.combo > 1 ? `Combo ×${G.combo}!` : `Cats: ${remaining.length}/${G.cats.length}`;
    }
}

// ---------- Background ----------
function drawBackground(time) {
    ctx.save();
    // Stars (always twinkling)
    for (const s of G.bg.stars) {
        const x = (s.x + time * 6) % (W + 40) - 20;
        const y = (s.y + time * 3) % (H + 40) - 20;
        const a = s.a * (0.6 + 0.4 * Math.sin(s.tw + time * 1.5)) * 0.5;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, TAU);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Per-level scene
    const scene = SCENES[G.scene];
    if (scene) scene.draw(ctx, time);
    // Floor glow under cats
    for (const cat of G.cats) {
        if (cat.captured) continue;
        const grd = ctx.createRadialGradient(cat.x, cat.y + cat.size * 0.7, 0, cat.x, cat.y + cat.size * 0.7, cat.size * 1.6);
        grd.addColorStop(0, 'rgba(0,0,0,0.35)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(cat.x, cat.y + cat.size * 0.7, cat.size * 1.4, cat.size * 0.4, 0, 0, TAU);
        ctx.fill();
    }
    // Combo aura
    if (G.combo > 2) {
        const a = Math.min(0.18, G.combo * 0.014);
        const grd2 = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
        grd2.addColorStop(0, `rgba(255,180,80,${a})`);
        grd2.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = grd2;
        ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
}

function updateDust(dt) {
    for (const d of G.bg.dust) {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.x < -10) d.x = W + 10;
        if (d.x > W + 10) d.x = -10;
        if (d.y < -10) d.y = H + 10;
        if (d.y > H + 10) d.y = -10;
    }
}

function drawDust() {
    ctx.save();
    ctx.fillStyle = '#fff';
    for (const d of G.bg.dust) {
        ctx.globalAlpha = d.a;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fill();
    }
    ctx.restore();
}

// ---------- Trail rendering ----------
function drawTrail() {
    // Active trail
    if (G.trail.length >= 2) drawSinglePolyline(G.trail, 1, false);
    // Ghost trails
    for (const g of G.ghostTrails) {
        const a = 1 - g.age / g.life;
        drawSinglePolyline(g.pts, a, g.broken);
    }
}

function drawSinglePolyline(pts, alpha, broken) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const color = broken ? '255,80,80' : '255,50,70';
    // Wide outer glow
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = `rgba(${color},${0.18 * alpha})`;
    ctx.lineWidth = 22;
    ctx.shadowBlur = 30;
    ctx.shadowColor = broken ? '#ff4444' : '#ff2244';
    ctx.stroke();
    // Inner core
    ctx.shadowBlur = 0;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = broken ? `rgba(255,180,180,${0.85 * alpha})` : `rgba(255,200,210,${0.85 * alpha})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
}

function drawLaser() {
    const laser = G.laser;
    if (!laser.active) return;
    ctx.save();
    const g = ctx.createRadialGradient(laser.x, laser.y, 0, laser.x, laser.y, 40);
    g.addColorStop(0, laser.drawing ? 'rgba(255, 60, 80, 0.9)' : 'rgba(255, 60, 80, 0.55)');
    g.addColorStop(0.4, 'rgba(255, 30, 60, 0.32)');
    g.addColorStop(1, 'rgba(255, 0, 30, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(laser.x, laser.y, 40, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 16;
    ctx.shadowColor = '#ff2244';
    ctx.beginPath();
    ctx.arc(laser.x, laser.y, laser.drawing ? 5 : 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
}

// ---------- Particles + floats + shockwaves ----------
function drawParticles() {
    for (const p of G.particles) {
        const a = 1 - p.age / p.life;
        ctx.save();
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 6;
        ctx.shadowColor = p.color;
        if (p.shape === 'sparkle') {
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillRect(-p.size, -p.size * 0.3, p.size * 2, p.size * 0.6);
            ctx.fillRect(-p.size * 0.3, -p.size, p.size * 0.6, p.size * 2);
        } else if (p.shape === 'heart') {
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            const s = p.size;
            ctx.beginPath();
            ctx.moveTo(0, s * 0.5);
            ctx.bezierCurveTo(-s * 1.4, -s, -s * 1.2, -s * 1.7, 0, -s * 0.7);
            ctx.bezierCurveTo(s * 1.2, -s * 1.7, s * 1.4, -s, 0, s * 0.5);
            ctx.fill();
        } else {
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        }
        ctx.restore();
    }
    for (const f of G.floats) {
        const a = 1 - f.age / f.life;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.font = `bold ${f.size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
    }
    for (const s of G.shockwaves) {
        const a = 1 - s.age / s.life;
        const r = s.radius * (s.age / s.life);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 4 * a;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, TAU);
        ctx.stroke();
        ctx.restore();
    }
}

function updateParticles(dt) {
    for (let i = G.particles.length - 1; i >= 0; i--) {
        const p = G.particles[i];
        p.age += dt;
        if (p.age >= p.life) { G.particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (p.gravity || 220) * dt;
        p.vx *= Math.pow(0.55, dt);
        p.rot += p.rotV * dt;
    }
    for (let i = G.floats.length - 1; i >= 0; i--) {
        const f = G.floats[i];
        f.age += dt;
        f.y += f.vy * dt;
        f.vy *= Math.pow(0.4, dt);
        if (f.age >= f.life) G.floats.splice(i, 1);
    }
    for (let i = G.shockwaves.length - 1; i >= 0; i--) {
        const s = G.shockwaves[i];
        s.age += dt;
        if (s.age >= s.life) G.shockwaves.splice(i, 1);
    }
    for (let i = G.ghostTrails.length - 1; i >= 0; i--) {
        const t = G.ghostTrails[i];
        t.age += dt;
        if (t.age >= t.life) G.ghostTrails.splice(i, 1);
    }
    // Cull captured cats once they've shrunk away
    for (let i = G.cats.length - 1; i >= 0; i--) {
        if (G.cats[i].captured && G.cats[i].size < 4) G.cats.splice(i, 1);
    }
}

// ---------- Input ----------
function pointerStart(e) {
    unlockAudio();
    const t = e.touches ? e.touches[0] : e;
    if (!t) return;
    const rect = canvas.getBoundingClientRect();
    const x = t.clientX - rect.left, y = t.clientY - rect.top;
    if (G.stage === 'playing') startDrawing(x, y);
    else { G.laser.x = x; G.laser.y = y; G.laser.active = true; }
    e.preventDefault();
}
function pointerMove(e) {
    const t = e.touches ? e.touches[0] : e;
    if (!t) return;
    const rect = canvas.getBoundingClientRect();
    const x = t.clientX - rect.left, y = t.clientY - rect.top;
    continueDrawing(x, y);
    e.preventDefault();
}
function pointerEnd(e) {
    if (G.stage === 'playing') endDrawing();
    if (e) e.preventDefault();
}

canvas.addEventListener('mousedown', pointerStart);
canvas.addEventListener('mousemove', pointerMove);
canvas.addEventListener('mouseup', pointerEnd);
canvas.addEventListener('mouseleave', () => { G.laser.active = false; if (G.laser.drawing) endDrawing(); });
canvas.addEventListener('touchstart', pointerStart, { passive: false });
canvas.addEventListener('touchmove', pointerMove, { passive: false });
canvas.addEventListener('touchend', pointerEnd, { passive: false });
canvas.addEventListener('touchcancel', pointerEnd, { passive: false });

window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
        Audio.setMuted(!Audio.isMuted());
    }
});

// ---------- Main loop ----------
let lastT = performance.now();
function frame(now) {
    let dt = (now - lastT) / 1000;
    if (dt > 0.1) dt = 0.1;
    lastT = now;

    if (G.hitstop > 0) {
        G.hitstop -= dt;
    } else {
        const eff = dt * G.slowmo;
        // updates
        if (G.stage === 'playing') {
            G.levelTime += eff;
            // Combo decay
            if (G.combo > 0) {
                G.comboTimer -= eff;
                if (G.comboTimer <= 0) G.combo = 0;
            }
        }
        for (const cat of G.cats) updateCat(cat, eff);
        updateParticles(eff);
        updateDust(eff);
        fireHook('onUpdate', eff);
        // Shake
        if (G.shakeT > 0) {
            G.shakeT -= eff;
            G.shakeAmp *= Math.pow(0.001, eff);
            G.shakeX = (Math.random() - 0.5) * G.shakeAmp;
            G.shakeY = (Math.random() - 0.5) * G.shakeAmp;
        } else {
            G.shakeAmp = 0; G.shakeX = 0; G.shakeY = 0;
        }
        // Flash
        if (G.flash > 0) G.flash = Math.max(0, G.flash - eff * 2.4);
        // Flow smoothing
        const target = clamp(G.combo / 8, 0, 1);
        G.flow += (target - G.flow) * Math.min(1, eff * 4);
        G.time += eff;
    }

    // Render
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(G.shakeX, G.shakeY);
    drawBackground(G.time);
    drawDust();
    drawTrail();
    // World-space additions (powerups, etc.)
    fireHook('onDraw', ctx);
    // Cats
    for (const cat of G.cats) drawCat(cat);
    drawParticles();
    drawLaser();
    ctx.restore();
    fireHook('onDrawHUD', ctx);

    // Flash overlay
    if (G.flash > 0) {
        ctx.fillStyle = `rgba(${G.flashColor},${G.flash})`;
        ctx.fillRect(0, 0, W, H);
    }

    updateHud();

    requestAnimationFrame(frame);
}

// ---------- Boot ----------
G.cats = [createCat('ginger', W / 2, H / 2 + 60)]; // idle preview cat behind menu
showMenuOverlay();
requestAnimationFrame(frame);

})();
