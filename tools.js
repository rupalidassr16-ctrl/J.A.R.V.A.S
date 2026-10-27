/* F.R.I.D.A.Y. tools.js
 * Tool registry. Every tool declares what it needs, validates its inputs, and reports errors.
 * Tools only run when the USER invokes them (command or Tools tab).
 * Online AI output is never executed, never parsed into tool calls, and never run as code.
 */
(function () {
  'use strict';
  var F = (window.FRIDAY = window.FRIDAY || {});
  var registry = {};
  var order = [];

  function register(tool) {
    if (!tool || !tool.id || typeof tool.run !== 'function') { throw new Error('Invalid tool definition'); }
    registry[tool.id] = tool;
    if (order.indexOf(tool.id) < 0) { order.push(tool.id); }
  }
  function list() { return order.map(function (id) { return registry[id]; }); }
  function get(id) { return registry[id]; }

  // Validates arguments, runs the tool, and always returns { ok, text } (never throws).
  async function run(id, args, ctx) {
    var tool = registry[id];
    if (!tool) { return { ok: false, text: 'Unknown tool: ' + id }; }
    try {
      var clean = tool.validate ? tool.validate(args || {}) : (args || {});
      var out = await tool.run(clean, ctx || {});
      return { ok: true, text: String(out) };
    } catch (err) {
      return { ok: false, text: (err && err.message) ? err.message : 'The tool failed.' };
    }
  }

  /* ---------- Calculator (no eval) ---------- */
  function tokenize(source) {
    var s = source.replace(/\u00d7/g, '*').replace(/\u00f7/g, '/').replace(/(\d)\s*x\s*(?=[\d(.])/gi, '$1*').replace(/,/g, '');
    var tokens = [], i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        var m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
        if (!m) { throw new Error('Misplaced "." in the expression.'); }
        tokens.push({ t: 'num', v: parseFloat(m[1]) }); i += m[1].length; continue;
      }
      if ('+-*/%^()'.indexOf(ch) !== -1) { tokens.push({ t: 'op', v: ch }); i++; continue; }
      throw new Error('I can only calculate with numbers and + - * / % ^ ( ). Found "' + ch + '".');
    }
    if (!tokens.length) { throw new Error('Nothing to calculate.'); }
    return tokens;
  }

  function evaluate(source) {
    var tokens = tokenize(source), pos = 0, depth = 0;
    var isOp = function (v) { var t = tokens[pos]; return !!t && t.t === 'op' && t.v === v; };
    function expr() { var l = term(); while (isOp('+') || isOp('-')) { var o = tokens[pos++].v, r = term(); l = o === '+' ? l + r : l - r; } return l; }
    function term() {
      var l = unary();
      while (isOp('*') || isOp('/') || isOp('%')) {
        var o = tokens[pos++].v, r = unary();
        if (o === '*') { l = l * r; } else { if (r === 0) { throw new Error('Division by zero is undefined.'); } l = o === '/' ? l / r : l % r; }
      }
      return l;
    }
    function unary() { if (isOp('-')) { pos++; return -unary(); } if (isOp('+')) { pos++; return unary(); } return power(); }
    function power() { var b = primary(); if (isOp('^')) { pos++; return Math.pow(b, unary()); } return b; }
    function primary() {
      var tok = tokens[pos];
      if (!tok) { throw new Error('The expression ends too early.'); }
      if (tok.t === 'num') { pos++; return tok.v; }
      if (tok.v === '(') {
        if (++depth > 40) { throw new Error('Too many nested parentheses.'); }
        pos++; var v = expr();
        if (!isOp(')')) { throw new Error('A closing ")" is missing.'); }
        pos++; depth--; return v;
      }
      throw new Error('Unexpected "' + tok.v + '" in the expression.');
    }
    var result = expr();
    if (pos < tokens.length) { throw new Error('Unexpected "' + tokens[pos].v + '" in the expression.'); }
    if (!isFinite(result)) { throw new Error('That result is too large or not a real number.'); }
    return result;
  }
  function fmt(n) { return String(parseFloat(n.toPrecision(12))); }

  /* ---------- Unit conversion ---------- */
  var UNITS = {
    length: { base: 'm', u: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 } },
    mass: { base: 'kg', u: { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 } },
    volume: { base: 'l', u: { l: 1, ml: 0.001, gal: 3.785411784, qt: 0.946352946, cup: 0.2365882365, floz: 0.0295735295625 } },
    speed: { base: 'm/s', u: { 'm/s': 1, 'km/h': 0.2777777778, mph: 0.44704, knot: 0.5144444444 } },
    temp: { base: 'c', u: { c: 1, f: 1, k: 1 } }
  };
  var ALIAS = {
    meter: 'm', metre: 'm', meters: 'm', metres: 'm', kilometer: 'km', kilometre: 'km', kilometers: 'km', kilometres: 'km', centimeter: 'cm', centimeters: 'cm', millimeter: 'mm', millimeters: 'mm',
    mile: 'mi', miles: 'mi', yard: 'yd', yards: 'yd', foot: 'ft', feet: 'ft', inch: 'in', inches: 'in',
    kilogram: 'kg', kilograms: 'kg', kgs: 'kg', gram: 'g', grams: 'g', pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz',
    liter: 'l', litre: 'l', liters: 'l', litres: 'l', milliliter: 'ml', milliliters: 'ml', gallon: 'gal', gallons: 'gal', quart: 'qt', quarts: 'qt', cups: 'cup',
    kph: 'km/h', kmh: 'km/h', kmph: 'km/h', knots: 'knot', kt: 'knot', ms: 'm/s',
    celsius: 'c', fahrenheit: 'f', kelvin: 'k'
  };
  function unitKey(raw) {
    var u = String(raw).toLowerCase().replace(/\u00b0/g, '').replace(/\s+/g, '');
    if (ALIAS[u]) { u = ALIAS[u]; }
    return u;
  }
  function findUnit(u) {
    for (var cat in UNITS) { if (Object.prototype.hasOwnProperty.call(UNITS[cat].u, u)) { return cat; } }
    return null;
  }
  function convert(value, fromRaw, toRaw) {
    var from = unitKey(fromRaw), to = unitKey(toRaw);
    var cf = findUnit(from), ct = findUnit(to);
    if (!cf) { throw new Error('I do not know the unit "' + fromRaw + '".'); }
    if (!ct) { throw new Error('I do not know the unit "' + toRaw + '".'); }
    if (cf !== ct) { throw new Error('Cannot convert ' + cf + ' to ' + ct + '.'); }
    if (cf === 'temp') {
      var c = from === 'c' ? value : from === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
      return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    }
    return value * UNITS[cf].u[from] / UNITS[cf].u[to];
  }

  /* ---------- Date utilities ---------- */
  function daysUntil(y, m, d) {
    var target = new Date(y, m - 1, d);
    if (target.getFullYear() !== y || target.getMonth() !== m - 1 || target.getDate() !== d) { throw new Error('That is not a real calendar date. Use YYYY-MM-DD.'); }
    var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }
  function timeIn(zone) {
    try { return new Date().toLocaleString([], { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { throw new Error('Unknown time zone "' + zone + '". Use a name like Europe/London or Asia/Tokyo.'); }
  }

  /* ---------- Text summary (runs locally, extractive) ---------- */
  var STOP = /^(the|a|an|and|or|but|of|to|in|on|for|with|is|are|was|were|be|been|it|this|that|as|at|by|from|i|you|he|she|we|they|not|have|has|had|will|would|can|could)$/;
  function summarize(text, maxSentences) {
    var clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 40) { throw new Error('Give me at least a few sentences to summarize.'); }
    var sentences = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [clean];
    sentences = sentences.map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 15; });
    if (sentences.length <= maxSentences) { return sentences.join(' '); }
    var freq = {};
    clean.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).forEach(function (w) { if (w.length > 2 && !STOP.test(w)) { freq[w] = (freq[w] || 0) + 1; } });
    var scored = sentences.map(function (s, i) {
      var words = s.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && !STOP.test(w); });
      var score = words.reduce(function (a, w) { return a + (freq[w] || 0); }, 0) / Math.sqrt(words.length + 1);
      return { i: i, s: s, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, maxSentences).sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.s; }).join(' ');
  }

  /* ---------- Weather (Open-Meteo, internet required, no key) ---------- */
  var WCODE = { 0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' };
  async function fetchJson(url) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 10000);
    try {
      var res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) { throw new Error('The weather service answered with an error (HTTP ' + res.status + ').'); }
      return await res.json();
    } catch (e) {
      if (e && e.name === 'AbortError') { throw new Error('The weather service took too long to answer.'); }
      if (e instanceof TypeError) { throw new Error('Could not reach the weather service. Check your internet connection.'); }
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function weather(city) {
    var geo = await fetchJson('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=' + encodeURIComponent(city));
    if (!geo || !geo.results || !geo.results.length) { throw new Error('I could not find a place called "' + city + '".'); }
    var p = geo.results[0];
    var w = await fetchJson('https://api.open-meteo.com/v1/forecast?latitude=' + p.latitude + '&longitude=' + p.longitude + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto');
    var c = w && w.current;
    if (!c || typeof c.temperature_2m !== 'number') { throw new Error('The weather service returned data I could not read.'); }
    var place = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
    return 'Weather in ' + place + ': ' + (WCODE[c.weather_code] || 'conditions unknown') + ', ' + c.temperature_2m + '\u00b0C (feels like ' + c.apparent_temperature + '\u00b0C), humidity ' + c.relative_humidity_2m + '%, wind ' + c.wind_speed_10m + ' km/h. Source: Open-Meteo.';
  }

  /* ---------- Register built-in tools ---------- */
  var need = function (v, name, max) { v = String(v == null ? '' : v).trim(); if (!v) { throw new Error('Please fill in: ' + name + '.'); } if (v.length > max) { throw new Error(name + ' is too long (max ' + max + ' characters).'); } return v; };

  register({ id: 'calc', label: 'Calculator', needs: ['Works offline'], fields: [{ name: 'expr', label: 'Expression', type: 'text', placeholder: '12 * (3 + 4)' }],
    validate: function (a) { return { expr: need(a.expr, 'Expression', 200) }; },
    run: function (a) { return a.expr + ' = ' + fmt(evaluate(a.expr)); } });

  register({ id: 'convert', label: 'Unit converter', needs: ['Works offline'], fields: [{ name: 'value', label: 'Value', type: 'text', placeholder: '10' }, { name: 'from', label: 'From unit', type: 'text', placeholder: 'km' }, { name: 'to', label: 'To unit', type: 'text', placeholder: 'miles' }],
    validate: function (a) { var v = parseFloat(String(a.value).replace(/,/g, '')); if (!isFinite(v)) { throw new Error('Value must be a number.'); } return { value: v, from: need(a.from, 'From unit', 20), to: need(a.to, 'To unit', 20) }; },
    run: function (a) { return fmt(a.value) + ' ' + a.from + ' = ' + fmt(convert(a.value, a.from, a.to)) + ' ' + a.to; } });

  register({ id: 'weather', label: 'Weather', needs: ['Needs internet', 'Uses Open-Meteo (no account)'], fields: [{ name: 'city', label: 'City', type: 'text', placeholder: 'London' }],
    validate: function (a) { return { city: need(a.city, 'City', 80) }; },
    run: function (a) { return weather(a.city); } });

  register({ id: 'summarize', label: 'Summarize text', needs: ['Works offline', 'Local extractive summary'], fields: [{ name: 'text', label: 'Text (or load a .txt/.md file)', type: 'textarea', file: true }],
    validate: function (a) { return { text: need(a.text, 'Text', 200000) }; },
    run: function (a) { return summarize(a.text, 4); } });

  register({ id: 'days', label: 'Days until a date', needs: ['Works offline'], fields: [{ name: 'date', label: 'Date (YYYY-MM-DD)', type: 'text', placeholder: '2026-12-25' }],
    validate: function (a) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a.date).trim()); if (!m) { throw new Error('Use the format YYYY-MM-DD.'); } return { y: +m[1], m: +m[2], d: +m[3], raw: m[0] }; },
    run: function (a) { var n = daysUntil(a.y, a.m, a.d); return n === 0 ? a.raw + ' is today.' : n > 0 ? n + ' day(s) until ' + a.raw + '.' : Math.abs(n) + ' day(s) since ' + a.raw + '.'; } });

  register({ id: 'zone', label: 'Time in another place', needs: ['Works offline'], fields: [{ name: 'zone', label: 'Time zone name', type: 'text', placeholder: 'Asia/Tokyo' }],
    validate: function (a) { return { zone: need(a.zone, 'Time zone', 60) }; },
    run: function (a) { return 'In ' + a.zone + ': ' + timeIn(a.zone); } });

  F.tools = { register: register, list: list, get: get, run: run, evaluate: evaluate, fmt: fmt, convert: convert, summarize: summarize, daysUntil: daysUntil };
})();
