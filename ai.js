/* F.R.I.D.A.Y. ai.js
 * Talks to YOUR backend (the Cloudflare Worker in backend/worker.js). Never talks to an AI provider directly.
 * There are no API keys in this file or anywhere in the frontend.
 * A reply is only reported as successful if the backend returns { ok: true, text: "..." }.
 */
(function () {
  'use strict';
  var F = (window.FRIDAY = window.FRIDAY || {});
  var CHAT_TIMEOUT_MS = 35000;
  var HEALTH_TIMEOUT_MS = 8000;
  var MAX_INPUT = 2000;

  function AiError(code, message) { var e = new Error(message); e.code = code; return e; }

  var HTTP_MESSAGES = {
    400: 'The backend rejected the request as invalid.',
    401: 'The AI provider rejected the credentials. Check the secret key in your backend settings.',
    403: 'The backend refused this request. Check ALLOWED_ORIGIN in your backend settings.',
    413: 'The message was too large.',
    429: 'Rate limit reached. Wait a little and try again.',
    500: 'The backend hit an internal error.',
    502: 'The AI provider returned an error. It may be having an outage.',
    503: 'The AI provider is unavailable right now.',
    504: 'The AI provider took too long to answer.'
  };

  function request(url, options, timeoutMs, externalSignal) {
    var ctl = new AbortController(), timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctl.abort(); }, timeoutMs);
    var cancel = function () { ctl.abort(); };
    var promise = (async function () {
      var res;
      try {
        options.signal = ctl.signal;
        res = await fetch(url, options);
      } catch (e) {
        if (e && e.name === 'AbortError') { throw timedOut ? AiError('timeout', 'The request timed out. The backend or provider is slow or unreachable.') : AiError('cancelled', 'Request cancelled.'); }
        throw AiError('network', 'Could not reach the backend. Check your internet connection, the Backend URL in Settings, and that ALLOWED_ORIGIN in the backend matches this site\'s exact address.');
      } finally { clearTimeout(timer); }
      var body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      if (!res.ok || !body || body.ok !== true) {
        var code = body && body.error && body.error.code ? body.error.code : 'http_' + res.status;
        var msg = body && body.error && body.error.message ? body.error.message : (HTTP_MESSAGES[res.status] || 'The backend returned an unexpected error (HTTP ' + res.status + ').');
        throw AiError(code, msg);
      }
      return body;
    })();
    return { promise: promise, cancel: cancel };
  }

  // Returns { state: 'unconfigured'|'connected'|'error', detail }
  async function health(url) {
    if (!url) { return { state: 'unconfigured', detail: 'No backend URL set.' }; }
    try {
      var r = request(url + '/health', { method: 'GET' }, HEALTH_TIMEOUT_MS);
      var body = await r.promise;
      if (body.configured === false) { return { state: 'error', detail: 'The backend is online but not fully configured (missing secrets or settings).' }; }
      return { state: 'connected', detail: 'Backend reachable. Provider: ' + (body.provider || 'unknown') + '.' };
    } catch (e) { return { state: 'error', detail: e.message }; }
  }

  // opts: { url, messages:[{role,content}], context, style, name }
  // Returns { promise -> string, cancel() }
  function chat(opts) {
    if (!opts.url) { return { promise: Promise.reject(AiError('unconfigured', 'Online AI is not set up. Add your Backend URL in Settings.')), cancel: function () {} }; }
    var last = opts.messages[opts.messages.length - 1];
    if (!last || !last.content || last.content.length > MAX_INPUT) {
      return { promise: Promise.reject(AiError('too_long', 'Messages are limited to ' + MAX_INPUT + ' characters.')), cancel: function () {} };
    }
    var payload = { messages: opts.messages, context: opts.context || '', style: opts.style, name: opts.name };
    var r = request(opts.url + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, CHAT_TIMEOUT_MS);
    var promise = r.promise.then(function (body) {
      if (typeof body.text !== 'string' || !body.text.trim()) { throw AiError('empty', 'The AI returned an empty answer.'); }
      return body.text;
    });
    return { promise: promise, cancel: r.cancel };
  }

  F.ai = { chat: chat, health: health, MAX_INPUT: MAX_INPUT };
})();
