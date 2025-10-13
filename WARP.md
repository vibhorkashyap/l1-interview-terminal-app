# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Overview
- Purpose: Web app for conducting L1 interview rounds with a terminal-inspired UI. Includes multiple-choice questions and an optional Python coding round.
- Stack: FastAPI backend (Python) serving a static Vanilla JS/CSS/HTML frontend. Admin-configurable via data/questions.json.
- Dev status: No test suite or linting configuration detected. Frontend is static; no build step.

## Common commands
- Environment setup (Python 3.10+ recommended):
  - `python3 -m venv .venv`
  - `source .venv/bin/activate`
  - `pip install -r backend/requirements.txt`
- Run the backend in development (serves frontend at / and APIs under /api/*):
  - `uvicorn backend.app:app --reload`
- Access locally:
  - http://127.0.0.1:8000/
- Notes:
  - No lint or formatting configs present (e.g., ruff/flake8/black). None to run.
  - No test framework/config present. There are no tests to run or single-test commands.

## High-level architecture
- **Backend (FastAPI)**
  - Serves static files from frontend/ at the root path.
  - Loads admin configuration from data/questions.json on startup (raises if missing).
  - Maintains in-memory session state keyed by session_id (development-only; ephemeral).
  - REST endpoints (all JSON):
    - GET /api/config → duration_minutes, total_mcq, has_coding
    - GET /api/questions → list of MCQQuestionPublic (id, question, choices) without answers
    - GET /api/coding → CodingPublic (title, prompt, function_signature); 404 if no coding round configured
    - POST /api/start { name } → { session_id }
    - POST /api/submit { session_id, answers?, code? } → { score_mcq, total_mcq, coding_result? }
- **Coding evaluator (development-only)**
  - Executes submitted Python in a very restricted global scope with a tiny builtins allowlist.
  - Compiles and runs with a per-phase timeout using threads; returns compile/runtime errors or mismatches.
  - Test vectors are defined in data/questions.json under coding.reference_tests; evaluation calls the function named coding.function_name with inputs drawn from each test case.
  - Not safe for production; intended only for local development.
- **Frontend (Vanilla JS/CSS/HTML)**
  - Single-page flow with screens: start → quiz → coding → result.
  - Fetches config/questions from /api/config and /api/questions, then starts a session via /api/start.
  - Tracks progress and a session countdown timer; on completion or timeout, POSTs to /api/submit with MCQ selections and optional code.
- **Configuration (data/questions.json)**
  - duration_minutes: integer for whole-session timer.
  - multiple_choice: array of { id, question, choices, answer_index }.
  - coding: { id, language, function_name, title, prompt, function_signature, reference_tests }.

## Operational notes
- CORS is permissive for local development. Adjust origins before deploying beyond local.
- State is in-memory; restarting the server clears sessions.
- The backend raises on missing data/questions.json; ensure it exists when starting the app.

## Key paths
- backend/: FastAPI app (app.py), models (Pydantic), and evaluator (restricted exec + test harness).
- frontend/: Static client assets served by FastAPI at '/'.
- data/questions.json: Admin-editable questions and coding task definition.

## If you need to change questions or coding tasks
- Edit data/questions.json following the existing schema. The server loads this file at startup.