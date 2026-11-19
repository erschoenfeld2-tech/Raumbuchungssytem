# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

School project (Fachinformatik Systemintegration, Walther-Rathenau-Gewerbeschule) — a room booking
system with NFC check-in and a graphical floor-plan view, built for a "Hausmesse" presentation
(deadline 24.11.2026). `README.md` is the human-facing setup/reference doc (secrets, CI/CD,
troubleshooting) — this file is Claude-specific guidance and doesn't repeat what's there. Full
background, team, and working-style notes are in `CLAUDE_CODE_PROMPT.md` — read it first when
picking up new work here. `Projektdokumentation_Raumbuchungssystem.docx`,
`Sitzungsprotokolle_Raumbuchungssystem.docx`, and `Mitarbeiter_Anleitung_Raumbuchung.docx` are the
project's own documentation/handover artifacts, not code references.

## Critical: this repo mixes a live production app with abandoned prototypes

Three unrelated implementations of "the same" room booking idea live side by side at the repo root.
Only one is real. Always check which file you're touching before assuming it affects the live site.

### The live system (this is what's actually deployed)

- Frontend = `index.html` (page skeleton only) + `css/app.css` + `js/*.js` (classic `<script>`
  files sharing globals, loaded in a fixed order at the bottom of `index.html` — deliberately not
  ES modules so `file://` still works) + one file per floor in `etagen/*.js` + the vendored
  Supabase client `vendor/supabase-js-2.119.0.min.js`. Vanilla JS, no build step, no framework,
  no bundler, no package manager. Deployed via GitHub Pages (`.nojekyll` present). File roles:
  `config.js` (URL/key/constants), `ui.js` (esc(), local-time date helpers, toast, modals, custom
  dropdowns), `gebaeude.js` (floor registry/validation → globals `ETAGEN`, `ROOMS`), `belegung.js`
  (pure capacity/status logic, unit-tested in Node), `grundriss.js` (SVG renderer), `kalender.js`,
  `daten.js` (all Supabase calls), `auth.js`, `editor.js` (admin floor editor), `hintergrund.js`,
  `app.js` (state, events, starts the app — must load last).
- **Never build HTML from DB/floor-file text without `esc()`**, and don't use inline
  `onclick="fn('${text}')"` — clicks are handled by delegation on `data-*` attributes in `app.js`.
- Backend is **Supabase** (Postgres + PostgREST), talked to directly from the browser with the
  public anon key embedded in `js/config.js`. That's intentional, not a leaked secret — access is
  gated by Postgres Row-Level-Security policies, not by hiding the key.
- Floors/rooms come from two sources, merged by `etagenAufbauen()` in `js/gebaeude.js`:
  (1) one file per floor in `etagen/*.js` calling `registriereEtage({...})`, listed in the
  `<!-- ETAGEN -->` block of `index.html` (template: `etagen/_vorlage-etage.js`, not included);
  (2) rows of the `etagen` table (jsonb `definition`, same format), written only via the
  admin-password-checked RPCs `etage_speichern`/`etage_loeschen` from the in-browser floor editor
  (image or JSON/JS import). A DB floor with the same `id` replaces the file floor. Currently:
  Hauptgebäude, Etage 1 (Besprechungsraum, Konferenzraum, ShareDesk 1–5) and Etage 2
  (ShareDesk 6–10). Capacity = number of tables (meeting room = 1).
- **Room names are the booking key** (`buchungen.raum` stores the name, the NFC bridge writes it
  verbatim) → must be unique system-wide (validated in `gebaeude.js`, the editor and
  `etage_speichern`). **Table codes** (`buchungen.tisch`, `[Kürzel-]Etage.RaumNrTischNr`, e.g.
  `1.302`) derive from each room's explicit `nr` — never renumber existing rooms;
  `tests/unit_tests.js` asserts the Hauptgebäude codes still match the pre-split layout.
