(function () {
  "use strict";

  const STORAGE_KEY = "poker-timer-v1";
  const CUSTOM_KEY = "poker-timer-customs-v1";

  const $ = (id) => document.getElementById(id);

  const els = {
    board: $("board"),
    tournamentName: $("tournamentName"),
    levelLabel: $("levelLabel"),
    statusPill: $("statusPill"),
    clock: $("clock"),
    progressFill: $("progressFill"),
    blindsLabel: $("blindsLabel"),
    blindsValue: $("blindsValue"),
    anteValue: $("anteValue"),
    nextValue: $("nextValue"),
    playersValue: $("playersValue"),
    avgStackValue: $("avgStackValue"),
    elapsedValue: $("elapsedValue"),
    remainingValue: $("remainingValue"),
    btnPlay: $("btnPlay"),
    btnPrev: $("btnPrev"),
    btnNext: $("btnNext"),
    btnSkip: $("btnSkip"),
    btnPlayerMinus: $("btnPlayerMinus"),
    btnPlayerPlus: $("btnPlayerPlus"),
    btnSettings: $("btnSettings"),
    btnTheme: $("btnTheme"),
    btnFullscreen: $("btnFullscreen"),
    dialog: $("settingsDialog"),
    structureBody: document.querySelector("#structureTable tbody"),
    structureList: document.getElementById("structureList"),
    setPreset: $("setPreset"),
    setCustomList: $("setCustomList"),
    importFile: $("importFile")
  };

  function cloneLevels(levels) {
    return levels.map((l) => ({ ...l }));
  }

  function defaultState() {
    const preset = window.POKER_PRESETS.home;
    return {
      name: "Домашний турнир",
      levels: cloneLevels(preset.levels),
      levelIndex: 0,
      remainingMs: preset.levels[0].duration * 60 * 1000,
      running: false,
      endedAt: null,
      playersTotal: 9,
      playersLeft: 9,
      startStack: preset.startStack,
      soundEnabled: true,
      volume: 70,
      warningSeconds: 30,
      warningSound: true,
      theme: "dark",
      accent: "felt",
      clockFormat: "mm:ss",
      wakeLock: true,
      elapsedMs: 0,
      warningPlayedForLevel: -1,
      presetId: "home",
      finished: false,
      started: false
    };
  }

  let state = loadState();
  let raf = null;
  let lastTick = null;
  let wakeLockSentinel = null;
  let draftLevels = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      const merged = { ...base, ...parsed };
      if (!Array.isArray(merged.levels) || !merged.levels.length) {
        merged.levels = cloneLevels(window.POKER_PRESETS.home.levels);
      }
      merged.levels = merged.levels.map(normalizeLevel);
      merged.levelIndex = Math.max(0, Number(merged.levelIndex) || 0);
      merged.remainingMs = Math.max(0, Number(merged.remainingMs) || 0);
      merged.elapsedMs = Math.max(0, Number(merged.elapsedMs) || 0);
      merged.running = Boolean(merged.running);
      merged.finished = Boolean(merged.finished);
      merged.started = Boolean(merged.started) || merged.running || merged.elapsedMs > 0 || merged.levelIndex > 0;
      merged.endedAt = merged.endedAt ? Number(merged.endedAt) : null;
      merged.savedAt = merged.savedAt ? Number(merged.savedAt) : null;
      return merged;
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    if (state.running && state.endedAt) {
      state.remainingMs = Math.max(0, state.endedAt - Date.now());
    }
    const toSave = {
      ...state,
      savedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }

  /** После перезагрузки: догнать время и уровни, продолжить если шёл таймер */
  function catchUpFromStorage() {
    if (state.finished) {
      state.running = false;
      state.endedAt = null;
      state.remainingMs = 0;
      if (state.levelIndex < state.levels.length) {
        state.levelIndex = state.levels.length;
      }
      return;
    }

    const now = Date.now();
    if (state.savedAt && state.savedAt <= now) {
      const away = now - state.savedAt;
      if (state.running) state.elapsedMs += away;
    }

    if (!state.running) {
      state.endedAt = null;
      return;
    }

    if (!state.endedAt) {
      state.endedAt = now + state.remainingMs;
    }

    let end = state.endedAt;
    let guard = 0;
    while (end <= now && guard++ < 400) {
      if (state.levelIndex >= state.levels.length - 1) {
        state.finished = true;
        state.running = false;
        state.levelIndex = state.levels.length;
        state.remainingMs = 0;
        state.endedAt = null;
        if (state.soundEnabled) {
          window.setTimeout(() => {
            window.PokerAudio.unlock();
            window.PokerAudio.playTournamentEnd(state.volume / 100);
          }, 300);
        }
        return;
      }
      state.levelIndex += 1;
      state.warningPlayedForLevel = -1;
      end += levelDurationMs(state.levels[state.levelIndex]);
    }

    state.endedAt = end;
    state.remainingMs = Math.max(0, end - now);
  }

  function resumeIfNeeded() {
    if (!state.running || state.finished) return;
    lastTick = null;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    requestWakeLock();
  }

  function normalizeLevel(l) {
    return {
      duration: Math.max(1, Number(l.duration) || 1),
      sb: Math.max(0, Number(l.sb) || 0),
      bb: Math.max(0, Number(l.bb) || 0),
      ante: Math.max(0, Number(l.ante) || 0),
      isBreak: Boolean(l.isBreak)
    };
  }

  function formatNumber(n) {
    return new Intl.NumberFormat("ru-RU").format(Math.round(n));
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (state.clockFormat === "h:mm:ss" || h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    if (state.clockFormat === "m:ss") {
      return `${m + h * 60}:${pad(s)}`;
    }
    return `${pad(m + h * 60)}:${pad(s)}`;
  }

  function currentLevel() {
    return state.levels[state.levelIndex] || null;
  }

  function nextLevel() {
    return state.levels[state.levelIndex + 1] || null;
  }

  function levelDurationMs(level) {
    return (level?.duration || 0) * 60 * 1000;
  }

  function remainingTournamentMs() {
    let sum = Math.max(0, state.remainingMs);
    for (let i = state.levelIndex + 1; i < state.levels.length; i++) {
      sum += levelDurationMs(state.levels[i]);
    }
    return sum;
  }

  function playLevelIndex() {
    let n = 0;
    for (let i = 0; i <= state.levelIndex; i++) {
      if (!state.levels[i].isBreak) n++;
    }
    return n;
  }

  function syncRemainingFromClock() {
    if (!state.running || !state.endedAt) return;
    state.remainingMs = Math.max(0, state.endedAt - Date.now());
  }

  function applyTheme() {
    document.body.dataset.theme = state.theme;
    document.body.dataset.accent = state.accent;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      state.theme === "light" ? "#e7eadf" : "#0e120c"
    );
  }

  function flashLevelChange() {
    document.body.classList.remove("is-level-flash");
    void document.body.offsetWidth;
    document.body.classList.add("is-level-flash");
    window.setTimeout(() => document.body.classList.remove("is-level-flash"), 600);
  }

  function render() {
    syncRemainingFromClock();
    const level = currentLevel();
    const next = nextLevel();
    const isBreak = Boolean(level?.isBreak);

    document.body.classList.toggle("is-break", isBreak);

    if (!level) {
      els.levelLabel.textContent = "Конец";
      els.blindsLabel.textContent = "Турнир";
      els.blindsValue.textContent = "завершён";
      els.anteValue.textContent = "—";
      els.nextValue.textContent = "—";
      els.clock.textContent = "00:00";
      els.progressFill.style.transform = "scaleX(0)";
    } else if (isBreak) {
      els.levelLabel.textContent = "Перерыв";
      els.blindsLabel.textContent = "Статус";
      els.blindsValue.textContent = "BREAK";
      els.anteValue.textContent = "—";
    } else {
      els.levelLabel.textContent = `Уровень ${playLevelIndex()}`;
      els.blindsLabel.textContent = "Блайнды";
      els.blindsValue.textContent = `${formatNumber(level.sb)} / ${formatNumber(level.bb)}`;
      els.anteValue.textContent = level.ante > 0 ? formatNumber(level.ante) : "—";
    }

    if (next) {
      if (next.isBreak) {
        els.nextValue.textContent = `Перерыв · ${next.duration} мин`;
      } else {
        const ante = next.ante > 0 ? ` · анте ${formatNumber(next.ante)}` : "";
        els.nextValue.textContent = `${formatNumber(next.sb)} / ${formatNumber(next.bb)}${ante} · ${next.duration} мин`;
      }
    } else {
      els.nextValue.textContent = "Последний уровень";
    }

    els.clock.textContent = formatClock(state.remainingMs);
    els.clock.classList.toggle("warn", state.remainingMs <= state.warningSeconds * 1000 && state.remainingMs > 10000);
    els.clock.classList.toggle("critical", state.remainingMs <= 10000);

    const total = level ? levelDurationMs(level) : 1;
    const ratio = Math.max(0, Math.min(1, state.remainingMs / total));
    els.progressFill.style.transform = `scaleX(${ratio})`;

    els.playersValue.textContent = `${state.playersLeft} / ${state.playersTotal}`;
    const avg = state.playersLeft > 0 ? (state.startStack * state.playersTotal) / state.playersLeft : 0;
    els.avgStackValue.textContent = formatNumber(avg);
    els.elapsedValue.textContent = formatClock(state.elapsedMs);
    els.remainingValue.textContent = formatClock(remainingTournamentMs());

    els.statusPill.className = "status-pill";
    if (!level) {
      els.statusPill.textContent = "Финиш";
    } else if (isBreak) {
      els.statusPill.textContent = state.running ? "Перерыв" : "Перерыв · пауза";
      els.statusPill.classList.add("break");
    } else if (state.running) {
      els.statusPill.textContent = "Идёт";
      els.statusPill.classList.add("running");
    } else if (state.started && !state.finished) {
      els.statusPill.textContent = "Пауза";
      els.statusPill.classList.add("paused");
    } else {
      els.statusPill.textContent = "Готов";
    }

    document.body.classList.toggle("is-paused", Boolean(!state.running && state.started && !state.finished));

    els.btnPlay.textContent = state.running ? "Пауза" : "Старт";
    els.btnPlay.title = state.running ? "Пауза" : "Старт";
  }

  function finishTournament() {
    const alreadyDone = state.finished === true;
    pause();
    state.finished = true;
    state.levelIndex = state.levels.length;
    state.remainingMs = 0;
    state.endedAt = null;
    if (!alreadyDone && state.soundEnabled) {
      // сначала unlock в том же тике жеста/таймера, потом финишный звук
      window.PokerAudio.unlock();
      window.setTimeout(() => {
        window.PokerAudio.playTournamentEnd(Math.max(0.35, state.volume / 100));
      }, 40);
    }
    flashLevelChange();
    render();
    saveState();
  }

  function goToLevel(index, { auto = false, silent = false } = {}) {
    if (index < 0 || index >= state.levels.length) {
      if (index >= state.levels.length) {
        finishTournament();
      }
      return;
    }
    state.finished = false;
    const changed = index !== state.levelIndex;
    state.levelIndex = index;
    state.remainingMs = levelDurationMs(state.levels[index]);
    state.warningPlayedForLevel = -1;
    if (state.running) {
      state.endedAt = Date.now() + state.remainingMs;
    }
    if (changed && !silent && state.soundEnabled) {
      window.PokerAudio.unlock();
      window.PokerAudio.playLevelChange(
        state.volume / 100,
        Boolean(state.levels[index].isBreak)
      );
    }
    if (changed) flashLevelChange();
    render();
    saveState();
  }

  function advanceLevel() {
    if (state.levelIndex >= state.levels.length - 1) {
      finishTournament();
      return;
    }
    goToLevel(state.levelIndex + 1, { auto: true });
  }

  function tick(now) {
    if (!state.running) return;
    if (lastTick == null) lastTick = now;
    const delta = now - lastTick;
    lastTick = now;

    state.elapsedMs += delta;
    state.remainingMs = Math.max(0, (state.endedAt || Date.now()) - Date.now());

    if (
      state.warningSound &&
      state.soundEnabled &&
      state.warningSeconds > 0 &&
      state.warningPlayedForLevel !== state.levelIndex &&
      state.remainingMs <= state.warningSeconds * 1000 &&
      state.remainingMs > 0
    ) {
      state.warningPlayedForLevel = state.levelIndex;
      window.PokerAudio.playWarning(state.volume / 100);
    }

    if (state.remainingMs <= 0) {
      advanceLevel();
    } else {
      render();
    }

    raf = requestAnimationFrame(tick);
  }

  async function requestWakeLock() {
    if (!state.wakeLock || !("wakeLock" in navigator)) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", () => {
        wakeLockSentinel = null;
      });
    } catch {
      /* ignore */
    }
  }

  function releaseWakeLock() {
    wakeLockSentinel?.release?.();
    wakeLockSentinel = null;
  }

  function play() {
    if (state.finished) return;
    const level = currentLevel();
    if (!level) return;
    if (state.remainingMs <= 0) {
      state.remainingMs = levelDurationMs(level);
    }
    window.PokerAudio.unlock();
    state.started = true;
    state.running = true;
    state.endedAt = Date.now() + state.remainingMs;
    lastTick = null;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    requestWakeLock();
    render();
    saveState();
  }

  function pause() {
    syncRemainingFromClock();
    state.running = false;
    state.endedAt = null;
    cancelAnimationFrame(raf);
    raf = null;
    lastTick = null;
    releaseWakeLock();
    render();
    saveState();
  }

  let lastToggleAt = 0;
  function togglePlay() {
    const now = Date.now();
    // страховка от двойного жеста (touch → click) на iPad/Safari
    if (now - lastToggleAt < 450) return;
    lastToggleAt = now;
    if (state.running) pause();
    else play();
  }

  function fillPresetSelect() {
    els.setPreset.innerHTML = "";
    Object.values(window.POKER_PRESETS).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === state.presetId) opt.selected = true;
      els.setPreset.appendChild(opt);
    });
    renderPresetChips();
  }

  function renderPresetChips() {
    const wrap = $("presetChips");
    if (!wrap) return;
    wrap.innerHTML = "";
    Object.values(window.POKER_PRESETS).forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `preset-chip${p.id === state.presetId ? " is-active" : ""}`;
      btn.dataset.id = p.id;
      btn.textContent = p.name;
      btn.addEventListener("click", () => loadPreset(p.id));
      wrap.appendChild(btn);
    });
  }

  function loadPreset(id) {
    const preset = window.POKER_PRESETS[id];
    if (!preset) return;
    draftLevels = cloneLevels(preset.levels);
    state.presetId = preset.id;
    $("setStartStack").value = preset.startStack;
    if (els.setPreset) els.setPreset.value = preset.id;
    renderStructureTable(draftLevels);
    renderPresetChips();
  }

  function showSettingsTab(name) {
    document.querySelectorAll(".settings-tabs .tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === name);
    });
    if (name === "sound") window.PokerAudio.unlock();
  }

  function loadCustoms() {
    try {
      return JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveCustoms(map) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(map));
  }

  function refreshCustomList() {
    const map = loadCustoms();
    els.setCustomList.innerHTML = "";
    const names = Object.keys(map).sort((a, b) => a.localeCompare(b, "ru"));
    if (!names.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Нет сохранённых";
      els.setCustomList.appendChild(opt);
      return;
    }
    names.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      els.setCustomList.appendChild(opt);
    });
  }

  function renderStructureTable(levels) {
    const list = document.getElementById("structureList");
    if (list) {
      list.innerHTML = "";
      let playNum = 0;
      levels.forEach((level, index) => {
        if (!level.isBreak) playNum += 1;
        const title = level.isBreak ? "Перерыв" : `Уровень ${playNum}`;
        const row = document.createElement("article");
        row.className = `level-card${level.isBreak ? " is-break-row" : ""}`;
        row.innerHTML = `
          <div class="level-card-head">
            <strong>${title}</strong>
            <div class="row-actions">
              <button type="button" data-act="up" data-i="${index}" title="Вверх">↑</button>
              <button type="button" data-act="down" data-i="${index}" title="Вниз">↓</button>
              <button type="button" data-act="del" data-i="${index}" title="Удалить">×</button>
            </div>
          </div>
          <div class="level-card-grid">
            <label>
              <span>Минуты</span>
              <input type="number" min="1" data-k="duration" data-i="${index}" value="${level.duration}" />
            </label>
            <label>
              <span>Тип</span>
              <select data-k="isBreak" data-i="${index}">
                <option value="0" ${!level.isBreak ? "selected" : ""}>Игра</option>
                <option value="1" ${level.isBreak ? "selected" : ""}>Перерыв</option>
              </select>
            </label>
            <label>
              <span>МБ</span>
              <input type="number" min="0" data-k="sb" data-i="${index}" value="${level.sb}" ${level.isBreak ? "disabled" : ""} />
            </label>
            <label>
              <span>ББ</span>
              <input type="number" min="0" data-k="bb" data-i="${index}" value="${level.bb}" ${level.isBreak ? "disabled" : ""} />
            </label>
            <label>
              <span>Анте</span>
              <input type="number" min="0" data-k="ante" data-i="${index}" value="${level.ante}" ${level.isBreak ? "disabled" : ""} />
            </label>
          </div>`;
        list.appendChild(row);
      });
      return;
    }

    els.structureBody.innerHTML = "";
    levels.forEach((level, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td><input type="number" min="1" data-k="duration" data-i="${index}" value="${level.duration}" /></td>
        <td><input type="number" min="0" data-k="sb" data-i="${index}" value="${level.sb}" ${level.isBreak ? "disabled" : ""} /></td>
        <td><input type="number" min="0" data-k="bb" data-i="${index}" value="${level.bb}" ${level.isBreak ? "disabled" : ""} /></td>
        <td><input type="number" min="0" data-k="ante" data-i="${index}" value="${level.ante}" ${level.isBreak ? "disabled" : ""} /></td>
        <td>
          <select data-k="isBreak" data-i="${index}">
            <option value="0" ${!level.isBreak ? "selected" : ""}>Игра</option>
            <option value="1" ${level.isBreak ? "selected" : ""}>Перерыв</option>
          </select>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" data-act="up" data-i="${index}" title="Вверх">↑</button>
            <button type="button" data-act="down" data-i="${index}" title="Вниз">↓</button>
            <button type="button" data-act="del" data-i="${index}" title="Удалить">×</button>
          </div>
        </td>`;
      els.structureBody.appendChild(tr);
    });
  }

  function readStructureFromTable() {
    const root = document.getElementById("structureList") || els.structureBody;
    if (!root || !draftLevels) return cloneLevels(state.levels);
    const next = draftLevels.map((level) => ({ ...level }));
    root.querySelectorAll("[data-k][data-i]").forEach((el) => {
      const i = Number(el.dataset.i);
      const k = el.dataset.k;
      if (Number.isNaN(i) || !next[i]) return;
      if (k === "isBreak") next[i].isBreak = el.value === "1";
      else next[i][k] = Number(el.value) || 0;
    });
    return next.map(normalizeLevel);
  }

  function closeSettings(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const dialog = els.dialog;
    if (!dialog) return;
    try {
      if (typeof dialog.close === "function") dialog.close();
    } catch {
      /* ignore */
    }
    // Safari/iPad иногда оставляет dialog открытым — принудительно
    dialog.removeAttribute("open");
    if (dialog.open) {
      try {
        dialog.open = false;
      } catch {
        /* ignore */
      }
    }
  }

  function openSettings(tab = "structure") {
    draftLevels = cloneLevels(state.levels);
    $("setName").value = state.name;
    $("setPlayersTotal").value = state.playersTotal;
    $("setPlayersLeft").value = state.playersLeft;
    $("setStartStack").value = state.startStack;
    $("setSoundEnabled").checked = state.soundEnabled;
    $("setVolume").value = state.volume;
    $("setWarningSeconds").value = state.warningSeconds;
    $("setWarningSound").checked = state.warningSound;
    $("setTheme").value = state.theme;
    $("setAccent").value = state.accent;
    $("setClockFormat").value = state.clockFormat;
    $("setWakeLock").checked = state.wakeLock;
    $("setCustomName").value = "";
    fillPresetSelect();
    refreshCustomList();
    renderStructureTable(draftLevels);
    showSettingsTab(tab);
    // разблокировать аудио даже если турнир уже идёт — чтобы тесты звука работали
    window.PokerAudio.unlock();
    if (!els.dialog.open) els.dialog.showModal();
  }

  function testSound(kind, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    window.PokerAudio.unlock();
    const vol = Math.max(0.35, Number($("setVolume")?.value || state.volume) / 100);
    window.setTimeout(() => {
      if (kind === "round") window.PokerAudio.playRoundChange(vol);
      else if (kind === "break") window.PokerAudio.playBreak(vol);
      else window.PokerAudio.playTournamentEnd(vol);
    }, 30);
  }

  function applySettingsFromForm({ reloadPreset = false } = {}) {
    if (reloadPreset) {
      loadPreset($("setPreset").value);
      return;
    }

    const wasRunning = state.running;
    if (wasRunning) pause();

    state.name = $("setName").value.trim() || "Poker Timer";
    state.playersTotal = Math.max(1, Number($("setPlayersTotal").value) || 1);
    state.playersLeft = Math.min(state.playersTotal, Math.max(1, Number($("setPlayersLeft").value) || 1));
    state.startStack = Math.max(100, Number($("setStartStack").value) || 10000);
    state.soundEnabled = $("setSoundEnabled").checked;
    state.volume = Math.max(0, Math.min(100, Number($("setVolume").value) || 0));
    state.warningSeconds = Math.max(0, Number($("setWarningSeconds").value) || 0);
    state.warningSound = $("setWarningSound").checked;
    state.theme = $("setTheme").value;
    state.accent = $("setAccent").value;
    state.clockFormat = $("setClockFormat").value;
    state.wakeLock = $("setWakeLock").checked;

    const newLevels = readStructureFromTable();
    const structureChanged = JSON.stringify(newLevels) !== JSON.stringify(state.levels);
    state.levels = newLevels;
    if (structureChanged) {
      state.levelIndex = Math.min(state.levelIndex, state.levels.length - 1);
      state.remainingMs = levelDurationMs(state.levels[state.levelIndex]);
      state.elapsedMs = 0;
      state.warningPlayedForLevel = -1;
    }

    applyTheme();
    render();
    saveState();
    closeSettings();
  }

  function exportJson() {
    const payload = {
      name: state.name,
      startStack: state.startStack,
      playersTotal: state.playersTotal,
      levels: state.levels,
      theme: state.theme,
      accent: state.accent,
      clockFormat: state.clockFormat,
      soundEnabled: state.soundEnabled,
      volume: state.volume,
      warningSeconds: state.warningSeconds,
      warningSound: state.warningSound
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "poker-timer-structure.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.levels) || !data.levels.length) throw new Error("no levels");
        draftLevels = data.levels.map(normalizeLevel);
        if (data.name) $("setName").value = data.name;
        if (data.startStack) $("setStartStack").value = data.startStack;
        if (data.playersTotal) $("setPlayersTotal").value = data.playersTotal;
        if (data.theme) $("setTheme").value = data.theme;
        if (data.accent) $("setAccent").value = data.accent;
        if (data.clockFormat) $("setClockFormat").value = data.clockFormat;
        if (typeof data.soundEnabled === "boolean") $("setSoundEnabled").checked = data.soundEnabled;
        if (typeof data.volume === "number") $("setVolume").value = data.volume;
        if (typeof data.warningSeconds === "number") $("setWarningSeconds").value = data.warningSeconds;
        if (typeof data.warningSound === "boolean") $("setWarningSound").checked = data.warningSound;
        renderStructureTable(draftLevels);
        alert("Структура загружена. Нажмите «Применить».");
      } catch {
        alert("Не удалось прочитать JSON.");
      }
    };
    reader.readAsText(file);
  }

  // только click — pointerup+click на iPad давали Старт сразу с Паузой
  function onTap(el, handler) {
    if (!el) return;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      handler(e);
    });
  }

  // Events
  onTap(els.btnPlay, togglePlay);
  onTap(els.btnPrev, () => {
    if (state.finished) {
      state.finished = false;
      state.started = true;
      goToLevel(state.levels.length - 1, { silent: true });
      return;
    }
    goToLevel(state.levelIndex - 1);
  });
  onTap(els.btnNext, () => goToLevel(state.levelIndex + 1));
  onTap(els.btnSkip, () => goToLevel(state.levelIndex + 1));
  onTap(els.btnPlayerMinus, () => {
    state.playersLeft = Math.max(1, state.playersLeft - 1);
    render();
    saveState();
  });
  onTap(els.btnPlayerPlus, () => {
    state.playersLeft = Math.min(state.playersTotal, state.playersLeft + 1);
    render();
    saveState();
  });

  els.btnSettings.addEventListener("click", () => openSettings("structure"));
  $("btnSoundQuick")?.addEventListener("click", () => openSettings("sound"));
  const closeBtn = $("btnCloseSettings");
  // pointerup надёжнее click на iPad (иногда click теряется)
  ["pointerup", "click"].forEach((evt) => {
    closeBtn?.addEventListener(evt, closeSettings);
  });
  // не preventDefault на cancel — иначе Safari может оставить dialog «призраком»
  els.dialog.addEventListener("cancel", () => {
    closeSettings();
  });
  els.dialog.addEventListener("click", (e) => {
    if (e.target === els.dialog) closeSettings(e);
  });
  // страховка: если modal остался без [open], убрать перехват тапов
  setInterval(() => {
    if (els.dialog && !els.dialog.open && els.dialog.hasAttribute("open")) {
      els.dialog.removeAttribute("open");
    }
  }, 1000);
  els.btnTheme.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    saveState();
  });
  els.btnFullscreen.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  });

  document.querySelectorAll(".settings-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => showSettingsTab(tab.dataset.tab));
  });

  $("btnApplySettings").addEventListener("click", () => applySettingsFromForm());
  $("setPreset").addEventListener("change", () => applySettingsFromForm({ reloadPreset: true }));
  $("btnAddLevel").addEventListener("click", () => {
    draftLevels = readStructureFromTable();
    const last = draftLevels[draftLevels.length - 1];
    draftLevels.push({
      duration: last?.duration || 15,
      sb: last && !last.isBreak ? last.sb * 2 || 25 : 25,
      bb: last && !last.isBreak ? last.bb * 2 || 50 : 50,
      ante: last && !last.isBreak ? last.ante : 0,
      isBreak: false
    });
    renderStructureTable(draftLevels);
  });
  $("btnAddBreak").addEventListener("click", () => {
    draftLevels = readStructureFromTable();
    draftLevels.push({ duration: 10, sb: 0, bb: 0, ante: 0, isBreak: true });
    renderStructureTable(draftLevels);
  });

  function onStructureChange(e) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const i = Number(t.dataset.i);
    const k = t.dataset.k;
    if (Number.isNaN(i) || !k) return;
    draftLevels = readStructureFromTable();
    if (k === "isBreak") {
      draftLevels[i].isBreak = t.value === "1";
      if (draftLevels[i].isBreak) {
        draftLevels[i].sb = 0;
        draftLevels[i].bb = 0;
        draftLevels[i].ante = 0;
      }
    } else {
      draftLevels[i][k] = Number(t.value) || 0;
    }
    renderStructureTable(draftLevels);
  }

  function onStructureClick(e) {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const i = Number(btn.dataset.i);
    const act = btn.dataset.act;
    draftLevels = readStructureFromTable();
    if (act === "del") {
      if (draftLevels.length <= 1) return;
      draftLevels.splice(i, 1);
    } else if (act === "up" && i > 0) {
      [draftLevels[i - 1], draftLevels[i]] = [draftLevels[i], draftLevels[i - 1]];
    } else if (act === "down" && i < draftLevels.length - 1) {
      [draftLevels[i + 1], draftLevels[i]] = [draftLevels[i], draftLevels[i + 1]];
    }
    renderStructureTable(draftLevels);
  }

  els.structureList?.addEventListener("change", onStructureChange);
  els.structureList?.addEventListener("click", onStructureClick);

  $("btnTestSound").addEventListener("click", (e) => testSound("round", e));
  $("btnTestBreakSound").addEventListener("click", (e) => testSound("break", e));
  $("btnTestEndSound").addEventListener("click", (e) => testSound("end", e));

  $("btnSaveCustom").addEventListener("click", () => {
    const name = $("setCustomName").value.trim();
    if (!name) {
      alert("Введите имя структуры");
      return;
    }
    const map = loadCustoms();
    map[name] = {
      name,
      startStack: Number($("setStartStack").value) || 10000,
      levels: readStructureFromTable()
    };
    saveCustoms(map);
    refreshCustomList();
    els.setCustomList.value = name;
    alert("Сохранено");
  });

  $("btnLoadCustom").addEventListener("click", () => {
    const name = els.setCustomList.value;
    const map = loadCustoms();
    if (!name || !map[name]) return;
    draftLevels = cloneLevels(map[name].levels);
    $("setStartStack").value = map[name].startStack || 10000;
    renderStructureTable(draftLevels);
  });

  $("btnDeleteCustom").addEventListener("click", () => {
    const name = els.setCustomList.value;
    if (!name) return;
    const map = loadCustoms();
    delete map[name];
    saveCustoms(map);
    refreshCustomList();
  });

  $("btnExport").addEventListener("click", exportJson);
  $("btnImport").addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", () => {
    const file = els.importFile.files?.[0];
    if (file) importJson(file);
    els.importFile.value = "";
  });

  $("btnResetAll").addEventListener("click", () => {
    if (!confirm("Сбросить таймер и настройки?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    draftLevels = cloneLevels(state.levels);
    applyTheme();
    openSettings();
    render();
  });

  document.addEventListener("keydown", (e) => {
    if (els.dialog.open) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.code === "ArrowRight") {
      goToLevel(state.levelIndex + 1);
    } else if (e.code === "ArrowLeft") {
      goToLevel(state.levelIndex - 1);
    }
  });

  // Init — восстановить турнир после перезагрузки
  applyTheme();
  closeSettings();
  catchUpFromStorage();
  render();
  resumeIfNeeded();
  saveState();

  window.addEventListener("beforeunload", saveState);
  window.addEventListener("pagehide", saveState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveState();
      return;
    }
    if (state.running && state.wakeLock) requestWakeLock();
  });
})();
