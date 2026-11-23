from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

from backend import database
from backend.extractor import evaluate_foreign_tax_policy
from backend.schemas import (
    ExtractedBundle,
    OutboundEmail,
    RuleCheckResult,
    UploadedDocInfo,
    VendorFormInput,
)

# Current compliance reference date (matches system date 2026-11-23)
REFERENCE_DATE = date(2026, 11, 23)

INDIAN_STATE_CODES: dict[str, str] = {
    "01": "Jammu and Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu",
    "27": "Maharashtra",
    "28": "Andhra Pradesh",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman and Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
}

STATE_NAME_TO_CODE: dict[str, str] = {
    name.lower(): code for code, name in INDIAN_STATE_CODES.items()
}
STATE_NAME_TO_CODE.update(
    {
        "new delhi": "07",
        "nct of delhi": "07",
        "mh": "27",
        "mp": "23",
        "ka": "29",
        "tn": "33",
        "gj": "24",
        "up": "09",
        "wb": "19",
        "dl": "07",
    }
)

PAN_CONSTITUTION_MAP: dict[str, tuple[str, str]] = {
    "Private Limited / Corp": ("C", "Company / Body Corporate"),
    "Proprietorship": ("P", "Individual / Sole Proprietor"),
    "LLP / Partnership": ("F", "Firm / LLP / Partnership"),
}

PAN_4TH_CHAR_LABELS: dict[str, str] = {
    "C": "Company (C)",
    "P": "Individual / Proprietor (P)",
    "F": "Firm / LLP / Partnership (F)",
    "H": "HUF (H)",
    "A": "Association of Persons (A)",
    "T": "Trust (T)",
    "B": "Body of Individuals (B)",
    "L": "Local Authority (L)",
    "G": "Government (G)",
}


def normalize_entity_name(name: Optional[str]) -> str:
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r"[.,&/()\-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    # Normalize corporate suffixes canonically
    replacements = [
        (r"\bprivate\s+limited\b", "pvt ltd"),
        (r"\bpvt\s+limited\b", "pvt ltd"),
        (r"\bprivate\s+ltd\b", "pvt ltd"),
        (r"\bp\s+ltd\b", "pvt ltd"),
        (r"\blimited\s+liability\s+partnership\b", "llp"),
        (r"\blimited\s+liability\s+company\b", "llc"),
        (r"\bincorporated\b", "inc"),
        (r"\bcorporation\b", "corp"),
        (r"\bcompany\b", "co"),
        (r"\blimited\b", "ltd"),
    ]
    for pat, repl in replacements:
        s = re.sub(pat, repl, s)
    return re.sub(r"\s+", " ", s).strip()


def _parse_iso_date(val: Optional[str]) -> Optional[date]:
    if not val:
        return None
    m = re.search(r"(\d{4}-\d{2}-\d{2})", val.strip())
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d").date()
    except ValueError:
        return None


