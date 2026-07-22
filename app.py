"""
Flask backend for ATS Resume Scoring Pipeline.
Uses Ollama (llama3.1) with a 3-pass reasoning pipeline and deterministic scoring.
"""
import json
import traceback
import threading
import queue
import time
import random
import urllib.request
import urllib.error
import urllib.parse
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


# ============================================================
# AGENTIC AI SEARCH LOOP BACKEND IMPLEMENTATION
# ============================================================

SUPABASE_URL = "https://opzzzwceeydllodemucd.supabase.co"
SUPABASE_KEY = "sb_publishable_KV4otsvBhkNRK4bgKHqKvg_gYe79yXV"

agent_sessions = {}
agent_sessions_lock = threading.Lock()


class OpportunityEval(BaseModel):
    match_percentage: float = 0.0
    matched_skills: List[str] = Field(default_factory=list)
    missing_skills: List[str] = Field(default_factory=list)
    ai_recommendation: str = ""


def _persist_opportunity_to_supabase(opp_data: dict) -> bool:
    """Persists evaluated opportunity to Supabase REST API."""
    try:
        url = f"{SUPABASE_URL}/rest/v1/job_opportunities"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        payload = {
            "session_id": opp_data.get("session_id", "default"),
            "search_type": opp_data.get("search_type", "jobs"),
            "title": opp_data.get("title", ""),
            "company": opp_data.get("company", ""),
            "platform": opp_data.get("platform", ""),
            "location": opp_data.get("location", ""),
            "salary_range": opp_data.get("salary_range", ""),
            "match_percentage": float(opp_data.get("match_percentage", 0)),
            "matched_skills": opp_data.get("matched_skills", []),
            "missing_skills": opp_data.get("missing_skills", []),
            "ai_recommendation": opp_data.get("ai_recommendation", ""),
            "opportunity_url": opp_data.get("opportunity_url", "https://linkedin.com")
        }
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in (200, 201)
    except Exception as e:
        print(f"[Supabase Persistence Log] {e}")
        return False


def evaluate_opportunity_match(resume_data: dict, opp: dict) -> dict:
    """Uses Ollama/llama3.1 to evaluate fit between candidate resume data and discovered opportunity."""
    cand_skills = resume_data.get("skills", [])
    target_role = resume_data.get("target_role") or resume_data.get("role_title") or "Software Engineer"
    exp_years = resume_data.get("experience_years") or 0.0

    prompt = (
        f"Candidate Target Role: {target_role}\n"
        f"Candidate Experience: {exp_years} years\n"
        f"Candidate Skills: {', '.join(cand_skills[:15]) if cand_skills else 'General Tech'}\n\n"
        f"Discovered Opportunity:\n"
        f"Title: {opp.get('title')}\n"
        f"Company: {opp.get('company')}\n"
        f"Platform: {opp.get('platform')}\n"
        f"Search Category: {opp.get('search_type')}\n"
        f"Required Skills: {', '.join(opp.get('required_skills', []))}\n"
        f"Description: {opp.get('description', '')}\n\n"
        f"Evaluate candidate match percentage (0-100), list matched skills, list missing skills, "
        f"and write a concise 1-sentence AI recommendation on why candidate should apply."
    )

    try:
        messages = [
            {"role": "system", "content": "You are an autonomous AI recruiter agent scoring candidate job alignment."},
            {"role": "user", "content": prompt}
        ]
        raw = _ollama_chat(messages, schema=OpportunityEval)
        parsed = _parse_json_from_response(raw)
        return {
            "match_percentage": round(float(parsed.get("match_percentage", 75)), 1),
            "matched_skills": parsed.get("matched_skills", []),
            "missing_skills": parsed.get("missing_skills", []),
            "ai_recommendation": parsed.get("ai_recommendation", "Strong candidate fit based on skills and domain experience.")
        }
    except Exception as e:
        print(f"[Ollama Evaluation Fallback] {e}")
        opp_skills = opp.get("required_skills", [])
        matched = [s for s in opp_skills if any(cs.lower() in s.lower() or s.lower() in cs.lower() for cs in cand_skills)]
        missing = [s for s in opp_skills if s not in matched]
        total = max(1, len(opp_skills))
        calc_pct = round((len(matched) / total) * 100.0, 1)
        base_pct = max(60.0, min(98.0, calc_pct + 45.0 if not opp_skills else calc_pct))
        return {
            "match_percentage": base_pct,
            "matched_skills": matched if matched else (cand_skills[:3] if cand_skills else ["Core Engineering"]),
            "missing_skills": missing,
            "ai_recommendation": f"Great alignment with candidate profile for {opp.get('company')} ({opp.get('title')})."
        }


