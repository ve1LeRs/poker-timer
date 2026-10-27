window.PokerAudio = (function () {
  let ctx = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function tone(freq, start, dur, type, gainValue, glideTo) {
    const audio = ensure();
    if (!audio) return;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const t0 = audio.currentTime + start;
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
    }
    const g = Math.max(0.0001, gainValue);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(g, t0 + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.05, dur));
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
  }

  function noiseBurst(start, dur, gainValue) {
    const audio = ensure();
    if (!audio) return;
    const len = Math.max(1, Math.floor(audio.sampleRate * dur));
    const buffer = audio.createBuffer(1, len, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const t0 = audio.currentTime + start;
    src.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = 900;
    gain.gain.setValueAtTime(Math.max(0.0001, gainValue), t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** Яркий сигнал смены игрового уровня / раунда */
  function playRoundChange(volume) {
    const v = Math.max(0, Math.min(1, volume));
    if (v <= 0) return;
    ensure();
    tone(392, 0, 0.12, "square", v * 0.28);
    tone(523.25, 0.11, 0.14, "square", v * 0.3);
    tone(659.25, 0.24, 0.16, "triangle", v * 0.34);
    tone(783.99, 0.38, 0.42, "sine", v * 0.4);
    noiseBurst(0.05, 0.08, v * 0.08);
  }

  /** Гонг на перерыв — ниже и дольше */
  function playBreak(volume) {
    const v = Math.max(0, Math.min(1, volume));
    if (v <= 0) return;
    ensure();
    tone(196, 0, 0.7, "sine", v * 0.42, 140);
    tone(246.94, 0.08, 0.75, "triangle", v * 0.28, 160);
    tone(164.81, 0.35, 0.85, "sine", v * 0.32);
    tone(130.81, 0.55, 0.9, "triangle", v * 0.22);
    noiseBurst(0.02, 0.18, v * 0.1);
  }

  function playLevelChange(volume, isBreak) {
    if (isBreak) playBreak(volume);
    else playRoundChange(volume);
  }

  function playWarning(volume) {
    const v = Math.max(0, Math.min(1, volume));
    if (v <= 0) return;
    ensure();
    tone(880, 0, 0.1, "square", v * 0.2);
    tone(880, 0.16, 0.1, "square", v * 0.16);
    tone(988, 0.32, 0.12, "square", v * 0.14);
  }

  function unlock() {
    const audio = ensure();
    if (!audio) return;
    // тихий тик — разблокировка автозвука в Safari/iOS
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.01);
  }

  return { playLevelChange, playRoundChange, playBreak, playWarning, unlock };
})();
