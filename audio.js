let audioCtx = null;

export function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

export function playSound(type, volume = 0.3) {
    if (!audioCtx) return;
    try {
        const gain = audioCtx.createGain();
        gain.connect(audioCtx.destination);

        // ── Вспомогательные генераторы ────────────────────────────────────────

        const makeNoiseBuf = (dur, decay = 5) => {
            const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur | 0, audioCtx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++)
                d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * decay);
            return buf;
        };

        const playOsc = (freq, type, dur, freqEnd) => {
            const o = audioCtx.createOscillator();
            o.type = type;
            o.frequency.setValueAtTime(freq, audioCtx.currentTime);
            if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + dur);
            gain.gain.setValueAtTime(volume, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
            o.connect(gain); o.start(); o.stop(audioCtx.currentTime + dur);
        };

        const playNoise = (dur, decay) => {
            const src = audioCtx.createBufferSource();
            src.buffer = makeNoiseBuf(dur, decay);
            gain.gain.setValueAtTime(volume, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
            src.connect(gain); src.start();
        };

        const playFilteredNoise = (dur, freq, decay, q = 1) => {
            const src = audioCtx.createBufferSource();
            src.buffer = makeNoiseBuf(dur, decay);
            const filt = audioCtx.createBiquadFilter();
            filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = q;
            src.connect(filt); filt.connect(gain);
            gain.gain.setValueAtTime(volume, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
            src.start();
        };

        // Отдельный gain-нод для отложенных звуков
        const delayed = (ms, fn) => setTimeout(() => { if (audioCtx) fn(); }, ms);

        const makeDelayedNoise = (ms, dur, decay, filterFn, vol) => delayed(ms, () => {
            const g2  = audioCtx.createGain();
            g2.connect(audioCtx.destination);
            const buf = makeNoiseBuf(dur, decay);
            const src = audioCtx.createBufferSource();
            src.buffer = buf;
            g2.gain.setValueAtTime(vol ?? volume, audioCtx.currentTime);
            g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
            filterFn ? filterFn(src, g2) : src.connect(g2);
            src.start();
        });

        // ── Типы звуков ───────────────────────────────────────────────────────

        switch (type) {

            case 'break_stone':
                playFilteredNoise(.22, 180 + Math.random()*80, 6, 1.5);
                makeDelayedNoise(30, .05, 20, null, volume*.5);
                break;

            case 'break_dirt':
                playFilteredNoise(.16, 120 + Math.random()*60, 8, 2);
                break;

            case 'break_grass':
                playFilteredNoise(.14, 600 + Math.random()*400, 10, 3);
                makeDelayedNoise(20, .08, 12, (src, g) => {
                    const f = audioCtx.createBiquadFilter();
                    f.type = 'lowpass'; f.frequency.value = 200;
                    src.connect(f); f.connect(g);
                }, volume*.35);
                break;

            case 'break_wood':
                playFilteredNoise(.18, 250 + Math.random()*120, 7, 2);
                makeDelayedNoise(55, .10, 9, (src, g) => {
                    const f = audioCtx.createBiquadFilter();
                    f.type = 'bandpass'; f.frequency.value = 300 + Math.random()*100; f.Q.value = 1.5;
                    src.connect(f); f.connect(g);
                }, volume*.55);
                break;

            case 'break_leaves':
                playFilteredNoise(.20, 1200 + Math.random()*800, 8, 4);
                makeDelayedNoise(30, .12, 12, (src, g) => {
                    const f = audioCtx.createBiquadFilter();
                    f.type = 'highpass'; f.frequency.value = 800;
                    src.connect(f); f.connect(g);
                }, volume*.4);
                break;

            case 'break_sand':
                playFilteredNoise(.18, 500 + Math.random()*300, 7, 5);
                break;

            case 'break_gravel':
                playFilteredNoise(.20, 200 + Math.random()*100, 6, 2);
                // второй слой — только фильтрованный шум
                delayed(40, () => playFilteredNoise(.10, 150, 9, 1.5));
                break;

            case 'break_snow':
                playFilteredNoise(.14, 800 + Math.random()*400, 11, 6);
                break;

            case 'break_glass': {
                playOsc(1800 + Math.random()*400, 'sine', .3);
                makeDelayedNoise(20, .15, 8, (src, g) => {
                    const f = audioCtx.createBiquadFilter();
                    f.type = 'highpass'; f.frequency.value = 2000;
                    src.connect(f); f.connect(g);
                }, volume*.4);
                break;
            }

            case 'break_water': {
                playFilteredNoise(.20, 400 + Math.random()*200, 6, 3);
                delayed(0, () => {
                    const g2 = audioCtx.createGain();
                    g2.connect(audioCtx.destination);
                    const o = audioCtx.createOscillator();
                    o.type = 'sine';
                    o.frequency.setValueAtTime(350, audioCtx.currentTime);
                    o.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + .15);
                    g2.gain.setValueAtTime(volume*.3, audioCtx.currentTime);
                    g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + .15);
                    o.connect(g2); o.start(); o.stop(audioCtx.currentTime + .15);
                });
                break;
            }

            case 'hit':
                playOsc(400 + Math.random()*200, 'sawtooth', .05);
                break;

            case 'step': {
                const src = audioCtx.createBufferSource();
                src.buffer = makeNoiseBuf(.08, 8);
                const filt = audioCtx.createBiquadFilter();
                filt.type = 'lowpass';
                filt.frequency.value = 400 + Math.random()*200;
                src.connect(filt); filt.connect(gain);
                gain.gain.setValueAtTime(volume*.2, audioCtx.currentTime);
                src.start();
                break;
            }

            default: break;
        }
    } catch (e) { /* Игнорируем ошибки аудио */ }
}