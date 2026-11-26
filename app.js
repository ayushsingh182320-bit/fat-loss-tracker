/* Fat Loss Tracker — all data in localStorage, no network calls. */
'use strict';

(function () {
  const SETTINGS_KEY = 'flt_settings';
  const DAYS_KEY = 'flt_days';

  const DEFAULTS = {
    weightKg: 77,
    bodyFatPct: 25,
    heightCm: 170,
    ageYears: 25,
    sex: 'M',
    baselineKcal: 300,
    kcalPerStep: 0.05,
    workoutKcal: 180
  };

  // Editable settings with allowed ranges (inclusive).
  const SETTING_RULES = {
    weightKg: { min: 20, max: 400, label: 'Weight' },
    bodyFatPct: { min: 1, max: 75, label: 'Body fat %' },
    ageYears: { min: 10, max: 110, label: 'Age', integer: true },
    baselineKcal: { min: 0, max: 5000, label: 'Baseline kcal' },
    kcalPerStep: { min: 0, max: 1, label: 'kcal per step' },
    workoutKcal: { min: 0, max: 5000, label: 'Workout kcal' }
  };

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MINUS = '−';

  /* ================= helpers ================= */

  const isNum = (v) => typeof v === 'number' && isFinite(v);

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toIso(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function fromIso(iso) {
    const p = iso.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function todayIso() { return toIso(new Date()); }

  function addDays(iso, n) {
    const d = fromIso(iso);
    d.setDate(d.getDate() + n);
    return toIso(d);
  }

  function fmtDate(iso, withYear) {
    const d = fromIso(iso);
    return DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : '');
  }

  // One decimal, trailing ".0" dropped, typographic minus. 1617.4 -> "1617.4", 500 -> "500".
  function fmt1(n) {
    if (!isNum(n)) return '—';
    let r = Math.round(n * 10) / 10;
    if (r === 0) r = 0; // kill -0
    const s = Math.abs(r).toFixed(1).replace(/\.0$/, '');
    return (r < 0 ? MINUS : '') + s;
  }

  function fmtInt(n) {
    let r = Math.round(n);
    if (r === 0) r = 0;
    return (r < 0 ? MINUS : '') + Math.abs(r);
  }

  function colourClass(deficit) {
    if (!isNum(deficit)) return '';
    if (deficit >= 500) return 'good';
    if (deficit >= 0) return 'mid';
    return 'bad';
  }

  // Parse a user-typed number. '' -> null, junk -> NaN.
  function parseInput(str, integer) {
    let s = String(str == null ? '' : str).trim();
    if (s === '') return null;
    if (integer) s = s.replace(/[,\s]/g, '');
    else s = s.replace(/\s/g, '').replace(',', '.');
    if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
    const n = Number(s);
    if (!isFinite(n)) return NaN;
    return integer ? Math.round(n) : n;
  }

  /* ================= storage ================= */

  function sanitizeSettings(raw) {
    const out = Object.assign({}, DEFAULTS);
    if (raw && typeof raw === 'object') {
      for (const k in SETTING_RULES) {
        const v = raw[k];
        const r = SETTING_RULES[k];
        if (isNum(v) && v >= r.min && v <= r.max) out[k] = v;
      }
    }
    out.heightCm = 170; // fixed
    out.sex = 'M'; // fixed
    return out;
  }

  function sanitizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const num = (v) => (isNum(v) && v >= 0 ? v : null);
    const steps = num(e.steps);
    return {
      caloriesEaten: num(e.caloriesEaten),
      proteinG: num(e.proteinG),
      steps: steps === null ? null : Math.round(steps),
      workoutDone: e.workoutDone === true,
      workoutKcalOverride: num(e.workoutKcalOverride),
      stepsKcalOverride: num(e.stepsKcalOverride)
    };
  }

  function sanitizeDays(raw) {
    const out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k in raw) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
        const e = sanitizeEntry(raw[k]);
        if (e) out[k] = e;
      }
    }
    return out;
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function loadSettings() { return sanitizeSettings(readJson(SETTINGS_KEY)); }
  function loadDays() { return sanitizeDays(readJson(DAYS_KEY)); }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ================= calculations ================= */

  function bmr(s) {
    const leanMassKg = s.weightKg * (1 - s.bodyFatPct / 100);
    return 370 + 21.6 * leanMassKg;
  }

  function dayCalc(entry, s) {
    const e = entry || {};
    const steps = isNum(e.steps) ? e.steps : 0;
    const stepsKcal = isNum(e.stepsKcalOverride) ? e.stepsKcalOverride : steps * s.kcalPerStep;
    const workoutKcal = isNum(e.workoutKcalOverride) ? e.workoutKcalOverride : (e.workoutDone ? s.workoutKcal : 0);
    const B = bmr(s);
    const maintenance = B + s.baselineKcal + stepsKcal + workoutKcal;
    const logged = isNum(e.caloriesEaten);
    return {
      bmr: B,
      baseline: s.baselineKcal,
      stepsKcal: stepsKcal,
      workoutKcal: workoutKcal,
      maintenance: maintenance,
      caloriesEaten: logged ? e.caloriesEaten : null,
      deficit: logged ? maintenance - e.caloriesEaten : null,
      logged: logged
    };
  }

  // Window = 7 calendar days ending on `endIso`, inclusive. Never stored; always computed.
  function rolling7(days, s, endIso) {
    let sum = 0;
    const logged = [];
    const missing = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(endIso, -i);
      const c = dayCalc(days[d], s);
      if (c.logged) { sum += c.deficit; logged.push(d); } else { missing.push(d); }
    }
    return {
      count: logged.length,
      average: logged.length ? sum / logged.length : null,
      logged: logged,
      missing: missing
    };
  }

  function flagText(r) {
    if (r.count === 0) return 'No logged days in the last 7 days';
    if (r.count === 7) return 'All 7 days logged.';
    const m = r.missing.length;
    return r.count + '-day average. ' + m + (m === 1 ? ' day' : ' days') + ' missing: ' +
      r.missing.map((d) => fmtDate(d)).join(', ') + '.';
  }

  /* ================= DOM ================= */

  const $ = (id) => document.getElementById(id);

  let settings = loadSettings();
  let days = loadDays();
  let formWorkout = false;
  let shownToday = todayIso();

  function breakdownRows(c) {
    const defClass = colourClass(c.deficit);
    return [
      ['BMR', fmt1(c.bmr)],
      ['Baseline', fmt1(c.baseline)],
      ['Steps kcal', fmt1(c.stepsKcal)],
      ['Workout kcal', fmt1(c.workoutKcal)],
      ['Maintenance', fmt1(c.maintenance), 'sum'],
      ['Calories eaten', c.logged ? fmt1(c.caloriesEaten) : '—'],
      ['Deficit', c.logged ? fmt1(c.deficit) : '—', 'sum', defClass]
    ];
  }

  function renderTable(table, rows) {
    table.textContent = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r[2]) tr.className = r[2];
      const a = document.createElement('td');
      a.textContent = r[0];
      const b = document.createElement('td');
      b.textContent = r[1];
      b.dataset.k = r[0];
      if (r[3]) b.className = r[3];
      tr.appendChild(a);
      tr.appendChild(b);
      table.appendChild(tr);
    }
  }

  function renderTop() {
    const t = todayIso();
    shownToday = t;
    $('todayDate').textContent = fmtDate(t, true);

    const c = dayCalc(days[t], settings);
    const num = $('todayNum');
    const unit = $('todayUnit');
    if (c.logged) {
      num.textContent = fmtInt(c.deficit);
      num.className = 'big ' + colourClass(c.deficit);
      unit.textContent = c.deficit < 0 ? 'kcal surplus' : 'kcal deficit';
      unit.className = 'big-unit ' + colourClass(c.deficit);
    } else {
      num.textContent = '—';
      num.className = 'big';
      unit.textContent = 'Calories not logged yet today';
      unit.className = 'big-unit empty';
    }
    renderTable($('todayTable'), breakdownRows(c));

    const r = rolling7(days, settings, t);
    const avgNum = $('avgNum');
    const avgUnit = $('avgUnit');
    const flag = $('avgFlag');
    if (r.count === 0) {
      avgNum.textContent = 'No logged days in the last 7 days';
      avgNum.className = 'avg-num none';
      avgUnit.textContent = '';
      flag.textContent = '';
      flag.className = 'flag';
    } else {
      avgNum.textContent = fmtInt(r.average);
      avgNum.className = 'avg-num ' + colourClass(r.average);
      avgUnit.textContent = r.average < 0 ? 'kcal surplus' : 'kcal';
      avgUnit.className = 'avg-unit ' + colourClass(r.average);
      flag.textContent = flagText(r);
      flag.className = 'flag' + (r.count < 7 ? ' warn' : '');
    }
  }

  /* ---------- entry form ---------- */

  const FIELD_IDS = ['fCalories', 'fProtein', 'fSteps', 'fWorkoutOverride', 'fStepsOverride'];

  function setWorkout(on) {
    formWorkout = !!on;
    $('fWorkoutYes').setAttribute('aria-pressed', String(formWorkout));
    $('fWorkoutNo').setAttribute('aria-pressed', String(!formWorkout));
  }

  function valStr(v) { return isNum(v) ? String(v) : ''; }

  function loadForm(iso) {
    const e = days[iso] || {};
    $('fCalories').value = valStr(e.caloriesEaten);
    $('fProtein').value = valStr(e.proteinG);
    $('fSteps').value = valStr(e.steps);
    $('fWorkoutOverride').value = valStr(e.workoutKcalOverride);
    $('fStepsOverride').value = valStr(e.stepsKcalOverride);
    setWorkout(e.workoutDone === true);
    FIELD_IDS.forEach((id) => $(id).classList.remove('invalid'));
    $('formError').textContent = '';
    renderLive();
  }

  // Read the form. Returns { entry, errors }.
  function readForm() {
    const spec = [
      ['fCalories', 'caloriesEaten', 'Calories eaten', false],
      ['fProtein', 'proteinG', 'Protein', false],
      ['fSteps', 'steps', 'Steps', true],
      ['fWorkoutOverride', 'workoutKcalOverride', 'Workout kcal override', false],
      ['fStepsOverride', 'stepsKcalOverride', 'Steps kcal override', false]
    ];
    const entry = { workoutDone: formWorkout };
    const errors = [];
    for (const [id, key, label, integer] of spec) {
      const v = parseInput($(id).value, integer);
      const bad = Number.isNaN(v) || (isNum(v) && v < 0);
      $(id).classList.toggle('invalid', bad);
      if (bad) { errors.push(label); entry[key] = null; } else { entry[key] = v; }
    }
    return { entry: entry, errors: errors };
  }

  function renderLive() {
    const iso = $('fDate').value || todayIso();
    const { entry, errors } = readForm();
    const c = dayCalc(entry, settings);
    const head = $('liveHead');
    head.textContent = 'Computed for ' + fmtDate(iso) + ' ';
    if (!c.logged) {
      const w = document.createElement('span');
      w.className = 'warnText';
      w.textContent = '· no calories entered, day not counted';
      head.appendChild(w);
    }
    renderTable($('liveTable'), breakdownRows(c));
    $('formError').textContent = errors.length ? 'Check: ' + errors.join(', ') + ' (numbers ≥ 0 only).' : '';
  }

  function saveDay(ev) {
    ev.preventDefault();
    const iso = $('fDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { toast('Pick a date first', true); return; }
    const { entry, errors } = readForm();
    if (errors.length) { renderLive(); toast('Fix the highlighted fields', true); return; }

    const empty = entry.caloriesEaten === null && entry.proteinG === null && entry.steps === null &&
      entry.workoutKcalOverride === null && entry.stepsKcalOverride === null && !entry.workoutDone;
    const next = Object.assign({}, days);
    if (empty) delete next[iso]; else next[iso] = entry;

    if (!writeJson(DAYS_KEY, next)) { toast('Could not save: storage unavailable', true); return; }
    days = next;
    renderTop();
    renderLive();
    toast((empty ? 'Cleared ' : 'Saved ') + fmtDate(iso) + ' ✓');
  }

  /* ---------- settings ---------- */

  const SETTING_INPUTS = {
    weightKg: 'sWeight',
    bodyFatPct: 'sBodyFat',
    ageYears: 'sAge',
    baselineKcal: 'sBaseline',
    kcalPerStep: 'sKcalPerStep',
    workoutKcal: 'sWorkoutKcal'
  };

  function readSettingsForm() {
    const out = Object.assign({}, settings);
    const errors = [];
    for (const k in SETTING_INPUTS) {
      const r = SETTING_RULES[k];
      const el = $(SETTING_INPUTS[k]);
      const v = parseInput(el.value, !!r.integer);
      const bad = !isNum(v) || v < r.min || v > r.max;
      el.classList.toggle('invalid', bad);
      if (bad) errors.push(r.label + ' (' + r.min + '–' + r.max + ')'); else out[k] = v;
    }
    return { settings: sanitizeSettings(out), errors: errors };
  }

  function renderBmrPreview() {
    const { settings: s, errors } = readSettingsForm();
    const lean = s.weightKg * (1 - s.bodyFatPct / 100);
    $('sBmrPreview').textContent = errors.length ? '' : 'Lean mass ' + fmt1(lean) + ' kg · BMR ' + fmt1(bmr(s)) + ' kcal';
    $('settingsError').textContent = errors.length ? 'Check: ' + errors.join(', ') : '';
  }

  function openSettings() {
    for (const k in SETTING_INPUTS) {
      $(SETTING_INPUTS[k]).value = String(settings[k]);
      $(SETTING_INPUTS[k]).classList.remove('invalid');
    }
    renderBmrPreview();
    $('mainView').hidden = true;
    $('settingsView').hidden = false;
    $('openSettings').hidden = true;
    window.scrollTo(0, 0);
  }

  function closeSettings() {
    $('settingsView').hidden = true;
    $('mainView').hidden = false;
    $('openSettings').hidden = false;
    window.scrollTo(0, 0);
  }

  function saveSettings(ev) {
    ev.preventDefault();
    const { settings: s, errors } = readSettingsForm();
    if (errors.length) { renderBmrPreview(); toast('Fix the highlighted fields', true); return; }
    if (!writeJson(SETTINGS_KEY, s)) { toast('Could not save: storage unavailable', true); return; }
    settings = s;
    renderTop();
    renderLive();
    closeSettings();
    toast('Settings saved ✓');
  }

  /* ---------- backup ---------- */

  async function exportData() {
    const data = {
      app: 'fat-loss-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings,
      days: days
    };
    const name = 'fat-loss-backup-' + todayIso() + '.json';
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });

    // iOS home-screen apps handle the share sheet ("Save to Files") better than downloads.
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        toast('Export ready ✓');
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user cancelled the share sheet
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Exported ✓');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { toast('Not a valid JSON file', true); return; }
      if (!data || typeof data !== 'object' || (typeof data.days !== 'object' && typeof data.settings !== 'object')) {
        toast('File has no settings or days', true);
        return;
      }
      const newDays = sanitizeDays(data.days);
      const newSettings = sanitizeSettings(data.settings);
      const n = Object.keys(newDays).length;
      if (!window.confirm('Replace ALL current data with this backup (' + n + ' day' + (n === 1 ? '' : 's') + ')? This cannot be undone.')) return;
      if (!writeJson(SETTINGS_KEY, newSettings) || !writeJson(DAYS_KEY, newDays)) {
        toast('Could not save: storage unavailable', true);
        return;
      }
      settings = newSettings;
      days = newDays;
      renderTop();
      loadForm($('fDate').value || todayIso());
      closeSettings();
      toast('Imported ' + n + ' day' + (n === 1 ? '' : 's') + ' ✓');
    };
    reader.onerror = () => toast('Could not read file', true);
    reader.readAsText(file);
  }

  /* ---------- toast ---------- */

  let toastTimer = 0;
  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
  }

  /* ---------- wiring ---------- */

  function init() {
    const t = todayIso();
    const dateEl = $('fDate');
    dateEl.value = t;
    dateEl.max = t;

    dateEl.addEventListener('change', () => { if (dateEl.value) loadForm(dateEl.value); });
    FIELD_IDS.forEach((id) => $(id).addEventListener('input', renderLive));
    $('fWorkoutYes').addEventListener('click', () => { setWorkout(true); renderLive(); });
    $('fWorkoutNo').addEventListener('click', () => { setWorkout(false); renderLive(); });
    $('dayForm').addEventListener('submit', saveDay);

    $('openSettings').addEventListener('click', openSettings);
    $('closeSettings').addEventListener('click', closeSettings);
    $('settingsForm').addEventListener('submit', saveSettings);
    Object.values(SETTING_INPUTS).forEach((id) => $(id).addEventListener('input', renderBmrPreview));

    $('exportBtn').addEventListener('click', exportData);
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importData(f);
    });

    // Handle the date rolling over while the app sits open in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const now = todayIso();
      if (now !== shownToday) {
        const wasToday = dateEl.value === shownToday;
        dateEl.max = now;
        renderTop();
        if (wasToday) { dateEl.value = now; loadForm(now); }
      }
    });

    renderTop();
    loadForm(t);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // Exposed for automated tests only.
  window.FLT = { bmr: bmr, dayCalc: dayCalc, rolling7: rolling7, flagText: flagText, fmt1: fmt1, addDays: addDays, todayIso: todayIso };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
