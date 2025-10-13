from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .models import (
    StartRequest,
    StartResponse,
    AnswerItem,
    SubmitRequest,
    MCQQuestionPublic,
    ConfigPublic,
    SubmitResponse,
    CodingPublic,
)
from .evaluator import evaluate_python

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = PROJECT_ROOT / "data" / "questions.json"
FRONTEND_DIR = PROJECT_ROOT / "frontend"

app = FastAPI(title="L1 Interview Terminal App")

# Enable CORS for local dev (adjust as needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory state (dev only)
STATE: Dict[str, Any] = {
    "sessions": {}
}

# Load admin configuration
if not DATA_PATH.exists():
    raise RuntimeError(f"Admin questions JSON not found at {DATA_PATH}")

with open(DATA_PATH, "r", encoding="utf-8") as f:
    ADMIN_CONFIG = json.load(f)


@app.get("/api/config", response_model=ConfigPublic)
async def get_config() -> ConfigPublic:
    duration = int(ADMIN_CONFIG.get("duration_minutes", 45))
    mcq = ADMIN_CONFIG.get("multiple_choice", [])
    has_coding = bool(ADMIN_CONFIG.get("coding"))
    return ConfigPublic(duration_minutes=duration, total_mcq=len(mcq), has_coding=has_coding)


@app.get("/api/questions", response_model=List[MCQQuestionPublic])
async def get_questions() -> List[MCQQuestionPublic]:
    mcq = ADMIN_CONFIG.get("multiple_choice", [])
    public: List[MCQQuestionPublic] = []
    for q in mcq:
        public.append(MCQQuestionPublic(id=q["id"], question=q["question"], choices=q["choices"]))
    return public


@app.get("/api/coding", response_model=CodingPublic)
async def get_coding() -> CodingPublic:
    coding = ADMIN_CONFIG.get("coding")
    if not coding:
        raise HTTPException(status_code=404, detail="No coding round configured")
    return CodingPublic(
        title=coding.get("title", "Coding Round"),
        prompt=coding.get("prompt", ""),
        function_signature=coding.get("function_signature", ""),
    )


@app.post("/api/start", response_model=StartResponse)
async def start_session(payload: StartRequest) -> StartResponse:
    session_id = str(uuid4())
    STATE["sessions"][session_id] = {
        "name": payload.name,
    }
    return StartResponse(session_id=session_id)


@app.post("/api/submit", response_model=SubmitResponse)
async def submit(payload: SubmitRequest) -> SubmitResponse:
    if payload.session_id not in STATE["sessions"]:
        raise HTTPException(status_code=404, detail="Invalid session")

    # Score MCQs
    mcq_answers: List[AnswerItem] = payload.answers or []
    answer_map: Dict[str, int] = {a.qid: a.choice_index for a in mcq_answers}

    mcq_cfg = ADMIN_CONFIG.get("multiple_choice", [])
    correct = 0
    for q in mcq_cfg:
        qid = q["id"]
        correct_idx = q.get("answer_index")
        if qid in answer_map and answer_map[qid] == correct_idx:
            correct += 1

    total_mcq = len(mcq_cfg)

    # Evaluate coding (if provided)
    coding_result: Optional[dict] = None
    if payload.code and ADMIN_CONFIG.get("coding"):
        coding_cfg = ADMIN_CONFIG["coding"]
        tests = coding_cfg.get("reference_tests", [])
        fn_name = coding_cfg.get("function_name", "group_keys_by_frequency")
        coding_result = evaluate_python(
            source=payload.code,
            function_name=fn_name,
            tests=tests,
            time_limit_s=2.0,
        )

    return SubmitResponse(score_mcq=correct, total_mcq=total_mcq, coding_result=coding_result)


# Serve static frontend - IMPORTANT: This must come AFTER API routes
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
