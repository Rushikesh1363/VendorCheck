from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from backend import database
from backend.generate_fixtures import (
    FIXTURES_DIR,
    PRESET_SCENARIOS,
    generate_all_fixtures,
)
from backend.pipeline import execute_pipeline_events, stream_pipeline_events
from backend.schemas import VendorFormInput

load_dotenv(override=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    database.init_db()
    generate_all_fixtures(force=False)
    yield


app = FastAPI(
    title="Vendorcheck",
    version="1.0.0",
    description="Autonomous Vendor Onboarding & Compliance Verification",
    lifespan=lifespan,
)

DEFAULT_ALLOWED_ORIGINS = [
    "https://vendorcheck-omega.vercel.app",
    "http://localhost:5173",
]
_raw_origins = (os.getenv("ALLOWED_ORIGINS") or "").strip()
_extra_origins = [
    origin.strip().rstrip("/")
    for origin in _raw_origins.split(",")
    if origin.strip()
]
ALLOWED_ORIGINS = list(dict.fromkeys([*DEFAULT_ALLOWED_ORIGINS, *_extra_origins]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_fixture_path(filename: str) -> Optional[Path]:
    clean = Path(filename).name
    if not clean or clean != filename:
        return None
    path = (FIXTURES_DIR / clean).resolve()
    if not str(path).startswith(str(FIXTURES_DIR.resolve())) or not path.exists():
        return None
    return path


async def _resolve_file_slot(
    upload: Optional[UploadFile], preset_filename: Optional[str]
) -> Optional[tuple[str, bytes]]:
    if upload is not None and upload.filename:
        data = await upload.read()
        if data:
            return (upload.filename, data)
    if preset_filename and preset_filename.strip():
        path = _safe_fixture_path(preset_filename.strip())
        if path:
            return (path.name, path.read_bytes())
    return None


@app.get("/health")
def keepalive_health():
    database.ping_db()
    return {"status": "ok"}


@app.get("/api/health")
def health():
    has_gemini = bool((os.getenv("GEMINI_API_KEY") or "").strip())
    return {
        "status": "ok",
        "service": "Vendorcheck",
        "gemini_configured": has_gemini,
        "extraction_mode": "gemini-3.5-flash-lite (with pdfplumber fallback)"
        if has_gemini
        else "pdfplumber-deterministic (fallback active)",
    }


@app.get("/api/presets")
def get_presets():
    enriched = []
    for p in PRESET_SCENARIOS:
        files_meta = {}
        for slot, fname in p["files"].items():
            if fname:
                files_meta[slot] = {
                    "filename": fname,
                    "url": f"/api/fixtures/{fname}",
                }
            else:
                files_meta[slot] = None
        enriched.append({**p, "files_meta": files_meta})
    return {"presets": enriched}


@app.get("/api/fixtures/{filename}")
def get_fixture_pdf(filename: str):
    path = _safe_fixture_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail=f"Fixture '{filename}' not found.")
    return FileResponse(
        path=str(path),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{path.name}"'},
    )


async def _parse_submission_packet(
    legal_entity_name: str,
    dba_trade_name: str,
    entity_constitution: str,
    country_code: str,
    billing_state: str,
    tax_id: str,
    secondary_tax_id: str,
    bank_account_holder: str,
    account_number: str,
    account_type: str,
    routing_code: str,
    bank_name: str,
    contact_email: str,
    scenario_key: Optional[str],
    tax_document: Optional[UploadFile],
    bank_document: Optional[UploadFile],
    compliance_document: Optional[UploadFile],
    tax_preset_file: Optional[str],
    bank_preset_file: Optional[str],
    compliance_preset_file: Optional[str],
):
    form = VendorFormInput(
        legal_entity_name=legal_entity_name,
        dba_trade_name=dba_trade_name,
        entity_constitution=entity_constitution,
        country_code=country_code,
        billing_state=billing_state,
        tax_id=tax_id,
        secondary_tax_id=secondary_tax_id,
        bank_account_holder=bank_account_holder,
        account_number=account_number,
        account_type=account_type,
        routing_code=routing_code,
        bank_name=bank_name,
        contact_email=contact_email,
        scenario_key=scenario_key,
    )
    files = {
        "tax_document": await _resolve_file_slot(tax_document, tax_preset_file),
        "bank_document": await _resolve_file_slot(bank_document, bank_preset_file),
        "compliance_document": await _resolve_file_slot(
            compliance_document, compliance_preset_file
        ),
    }
    return form, files


@app.post("/api/onboard")
async def onboard_vendor(
    legal_entity_name: str = Form(""),
    dba_trade_name: str = Form(""),
    entity_constitution: str = Form("Private Limited / Corp"),
    country_code: str = Form("IN"),
    billing_state: str = Form(""),
    tax_id: str = Form(""),
    secondary_tax_id: str = Form(""),
    bank_account_holder: str = Form(""),
    account_number: str = Form(""),
    account_type: str = Form("Current / Commercial"),
    routing_code: str = Form(""),
    bank_name: str = Form(""),
    contact_email: str = Form(""),
    scenario_key: Optional[str] = Form(None),
    tax_document: Optional[UploadFile] = File(None),
    bank_document: Optional[UploadFile] = File(None),
    compliance_document: Optional[UploadFile] = File(None),
    tax_preset_file: Optional[str] = Form(None),
    bank_preset_file: Optional[str] = Form(None),
    compliance_preset_file: Optional[str] = Form(None),
):
    form, files = await _parse_submission_packet(
        legal_entity_name,
        dba_trade_name,
        entity_constitution,
        country_code,
        billing_state,
        tax_id,
        secondary_tax_id,
        bank_account_holder,
        account_number,
        account_type,
        routing_code,
        bank_name,
        contact_email,
        scenario_key,
        tax_document,
        bank_document,
        compliance_document,
        tax_preset_file,
        bank_preset_file,
        compliance_preset_file,
    )
    events = execute_pipeline_events(form, files)
    final = next(ev["result"] for ev in events if ev["event"] == "complete")
    return final


@app.post("/api/onboard/stream")
async def onboard_vendor_stream(
    legal_entity_name: str = Form(""),
    dba_trade_name: str = Form(""),
    entity_constitution: str = Form("Private Limited / Corp"),
    country_code: str = Form("IN"),
    billing_state: str = Form(""),
    tax_id: str = Form(""),
    secondary_tax_id: str = Form(""),
    bank_account_holder: str = Form(""),
    account_number: str = Form(""),
    account_type: str = Form("Current / Commercial"),
    routing_code: str = Form(""),
    bank_name: str = Form(""),
    contact_email: str = Form(""),
    scenario_key: Optional[str] = Form(None),
    tax_document: Optional[UploadFile] = File(None),
    bank_document: Optional[UploadFile] = File(None),
    compliance_document: Optional[UploadFile] = File(None),
    tax_preset_file: Optional[str] = Form(None),
    bank_preset_file: Optional[str] = Form(None),
    compliance_preset_file: Optional[str] = Form(None),
):
    form, files = await _parse_submission_packet(
        legal_entity_name,
        dba_trade_name,
        entity_constitution,
        country_code,
        billing_state,
        tax_id,
        secondary_tax_id,
        bank_account_holder,
        account_number,
        account_type,
        routing_code,
        bank_name,
        contact_email,
        scenario_key,
        tax_document,
        bank_document,
        compliance_document,
        tax_preset_file,
        bank_preset_file,
        compliance_preset_file,
    )

    async def event_generator():
        async for ev in stream_pipeline_events(form, files):
            yield f"data: {json.dumps(ev)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/submissions")
def list_submissions(
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
):
    items = database.list_submissions(status=status, search=q)
    kpis = database.get_kpis()
    return {"submissions": items, "kpis": kpis}


@app.get("/api/submissions/{submission_id}")
def get_submission(submission_id: str):
    item = database.get_submission(submission_id)
    if not item:
        raise HTTPException(status_code=404, detail="Submission not found.")
    return item


@app.post("/api/submissions/{submission_id}/send-email")
def send_remediation_email(submission_id: str):
    updated = database.mark_email_dispatched(submission_id)
    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Submission not found or has no outbound remediation email.",
        )
    return {
        "status": "dispatched",
        "submission_id": submission_id,
        "dispatched_at": updated["outbound_email"]["dispatched_at"],
        "submission": updated,
    }


@app.get("/api/dashboard/kpis")
def dashboard_kpis():
    return database.get_kpis()


@app.delete("/api/submissions")
def reset_submissions():
    removed = database.clear_all_submissions()
    return {"deleted": removed}
