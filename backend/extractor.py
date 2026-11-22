from __future__ import annotations

import io
import os
import re
from typing import Optional

import pdfplumber
from dotenv import load_dotenv

from backend.schemas import (
    BankDocExtraction,
    ComplianceDocExtraction,
    DocumentClassificationResult,
    ForeignTaxPolicyResult,
    TaxDocExtraction,
)

# Load .env from project root if present
load_dotenv(override=True)

GEMINI_MODEL = "gemini-3.5-flash-lite"


def _get_gemini_client():
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        return None
    try:
        from google import genai
        from google.genai import types

        return genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=20_000),
        )
    except Exception:
        return None


def inspect_and_read_pdf(pdf_bytes: bytes) -> tuple[bool, int, str]:
    """Verify PDF readability and extract plain text via pdfplumber."""
    if not pdf_bytes or len(pdf_bytes) < 64:
        return False, 0, ""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)
            if page_count == 0:
                return False, 0, ""
            texts = []
            for page in pdf.pages:
                t = page.extract_text() or ""
                texts.append(t)
            combined = "\n".join(texts).strip()
            return True, page_count, combined
    except Exception:
        return False, 0, ""


def _call_gemini_pdf_schema(pdf_bytes: bytes, prompt: str, schema_cls):
    client = _get_gemini_client()
    if client is None:
        return None
    try:
        from google.genai import types

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema_cls,
                temperature=0.0,
            ),
        )
        if getattr(response, "parsed", None) is not None:
            return response.parsed
        if response.text:
            return schema_cls.model_validate_json(response.text)
    except Exception:
        return None
    return None


def _extract_field(text: str, labels: list[str]) -> Optional[str]:
    for label in labels:
        pattern = rf"(?im)^\s*{re.escape(label)}\s*[:\-]\s*(.+?)\s*$"
        m = re.search(pattern, text)
        if m:
            val = m.group(1).strip()
            if val and val.lower() not in {"n/a", "none", "-", "null"}:
                return val
    return None