- There is no real auth. Normal users log in via the `nutzer_login(p_name, p_passwort)` RPC
  (bcrypt hash in `nutzer.passwort_hash`, security-definer, never exposed to the anon key);
  the initial password (set in migration `20261007120000_*`; don't repeat it in docs or UI) comes
  with `passwort_muss_aendern = true`, so the first login forces a new
  password (`nutzer_passwort_aendern` RPC, migration `20261007120000_*`). Since migration
  `20261119150000_*` the admin account (`ist_admin`) logs in the same way (its old frontend password
  became the initial hash with forced change) — there is no password in the frontend anymore. The
  admin password is kept in memory only (`adminPasswortSitzung`) because `etage_speichern`
  re-checks it server-side. The resulting user object (including `ist_admin`) is cached in
  `localStorage` (key `rb_user2`). `ist_admin` is the only thing that lets a user delete other people's
  bookings — regular users can only delete their own. **Known, accepted limitation:** because
  there's no real per-user Supabase session, RLS on `buchungen` can't distinguish "this specific
  logged-in user" — the delete/insert/update policies are `using (true)`, so the ownership check is
  UI-only, not DB-enforced. Anyone with the (public) anon key could bypass it via the REST API
  directly. Fixing that properly means adding real Supabase Auth, which is a deliberate
  out-of-scope tradeoff for this project's size — don't "fix" it without discussing it first.
- **Privacy rule (project owner's requirement): never show passwords or other users' names.**
  Since migration `20261119160000_*` the anon key cannot read user names at all: `nutzer_public`
  (a view created in `20260821120000_*` to hide `nfc_uid`) is revoked, and `buchungen` only grants
  column-level SELECT on `id, raum, tisch, nutzer_id, start, ende, quelle, test, erstellt,
  gast_hash` — so always select explicit columns (`select('*')` fails), and PostgREST writes must
  not ask for `return=representation` of other columns (the NFC bridge uses `?select=id`). The UI
  labels bookings "Du" (own) or "belegt"; only `nutzer_login()` returns the user's own name.
  Password inputs are never prefilled; admin actions reuse the in-memory login password or ask
  via the in-page `bestaetigen(..., {passwort:true})` dialog (no `confirm()`/`prompt()`).
- Guest/test mode (`?gast` deep link or "Als Gast testen"): each guest gets a secret session from
  `gast_sitzung_starten()` (stored in the cached user object). Test bookings (`test = true`) can
  only be created through `gast_buchen()` (the trigger rejects direct test inserts); own ones are
  recognised via `gast_hash` = SHA-256 of the session. Guests may use the floor editor — their
  floors live in `gast_etagen`, visible only to their session (`gast_etagen_laden`). All guest
  writes go through RPCs that enforce **max 10 changes per session in 2 min**
  (`gast_aenderung_zaehlen`). `gast_zuruecksetzen()` removes only the caller's bookings/floors;
  `test_buchungen_aufraeumen()` expires test bookings after 2 min and guest floors after 15 min.
  The admin can switch into the test system ("🧪 Testsystem"), delete any test booking and wipe
  everything with `testsystem_leeren()` (password-checked). Rooms with `nfc: true` are not
  web-bookable for guests.
- Trigger `buchungen_pruefen` (migrations `20261119150200_*`, extended in `20261119160000_*`) sets
  `erstellt` server-side, requires `start < ende`, guards `test`/`gast_sitzung` and rejects
  overlapping bookings of the same `tisch` (per `test` flag). Room *capacity* is not known to the
  DB — it's enforced by `kapazitaetPruefen()` (`js/belegung.js`) and `freie_plaetze()` in the NFC
  bridge.
- Floor plans render in layers (floor → furniture → walls/doors → labels on top) and doors in
  the Hauptgebäude files open into the corridor; `e2e_tests.js` asserts no door arc intersects a
  label or furniture.
- DB schema is **not** hand-applied anymore — `supabase/migrations/*.sql` is the source of truth,
  deployed automatically by `.github/workflows/supabase-deploy.yml` (Supabase CLI `supabase db
  push`) on every push to `main` that touches `supabase/migrations/**`, gated behind the reusable
  `quality.yml` checks and (if set up) a `production` GitHub Environment. **Never edit an existing
  migration file** — add a new timestamped one (`YYYYMMDDHHMMSS_description.sql`) instead. Setup/
  secrets for this pipeline are documented in `CICD_ANLEITUNG.md` and `README.md`.
- GitHub Pages deployment is being migrated from the classic "Deploy from a branch" mechanism to
  an Actions-based one (`.github/workflows/pages-deploy.yml`, gated behind the same `quality.yml`
  checks; it copies `index.html css js etagen vendor .nojekyll` — add new top-level web folders
  there). This requires a one-time manual switch in Settings → Pages → Source → "GitHub Actions";
  until that's flipped, the classic branch-based deploy keeps serving the site as a fallback.

### Legacy/reference code (not connected to Supabase, not deployed anywhere)

- `raumbuchung.py` — the oldest version: a single Python file combining login, SQLite, a built-in
  `http.server`, and NFC polling. Superseded, kept only as logic reference.
- `database.py` + `api.py` (FastAPI/uvicorn) + `admin.py` + `demo.py` + `notify.py` + `config.py` +
  `index_lokal_modular.html` — a later, more elaborate local-only prototype: SQLite
  (`rooms`/`users`/`bookings`, numeric `room_id`s, per-room `capacity`), FastAPI endpoints, walk-in
  bookings, check-in/check-out with open end times, and optional email notifications via
  `notify.py` (needs SMTP creds in `config.py`; `config.py`'s own header warns not to commit real
  credentials into a public repo — this repo is public now, keep that in mind if anyone ever fills
  in real SMTP values there). `api.py` serves `index_lokal_modular.html` as its frontend — a
  completely different HTML file from the live `index.html`, with its own `/api/...` endpoints
  instead of Supabase calls.
- `api_ergaenzung.py` and `checkin_ergaenzung.py` are **not runnable scripts** — despite the `.py`
  extension, they're copy-paste snippet notes ("füge diese Zeilen in api.py/checkin.py ein") that
  were apparently never actually merged in. Orphaned/dead, kept only as a record of intent. If you
  need the email-on-cancel behavior they sketch out, write it directly into `api.py` instead of
  trying to "integrate" these files.
- None of the Python files have a `requirements.txt`/`pyproject.toml`; dependencies are only named
  in each file's docstring (`fastapi`, `uvicorn`, `pydantic`, `pyscard`). Install ad hoc with pip.

### NFC toolkit — two separate bridges, only one talks to the live system

`checkin.py`, `checkin_debug.py`, `nfc_test.py`, `list_readers.py`, `reader_config.py`,
`test_nfc_read.py` drive ACR122U readers over PC/SC via `pyscard`. **Gotcha:** `checkin.py` imports
from the legacy `database.py` (SQLite), so those scripts write check-ins into the old local SQLite
DB, *not* into the live Supabase `buchungen` table. `reader_config.py` maps reader name → numeric
`room_id` (the legacy room model), which does not correspond to the live app's room *names*. Keep
this toolkit only as logic reference — don't try to make it talk to Supabase, that's what the
bridge below is for.

`nfc_supabase_bridge.py` + `nfc_bridge_config.py` are the **live bridge**: same ACR122U/pyscard
polling loop as `checkin.py`, but resolve the card UID via the `nutzer_by_nfc(p_nfc_uid)` Postgres
RPC (`supabase/migrations/20260831140000_add_nfc_lookup_rpc.sql`, security-definer so the anon key
can resolve one known UID without ever bulk-reading `nutzer.nfc_uid`) and write straight into
`buchungen` over the PostgREST API with `quelle='nfc'`, using the same public anon key as
`js/config.js`. Capacity check (`freie_plaetze` + `max_gleichzeitig`) mirrors `kapazitaetPruefen()`
/ `maxGleichzeitig()` in `js/belegung.js` exactly (max *concurrent* bookings in the interval, real
bookings only: `test=eq.false`) — keep them in sync; `tests/bridge_tests.py` covers it. First card scan on a room = check-in (new booking, end = now +
`BUCHUNGSDAUER_MINUTEN`, default 60); scanning the same card again while that booking is still
running = check-out (shortens `ende` to now). `nfc_bridge_config.py`'s `READER_ZU_RAUM` maps
reader name (from `list_readers.py`) → **room name string**, which must match a room name in the
floor definitions exactly (case-sensitive) since it's written verbatim into `buchungen.raum`;
`RAUM_KAPAZITAET` there holds the capacities, and reader rooms need `nfc: true` in their floor file
(a unit test checks both lists match) — update this file, not the toolkit above, when readers move
rooms or more readers are added. Requires
`pip install pyscard requests` in addition to the toolkit's own deps.

Python version constraint for anything using `pyscard`: **3.13, not 3.14** — no wheels for 3.14 yet
at the time this was written.

## Running things

No build, no package manager, no test framework dependency. Tests are plain scripts in `tests/`:
`bash tests/run_tests.sh` runs everything — `unit_tests.js` (Node + `vm`, no deps: floor files,
table codes, capacity logic), `bridge_tests.py` (NFC bridge logic, stubs pyscard/requests), all
migrations on a fresh local Postgres (`supabase_stub.sql` emulates Supabase roles/schemas) plus a
second run of the newest ones for idempotency, `sql_tests.sql` (behaviour as role `anon`), and
`e2e_tests.js` (Playwright/Chromium against the real app, Supabase requests rerouted to
`mini_postgrest.js` → local DB; screenshots in `tests/screenshots/`, gitignored). It never touches
the live DB. Without `PGHOST` it starts a throwaway cluster in `/var/tmp/rb-pgtest` (needs the
`postgres` OS user when run as root). `.github/workflows/quality.yml` (reusable gate for both
deploy workflows) does `py_compile`, `node --check` on `js/ etagen/ tests/`, unit + bridge tests,
"every file referenced by index.html exists", HTML/YAML/TOML and migration naming/safety checks;
`ci.yml` runs it plus the full suite (Postgres service + Chromium) on every push/PR.

- **Live app**: no local run step; open `index.html` directly (or `python3 -m http.server`), or
  push to `main` and GitHub Pages rebuilds automatically once quality checks pass. Deep links:
  `?etage=<floor id>`, `?gast` (guest/test mode).
- **New floor**: copy `etagen/_vorlage-etage.js`, add a `<script>` line in the `ETAGEN` block of
  `index.html`, run `node tests/unit_tests.js` — or use the admin editor in the browser.
- **DB schema changes**: add a new file under `supabase/migrations/`, push to `main`; the
  `Supabase Schema Deploy` Actions workflow validates and then applies it. Can also be triggered
  manually (`workflow_dispatch`) from the Actions tab.
- **Legacy modular prototype**: `py database.py` once to create `raumbuchung.db`, then `py api.py`
  (serves on the port printed by the script) or `py admin.py` for the CLI admin tool.
- **Legacy all-in-one prototype**: `py raumbuchung.py` (creates its own `raumbuchung.db`, opens a
  browser to `http://127.0.0.1:8000`).
- **NFC legacy toolkit**: `py list_readers.py` to see connected reader names first, set those in
  `reader_config.py`, then `py checkin.py` (or `py nfc_test.py` / `py test_nfc_read.py` for
  simpler standalone tests). Requires physical ACR122U hardware and `pip install pyscard`.
- **NFC live bridge**: `py list_readers.py` first, set reader names → room names in
  `nfc_bridge_config.py`, then `py nfc_supabase_bridge.py`. Requires physical ACR122U hardware and
  `pip install pyscard requests`. Writes directly into the live Supabase `buchungen` table — new
  check-ins show up in `index.html` on the next poll/reload.

## Conventions specific to this project

- UI text and error messages are in **German**; code comments are in **German** too.
- Dark blue/black theme only — no light/white design. Palette used throughout `css/app.css`:
  `--bg:#0f1117 --surface:#1a1d27 --surface2:#22263a --border:#2e3250 --accent:#4f6ef7
  --purple:#7c3aed --green:#22c55e --red:#ef4444 --amber:#f59e0b --text:#e8eaf6 --muted:#8891b4`.
- Keep changes small and targeted — this is a two-to-three-person student project, not enterprise
  software; avoid introducing abstractions, frameworks, or infra beyond what's asked for.
- After any frontend or migration change run `bash tests/run_tests.sh` and look at the screenshots
  in `tests/screenshots/`; extend `e2e_tests.js`/`sql_tests.sql` when adding behaviour.
