-- ===== RAG RESUME TABLE =====
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- Enable pgvector for embeddings (optional, for semantic search)
CREATE EXTENSION IF NOT EXISTS vector;

-- Create resumes table for RAG
CREATE TABLE IF NOT EXISTS resumes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT,
  upload_date TIMESTAMPTZ DEFAULT NOW(),
  extracted_text TEXT,
  summary TEXT,
  skills TEXT[],
  experience_years NUMERIC,
  education TEXT,
  embedding VECTOR(1536),
  user_id TEXT DEFAULT 'anonymous',
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create index for faster queries
CREATE INDEX idx_resumes_upload_date ON resumes(upload_date DESC);
CREATE INDEX idx_resumes_user_id ON resumes(user_id);
CREATE INDEX idx_resumes_skills ON resumes USING GIN(skills);

-- Enable Row Level Security
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;

-- Create policies for public access
CREATE POLICY "Allow public inserts" ON resumes
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow public reads" ON resumes
  FOR SELECT TO public USING (true);

CREATE POLICY "Allow public updates" ON resumes
  FOR UPDATE TO public USING (true);

CREATE POLICY "Allow public deletes" ON resumes
  FOR DELETE TO public USING (true);

-- Optional: Create a function for similarity search (requires pgvector)
CREATE OR REPLACE FUNCTION search_resumes_by_embedding(
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  file_name TEXT,
  file_url TEXT,
  extracted_text TEXT,
  summary TEXT,
  skills TEXT[],
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.file_name,
    r.file_url,
    r.extracted_text,
    r.summary,
    r.skills,
    1 - (r.embedding <=> query_embedding) AS similarity
  FROM resumes r
  ORDER BY r.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Optional: Create a function for text search
CREATE OR REPLACE FUNCTION search_resumes_by_text(
  search_query TEXT,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  file_name TEXT,
  file_url TEXT,
  extracted_text TEXT,
  summary TEXT,
  skills TEXT[],
  rank FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.file_name,
    r.file_url,
    r.extracted_text,
    r.summary,
    r.skills,
    ts_rank_cd(to_tsvector('english', coalesce(r.extracted_text, '') || ' ' || coalesce(r.summary, '') || ' ' || array_to_string(r.skills, ' ')), plainto_tsquery('english', search_query))::FLOAT AS rank
  FROM resumes r
  WHERE to_tsvector('english', coalesce(r.extracted_text, '') || ' ' || coalesce(r.summary, '') || ' ' || array_to_string(r.skills, ' ')) @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;