def classify_document(
    pdf_bytes: bytes, text: str, filename: str
) -> tuple[DocumentClassificationResult, str]:
    """Stage 1: Classify uploaded PDF via Gemini 3.5 Flash-Lite or deterministic pdfplumber rules."""
    prompt = (
        "Classify this vendor onboarding PDF into exactly one of: "
        "TAX_REGISTRATION (e.g. GST REG-06, PAN, W-9, HMRC VAT, foreign tax registration), "
        "BANK_PROOF (e.g. Bank Verification Letter, cancelled cheque, bank account confirmation), "
        "COMPLIANCE_CERT (e.g. CA Turnover Certificate, MSME Udyam, Good Standing Certificate), "
        "or WRONG_DOCUMENT (e.g. commercial invoice, hosting bill, blank page, unrelated sheet). "
        "Return strict JSON matching the schema."
    )
    gemini_res = _call_gemini_pdf_schema(
        pdf_bytes, prompt, DocumentClassificationResult
    )
    if gemini_res is not None:
        return gemini_res, GEMINI_MODEL

    # Deterministic pdfplumber fallback
    upper = text.upper()
    if not upper or len(upper) < 25:
        return (
            DocumentClassificationResult(
                document_type="WRONG_DOCUMENT",
                confidence=0.95,
                detected_title="Blank or Unreadable Document",
                summary=f"Uploaded file '{filename}' contains no extractable compliance text.",
            ),
            "pdfplumber-deterministic",
        )

    # Check explicit invoice / wrong document markers FIRST
    if (
        "COMMERCIAL INVOICE" in upper
        or "COMMERCIAL_INVOICE" in upper
        or "NOT VALID AS BANK PROOF" in upper
        or ("INVOICE NUMBER" in upper and "TOTAL AMOUNT DUE" in upper)
    ):
        title = _extract_field(text, ["Document Title"]) or "Commercial Invoice"
        inv_match = re.search(r"INVOICE\s*#?([A-Z0-9\-]+)", upper)
        inv_ref = f" ({inv_match.group(1)})" if inv_match else ""
        return (
            DocumentClassificationResult(
                document_type="WRONG_DOCUMENT",
                confidence=0.98,
                detected_title=f"{title}{inv_ref}",
                summary=f"Detected commercial billing invoice{inv_ref} instead of an onboarding compliance proof.",
            ),
            "pdfplumber-deterministic",
        )

    cat_field = (_extract_field(text, ["Document Category"]) or "").upper()
    if cat_field in {"TAX_REGISTRATION", "BANK_PROOF", "COMPLIANCE_CERT"}:
        titles = {
            "TAX_REGISTRATION": "Tax Registration Certificate",
            "BANK_PROOF": "Bank Verification Letter",
            "COMPLIANCE_CERT": "Compliance / CA Certificate",
        }
        return (
            DocumentClassificationResult(
                document_type=cat_field,  # type: ignore[arg-type]
                confidence=0.97,
                detected_title=titles[cat_field],
                summary=f"Classified as {cat_field} via structured document header & field markers.",
            ),
            "pdfplumber-deterministic",
        )

    # General keyword scoring fallback for arbitrary user PDFs
    bank_hits = sum(
        1
        for kw in [
            "BANK ACCOUNT VERIFICATION",
            "BANK VERIFICATION LETTER",
            "ACCOUNT HOLDER NAME",
            "ACCOUNT NUMBER",
            "IFSC",
            "SORT CODE",
            "CANCELLED CHEQUE",
            "BUSINESS BANK ACCOUNT CONFIRMATION",
        ]
        if kw in upper
    )
    tax_hits = sum(
        1
        for kw in [
            "GST REG-06",
            "CERTIFICATE OF REGISTRATION",
            "PERMANENT ACCOUNT NUMBER",
            "VALUE ADDED TAX",
            "VAT REGISTRATION",
            "TAX REGISTRATION",
            "W-9",
            "EIN",
            "GSTIN",
        ]
        if kw in upper
    )
    comp_hits = sum(
        1
        for kw in [
            "TURNOVER CERTIFICATE",
            "CHARTERED ACCOUNTANT",
            "UDYAM",
            "GOOD STANDING",
            "COMPLIANCE CERTIFICATE",
            "ICAI",
        ]
        if kw in upper
    )

    best_score = max(bank_hits, tax_hits, comp_hits)
    if best_score < 2:
        return (
            DocumentClassificationResult(
                document_type="WRONG_DOCUMENT",
                confidence=0.85,
                detected_title="Unrecognized Document",
                summary="Document lacks recognizable tax registration, bank proof, or compliance certificate markers.",
            ),
            "pdfplumber-deterministic",
        )

    if comp_hits >= bank_hits and comp_hits >= tax_hits:
        return (
            DocumentClassificationResult(
                document_type="COMPLIANCE_CERT",
                confidence=0.93,
                detected_title="Compliance / CA Certificate",
                summary="Identified compliance / Chartered Accountant certification markers.",
            ),
            "pdfplumber-deterministic",
        )
    if bank_hits >= tax_hits:
        return (
            DocumentClassificationResult(
                document_type="BANK_PROOF",
                confidence=0.94,
                detected_title="Bank Verification Proof",
                summary="Identified bank account verification letter / beneficiary banking markers.",
            ),
            "pdfplumber-deterministic",
        )
    return (
        DocumentClassificationResult(
            document_type="TAX_REGISTRATION",
            confidence=0.94,
            detected_title="Tax Registration Document",
            summary="Identified tax authority registration certificate markers.",
        ),
        "pdfplumber-deterministic",
    )


