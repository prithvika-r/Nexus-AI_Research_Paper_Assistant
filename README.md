# Nexus — AI Research Paper Assistant

<div align="center">

> **The research tool that thinks with you, not just for you.**

A visually stunning, AI-powered research companion for solo researchers, academics, and students. Read deeper, find underexplored gaps, debate paper claims, and discover high-impact research.

[![Status](https://img.shields.io/badge/status-production--ready-brightgreen?style=flat-square)](https://github.com)
[![Version](https://img.shields.io/badge/version-2.0.0-blue?style=flat-square)](https://github.com)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-336791?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![pgvector](https://img.shields.io/badge/vector-pgvector-blueviolet?style=flat-square)](https://github.com/pgvector/pgvector)
[![Vite](https://img.shields.io/badge/Vite-7.3-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Groq](https://img.shields.io/badge/Groq-Llama%203.3%2070B-f55036?style=flat-square)](https://groq.com/)

</div>

---

## 🌟 Highlights & Key Features

### 🔍 Discovery & Library Management
- **Search 200M+ Papers**: Query the Semantic Scholar API with live metadata, citation counts, and direct library saves.
- **Unified Paper Library**: Organize reading lists, mark papers as read, track processing status, and add personal notes.
- **PDF Upload with OCR/Layout Detection**: Extract single-column, double-column (IEEE), and multi-part complex layouts (Frontiers) with automated de-hyphenation, reference parsing, and table/figure extraction.

### 🧠 Grounded AI & RAG Engine
- **Full-Text RAG Chat**: Ask questions against any paper or collection. Answers are strictly grounded in indexed chunks with verbatim page numbers and snippet citations.
- **pgvector HNSW Indexing**: Embeddings generated locally via `@huggingface/transformers` (`all-MiniLM-L6-v2`) and queried via cosine similarity with HNSW indexes.
- **Hybrid Retrieval**: Combines dense vector similarity with lexical keyword matching, section-header boosting, and fair cross-paper representation.

### ⚡ Advanced AI Research Tools
- **⚖️ AI Debate Mode**: Defend findings, challenge methodology, or adopt Devil's Advocate stances on any paper with verifiable arguments.
- **◎ Research Gaps Radar**: Identify underexplored questions and blind spots in your field. Supports both **Grounded Mode** (grounded in library papers with evidence details) and **Exploration Mode** (generating hypotheses on broad topics).
- **▣ Presentation Generator**: Automatically distill papers into structured slide decks across multiple formats: *Academic*, *Pitch Deck*, *ELI5*, or *Twitter Thread*.
- **🔗 Similarity Network**: Explore force-directed graph representations of conceptual proximity between research papers.
- **🎯 Smart Recommendations**: Personalized recommendations synthesized from your reading history and library topics.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (React 19 + Vite)               │
│   • Dark/Midnight/Light Theme System                        │
│   • D3.js Force Graphs & Visualizations                     │
│   • Clerk Authentication (@clerk/clerk-react)               │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Server (Node.js + Express)               │
│   • REST Routes: /chat, /debate, /gaps, /papers, /slides    │
│   • PDF Pipeline: pdfjs-dist layout detection & tables      │
│   • Embedding Service: HuggingFace Transformers (Local)     │
│   • LLM Service: Groq Cloud API (Llama 3.3 / GPT-OSS)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ pg / pgvector
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             PostgreSQL Database with pgvector               │
│   • papers: metadata, status, full text, file path          │
│   • paper_chunks: 384-dim embeddings, page numbers, types   │
│   • HNSW Index: Cosine similarity vector search             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📂 Project Structure

```
.
├── client/                     # Vite + React Frontend Application
│   ├── public/                 # Static assets & icons
│   ├── src/
│   │   ├── assets/             # SVGs and graphics
│   │   ├── components/         # Reusable UI components
│   │   │   └── common/         # Common UI badges & controls (Tag.jsx)
│   │   ├── context/            # ThemeContext & global state
│   │   ├── api.js              # API client wrapper
│   │   ├── App.jsx             # Main application views and navigation
│   │   ├── App.css             # Component-level styling
│   │   ├── index.css           # Tailwind styling entry
│   │   └── main.jsx            # React root with ClerkProvider
│   ├── .env.example            # Client environment variables template
│   ├── eslint.config.js        # ESLint configuration
│   ├── index.html              # HTML entry point
│   ├── package.json            # Client dependencies & scripts
│   ├── postcss.config.js       # PostCSS plugins
│   ├── tailwind.config.js      # Tailwind CSS configuration
│   └── vite.config.js          # Vite bundler configuration
│
├── server/                     # Express.js + PostgreSQL Backend
│   ├── config/
│   │   └── database.js         # PostgreSQL connection pool with pgvector
│   ├── db/
│   │   ├── schema.sql          # Complete DDL schema & vector indexes
│   │   ├── setup-vector.mjs    # Reusable vector extension setup script
│   │   ├── migrate-rag.mjs     # RAG pgvector tables migration
│   │   └── migrate-retrieval.mjs # Retrieval metadata migration
│   ├── routes/
│   │   ├── chat.js             # Conversational RAG with citations
│   │   ├── debate.js           # Multi-stance academic debate mode
│   │   ├── gaps.js             # Grounded & exploration research gaps
│   │   ├── papers.js           # Paper CRUD & reading status
│   │   ├── recommendations.js  # Smart recommendations engine
│   │   ├── search.js           # Semantic Scholar search proxy
│   │   ├── similarity.js       # Paper similarity network
│   │   ├── slides.js           # Multi-format presentation slides
│   │   └── upload.js           # PDF upload, deduplication, & indexing
│   ├── services/
│   │   ├── chunkService.js     # Page-aware chunking with overlap
│   │   ├── embeddingService.js # Local HuggingFace embeddings (384-dim)
│   │   ├── indexingService.js  # Transactional database vector indexing
│   │   ├── llmService.js       # Groq Cloud prompts & evidence assembly
│   │   ├── pdfService.js       # Multi-column layout & table extraction
│   │   └── retrievalService.js # Hybrid semantic + BM25 lexical retrieval
│   ├── scripts/
│   │   ├── auditSchema.mjs     # One-off database schema diagnostic
│   │   ├── auditColumns.mjs    # One-off table columns diagnostic
│   │   ├── checkPages.mjs      # One-off chunk page diagnostic
│   │   ├── checkPdfPath.mjs    # One-off PDF filepath diagnostic
│   │   ├── reindexAll.mjs      # Batch reindexing script for library
│   │   └── reindexPaper.js     # Single-paper reindex utility
│   ├── tests/
│   │   ├── verification.test.mjs # 18-point system verification suite
│   │   ├── extraction.test.mjs   # 25-point PDF layout extraction suite
│   │   ├── evaluate-rag.mjs      # RAG accuracy, MRR, & Recall@K benchmark
│   │   ├── retrieval.test.mjs    # Standalone semantic retrieval test
│   │   ├── indexing.test.mjs     # Standalone chunk indexing test
│   │   ├── gaps.test.mjs         # Research gaps endpoint & mode test
│   │   ├── improvements.test.mjs # Multi-paper & citation mapping tests
│   │   ├── user-fixes.test.mjs   # Instruction cleaning regression tests
│   │   ├── pdf-pages.test.mjs    # Page-aware extraction diagnostic test
│   │   └── pdf-extraction.test.js # PDF extraction CLI test tool
│   ├── uploads/
│   │   └── .gitkeep            # Upload storage placeholder
│   ├── .env.example            # Server environment variables template
│   ├── index.js                # Express app entry & graceful shutdown
│   └── package.json            # Server dependencies & scripts
│
├── .gitignore                  # Comprehensive gitignore rules
└── README.md                   # Project documentation
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: v14.0 or higher with the **pgvector** extension installed
- **Groq API Key**: Free at [console.groq.com](https://console.groq.com)
- **Clerk Account**: Free at [clerk.com](https://clerk.com)

---

### Step 1: Database Setup (PostgreSQL + pgvector)

1. **Install `pgvector`**:
   - **macOS**: `brew install pgvector`
   - **Linux (Ubuntu/Debian)**: `sudo apt install postgresql-15-pgvector` (or your PostgreSQL version)
   - **Windows**: Follow official instructions at [pgvector Windows installation](https://github.com/pgvector/pgvector#windows) or use pre-compiled binaries.
   - **Docker**: `docker run --name nexus-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d pgvector/pgvector:pg16`

2. **Create the Database**:
   ```bash
   createdb -U postgres nexus
   ```

3. **Initialize the Schema**:
   The authoritative database schema is located at `server/db/schema.sql`. It enables `uuid-ossp`, `pgcrypto`, and `vector`, creates the `papers` and `paper_chunks` tables, and builds HNSW cosine vector indexes.
   ```bash
   psql -U postgres -d nexus -f server/db/schema.sql
   ```
   *Or initialize programmatically via npm from the `server/` directory:*
   ```bash
   cd server
   npm run db:setup
   ```

4. **Verify pgvector Extension**:
   ```sql
   SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
   ```

---

### Step 2: Backend Configuration & Start

1. Navigate to the `server/` directory:
   ```bash
   cd server
   ```
2. Copy the template environment file:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and verify your configuration:
   ```env
   DB_USER=postgres
   DB_HOST=localhost
   DB_NAME=nexus
   DB_PASSWORD=your_password
   DB_PORT=5432

   PORT=5000
   CLIENT_URL=http://localhost:5173

   GROQ_API_KEY=gsk_your_groq_api_key
   GROQ_MODEL=openai/gpt-oss-120b
   SEMANTIC_SCHOLAR_API_KEY=your_key_optional
   ```
4. Install dependencies and start the backend:
   ```bash
   npm install
   npm run dev
   ```
   The backend API will run on **http://localhost:5000**.

---

### Step 3: Frontend Configuration & Start

1. Open a new terminal and navigate to `client/`:
   ```bash
   cd client
   ```
2. Copy the template environment file:
   ```bash
   cp .env.example .env.local
   ```
3. Set your Clerk publishable key in `.env.local`:
   ```env
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
   VITE_API_URL=http://localhost:5000
   ```
4. Install dependencies and launch the frontend:
   ```bash
   npm install
   npm run dev
   ```
   Open **http://localhost:5173** in your browser.

---

## 📡 API Reference

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/health` | `GET` | Health check and database connection status |
| `/api/test-db` | `GET` | Returns count of indexed papers in database |
| `/api/papers` | `GET` | Fetch all saved library papers with status and counts |
| `/api/papers` | `POST` | Save a new paper (from search or manual input) |
| `/api/papers/:id` | `DELETE` | Remove a paper and cascade delete its chunks |
| `/api/papers/:id/read` | `PATCH` | Toggle paper read/unread status |
| `/api/search?q=query` | `GET` | Search academic papers via Semantic Scholar |
| `/api/upload` | `POST` | Upload PDF file; triggers layout parsing & vector indexing |
| `/api/chat` | `POST` | RAG chat on a paper; returns answer with chunk citations |
| `/api/debate` | `POST` | AI debate mode (Defend, Challenge, Devil's Advocate) |
| `/api/gaps` | `POST` | Generate grounded or exploratory research gaps |
| `/api/slides` | `POST` | Generate structured slide presentations (Academic, Pitch, ELI5, Twitter) |
| `/api/similarity` | `POST` | Compute cosine similarity network across library papers |
| `/api/recommendations` | `POST` | Personalized paper recommendations based on reading history |

---

## 🧪 Testing & Verification

The codebase includes full automated test suites to ensure RAG retrieval accuracy, layout extraction fidelity, and regression prevention.

```bash
cd server

# 1. Run full 17-point system verification & resilience suite
npm test

# 2. Run automated PDF layout extraction test suite (single/double column & Frontiers)
npm run test:extraction

# 3. Run RAG retrieval benchmark (Recall@6, MRR, citation grounding, hallucination tests)
npm run test:rag

# 4. Run both verification and layout suites
npm run test:all
```

---

## 🔧 Database Maintenance & Scripts

| Command | Location | Description |
| :--- | :--- | :--- |
| `npm run reindex` | `server/` | Re-extracts and re-indexes all PDF files in `uploads/` |
| `node scripts/reindexPaper.js` | `server/` | Target and re-index a single paper by ID |
| `node scripts/checkPages.mjs` | `server/` | Diagnostic: Audits chunk counts and page-number assignment |
| `node scripts/checkPdfPath.mjs` | `server/` | Diagnostic: Verifies PDF presence on disk for database entries |
| `node scripts/auditSchema.mjs` | `server/` | Diagnostic: Audits database schema integrity and table structures |
| `node scripts/auditColumns.mjs` | `server/` | Diagnostic: Audits column data types and nullability |
| `node db/setup-vector.mjs` | `server/` | Reusable setup: Initializes and verifies the pgvector extension |

---

## 🐛 Troubleshooting

<details>
<summary><b>Database connection refused / ECONNREFUSED</b></summary>

- Ensure PostgreSQL is actively running: `pg_isready`
- Check credentials in `server/.env` (`DB_USER`, `DB_PASSWORD`, `DB_PORT`)
- Ensure database exists: `createdb nexus`
</details>

<details>
<summary><b>pgvector extension not found</b></summary>

- Install the pgvector extension on your PostgreSQL server:
  - macOS: `brew install pgvector`
  - Linux: `sudo apt install postgresql-15-pgvector`
  - Windows: Follow [pgvector Windows installation](https://github.com/pgvector/pgvector#windows)
- Run `node db/setup-vector.mjs` to confirm the extension is active.
</details>

<details>
<summary><b>Groq API authentication or rate-limit error</b></summary>

- Get a free API key at [console.groq.com](https://console.groq.com)
- Ensure `GROQ_API_KEY` is present in `server/.env`
- Restart the backend server after editing `.env`
</details>

<details>
<summary><b>Clerk "Missing publishableKey" error</b></summary>

- Copy `client/.env.example` to `client/.env.local`
- Provide your Clerk Publishable Key (`pk_test_...`) from [dashboard.clerk.com](https://dashboard.clerk.com)
</details>

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Run the test suite (`npm test` in `server/`)
5. Push to your branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">
Made with ❤️ for researchers, academics, and students everywhere.
</div>
