const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const FIELD_LABELS = {
  legal_entity_name: 'Legal Entity Name',
  dba_trade_name: 'Trade Name / DBA',
  entity_constitution: 'Business Type',
  country_code: 'Country',
  billing_state: 'Billing State',
  tax_id: 'Tax ID',
  secondary_tax_id: 'GST Number',
  bank_account_holder: 'Account Holder Name',
  account_number: 'Account Number',
  account_type: 'Account Type',
  routing_code: 'Routing Code',
  contact_email: 'Contact Email',
}

/**
 * Format duration in milliseconds: >= 1000ms becomes seconds (e.g. "21.3s"),
 * otherwise stays in milliseconds (e.g. "420 ms").
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return ''
  const n = Number(ms)
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}s`
  }
  return `${Math.max(1, Math.round(n))} ms`
}

/**
 * Format ISO date string "YYYY-MM-DD" to "Mar 31, 2025".
 */
export function formatIsoDate(isoStr) {
  if (!isoStr) return ''
  const m = String(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(isoStr)
  const year = Number(m[1])
  const monthIdx = Number(m[2]) - 1
  const day = Number(m[3])
  if (monthIdx < 0 || monthIdx > 11) return String(isoStr)
  return `${MONTHS[monthIdx]} ${day}, ${year}`
}

/**
 * Replace any embedded YYYY-MM-DD dates inside a sentence with "Mar 31, 2025".
 */
export function formatDatesInText(text) {
  if (!text) return ''
  return String(text).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match) =>
    formatIsoDate(match)
  )
}

/**
 * Format ISO timestamp to concise human readable date/time (e.g. "Nov 22, 2026, 2:30 PM").
 */
export function formatTimestamp(isoTimestamp) {
  if (!isoTimestamp) return ''
  const d = new Date(isoTimestamp)
  if (Number.isNaN(d.getTime())) return String(isoTimestamp)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Proper singular / plural helper (e.g. pluralize(1, 'item') -> "1 item").
 */
export function pluralize(count, singular, plural) {
  const n = Number(count) || 0
  const word = n === 1 ? singular : plural || `${singular}s`
  return `${n} ${word}`
}

/**
 * Join a list of short plain-English phrases naturally ("a", "a and b", "a, b, and c").
 */
function joinNaturalList(items) {
  if (!items || items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]}, and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/**
 * Convert raw classification enums into clean Title Case labels.
 */
export function formatDocClassification(raw) {
  const map = {
    TAX_REGISTRATION: 'Tax Certificate',
    BANK_PROOF: 'Bank Proof',
    COMPLIANCE_CERT: 'Compliance Cert',
    WRONG_DOCUMENT: 'Wrong File',
    COMMERCIAL_INVOICE: 'Wrong File',
  }
  if (!raw) return 'Document'
  const key = String(raw).trim().toUpperCase()
  if (map[key]) return map[key]
  return key
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ')
}

/**
 * Convert raw backend extraction engine strings into clean human labels.
 */
export function formatEngineLabel(raw) {
  if (!raw) return 'AI Document Reader'
  const lower = String(raw).toLowerCase()
  if (lower.includes('gemini-3.5-flash-lite')) {
    return 'Gemini 3.5 Flash-Lite'
  }
  if (lower.includes('gemini')) {
    return 'AI Document Reader'
  }
  if (lower.includes('pdfplumber')) {
    return 'Standard PDF Parser'
  }
  return String(raw)
}

/**
 * Format decision status into clean Title Case.
 */
export function formatDecisionLabel(decision) {
  const map = {
    APPROVED: 'Approved',
    PENDING: 'Pending',
    REJECTED: 'Rejected',
  }
  return map[decision] || decision || ''
}

/**
 * Clean up internal field names and raw enums/regexes from a text string.
 */
function sanitizeOperatorText(text) {
  if (!text) return ''
  let s = formatDatesInText(String(text))

  s = s
    .replace(/\bTAX_REGISTRATION\b/g, 'Tax Certificate')
    .replace(/\bBANK_PROOF\b/g, 'Bank Proof')
    .replace(/\bCOMPLIANCE_CERT\b/g, 'Compliance Cert')
    .replace(/\bWRONG_DOCUMENT\b/g, 'Wrong File')
    .replace(/\bCOMMERCIAL_INVOICE\b/g, 'Commercial Invoice')
    .replace(/\bCRITICAL_FRAUD_MISMATCH\s*:\s*/g, '')
    .replace(/\bCRITICAL DUPLICATE ACCOUNT\s*:\s*/g, '')
    .replace(/\bACTIVE\b/g, 'Active')
    .replace(/\bEXPIRED\b/g, 'Expired')
    .replace(/\bSUSPENDED\b/g, 'Suspended')
    .replace(/\bCANCELLED\b/g, 'Cancelled')
    .replace(/\bREVOKED\b/g, 'Revoked')
    .replace(/\bINACTIVE\b/g, 'Inactive')
    .replace(/'(Active|Expired|Suspended|Cancelled|Revoked|Inactive)'/g, '$1')

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    s = s.replace(new RegExp(`\\b${key}\\b`, 'g'), label)
  }

  s = s.replace(/\s*\(\^[^)]+\$\)/g, '')
  s = s.replace(/\s*\((?:current audit date|prior to):?[^)]*\)/gi, '')
  s = s.replace(/\s*>=\s*/g, ' on or after ')
  s = s.replace(/\s*≥\s*/g, ' on or after ')
  s = s.replace(/\s*\|\s*/g, ', ')
  s = s.replace(/page\(s\)/gi, 'pages')
  s = s.replace(/identifier\(s\)/gi, 'identifiers')

  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Map a backend rule_group string to a simple, non-technical category tag.
 */
