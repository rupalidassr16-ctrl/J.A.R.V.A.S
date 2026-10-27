F.R.I.D.A.Y. - COMPLETE SYSTEM (PHASES 1 TO 8)
==============================================

FILE TREE
  friday-complete/
    index.html               page (multi-file version)
    style.css                look
    storage.js               local data, validation, backup/import, safety checks
    tools.js                 tool registry (calculator, converter, weather, summarize, dates)
    voice.js                 voice input and spoken output
    ai.js                    talks to YOUR backend (no keys here)
    app.js                   interface, commands, memory, tasks, reminders, settings
    friday-single-file.html  EVERYTHING above in one file (easiest to upload)
    backend/worker.js        secure backend (Cloudflare Worker) that holds your AI key
    backend/.dev.vars.example  placeholders only
    README.txt               this guide

TWO WAYS TO PUT THE APP ONLINE
  Easy: upload only friday-single-file.html (rename it index.html).
  Modular: upload index.html, style.css, storage.js, tools.js, voice.js, ai.js, app.js
           into the same folder, with exactly those names.
  The backend (worker.js) is separate and only needed for Online AI.

PART A - THE APP (works fully offline, no account needed beyond hosting)
  BACK UP FIRST: if you already deployed Phase 1, download its files again
  from your hosting before replacing anything. Phase 1 stored no user data, so
  nothing else is at risk.
  1. Extract the ZIP on your tablet (My Files > tap the ZIP > Extract).
  2. Open ship.page, open your existing site (or create one) and follow its
     on-screen prompts. (I have not verified ship.page's current screens.)
  3. Upload the files from the list above. Replace the old index.html,
     style.css and app.js. Keep names exact and lowercase.
  4. Open your site. Type: help, add task test, calc 2+2, status.
  Important: save your site's exact address (for example https://name.example).
  You need it in Part B as ALLOWED_ORIGIN: scheme and host only, no path, no
  trailing slash.

PART B - ONLINE AI BACKEND (optional)
  Requirements before you start:
   - A free Cloudflare account (email signup). I did not verify whether they
     ask for a payment method; if they do, stop here and keep using offline mode.
   - An account with an AI provider and an API key. AI providers charge for
     usage or limit free quotas; that is separate from Cloudflare. Check your
     provider's current pricing and limits. Nothing here promises free AI.
   - Cloudflare Workers free plan (checked in Oct 2026 docs): 100,000 requests
     per day and 10 ms CPU time per request. Re-check before relying on it.
  Steps (button names may differ slightly; I could not test Cloudflare's
  mobile dashboard):
   1. Sign in to the Cloudflare dashboard in your browser. Use the browser's
      "Desktop site" option if some buttons are hidden.
   2. Go to Workers & Pages > Create > Create Worker (start from "Hello World").
      Name it, for example, friday-backend. Deploy it.
   3. Open the Worker > Edit code. Select all existing code, delete it, paste
      the full contents of backend/worker.js, then Deploy.
   4. Open the Worker > Settings > Variables and Secrets. Add:
        AI_API_KEY      type: Secret   value: your provider key  (type it only here)
        AI_PROVIDER     type: Text     value: anthropic   or   openai
        AI_MODEL        type: Text     value: model name from your provider's docs
        ALLOWED_ORIGIN  type: Text     value: your site address from Part A
        AI_BASE_URL     (optional)     only for OpenAI-compatible providers
        MAX_TOKENS      (optional)     default 800
      "openai" means any provider with an OpenAI-style /chat/completions API.
      Deploy again after saving variables.
   5. Copy the Worker's address (ends with .workers.dev).
   6. In F.R.I.D.A.Y.: Settings > Online AI connection > paste the address >
      Save and test connection. The top badge should say "Online AI: connected".
   7. On the Console tab tap "Online AI", then ask a question.
  Never paste your API key into the chat, the app, a file, or a public repo.
  Change providers later by editing AI_PROVIDER, AI_MODEL and AI_BASE_URL only.
  Extra protection: in Cloudflare, add a rate-limiting rule for the Worker. The
  built-in limiter (20 requests/minute per address) is best-effort only.

HOW THE MODES WORK
  Offline mode: commands only. No AI.
  Online AI mode: commands that match (notes, tasks, tools...) still run on
  your device. Everything else is sent to your backend, then your provider.
  AI replies are shown as text only. They are never executed and cannot run tools.
  What is sent: your message, optionally your last 0-6 exchanges, and ONLY
  the facts/notes you ticked under Memory > "Choose what the online AI can see".
  The top of the Console shows what is being shared.

COMMANDS (type help in the app)
  remember [text] | show notes | forget note [n] | forget all notes | edit note [n] [text]
  save fact [text] | show facts | forget fact [n] | search [text]
  add task [text] | show tasks | complete task [n] | reopen task [n] | delete task [n] | clear completed tasks
  calc 12*(3+4) | convert 10 km to miles | weather London | days until 2026-12-25
  time in Asia/Tokyo | summarize [text] | remind me in 15 minutes to stretch
  show reminders | cancel reminder [n] | summarize chat | clear history
  set name [name] | set style adaptive/professional/casual | voice on | voice off
  mode online | mode offline | export | import | restore backup | status | clear

VOICE
  Mic button = voice input (separate from "Speak responses aloud").
  Works in Chrome and Samsung Internet on Android if supported; needs mic permission
  and usually an internet connection (the browser vendor's service does the
  recognition). If blocked, allow the microphone for the site in browser settings.

PRIVACY AND DATA
  Stored locally (this browser, this website): facts, notes, tasks, reminders,
  summaries, history, settings, Backend URL. Cleared if you clear site data.
  Backup: Settings > Download backup. Import is validated before anything
  changes, and the previous data is kept for "Restore data from before last import".
  Never saved: passwords, tokens, API keys, card numbers. Personal-looking facts
  ask for confirmation. The AI provider may retain requests under its own policy;
  deleting history here cannot delete provider-side data.

FINAL TEST CHECKLIST
  Offline
   [ ] help, status, time, date, 2+2, calc 12*(3+4), convert 10 km to miles
   [ ] a nonsense command gives a helpful reply and the app keeps working
  Memory
   [ ] remember test, show notes, edit note 1 changed, forget note 1
   [ ] "remember my password is abc" is refused
   [ ] save fact I like tea asks for confirmation; Memory tab shows it; search finds it
   [ ] reload the page: notes, facts, tasks are still there
  Tasks
   [ ] add, complete, reopen, delete, clear completed, filter All/Open/Done
  Reminders
   [ ] remind me in 1 minute to test; keep page open; message appears
  Tools tab
   [ ] each tool runs; weather works online and shows a clear error offline
  Voice
   [ ] voice on speaks replies; Mic fills a command; denied mic shows a clear message
  Online AI
   [ ] before setup: Online AI says not set up, offline commands still work
   [ ] after setup: badge says connected, a question gets a real answer
   [ ] Cancel stops a slow request; turning off Wi-Fi shows a clear error
   [ ] with nothing ticked, the Console says nothing extra is shared
  Backup
   [ ] download backup, erase all data, import backup, data returns
   [ ] import a random .txt file: rejected, data unchanged
  Layout
   [ ] portrait and landscape; text size Small/Normal/Large; accent colors

TROUBLESHOOTING
  Unstyled page: style.css missing/misnamed (or use the single-file version).
  "Could not reach the backend": wrong Backend URL, no internet, or
    ALLOWED_ORIGIN does not exactly match your site address.
  "rejected the credentials": AI_API_KEY or AI_MODEL wrong in Worker settings.
  "Rate limit": provider quota or too many requests; wait or check the provider account.
  Mic does nothing: unsupported browser or permission blocked.
  Data missing after reload: private tab, or storage blocked. Check Settings > Backup note.

KNOWN LIMITATIONS
  - Runs in a browser tab: no background work, no device control, no app access.
  - Reminders fire only while the page is open; notifications may not work on some
    mobile browsers (an in-page message and vibration are used instead).
  - Voice quality and availability depend on your browser.
  - No web search tool yet (needs a search API and key); no cloud sync.
  - The AI cannot call tools or change your data; this is deliberate.
  - Weather uses Open-Meteo (free for non-commercial use; check their terms).
  - The in-memory rate limiter resets when Cloudflare restarts the Worker.
  - Not tested: ship.page and Cloudflare dashboards, real AI providers, real
    microphone, real tablet layout. Logic was tested in Node (see below).

FUTURE IDEAS
  Web search endpoint, installable app (PWA), encrypted backups, multiple chats.