def run_deterministic_rules(
    form: VendorFormInput,
    documents: list[UploadedDocInfo],
    extracted: ExtractedBundle,
) -> tuple[list[RuleCheckResult], list[str], str]:
    """
    Stage 3: Pure Python deterministic compliance & fraud engine
    (with Gemini / deterministic fallback ONLY for unlisted OTHER country tax formats).
    Returns: (rule_checks, audit_notes, engine_label)
    """
    checks: list[RuleCheckResult] = []
    audit_notes: list[str] = []
    engine_used = "deterministic-python-rules"

    docs_by_slot = {d.slot: d for d in documents}
    tax_info = docs_by_slot.get("tax_document")
    bank_info = docs_by_slot.get("bank_document")
    comp_info = docs_by_slot.get("compliance_document")

    tax_ext = extracted.tax_doc
    bank_ext = extracted.bank_doc
    comp_ext = extracted.compliance_doc

    # =========================================================================
    # RULE 1: COMPLETENESS & DOCUMENT TYPE VERIFICATION
    # =========================================================================
    required_fields = {
        "legal_entity_name": form.legal_entity_name,
        "entity_constitution": form.entity_constitution,
        "country_code": form.country_code,
        "billing_state": form.billing_state,
        "tax_id": form.tax_id,
        "bank_account_holder": form.bank_account_holder,
        "account_number": form.account_number,
        "account_type": form.account_type,
        "routing_code": form.routing_code,
        "contact_email": form.contact_email,
    }
    missing_fields = [k for k, v in required_fields.items() if not (v or "").strip()]
    if missing_fields:
        checks.append(
            RuleCheckResult(
                rule_id="R1_FORM_COMPLETENESS",
                rule_group="Rule 1 · Completeness & Document Type",
                rule_name="Mandatory Vendor Form Fields",
                status="FAIL",
                severity="OPERATIONAL",
                expected="All 10 mandatory vendor & banking fields populated",
                found=f"Missing: {', '.join(missing_fields)}",
                message=f"Required onboarding fields are incomplete: {', '.join(missing_fields)}.",
                remediation_hint=f"Complete the missing form fields: {', '.join(missing_fields)}.",
            )
        )
    else:
        checks.append(
            RuleCheckResult(
                rule_id="R1_FORM_COMPLETENESS",
                rule_group="Rule 1 · Completeness & Document Type",
                rule_name="Mandatory Vendor Form Fields",
                status="PASS",
                severity="INFO",
                expected="All 10 mandatory fields populated",
                found="10 / 10 fields populated",
                message="All mandatory structured vendor, tax, and banking fields are present.",
            )
        )

    # Check Tax Document presence & type
    if not tax_info or not tax_info.readable:
        checks.append(
            RuleCheckResult(
                rule_id="R1_TAX_DOC_TYPE",
                rule_group="Rule 1 · Completeness & Document Type",
                rule_name="Tax Registration Document Check",
                status="FAIL",
                severity="OPERATIONAL",
                expected="Readable PDF classified as TAX_REGISTRATION",
                found="Missing or unreadable file",
                message="Required Tax Registration PDF (GST REG-06 / PAN / W-9 / VAT Cert) is missing or unreadable.",
                remediation_hint="Upload a clear, readable official Tax Registration Certificate PDF.",
            )
        )
    elif tax_info.classification != "TAX_REGISTRATION":
        checks.append(
            RuleCheckResult(
                rule_id="R1_TAX_DOC_TYPE",
                rule_group="Rule 1 · Completeness & Document Type",
                rule_name="Tax Registration Document Check",
                status="FAIL",
                severity="OPERATIONAL",
                expected="TAX_REGISTRATION",
                found=f"{tax_info.classification} ({tax_info.detected_title or tax_info.filename})",
                message=f"Uploaded tax attachment '{tax_info.filename}' was classified as {tax_info.classification}, not a valid tax registration certificate.",
                remediation_hint="Replace the tax document attachment with an official Tax Registration Certificate.",
            )
        )
    else:
        checks.append(
            RuleCheckResult(
                rule_id="R1_TAX_DOC_TYPE",
                rule_group="Rule 1 · Completeness & Document Type",
                rule_name="Tax Registration Document Check",
                status="PASS",
                severity="INFO",
                expected="TAX_REGISTRATION",
                found=f"TAX_REGISTRATION ({tax_info.filename})",
                message=f"Verified readable Tax Registration document ({tax_info.page_count} page(s)).",
            )
        )

    # Check Bank Document presence & type
    bank_doc_valid_type = False
    if not bank_info or not bank_info.readable:
        checks.append(
            RuleCheckResult(
                rule_id="R1_BANK_DOC_TYPE",
                rule_group="Rule 1 · Completeness & Document Type",
                rule_name="Bank Proof Document Check",
                status="FAIL",
                severity="OPERATIONAL",
                expected="Readable PDF classified as BANK_PROOF",
                found="Missing or unreadable file",
                message="Required Bank Verification Letter / Cancelled Cheque PDF is missing or unreadable.",
                remediation_hint="Upload an official Bank Verification Letter on bank letterhead or a pre-printed cancelled cheque.",
            )
        )
    elif bank_info.classification != "BANK_PROOF":
        checks.append(
            RuleCheckResult(
                rule_id="R1_BANK_DOC_TYPE",
                rule_group="Rule 1 · Completeness & Document Type",
                rule_name="Bank Proof Document Check",
                status="FAIL",
                severity="OPERATIONAL",
                expected="BANK_PROOF (Bank Verification Letter / Cancelled Cheque)",
                found=f"{bank_info.classification} — {bank_info.detected_title or bank_info.filename}",
                message=(
                    f"Wrong document attached in Bank Proof slot: '{bank_info.filename}' "
                    f"is classified as {bank_info.classification} ({bank_info.detected_title or 'Unrecognized'}). "
                    f"{bank_info.summary}"
                ),
                remediation_hint=(
                    "Upload an official Bank Account Verification Letter on bank letterhead "
                    "(or cancelled cheque showing account holder name, account number, and routing code) "
                    "instead of an invoice or unrelated document."
                ),
            )
        )
    else:
        bank_doc_valid_type = True
        checks.append(
            RuleCheckResult(
                rule_id="R1_BANK_DOC_TYPE",
                rule_group="Rule 1 · Completeness & Document Type",
                rule_name="Bank Proof Document Check",
                status="PASS",
                severity="INFO",
                expected="BANK_PROOF",
                found=f"BANK_PROOF ({bank_info.filename})",
                message=f"Verified readable Bank Verification Proof ({bank_info.page_count} page(s)).",
            )
        )

    # Optional Compliance Document type check
    if comp_info:
        if not comp_info.readable or comp_info.classification != "COMPLIANCE_CERT":
            checks.append(
                RuleCheckResult(
                    rule_id="R1_COMPLIANCE_DOC_TYPE",
                    rule_group="Rule 1 · Completeness & Document Type",
                    rule_name="Optional Compliance Certificate Check",
                    status="FAIL",
                    severity="OPERATIONAL",
                    expected="COMPLIANCE_CERT",
                    found=f"{comp_info.classification} ({comp_info.filename})",
                    message=f"Attached compliance document '{comp_info.filename}' is not a valid Compliance / CA / MSME Certificate.",
                    remediation_hint="Upload a valid CA Turnover, MSME Udyam, or Good Standing Certificate.",
                )
            )
        else:
            checks.append(
                RuleCheckResult(
                    rule_id="R1_COMPLIANCE_DOC_TYPE",
                    rule_group="Rule 1 · Completeness & Document Type",
                    rule_name="Optional Compliance Certificate Check",
                    status="PASS",
                    severity="INFO",
                    expected="COMPLIANCE_CERT",
                    found=f"COMPLIANCE_CERT ({comp_info.filename})",
                    message=f"Verified optional compliance attachment '{comp_info.filename}'.",
                )
            )

    # =========================================================================
    # RULE 2: JURISDICTION TAX FORMAT & STATE ROUTING
    # =========================================================================
    country = (form.country_code or "").strip().upper()
    tax_id = (form.tax_id or "").strip().upper()
    sec_tax = (form.secondary_tax_id or "").strip().upper()
    routing = (form.routing_code or "").strip().upper()

    if country == "IN":
        # 2A. PAN regex + 4th character constitution rule
        pan_valid_regex = bool(re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", tax_id))
        if not pan_valid_regex:
            checks.append(
                RuleCheckResult(
                    rule_id="R2_IN_PAN_FORMAT",
                    rule_group="Rule 2 · Jurisdiction Tax & Routing",
                    rule_name="India PAN Format & Constitution Check",
                    status="FAIL",
                    severity="OPERATIONAL",
                    expected="10-char PAN (^[A-Z]{5}[0-9]{4}[A-Z]$)",
                    found=tax_id or "(empty)",
                    message=f"Indian PAN '{tax_id}' does not match standard 10-character alphanumeric PAN format.",
                    remediation_hint="Provide a valid 10-character Indian PAN matching your legal entity.",
                )
            )
        else:
            fourth_char = tax_id[3]
            expected_char, expected_label = PAN_CONSTITUTION_MAP.get(
                form.entity_constitution, ("C", "Company")
            )
            found_label = PAN_4TH_CHAR_LABELS.get(fourth_char, f"Unknown ({fourth_char})")
            if fourth_char != expected_char:
                is_corp_using_individual = (
                    form.entity_constitution == "Private Limited / Corp"
                    and fourth_char == "P"
                )
                checks.append(
                    RuleCheckResult(
                        rule_id="R2_IN_PAN_CONSTITUTION",
                        rule_group="Rule 2 · Jurisdiction Tax & Routing",
                        rule_name="India PAN 4th-Character Constitution Rule",
                        status="FAIL",
                        severity="CRITICAL" if is_corp_using_individual else "OPERATIONAL",
                        expected=f"4th Char '{expected_char}' ({expected_label}) for {form.entity_constitution}",
                        found=f"4th Char '{fourth_char}' ({found_label}) in PAN {tax_id}",
                        message=(
                            f"PAN constitution mismatch: '{form.legal_entity_name}' is registered as "
                            f"'{form.entity_constitution}' (requires 4th char '{expected_char}'), "
                            f"but submitted PAN '{tax_id}' has 4th char '{fourth_char}' ({found_label})."
                        ),
                        remediation_hint=(
                            f"Submit the corporate PAN (4th character '{expected_char}') registered in the name of "
                            f"'{form.legal_entity_name}' rather than an individual/proprietor PAN."
                        ),
                    )
                )
            else:
                checks.append(
                    RuleCheckResult(
                        rule_id="R2_IN_PAN_CONSTITUTION",
                        rule_group="Rule 2 · Jurisdiction Tax & Routing",
                        rule_name="India PAN Format & 4th-Character Constitution",
                        status="PASS",
                        severity="INFO",
                        expected=f"Valid PAN regex + 4th Char '{expected_char}' ({expected_label})",
                        found=f"{tax_id} (4th Char '{fourth_char}')",
                        message=f"PAN '{tax_id}' passes format validation and matches '{form.entity_constitution}' ('{expected_char}').",
                    )
                )

        # 2B. GSTIN format, embedded PAN, and 2-digit State Prefix routing
        if sec_tax:
            gstin_regex_ok = bool(
                re.match(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$", sec_tax)
            )
            if not gstin_regex_ok:
                checks.append(
                    RuleCheckResult(
                        rule_id="R2_IN_GSTIN_FORMAT",
                        rule_group="Rule 2 · Jurisdiction Tax & Routing",
                        rule_name="India 15-Char GSTIN Format Check",
                        status="FAIL",
                        severity="OPERATIONAL",
                        expected="15-char GSTIN (^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$)",
                        found=sec_tax,
                        message=f"Submitted GSTIN '{sec_tax}' is not a valid 15-character Indian GSTIN.",
                        remediation_hint="Provide a valid 15-character GSTIN matching your billing state and PAN.",
                    )
                )
            else:
                embedded_pan = sec_tax[2:12]
                if embedded_pan != tax_id:
                    checks.append(
                        RuleCheckResult(
                            rule_id="R2_IN_GSTIN_PAN_LINK",
                            rule_group="Rule 2 · Jurisdiction Tax & Routing",
                            rule_name="GSTIN Embedded PAN Consistency",
                            status="FAIL",
                            severity="CRITICAL",
                            expected=f"Embedded PAN = {tax_id}",
                            found=f"Embedded PAN = {embedded_pan} (from {sec_tax})",
                            message=f"GSTIN '{sec_tax}' embeds PAN '{embedded_pan}', which does not match submitted PAN '{tax_id}'.",
                            remediation_hint="Ensure the GSTIN belongs to the same legal entity PAN submitted on the form.",
                        )
                    )
                else:
                    checks.append(
                        RuleCheckResult(
                            rule_id="R2_IN_GSTIN_PAN_LINK",
                            rule_group="Rule 2 · Jurisdiction Tax & Routing",
                            rule_name="GSTIN Format & Embedded PAN Link",
                            status="PASS",
                            severity="INFO",
                            expected=f"15-char GSTIN embedding PAN {tax_id}",
                            found=f"{sec_tax} (embedded PAN {embedded_pan})",
                            message=f"GSTIN '{sec_tax}' is structurally valid and embeds PAN '{embedded_pan}'.",
                        )
                    )

                # State prefix check
                gst_state_code = sec_tax[:2]
                gst_state_name = INDIAN_STATE_CODES.get(gst_state_code, "Unknown State")
                expected_state_code = STATE_NAME_TO_CODE.get(
                    (form.billing_state or "").strip().lower()
                )
                if expected_state_code and gst_state_code != expected_state_code:
                    checks.append(
                        RuleCheckResult(
                            rule_id="R2_IN_GSTIN_STATE",
                            rule_group="Rule 2 · Jurisdiction Tax & Routing",
                            rule_name="GSTIN 2-Digit State Jurisdiction Routing",
                            status="FAIL",
                            severity="OPERATIONAL",
                            expected=f"State Prefix {expected_state_code} ({form.billing_state})",
                            found=f"State Prefix {gst_state_code} ({gst_state_name})",
                            message=(
                                f"Billing state mismatch: Vendor selected billing state '{form.billing_state}' "
                                f"(State Code {expected_state_code}), but submitted GSTIN '{sec_tax}' registered in "
                                f"'{gst_state_name}' (State Code {gst_state_code})."
                            ),
                            remediation_hint=(
                                f"Submit a valid {form.billing_state} (State Code {expected_state_code}) GST REG-06 "
                                f"Certificate, or update your billing state to {gst_state_name} if billing from that branch."
                            ),
                        )
                    )
                else:
                    checks.append(
                        RuleCheckResult(
                            rule_id="R2_IN_GSTIN_STATE",
                            rule_group="Rule 2 · Jurisdiction Tax & Routing",
                            rule_name="GSTIN 2-Digit State Jurisdiction Routing",
                            status="PASS",
                            severity="INFO",
                            expected=f"State Prefix {expected_state_code or gst_state_code} ({form.billing_state})",
                            found=f"State Prefix {gst_state_code} ({gst_state_name})",
                            message=f"GSTIN state code '{gst_state_code}' ({gst_state_name}) matches billing state '{form.billing_state}'.",
                        )
                    )

        # 2C. Indian IFSC validation
        if re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", routing):
            checks.append(
                RuleCheckResult(
                    rule_id="R2_IN_IFSC",
                    rule_group="Rule 2 · Jurisdiction Tax & Routing",
                    rule_name="India IFSC Routing Code Validation",
                    status="PASS",
                    severity="INFO",
                    expected="11-char IFSC (^[A-Z]{4}0[A-Z0-9]{6}$)",
                    found=routing,
                    message=f"IFSC code '{routing}' matches RBI NEFT/RTGS format.",
                )
            )
        else:
            checks.append(
                RuleCheckResult(
                    rule_id="R2_IN_IFSC",
                    rule_group="Rule 2 · Jurisdiction Tax & Routing",
                    rule_name="India IFSC Routing Code Validation",
                    status="FAIL",
                    severity="OPERATIONAL",
                    expected="11-char IFSC (^[A-Z]{4}0[A-Z0-9]{6}$)",
                    found=routing or "(empty)",
                    message=f"IFSC code '{routing}' is invalid (must be 4 letters + '0' + 6 alphanumeric characters).",
                    remediation_hint="Provide a valid 11-character Indian IFSC code matching your bank branch.",
                )
            )

    elif country == "US":
        ein_ok = bool(re.match(r"^\d{2}-\d{7}$", tax_id))
        checks.append(
            RuleCheckResult(
                rule_id="R2_US_EIN",
                rule_group="Rule 2 · Jurisdiction Tax & Routing",
                rule_name="US EIN Format Validation",
                status="PASS" if ein_ok else "FAIL",
                severity="INFO" if ein_ok else "OPERATIONAL",
                expected="US EIN (^\\d{2}-\\d{7}$)",
                found=tax_id or "(empty)",
                message=(
                    f"US EIN '{tax_id}' is validly formatted."
                    if ein_ok
                    else f"Tax ID '{tax_id}' does not match US EIN format (XX-XXXXXXX)."
                ),
                remediation_hint=None
                if ein_ok
                else "Provide a valid 9-digit US EIN in XX-XXXXXXX format (matching your W-9).",
            )
        )
        aba_ok = bool(re.match(r"^\d{9}$", routing))
        checks.append(
            RuleCheckResult(
                rule_id="R2_US_ABA",
                rule_group="Rule 2 · Jurisdiction Tax & Routing",
                rule_name="US 9-Digit ABA Routing Validation",
                status="PASS" if aba_ok else "FAIL",
                severity="INFO" if aba_ok else "OPERATIONAL",
                expected="9-digit ABA Routing (^\\d{9}$)",
                found=routing or "(empty)",
                message=(
                    f"ABA routing number '{routing}' is valid."
                    if aba_ok
                    else f"Routing code '{routing}' is not a valid 9-digit US ABA routing number."
                ),
                remediation_hint=None
                if aba_ok
                else "Provide a valid 9-digit US ABA bank routing number.",
            )
        )

    elif country == "UK":
        vat_ok = bool(re.match(r"^GB\d{9}$", tax_id))
        checks.append(
            RuleCheckResult(
                rule_id="R2_UK_VAT",
                rule_group="Rule 2 · Jurisdiction Tax & Routing",
                rule_name="UK HMRC VAT Format Validation",
                status="PASS" if vat_ok else "FAIL",
                severity="INFO" if vat_ok else "OPERATIONAL",
                expected="UK VAT (^GB\\d{9}$)",
                found=tax_id or "(empty)",
                message=(
                    f"UK VAT Number '{tax_id}' conforms to HMRC GB + 9-digit structure."
                    if vat_ok
                    else f"Tax ID '{tax_id}' does not match UK VAT format (GB followed by 9 digits)."
                ),
                remediation_hint=None
                if vat_ok
                else "Provide a valid UK VAT registration number (GB followed by 9 digits).",
            )
        )
        sort_ok = bool(re.match(r"^\d{2}-\d{2}-\d{2}$", routing))
        checks.append(
            RuleCheckResult(
                rule_id="R2_UK_SORT_CODE",
                rule_group="Rule 2 · Jurisdiction Tax & Routing",
                rule_name="UK Bank Sort Code Validation",
                status="PASS" if sort_ok else "FAIL",
                severity="INFO" if sort_ok else "OPERATIONAL",
                expected="UK Sort Code (^\\d{2}-\\d{2}-\\d{2}$)",
                found=routing or "(empty)",
                message=(
                    f"UK Sort Code '{routing}' is validly formatted."
                    if sort_ok
                    else f"Routing code '{routing}' does not match UK Sort Code format (XX-XX-XX)."
                ),
                remediation_hint=None
                if sort_ok
                else "Provide a valid 6-digit UK Bank Sort Code formatted as XX-XX-XX.",
            )
        )

    elif country == "AE":
        trn_ok = bool(re.match(r"^100\d{12}$", tax_id))
        checks.append(
            RuleCheckResult(
                rule_id="R2_AE_TRN",
                rule_group="Rule 2 · Jurisdiction Tax & Routing",
                rule_name="UAE TRN Format Validation",
                status="PASS" if trn_ok else "FAIL",
                severity="INFO" if trn_ok else "OPERATIONAL",
                expected="UAE 15-digit TRN (^100\\d{12}$)",
                found=tax_id or "(empty)",
                message=(
                    f"UAE Tax Registration Number '{tax_id}' is valid."
                    if trn_ok
                    else f"Tax ID '{tax_id}' does not match UAE 15-digit TRN starting with 100."
                ),
                remediation_hint=None
                if trn_ok
                else "Provide a valid 15-digit UAE Federal Tax Authority TRN starting with 100.",
            )
        )

    elif country == "AU":
        abn_ok = bool(re.match(r"^\d{11}$", tax_id))
        checks.append(
            RuleCheckResult(
                rule_id="R2_AU_ABN",
                rule_group="Rule 2 · Jurisdiction Tax & Routing",
                rule_name="Australia ABN Format Validation",
                status="PASS" if abn_ok else "FAIL",
                severity="INFO" if abn_ok else "OPERATIONAL",
                expected="11-digit ABN (^\\d{11}$)",
                found=tax_id or "(empty)",
                message=(
                    f"Australian Business Number '{tax_id}' is valid."
                    if abn_ok
                    else f"Tax ID '{tax_id}' does not match 11-digit Australian ABN format."
                ),
                remediation_hint=None
                if abn_ok
                else "Provide a valid 11-digit Australian Business Number (ABN).",
            )
        )

    else:
        # OTHER / Cross-border jurisdiction (e.g., DE Germany) -> Gemini LLM Policy Evaluator fallback
        policy_res, policy_engine = evaluate_foreign_tax_policy(country, tax_id)
        engine_used = f"deterministic-python + {policy_engine}"
        checks.append(
            RuleCheckResult(
                rule_id="R2_CROSS_BORDER_POLICY",
                rule_group="Rule 2 · Jurisdiction Tax & Routing",
                rule_name=f"Cross-Border Tax ID Policy ({country})",
                status="PASS" if policy_res.is_valid else "FAIL",
                severity="INFO" if policy_res.is_valid else "OPERATIONAL",
                expected=policy_res.expected_format_description,
                found=f"{tax_id or '(empty)'} (Jurisdiction: {country})",
                message=policy_res.reasoning,
                remediation_hint=None
                if policy_res.is_valid
                else (
                    f"Provide a valid {country} tax registration ID matching: "
                    f"{policy_res.expected_format_description}, along with the corresponding official tax certificate."
                ),
            )
        )

    # 2D. Form Tax ID vs Extracted Tax Document Cross-Check
    if tax_ext and tax_info and tax_info.classification == "TAX_REGISTRATION":
        doc_tax = (tax_ext.extracted_tax_id or "").strip().upper()
        doc_sec = (tax_ext.extracted_secondary_tax_id or "").strip().upper()

        primary_match = bool(doc_tax) and (doc_tax == tax_id)
        secondary_match = (not sec_tax) or (not doc_sec) or (doc_sec == sec_tax)

        sec_label = "GSTIN" if country == "IN" else "State/Indirect Tax ID"
        if primary_match and secondary_match:
            checks.append(
                RuleCheckResult(
                    rule_id="R2_TAX_DOC_CROSSMATCH",
                    rule_group="Rule 2 · Jurisdiction Tax & Routing",
                    rule_name="Form vs. Tax Certificate ID Cross-Match",
                    status="PASS",
                    severity="INFO",
                    expected=f"Form Tax ID: {tax_id}" + (f" | {sec_label}: {sec_tax}" if sec_tax else ""),
                    found=f"Doc Tax ID: {doc_tax}" + (f" | {sec_label}: {doc_sec}" if doc_sec else ""),
                    message="Tax identifier(s) extracted from the uploaded certificate exactly match the submission form.",
                )
            )
        else:
            checks.append(
                RuleCheckResult(
                    rule_id="R2_TAX_DOC_CROSSMATCH",
                    rule_group="Rule 2 · Jurisdiction Tax & Routing",
                    rule_name="Form vs. Tax Certificate ID Cross-Match",
                    status="FAIL",
                    severity="OPERATIONAL",
                    expected=f"Form Tax ID: {tax_id}" + (f" | {sec_label}: {sec_tax}" if sec_tax else ""),
                    found=f"Doc Tax ID: {doc_tax or '(not found)'}"
                    + (f" | {sec_label}: {doc_sec}" if doc_sec else ""),
                    message="Tax ID on the submission form does not match the Tax ID extracted from the attached Tax Certificate.",
                    remediation_hint="Verify that the Tax ID entered on the form exactly matches your attached official Tax Registration Certificate.",
                )
            )

    # =========================================================================
    # RULE 3: ENTITY & BANK BENEFICIARY CROSS-MATCH (FRAUD PREVENTION)
    # =========================================================================
    form_legal_norm = normalize_entity_name(form.legal_entity_name)
    form_dba_norm = normalize_entity_name(form.dba_trade_name)
    tax_legal_norm = normalize_entity_name(tax_ext.extracted_legal_name if tax_ext else "")
    tax_dba_norm = normalize_entity_name(tax_ext.extracted_dba_name if tax_ext else "")

    # Build authoritative entity identity set grounded in the official Tax Certificate
    authorized_names_norm: set[str] = {n for n in [form_legal_norm] if n}
    dba_bridge_verified = False
    dba_bridge_detail = ""

    if tax_ext and tax_info and tax_info.classification == "TAX_REGISTRATION":
        # Check if Tax Certificate officially links Legal Name <-> Trading As / DBA Name
        if tax_legal_norm and tax_dba_norm and tax_legal_norm != tax_dba_norm:
            if form_legal_norm in {tax_legal_norm, tax_dba_norm} or (
                form_dba_norm and form_dba_norm in {tax_legal_norm, tax_dba_norm}
            ):
                authorized_names_norm.add(tax_legal_norm)
                authorized_names_norm.add(tax_dba_norm)
                dba_bridge_verified = True
                dba_bridge_detail = (
                    f"'{tax_ext.extracted_legal_name}' trading as '{tax_ext.extracted_dba_name}'"
                )
        elif tax_legal_norm and tax_legal_norm == form_legal_norm:
            authorized_names_norm.add(tax_legal_norm)
            if tax_dba_norm:
                authorized_names_norm.add(tax_dba_norm)

    if bank_doc_valid_type and bank_ext:
        doc_holder = bank_ext.extracted_account_holder or ""
        doc_holder_norm = normalize_entity_name(doc_holder)

        if doc_holder_norm and doc_holder_norm == form_legal_norm:
            suffix_note = (
                " (normalized corporate suffix match)"
                if doc_holder.strip().lower() != form.legal_entity_name.strip().lower()
                else ""
            )
            checks.append(
                RuleCheckResult(
                    rule_id="R3_BENEFICIARY_MATCH",
                    rule_group="Rule 3 · Entity & Bank Fraud Controls",
                    rule_name="Bank Beneficiary vs. Legal Entity Cross-Match",
                    status="PASS",
                    severity="INFO",
                    expected=form.legal_entity_name,
                    found=doc_holder,
                    message=f"Bank proof beneficiary '{doc_holder}' matches legal entity '{form.legal_entity_name}'{suffix_note}.",
                )
            )
        elif doc_holder_norm and doc_holder_norm in authorized_names_norm and dba_bridge_verified:
            checks.append(
                RuleCheckResult(
                    rule_id="R3_BENEFICIARY_MATCH",
                    rule_group="Rule 3 · Entity & Bank Fraud Controls",
                    rule_name="Bank Beneficiary vs. Verified DBA / Legal Entity",
                    status="PASS",
                    severity="INFO",
                    expected=f"{form.legal_entity_name} (or officially linked legal parent on Tax Cert)",
                    found=f"{doc_holder} (Verified via Tax Cert DBA linkage)",
                    message=(
                        f"Bank beneficiary '{doc_holder}' resolved via official DBA / Trade Name linkage on "
                        f"Tax Certificate: {dba_bridge_detail}."
                    ),
                )
            )
            audit_notes.append(
                f"DBA Entity Resolution: Approved via verified official Trade Name linkage on Tax Certificate "
                f"({dba_bridge_detail}). Bank beneficiary '{doc_holder}' confirmed."
            )
        else:
            checks.append(
                RuleCheckResult(
                    rule_id="R3_CRITICAL_FRAUD_MISMATCH",
                    rule_group="Rule 3 · Entity & Bank Fraud Controls",
                    rule_name="Bank Beneficiary Anti-Diversion Check",
                    status="FAIL",
                    severity="CRITICAL",
                    expected=f"{form.legal_entity_name}"
                    + (f" / DBA: {form.dba_trade_name}" if form.dba_trade_name else ""),
                    found=doc_holder or "(No account holder name found on bank proof)",
                    message=(
                        f"CRITICAL_FRAUD_MISMATCH: Bank verification letter names beneficiary "
                        f"'{doc_holder or 'UNKNOWN'}', which does not match applicant '{form.legal_entity_name}' "
                        f"nor any verified DBA/Trade Name on the official Tax Certificate."
                    ),
                    remediation_hint=(
                        "Third-party bank beneficiary accounts are strictly prohibited. "
                        "Provide a bank verification letter held directly by the registered legal entity "
                        "or escalate to Vendor Risk & Compliance for manual ownership review."
                    ),
                )
            )

        # Bank Account Number & Routing Code cross-match (Form vs Bank Proof)
        # Only runs when a valid Bank Proof was uploaded and extracted account/routing is non-empty
        form_acct_norm = database.normalize_account_number(form.account_number)
        doc_acct_norm = database.normalize_account_number(
            bank_ext.extracted_account_number or ""
        )
        form_routing_norm = database.normalize_account_number(routing)
        doc_routing_norm = database.normalize_account_number(
            bank_ext.extracted_routing_code or ""
        )

        if doc_acct_norm or doc_routing_norm:
            acct_matches = (not doc_acct_norm) or (doc_acct_norm == form_acct_norm)
            routing_matches = (not doc_routing_norm) or (
                doc_routing_norm == form_routing_norm
            )

            if acct_matches and routing_matches:
                checks.append(
                    RuleCheckResult(
                        rule_id="R3_BANK_COORDS_MATCH",
                        rule_group="Rule 3 · Entity & Bank Fraud Controls",
                        rule_name="Form vs. Bank Letter Account Coordinates",
                        status="PASS",
                        severity="INFO",
                        expected=f"Acct: {form.account_number} | Routing: {routing}",
                        found=f"Acct: {bank_ext.extracted_account_number or form.account_number} | Routing: {bank_ext.extracted_routing_code or routing}",
                        message="Account number and routing code on the Bank Verification Letter match the form.",
                    )
                )
            else:
                checks.append(
                    RuleCheckResult(
                        rule_id="R3_BANK_COORDS_MATCH",
                        rule_group="Rule 3 · Entity & Bank Fraud Controls",
                        rule_name="Form vs. Bank Letter Account Coordinates",
                        status="FAIL",
                        severity="OPERATIONAL",
                        expected=f"Acct: {form.account_number} | Routing: {routing}",
                        found=f"Acct: {bank_ext.extracted_account_number or '(missing)'} | Routing: {bank_ext.extracted_routing_code or '(missing)'}",
                        message="The bank account number or routing code entered on the form doesn't match the uploaded bank document.",
                        remediation_hint="Re-verify your bank account number and routing code against the attached bank verification letter.",
                    )
                )
    else:
        checks.append(
            RuleCheckResult(
                rule_id="R3_BENEFICIARY_MATCH",
                rule_group="Rule 3 · Entity & Bank Fraud Controls",
                rule_name="Bank Beneficiary Cross-Match",
                status="WARN",
                severity="OPERATIONAL",
                expected=f"Verified bank proof matching {form.legal_entity_name}",
                found="Deferred — awaiting valid BANK_PROOF attachment",
                message="Bank beneficiary cross-match could not complete because a valid Bank Proof PDF was not attached.",
            )
        )

    # Corporate Account Type Rule (Current / Commercial required for Corp & LLP)
    if form.entity_constitution in {"Private Limited / Corp", "LLP / Partnership"}:
        effective_acct_type = (
            (bank_ext.extracted_account_type if (bank_doc_valid_type and bank_ext and bank_ext.extracted_account_type) else None)
            or form.account_type
        )
        is_commercial = "current" in effective_acct_type.lower() or "commercial" in effective_acct_type.lower()
        checks.append(
            RuleCheckResult(
                rule_id="R3_CORP_ACCOUNT_TYPE",
                rule_group="Rule 3 · Entity & Bank Fraud Controls",
                rule_name="Corporate Account Type Policy",
                status="PASS" if is_commercial else "FAIL",
                severity="INFO" if is_commercial else "OPERATIONAL",
                expected="Current / Commercial (mandatory for Corporate / LLP entities)",
                found=effective_acct_type,
                message=(
                    f"Account type '{effective_acct_type}' satisfies corporate banking policy."
                    if is_commercial
                    else f"Corporate entity '{form.entity_constitution}' submitted a '{effective_acct_type}' account; a Current / Commercial account is required."
                ),
                remediation_hint=None
                if is_commercial
                else "Provide a Current / Commercial corporate bank account rather than a Savings / Personal account.",
            )
        )

    # =========================================================================
    # RULE 4: DOCUMENT VALIDITY & EXPIRY (Ref Date: 2026-11-23)
    # =========================================================================
    validity_issues: list[str] = []
    validity_found_parts: list[str] = []

    if tax_ext and tax_info and tax_info.classification == "TAX_REGISTRATION":
        t_status = (tax_ext.registration_status or "ACTIVE").upper()
        t_exp = _parse_iso_date(tax_ext.expiry_date)
        validity_found_parts.append(
            f"Tax Cert: {t_status}" + (f" (exp {tax_ext.expiry_date})" if tax_ext.expiry_date else "")
        )
        if t_status in {"SUSPENDED", "EXPIRED", "CANCELLED", "INACTIVE"}:
            validity_issues.append(f"Tax registration status is '{t_status}'")
        if t_exp and t_exp < REFERENCE_DATE:
            validity_issues.append(
                f"Tax registration expired on {t_exp.isoformat()} (prior to {REFERENCE_DATE.isoformat()})"
            )

    if comp_ext and comp_info and comp_info.classification == "COMPLIANCE_CERT":
        c_status = (comp_ext.cert_status or "ACTIVE").upper()
        c_exp = _parse_iso_date(comp_ext.cert_expiry_date)
        c_label = comp_ext.cert_type or "Compliance Certificate"
        validity_found_parts.append(
            f"{c_label}: {c_status}"
            + (f" (exp {comp_ext.cert_expiry_date})" if comp_ext.cert_expiry_date else "")
        )
        if c_status in {"SUSPENDED", "EXPIRED", "CANCELLED", "REVOKED"}:
            validity_issues.append(f"{c_label} status is '{c_status}'")
        if c_exp and c_exp < REFERENCE_DATE:
            validity_issues.append(
                f"{c_label} expired on {c_exp.isoformat()} (current audit date: {REFERENCE_DATE.isoformat()})"
            )

    if validity_issues:
        checks.append(
            RuleCheckResult(
                rule_id="R4_DOCUMENT_VALIDITY",
                rule_group="Rule 4 · Document Validity & Expiry",
                rule_name="Registration & Certificate Expiry Check",
                status="FAIL",
                severity="OPERATIONAL",
                expected=f"Status ACTIVE and expiry date >= {REFERENCE_DATE.isoformat()}",
                found=" | ".join(validity_found_parts) or "Expired / Inactive",
                message="; ".join(validity_issues) + ".",
                remediation_hint=(
                    "Upload a renewed, currently valid certificate (e.g., renewed FY 2026-27 CA Turnover / "
                    f"Compliance Certificate or active Tax Registration valid beyond {REFERENCE_DATE.isoformat()})."
                ),
            )
        )
    else:
        checks.append(
            RuleCheckResult(
                rule_id="R4_DOCUMENT_VALIDITY",
                rule_group="Rule 4 · Document Validity & Expiry",
                rule_name="Registration & Certificate Expiry Check",
                status="PASS",
                severity="INFO",
                expected=f"Status ACTIVE and expiry date >= {REFERENCE_DATE.isoformat()}",
                found=" | ".join(validity_found_parts) or "All attached certificates active",
                message=f"All submitted tax and compliance documents are ACTIVE and valid as of {REFERENCE_DATE.isoformat()}.",
            )
        )

    # =========================================================================
    # RULE 5: DUPLICATE VENDOR & BANK ACCOUNT CHECKS (SQLite)
    # =========================================================================
    dup = database.find_duplicate_bank_account(
        form.account_number, authorized_names_norm
    )
    if dup:
        checks.append(
            RuleCheckResult(
                rule_id="R5_DUPLICATE_BANK_ACCOUNT",
                rule_group="Rule 5 · Duplicate Account Detection",
                rule_name="Cross-Vendor Bank Account Uniqueness",
                status="FAIL",
                severity="CRITICAL",
                expected="Bank account unique to this vendor entity",
                found=f"Already linked to '{dup['legal_entity_name']}' (Run {dup['submission_id']})",
                message=(
                    f"CRITICAL DUPLICATE ACCOUNT: Account '{form.account_number}' is already registered "
                    f"in Vendorcheck audit history under a different vendor ('{dup['legal_entity_name']}')."
                ),
                remediation_hint=(
                    "Bank accounts cannot be shared across unrelated legal entities. "
                    "Submit a unique corporate bank account held solely by your entity."
                ),
            )
        )
    else:
        checks.append(
            RuleCheckResult(
                rule_id="R5_DUPLICATE_BANK_ACCOUNT",
                rule_group="Rule 5 · Duplicate Account Detection",
                rule_name="Cross-Vendor Bank Account Uniqueness",
                status="PASS",
                severity="INFO",
                expected="No conflicting vendor owns this account number",
                found=f"Unique ({form.account_number or 'N/A'})",
                message="SQLite audit check confirmed no unrelated vendor is registered with this bank account number.",
            )
        )

    # Duplicate Vendor by Tax ID / GSTIN check (under a DIFFERENT normalized legal entity)
    dup_tax = database.find_duplicate_tax_id(
        form.tax_id, form.secondary_tax_id or "", authorized_names_norm
    )
    if dup_tax:
        checks.append(
            RuleCheckResult(
                rule_id="R5_DUPLICATE_TAX_ID",
                rule_group="Rule 5 · Duplicate Account Detection",
                rule_name="Duplicate Vendor by Tax ID",
                status="FAIL",
                severity="OPERATIONAL",
                expected="Tax ID unique to this vendor entity",
                found=f"Already registered under '{dup_tax['legal_entity_name']}'",
                message="This Tax ID is already registered under another vendor in the system.",
                remediation_hint="Confirm your official Tax ID / GSTIN or let us know if this submission belongs to an existing registered vendor.",
            )
        )

    # Non-blocking Warning: Corporate vendor using a free personal email domain
    free_email_domains = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com"}
    corp_name_re = re.compile(
        r"\b(?:pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|gmbh|inc\.?|llp)\b",
        re.IGNORECASE,
    )
    email_str = (form.contact_email or "").strip().lower()
    email_domain = email_str.rsplit("@", 1)[1] if "@" in email_str else ""
    if corp_name_re.search(form.legal_entity_name or "") and email_domain in free_email_domains:
        checks.append(
            RuleCheckResult(
                rule_id="R3_CORP_FREE_EMAIL",
                rule_group="Rule 3 · Entity & Bank Fraud Controls",
                rule_name="Corporate Email Domain Advisory",
                status="WARN",
                severity="OPERATIONAL",
                expected="Official corporate email domain",
                found=form.contact_email.strip(),
                message=(
                    f"Corporate vendor '{form.legal_entity_name}' submitted a free email address "
                    f"({email_domain}) instead of a company email domain."
                ),
            )
        )

    return checks, audit_notes, engine_used


def _format_plain_email_bullet(
    c: RuleCheckResult, form: VendorFormInput
) -> str:
    """Map a failed deterministic RuleCheckResult into a crisp 1-2 sentence human bullet."""
    rid = c.rule_id
    entity = form.legal_entity_name or "your company"
    tax_id = (form.tax_id or "").strip().upper()
    sec_tax = (form.secondary_tax_id or "").strip().upper()
    routing = (form.routing_code or "").strip().upper()
    country = (form.country_code or "").strip().upper()

    if rid == "R1_FORM_COMPLETENESS":
        missing = c.found.replace("Missing:", "").strip()
        return (
            f"Some required onboarding details are missing ({missing}). "
            f"Please include those details in your reply so we can complete your review."
        )

    if rid == "R1_TAX_DOC_TYPE":
        if "missing or unreadable" in (c.found or "").lower():
            return (
                "We didn't receive a readable Tax Registration PDF. "
                "Please send a clear copy of your official Tax Registration Certificate (such as GST REG-06, PAN, W-9, or VAT certificate)."
            )
        return (
            f"The file uploaded for tax registration ({c.found}) doesn't appear to be a valid tax certificate. "
            f"Please send your official Tax Registration Certificate PDF instead."
        )

    if rid == "R1_BANK_DOC_TYPE":
        if "missing or unreadable" in (c.found or "").lower():
            return (
                "We didn't receive a readable bank proof document. "
                "Please send an official Bank Verification Letter on bank letterhead or a pre-printed cancelled cheque."
            )
        doc_desc = re.sub(r"^WRONG_DOCUMENT\s*[—\-:]\s*", "", c.found or "").strip() or "an unrelated document"
        return (
            f"It looks like '{doc_desc}' was uploaded in place of bank proof. "
            f"Please send an official Bank Verification Letter on bank letterhead (or a cancelled cheque showing your account holder name, account number, and routing code)."
        )

    if rid == "R1_COMPLIANCE_DOC_TYPE":
        return (
            f"The attached compliance document ({c.found}) doesn't appear to be a valid compliance certificate. "
            f"Please send a valid CA Turnover, MSME Udyam, or Good Standing Certificate."
        )

    if rid == "R2_IN_PAN_FORMAT":
        return (
            f"The Indian PAN entered ({tax_id or 'blank'}) doesn't match the standard 10-character PAN format. "
            f"Please send your valid 10-character PAN registered under {entity}."
        )

    if rid == "R2_IN_PAN_CONSTITUTION":
        fourth = tax_id[3] if len(tax_id) >= 4 else "?"
        found_label = PAN_4TH_CHAR_LABELS.get(fourth, f"type '{fourth}'")
        expected_char, expected_label = PAN_CONSTITUTION_MAP.get(
            form.entity_constitution, ("C", "Company")
        )
        return (
            f"The PAN submitted ({tax_id}) is registered as {found_label}, which doesn't match your entity constitution ({form.entity_constitution}). "
            f"Please send the {expected_label} PAN (with '{expected_char}' as the 4th character) registered under {entity}."
        )

    if rid == "R2_IN_GSTIN_FORMAT":
        return (
            f"The GSTIN entered ({sec_tax}) doesn't match the valid 15-character Indian GSTIN format. "
            f"Please send your valid 15-character GSTIN along with the matching GST REG-06 certificate."
        )

    if rid == "R2_IN_GSTIN_PAN_LINK":
        embedded = sec_tax[2:12] if len(sec_tax) >= 12 else "unknown"
        return (
            f"Your GSTIN ({sec_tax}) embeds PAN {embedded}, which doesn't match the PAN submitted on your form ({tax_id}). "
            f"Please send a GSTIN registered under the same corporate PAN."
        )

    if rid == "R2_IN_GSTIN_STATE":
        gst_code = sec_tax[:2]
        gst_state = INDIAN_STATE_CODES.get(gst_code, "another state")
        expected_code = STATE_NAME_TO_CODE.get((form.billing_state or "").strip().lower(), "")
        state_clause = (
            f"{form.billing_state} (state code {expected_code})"
            if expected_code
            else (form.billing_state or "your selected state")
        )
        return (
            f"Your billing state is listed as {state_clause}, but the GSTIN submitted ({sec_tax}) is registered in {gst_state} (state code {gst_code}). "
            f"Please send a valid {form.billing_state} GST REG-06 certificate, or let us know if you'll be billing from {gst_state}."
        )

    if rid == "R2_IN_IFSC":
        return (
            f"The IFSC code entered ({routing or 'blank'}) doesn't match the 11-character RBI format. "
            f"Please send your correct 11-character IFSC code matching your bank letter."
        )

    if rid == "R2_US_EIN":
        return (
            f"The US EIN entered ({tax_id or 'blank'}) doesn't match the standard XX-XXXXXXX format. "
            f"Please send your valid 9-digit EIN matching your W-9."
        )

    if rid == "R2_US_ABA":
        return (
            f"The ABA routing number entered ({routing or 'blank'}) isn't a valid 9-digit US routing number. "
            f"Please share your 9-digit ABA routing number."
        )

    if rid == "R2_UK_VAT":
        return (
            f"The UK VAT number entered ({tax_id or 'blank'}) doesn't match HMRC's GB + 9-digit format. "
            f"Please send your valid UK VAT registration number."
        )

    if rid == "R2_UK_SORT_CODE":
        return (
            f"The UK sort code entered ({routing or 'blank'}) doesn't match the XX-XX-XX format. "
            f"Please send your 6-digit bank sort code."
        )

    if rid == "R2_AE_TRN":
        return (
            f"The UAE TRN entered ({tax_id or 'blank'}) doesn't match the 15-digit format starting with 100. "
            f"Please provide your valid UAE Federal Tax Authority TRN."
        )

    if rid == "R2_AU_ABN":
        return (
            f"The Australian ABN entered ({tax_id or 'blank'}) doesn't match the 11-digit format. "
            f"Please provide your valid 11-digit ABN."
        )

    if rid == "R2_CROSS_BORDER_POLICY":
        return (
            f"The tax ID entered ({tax_id or 'blank'}) doesn't match the valid {country} format ({c.expected}). "
            f"Please send your valid {country} tax registration ID along with the matching official tax certificate."
        )

    if rid == "R2_TAX_DOC_CROSSMATCH":
        return (
            f"The tax ID on your form ({c.expected}) doesn't match what's shown on your attached tax certificate ({c.found}). "
            f"Please confirm the correct ID or send the matching official tax certificate."
        )

    if rid == "R3_CRITICAL_FRAUD_MISMATCH":
        holder = c.found or "a different beneficiary"
        return (
            f"The attached bank letter lists '{holder}' as the account holder, which doesn't match {entity} or a verified trade name on your tax certificate. "
            f"We can't make payouts to third-party accounts, so please provide a bank verification letter for an account held directly by {entity}."
        )

    if rid == "R3_BANK_COORDS_MATCH":
        return (
            f"The bank account details on your form ({c.expected}) don't match your attached bank letter ({c.found}). "
            f"Please confirm the matching details or send an updated bank verification letter."
        )

    if rid == "R3_CORP_ACCOUNT_TYPE":
        return (
            f"The bank account provided is a {c.found} account, whereas {form.entity_constitution} entities require a Current / Commercial account. "
            f"Please send bank verification for a commercial account held by {entity}."
        )

    if rid == "R4_DOCUMENT_VALIDITY":
        cleaned = re.sub(
            r"\s*\((?:current audit date|prior to):?[^)]*\)",
            "",
            c.message or "",
            flags=re.IGNORECASE,
        ).strip()
        cleaned = cleaned.rstrip(".")
        return (
            f"{cleaned}. "
            f"Please send a renewed, currently valid copy so we can finish your verification."
        )

    if rid == "R5_DUPLICATE_BANK_ACCOUNT":
        return (
            f"Bank account {form.account_number} is already registered under a different vendor entity, and bank accounts can't be shared across unrelated businesses. "
            f"Please provide verification for a unique corporate bank account held solely by {entity}."
        )

    if rid == "R5_DUPLICATE_TAX_ID":
        return (
            f"The Tax ID submitted ({tax_id or sec_tax}) is already registered under another vendor in our system. "
            f"Please confirm your tax registration details or let us know if this entity is linked to an existing vendor."
        )

    # Generic fallback for any future rules
    msg = (c.message or c.rule_name).strip().rstrip(".")
    hint = (c.remediation_hint or "Please send updated documentation.").strip()
    return f"{msg}. {hint}"


def route_decision_and_draft_email(
    submission_id: str,
    form: VendorFormInput,
    checks: list[RuleCheckResult],
    audit_notes: list[str],
) -> tuple[str, str, Optional[OutboundEmail]]:
    """
    Stage 4: Deterministic decision routing (APPROVED / PENDING / REJECTED)
    + concise, human-phrased vendor email generator (pure Python templates, no LLM).
    """
    failed = [c for c in checks if c.status == "FAIL"]
    critical_fails = [c for c in failed if c.severity == "CRITICAL"]

    if critical_fails:
        decision = "REJECTED"
        reasons = "; ".join(c.rule_name for c in critical_fails)
        executive_summary = (
            f"Onboarding BLOCKED & REJECTED due to {len(critical_fails)} critical fraud/compliance "
            f"violation(s): {reasons}. Escalated to Vendor Risk & Treasury Operations."
        )
    elif failed:
        decision = "PENDING"
        reasons = "; ".join(c.rule_name for c in failed)
        executive_summary = (
            f"Onboarding placed ON HOLD (PENDING) due to {len(failed)} fixable operational "
            f"issue(s): {reasons}. Automated vendor outreach email drafted."
        )
    else:
        decision = "APPROVED"
        if audit_notes:
            executive_summary = (
                f"Vendor '{form.legal_entity_name}' AUTO-APPROVED with Compliance Audit Note. "
                f"All {len(checks)} verification checks passed, including verified DBA/Trade Name entity resolution."
            )
        else:
            executive_summary = (
                f"Vendor '{form.legal_entity_name}' AUTO-APPROVED for ERP payout activation. "
                f"All {len(checks)} tax, banking, fraud, and validity checks passed with zero discrepancies."
            )

    if decision == "APPROVED":
        return decision, executive_summary, None

    # Draft natural, concise, plain-English outbound communication
    vendor_display = form.legal_entity_name or "Vendor Partner"
    to_email = form.contact_email or "vendor-onboarding@example.com"

    bullets = [
        f"{idx}. {_format_plain_email_bullet(c, form)}"
        for idx, c in enumerate(failed, start=1)
    ]
    items_block = "\n\n".join(bullets)

    if decision == "REJECTED":
        issue_word = "issue" if len(failed) == 1 else "issues"
        subject = f"Update on your vendor onboarding — {vendor_display}"
        body = (
            f"Hi {vendor_display} team,\n\n"
            f"Thanks for submitting your onboarding details. Unfortunately, we're unable to approve your profile right now due to the following compliance {issue_word}:\n\n"
            f"{items_block}\n\n"
            f"Just reply to this email with the updated documents, and we'll wrap up your approval right away.\n\n"
            f"Best,\n"
            f"Vendor Onboarding Team · Accounts Payable & Compliance"
        )
    else:
        update_word = "update" if len(failed) == 1 else "updates"
        subject = f"Quick updates needed for your onboarding — {vendor_display}"
        body = (
            f"Hi {vendor_display} team,\n\n"
            f"Thanks for sending over your onboarding details. We reviewed your documents and just need {len(failed)} quick {update_word} before we can get your profile approved:\n\n"
            f"{items_block}\n\n"
            f"Just reply to this email with the updated documents, and we'll wrap up your approval right away.\n\n"
            f"Best,\n"
            f"Vendor Onboarding Team · Accounts Payable & Compliance"
        )

    email = OutboundEmail(
        to_email=to_email,
        subject=subject,
        body=body,
        dispatched=False,
        dispatched_at=None,
    )
    return decision, executive_summary, email
