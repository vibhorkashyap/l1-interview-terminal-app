from __future__ import annotations

import json
import os
import random
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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


def select_random_questions() -> List[Dict[str, Any]]:
    """Select 2 random questions from each topic (12 total) and shuffle them."""
    question_pool = ADMIN_CONFIG.get("question_pool", {})
    selected_questions = []
    
    for topic, questions in question_pool.items():
        # Select 2 random questions from each topic
        selected = random.sample(questions, min(2, len(questions)))
        selected_questions.extend(selected)
    
    # Shuffle the final list to randomize order
    random.shuffle(selected_questions)
    return selected_questions


@app.get("/api/config", response_model=ConfigPublic)
async def get_config() -> ConfigPublic:
    duration = int(ADMIN_CONFIG.get("duration_minutes", 45))
    has_coding = bool(ADMIN_CONFIG.get("coding"))
    # We always select 12 questions (2 from each of 6 topics)
    return ConfigPublic(duration_minutes=duration, total_mcq=12, has_coding=has_coding)


@app.get("/api/questions")
async def get_questions(session_id: str = None):
    # If session_id is provided, use session-specific questions
    # Otherwise, generate new questions (for backward compatibility)
    if session_id and session_id in STATE["sessions"]:
        selected_questions = STATE["sessions"][session_id]["questions"]
    else:
        selected_questions = select_random_questions()
        # Store questions globally for backward compatibility
        STATE["current_questions"] = selected_questions
    
    public = []
    for q in selected_questions:
        public.append({
            "id": q["id"],
            "question": q["question"],
            "choices": q["choices"]
        })
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
    selected_questions = select_random_questions()
    
    STATE["sessions"][session_id] = {
        "name": payload.name,
        "questions": selected_questions,
        "start_time": None  # Will be set when first question is answered
    }
    return StartResponse(session_id=session_id)


@app.post("/api/submit", response_model=SubmitResponse)
async def submit(payload: SubmitRequest) -> SubmitResponse:
    if payload.session_id not in STATE["sessions"]:
        raise HTTPException(status_code=404, detail="Invalid session")

    session = STATE["sessions"][payload.session_id]
    session_questions = session.get("questions", [])
    
    # Score MCQs
    mcq_answers: List[AnswerItem] = payload.answers or []
    answer_map: Dict[str, int] = {a.qid: a.choice_index for a in mcq_answers}
    
    correct = 0
    topic_wise_answers: Dict[str, List[Dict[str, Any]]] = {}
    
    for q in session_questions:
        qid = q["id"]
        topic = q.get("topic", "unknown")
        correct_idx = q.get("answer_index")
        user_answer_idx = answer_map.get(qid, -1)
        
        if topic not in topic_wise_answers:
            topic_wise_answers[topic] = []
        
        topic_wise_answers[topic].append({
            "question_id": qid,
            "question": q["question"],
            "user_answer_index": user_answer_idx,
            "user_answer": q["choices"][user_answer_idx] if 0 <= user_answer_idx < len(q["choices"]) else None,
            "correct_answer_index": correct_idx,
            "correct_answer": q["choices"][correct_idx] if 0 <= correct_idx < len(q["choices"]) else None,
            "is_correct": user_answer_idx == correct_idx
        })
        
        if user_answer_idx == correct_idx:
            correct += 1

    total_mcq = len(session_questions)

    # Evaluate coding (if provided)
    coding_result: Optional[dict] = None
    coding_points: Optional[int] = None
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
        
        # Calculate coding points based on test cases passed
        if coding_result and "details" in coding_result:
            passed_tests = sum(1 for detail in coding_result["details"] if detail.get("passed", False))
            coding_points = int((passed_tests / len(tests)) * 100) if tests else 0

    response = SubmitResponse(
        candidate_name=session["name"],
        total_time_seconds=payload.total_time_seconds,
        score_mcq=correct,
        total_mcq=total_mcq,
        topic_wise_answers=topic_wise_answers,
        coding_result=coding_result,
        coding_points=coding_points
    )
    
    # Store results for download
    session["final_results"] = response.dict()
    
    return response


@app.post("/api/test-code")
async def test_code(payload: dict):
    """Test code without submitting - for the Run button functionality."""
    code = payload.get("code")
    session_id = payload.get("session_id")
    
    if not code:
        return {"error": "No code provided"}
    
    if not session_id or session_id not in STATE["sessions"]:
        return {"error": "Invalid session"}
    
    # Get coding configuration
    coding_cfg = ADMIN_CONFIG.get("coding")
    if not coding_cfg:
        return {"error": "No coding challenge configured"}
    
    # Evaluate the code
    tests = coding_cfg.get("reference_tests", [])
    fn_name = coding_cfg.get("function_name", "group_keys_by_frequency")
    
    try:
        result = evaluate_python(
            source=code,
            function_name=fn_name,
            tests=tests,
            time_limit_s=2.0,
        )
        return result
    except Exception as e:
        return {"error": f"Evaluation failed: {str(e)}"}


@app.get("/api/download-results/{session_id}")
async def download_results(session_id: str):
    if session_id not in STATE["sessions"]:
        raise HTTPException(status_code=404, detail="Invalid session")
    
    session = STATE["sessions"][session_id]
    if "final_results" not in session:
        raise HTTPException(status_code=404, detail="No results available for download")
    
    # Add metadata to results
    results_with_metadata = {
        **session["final_results"],
        "session_info": {
            "session_id": session_id,
            "timestamp": datetime.now().isoformat(),
            "interview_date": datetime.now().strftime("%Y-%m-%d"),
            "interview_time": datetime.now().strftime("%H:%M:%S")
        }
    }
    
    # Generate filename
    candidate_name = session["name"].replace(" ", "_")
    filename = f"interview_results_{candidate_name}_{datetime.now().strftime('%Y-%m-%d')}.json"
    
    return JSONResponse(
        content=results_with_metadata,
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Type": "application/json"
        }
    )


# Serve static frontend - IMPORTANT: This must come AFTER API routes
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