def extract_tax_document(
    pdf_bytes: bytes, text: str
) -> tuple[TaxDocExtraction, str]:
    prompt = (
        "Extract structured fields from this tax registration document (GST REG-06, PAN, W-9, HMRC VAT, or foreign tax filing). "
        "Fields: extracted_legal_name, extracted_dba_name (Trading As / Trade Name if distinct), "
        "extracted_tax_id (primary tax ID like PAN, VAT, EIN, TRN, ABN), "
        "extracted_secondary_tax_id (e.g. 15-char Indian GSTIN if separate from PAN), "
        "extracted_state (state/region jurisdiction), registration_status (ACTIVE/SUSPENDED/EXPIRED/CANCELLED), "
        "and expiry_date (YYYY-MM-DD if shown). Return strict JSON."
    )
    gemini_res = _call_gemini_pdf_schema(pdf_bytes, prompt, TaxDocExtraction)
    if gemini_res is not None:
        return gemini_res, GEMINI_MODEL

    legal_name = _extract_field(
        text, ["Legal Name", "Entity Name", "Registered Legal Name", "Taxpayer Name"]
    )
    dba_name = _extract_field(
        text, ["Trading As / DBA", "Trade Name / DBA", "Trading As", "Trade Name", "DBA"]
    )
    primary_tax = _extract_field(
        text,
        [
            "Permanent Account Number (PAN)",
            "VAT Registration Number",
            "Tax Identification Number",
            "Employer Identification Number (EIN)",
            "Tax ID",
            "PAN",
            "VAT Number",
            "TRN",
            "ABN",
        ],
    )
    secondary_tax = _extract_field(
        text, ["GSTIN / Secondary Tax ID", "GSTIN", "Secondary Tax ID"]
    )
    state = _extract_field(
        text, ["State Jurisdiction", "Region / State", "State / Region", "State"]
    )
    status = _extract_field(text, ["Registration Status", "Status"]) or "ACTIVE"
    expiry = _extract_field(text, ["Expiry Date", "Valid Till", "Valid Until"])

    # Regex fallbacks for arbitrary uploaded PDFs
    if not secondary_tax:
        m = re.search(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b", text)
        if m:
            secondary_tax = m.group(1)
    if not primary_tax:
        for pat in [
            r"\b(GB\d{9})\b",
            r"\b(DE\d{9})\b",
            r"\b([A-Z]{5}[0-9]{4}[A-Z])\b",
            r"\b(\d{2}-\d{7})\b",
            r"\b(100\d{12})\b",
        ]:
            m = re.search(pat, text)
            if m:
                primary_tax = m.group(1)
                break

    if expiry:
        dm = re.search(r"(\d{4}-\d{2}-\d{2})", expiry)
        expiry = dm.group(1) if dm else expiry

    return (
        TaxDocExtraction(
            extracted_legal_name=legal_name,
            extracted_dba_name=dba_name,
            extracted_tax_id=primary_tax,
            extracted_secondary_tax_id=secondary_tax,
            extracted_state=state,
            registration_status=status.upper() if status else None,
            expiry_date=expiry,
        ),
        "pdfplumber-deterministic",
    )


def extract_bank_document(
    pdf_bytes: bytes, text: str
) -> tuple[BankDocExtraction, str]:
    prompt = (
        "Extract structured banking fields from this bank verification letter or cancelled cheque. "
        "Fields: extracted_account_holder, extracted_account_number, extracted_routing_code "
        "(IFSC / ABA / Sort Code / IBAN / SWIFT / BSB), extracted_account_type "
        "('Current / Commercial' or 'Savings / Personal'), and name_printed_on_proof (boolean). Return strict JSON."
    )
    gemini_res = _call_gemini_pdf_schema(pdf_bytes, prompt, BankDocExtraction)
    if gemini_res is not None:
        return gemini_res, GEMINI_MODEL

    holder = _extract_field(
        text,
        ["Account Holder Name", "Beneficiary Name", "Account Title", "Account Holder"],
    )
    acct_num = _extract_field(
        text, ["Account Number", "Bank Account Number", "Account No", "IBAN"]
    )
    routing = _extract_field(
        text,
        [
            "IFSC / Routing Code",
            "Sort Code / Routing Code",
            "Routing Code",
            "IFSC Code",
            "IFSC",
            "Sort Code",
            "ABA Routing",
            "SWIFT / BIC",
            "BSB",
        ],
    )
    acct_type = _extract_field(text, ["Account Type", "Type of Account"])
    printed_raw = _extract_field(
        text, ["Name Printed on Cheque/Proof", "Name Printed on Proof"]
    )

    if not routing:
        for pat in [
            r"\b([A-Z]{4}0[A-Z0-9]{6})\b",
            r"\b(\d{2}-\d{2}-\d{2})\b",
        ]:
            m = re.search(pat, text)
            if m:
                routing = m.group(1)
                break

    if acct_type:
        low = acct_type.lower()
        if "saving" in low or "personal" in low:
            acct_type = "Savings / Personal"
        elif "current" in low or "commercial" in low or "business" in low:
            acct_type = "Current / Commercial"

    name_printed = bool(holder)
    if printed_raw:
        name_printed = printed_raw.strip().lower() in {"yes", "true", "verified", "1"}

    return (
        BankDocExtraction(
            extracted_account_holder=holder,
            extracted_account_number=acct_num,
            extracted_routing_code=routing,
            extracted_account_type=acct_type,
            name_printed_on_proof=name_printed,
        ),
        "pdfplumber-deterministic",
    )


def extract_compliance_document(
    pdf_bytes: bytes, text: str
) -> tuple[ComplianceDocExtraction, str]:
    prompt = (
        "Extract structured fields from this vendor compliance certificate (CA Turnover, MSME Udyam, or Good Standing Certificate). "
        "Fields: cert_type, cert_expiry_date (YYYY-MM-DD), cert_entity_name, cert_status (ACTIVE/EXPIRED/SUSPENDED). Return strict JSON."
    )
    gemini_res = _call_gemini_pdf_schema(pdf_bytes, prompt, ComplianceDocExtraction)
    if gemini_res is not None:
        return gemini_res, GEMINI_MODEL

    cert_type = _extract_field(text, ["Certificate Type", "Document Title"]) or "Compliance Certificate"
    entity_name = _extract_field(text, ["Entity Name", "Legal Name", "Company Name"])
    expiry = _extract_field(text, ["Expiry Date", "Valid Till", "Valid Until"])
    status = _extract_field(text, ["Compliance Status", "Certificate Status", "Status"]) or "ACTIVE"

    if expiry:
        dm = re.search(r"(\d{4}-\d{2}-\d{2})", expiry)
        expiry = dm.group(1) if dm else expiry

    return (
        ComplianceDocExtraction(
            cert_type=cert_type,
            cert_expiry_date=expiry,
            cert_entity_name=entity_name,
            cert_status=status.upper() if status else None,
        ),
        "pdfplumber-deterministic",
    )


def evaluate_foreign_tax_policy(
    country_code: str, tax_id: str
) -> tuple[ForeignTaxPolicyResult, str]:
    """Policy evaluator for OTHER / unlisted cross-border jurisdictions (e.g., DE, FR, SG)."""
    raw_code = (country_code or "OTHER").strip().upper()
    name_to_iso = {
        "GERMANY": "DE",
        "DEUTSCHLAND": "DE",
        "FRANCE": "FR",
        "SINGAPORE": "SG",
        "NETHERLANDS": "NL",
        "HOLLAND": "NL",
        "CANADA": "CA",
    }
    code = name_to_iso.get(raw_code, raw_code)
    clean_tax = (tax_id or "").strip().upper()

    client = _get_gemini_client()
    if client is not None:
        try:
            from google.genai import types

            prompt = (
                f"You are a global tax compliance validator. Validate whether tax ID '{clean_tax}' "
                f"conforms to the official corporate tax/VAT registration ID format for jurisdiction '{code}'. "
                "For Germany (DE), the USt-IdNr VAT ID must match ^DE\\d{9}$ (DE followed by 9 digits). "
                "Flag if the submitted tax ID belongs to a different country's format (such as a US EIN XX-XXXXXXX). "
                "Return strict JSON."
            )
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=ForeignTaxPolicyResult,
                    temperature=0.0,
                ),
            )
            if getattr(response, "parsed", None) is not None:
                return response.parsed, f"{GEMINI_MODEL}-policy"
            if response.text:
                return (
                    ForeignTaxPolicyResult.model_validate_json(response.text),
                    f"{GEMINI_MODEL}-policy",
                )
        except Exception:
            pass

    # Deterministic fallback policy registry for common cross-border jurisdictions
    registry = {
        "DE": (
            r"^DE\d{9}$",
            "German VAT ID (USt-IdNr): 'DE' followed by 9 digits (e.g., DE123456789)",
        ),
        "FR": (
            r"^FR[A-HJ-NP-Z0-9]{2}\d{9}$",
            "French TVA Number: 'FR' + 2 characters + 9 digits",
        ),
        "SG": (
            r"^(\d{8,9}[A-Z]|[TS]\d{2}[A-Z]{2}\d{4}[A-Z])$",
            "Singapore UEN / GST ID (9–10 alphanumeric characters ending with a letter)",
        ),
        "NL": (
            r"^NL\d{9}B\d{2}$",
            "Dutch BTW VAT Number: 'NL' + 9 digits + 'B' + 2 digits",
        ),
        "CA": (
            r"^\d{9}(RT\d{4})?$",
            "Canadian Business Number (BN): 9 digits (optionally + RT0001)",
        ),
    }

    if code in registry:
        pattern, desc = registry[code]
        valid = bool(re.match(pattern, clean_tax))
        extra = ""
        if not valid and re.match(r"^\d{2}-\d{7}$", clean_tax):
            extra = (
                f" Submitted value '{clean_tax}' matches a US EIN (XX-XXXXXXX) format "
                f"rather than a {code} tax registration identifier."
            )
        reasoning = (
            f"Tax ID '{clean_tax}' matches {desc}."
            if valid
            else f"Tax ID '{clean_tax}' does not match {desc}.{extra}"
        )
        return (
            ForeignTaxPolicyResult(
                is_valid=valid,
                expected_format_description=desc,
                expected_regex=pattern,
                reasoning=reasoning,
            ),
            "deterministic-policy-fallback",
        )

    # Generic OTHER validation
    valid = bool(re.match(r"^[A-Z0-9\-]{6,20}$", clean_tax))
    return (
        ForeignTaxPolicyResult(
            is_valid=valid,
            expected_format_description="6–20 alphanumeric national tax/VAT identifier",
            expected_regex=r"^[A-Z0-9\-]{6,20}$",
            reasoning=(
                f"Tax ID '{clean_tax}' passes baseline cross-border format check for '{code}'."
                if valid
                else f"Tax ID '{clean_tax}' is missing or malformed for jurisdiction '{code}'."
            ),
        ),
        "deterministic-policy-fallback",
    )
