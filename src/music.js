// ============================================================
// music.js — Procedural ambient music for "Make the Cat Dizzy!"
// Self-contained: synthesizes everything via Web Audio.
// Plugs into window.MTCD hook API. Never modifies game.js.
// ============================================================
(() => {
'use strict';

// --------------------------------------------------------
// Wait for window.MTCD to exist (game.js may load just before us).
// --------------------------------------------------------
function whenReady(cb) {
    if (window.MTCD && window.MTCD.HOOKS) return cb();
    let tries = 0;
    const iv = setInterval(() => {
        if (window.MTCD && window.MTCD.HOOKS) { clearInterval(iv); cb(); }
        else if (++tries > 200) clearInterval(iv); // ~10s, give up silently
    }, 50);
}

whenReady(() => {
    const MTCD = window.MTCD;
    const G = MTCD.G;
    const HOOKS = MTCD.HOOKS;

    // ----------------------------------------------------
    // Music engine state
    // ----------------------------------------------------
    let actx = null;
    let master = null;       // master gain (envelope start/stop)
    let busLow = null;       // pad / bass bus
    let busHigh = null;      // arpeggio / lead bus
    let filterMain = null;   // global lowpass for color
    let started = false;
    let activeScene = null;  // last scene we configured for

    // Scheduler
    let nextNoteTime = 0;
    let stepIndex = 0;       // which 16th step in the bar
    let barIndex = 0;        // which bar in 4-bar progression
    let stepTime = 0.25;     // seconds per 16th-step (set by tempo)
    let scheduleHandle = null;

    // Envelope target (ramped towards in onUpdate)
    let targetVolume = 0;    // 0 = stopped/muted, 1 = full
    let currentVolume = 0;

    // Combo intensity (smoothed)
    let intensity = 0;       // 0..1 follows combo

    // ----------------------------------------------------
    // Scene -> palette mapping
    // Each palette has: tempoBpm, base midi root, scale degrees (semitones),
    //                   chord progression (offsets from root in semitones, per bar),
    //                   leadType (osc), padType, useNoise, octaveSpread.
    // ----------------------------------------------------
    // Scale presets (semitone offsets from root)
    const SCALES = {
        major:    [0, 2, 4, 5, 7, 9, 11],
        minor:    [0, 2, 3, 5, 7, 8, 10],
        dorian:   [0, 2, 3, 5, 7, 9, 10],
        phrygian: [0, 1, 3, 5, 7, 8, 10],
    };

    // Chord progressions (root semitone offsets per bar, 4 bars).
    const PROG = {
        I_vi_IV_V:    [0, 9, 5, 7],     // major / pop
        i_VI_III_VII: [0, 8, 3, 10],    // minor / cinematic
        i_iv_VI_v:    [0, 5, 8, 7],     // dorian-ish
        i_II_VI_VII:  [0, 1, 8, 10],    // phrygian / mysterious
        i_v_iv_i:     [0, 7, 5, 0],     // boss driving
    };

    const PALETTES = {
        livingRoom: {
            bpm: 70,  rootMidi: 60, scale: 'major',    prog: 'I_vi_IV_V',
            padType: 'sine',     leadType: 'sine',     useNoise: false, sparse: 0.55,
        },
        garden: {
            bpm: 84,  rootMidi: 67, scale: 'major',    prog: 'I_vi_IV_V',
            padType: 'triangle', leadType: 'triangle', useNoise: false, sparse: 0.7, birds: true,
        },
        kitchen: {
            bpm: 76,  rootMidi: 62, scale: 'dorian',   prog: 'i_iv_VI_v',
            padType: 'sine',     leadType: 'sine',     useNoise: false, sparse: 0.65, glassy: true,
        },
        bedroom: {
            bpm: 56,  rootMidi: 57, scale: 'minor',    prog: 'i_VI_III_VII',
            padType: 'sine',     leadType: 'sine',     useNoise: false, sparse: 0.4,  low: true,
        },
        attic: {
            bpm: 64,  rootMidi: 52, scale: 'phrygian', prog: 'i_II_VI_VII',
            padType: 'square',   leadType: 'triangle', useNoise: true,  sparse: 0.5,
        },
        arena: {
            bpm: 124, rootMidi: 52, scale: 'minor',    prog: 'i_v_iv_i',
            padType: 'square',   leadType: 'square',   useNoise: false, sparse: 0.95, kick: true,
        },
    };

    function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    // ----------------------------------------------------
    // Lazy AudioContext init
    // ----------------------------------------------------
    function initAudio() {
        if (actx) return;
        try {
            actx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { return; }

        master = actx.createGain();
        master.gain.value = 0;            // ramped up later
        master.connect(actx.destination);

        filterMain = actx.createBiquadFilter();
        filterMain.type = 'lowpass';
        filterMain.frequency.value = 1400;
        filterMain.Q.value = 0.6;
        filterMain.connect(master);

        busLow = actx.createGain();
        busLow.gain.value = 0.55;
        busLow.connect(filterMain);

        busHigh = actx.createGain();
        busHigh.gain.value = 0.40;
        busHigh.connect(filterMain);
    }

    // ----------------------------------------------------
    // Note voice: a small osc + envelope -> bus
    // ----------------------------------------------------
    function playNote(time, midi, opts) {
        if (!actx) return;
        const o = opts || {};
        const type = o.type || 'sine';
        const dur = o.dur || 0.6;
        const vol = (o.vol == null) ? 0.18 : o.vol;
        const bus = o.bus || busLow;

        const osc = actx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(midiToFreq(midi), time);

        const g = actx.createGain();
        const att = o.attack || 0.02;
        const dec = o.decay  || 0.40;
        // ADSR-ish: 0 -> peak (att) -> sustain*peak (dec) -> 0 (release rest of dur)
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(vol, time + att);
        g.gain.linearRampToValueAtTime(vol * 0.55, time + att + dec);
        g.gain.linearRampToValueAtTime(0.0001, time + dur);

        osc.connect(g).connect(bus);
        osc.start(time);
        osc.stop(time + dur + 0.05);
    }

    // Bird-ish chirp (garden)
    function playBird(time) {
        if (!actx) return;
        const osc = actx.createOscillator();
        osc.type = 'sine';
        const f0 = 1800 + Math.random() * 1200;
        osc.frequency.setValueAtTime(f0, time);
        osc.frequency.exponentialRampToValueAtTime(f0 * 1.4, time + 0.06);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.9, time + 0.18);
        const g = actx.createGain();
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(0.06, time + 0.01);
        g.gain.linearRampToValueAtTime(0.0001, time + 0.18);
        osc.connect(g).connect(busHigh);
        osc.start(time);
        osc.stop(time + 0.22);
    }

    // Filtered noise hit (attic)
    function playNoiseHit(time, dur, freq, vol) {
        if (!actx) return;
        const len = Math.max(1, Math.floor(actx.sampleRate * dur));
        const buf = actx.createBuffer(1, len, actx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
        const src = actx.createBufferSource();
        src.buffer = buf;
        const f = actx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = 0.7;
        const g = actx.createGain();
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(vol, time + 0.005);
        g.gain.linearRampToValueAtTime(0.0001, time + dur);
        src.connect(f).connect(g).connect(busHigh);
        src.start(time);
    }

    // Kick-ish thump (arena)
    function playKick(time) {
        if (!actx) return;
        const osc = actx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, time);
        osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
        const g = actx.createGain();
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(0.32, time + 0.005);
        g.gain.linearRampToValueAtTime(0.0001, time + 0.18);
        osc.connect(g).connect(busLow);
        osc.start(time);
        osc.stop(time + 0.22);
    }

    // ----------------------------------------------------
    // Scheduler — schedules one 16th-step at a time, 4 bars looping.
    // 16 steps per bar, 4 bars = 64 steps total before looping.
    // ----------------------------------------------------
    function getPalette() {
        return PALETTES[G.scene] || PALETTES.livingRoom;
    }

    function scheduleStep(step, bar, when) {
        const pal = getPalette();
        const scale = SCALES[pal.scale] || SCALES.major;
        const prog = PROG[pal.prog] || PROG.I_vi_IV_V;
        const chordRoot = pal.rootMidi + prog[bar % 4];

        // Bass note on beat 0 and 8 of each bar
        if (step === 0 || step === 8) {
            const bassOct = pal.low ? -24 : -12;
            playNote(when, chordRoot + bassOct, {
                type: pal.padType,
                dur: pal.low ? 2.8 : 1.6,
                vol: 0.12,
                attack: 0.05,
                decay: 0.6,
                bus: busLow,
            });
        }

        // Pad chord on beat 0 of each bar (root + third + fifth from scale)
        if (step === 0) {
            const third = scale[2];
            const fifth = scale[4];
            const padDur = (60 / pal.bpm) * 4 + 0.2; // ~1 bar
            playNote(when, chordRoot,         { type: pal.padType, dur: padDur, vol: 0.06, attack: 0.4, decay: 0.6, bus: busLow });
            playNote(when, chordRoot + third, { type: pal.padType, dur: padDur, vol: 0.05, attack: 0.5, decay: 0.6, bus: busLow });
            playNote(when, chordRoot + fifth, { type: pal.padType, dur: padDur, vol: 0.05, attack: 0.6, decay: 0.6, bus: busLow });
        }

        // Arpeggio: every 2 steps (8th notes), plays scale notes around chord root.
        // Sparseness gates whether a note actually plays.
        const arpStride = intensity > 0.55 ? 1 : 2; // double-time when combo high
        if (step % arpStride === 0) {
            const playProb = pal.sparse * (0.6 + intensity * 0.5);
            if (Math.random() < playProb) {
                // Choose a scale degree near the chord root.
                const degIdx = (step / arpStride + bar) % scale.length;
                const octBoost = intensity > 0.7 ? 12 : 0;
                const note = chordRoot + scale[degIdx] + octBoost;
                playNote(when, note, {
                    type: pal.leadType,
                    dur: 0.5 + Math.random() * 0.2,
                    vol: 0.10 + intensity * 0.05,
                    attack: 0.02,
                    decay: 0.30,
                    bus: busHigh,
                });
            }
        }

        // Glassy bell (kitchen): occasional high shimmer
        if (pal.glassy && step % 4 === 0 && Math.random() < 0.35) {
            playNote(when, chordRoot + 24 + scale[(bar + step) % scale.length], {
                type: 'sine', dur: 1.2, vol: 0.07, attack: 0.01, decay: 0.6, bus: busHigh,
            });
        }

        // Bird chirp (garden)
        if (pal.birds && Math.random() < 0.012) playBird(when);

        // Noise sweep (attic): rare bandpass blip
        if (pal.useNoise && step % 8 === 0 && Math.random() < 0.4) {
            playNoiseHit(when, 0.4, 600 + Math.random() * 1500, 0.06);
        }

        // Kick (arena): four-on-the-floor on beats 0,4,8,12
        if (pal.kick && step % 4 === 0) {
            playKick(when);
        }
    }

    function tick() {
        if (!actx || !started) return;

        // Update tempo from scene (in case scene changed mid-game)
        const pal = getPalette();
        // 16th-note step time in seconds
        stepTime = (60 / pal.bpm) / 4;

        // Lookahead: schedule notes up to ~0.2s in the future.
        const horizon = actx.currentTime + 0.2;
        while (nextNoteTime < horizon) {
            scheduleStep(stepIndex, barIndex, nextNoteTime);
            nextNoteTime += stepTime;
            stepIndex++;
            if (stepIndex >= 16) {
                stepIndex = 0;
                barIndex = (barIndex + 1) % 4;
            }
        }

        scheduleHandle = setTimeout(tick, 50);
    }

    // ----------------------------------------------------
    // Mute polling (localStorage + MTCD.audio().isMuted())
    // ----------------------------------------------------
    function isMuted() {
        try {
            if (localStorage.getItem('mtcd_muted') === '1') return true;
        } catch (_) {}
        try {
            const a = MTCD.audio && MTCD.audio();
            if (a && typeof a.isMuted === 'function' && a.isMuted()) return true;
        } catch (_) {}
        return false;
    }

    // ----------------------------------------------------
    // Start/stop control (called by hooks)
    // ----------------------------------------------------
    function startMusic() {
        initAudio();
        if (!actx) return;
        if (actx.state === 'suspended') { try { actx.resume(); } catch (_) {} }

        // Reset scheduler clock to "now" so we don't dump a flood of catch-up notes.
        nextNoteTime = actx.currentTime + 0.05;
        stepIndex = 0;
        barIndex = 0;

        if (!started) {
            started = true;
            tick();
        }
        targetVolume = 1;
    }

    function stopMusic() {
        targetVolume = 0;
        // Fully halt the scheduler once gain has rolled off (handled in onUpdate).
    }

    function duck(amount, hold) {
        // Drop master briefly then recover.
        if (!master || !actx) return;
        const t = actx.currentTime;
        const cur = master.gain.value;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(cur, t);
        master.gain.linearRampToValueAtTime(cur * (1 - amount), t + 0.05);
        master.gain.linearRampToValueAtTime(cur, t + 0.05 + (hold || 0.3));
    }

    // ----------------------------------------------------
    // Master volume ramping + intensity smoothing (via onUpdate)
    // ----------------------------------------------------
    function applyEnvelope(dt) {
        if (!actx || !master) return;

        // Mute check overrides target.
        const muted = isMuted();
        const desired = muted ? 0 : targetVolume;

        // Ramp currentVolume toward desired at different speeds for in vs out.
        const rampUpPerSec = 1 / 1.5;   // up over 1.5s
        const rampDnPerSec = 1 / 0.5;   // down over 0.5s
        if (currentVolume < desired) {
            currentVolume = Math.min(desired, currentVolume + rampUpPerSec * dt);
        } else if (currentVolume > desired) {
            currentVolume = Math.max(desired, currentVolume - rampDnPerSec * dt);
        }

        const masterTarget = currentVolume * 0.18;  // master ~0.18 (low under SFX)
        // Use setTargetAtTime for smooth value changes alongside any duck ramps.
        master.gain.setTargetAtTime(masterTarget, actx.currentTime, 0.05);

        // If fully faded out and we're stopped, halt the scheduler entirely.
        if (started && currentVolume <= 0.001 && targetVolume === 0) {
            started = false;
            if (scheduleHandle) { clearTimeout(scheduleHandle); scheduleHandle = null; }
        }
    }

    function applyIntensity(dt) {
        if (!actx || !filterMain || !busHigh) return;
        // Map combo to 0..1 (combo of 12+ is "max")
        const target = Math.min(1, (G.combo || 0) / 10);
        // Smooth (ease toward target)
        intensity += (target - intensity) * Math.min(1, dt * 2);

        // Open the filter when intensity is high (color change)
        const fmin = 900, fmax = 3000;
        const cutoff = fmin + (fmax - fmin) * intensity;
        filterMain.frequency.setTargetAtTime(cutoff, actx.currentTime, 0.1);

        // High bus a bit louder when energetic
        const hi = 0.30 + 0.30 * intensity;
        busHigh.gain.setTargetAtTime(hi, actx.currentTime, 0.1);
    }

    // ----------------------------------------------------
    // Hook wiring
    // ----------------------------------------------------
    if (Array.isArray(HOOKS.onLevelStart)) {
        HOOKS.onLevelStart.push((n) => {
            // Lazy-init AudioContext here — guaranteed to be after a user gesture.
            startMusic();
            activeScene = G.scene;
        });
    }

    if (Array.isArray(HOOKS.onCapture)) {
        HOOKS.onCapture.push((cat, bonus) => {
            // Accent sting: schedule a quick high arpeggio over the current chord.
            if (!actx || !started) return;
            const pal = getPalette();
            const scale = SCALES[pal.scale] || SCALES.major;
            const prog = PROG[pal.prog] || PROG.I_vi_IV_V;
            const root = pal.rootMidi + prog[barIndex % 4] + 12;
            const t = actx.currentTime + 0.02;
            const notes = [scale[0], scale[2], scale[4], scale[6] || scale[0] + 12];
            notes.forEach((s, i) => {
                playNote(t + i * 0.07, root + s, {
                    type: 'triangle', dur: 0.4, vol: 0.10,
                    attack: 0.005, decay: 0.2, bus: busHigh,
                });
            });
        });
    }

    if (Array.isArray(HOOKS.onLineBreak)) {
        HOOKS.onLineBreak.push((reason) => {
            // Briefly duck the music to let the SFX punch through.
            duck(0.6, 0.35);
        });
    }

    if (Array.isArray(HOOKS.onUpdate)) {
        HOOKS.onUpdate.push((dt) => {
            const ddt = (dt && dt > 0 && dt < 0.5) ? dt : 0.016;
            applyEnvelope(ddt);
            applyIntensity(ddt);

            // Stage-driven start/stop
            if (G.stage === 'playing') {
                if (!started || targetVolume === 0) startMusic();
            } else if (G.stage === 'levelComplete' || G.stage === 'menu' || G.stage === 'gameOver') {
                if (targetVolume !== 0) stopMusic();
            }

            // Scene change while playing -> reset bar so chords realign cleanly
            if (G.scene !== activeScene) {
                activeScene = G.scene;
                stepIndex = 0;
                barIndex = 0;
                if (actx) nextNoteTime = actx.currentTime + 0.05;
            }
        });
    }

    // Expose a tiny debug surface (non-essential)
    window.MTCD.music = {
        start: startMusic,
        stop: stopMusic,
        duck,
        get intensity() { return intensity; },
        get scene() { return G.scene; },
    };
});

})();
