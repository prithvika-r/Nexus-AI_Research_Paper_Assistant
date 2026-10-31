-- Nexus AI Research Paper Assistant
-- Database Schema for PostgreSQL with pgvector

-- Enable UUID, Cryptographic, and Vector extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Papers Table: Stores paper metadata, full text, and processing status
CREATE TABLE IF NOT EXISTS papers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    authors TEXT[],
    year INT,
    abstract TEXT,
    full_text TEXT,
    file_path TEXT,
    source TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    notes TEXT,
    processing_status TEXT DEFAULT 'legacy',
    chunk_count INTEGER DEFAULT 0,
    embedding_model TEXT,
    processed_at TIMESTAMP,
    content_hash TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for querying papers by status, creation date, and content hash
CREATE INDEX IF NOT EXISTS idx_papers_created_at ON papers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_processing_status ON papers(processing_status);
CREATE INDEX IF NOT EXISTS idx_papers_content_hash ON papers(content_hash);

-- 2. Paper Chunks Table: Stores semantic chunks with 384-dim embeddings for RAG
CREATE TABLE IF NOT EXISTS paper_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    page_number INTEGER,
    content TEXT NOT NULL,
    embedding VECTOR(384),
    content_type TEXT DEFAULT 'body',
    retrieval_score REAL,
    is_reference BOOLEAN DEFAULT FALSE,
    section_title TEXT,
    section_path TEXT[] DEFAULT '{}',
    section_level INTEGER,
    reading_order INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (paper_id, chunk_index)
);

-- Index for retrieving all chunks for a given paper
CREATE INDEX IF NOT EXISTS idx_paper_chunks_paper_id ON paper_chunks(paper_id);

-- Index for filtering by chunk type and references
CREATE INDEX IF NOT EXISTS idx_paper_chunks_content_type ON paper_chunks(content_type);
CREATE INDEX IF NOT EXISTS idx_paper_chunks_is_reference ON paper_chunks(is_reference);

-- HNSW Vector Index for ultra-fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_paper_chunks_embedding_hnsw 
ON paper_chunks 
USING hnsw (embedding vector_cosine_ops);
