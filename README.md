# VendorCheck
**Automated multi-jurisdiction vendor onboarding and compliance verification** using hybrid multimodal OCR, a deterministic Python rule engine, and human-in-the-loop (HITL) exception routing.

🔗 **[Live App](https://vendorcheck-omega.vercel.app)** *(Note: Backend runs on Render's free tier—first request may take ~30–45s to wake up)*  
---

## 1. The Problem Statement
* **Manual Ops Bottleneck:** Finance and procurement teams spend hours manually cross-checking unstructured vendor packets (tax IDs, bank letters, compliance certs) across different country formats.
* **Why Pure LLM Wrappers Fail Here:** Compliance cannot tolerate silent hallucinations. Letting an LLM decide "Approve" or "Reject" creates audit risk, while rigid template-based OCR breaks on messy real-world PDFs.

## 2. How It Works (4-Stage Pipeline)
`PDF Upload` → `1. Classify` → `2. Extract (Pydantic JSON)` → `3. Deterministic Rule Engine` → `4. Decision & Remediation`

* **Stage 1 — Intake & Document Classification:** Validates PDF readability and classifies attachments (`TAX_REGISTRATION`, `BANK_PROOF`, `COMPLIANCE_CERT`, or `WRONG_DOCUMENT`) via **Gemini 3.5 Flash-Lite**, with automatic `pdfplumber` fallback if rate-limited or offline.
* **Stage 2 — Structured Entity & Field Extraction:** Extracts strict **Pydantic JSON schemas** from tax certificates, bank verification letters, and compliance certificates.
* **Stage 3 — Deterministic Cross-Field & Jurisdiction Rule Engine:** Pure Python compliance checks covering:
  * Multi-jurisdiction tax & routing validation (`IN`, `US`, `UK`, `AE`, `AU`, plus `OTHER/DE` cross-border policy evaluation).
  * India-specific logic: PAN 4th-character constitution checks and GSTIN embedded-PAN/state prefix verification.
  * Entity hygiene: Corporate suffix normalization, DBA entity resolution, document expiry checks, and SQLite duplicate bank account detection.
* **Stage 4 — Decision Routing & Vendor Remediation:** Routes applications to `APPROVED`, `PENDING` (HITL review), or `REJECTED`, persists audit logs to SQLite (`backend/vendorguard.db`), and auto-drafts itemized vendor remediation notices.

## 3. Key Design Trade-offs
* **LLM for extraction, Python for decisions:** Multimodal LLMs handle messy document layouts well, while pure Python rules guarantee 100% deterministic, auditable compliance checks.
* **Zero-downtime fallback:** If the Gemini API key is unset or hits free-tier rate limits, the backend degrades gracefully to `pdfplumber` rather than crashing the workflow.

## 4. Tech Stack
* **Backend:** FastAPI, Python, Pydantic, SQLite, ReportLab, `pdfplumber`, Google Gemini 3.5 Flash-Lite (`google-genai`)
* **Frontend:** React, Vite, Tailwind CSS

---

## Local Quick Start

### 1. Environment (Optional Gemini Key)
Copy `.env.example` to `.env` and optionally set `GEMINI_API_KEY`. If unset or rate-limited, the backend automatically uses its deterministic `pdfplumber` extraction fallback.

### 2. Backend (FastAPI — Port 8000)
```bash
backend\.venv\Scripts\python.exe backend\generate_fixtures.py
backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload

### 3. Frontend (React + Vite — Port 5173)
```powershell
npm --prefix frontend run dev
```

Open `http://localhost:5173` in your browser.

### 4. Automated Scenario Verification
```powershell
backend\.venv\Scripts\python.exe backend\test_scenarios.py --url http://127.0.0.1:8000
```
