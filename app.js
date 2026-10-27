/* F.R.I.D.A.Y. app.js
 * User interface, command router, memory, tasks, reminders, settings and online AI mode.
 * Depends on (in order): storage.js, tools.js, voice.js, ai.js
 *
 * Rules this file follows:
 *  - Local commands always run on this device, in both modes.
 *  - Text that matches no local command goes to the online AI only in Online AI mode.
 *  - Online AI output is shown as plain text only. It is never executed, parsed into actions, or run as code.
 *  - Nothing from memory is sent to the AI unless the user ticked it under Memory.
 */
(function () {
  'use strict';
  var F = window.FRIDAY, S = F.store, T = F.tools, V = F.voice, AI = F.ai;
  var VERSION = '1.0.0';
  var data = S.load();
  var st = { busy: false, cancel: null, aiTurns: [], sel: {}, turns: 2, aiState: 'unconfigured', aiDetail: 'No backend URL set.', taskFilter: 'all', tone: 'professional', started: Date.now(), count: 0, listening: false, q: '', last: null, cmdIdx: 0 };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'text') { e.textContent = v; } else if (k === 'class') { e.className = v; }
      else if (k.slice(0, 2) === 'on') { e.addEventListener(k.slice(2), v); } else { e.setAttribute(k, v); }
    });
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clear(el) { while (el && el.firstChild) { el.removeChild(el.firstChild); } }
  function when(ts) { try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function confirmAction(msg) { try { return typeof window.confirm === 'function' ? window.confirm(msg) : false; } catch (e) { return false; } }
  var toastTimer;
  function toast(msg) { var t = $('toast'); if (!t) { return; } t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800); }
  function commit() { if (!S.save()) { toast('Could not save to this browser. Changes will be lost when you close the page. Download a backup.'); } renderAll(); }
  var NAME = function () { return data.settings.assistantName; };

  /* ---------- tone ---------- */
  function style() { var s = data.settings.style; return s === 'adaptive' ? st.tone : s; }
  var P = {
    noteSaved: { professional: function (n) { return 'Note ' + n + ' saved.'; }, casual: function (n) { return 'Got it. That is note ' + n + '.'; } },
    factSaved: { professional: function (n) { return 'Fact ' + n + ' saved.'; }, casual: function (n) { return 'Okay, I will keep that as fact ' + n + '.'; } },
    taskAdded: { professional: function (n) { return 'Task ' + n + ' added to the queue.'; }, casual: function (n) { return 'Added as task ' + n + '.'; } },
    completed: { professional: function (n) { return 'Task ' + n + ' marked complete.'; }, casual: function (n) { return 'Nice, task ' + n + ' is done.'; } },
    reopened: { professional: function (n) { return 'Task ' + n + ' reopened.'; }, casual: function (n) { return 'Task ' + n + ' is open again.'; } },
    removed: { professional: function (w, n) { return w + ' ' + n + ' deleted.'; }, casual: function (w, n) { return 'Removed ' + w.toLowerCase() + ' ' + n + '.'; } },
    greet: { professional: function (g) { return g + '. ' + NAME() + ' is ready. Type "help" for the command list.'; }, casual: function (g) { return g + '! I am here. Say "help" if you want ideas.'; } }
  };
  function say(key) { var a = [].slice.call(arguments, 1), p = P[key]; return (p[style()] || p.professional).apply(null, a); }
  function greetingNow() { var hr = new Date().getHours(); return hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; }

  /* ---------- log ---------- */
  var MAX_LOG = 200;
  function addMsg(kind, who, text) {
    st.last = text;
    var log = $('log'); if (!log) { return; }
    var wrap = h('div', { class: 'msg ' + kind }, [h('span', { class: 'who', text: who }), h('p', { class: 'body', text: text })]);
    log.appendChild(wrap);
    while (log.children.length > MAX_LOG) { log.removeChild(log.firstChild); }
    log.scrollTop = log.scrollHeight;
    return wrap;
  }
  function record(role, text, mode) {
    if (!data.settings.saveHistory || S.checkSensitive(text) === 'secret') { return; }
    data.chat.push({ role: role, text: String(text).slice(0, 4000), mode: mode, t: Date.now() });
    if (data.chat.length > 200) { data.chat.shift(); }
    S.save();
  }
  function reply(res, mode) {
    var text = typeof res === 'string' ? res : res.text, isErr = typeof res === 'object' && res.error, online = typeof res === 'object' && res.online;
    var m = online ? 'online' : 'offline';
    addMsg('assistant ' + (isErr ? 'error' : (online ? 'online' : '')), NAME() + (isErr ? ' (error)' : online ? ' (online AI)' : ' (offline)'), text);
    if (!isErr) { record('assistant', text, m); }
    if (data.settings.voiceOut && !isErr) { V.speak(text); }
  }

  /* ---------- memory actions ---------- */
  async function saveItem(kind, text) {
    text = text.trim();
    var max = kind === 'fact' ? 500 : 2000;
    if (!text) { return { text: 'There is nothing to save.', error: true }; }
    if (text.length > max) { return { text: 'That is too long to save (max ' + max + ' characters).', error: true }; }
    var sens = S.checkSensitive(text);
    if (sens === 'secret') { return { text: 'I do not store passwords, tokens, API keys or card numbers. Nothing was saved.', error: true }; }
    var needAsk = sens === 'personal' || (kind === 'fact' && data.settings.confirmFacts);
    if (needAsk && !confirmAction('Save this ' + kind + '?\n\n"' + clip(text, 200) + '"' + (sens === 'personal' ? '\n\nIt may contain personal details. It stays on this device unless you share it with the online AI.' : ''))) { return 'Okay, not saved.'; }
    var list = kind === 'fact' ? data.facts : data.notes;
    list.push({ id: S.uid(), text: text, created: Date.now() });
    commit();
    return say(kind === 'fact' ? 'factSaved' : 'noteSaved', list.length);
  }
  function listText(title, list, fmt) {
    if (!list.length) { return 'No ' + title + ' yet.'; }
    return list.map(function (x, i) { return (i + 1) + '. ' + fmt(x); }).join('\n');
  }
  function removeAt(list, n, label) {
    var i = parseInt(n, 10) - 1;
    if (!(i >= 0 && i < list.length)) { return { text: 'There is no ' + label.toLowerCase() + ' number ' + n + '. Use the "show" command to see the numbers.', error: true }; }
    list.splice(i, 1); commit(); return say('removed', label, n);
  }
  function taskAt(n) { var i = parseInt(n, 10) - 1; return i >= 0 && i < data.tasks.length ? data.tasks[i] : null; }
  function setTaskDone(n, done) {
    var t = taskAt(n);
    if (!t) { return { text: 'There is no task number ' + n + '. Type "show tasks" to see the numbers.', error: true }; }
    t.done = done; commit(); return say(done ? 'completed' : 'reopened', n);
  }
  function searchAll(q) {
    q = q.toLowerCase();
    var out = [];
    data.facts.forEach(function (x, i) { if (x.text.toLowerCase().indexOf(q) >= 0) { out.push('Fact ' + (i + 1) + ': ' + clip(x.text, 120)); } });
    data.notes.forEach(function (x, i) { if (x.text.toLowerCase().indexOf(q) >= 0) { out.push('Note ' + (i + 1) + ': ' + clip(x.text, 120)); } });
    data.tasks.forEach(function (x, i) { if (x.text.toLowerCase().indexOf(q) >= 0) { out.push('Task ' + (i + 1) + (x.done ? ' (done)' : '') + ': ' + clip(x.text, 120)); } });
    return out.length ? out.join('\n') : 'Nothing matched "' + clip(q, 40) + '".';
  }

  /* ---------- reminders ---------- */
  function notify(title, body) { try { if ('Notification' in window && Notification.permission === 'granted') { new Notification(title, { body: body }); } } catch (e) { /* some mobile browsers do not allow this; the in-page message still shows */ } }
  function addReminder(text, minutes) {
    if (!(minutes >= 1 && minutes <= 10080)) { throw new Error('Choose between 1 minute and 7 days (10080 minutes).'); }
    if (S.checkSensitive(text) === 'secret') { throw new Error('I will not store passwords, keys or card numbers, even in reminders.'); }
    data.reminders = data.reminders.filter(function (r) { return !r.fired; }).concat(data.reminders.filter(function (r) { return r.fired; }).slice(-5));
    var due = Date.now() + minutes * 60000;
    data.reminders.push({ id: S.uid(), text: text.slice(0, 300), due: due, fired: false });
    try { if ('Notification' in window && Notification.permission === 'default') { Notification.requestPermission(); } } catch (e) { /* optional */ }
    commit();
    return 'Reminder set for ' + new Date(due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '. It only fires while this page stays open.';
  }
  function checkReminders() {
    var changed = false, now = Date.now();
    data.reminders.forEach(function (r) {
      if (!r.fired && r.due <= now) {
        r.fired = true; changed = true;
        var late = now - r.due > 60000 ? ' (was due ' + when(r.due) + ' while the page was closed)' : '';
        addMsg('assistant', NAME() + ' (reminder)', 'Reminder: ' + r.text + late);
        if (data.settings.voiceOut) { V.speak('Reminder: ' + r.text); }
        notify('Reminder', r.text);
        try { if (navigator.vibrate) { navigator.vibrate(200); } } catch (e) { /* optional */ }
      }
    });
    if (changed) { commit(); }
  }

  T.register({ id: 'remind', label: 'Reminder', needs: ['Works while this page is open', 'Optional: notification permission'],
    fields: [{ name: 'text', label: 'Remind me to', type: 'text', placeholder: 'stretch' }, { name: 'minutes', label: 'In how many minutes', type: 'text', placeholder: '15' }],
    validate: function (a) { var m = parseInt(a.minutes, 10); var t = String(a.text || '').trim(); if (!t) { throw new Error('Please say what to be reminded about.'); } if (!isFinite(m)) { throw new Error('Minutes must be a number.'); } return { text: t, minutes: m }; },
    run: function (a) { return addReminder(a.text, a.minutes); } });

  /* ---------- online AI ---------- */
  function backendUrl() { return data.settings.backendUrl; }
  async function refreshHealth() {
    if (!backendUrl()) { st.aiState = 'unconfigured'; st.aiDetail = 'No backend URL set.'; renderPills(); return; }
    st.aiState = 'checking'; st.aiDetail = 'Checking...'; renderPills();
    var r = await AI.health(backendUrl());
    st.aiState = r.state; st.aiDetail = r.detail; renderPills(); renderSettingsState();
    return r;
  }
  function selectedContext() {
    var items = [];
    data.facts.forEach(function (x) { if (st.sel[x.id]) { items.push('Fact: ' + x.text); } });
    data.notes.forEach(function (x) { if (st.sel[x.id]) { items.push('Note: ' + x.text); } });
    var out = '', count = 0;
    for (var i = 0; i < items.length; i++) { if ((out + items[i]).length > 3800) { break; } out += '- ' + items[i] + '\n'; count++; }
    return { text: out.trim(), count: count, total: items.length };
  }
  function setBusy(b) {
    st.busy = b;
    $('send').disabled = b; $('cancel').hidden = !b;
    var r = document.querySelector('.reactor'); if (r) { r.classList.toggle('busy', b); }
  }
  async function askAI(text, opts) {
    opts = opts || {};
    if (!backendUrl()) { return { text: 'Online AI is not set up yet. Open Settings, add your Backend URL, then try again. Offline commands still work.', error: true }; }
    if (S.checkSensitive(text) === 'secret') { return { text: 'That looks like it contains a password, key or card number, so I did not send it.', error: true }; }
    if (text.length > AI.MAX_INPUT) { return { text: 'Messages to the AI are limited to ' + AI.MAX_INPUT + ' characters.', error: true }; }
    var prior = opts.noPrior ? [] : st.aiTurns.slice(-st.turns * 2);
    var ctx = opts.noContext ? { text: '', count: 0 } : selectedContext();
    var req = AI.chat({ url: backendUrl(), messages: prior.concat([{ role: 'user', content: text }]), context: ctx.text, style: style(), name: NAME() });
    st.cancel = req.cancel; setBusy(true);
    var waiting = addMsg('system', '', 'Waiting for the online AI...');
    try {
      var answer = await req.promise;
      if (!opts.noPrior) { st.aiTurns.push({ role: 'user', content: text }, { role: 'assistant', content: answer }); if (st.aiTurns.length > 24) { st.aiTurns.splice(0, 2); } }
      st.aiState = 'connected'; renderPills();
      return { text: answer, online: true };
    } catch (e) {
      if (e.code === 'network' || e.code === 'timeout') { st.aiState = 'error'; st.aiDetail = e.message; renderPills(); }
      return { text: e.message || 'The online AI request failed.', error: true };
    } finally {
      st.cancel = null; setBusy(false);
      if (waiting && waiting.parentNode) { waiting.parentNode.removeChild(waiting); }
    }
  }
  async function summarizeChat() {
    var msgs = data.chat.filter(function (m) { return S.checkSensitive(m.text) !== 'secret'; }).slice(-20);
    if (msgs.length < 2) { return 'There is not enough saved conversation history to summarize.'; }
    if (!backendUrl()) { return { text: 'Summarizing the conversation needs Online AI. Add your Backend URL in Settings first.', error: true }; }
    if (!confirmAction('This sends your last ' + msgs.length + ' saved messages to your backend and the AI provider so it can write a summary. Continue?')) { return 'Cancelled. Nothing was sent.'; }
    var transcript = msgs.map(function (m) { return (m.role === 'user' ? 'User' : 'Assistant') + ': ' + m.text; }).join('\n');
    transcript = transcript.slice(-1800);
    var res = await askAI('Summarize this conversation in 3 to 5 short bullet points:\n' + transcript, { noPrior: true, noContext: true });
    if (res.error) { return res; }
    addMsg('assistant online', NAME() + ' (online AI)', res.text);
    if (confirmAction('Save this summary to your memory bank?')) {
      data.summaries.push({ id: S.uid(), text: res.text.slice(0, 4000), created: Date.now() }); if (data.summaries.length > 50) { data.summaries.shift(); } commit();
      return 'Summary saved.';
    }
    return 'Summary not saved.';
  }

  /* ---------- backup ---------- */
  function doExport() {
    try {
      var blob = new Blob([JSON.stringify(S.exportObject(), null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: 'friday-backup-' + new Date().toISOString().slice(0, 10) + '.json' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      return 'Backup downloaded. Keep the file somewhere safe; it contains your notes, facts, tasks and history.';
    } catch (e) { return { text: 'The backup could not be created in this browser: ' + e.message, error: true }; }
  }
  function importText(text) {
    var v = S.validateImport(text);
    if (!v.ok) { return { text: 'Import cancelled. ' + v.error + ' Your current data was not changed.', error: true }; }
    var c = v.counts;
    if (!confirmAction('Replace your current data with this backup?\n\n' + c.facts + ' facts, ' + c.notes + ' notes, ' + c.tasks + ' tasks, ' + c.chat + ' history messages.\n\nA copy of your current data is kept so you can restore it.')) { return 'Import cancelled. Nothing changed.'; }
    S.snapshot(); data = S.replace(v.data); st.aiTurns = []; st.sel = {};
    applyAppearance(); renderAll(); refreshHealth();
    return 'Backup imported: ' + c.facts + ' facts, ' + c.notes + ' notes, ' + c.tasks + ' tasks.';
  }
  function restoreBackup() {
    if (!S.hasSnapshot()) { return { text: 'There is no earlier copy to restore.', error: true }; }
    if (!confirmAction('Replace your current data with the copy saved before the last import?')) { return 'Cancelled.'; }
    if (!S.restoreSnapshot()) { return { text: 'Could not restore the earlier copy.', error: true }; }
    data = S.get(); applyAppearance(); renderAll(); return 'Earlier data restored.';
  }
  function readFile(file, maxBytes, cb) {
    if (!file) { return; }
    if (file.size > maxBytes) { toast('That file is too large (limit ' + Math.round(maxBytes / 1024) + ' KB).'); return; }
    var fr = new FileReader();
    fr.onload = function () { cb(String(fr.result || '')); };
    fr.onerror = function () { toast('Could not read that file.'); };
    fr.readAsText(file);
  }

  /* ---------- settings / appearance ---------- */
  function hexToRgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)].join(', '); }
  function applyAppearance() {
    var root = document.documentElement, s = data.settings;
    if (root && root.style) { root.style.setProperty('--cyan', s.accent); root.style.setProperty('--cyan-rgb', hexToRgb(s.accent)); }
    if (root && root.classList) { ['small', 'normal', 'large'].forEach(function (z) { root.classList.toggle('size-' + z, s.textSize === z); }); }
    var sub = $('subtitle'); if (sub) { sub.textContent = s.assistantName + ' personal assistant'; }
  }
  function setMode(mode) {
    if (mode === 'online' && !backendUrl()) { toast('Add your Backend URL in Settings first.'); return { text: 'Online AI is not set up yet. Open Settings and add your Backend URL. Staying in offline mode.', error: true }; }
    data.settings.mode = mode; S.save(); renderAll();
    if (mode === 'online') { refreshHealth(); return 'Online AI mode on. Local commands (notes, tasks, tools) still run on this device. Anything else goes to your AI provider through your backend.'; }
    return 'Offline mode on. Nothing leaves this device except optional weather lookups and browser voice recognition.';
  }

  /* ---------- status ---------- */
  function statusText() {
    var secs = Math.floor((Date.now() - st.started) / 1000), mins = Math.floor(secs / 60);
    var net = 'onLine' in navigator ? (navigator.onLine ? 'browser reports a connection' : 'browser reports no connection') : 'unknown';
    var ai = { unconfigured: 'not set up', checking: 'checking', connected: 'connected', error: 'unavailable (' + st.aiDetail + ')' }[st.aiState];
    var open = data.tasks.filter(function (t) { return !t.done; }).length, pend = data.reminders.filter(function (r) { return !r.fired; }).length;
    return ['System status', 'Assistant: ' + NAME() + ' (F.R.I.D.A.Y. v' + VERSION + ')', 'Mode: ' + (data.settings.mode === 'online' ? 'Online AI' : 'Offline commands'),
      'Offline command engine: running', 'Online AI: ' + ai, 'Network: ' + net,
      'Memory: ' + data.facts.length + ' facts, ' + data.notes.length + ' notes, ' + data.tasks.length + ' tasks (' + open + ' open), ' + pend + ' reminder(s) pending',
      'Local storage: ' + (S.isPersistent() ? 'saving to this browser' : 'NOT saving (blocked); download a backup'),
      'Voice input: ' + (V.canListen() ? 'supported' : 'not supported') + ', spoken output: ' + (V.canSpeak() ? (data.settings.voiceOut ? 'on' : 'off') : 'not supported'),
      'Style: ' + data.settings.style, 'Session: ' + (mins ? mins + ' min ' : '') + (secs % 60) + ' s, ' + st.count + ' command(s)'].join('\n');
  }
  function helpText() {
    return ['Commands (local ones work offline):', '',
      'Notes and facts', 'remember [text]  |  show notes  |  forget note [n]  |  forget all notes  |  edit note [n] [text]', 'save fact [text]  |  show facts  |  forget fact [n]  |  search [text]', '',
      'Tasks', 'add task [text]  |  show tasks  |  complete task [n]  |  reopen task [n]  |  delete task [n]  |  clear completed tasks', '',
      'Tools', 'calc 12*(3+4)  |  convert 10 km to miles  |  weather [city] (internet)', 'days until 2026-12-25  |  time in Asia/Tokyo  |  summarize [text]', 'remind me in 15 minutes to [text]  |  show reminders  |  cancel reminder [n]', '',
      'Settings', 'set name [name]  |  set style adaptive/professional/casual  |  voice on  |  voice off', 'mode online  |  mode offline  |  summarize chat  |  clear history', 'export  |  import  |  restore backup  |  status  |  clear', '',
      'In Online AI mode, anything that is not a local command is sent to the AI.'].join('\n');
  }

  /* ---------- command router ---------- */
  var BARE = /^[0-9+\-*\/%^().,\sx\u00d7\u00f7]+$/i;
  var wrapTool = async function (id, args) { var r = await T.run(id, args); return r.ok ? r.text : { text: r.text, error: true }; };
  var C = [
    { re: /^(help|\?|commands)$/i, run: function () { return helpText(); } },
    { re: /^(hi|hello|hey|yo|good (?:morning|afternoon|evening))(?:\s+\w+)?[!.]*$/i, run: function (m) { return say('greet', greetingNow()); } },
    { re: /^(?:time|what(?:'s| is) the time\??|current time)$/i, run: function () { return 'The time is ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.'; } },
    { re: /^(?:date|today|what(?:'s| is) (?:the date|today'?s date)\??|current date)$/i, run: function () { return 'Today is ' + new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '.'; } },
    { re: /^time in (.+)$/i, run: function (m) { return wrapTool('zone', { zone: m[1] }); } },
    { re: /^days until (.+)$/i, run: function (m) { return wrapTool('days', { date: m[1] }); } },
    { re: /^(?:status|system status|diagnostics)$/i, run: function () { return statusText(); } },
    { re: /^(?:clear|cls)$/i, silent: true, run: function () { clear($('log')); return 'Log cleared. Saved notes, tasks and history were not touched.'; } },
    { re: /^clear (?:chat )?history$/i, run: function () { if (!confirmAction('Delete all saved conversation history on this device?')) { return 'Cancelled.'; } data.chat = []; st.aiTurns = []; commit(); return 'Conversation history cleared on this device. The AI provider may keep its own logs; this cannot delete those.'; } },
    { test: function (r) { var m = /^(calc|calculate|compute|math|what is|what's|whats)\s*(.*)$/i.exec(r); if (!m) { return BARE.test(r) && /\d/.test(r) ? [r, '', r] : null; } var explicit = /^(calc|calculate|compute|math)$/i.test(m[1]); var expr = m[2].replace(/\?+$/, ''); return explicit || (BARE.test(expr) && /\d/.test(expr)) ? m : null; },
      run: function (m) { var expr = (m[2] !== undefined ? m[2] : m[0]).replace(/\?+$/, '').trim(); return expr ? wrapTool('calc', { expr: expr }) : 'Give me something to calculate, for example: calc 12 * (3 + 4)'; } },
    { re: /^convert\s+(-?[\d.,]+)\s*(.+?)\s+(?:to|in)\s+(.+)$/i, run: function (m) { return wrapTool('convert', { value: m[1], from: m[2], to: m[3] }); } },
    { re: /^weather(?:\s+(?:in|for))?\s+(.+)$/i, run: function (m) { return wrapTool('weather', { city: m[1] }); } },
    { re: /^(?:remember|note)\s+(?:that\s+)?(.+)$/i, run: function (m) { return saveItem('note', m[1]); } },
    { re: /^(?:show|list)\s+notes$/i, run: function () { return listText('notes', data.notes, function (x) { return x.text; }); } },
    { re: /^(?:forget|delete)\s+note\s+(\d+)$/i, run: function (m) { return removeAt(data.notes, m[1], 'Note'); } },
    { re: /^(?:forget|delete|clear)\s+all\s+notes$/i, run: function () { if (!data.notes.length) { return 'There are no notes to delete.'; } if (!confirmAction('Delete all ' + data.notes.length + ' notes? This cannot be undone (unless you have a backup).')) { return 'Cancelled. Notes kept.'; } var n = data.notes.length; data.notes = []; commit(); return 'Deleted ' + n + ' note(s).'; } },
    { re: /^edit\s+note\s+(\d+)\s+(.+)$/i, run: function (m) { return editItem(data.notes, m[1], m[2], 'Note'); } },
    { re: /^(?:save fact|fact)\s+(.+)$/i, run: function (m) { return saveItem('fact', m[1]); } },
    { re: /^(?:show|list)\s+facts$/i, run: function () { return listText('facts', data.facts, function (x) { return x.text; }); } },
    { re: /^(?:forget|delete)\s+fact\s+(\d+)$/i, run: function (m) { return removeAt(data.facts, m[1], 'Fact'); } },
    { re: /^add\s+task\s+(.+)$/i, run: function (m) { var t = m[1].trim(); if (t.length > 500) { return { text: 'Tasks are limited to 500 characters.', error: true }; } if (S.checkSensitive(t) === 'secret') { return { text: 'I do not store passwords, keys or card numbers.', error: true }; } data.tasks.push({ id: S.uid(), text: t, done: false, created: Date.now() }); commit(); return say('taskAdded', data.tasks.length); } },
    { re: /^(?:show|list)\s+tasks$/i, run: function () { return listText('tasks', data.tasks, function (x) { return (x.done ? '[done] ' : '[open] ') + x.text; }); } },
    { re: /^(?:complete|finish|done)\s+task\s+(\d+)$/i, run: function (m) { return setTaskDone(m[1], true); } },
    { re: /^reopen\s+task\s+(\d+)$/i, run: function (m) { return setTaskDone(m[1], false); } },
    { re: /^(?:delete|remove)\s+task\s+(\d+)$/i, run: function (m) { return removeAt(data.tasks, m[1], 'Task'); } },
    { re: /^clear\s+completed(?:\s+tasks)?$/i, run: function () { var n = data.tasks.filter(function (t) { return t.done; }).length; if (!n) { return 'No completed tasks to clear.'; } data.tasks = data.tasks.filter(function (t) { return !t.done; }); commit(); return 'Cleared ' + n + ' completed task(s).'; } },
    { re: /^set\s+name\s+(.+)$/i, run: function (m) { var n = m[1].trim().slice(0, 30); data.settings.assistantName = n; applyAppearance(); commit(); return 'Understood. I will go by ' + n + '.'; } },
    { re: /^set\s+style\s+(\w+)$/i, run: function (m) { var s = m[1].toLowerCase(); if (['adaptive', 'professional', 'casual'].indexOf(s) < 0) { return { text: 'Styles are: adaptive, professional, casual.', error: true }; } data.settings.style = s; commit(); return 'Style set to ' + s + '.'; } },
    { re: /^voice\s+(on|off)$/i, run: function (m) { if (m[1].toLowerCase() === 'on') { if (!V.canSpeak()) { return { text: 'Spoken responses are not supported in this browser.', error: true }; } data.settings.voiceOut = true; commit(); V.speak('Voice on.'); return 'Spoken responses on.'; } data.settings.voiceOut = false; V.stopSpeaking(); commit(); return 'Spoken responses off.'; } },
    { re: /^search\s+(.+)$/i, run: function (m) { return searchAll(m[1].trim()); } },
    { re: /^remind me in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\s+(?:to\s+)?(.+)$/i, run: function (m) { var mins = parseInt(m[1], 10) * (/^h/i.test(m[2]) ? 60 : 1); return wrapTool('remind', { text: m[3], minutes: mins }); } },
    { re: /^(?:show|list)\s+reminders$/i, run: function () { var p = data.reminders.filter(function (r) { return !r.fired; }); return p.length ? p.map(function (r, i) { return (i + 1) + '. ' + r.text + ' at ' + when(r.due); }).join('\n') : 'No pending reminders.'; } },
    { re: /^cancel\s+reminder\s+(\d+)$/i, run: function (m) { var p = data.reminders.filter(function (r) { return !r.fired; }), r = p[parseInt(m[1], 10) - 1]; if (!r) { return { text: 'No pending reminder number ' + m[1] + '.', error: true }; } data.reminders = data.reminders.filter(function (x) { return x !== r; }); commit(); return 'Reminder cancelled.'; } },
    { re: /^summarize\s+(?:chat|conversation)$/i, run: function () { return summarizeChat(); } },
    { re: /^summarize\s+(.+)$/i, run: function (m) { return wrapTool('summarize', { text: m[1] }); } },
    { re: /^(?:export|backup)$/i, run: function () { return doExport(); } },
    { re: /^import$/i, run: function () { var f = $('bk-file'); if (f && f.click) { f.click(); } return 'Choose a backup file. It will be checked before anything changes.'; } },
    { re: /^restore backup$/i, run: function () { return restoreBackup(); } },
    { re: /^(?:mode|go)\s+(online|offline)$/i, run: function (m) { return setMode(m[1].toLowerCase()); } }
  ];

  async function editItem(list, n, text, label) {
    var i = parseInt(n, 10) - 1;
    if (!(i >= 0 && i < list.length)) { return { text: 'There is no ' + label.toLowerCase() + ' number ' + n + '.', error: true }; }
    text = text.trim();
    if (S.checkSensitive(text) === 'secret') { return { text: 'I do not store passwords, tokens, API keys or card numbers. Nothing was changed.', error: true }; }
    if (text.length > 2000) { return { text: 'That is too long.', error: true }; }
    list[i].text = text; commit(); return label + ' ' + n + ' updated.';
  }

  // Runs a local command from a button on another tab and reports the result as a toast.
  async function quick(text) {
    var l = matchLocal(text); if (!l) { return; }
    try { var r = await l.cmd.run(l.m, text); toast(typeof r === 'string' ? r : r.text); } catch (e) { toast('That did not work: ' + e.message); }
    renderAll();
  }

  function matchLocal(text) {
    for (var i = 0; i < C.length; i++) { var m = C[i].test ? C[i].test(text) : C[i].re.exec(text); if (m) { return { cmd: C[i], m: m }; } }
    return null;
  }

  async function handleInput(raw) {
    var text = String(raw || '').trim();
    if (!text || st.busy) { return; }
    if (text.length > 2000) { addMsg('assistant error', NAME() + ' (error)', 'That is longer than 2000 characters. Please shorten it.'); return; }
    st.count++;
    st.tone = /^[a-z]/.test(text) && text.length < 40 && !/[.;:]$/.test(text) ? 'casual' : 'professional';
    if (S.checkSensitive(text) !== 'secret') { if (data.cmdHistory[data.cmdHistory.length - 1] !== text) { data.cmdHistory.push(text); } if (data.cmdHistory.length > 50) { data.cmdHistory.shift(); } S.save(); }
    st.cmdIdx = data.cmdHistory.length;
    var local = matchLocal(text);
    if (!(local && local.cmd.silent)) { addMsg('user', 'You', text); record('user', text, data.settings.mode); }
    try {
      var res;
      if (local) { res = await local.cmd.run(local.m, text); }
      else if (data.settings.mode === 'online') { res = await askAI(text); }
      else { res = 'I do not have a command for "' + clip(text, 60) + '". Type "help" for the list. For open-ended questions, set up Online AI in Settings and switch to Online AI mode.'; }
      if (res !== null && res !== undefined) { reply(res); }
    } catch (err) {
      reply({ text: 'Something went wrong while handling that, but I am still running. Details: ' + (err && err.message ? err.message : 'unknown error'), error: true });
    } finally { renderAll(); }
  }

  /* ---------- rendering ---------- */
  function renderPills() {
    var m = $('pill-mode'), a = $('pill-ai'), n = $('pill-net'); if (!m) { return; }
    var online = data.settings.mode === 'online';
    m.textContent = online ? 'Online AI mode' : 'Offline mode'; m.className = 'pill ' + (online ? 'pill-warn' : 'pill-ok');
    var map = { unconfigured: ['Online AI: not set up', ''], checking: ['Online AI: checking', 'pill-warn'], connected: ['Online AI: connected', 'pill-ok'], error: ['Online AI: unavailable', 'pill-bad'] }[st.aiState];
    a.textContent = map[0]; a.className = 'pill ' + map[1]; a.title = st.aiDetail;
    var on = 'onLine' in navigator ? navigator.onLine : true;
    n.textContent = on ? 'Network: online' : 'Network: offline'; n.className = 'pill ' + (on ? '' : 'pill-warn');
    var b1 = $('mode-offline'), b2 = $('mode-online'); b1.setAttribute('aria-pressed', String(!online)); b2.setAttribute('aria-pressed', String(online));
  }
  function renderSettingsState() { var e = $('ai-state'); if (e) { e.textContent = { unconfigured: 'Not set up. Add your Backend URL below.', checking: 'Checking the connection...', connected: 'Connected. ' + st.aiDetail, error: 'Not available. ' + st.aiDetail }[st.aiState]; } }
  function renderSharing() {
    var c = selectedContext(), e = $('sharing'); if (!e) { return; }
    var parts = []; if (st.turns > 0) { parts.push('last ' + st.turns + ' exchange(s)'); } if (c.count) { parts.push(c.count + ' saved item(s)'); }
    e.textContent = data.settings.mode === 'online' ? 'Sharing with AI: ' + (parts.length ? parts.join(' + ') : 'nothing extra') : 'Nothing is shared (offline mode)';
  }
  function empty(text) { return h('li', { class: 'empty', text: text }); }
  function matches(t) { return !st.q || String(t).toLowerCase().indexOf(st.q) >= 0; }
  function memoryList(root, list, label, editable) {
    clear(root); var shown = 0;
    list.forEach(function (x, i) {
      if (!matches(x.text)) { return; } shown++;
      var li = h('li', {}, [h('div', { class: 'txt' }, [h('span', { text: (i + 1) + '. ' + x.text }), h('small', { text: when(x.created) })])]);
      if (editable) { li.appendChild(h('button', { type: 'button', class: 'ghost', 'aria-label': 'Edit ' + label + ' ' + (i + 1), text: 'Edit', onclick: function () { var v = window.prompt('Edit ' + label, x.text); if (v === null) { return; } editItem(list, String(i + 1), v, label[0].toUpperCase() + label.slice(1)).then(function (r) { toast(typeof r === 'string' ? r : r.text); }); } })); }
      li.appendChild(h('button', { type: 'button', class: 'ghost', 'aria-label': 'Delete ' + label + ' ' + (i + 1), text: 'Delete', onclick: function () { list.splice(i, 1); commit(); } }));
      root.appendChild(li);
    });
    if (!shown) { root.appendChild(empty(list.length ? 'Nothing matches your search.' : 'Nothing saved yet.')); }
  }
  function renderMemory() {
    memoryList($('facts-list'), data.facts, 'fact', true);
    memoryList($('notes-list'), data.notes, 'note', true);
    memoryList($('sum-list'), data.summaries, 'summary', false);
    var hl = $('hist-list'); clear(hl); var shown = 0;
    data.chat.slice(-40).reverse().forEach(function (m) { if (!matches(m.text)) { return; } shown++; hl.appendChild(h('li', {}, [h('div', { class: 'txt' }, [h('span', { text: (m.role === 'user' ? 'You: ' : 'Assistant: ') + clip(m.text, 300) }), h('small', { text: when(m.t) + ', ' + m.mode })])])); });
    if (!shown) { hl.appendChild(empty(data.settings.saveHistory ? 'No saved conversation yet.' : 'History saving is off (see Settings).')); }
    var cl = $('cmd-list'); clear(cl);
    data.cmdHistory.slice(-8).reverse().forEach(function (c) { if (!matches(c)) { return; } cl.appendChild(h('li', {}, [h('div', { class: 'txt', text: c }), h('button', { type: 'button', class: 'ghost', text: 'Run again', 'aria-label': 'Run again: ' + c, onclick: function () { showTab('console'); handleInput(c); } })])); });
    if (!cl.firstChild) { cl.appendChild(empty('No commands yet.')); }
    // context chooser
    var cx = $('ctx-list'); clear(cx);
    var add = function (kind, x) { var id = 'ctx-' + x.id; var cb = h('input', { type: 'checkbox', id: id }); cb.checked = !!st.sel[x.id]; cb.addEventListener('change', function () { st.sel[x.id] = cb.checked; renderSharing(); }); cx.appendChild(h('div', { class: 'ctxrow' }, [cb, h('label', { for: id, text: kind + ': ' + clip(x.text, 120) })])); };
    data.facts.forEach(function (x) { add('Fact', x); }); data.notes.forEach(function (x) { add('Note', x); });
    if (!cx.firstChild) { cx.appendChild(h('p', { class: 'hint', text: 'No facts or notes to share yet.' })); }
  }
  function renderTasks() {
    var root = $('tasks-list'); clear(root); var shown = 0;
    data.tasks.forEach(function (t, i) {
      if (st.taskFilter === 'open' && t.done) { return; } if (st.taskFilter === 'done' && !t.done) { return; } if (!matches(t.text)) { return; } shown++;
      var cb = h('input', { type: 'checkbox', 'aria-label': 'Task ' + (i + 1) + ' complete' }); cb.checked = t.done; cb.addEventListener('change', function () { t.done = cb.checked; commit(); });
      root.appendChild(h('li', { class: t.done ? 'done' : '' }, [cb, h('div', { class: 'txt' }, [h('span', { text: (i + 1) + '. ' + t.text })]), h('button', { type: 'button', class: 'ghost', 'aria-label': 'Delete task ' + (i + 1), text: 'Delete', onclick: function () { data.tasks.splice(i, 1); commit(); } })]));
    });
    if (!shown) { root.appendChild(empty(data.tasks.length ? 'No tasks match this filter.' : 'No tasks yet. Add one above.')); }
    var rl = $('rem-list'); clear(rl); var pend = data.reminders.filter(function (r) { return !r.fired; });
    pend.forEach(function (r, i) { rl.appendChild(h('li', {}, [h('div', { class: 'txt' }, [h('span', { text: r.text }), h('small', { text: 'Due ' + when(r.due) })]), h('button', { type: 'button', class: 'ghost', text: 'Cancel', 'aria-label': 'Cancel reminder ' + (i + 1), onclick: function () { data.reminders = data.reminders.filter(function (x) { return x !== r; }); commit(); } })])); });
    if (!pend.length) { rl.appendChild(empty('No pending reminders.')); }
    document.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === st.taskFilter)); });
  }
  function renderSettings() {
    var s = data.settings; if (!$('set-name')) { return; }
    $('set-name').value = s.assistantName; $('set-style').value = s.style; $('set-size').value = s.textSize;
    $('set-voice').checked = s.voiceOut; $('set-confirm').checked = s.confirmFacts; $('set-hist').checked = s.saveHistory; $('set-url').value = s.backendUrl;
    $('voice-support').textContent = 'Voice input: ' + (V.canListen() ? 'supported by this browser.' : 'not supported by this browser.') + ' Spoken output: ' + (V.canSpeak() ? 'supported.' : 'not supported.');
    $('bk-note').textContent = 'Last data save: ' + (S.isPersistent() ? 'stored in this browser.' : 'NOT stored. This browser blocked local storage. Download a backup often.') + (S.hasSnapshot() ? ' An earlier copy from before your last import is available.' : '');
    $('bk-restore').disabled = !S.hasSnapshot();
    document.querySelectorAll('.swatch').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-color').toLowerCase() === s.accent.toLowerCase())); });
    renderSettingsState();
  }
  function renderAll() { renderPills(); renderSharing(); renderMemory(); renderTasks(); renderSettings(); }

  function buildTools() {
    var root = $('tools-root'); if (!root) { return; } clear(root);
    root.appendChild(h('p', { class: 'hint', text: 'Tools run only when you press Run (or type the matching command). The online AI cannot run tools for you.' }));
    T.list().forEach(function (tool) {
      var inputs = {}; var out = h('p', { class: 'result', role: 'status', 'aria-live': 'polite', text: '' });
      var form = h('form', { class: 'card' }, [h('h2', { text: tool.label }), h('div', { class: 'tags' }, tool.needs.map(function (n) { return h('span', { class: 'tag', text: n }); }))]);
      tool.fields.forEach(function (f) {
        var id = 'tool-' + tool.id + '-' + f.name, el;
        el = f.type === 'textarea' ? h('textarea', { id: id, maxlength: '200000', placeholder: f.placeholder || '' }) : h('input', { id: id, type: 'text', maxlength: '200', placeholder: f.placeholder || '' });
        inputs[f.name] = el;
        form.appendChild(h('label', { class: 'field', for: id, text: f.label })); form.appendChild(el);
        if (f.file) { var fi = h('input', { type: 'file', accept: '.txt,.md,text/plain', 'aria-label': 'Load a text file for ' + tool.label }); fi.addEventListener('change', function () { readFile(fi.files && fi.files[0], 200 * 1024, function (t) { el.value = t; toast('File loaded.'); }); }); form.appendChild(fi); }
      });
      form.appendChild(h('div', { class: 'row' }, [h('button', { type: 'submit', text: 'Run' })])); form.appendChild(out);
      form.addEventListener('submit', async function (e) {
        e.preventDefault(); var args = {}; Object.keys(inputs).forEach(function (k) { args[k] = inputs[k].value; });
        out.className = 'result'; out.textContent = 'Running...';
        var r = await T.run(tool.id, args); out.textContent = r.text; out.className = 'result' + (r.ok ? '' : ' err'); if (tool.id === 'remind' && r.ok) { renderAll(); }
      });
      root.appendChild(form);
    });
  }

  /* ---------- tabs ---------- */
  var TABS = ['console', 'memory', 'tasks', 'tools', 'settings'];
  function showTab(name) {
    TABS.forEach(function (t) {
      var on = t === name, b = $('tab-' + t), p = $('panel-' + t);
      b.setAttribute('aria-selected', String(on)); b.setAttribute('tabindex', on ? '0' : '-1'); p.hidden = !on;
    });
    if (name === 'console') { var l = $('log'); if (l) { l.scrollTop = l.scrollHeight; } }
  }

  /* ---------- start-up ---------- */
  function wire() {
    $('form').addEventListener('submit', function (e) { e.preventDefault(); var v = $('input').value; $('input').value = ''; handleInput(v); $('input').focus(); });
    $('input').addEventListener('keydown', function (e) {
      var h2 = data.cmdHistory; if (!h2.length) { return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); st.cmdIdx = Math.max(0, st.cmdIdx - 1); $('input').value = h2[st.cmdIdx] || ''; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); st.cmdIdx = Math.min(h2.length, st.cmdIdx + 1); $('input').value = h2[st.cmdIdx] || ''; }
    });
    $('cancel').addEventListener('click', function () { if (st.cancel) { st.cancel(); } });
    document.querySelectorAll('.chip').forEach(function (b) { b.addEventListener('click', function () { handleInput(b.getAttribute('data-cmd')); }); });
    TABS.forEach(function (t, i) {
      var b = $('tab-' + t);
      b.addEventListener('click', function () { showTab(t); });
      b.addEventListener('keydown', function (e) { var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { var n = TABS[(i + d + TABS.length) % TABS.length]; showTab(n); $('tab-' + n).focus(); } });
    });
    $('mode-offline').addEventListener('click', function () { reply(setMode('offline')); });
    $('mode-online').addEventListener('click', function () { reply(setMode('online')); });
    $('mic').addEventListener('click', function () {
      if (st.listening) { V.stopListening(); return; }
      st.listening = true; $('mic').setAttribute('aria-pressed', 'true'); $('mic').textContent = 'Stop'; $('mic').setAttribute('aria-label', 'Stop listening');
      V.listen({
        onResult: function (t) { $('input').value = ''; handleInput(t); },
        onError: function (msg) { addMsg('assistant error', NAME() + ' (voice)', msg); },
        onEnd: function () { st.listening = false; $('mic').setAttribute('aria-pressed', 'false'); $('mic').textContent = 'Mic'; $('mic').setAttribute('aria-label', 'Start voice input'); }
      });
    });
    $('search').addEventListener('input', function () { st.q = $('search').value.trim().toLowerCase(); $('search-tasks').value = $('search').value; renderMemory(); renderTasks(); });
    $('search-tasks').addEventListener('input', function () { st.q = $('search-tasks').value.trim().toLowerCase(); $('search').value = $('search-tasks').value; renderMemory(); renderTasks(); });
    $('ctx-turns').addEventListener('change', function () { st.turns = parseInt($('ctx-turns').value, 10) || 0; renderSharing(); });
    $('ctx-clear').addEventListener('click', function () { st.sel = {}; renderMemory(); renderSharing(); });
    $('fact-form').addEventListener('submit', async function (e) { e.preventDefault(); var r = await saveItem('fact', $('fact-input').value); toast(typeof r === 'string' ? r : r.text); if (typeof r === 'string' && /saved/.test(r)) { $('fact-input').value = ''; } });
    $('note-form').addEventListener('submit', async function (e) { e.preventDefault(); var r = await saveItem('note', $('note-input').value); toast(typeof r === 'string' ? r : r.text); if (typeof r === 'string' && /saved/.test(r)) { $('note-input').value = ''; } });
    $('task-form').addEventListener('submit', function (e) { e.preventDefault(); var v = $('task-input').value.trim(); if (!v) { return; } if (S.checkSensitive(v) === 'secret') { toast('I do not store passwords, keys or card numbers.'); return; } data.tasks.push({ id: S.uid(), text: v.slice(0, 500), done: false, created: Date.now() }); $('task-input').value = ''; commit(); });
    document.querySelectorAll('[data-filter]').forEach(function (b) { b.addEventListener('click', function () { st.taskFilter = b.getAttribute('data-filter'); renderTasks(); }); });
    $('tasks-clear').addEventListener('click', function () { quick('clear completed tasks'); });
    $('hist-clear').addEventListener('click', function () { quick('clear history'); });
    $('set-name').addEventListener('change', function () { var v = $('set-name').value.trim().slice(0, 30); if (v) { data.settings.assistantName = v; applyAppearance(); commit(); toast('Name saved.'); } });
    $('set-style').addEventListener('change', function () { data.settings.style = $('set-style').value; commit(); toast('Style saved.'); });
    $('set-size').addEventListener('change', function () { data.settings.textSize = $('set-size').value; applyAppearance(); commit(); });
    $('set-voice').addEventListener('change', function () { if ($('set-voice').checked && !V.canSpeak()) { $('set-voice').checked = false; toast('Spoken output is not supported in this browser.'); return; } data.settings.voiceOut = $('set-voice').checked; if (!data.settings.voiceOut) { V.stopSpeaking(); } commit(); });
    $('set-confirm').addEventListener('change', function () { data.settings.confirmFacts = $('set-confirm').checked; commit(); });
    $('set-hist').addEventListener('change', function () { data.settings.saveHistory = $('set-hist').checked; commit(); });
    $('ai-save').addEventListener('click', async function () {
      var raw = $('set-url').value.trim(), url = S.cleanUrl(raw);
      if (raw && !url) { toast('The Backend URL must start with https://'); return; }
      data.settings.backendUrl = url; if (!url) { data.settings.mode = 'offline'; } S.save(); renderAll();
      if (url) { toast('Testing connection...'); await refreshHealth(); toast(st.aiState === 'connected' ? 'Connected.' : 'Not connected: ' + st.aiDetail); }
    });
    var sw = $('swatches');
    [['#22e5ff', 'Cyan'], ['#4dff9d', 'Green'], ['#b388ff', 'Violet'], ['#ff8a50', 'Orange'], ['#ffd23f', 'Yellow'], ['#ff5fa2', 'Pink']].forEach(function (c) {
      var b = h('button', { type: 'button', class: 'swatch', 'data-color': c[0], 'aria-label': c[1] + ' accent', 'aria-pressed': 'false' }); b.style.background = c[0];
      b.addEventListener('click', function () { data.settings.accent = c[0]; applyAppearance(); commit(); }); sw.appendChild(b);
    });
    $('bk-export').addEventListener('click', function () { reply(doExport()); toast('Backup downloaded.'); });
    $('bk-import').addEventListener('click', function () { $('bk-file').click(); });
    $('bk-file').addEventListener('change', function () { var f = $('bk-file').files && $('bk-file').files[0]; readFile(f, 5 * 1024 * 1024, function (t) { var r = importText(t); toast(typeof r === 'string' ? r : r.text); }); $('bk-file').value = ''; });
    $('bk-restore').addEventListener('click', function () { var r = restoreBackup(); toast(typeof r === 'string' ? r : r.text); });
    $('erase-all').addEventListener('click', function () {
      if (!confirmAction('Erase ALL F.R.I.D.A.Y. data on this device (notes, facts, tasks, history, settings)? Download a backup first if you might want it back.')) { return; }
      try { window.localStorage.removeItem('friday.data.v1.snapshot'); } catch (e) { /* ignore */ }
      data = S.replace(S.defaults()); st.aiTurns = []; st.sel = {}; applyAppearance(); clear($('log')); renderAll(); refreshHealth(); toast('All data erased.');
    });
    window.addEventListener('online', function () { renderPills(); if (backendUrl()) { refreshHealth(); } });
    window.addEventListener('offline', renderPills);
  }

  function init() {
    wire(); buildTools(); applyAppearance();
    if (data.settings.mode === 'online' && !backendUrl()) { data.settings.mode = 'offline'; }
    renderAll();
    var tick = function () { var c = $('clock'); if (c) { c.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } };
    tick(); setInterval(tick, 15000); setInterval(checkReminders, 5000);
    addMsg('assistant', NAME() + ' (offline)', greetingNow() + '. ' + NAME() + ' is running.\n' +
      'Offline commands (notes, tasks, maths, conversions, reminders) work without internet. ' +
      (data.settings.mode === 'online' ? 'Online AI mode is on.' : 'For open-ended chat, set up Online AI in Settings. Until then I only understand commands.') +
      '\nType "help" to see everything.' + (S.isPersistent() ? '' : '\nWarning: this browser is blocking local storage, so nothing you save will persist. Use Settings > Download backup.'));
    checkReminders();
    if (backendUrl()) { refreshHealth(); }
    showTab('console');
  }

  F.app = { st: st, handle: handleInput, data: function () { return data; }, last: function () { return st.last; }, route: matchLocal };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
