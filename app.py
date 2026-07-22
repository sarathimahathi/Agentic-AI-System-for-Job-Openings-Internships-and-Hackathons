"""
Flask backend for ATS Resume Scoring Pipeline.
Uses Ollama (llama3.1) with a 3-pass reasoning pipeline and deterministic scoring.
"""
import json
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS
from pydantic import BaseModel, Field
from typing import List, Optional
import ollama

app = Flask(__name__)
CORS(app)

OLLAMA_MODEL = "llama3.1"
OLLAMA_HOST = "http://localhost:11434"


# ============================================================
# Pydantic schemas for structured Ollama output
# ============================================================

class ResumeData(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    summary: str = ""
    skills: List[str] = Field(default_factory=list)
    experience_years: Optional[float] = None
    education: str = ""
    certifications: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=list)
    experience_entries: List[dict] = Field(default_factory=list)


class JDData(BaseModel):
    mandatory_skills: List[str] = Field(default_factory=list)
    nice_to_have_skills: List[str] = Field(default_factory=list)
    minimum_years_experience: Optional[float] = None
    role_title: str = ""
    summary: str = ""


class EvaluationResult(BaseModel):
    matched_skills: List[str] = Field(default_factory=list)
    missing_skills: List[str] = Field(default_factory=list)
    nice_to_have_matched: List[str] = Field(default_factory=list)
    nice_to_have_missing: List[str] = Field(default_factory=list)
    meets_experience_requirement: bool = False
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    verdict: str = ""


def _ollama_chat(messages, schema=None):
    """Wrapper around ollama.chat with error handling."""
    try:
        kwargs = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "options": {"temperature": 0.1},
        }
        if schema is not None:
            kwargs["format"] = schema.model_json_schema()
        response = ollama.chat(**kwargs)
        return response["message"]["content"]
    except Exception as e:
        raise RuntimeError(f"Ollama communication failed: {e}")


def _parse_json_from_response(raw: str) -> dict:
    """Robustly extract JSON from a model response string."""
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Try to find JSON block in markdown fences
    import re
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # Brute-force find outermost braces
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass
    raise ValueError(f"Could not parse JSON from model response: {raw[:300]}")


# ============================================================
# Pass 1 — Resume Extraction
# ============================================================

def pass1_extract_resume(text: str) -> ResumeData:
    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert resume parser. Extract ALL structured information "
                "from the raw resume text. Be thorough: capture every skill, every job "
                "entry, certifications, languages, and education details."
            ),
        },
        {
            "role": "user",
            "content": (
                "Parse the following resume text into structured JSON.\n\n"
                "For experience_entries, list each role as:\n"
                '{"title": "...", "company": "...", "duration": "...", "description": "..."}\n\n'
                f"Resume text:\n{text}"
            ),
        },
    ]
    raw = _ollama_chat(messages, schema=ResumeData)
    data = _parse_json_from_response(raw)
    return ResumeData(**{k: v for k, v in data.items() if k in ResumeData.model_fields})


# ============================================================
# Pass 2 — Dynamic JD Analysis
# ============================================================

def pass2_analyze_jd(jd_text: Optional[str], role_title: Optional[str]) -> JDData:
    if jd_text and jd_text.strip():
        messages = [
            {
                "role": "system",
                "content": (
                    "You are an expert technical recruiter. Extract structured "
                    "requirements from the given job description."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Extract the job requirements from the following job description "
                    "into structured JSON with fields: mandatory_skills, "
                    "nice_to_have_skills, minimum_years_experience, role_title, summary.\n\n"
                    f"Job Description:\n{jd_text}"
                ),
            },
        ]
    elif role_title and role_title.strip():
        messages = [
            {
                "role": "system",
                "content": (
                    "You are an expert technical recruiter with deep knowledge of "
                    "industry hiring standards. When given only a job title, generate "
                    "realistic, industry-standard requirements that companies typically "
                    "expect for that role."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"The user wants to apply for the role of \"{role_title}\" but did "
                    "not provide a job description. Based on your expert knowledge of "
                    "current industry hiring trends, generate a comprehensive set of "
                    "requirements for this role.\n\n"
                    "Return structured JSON with fields:\n"
                    "- mandatory_skills: list of must-have technical skills\n"
                    "- nice_to_have_skills: list of preferred/bonus skills\n"
                    "- minimum_years_experience: realistic minimum years of experience\n"
                    "- role_title: the role title\n"
                    "- summary: 1-2 sentence summary of what this role typically involves"
                ),
            },
        ]
    else:
        raise ValueError("Either a job description or a role title must be provided.")

    raw = _ollama_chat(messages, schema=JDData)
    data = _parse_json_from_response(raw)
    return JDData(**{k: v for k, v in data.items() if k in JDData.model_fields})


# ============================================================
# Pass 3 — Evaluation
# ============================================================

