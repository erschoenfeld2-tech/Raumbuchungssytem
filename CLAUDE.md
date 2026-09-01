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

- `index.html` — the entire frontend: vanilla JS/CSS + inline SVG floor plan, one file, no build
  step, no framework, no bundler. Deployed via **GitHub Pages from the `main` branch root**
  (`.nojekyll` present so GitHub doesn't run it through Jekyll).
- Backend is **Supabase** (Postgres + PostgREST), talked to directly from the browser with the
  public anon key embedded in `index.html`. That's intentional, not a leaked secret — access is
  gated by Postgres Row-Level-Security policies, not by hiding the key.
- Rooms/floors are **not** a database table — they're hardcoded in the `ROOMS` const in
  `index.html`: 12 rooms across 2 floors (Etage 1: Besprechungsraum, Konferenzraum, ShareDesk 1–5;
  Etage 2: ShareDesk 6–10). `kapazitaet` is 1 for meeting rooms, 2 for ShareDesks, and drives both
  the floor-plan occupancy coloring and the overlap/capacity check on booking.
- There is no real auth. Login is a client-side password check against hardcoded constants
  (`STANDARD_PASSWORT` for normal users, a separate `ADMIN_PASSWORT` for the one admin account,
  `Admin_Universal`) followed by a lookup of the entered name in the `nutzer_public` view (not the
  `nutzer` table directly — see below); the resulting user object (including `ist_admin`) is
  cached in `localStorage`. `ist_admin` is the only thing that lets a user delete other people's
  bookings — regular users can only delete their own. **Known, accepted limitation:** because
  there's no real per-user Supabase session, RLS on `buchungen` can't distinguish "this specific
  logged-in user" — the delete/insert/update policies are `using (true)`, so the ownership check is
  UI-only, not DB-enforced. Anyone with the (public) anon key could bypass it via the REST API
  directly. Fixing that properly means adding real Supabase Auth, which is a deliberate
  out-of-scope tradeoff for this project's size — don't "fix" it without discussing it first.
- `nutzer_public` is a **view**, not the base table — created in
  `supabase/migrations/20260821120000_harden_nutzer_exposure.sql` to keep `nfc_uid` (NFC card
  UIDs) out of reach of the anon key; the base `nutzer` table has no anon/authenticated select
  policy left. Always query `nutzer_public` from the frontend, never `nutzer` directly, unless you
  also add the column you need to the view (and think about whether it's safe to expose).
- DB schema is **not** hand-applied anymore — `supabase/migrations/*.sql` is the source of truth,
  deployed automatically by `.github/workflows/supabase-deploy.yml` (Supabase CLI `supabase db
  push`) on every push to `main` that touches `supabase/migrations/**`, gated behind the reusable
  `quality.yml` checks and (if set up) a `production` GitHub Environment. **Never edit an existing
  migration file** — add a new timestamped one (`YYYYMMDDHHMMSS_description.sql`) instead. Setup/
  secrets for this pipeline are documented in `CICD_ANLEITUNG.md` and `README.md`.
- GitHub Pages deployment is being migrated from the classic "Deploy from a branch" mechanism to
  an Actions-based one (`.github/workflows/pages-deploy.yml`, gated behind the same `quality.yml`
  checks). This requires a one-time manual switch in Settings → Pages → Source → "GitHub Actions";
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
`index.html`. Capacity check (`freie_plaetze`) mirrors `pruefeKapazitaet()` in `index.html`
exactly (same overlap query: `raum` match, `start < ende` and `ende > start`) — keep them in sync
if either changes. First card scan on a room = check-in (new booking, end = now +
`BUCHUNGSDAUER_MINUTEN`, default 60); scanning the same card again while that booking is still
running = check-out (shortens `ende` to now). `nfc_bridge_config.py`'s `READER_ZU_RAUM` maps
reader name (from `list_readers.py`) → **room name string**, which must match a `ROOMS` entry in
`index.html` exactly (case-sensitive) since it's written verbatim into `buchungen.raum` — update
this file, not the toolkit above, when readers move rooms or more readers are added. Requires
`pip install pyscard requests` in addition to the toolkit's own deps.

Python version constraint for anything using `pyscard`: **3.13, not 3.14** — no wheels for 3.14 yet
at the time this was written.

## Running things

There's no build, lint, or test tooling in the traditional sense (no package manager, no
TypeScript, no test framework — see `README.md`'s Tests section for why). What exists instead:
`.github/workflows/quality.yml` is a reusable (`workflow_call`) syntax/consistency check —
`py_compile` on every `.py` file, `node --check` on the embedded `<script>` in both HTML files,
HTML well-formedness, YAML/TOML validation, and migration filename/safety checks. `ci.yml` runs it
on every push/PR; `pages-deploy.yml` and `supabase-deploy.yml` both gate their deploy job behind
it. Run the same checks locally before committing — see the exact commands in `README.md`'s
"Tests, Linting und Formatierung" section.

- **Live app**: no local run step; open `index.html` directly, or push to `main` and GitHub Pages
  rebuilds automatically once quality checks pass (build status: repo's Actions tab).
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
- Dark blue/black theme only — no light/white design. Palette used throughout `index.html`:
  `--bg:#0f1117 --surface:#1a1d27 --surface2:#22263a --border:#2e3250 --accent:#4f6ef7
  --purple:#7c3aed --green:#22c55e --red:#ef4444 --amber:#f59e0b --text:#e8eaf6 --muted:#8891b4`.
- Keep changes small and targeted — this is a two-to-three-person student project, not enterprise
  software; avoid introducing abstractions, frameworks, or infra beyond what's asked for.
- `index.html` has no automated tests — after any change, sanity-check it (e.g. `node --check` on
  the extracted `<script>` block for syntax errors) and, where possible, actually click through the
  flow in a browser before calling it done.
