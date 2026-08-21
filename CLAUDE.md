# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

School project (Fachinformatik Systemintegration, Walther-Rathenau-Gewerbeschule) — a room booking
system with NFC check-in and a graphical floor-plan view, built for a "Hausmesse" presentation
(deadline 24.11.2026). Full background, team, and working-style notes are in `CLAUDE_CODE_PROMPT.md`
— read it first when picking up new work here. `Projektdokumentation_Raumbuchungssystem.docx`,
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
  (`STANDARD_PASSWORT` for normal users, a separate `ADMIN_PASSWORT` for the one admin account)
  followed by a lookup of the entered name in the `nutzer` table; the resulting user object
  (including `ist_admin`) is cached in `localStorage`. `ist_admin` is the only thing that lets a
  user delete other people's bookings — regular users can only delete their own.
- DB schema is **not** hand-applied anymore — `supabase/migrations/*.sql` is the source of truth,
  deployed automatically by `.github/workflows/supabase-deploy.yml` (Supabase CLI `supabase db
  push`) on every push to `main` that touches `supabase/migrations/**`. **Never edit an existing
  migration file** — add a new timestamped one (`YYYYMMDDHHMMSS_description.sql`) instead;
  `supabase/migrations/20260821000000_init_schema.sql` (the `nutzer`/`buchungen` tables + RLS
  policies) has very likely already been applied to the live project. Setup/secrets for this
  pipeline are documented in `CICD_ANLEITUNG.md`.

### Legacy/reference code (not connected to Supabase, not deployed anywhere)

- `raumbuchung.py` — the oldest version: a single Python file combining login, SQLite, a built-in
  `http.server`, and NFC polling. Superseded, kept only as logic reference.
- `database.py` + `api.py` (FastAPI/uvicorn) + `admin.py` + `demo.py` + `notify.py` + `config.py` +
  `index_lokal_modular.html` + `api_ergaenzung.py` + `checkin_ergaenzung.py` — a later, more
  elaborate local-only prototype: SQLite (`rooms`/`users`/`bookings`, numeric `room_id`s, per-room
  `capacity`), FastAPI endpoints, walk-in bookings, check-in/check-out with open end times, and
  optional email notifications via `notify.py` (needs SMTP creds in `config.py`). `api.py` serves
  `index_lokal_modular.html` as its frontend — a completely different HTML file from the live
  `index.html`, with its own `/api/...` endpoints instead of Supabase calls.
- None of the Python files have a `requirements.txt`/`pyproject.toml`; dependencies are only named
  in each file's docstring (`fastapi`, `uvicorn`, `pydantic`, `pyscard`). Install ad hoc with pip.

### NFC toolkit — currently talks to the legacy DB, not to the live system

`checkin.py`, `checkin_debug.py`, `nfc_test.py`, `list_readers.py`, `reader_config.py`,
`test_nfc_read.py` drive ACR122U readers over PC/SC via `pyscard`. **Gotcha:** `checkin.py` imports
from the legacy `database.py` (SQLite), so as it stands today the NFC scripts write check-ins into
the old local SQLite DB, *not* into the live Supabase `buchungen` table. There is currently no
script that bridges NFC reads to Supabase — if asked to "make NFC check-in work with the live
site," that bridge has to be built, not just fixed. `reader_config.py` maps reader name → numeric
`room_id` (the legacy room model), which does not correspond to the live app's room *names*.

Python version constraint for anything using `pyscard`: **3.13, not 3.14** — no wheels for 3.14 yet
at the time this was written.

## Running things

There's no build, lint, or test tooling anywhere in this repo — nothing to run before committing
beyond manually checking the page in a browser.

- **Live app**: no local run step; open `index.html` directly, or push to `main` and GitHub Pages
  rebuilds automatically (build status: repo's Actions tab, "pages build and deployment").
- **DB schema changes**: add a new file under `supabase/migrations/`, push to `main`; the
  `Supabase Schema Deploy` Actions workflow applies it. Can also be triggered manually
  (`workflow_dispatch`) from the Actions tab.
- **Legacy modular prototype**: `py database.py` once to create `raumbuchung.db`, then `py api.py`
  (serves on the port printed by the script) or `py admin.py` for the CLI admin tool.
- **Legacy all-in-one prototype**: `py raumbuchung.py` (creates its own `raumbuchung.db`, opens a
  browser to `http://127.0.0.1:8000`).
- **NFC scripts**: `py list_readers.py` to see connected reader names first, set those in
  `reader_config.py`, then `py checkin.py` (or `py nfc_test.py` / `py test_nfc_read.py` for
  simpler standalone tests). Requires physical ACR122U hardware and `pip install pyscard`.

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
