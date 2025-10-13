from __future__ import annotations

from dataclasses import dataclass
from threading import Thread
import time
from typing import Any, Dict, List, Optional


SAFE_BUILTINS = {
    "__builtins__": {
        # Very minimal builtins for safety
        "len": len,
        "range": range,
        "list": list,
        "dict": dict,
        "set": set,
        "sorted": sorted,
        "min": min,
        "max": max,
        "sum": sum,
        "enumerate": enumerate,
        "zip": zip,
    }
}


def _run_user_code(source: str, globals_dict: Dict[str, Any]) -> Optional[Exception]:
    try:
        exec(source, globals_dict)
        return None
    except Exception as e:  # noqa: BLE001
        return e


def _call_function(globals_dict: Dict[str, Any], fn_name: str, *args, **kwargs):
    fn = globals_dict.get(fn_name)
    if not callable(fn):
        raise ValueError(f"Function '{fn_name}' is not defined or not callable.")
    return fn(*args, **kwargs)


@dataclass
class EvalResult:
    passed: bool
    error: Optional[str]
    details: List[Dict[str, Any]]


def evaluate_python(source: str, function_name: str, tests: List[Dict[str, Any]], time_limit_s: float = 2.0) -> Dict[str, Any]:
    """Very small, development-only evaluator.

    Executes user code in a constrained global scope and runs simple reference tests.
    Not safe for production; do not expose to untrusted contexts without proper isolation.
    """
    globals_dict: Dict[str, Any] = {}
    globals_dict.update(SAFE_BUILTINS)

    compile_err: Optional[str] = None
    result_container: Dict[str, Any] = {"compiled": False}

    # Compile/exec with timeout
    exc_holder: Dict[str, Any] = {"exc": None}

    def runner():
        exc = _run_user_code(source, globals_dict)
        exc_holder["exc"] = exc

    t = Thread(target=runner, daemon=True)
    t.start()
    t.join(timeout=time_limit_s)
    if t.is_alive():
        return {
            "passed": False,
            "error": "Compilation timed out",
            "details": [],
        }

    if exc_holder["exc"] is not None:
        return {
            "passed": False,
            "error": f"Compilation error: {exc_holder['exc']}",
            "details": [],
        }

    result_container["compiled"] = True

    # Run tests with timeout per test
    details: List[Dict[str, Any]] = []
    all_passed = True

    for test in tests:
        input_dict = test.get("input_dict", {})
        k = test.get("k")
        expected = test.get("expected")

        call_result_holder: Dict[str, Any] = {"value": None, "exc": None}

        def call_runner():
            try:
                call_result_holder["value"] = _call_function(globals_dict, function_name, input_dict, k)
            except Exception as e:  # noqa: BLE001
                call_result_holder["exc"] = e

        t2 = Thread(target=call_runner, daemon=True)
        t2.start()
        t2.join(timeout=time_limit_s)
        if t2.is_alive():
            details.append({
                "input": {"input_dict": input_dict, "k": k},
                "passed": False,
                "error": "Execution timed out",
            })
            all_passed = False
            continue

        if call_result_holder["exc"] is not None:
            details.append({
                "input": {"input_dict": input_dict, "k": k},
                "passed": False,
                "error": f"Runtime error: {call_result_holder['exc']}",
            })
            all_passed = False
            continue

        actual = call_result_holder["value"]
        passed = actual == expected
        if not passed:
            all_passed = False
        details.append({
            "input": {"input_dict": input_dict, "k": k},
            "expected": expected,
            "actual": actual,
            "passed": passed,
        })

    return {
        "passed": all_passed,
        "error": None if all_passed else "One or more tests failed",
        "details": details,
    }
