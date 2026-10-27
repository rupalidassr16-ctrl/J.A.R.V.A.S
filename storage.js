/* F.R.I.D.A.Y. storage.js
 * Local data, validation, safety checks, backup/import.
 * Everything is stored in this browser only (localStorage). Nothing is sent anywhere from here.
 */
(function () {
  'use strict';
  var F = (window.FRIDAY = window.FRIDAY || {});
  var KEY = 'friday.data.v1';
  var SNAP_KEY = 'friday.data.v1.snapshot';
  var SCHEMA = 1;
  var persistent = true;
  var data = null;

  var STYLES = ['adaptive', 'professional', 'casual'];
  var SIZES = ['small', 'normal', 'large'];

  function defaults() {
    return {
      schema: SCHEMA,
      settings: {
        assistantName: 'F.R.I.D.A.Y.', style: 'adaptive', accent: '#22e5ff', textSize: 'normal',
        voiceOut: false, confirmFacts: true, saveHistory: true, backendUrl: '', mode: 'offline'
      },
      notes: [], tasks: [], facts: [], chat: [], cmdHistory: [], summaries: [], reminders: []
    };
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function arr(v, max) { return Array.isArray(v) ? v.slice(-max) : []; }

  // Builds a clean data object from untrusted input (stored data or an imported file).
  function sanitize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') { return d; }
    var s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    d.settings.assistantName = str(s.assistantName, 30).trim() || d.settings.assistantName;
    d.settings.style = STYLES.indexOf(s.style) >= 0 ? s.style : 'adaptive';
    d.settings.accent = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : d.settings.accent;
    d.settings.textSize = SIZES.indexOf(s.textSize) >= 0 ? s.textSize : 'normal';
    d.settings.voiceOut = s.voiceOut === true;
    d.settings.confirmFacts = s.confirmFacts !== false;
    d.settings.saveHistory = s.saveHistory !== false;
    d.settings.backendUrl = cleanUrl(s.backendUrl);
    d.settings.mode = s.mode === 'online' ? 'online' : 'offline';
    var item = function (x, max) { return x && typeof x.text === 'string' && x.text.trim() ? { id: str(x.id, 30) || uid(), text: x.text.slice(0, max), created: num(x.created, Date.now()) } : null; };
    d.notes = arr(raw.notes, 500).map(function (x) { return item(x, 2000); }).filter(Boolean);
    d.facts = arr(raw.facts, 500).map(function (x) { return item(x, 500); }).filter(Boolean);
    d.summaries = arr(raw.summaries, 50).map(function (x) { return item(x, 4000); }).filter(Boolean);
    d.tasks = arr(raw.tasks, 500).map(function (x) { var t = item(x, 500); if (t) { t.done = x.done === true; } return t; }).filter(Boolean);
    d.chat = arr(raw.chat, 200).filter(function (x) { return x && (x.role === 'user' || x.role === 'assistant') && typeof x.text === 'string'; })
      .map(function (x) { return { role: x.role, text: x.text.slice(0, 4000), mode: x.mode === 'online' ? 'online' : 'offline', t: num(x.t, Date.now()) }; });
    d.cmdHistory = arr(raw.cmdHistory, 50).filter(function (x) { return typeof x === 'string'; }).map(function (x) { return x.slice(0, 300); });
    d.reminders = arr(raw.reminders, 100).filter(function (x) { return x && typeof x.text === 'string' && isFinite(x.due); })
      .map(function (x) { return { id: str(x.id, 30) || uid(), text: x.text.slice(0, 300), due: x.due, fired: x.fired === true }; });
    return d;
  }

  function cleanUrl(u) {
    u = str(u, 200).trim().replace(/\/+$/, '');
    return /^https:\/\/[^\s]+$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?([^\s]*)$/i.test(u) ? u : '';
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      data = sanitize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      persistent = false; // storage blocked or corrupt: keep working in memory
      data = defaults();
    }
    return data;
  }

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(data)); persistent = true; return true; }
    catch (e) { persistent = false; return false; }
  }

  function get() { return data || load(); }
  function replace(d) { data = sanitize(d); save(); return data; }
  function isPersistent() { return persistent; }

  function snapshot() { try { window.localStorage.setItem(SNAP_KEY, JSON.stringify(data)); return true; } catch (e) { return false; } }
  function hasSnapshot() { try { return !!window.localStorage.getItem(SNAP_KEY); } catch (e) { return false; } }
  function restoreSnapshot() {
    try { var raw = window.localStorage.getItem(SNAP_KEY); if (!raw) { return false; } replace(JSON.parse(raw)); return true; }
    catch (e) { return false; }
  }

  function exportObject() {
    return { app: 'F.R.I.D.A.Y.', schema: SCHEMA, exportedAt: new Date().toISOString(), data: get() };
  }

  // Checks a backup file's text WITHOUT touching current data.
  function validateImport(text) {
    if (typeof text !== 'string' || !text.trim()) { return { ok: false, error: 'The file is empty.' }; }
    if (text.length > 5 * 1024 * 1024) { return { ok: false, error: 'The file is larger than 5 MB.' }; }
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'The file is not valid JSON.' }; }
    if (!obj || obj.app !== 'F.R.I.D.A.Y.') { return { ok: false, error: 'This is not a F.R.I.D.A.Y. backup file.' }; }
    if (typeof obj.schema !== 'number' || obj.schema > SCHEMA) { return { ok: false, error: 'This backup comes from a newer version.' }; }
    if (!obj.data || typeof obj.data !== 'object') { return { ok: false, error: 'The backup has no data section.' }; }
    var clean = sanitize(obj.data);
    return { ok: true, data: clean, counts: { notes: clean.notes.length, tasks: clean.tasks.length, facts: clean.facts.length, chat: clean.chat.length, summaries: clean.summaries.length } };
  }

  /* ---- Safety: never store secrets; ask before storing personal details ---- */
  var SECRET = [
    /\b(password|passcode|passwd|pin|api[ _-]?key|secret|token|private key)\b\s*(is|=|:)/i,
    /\bsk-[A-Za-z0-9_-]{16,}/, /\bBearer\s+[A-Za-z0-9._-]{16,}/i,
    /\b(?:\d[ -]?){13,19}\b/, /\b\d{3}-\d{2}-\d{4}\b/
  ];
  var PERSONAL = /\b(diagnos\w*|medical|medication|salary|income|debt|bank|address|phone number|email|passport|religion|lawyer)\b/i;

  function checkSensitive(text) {
    for (var i = 0; i < SECRET.length; i++) { if (SECRET[i].test(text)) { return 'secret'; } }
    return PERSONAL.test(text) ? 'personal' : 'none';
  }

  F.store = {
    load: load, save: save, get: get, replace: replace, uid: uid, isPersistent: isPersistent,
    snapshot: snapshot, hasSnapshot: hasSnapshot, restoreSnapshot: restoreSnapshot,
    exportObject: exportObject, validateImport: validateImport, sanitize: sanitize,
    checkSensitive: checkSensitive, cleanUrl: cleanUrl, defaults: defaults
  };
})();
