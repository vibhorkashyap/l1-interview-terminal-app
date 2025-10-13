# L1 Interview Terminal App

A web app to conduct Level 1 interview rounds with a terminal-inspired, hacker-themed UI. It supports:

- 20 multiple-choice questions
- 1–2 short coding rounds in Python
- Admin panel via a JSON file to configure questions and a single duration parameter for the entire session

Stack:
- Backend: FastAPI (Python) — serves APIs and static frontend, loads admin JSON
- Frontend: Vanilla HTML/CSS/JS with a macOS Terminal-inspired theme

Key features:
- First screen collects candidate name and starts a session timer
- Side pane shows progress through questions
- MCQ: select an answer and submit
- Coding round: Python textarea with a predefined function signature; backend evaluates against reference tests (development-only sandbox)

Admin configuration:
- See data/questions.json for schema and examples
- duration_minutes controls the entire session length

Development (backend):
- Requires Python 3.10+
- Optionally create a virtual environment and install dependencies:

  ```bash
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r backend/requirements.txt
  ```

- Run the server:

  ```bash
  uvicorn backend.app:app --reload
  ```

- The frontend is served at http://127.0.0.1:8000/ and APIs under /api/*

Security note:
- The coding evaluator uses a minimal, restricted exec sandbox intended for local development only. Do not use this as-is in production. Replace with a proper, isolated execution environment before real-world use.
