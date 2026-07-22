-- ===== UNIFIED RESUME ANALYSIS TABLE =====
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Contains ALL resume + ATS scoring data in one table

CREATE TABLE IF NOT EXISTS resume_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Resume File Information
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT,
  upload_date TIMESTAMPTZ DEFAULT NOW(),

  -- Resume Content
  extracted_text TEXT,
  summary TEXT,
  skills TEXT[],
  experience_years NUMERIC,
  education TEXT,

  -- Flexible Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Target Job Information
  target_role TEXT,
  job_description TEXT,

  -- JD Requirements (generated or provided)
  jd_mandatory_skills TEXT[],
  jd_nice_to_have_skills TEXT[],
  jd_minimum_years_experience NUMERIC,
  jd_role_title TEXT,
  jd_summary TEXT,

  -- Candidate Information
  candidate_name TEXT,
  candidate_email TEXT,

  -- ATS Score Breakdown
  ats_score NUMERIC NOT NULL DEFAULT 0,
  mandatory_score NUMERIC DEFAULT 0,
  experience_score NUMERIC DEFAULT 0,
  nice_to_have_score NUMERIC DEFAULT 0,

  -- Skill Matching Results
  skills_matched TEXT[],
  skills_missing TEXT[],
  nice_to_have_matched TEXT[],
  nice_to_have_missing TEXT[],
  meets_experience BOOLEAN DEFAULT false,

  -- Evaluation Results
  strengths TEXT[],
  weaknesses TEXT[],
  recommendations TEXT[],
  verdict TEXT,

  -- Processing Info
  parsed_with TEXT DEFAULT 'ollama-gemma4-e4b',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id TEXT DEFAULT 'anonymous'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ra_upload_date ON resume_analyses(upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_ra_user_id ON resume_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_ra_skills ON resume_analyses USING GIN(skills);
CREATE INDEX IF NOT EXISTS idx_ra_ats_score ON resume_analyses(ats_score DESC);
CREATE INDEX IF NOT EXISTS idx_ra_target_role ON resume_analyses(target_role);
CREATE INDEX IF NOT EXISTS idx_ra_created_at ON resume_analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ra_candidate_name ON resume_analyses(candidate_name);

-- Enable Row Level Security
ALTER TABLE resume_analyses ENABLE ROW LEVEL SECURITY;

-- Public access policies
CREATE POLICY "Allow public inserts" ON resume_analyses
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public reads" ON resume_analyses
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public updates" ON resume_analyses
  FOR UPDATE TO public USING (true);

CREATE POLICY "Allow public deletes" ON resume_analyses
  FOR DELETE TO public USING (true);

-- ===== AGENTIC JOB OPPORTUNITIES TABLE =====
CREATE TABLE IF NOT EXISTS job_opportunities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT,
  search_type TEXT NOT NULL, -- 'jobs' or 'internships'
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  platform TEXT NOT NULL, -- 'LinkedIn', 'Indeed', 'Naukri', 'Glassdoor', 'Wellfound', etc.
  location TEXT,
  salary_range TEXT,
  match_percentage NUMERIC NOT NULL DEFAULT 0,
  matched_skills TEXT[],
  missing_skills TEXT[],
  ai_recommendation TEXT,
  opportunity_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jo_session ON job_opportunities(session_id);
CREATE INDEX IF NOT EXISTS idx_jo_search_type ON job_opportunities(search_type);
CREATE INDEX IF NOT EXISTS idx_jo_created_at ON job_opportunities(created_at DESC);

ALTER TABLE job_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public inserts on job_opportunities" ON job_opportunities
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public reads on job_opportunities" ON job_opportunities
  FOR SELECT TO public USING (true);

-- ===== 24/7 PIPELINE OPPORTUNITIES TABLE =====
CREATE TABLE IF NOT EXISTS pipeline_opportunities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_name TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  salary TEXT,
  skills TEXT[],
  type TEXT NOT NULL DEFAULT 'job',
  url TEXT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_source ON pipeline_opportunities(source);
CREATE INDEX IF NOT EXISTS idx_po_type ON pipeline_opportunities(type);
CREATE INDEX IF NOT EXISTS idx_po_discovered ON pipeline_opportunities(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_company ON pipeline_opportunities(company);
CREATE INDEX IF NOT EXISTS idx_po_skills ON pipeline_opportunities USING GIN(skills);

ALTER TABLE pipeline_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public inserts on pipeline_opportunities" ON pipeline_opportunities
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public reads on pipeline_opportunities" ON pipeline_opportunities
  FOR SELECT TO public USING (true);

-- ===== 24/7 PIPELINE RUNS TABLE =====
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  time TEXT NOT NULL,
  source TEXT NOT NULL,
  new_items INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  duration TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  search_type TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_cycle ON pipeline_runs(cycle_id DESC);
CREATE INDEX IF NOT EXISTS idx_pr_time ON pipeline_runs(time DESC);
CREATE INDEX IF NOT EXISTS idx_pr_status ON pipeline_runs(status);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public inserts on pipeline_runs" ON pipeline_runs
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public reads on pipeline_runs" ON pipeline_runs
  FOR SELECT TO public USING (true);