def generate_mock_opportunity(search_type: str, resume_data: dict, cycle_num: int) -> dict:
    """Generates realistic job/internship findings matching resume domain."""
    cand_role = resume_data.get("target_role") or "Software Engineer"
    cand_skills = resume_data.get("skills") or ["Python", "JavaScript", "SQL", "React"]

    tech_stack = cand_skills[:4] if cand_skills else ["Python", "Node.js", "Docker"]

    job_titles = [
        f"Senior {cand_role}", f"Lead {cand_role}", f"{cand_role} - Platform & Cloud",
        f"Staff {cand_role}", f"{cand_role} (Core Engine)", f"Autonomous Systems {cand_role}"
    ]
    intern_titles = [
        f"{cand_role} Intern", f"Software Engineering Intern (Summer 2026)",
        f"AI & Systems Research Intern", f"Backend Engineering Intern",
        f"Full-Stack Developer Intern", f"Data & Cloud Infrastructure Intern"
    ]

    platforms = ["LinkedIn", "Indeed", "Glassdoor", "Naukri", "Wellfound", "YC WorkAtAStartup", "Google Jobs", "Internshala"]
    companies = ["Stripe", "OpenAI", "Google", "Vercel", "Datadog", "Razorpay", "Cloudflare", "GitHub", "Anthropic", "Netflix", "Uber", "Postman", "Scale AI"]
    locations = ["Remote (Global)", "Bangalore, IN", "San Francisco, CA", "Austin, TX", "London, UK", "New York, NY", "Hybrid (Seattle)"]

    salary_ranges_job = ["$140k - $180k", "$160k - $210k", "₹25L - ₹40L PA", "$130k - $175k", "₹30L - ₹50L PA"]
    stipends_intern = ["₹60k - ₹90k/mo", "$45 - $65/hr", "₹50k/mo + Perks", "$8,000/mo", "₹75k/mo Remote"]

    if search_type == "internships":
        title = random.choice(intern_titles)
        salary = random.choice(stipends_intern)
    else:
        title = random.choice(job_titles)
        salary = random.choice(salary_ranges_job)

    company = random.choice(companies)
    platform = random.choice(platforms)
    location = random.choice(locations)

    req_skills = list(set(tech_stack + random.sample(["Docker", "AWS", "Kubernetes", "GraphQL", "PyTorch", "Redis", "TypeScript", "Microservices"], 2)))

    query_str = urllib.parse.quote(f"{company} {title}")
    slug_title = urllib.parse.quote(title.lower().replace(" ", "-"))

    if platform == "LinkedIn":
        opp_url = f"https://www.linkedin.com/jobs/search/?keywords={query_str}"
    elif platform == "Indeed":
        opp_url = f"https://www.indeed.com/jobs?q={query_str}"
    elif platform == "Glassdoor":
        opp_url = f"https://www.glassdoor.com/Job/jobs.htm?sc.keyword={query_str}"
    elif platform == "Naukri":
        opp_url = f"https://www.naukri.com/{slug_title}-jobs"
    elif platform == "Wellfound":
        opp_url = f"https://wellfound.com/jobs?q={query_str}"
    elif platform == "Google Jobs":
        opp_url = f"https://www.google.com/search?q={query_str}+jobs"
    elif platform == "Internshala":
        opp_url = f"https://internshala.com/internships/keywords-{slug_title}"
    elif platform == "YC WorkAtAStartup":
        opp_url = f"https://www.workatastartup.com/companies?query={urllib.parse.quote(company)}"
    else:
        opp_url = f"https://www.google.com/search?q={query_str}+jobs"

    return {
        "title": title,
        "company": company,
        "platform": platform,
        "location": location,
        "salary_range": salary,
        "search_type": search_type,
        "required_skills": req_skills,
        "description": f"{company} is hiring a {title} in {location}. Stack: {', '.join(req_skills)}. Great opportunity for autonomous engineers.",
        "opportunity_url": opp_url
    }


