/* F.R.I.D.A.Y. voice.js
 * Voice input (speech recognition) and spoken output (speech synthesis).
 * Both depend on the browser. On many browsers, recognition sends audio to an online service run by the browser vendor.
 */
(function () {
  'use strict';
  var F = (window.FRIDAY = window.FRIDAY || {});
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recog = null;

  function canListen() { return !!Rec; }
  function canSpeak() { return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined'; }

  function speak(text) {
    if (!canSpeak()) { return false; }
    try {
      window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(String(text).slice(0, 600));
      u.rate = 1; u.pitch = 1;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }
  function stopSpeaking() { if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } } }

  var ERRORS = {
    'not-allowed': 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.',
    'service-not-allowed': 'This browser does not allow speech recognition for this page.',
    'no-speech': 'I did not hear anything. Tap the microphone and try again.',
    'audio-capture': 'No microphone was found.',
    'network': 'Speech recognition needs an internet connection in this browser, and it could not connect.',
    'aborted': 'Listening was cancelled.',
    'language-not-supported': 'That language is not supported for voice input.'
  };

  // handlers: { onResult(text), onError(message), onEnd() }
  function listen(handlers) {
    if (!Rec) { handlers.onError('Voice input is not supported in this browser. Try Chrome or Samsung Internet. You can still type.'); handlers.onEnd(); return false; }
    try {
      if (recog) { recog.abort(); }
      recog = new Rec();
      recog.lang = (navigator.language || 'en-US');
      recog.interimResults = false;
      recog.maxAlternatives = 1;
      recog.onresult = function (e) { var t = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : ''; if (t) { handlers.onResult(t); } };
      recog.onerror = function (e) { handlers.onError(ERRORS[e.error] || 'Voice input failed (' + e.error + ').'); };
      recog.onend = function () { handlers.onEnd(); };
      recog.start();
      return true;
    } catch (err) { handlers.onError('Could not start voice input. ' + (err && err.message ? err.message : '')); handlers.onEnd(); return false; }
  }
  function stopListening() { if (recog) { try { recog.stop(); } catch (e) { /* ignore */ } } }

  F.voice = { canListen: canListen, canSpeak: canSpeak, speak: speak, stopSpeaking: stopSpeaking, listen: listen, stopListening: stopListening };
})();