export function formatRuleCategory(ruleGroup) {
  const raw = (ruleGroup || '').toLowerCase()
  if (raw.includes('completeness') || raw.includes('document type')) {
    return 'Documents'
  }
  if (raw.includes('jurisdiction') || raw.includes('tax')) {
    return 'Tax & Location'
  }
  if (raw.includes('fraud') || raw.includes('bank') || raw.includes('entity')) {
    return 'Bank Account'
  }
  if (raw.includes('validity') || raw.includes('expiry')) {
    return 'Document Expiry'
  }
  if (raw.includes('duplicate')) {
    return 'Duplicate Check'
  }
  return (ruleGroup || 'Compliance').replace(/^Rule\s+\d+\s*[·\-:]\s*/i, '')
}

/**
 * Produce a short, natural-language clause for a single failed rule
 * used inside the top Decision Banner summary.
 */
function summarizeFailedRuleClause(rule) {
  const rid = rule.rule_id || ''

  if (rid === 'R1_FORM_COMPLETENESS') return 'some required form fields are missing'
  if (rid === 'R1_TAX_DOC_TYPE') return 'a valid tax certificate was not uploaded'
  if (rid === 'R1_BANK_DOC_TYPE') {
    if ((rule.found || '').toLowerCase().includes('invoice')) {
      return 'a commercial invoice was uploaded instead of bank proof'
    }
    return 'a valid bank proof document was not uploaded'
  }
  if (rid === 'R1_COMPLIANCE_DOC_TYPE') return 'the uploaded compliance file is not a valid certificate'
  if (rid === 'R2_IN_PAN_FORMAT') return 'the PAN number format is invalid'
  if (rid === 'R2_IN_PAN_CONSTITUTION') {
    if ((rule.found || '').toLowerCase().includes('individual') || (rule.found || '').includes("'P'")) {
      return 'the PAN belongs to an individual rather than a company'
    }
    return 'the PAN does not match the selected business type'
  }
  if (rid === 'R2_IN_GSTIN_FORMAT') return 'the GST number format is invalid'
  if (rid === 'R2_IN_GSTIN_PAN_LINK') return 'the GST number does not match the submitted PAN'
  if (rid === 'R2_IN_GSTIN_STATE') return 'the billing state does not match the GST number'
  if (rid === 'R2_IN_IFSC') return 'the IFSC code is invalid'
  if (rid === 'R2_US_EIN') return 'the US EIN format is invalid'
  if (rid === 'R2_US_ABA') return 'the US routing number is invalid'
  if (rid === 'R2_UK_VAT') return 'the UK VAT number is invalid'
  if (rid === 'R2_UK_SORT_CODE') return 'the UK sort code is invalid'
  if (rid === 'R2_AE_TRN') return 'the UAE TRN number is invalid'
  if (rid === 'R2_AU_ABN') return 'the Australian ABN is invalid'
  if (rid === 'R2_CROSS_BORDER_POLICY') return 'the tax ID does not match the selected country format'
  if (rid === 'R2_TAX_DOC_CROSSMATCH') return 'the tax ID on the form does not match the tax certificate'
  if (rid === 'R3_CRITICAL_FRAUD_MISMATCH') return 'the bank account name does not match the vendor'
  if (rid === 'R3_BANK_COORDS_MATCH') return 'the bank account details do not match the bank letter'
  if (rid === 'R3_CORP_ACCOUNT_TYPE') return 'a personal savings account was provided instead of a business account'
  if (rid === 'R4_DOCUMENT_VALIDITY') {
    const msg = rule.message || ''
    if (/ca turnover certificate/i.test(msg)) return 'the CA turnover certificate has expired'
    if (/tax registration/i.test(msg)) return 'the tax registration certificate has expired'
    return 'a submitted certificate has expired'
  }
  if (rid === 'R5_DUPLICATE_BANK_ACCOUNT') return 'the bank account is already registered to another vendor'
  if (rid === 'R5_DUPLICATE_TAX_ID') return 'this Tax ID is already registered under another vendor'

  return (rule.rule_name || 'a compliance check failed').toLowerCase()
}

