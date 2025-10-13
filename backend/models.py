from __future__ import annotations

from typing import List, Optional
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
    score_mcq: int
    total_mcq: int
    coding_result: Optional[dict] = None