def pass3_evaluate(resume: ResumeData, jd: JDData) -> EvaluationResult:
    resume_json = json.dumps(resume.model_dump(), indent=2)
    jd_json = json.dumps(jd.model_dump(), indent=2)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a rigorous ATS evaluation engine. Compare the candidate's "
                "resume against the job requirements and provide a detailed, honest "
                "assessment. Be strict: a skill is only 'matched' if the resume "
                "explicitly demonstrates it."
            ),
        },
        {
            "role": "user",
            "content": (
                "Compare the following RESUME against the JOB REQUIREMENTS.\n\n"
                "RESUME:\n"
                f"{resume_json}\n\n"
                "JOB REQUIREMENTS:\n"
                f"{jd_json}\n\n"
                "Return a JSON object with:\n"
                "- matched_skills: mandatory skills from JD found in resume\n"
                "- missing_skills: mandatory skills from JD NOT found in resume\n"
                "- nice_to_have_matched: nice-to-have skills found in resume\n"
                "- nice_to_have_missing: nice-to-have skills NOT found\n"
                "- meets_experience_requirement: true if resume experience >= JD minimum\n"
                "- strengths: top 3 strengths of this candidate for this role\n"
                "- weaknesses: top 3 weaknesses or gaps\n"
                "- recommendations: 3 specific actionable improvements\n"
                "- verdict: one sentence overall assessment"
            ),
        },
    ]
    raw = _ollama_chat(messages, schema=EvaluationResult)
    data = _parse_json_from_response(raw)
    return EvaluationResult(
        **{k: v for k, v in data.items() if k in EvaluationResult.model_fields}
    )


# ============================================================
# Deterministic Score Calculation
# ============================================================

def calculate_score(evaluation: EvaluationResult, jd: JDData) -> dict:
    """
    Compute ATS score using fixed weights (no LLM involvement).

    Weights:
        Mandatory Skills Match  — 40%
        Experience Years Match  — 30%
        Nice-to-Have Match      — 30%
    """
    # --- Mandatory skills (40%) ---
    total_mandatory = len(jd.mandatory_skills)
    if total_mandatory > 0:
        matched_mandatory = len(evaluation.matched_skills)
        mandatory_pct = (matched_mandatory / total_mandatory) * 100
    else:
        mandatory_pct = 100.0 if not jd.mandatory_skills else 0.0

    # --- Experience (30%) ---
    experience_pct = 100.0 if evaluation.meets_experience_requirement else 0.0

    # --- Nice-to-haves (30%) ---
    total_nice = len(jd.nice_to_have_skills)
    if total_nice > 0:
        matched_nice = len(evaluation.nice_to_have_matched)
        nice_pct = (matched_nice / total_nice) * 100
    else:
        nice_pct = 100.0

    # Weighted composite
    score = round(
        (mandatory_pct * 0.40) + (experience_pct * 0.30) + (nice_pct * 0.30), 1
    )
    score = max(0.0, min(100.0, score))

    return {
        "score": score,
        "breakdown": {
            "mandatory_skills": {
                "weight": "40%",
                "matched": len(evaluation.matched_skills),
                "total": total_mandatory,
                "percentage": round(mandatory_pct, 1),
            },
            "experience": {
                "weight": "30%",
                "meets_requirement": evaluation.meets_experience_requirement,
                "percentage": round(experience_pct, 1),
            },
            "nice_to_have": {
                "weight": "30%",
                "matched": len(evaluation.nice_to_have_matched),
                "total": total_nice,
                "percentage": round(nice_pct, 1),
            },
        },
    }


# ============================================================
# API Route
# ============================================================

@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Expects JSON:
    {
        "resume_text": "...",
        "job_description": "..." (optional),
        "target_role": "..." (optional, at least one of jd or role required)
    }
    """
    try:
        body = request.get_json(force=True)
        resume_text = (body.get("resume_text") or "").strip()
        jd_text_raw = body.get("job_description")
        jd_text = jd_text_raw.strip() if jd_text_raw else None
        target_role_raw = body.get("target_role")
        target_role = target_role_raw.strip() if target_role_raw else None

        if not resume_text:
            return jsonify({"error": "resume_text is required"}), 400
        if not jd_text and not target_role:
            return jsonify({"error": "Provide job_description or target_role"}), 400

        # Pass 1
        resume_data = pass1_extract_resume(resume_text)

        # Pass 2
        jd_data = pass2_analyze_jd(jd_text, target_role)

        # Pass 3
        evaluation = pass3_evaluate(resume_data, jd_data)

        # Deterministic score
        scoring = calculate_score(evaluation, jd_data)

        return jsonify({
            "resume_data": resume_data.model_dump(),
            "jd_data": jd_data.model_dump(),
            "evaluation": evaluation.model_dump(),
            "score": scoring["score"],
            "score_breakdown": scoring["breakdown"],
        })

    except RuntimeError as e:
        return jsonify({"error": str(e), "type": "ollama_error"}), 503
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e), "type": "internal_error"}), 500


@app.route("/api/health", methods=["GET"])
def health():
    try:
        ollama.list()
        return jsonify({"status": "ok", "ollama": "reachable", "model": OLLAMA_MODEL})
    except Exception:
        return jsonify({"status": "degraded", "ollama": "unreachable"}), 503


if __name__ == "__main__":
    print("=" * 60)
    print("  ATS Pipeline Backend — Ollama + Multi-Pass Reasoning")
    print("  Make sure Ollama is running: ollama serve")
    print(f"  Model: {OLLAMA_MODEL}  |  Host: {OLLAMA_HOST}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=True)