/**
 * Produce clear, natural-language Decision Banner copy listing the actual reasons.
 */
export function formatExecutiveSummary(result) {
  if (!result) return ''
  const failed = (result.rule_checks || []).filter((c) => c.status === 'FAIL')
  const criticalFails = failed.filter((c) => c.severity === 'CRITICAL')

  if (result.decision === 'APPROVED') {
    return 'All checks passed. This vendor is verified and ready to be added to your ERP.'
  }

  if (result.decision === 'REJECTED') {
    const primary = criticalFails.length > 0 ? criticalFails : failed
    const count = primary.length || 1
    const reasons = joinNaturalList(primary.map(summarizeFailedRuleClause))
    return `Application rejected — ${pluralize(count, 'high-risk issue')} detected: ${reasons}. Escalated to Risk & Treasury.`
  }

  const count = failed.length || 1
  const reasons = joinNaturalList(failed.map(summarizeFailedRuleClause))
  return `Pending — ${pluralize(count, 'item')} ${
    count === 1 ? 'needs' : 'need'
  } vendor clarification before approval: ${reasons}. A follow-up email is ready below.`
}

/**
 * Transform a backend RuleCheckResult into conversational, plain-English UI copy
 * with simple category tag, natural title, clear explanation, and clean 2-column comparison.
 */
