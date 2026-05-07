// ============================================================================
// daily.js — Daily Challenge mode for "Make the Cat Dizzy!"
// ----------------------------------------------------------------------------
// Self-contained module. Subscribes to window.MTCD hooks. Adds a floating
// "Today's Daily" entry point on the menu, picks a deterministic level for
// the current UTC date (seeded RNG), runs that level with a fresh score,
// and stores a per-day high score in localStorage under
//   mtcd_daily_<YYYY-MM-DD>
// ============================================================================
(function () {
    'use strict';

    if (!window.MTCD || !window.MTCD.HOOKS || !window.MTCD.G) {
        console.warn('[daily] window.MTCD not available; module disabled.');
        return;
    }

    const MTCD = window.MTCD;
    const G = MTCD.G;
    const HOOKS = MTCD.HOOKS;

    // ---- Seeded RNG (mulberry32) ---------------------------------------------
    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    function seedFromString(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
        return mulberry32(h);
    }

    // ---- Date helpers --------------------------------------------------------
    function todayKey() {
        const d = new Date();
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    function todayLabel(key) {
        // "MM-DD" portion of YYYY-MM-DD
        return key.slice(5);
    }

    // ---- Daily plan ----------------------------------------------------------
    // Mirror enough of the game's CAT_TYPES catalog to preview a "today's
    // composition" without reaching into the IIFE. Names only — no rendering.
    const TYPE_NAMES = {
        ginger: 'Tabby', black: 'Shadow Cat', white: 'Snowpaw', calico: 'Patches',
        kitten: 'Kitten', persian: 'Persian', maine: 'Maine Boss', sphynx: 'Sphynx',
        russianblue: 'Russian Blue', ragdoll: 'Ragdoll', bengal: 'Bengal',
        tuxedo: 'Tuxedo', siamese: 'Siamese',
    };
    const POOL = ['ginger', 'black', 'white', 'calico', 'kitten', 'persian',
        'sphynx', 'bengal', 'tuxedo', 'siamese', 'russianblue', 'ragdoll'];

    // Build a deterministic daily plan: pick a level number (1..20-ish) and a
    // five-cat preview for the modal. The actual cats spawned are determined
    // by the game's own levelSpec(level) — we just preview the *level* picked.
    function dailyPlan(key) {
        const rng = seedFromString(key);
        // Avoid level 1 (too easy) and the boss-only level (10) — keep it varied.
        const candidate = 2 + Math.floor(rng() * 18); // 2..19
        const level = candidate === 10 ? 11 : candidate;
        const preview = [];
        for (let i = 0; i < 5; i++) {
            preview.push(POOL[Math.floor(rng() * POOL.length)]);
        }
        // Also a flavor color for the badge so each day "feels" different.
        const hue = Math.floor(rng() * 360);
        return { level, preview, hue };
    }

    // ---- Persistence ---------------------------------------------------------
    function dailyStorageKey(key) { return `mtcd_daily_${key}`; }
    function readBest(key) {
        const v = parseInt(localStorage.getItem(dailyStorageKey(key)) || '0', 10);
        return Number.isFinite(v) && v > 0 ? v : 0;
    }
    function writeBest(key, score) {
        try { localStorage.setItem(dailyStorageKey(key), String(score | 0)); }
        catch (e) { /* ignore quota errors */ }
    }

    // ---- DOM: floating button on menu ---------------------------------------
    let btnEl = null;
    function ensureButton() {
        if (btnEl) return btnEl;
        btnEl = document.createElement('button');
        btnEl.id = 'mtcd-daily-btn';
        btnEl.type = 'button';
        btnEl.textContent = '\u{1F31F} Today’s Daily';
        Object.assign(btnEl.style, {
            position: 'fixed',
            left: '14px',
            bottom: '14px',
            zIndex: '11',
            padding: '10px 14px',
            borderRadius: '14px',
            border: '1px solid rgba(255,255,255,0.22)',
            background: 'linear-gradient(135deg, rgba(40,22,76,0.92), rgba(70,38,118,0.92))',
            color: '#ffe8a3',
            fontSize: '14px',
            fontWeight: '700',
            letterSpacing: '0.3px',
            cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(0,0,0,0.45), 0 0 0 0 rgba(255, 216, 77, 0.6)',
            backdropFilter: 'blur(6px)',
            transition: 'transform 0.1s ease, box-shadow 0.2s ease',
            display: 'none',
        });
        btnEl.addEventListener('mouseenter', () => {
            btnEl.style.transform = 'translateY(-2px)';
            btnEl.style.boxShadow = '0 10px 24px rgba(0,0,0,0.5), 0 0 0 3px rgba(255,216,77,0.18)';
        });
        btnEl.addEventListener('mouseleave', () => {
            btnEl.style.transform = '';
            btnEl.style.boxShadow = '0 6px 18px rgba(0,0,0,0.45)';
        });
        btnEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const A = MTCD.audio && MTCD.audio();
                if (A && A.SFX && A.SFX.click) A.SFX.click();
            } catch (_) { /* ignore */ }
            openIntro();
        });
        document.body.appendChild(btnEl);
        return btnEl;
    }

    function setButtonVisible(v) {
        ensureButton();
        btnEl.style.display = v ? 'block' : 'none';
    }

    // ---- DOM: intro modal ----------------------------------------------------
    let modalEl = null;
    function closeIntro() {
        if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
        modalEl = null;
    }
    function openIntro() {
        if (modalEl) return;
        const key = todayKey();
        const plan = dailyPlan(key);
        const best = readBest(key);
        const previewChips = plan.preview.map((id) => {
            const name = TYPE_NAMES[id] || id;
            return `<span class="chip" style="--chip:#f6a83d;background:rgba(255,255,255,0.10);color:#ffe8c8;border:1px solid rgba(255,255,255,0.18);padding:4px 10px;border-radius:10px;font-size:12px;font-weight:600;">${name}</span>`;
        }).join(' ');

        modalEl = document.createElement('div');
        modalEl.id = 'mtcd-daily-modal';
        Object.assign(modalEl.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '20',
            background: 'rgba(8, 4, 20, 0.78)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
        });
        const card = document.createElement('div');
        Object.assign(card.style, {
            maxWidth: '440px',
            width: '100%',
            background: 'linear-gradient(160deg, rgba(60, 30, 100, 0.95), rgba(30, 15, 60, 0.95))',
            border: `1px solid hsla(${plan.hue}, 70%, 70%, 0.35)`,
            borderRadius: '20px',
            padding: '26px 26px 22px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            color: '#f4e9ff',
            textAlign: 'center',
        });
        card.innerHTML = `
            <div style="font-size:11px;letter-spacing:1.5px;color:hsl(${plan.hue}, 80%, 78%);font-weight:700;text-transform:uppercase;margin-bottom:6px;">Daily Challenge</div>
            <h1 style="margin:0 0 4px;font-size:26px;background:linear-gradient(90deg,#ffd84d,#ff3b6e);-webkit-background-clip:text;background-clip:text;color:transparent;">Day ${todayLabel(key)}</h1>
            <p style="color:#b9a9d6;font-size:13px;margin:0 0 18px;">Same wave for every player today &middot; level ${plan.level}</p>
            <div style="margin:0 0 16px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;">${previewChips}</div>
            <div style="display:flex;gap:14px;justify-content:center;margin:14px 0 18px;">
                <div style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 14px;min-width:90px;">
                    <span style="display:block;font-size:11px;color:#b9a9d6;text-transform:uppercase;letter-spacing:0.5px;">Best Today</span>
                    <span style="display:block;font-size:18px;font-weight:700;color:#fff;margin-top:2px;">${best > 0 ? best : '—'}</span>
                </div>
                <div style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 14px;min-width:90px;">
                    <span style="display:block;font-size:11px;color:#b9a9d6;text-transform:uppercase;letter-spacing:0.5px;">Cats</span>
                    <span style="display:block;font-size:18px;font-weight:700;color:#fff;margin-top:2px;">${plan.preview.length}</span>
                </div>
            </div>
            <button id="mtcd-daily-play" style="background:linear-gradient(90deg,#ff6e3b,#ff3b6e);color:#fff;border:none;border-radius:12px;padding:12px 28px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(255,59,110,0.4);margin:4px;">Play Daily</button>
            <button id="mtcd-daily-cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.2);color:#b9a9d6;border-radius:12px;padding:10px 18px;font-size:14px;cursor:pointer;margin:4px;">Cancel</button>
        `;
        modalEl.appendChild(card);
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) closeIntro();
        });
        document.body.appendChild(modalEl);
        card.querySelector('#mtcd-daily-cancel').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeIntro();
        });
        card.querySelector('#mtcd-daily-play').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const A = MTCD.audio && MTCD.audio();
                if (A && A.SFX && A.SFX.click) A.SFX.click();
            } catch (_) { /* ignore */ }
            startDaily(plan, key);
        });
    }

    // ---- Starting a daily run ------------------------------------------------
    // game.js's startLevel() lives inside its IIFE. The cleanest hook is the
    // menu overlay's #start-btn: its click handler reads mtcd_max_level live
    // and calls startLevel(startAt). We temporarily swap that storage entry,
    // synthesize a click, then restore it — leaving the player's real progress
    // untouched.
    function startDaily(plan, key) {
        closeIntro();
        const startBtn = document.getElementById('start-btn');
        if (!startBtn) {
            // Menu isn't up; bail. Can't kick a level without the engine helper.
            console.warn('[daily] start button not found; cannot launch daily.');
            return;
        }
        const MAX_KEY = 'mtcd_max_level';
        const savedMax = localStorage.getItem(MAX_KEY);
        try {
            localStorage.setItem(MAX_KEY, String(plan.level));
            // Mark *before* the click so onLevelStart sees the daily flag.
            G.dailyMode = true;
            G.dailyKey = key;
            G.dailyPlan = plan;
            // Reset score-related state explicitly (start-btn does G.score=0).
            G.score = 0;
            startBtn.click();
        } finally {
            // Restore real max-level so the daily run doesn't bump it backward
            // (or forward, since the next levelComplete will write its own).
            if (savedMax === null) localStorage.removeItem(MAX_KEY);
            else localStorage.setItem(MAX_KEY, savedMax);
        }
    }

    // ---- Score recording on daily completion --------------------------------
    let scoredThisRun = false;
    HOOKS.onLevelStart.push(() => {
        scoredThisRun = false;
        // If the engine started a level for any reason while not in daily,
        // make sure the flag is clear so we don't false-positive later.
        if (!G.dailyMode) G.dailyKey = null;
    });

    HOOKS.onCapture.push(() => {
        if (!G.dailyMode || scoredThisRun) return;
        // Game decrements capturesLeft in its capture handler, which fires the
        // hook *after* the decrement. Detect end-of-wave here.
        if (G.capturesLeft <= 0) {
            scoredThisRun = true;
            const key = G.dailyKey || todayKey();
            const score = G.score | 0;
            const prev = readBest(key);
            const isBest = score > prev;
            if (isBest) writeBest(key, score);
            // Use the game's own float-text + a popup-ish badge.
            try {
                const sz = MTCD.canvasSize();
                const W = sz.W || window.innerWidth;
                if (MTCD.FX && MTCD.FX.floatText) {
                    MTCD.FX.floatText(W / 2, 120,
                        `DAILY ${score} · BEST ${Math.max(prev, score)}`,
                        isBest ? '#ffd84d' : '#7cd6ff', 22);
                }
                if (isBest && MTCD.FX && MTCD.FX.spawnConfetti) {
                    MTCD.FX.spawnConfetti(W / 2, 160, 36, { color: '#ffd84d', spread: 260 });
                }
            } catch (_) { /* ignore */ }
            // The run is "over" for our purposes — clear the flag so a player
            // who taps "Next Level" continues as a normal session.
            G.dailyMode = false;
        }
    });

    // ---- HUD badge while daily is active ------------------------------------
    HOOKS.onDrawHUD.push((c) => {
        if (!G.dailyMode || G.stage !== 'playing') return;
        const sz = MTCD.canvasSize();
        const W = sz.W || window.innerWidth;
        const x = W - 140, y = 64, w = 124, h = 28;
        c.save();
        c.fillStyle = 'rgba(20, 12, 40, 0.7)';
        c.strokeStyle = 'rgba(255, 216, 77, 0.7)';
        c.lineWidth = 1;
        c.beginPath();
        const r = 10;
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
        c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
        c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
        c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r);
        c.closePath();
        c.fill(); c.stroke();
        c.fillStyle = '#ffd84d';
        c.font = '700 13px -apple-system, system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('\u{1F31F} DAILY MODE', x + w / 2, y + h / 2);
        c.restore();
    });

    // ---- Show/hide the menu button via menu-stage detection -----------------
    HOOKS.onUpdate.push(() => {
        const overlay = document.getElementById('overlay');
        const onMenu = G.stage === 'menu' && overlay && overlay.classList.contains('show');
        setButtonVisible(!!onMenu);
    });

    // ---- Public surface for debug -------------------------------------------
    MTCD.daily = {
        todayKey,
        plan: () => dailyPlan(todayKey()),
        best: (k) => readBest(k || todayKey()),
        open: openIntro,
        close: closeIntro,
    };
})();