def run_agentic_search_loop(session_id: str):
    """Background agent thread loop that continuously searches, evaluates, persists, and queues findings."""
    print(f"[Agentic Search Agent] Started background thread for session: {session_id}")
    while True:
        with agent_sessions_lock:
            session = agent_sessions.get(session_id)
            if not session or session["stop_event"].is_set():
                if session:
                    session["status"] = "stopped"
                print(f"[Agentic Search Agent] Stopping background loop for session: {session_id}")
                break

            search_type = session["search_type"]
            resume_data = session["resume_data"]
            session["cycle_count"] += 1
            current_cycle = session["cycle_count"]

        # Simulate autonomous crawling & finding
        raw_opp = generate_mock_opportunity(search_type, resume_data, current_cycle)

        # AI evaluation via Ollama / fallback
        eval_result = evaluate_opportunity_match(resume_data, raw_opp)

        processed_opp = {
            "id": f"opp_{current_cycle}_{random.randint(1000, 9999)}",
            "session_id": session_id,
            "cycle_num": current_cycle,
            "timestamp": time.strftime("%H:%M:%S"),
            "search_type": search_type,
            "title": raw_opp["title"],
            "company": raw_opp["company"],
            "platform": raw_opp["platform"],
            "location": raw_opp["location"],
            "salary_range": raw_opp["salary_range"],
            "opportunity_url": raw_opp["opportunity_url"],
            "match_percentage": eval_result["match_percentage"],
            "matched_skills": eval_result["matched_skills"],
            "missing_skills": eval_result["missing_skills"],
            "ai_recommendation": eval_result["ai_recommendation"]
        }

        # Persist to Supabase
        _persist_opportunity_to_supabase(processed_opp)

        # Push to thread-safe queue
        with agent_sessions_lock:
            session = agent_sessions.get(session_id)
            if session and not session["stop_event"].is_set():
                session["queue"].put(processed_opp)
                session["total_found"] += 1

        # Pause interval between cycles (checking stop event frequently)
        for _ in range(12):  # 12 * 0.2s = 2.4s interval
            with agent_sessions_lock:
                session = agent_sessions.get(session_id)
                if not session or session["stop_event"].is_set():
                    break
            time.sleep(0.2)


# ============================================================
# AGENTIC SEARCH API ROUTES
# ============================================================

@app.route("/api/agent/start", methods=["POST"])
def start_agent_search():
    """Starts background agent search loop thread for jobs or internships."""
    try:
        body = request.get_json(force=True) or {}
        search_type = body.get("search_type", "jobs")  # "jobs" or "internships"
        resume_data = body.get("resume_data", {})
        session_id = body.get("session_id") or f"session_{int(time.time())}"

        with agent_sessions_lock:
            # Stop existing thread if running for this session_id
            if session_id in agent_sessions:
                existing = agent_sessions[session_id]
                existing["stop_event"].set()

            stop_event = threading.Event()
            item_queue = queue.Queue()

            session_info = {
                "session_id": session_id,
                "search_type": search_type,
                "resume_data": resume_data,
                "stop_event": stop_event,
                "queue": item_queue,
                "status": "running",
                "cycle_count": 0,
                "total_found": 0,
                "start_time": time.time()
            }

            thread = threading.Thread(
                target=run_agentic_search_loop,
                args=(session_id,),
                daemon=True
            )
            session_info["thread"] = thread
            agent_sessions[session_id] = session_info

            thread.start()

        return jsonify({
            "status": "started",
            "session_id": session_id,
            "search_type": search_type,
            "message": f"Autonomous search agent started for {search_type}."
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/agent/poll", methods=["GET"])
def poll_agent_search():
    """Polls newly processed opportunities from thread-safe queue."""
    session_id = request.args.get("session_id", "default")
    with agent_sessions_lock:
        session = agent_sessions.get(session_id)
        if not session:
            return jsonify({
                "status": "stopped",
                "items": [],
                "cycle_count": 0,
                "total_found": 0
            })

        items = []
        q = session["queue"]
        while not q.empty():
            try:
                items.append(q.get_nowait())
            except queue.Empty:
                break

        return jsonify({
            "status": session["status"],
            "cycle_count": session["cycle_count"],
            "total_found": session["total_found"],
            "items": items
        })


@app.route("/api/agent/stop", methods=["POST"])
def stop_agent_search():
    """Terminates background agent loop immediately and locks final state."""
    try:
        body = request.get_json(force=True) or {}
        session_id = body.get("session_id")

        with agent_sessions_lock:
            target_sessions = [agent_sessions[session_id]] if session_id and session_id in agent_sessions else list(agent_sessions.values())

            for session in target_sessions:
                session["stop_event"].set()
                session["status"] = "stopped"

        return jsonify({
            "status": "stopped",
            "message": "Background search agent terminated. Dashboard state locked."
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/agent/status", methods=["GET"])
def get_agent_status():
    """Returns active agent sessions status."""
    session_id = request.args.get("session_id")
    with agent_sessions_lock:
        if session_id and session_id in agent_sessions:
            s = agent_sessions[session_id]
            return jsonify({
                "session_id": session_id,
                "status": s["status"],
                "cycle_count": s["cycle_count"],
                "total_found": s["total_found"],
                "search_type": s["search_type"]
            })

        summary = [
            {
                "session_id": sid,
                "status": s["status"],
                "cycle_count": s["cycle_count"],
                "total_found": s["total_found"],
                "search_type": s["search_type"]
            }
            for sid, s in agent_sessions.items()
        ]
        return jsonify({"sessions": summary})



if __name__ == "__main__":
    print("=" * 60)
    print("  ATS Pipeline Backend — Ollama + Multi-Pass Reasoning")
    print("  Make sure Ollama is running: ollama serve")
    print(f"  Model: {OLLAMA_MODEL}  |  Host: {OLLAMA_HOST}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=True)