export function formatRuleForOperator(rule) {
  const rid = rule.rule_id || ''
  const category = formatRuleCategory(rule.rule_group)
  const isPass = rule.status === 'PASS'

  let title = rule.rule_name || 'Compliance Check'
  let message = sanitizeOperatorText(rule.message)
  let leftLabel = 'Expected'
  let rightLabel = 'Found'
  let leftValue = sanitizeOperatorText(rule.expected)
  let rightValue = sanitizeOperatorText(rule.found)

  if (rid === 'R1_FORM_COMPLETENESS') {
    title = isPass ? 'All Required Form Details Provided' : 'Missing Required Form Details'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = 'All 10 required fields completed'
    if (isPass) {
      rightValue = '10 of 10 fields completed'
      message = 'All required vendor, tax, and bank details were filled in.'
    } else {
      const missing = sanitizeOperatorText((rule.found || '').replace(/^Missing:\s*/i, ''))
      rightValue = `Missing: ${missing}`
      message = `Some required form fields were left blank: ${missing}.`
    }
  } else if (rid === 'R1_TAX_DOC_TYPE') {
    title = isPass ? 'Tax Certificate Verified' : 'Invalid or Missing Tax Certificate'
    leftLabel = 'Expected'
    rightLabel = 'Found'
    leftValue = 'Official Tax Registration Certificate'
    if (isPass) {
      const fileMatch = (rule.found || '').match(/\(([^)]+)\)/)
      rightValue = fileMatch ? `${fileMatch[1]} (Tax Certificate)` : 'Tax Certificate'
      message = 'Confirmed a readable official tax registration document was uploaded.'
    } else {
      rightValue = sanitizeOperatorText(
        (rule.found || '').replace(/^WRONG_DOCUMENT\s*[—\-:]\s*/i, '')
      )
      message = 'A readable official tax registration certificate was not found in the tax document slot.'
    }
  } else if (rid === 'R1_BANK_DOC_TYPE') {
    const isMissing = (rule.found || '').toLowerCase().includes('missing or unreadable')
    title = isPass
      ? 'Bank Proof Verified'
      : isMissing
      ? 'Missing Bank Proof Document'
      : 'Wrong File Uploaded for Bank Proof'
    leftLabel = 'Expected'
    rightLabel = 'Found'
    leftValue = 'Bank verification letter or cancelled cheque'
    if (isPass) {
      const fileMatch = (rule.found || '').match(/\(([^)]+)\)/)
      rightValue = fileMatch ? `${fileMatch[1]} (Bank Proof)` : 'Bank Proof'
      message = 'Confirmed a readable bank verification letter or cancelled cheque was uploaded.'
    } else if (isMissing) {
      rightValue = 'No readable bank proof uploaded'
      message = 'A bank verification letter or cancelled cheque was not uploaded.'
    } else {
      const cleanedFound = sanitizeOperatorText(
        (rule.found || '').replace(/^WRONG_DOCUMENT\s*[—\-:]\s*/i, '')
      )
      rightValue = cleanedFound || 'Unrelated file'
      message = `The uploaded file appears to be ${cleanedFound} instead of a bank verification letter or cancelled cheque.`
    }
  } else if (rid === 'R1_COMPLIANCE_DOC_TYPE') {
    title = isPass ? 'Compliance Certificate Verified' : 'Invalid Compliance Certificate'
    leftLabel = 'Expected'
    rightLabel = 'Found'
    leftValue = 'CA Turnover, MSME, or Good Standing certificate'
    if (isPass) {
      const fileMatch = (rule.found || '').match(/\(([^)]+)\)/)
      rightValue = fileMatch ? `${fileMatch[1]} (Compliance Cert)` : 'Compliance Cert'
      message = 'Confirmed the optional compliance certificate is readable and valid.'
    } else {
      message = 'The uploaded compliance attachment does not appear to be a valid compliance certificate.'
    }
  } else if (rid === 'R2_IN_PAN_FORMAT' || rid === 'R2_IN_PAN_CONSTITUTION') {
    title = isPass
      ? 'PAN Matches Business Type'
      : rid === 'R2_IN_PAN_FORMAT'
      ? 'Invalid Indian PAN Format'
      : "PAN Doesn't Match Business Type"
    leftLabel = 'Expected'
    rightLabel = 'Found'
    if (rid === 'R2_IN_PAN_FORMAT') {
      leftValue = '10-character Indian PAN'
      rightValue = rule.found || 'Not provided'
      message = 'The entered PAN does not match the standard 10-character Indian PAN format.'
    } else if (!isPass) {
      leftValue = sanitizeOperatorText(rule.expected).replace(/^4th Char\s*/i, '4th letter ')
      rightValue = sanitizeOperatorText(rule.found).replace(/^4th Char\s*/i, '4th letter ')
      const isIndividual = (rule.found || '').toLowerCase().includes('individual')
      if (isIndividual) {
        message =
          'The submitted PAN belongs to an individual rather than a company, which conflicts with the Private Limited business type.'
      }
    } else {
      leftValue = sanitizeOperatorText(rule.expected)
        .replace(/Valid PAN regex \+\s*/i, '')
        .replace(/^4th Char\s*/i, '4th letter ')
      rightValue = sanitizeOperatorText(rule.found).replace(/4th Char/i, '4th letter')
      message = 'The submitted PAN is validly formatted and matches the vendor business type.'
    }
  } else if (rid === 'R2_IN_GSTIN_FORMAT' || rid === 'R2_IN_GSTIN_PAN_LINK') {
    title = isPass ? 'GST Number Matches PAN' : "GST Number Doesn't Match PAN"
    leftLabel = 'Submitted'
    rightLabel = 'On Document'
    leftValue = sanitizeOperatorText(rule.expected).replace(/^15-char GSTIN embedding PAN\s*/i, 'PAN ')
    rightValue = sanitizeOperatorText(rule.found)
    if (isPass) {
      message = 'The 15-character GST number is valid and matches the company PAN.'
    }
  } else if (rid === 'R2_IN_GSTIN_STATE') {
    title = isPass
      ? 'Billing State Matches GST Number'
      : "Billing State Doesn't Match GST Number"
    leftLabel = 'Submitted'
    rightLabel = 'On Document'
    const parseState = (v) => {
      const m = (v || '').match(/State Prefix\s+(\d{2})\s*\(([^)]+)\)/i)
      return m ? { name: m[2], code: m[1] } : null
    }
    const expState = parseState(rule.expected)
    const fndState = parseState(rule.found)
    leftValue = expState ? `${expState.name} (State Code ${expState.code})` : sanitizeOperatorText(rule.expected)
    rightValue = fndState ? `${fndState.name} (State Code ${fndState.code})` : sanitizeOperatorText(rule.found)
    if (!isPass && expState && fndState) {
      message = `The vendor selected ${expState.name} as their billing state, but their GST number is registered in ${fndState.name}.`
    } else if (isPass && expState) {
      message = `The GST number is registered in ${expState.name}, matching the selected billing state.`
    }
  } else if (rid === 'R2_IN_IFSC') {
    title = isPass ? 'IFSC Code Verified' : 'Invalid IFSC Code'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = '11-character Indian IFSC code'
    rightValue = rule.found || 'Not provided'
    if (isPass) {
      message = `IFSC code ${rightValue} matches the standard Indian bank routing format.`
    }
  } else if (rid === 'R2_US_EIN') {
    title = isPass ? 'US EIN Verified' : 'Invalid US EIN Format'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = '9-digit US EIN (XX-XXXXXXX)'
    rightValue = rule.found || 'Not provided'
  } else if (rid === 'R2_US_ABA') {
    title = isPass ? 'US Routing Number Verified' : 'Invalid US Routing Number'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = '9-digit US ABA routing number'
    rightValue = rule.found || 'Not provided'
  } else if (rid === 'R2_UK_VAT') {
    title = isPass ? 'UK VAT Number Verified' : 'Invalid UK VAT Number'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = 'GB followed by 9 digits'
    rightValue = rule.found || 'Not provided'
  } else if (rid === 'R2_UK_SORT_CODE') {
    title = isPass ? 'UK Sort Code Verified' : 'Invalid UK Sort Code'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = '6-digit UK sort code (XX-XX-XX)'
    rightValue = rule.found || 'Not provided'
  } else if (rid === 'R2_AE_TRN') {
    title = isPass ? 'UAE TRN Verified' : 'Invalid UAE TRN'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = '15-digit UAE TRN starting with 100'
    rightValue = rule.found || 'Not provided'
  } else if (rid === 'R2_AU_ABN') {
    title = isPass ? 'Australian ABN Verified' : 'Invalid Australian ABN'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = '11-digit Australian ABN'
    rightValue = rule.found || 'Not provided'
  } else if (rid === 'R2_CROSS_BORDER_POLICY') {
    title = isPass ? 'Country Tax ID Format Verified' : "Tax ID Doesn't Match Country Format"
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = sanitizeOperatorText(rule.expected)
    rightValue = sanitizeOperatorText(rule.found)
    if (!isPass) {
      message = sanitizeOperatorText(rule.message)
        .replace(/Submitted value/i, 'The entered value')
    }
  } else if (rid === 'R2_TAX_DOC_CROSSMATCH') {
    title = isPass ? 'Tax ID Matches Certificate' : "Tax ID Doesn't Match Certificate"
    leftLabel = 'Submitted'
    rightLabel = 'On Document'
    leftValue = sanitizeOperatorText(rule.expected).replace(/^Form Tax ID:\s*/i, '')
    rightValue = sanitizeOperatorText(rule.found).replace(/^Doc Tax ID:\s*/i, '')
    if (isPass) {
      message = 'The tax details entered on the form match the uploaded tax certificate.'
    } else {
      message = 'The tax ID entered on the form does not match the ID shown on the uploaded tax certificate.'
    }
  } else if (rid === 'R3_BENEFICIARY_MATCH' || rid === 'R3_CRITICAL_FRAUD_MISMATCH') {
    title = isPass
      ? 'Bank Account Owner Confirmed'
      : rule.status === 'WARN'
      ? 'Waiting for Bank Proof to Confirm Account Owner'
      : "Bank Account Name Doesn't Match Vendor"
    leftLabel = 'Submitted'
    rightLabel = rule.status === 'WARN' ? 'Found' : 'On Document'
    leftValue = sanitizeOperatorText(rule.expected)
    rightValue =
      rule.status === 'WARN'
        ? 'No valid bank proof uploaded'
        : sanitizeOperatorText(rule.found)
    if (rule.status === 'FAIL') {
      message = `The bank letter lists ${rightValue} as the account holder, which does not match ${leftValue} or any verified trade name.`
    } else if (rule.status === 'WARN') {
      message = 'Account ownership could not be confirmed yet because a valid bank proof document was not uploaded.'
    } else {
      message = sanitizeOperatorText(rule.message)
    }
  } else if (rid === 'R3_BANK_COORDS_MATCH') {
    title = isPass ? 'Bank Account Details Match Letter' : "Bank Account Details Don't Match Letter"
    leftLabel = 'Submitted'
    rightLabel = 'On Document'
    leftValue = sanitizeOperatorText(rule.expected).replace(/^Acct:/i, 'Account:')
    rightValue = sanitizeOperatorText(rule.found).replace(/^Acct:/i, 'Account:')
    if (isPass) {
      message = 'The account number and routing code on the form match the bank letter.'
    } else {
      message = "The bank account number or routing code entered on the form doesn't match the uploaded bank document."
    }
  } else if (rid === 'R3_CORP_FREE_EMAIL') {
    title = 'Free Email Domain Used for Corporation'
    leftLabel = 'Expected'
    rightLabel = 'Submitted'
    leftValue = 'Official corporate email domain'
    rightValue = sanitizeOperatorText(rule.found)
    message = sanitizeOperatorText(rule.message)
  } else if (rid === 'R5_DUPLICATE_TAX_ID') {
    title = 'Tax ID Already Registered to Another Vendor'
    leftLabel = 'Expected'
    rightLabel = 'Found'
    leftValue = 'Tax ID unique to this vendor'
    rightValue = sanitizeOperatorText(rule.found)
    message = 'This Tax ID is already registered under another vendor in the system.'
  } else if (rid === 'R3_CORP_ACCOUNT_TYPE') {
    title = isPass ? 'Business Bank Account Confirmed' : 'Personal Account Submitted for Business'
    leftLabel = 'Expected'
    rightLabel = 'Found'
    leftValue = 'Current or commercial business account'
    rightValue = sanitizeOperatorText(rule.found)
    if (isPass) {
      message = 'The bank account is a commercial business account.'
    } else {
      message = 'A personal savings account was provided, but companies and partnerships require a commercial business account.'
    }
  } else if (rid === 'R4_DOCUMENT_VALIDITY') {
    const refMatch = (rule.expected || '').match(/(\d{4}-\d{2}-\d{2})/)
    leftLabel = 'Expected'
    rightLabel = 'Found'
    leftValue = refMatch
      ? `Active certificate valid on or after ${formatIsoDate(refMatch[1])}`
      : 'Active and unexpired certificate'

    if (!isPass) {
      const parts = (rule.message || '')
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
      const expiredPart = parts.find((p) => /expired on \d{4}-\d{2}-\d{2}/i.test(p))
      if (expiredPart) {
        const cleanExp = sanitizeOperatorText(expiredPart).replace(/\.$/, '')
        const isTax = /tax registration/i.test(cleanExp)
        title = isTax ? 'Expired Tax Registration' : 'Expired Compliance Certificate'
        message = `The uploaded ${cleanExp}.`
        const dateMatch = cleanExp.match(/expired on (.+)$/i)
        rightValue = dateMatch ? `Expired on ${dateMatch[1]}` : cleanExp
      } else {
        title = 'Inactive or Expired Certificate'
        message = sanitizeOperatorText(rule.message)
        rightValue = sanitizeOperatorText(rule.found)
      }
    } else {
      title = 'Certificates Are Active & Unexpired'
      rightValue = sanitizeOperatorText(rule.found).replace(
        /\(exp\s+([^)]+)\)/gi,
        '(valid through $1)'
      )
      message = 'All uploaded tax and compliance certificates are active and up to date.'
    }
  } else if (rid === 'R5_DUPLICATE_BANK_ACCOUNT') {
    title = isPass ? 'Bank Account Is Unique' : 'Bank Account Already Used by Another Vendor'
    leftLabel = 'Expected'
    rightLabel = 'Found'
    leftValue = 'Bank account unique to this vendor'
    if (!isPass) {
      rightValue = sanitizeOperatorText(rule.found).replace(/\s*\(Run\s+VG-[^)]+\)/gi, '')
      message = 'This bank account number is already registered under a different vendor in your records.'
    } else {
      rightValue = sanitizeOperatorText(rule.found)
      message = 'No other vendor is registered with this bank account number.'
    }
  }

  return {
    category,
    title,
    message,
    leftLabel,
    leftValue,
    rightLabel,
    rightValue,
  }
}
