# Vendorcheck

Full-stack vendor onboarding verification system built with **FastAPI**, **SQLite**, **ReportLab**, **pdfplumber**, **Google Gemini 3.5 Flash-Lite (`google-genai`)**, and **React + Vite + Tailwind CSS**.

## Architecture

- **Stage 1 — Intake & Document Classification:** Validates PDF readability and classifies each attachment (`TAX_REGISTRATION`, `BANK_PROOF`, `COMPLIANCE_CERT`, or `WRONG_DOCUMENT`) via Gemini 3.5 Flash-Lite with automatic `pdfplumber` fallback.
- **Stage 2 — Structured Entity & Field Extraction:** Extracts strict Pydantic JSON schemas from tax certificates, bank verification letters, and compliance certificates.
- **Stage 3 — Deterministic Cross-Field & Jurisdiction Rule Engine:** Pure Python compliance checks covering completeness, multi-jurisdiction tax/routing formats (`IN`, `US`, `UK`, `AE`, `AU`, and `OTHER`/`DE` cross-border policy evaluator), India PAN 4th-character constitution & GSTIN embedded-PAN/state prefix routing, corporate suffix normalization, DBA entity resolution, document expiry (`2026-11-20`), and SQLite duplicate bank account detection.
- **Stage 4 — Decision Routing & Outbound Vendor Remediation:** Routes to `APPROVED`, `PENDING`, or `REJECTED`, persists audit logs to SQLite (`backend/vendorguard.db`), and drafts itemized vendor remediation/escalation notices.

## Quick Start

### 1. Environment (Optional Gemini Key)
Copy `.env.example` to `.env` and optionally set `GEMINI_API_KEY`. If unset or rate-limited, the backend automatically uses its deterministic `pdfplumber` extraction fallback.

### 2. Backend (FastAPI — Port 8000)
```powershell
backend\.venv\Scripts\python.exe backend\generate_fixtures.py
backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### 3. Frontend (React + Vite — Port 5173)
```powershell
npm --prefix frontend run dev
```

Open `http://localhost:5173` in your browser.

### 4. Automated Scenario Verification
```powershell
backend\.venv\Scripts\python.exe backend\test_scenarios.py --url http://127.0.0.1:8000
```
