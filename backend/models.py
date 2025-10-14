from __future__ import annotations

from typing import List, Optional, Dict, Any
from pydantic import BaseModel


class StartRequest(BaseModel):
    name: str


class StartResponse(BaseModel):
    session_id: str


class AnswerItem(BaseModel):
    qid: str
    choice_index: int


class CodeSubmission(BaseModel):
    language: str
    source: str


class SubmitRequest(BaseModel):
    session_id: str
    answers: Optional[List[AnswerItem]] = None
    code: Optional[str] = None  # raw python code string
    total_time_seconds: Optional[int] = None  # total time taken in seconds


class MCQQuestionPublic(BaseModel):
    id: str
    question: str
    choices: List[str]


class ConfigPublic(BaseModel):
    duration_minutes: int
    total_mcq: int
    has_coding: bool


class CodingPublic(BaseModel):
    title: str
    prompt: str
    function_signature: str


class SubmitResponse(BaseModel):
    candidate_name: str
    total_time_seconds: Optional[int] = None
    score_mcq: int
    total_mcq: int
    topic_wise_answers: Dict[str, List[Dict[str, Any]]] = {}
    coding_result: Optional[dict] = None
    coding_points: Optional[int] = None
