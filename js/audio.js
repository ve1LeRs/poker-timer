window.PokerAudio = (function () {
  let ctx = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type, gainValue) {
    const audio = ensure();
    if (!audio) return;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, audio.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), audio.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + dur);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(audio.currentTime + start);
    osc.stop(audio.currentTime + start + dur + 0.02);
  }

  function playLevelChange(volume, isBreak) {
    const v = Math.max(0, Math.min(1, volume));
    if (v <= 0) return;
    ensure();
    if (isBreak) {
      tone(220, 0, 0.35, "triangle", v * 0.45);
      tone(330, 0.28, 0.4, "triangle", v * 0.4);
      tone(440, 0.55, 0.55, "sine", v * 0.5);
    } else {
      tone(523.25, 0, 0.18, "sine", v * 0.5);
      tone(659.25, 0.16, 0.2, "sine", v * 0.45);
      tone(783.99, 0.34, 0.35, "triangle", v * 0.55);
    }
  }

  function playWarning(volume) {
    const v = Math.max(0, Math.min(1, volume));
    if (v <= 0) return;
    ensure();
    tone(880, 0, 0.12, "square", v * 0.22);
    tone(880, 0.18, 0.12, "square", v * 0.18);
  }

  function unlock() {
    ensure();
  }

  return { playLevelChange, playWarning, unlock };
})();
