import React, { useEffect, useState } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Eye,
  Mail,
  Copy,
  Check,
  Send,
  ChevronDown,
  ChevronUp,
  Code2,
  Info,
  Loader2,
} from 'lucide-react'
import { resolveApiUrl } from '../api'
import {
  formatCompactIssueRow,
  formatDecisionLabel,
  formatEngineLabel,
  formatRuleForOperator,
  formatTimestamp,
  formatVerdictHeadline,
  pluralize,
} from '../utils/formatters'

const VERDICT_STRIP_STYLES = {
  APPROVED: {
    strip: 'bg-emerald-50/60 border-b border-emerald-200/70',
    badge: 'bg-emerald-600 text-white',
    icon: CheckCircle2,
    iconColor: 'text-emerald-600',
    headlineColor: 'text-emerald-950',
  },
  PENDING: {
    strip: 'bg-amber-50/65 border-b border-amber-200/70',
    badge: 'bg-amber-500 text-white',
    icon: AlertTriangle,
    iconColor: 'text-amber-600',
    headlineColor: 'text-amber-950',
  },
  REJECTED: {
    strip: 'bg-rose-50/65 border-b border-rose-200/75',
    badge: 'bg-rose-600 text-white',
    icon: ShieldAlert,
    iconColor: 'text-rose-600',
    headlineColor: 'text-rose-950',
  },
}

const KNOWN_FIXTURE_RE = /^s(?:1|2|3|4a|4b)_[a-z0-9_]+\.pdf$/i

const SLOT_PROOF_META = {
  tax_document: {
    title: 'Tax Proof',
    buttonLabel: 'Preview Tax Proof',
  },
  bank_document: {
    title: 'Bank Proof',
    buttonLabel: 'Preview Bank Proof',
  },
  compliance_document: {
    title: 'Compliance Proof',
    buttonLabel: 'Preview Compliance Proof',
  },
}

function resolveDocPreviewUrl(doc, attachments) {
  if (!doc?.filename) return null
  const att = attachments?.[doc.slot]
  if (att && att.filename === doc.filename && att.previewUrl) {
    return att.previewUrl
  }
  if (KNOWN_FIXTURE_RE.test(doc.filename)) {
    return resolveApiUrl(`/api/fixtures/${encodeURIComponent(doc.filename)}`)
  }
  return null
}

function getRelatedDocumentForRule(rule, documents, attachments) {
  if (!documents || documents.length === 0) return null
  const bySlot = {}
  for (const d of documents) {
    bySlot[d.slot] = d
  }

  const rid = rule.rule_id || ''
  let targetSlot = null

  if (
    rid === 'R1_TAX_DOC_TYPE' ||
    rid === 'R2_TAX_DOC_CROSSMATCH' ||
    rid === 'R2_IN_GSTIN_STATE' ||
    rid === 'R2_IN_GSTIN_FORMAT' ||
    rid === 'R2_IN_GSTIN_PAN_LINK' ||
    rid === 'R2_IN_PAN_FORMAT' ||
    rid === 'R2_IN_PAN_CONSTITUTION' ||
    rid === 'R2_CROSS_BORDER_POLICY' ||
    rid === 'R2_US_EIN' ||
    rid === 'R2_UK_VAT' ||
    rid === 'R2_AE_TRN' ||
    rid === 'R2_AU_ABN'
  ) {
    targetSlot = 'tax_document'
  } else if (
    rid === 'R1_BANK_DOC_TYPE' ||
    rid === 'R3_CRITICAL_FRAUD_MISMATCH' ||
    rid === 'R3_BENEFICIARY_MATCH' ||
    rid === 'R3_BANK_COORDS_MATCH' ||
    rid === 'R3_CORP_ACCOUNT_TYPE' ||
    rid === 'R2_IN_IFSC' ||
    rid === 'R2_US_ABA' ||
    rid === 'R2_UK_SORT_CODE'
  ) {
    targetSlot = 'bank_document'
  } else if (rid === 'R1_COMPLIANCE_DOC_TYPE') {
    targetSlot = 'compliance_document'
  } else if (rid === 'R4_DOCUMENT_VALIDITY') {
    const msgLow = (rule.message || '').toLowerCase()
    if (msgLow.includes('tax registration') && bySlot.tax_document) {
      targetSlot = 'tax_document'
    } else if (bySlot.compliance_document) {
      targetSlot = 'compliance_document'
    } else if (bySlot.tax_document) {
      targetSlot = 'tax_document'
    }
  }

  if (!targetSlot || !bySlot[targetSlot]) return null
  const doc = bySlot[targetSlot]
  const url = resolveDocPreviewUrl(doc, attachments)
  if (!url) return null
  const meta = SLOT_PROOF_META[targetSlot] || {
    title: 'Document Proof',
    buttonLabel: 'Preview Document',
  }
  return { title: meta.title, buttonLabel: meta.buttonLabel, url }
}

export default function ResultView({
  result,
  attachments = null,
  onSendEmail,
  onPreviewDoc,
}) {
  const [copiedEmail, setCopiedEmail] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [showPassedChecks, setShowPassedChecks] = useState(false)
  const [showRawJson, setShowRawJson] = useState(false)

  useEffect(() => {
    setShowPassedChecks(false)
  }, [result?.submission_id])

  if (!result) return null

  const verdictStyle = VERDICT_STRIP_STYLES[result.decision] || VERDICT_STRIP_STYLES.PENDING
  const VerdictIcon = verdictStyle.icon

  const attentionRules = (result.rule_checks || [])
    .filter((r) => r.status === 'FAIL' || r.status === 'WARN')
    .sort((a, b) => {
      const rank = (r) =>
        r.status === 'FAIL' && r.severity === 'CRITICAL'
          ? 0
          : r.status === 'FAIL'
          ? 1
          : 2
      return rank(a) - rank(b)
    })

  const passedRules = (result.rule_checks || []).filter((r) => r.status === 'PASS')
  const auditNotes = result.audit_notes || []

  const passCount = passedRules.length
  const warnCount = (result.rule_checks || []).filter((r) => r.status === 'WARN').length
  const failCount = (result.rule_checks || []).filter((r) => r.status === 'FAIL').length

  const headline = formatVerdictHeadline(result)

  // Resolve available preview links by slot for Audit Note & clean Approved preview buttons
  const previewBySlot = {}
  for (const doc of result.documents || []) {
    const url = resolveDocPreviewUrl(doc, attachments)
    if (url) {
      const meta = SLOT_PROOF_META[doc.slot] || {
        title: 'Document Proof',
        buttonLabel: 'Preview Document',
      }
      previewBySlot[doc.slot] = { ...meta, url, slot: doc.slot }
    }
  }
  const availablePreviews = ['tax_document', 'bank_document', 'compliance_document']
    .map((slot) => previewBySlot[slot])
    .filter(Boolean)

  const handleCopyEmail = async () => {
    if (!result.outbound_email) return
    const text = `To: ${result.outbound_email.to_email}\nSubject: ${result.outbound_email.subject}\n\n${result.outbound_email.body}`
    try {
      await navigator.clipboard.writeText(text)
      setCopiedEmail(true)
      setTimeout(() => setCopiedEmail(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopiedEmail(true)
      setTimeout(() => setCopiedEmail(false), 2000)
    }
  }

  const handleCopyJson = async () => {
    const text = JSON.stringify(result, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopiedJson(true)
      setTimeout(() => setCopiedJson(false), 2000)
    } catch {
      setCopiedJson(false)
    }
  }

  const handleDispatch = async () => {
    if (!onSendEmail || !result.submission_id) return
    setSendingEmail(true)
    try {
      await onSendEmail(result.submission_id)
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. Compact Verification Results Card (with merged Slim Verdict Header Strip) */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-soft">
        {/* Slim Merged Verdict Header Strip */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${verdictStyle.strip}`}
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <VerdictIcon className={`h-4 w-4 shrink-0 ${verdictStyle.iconColor}`} />
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${verdictStyle.badge}`}
            >
              {formatDecisionLabel(result.decision)}
            </span>
            <span className={`text-xs font-semibold truncate ${verdictStyle.headlineColor}`}>
              {headline}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium shrink-0">
            {failCount > 0 && (
              <span className="rounded-full bg-rose-100/90 px-2 py-0.5 text-rose-800 font-semibold">
                {pluralize(failCount, 'Issue')}
              </span>
            )}
            {warnCount > 0 && (
              <span className="rounded-full bg-amber-100/90 px-2 py-0.5 text-amber-800 font-semibold">
                {pluralize(warnCount, 'Warning')}
              </span>
            )}
            {auditNotes.length > 0 && (
              <span className="rounded-full bg-blue-100/90 px-2 py-0.5 text-blue-800 font-semibold">
                {pluralize(auditNotes.length, 'Audit Note')}
              </span>
            )}
            <span className="rounded-full bg-white/85 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-200/70">
              {passCount} Passed
            </span>
            <span className="ml-1 text-[10px] text-slate-400">
              {result.submission_id}
            </span>
          </div>
        </div>

        {/* Compact Issue Rows (Submitted vs. Found in Document) */}
        {attentionRules.length > 0 && (
          <div className="divide-y divide-slate-100">
            {attentionRules.map((rule) => {
              const row = formatCompactIssueRow(rule, result.form_data)
              const relatedDoc = getRelatedDocumentForRule(
                rule,
                result.documents,
                attachments
              )
              const isWarn = rule.status === 'WARN'
              const isCritical = rule.severity === 'CRITICAL' && rule.status === 'FAIL'

              const badgeEl = isWarn ? (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  Warning
                </span>
              ) : isCritical ? (
                <span className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                  Critical Risk
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
                  Warning
                </span>
              )

              return (
                <div key={rule.rule_id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {badgeEl}
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {row.title}
                      </span>
                    </div>

                    {relatedDoc && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewDoc?.({
                            title: relatedDoc.title,
                            url: relatedDoc.url,
                          })
                        }
                        className="shrink-0 inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50 hover:ring-indigo-300 transition"
                      >
                        <Eye className="h-3 w-3 text-indigo-600 shrink-0" />
                        <span>{relatedDoc.buttonLabel}</span>
                      </button>
                    )}
                  </div>

                  {row.isPair ? (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg bg-slate-50/90 border border-slate-200/70 px-3 py-1.5 text-[11px]">
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Submitted:
                        </span>{' '}
                        <span className="font-medium text-slate-800 break-words">
                          {row.submitted}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Found in Document:
                        </span>{' '}
                        <span
                          className={`font-semibold break-words ${
                            isWarn ? 'text-amber-800' : 'text-rose-700'
                          }`}
                        >
                          {row.found}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-slate-600 leading-snug">
                      {row.reason}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* HITL Audit Notes Callout on Approved Cases (Soft Blue / Slate — never yellow) */}
        {auditNotes.length > 0 && (
          <div className="px-4 py-2.5 space-y-2 border-t border-slate-100">
            {auditNotes.map((note, idx) => (
              <div
                key={idx}
                className="rounded-lg bg-blue-50/60 border border-blue-200 px-3.5 py-2.5 text-blue-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Info className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    <span className="inline-flex items-center rounded-full bg-blue-100/90 border border-blue-200/80 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                      Audit Note · Reconciled
                    </span>
                    <span className="text-xs font-semibold text-blue-950 truncate">
                      Trade Name &amp; Legal Entity Linked
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {previewBySlot.tax_document && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewDoc?.({
                            title: previewBySlot.tax_document.title,
                            url: previewBySlot.tax_document.url,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50 transition"
                      >
                        <Eye className="h-3 w-3 shrink-0" />
                        <span>Preview Tax Proof</span>
                      </button>
                    )}
                    {previewBySlot.bank_document && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewDoc?.({
                            title: previewBySlot.bank_document.title,
                            url: previewBySlot.bank_document.url,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50 transition"
                      >
                        <Eye className="h-3 w-3 shrink-0" />
                        <span>Preview Bank Proof</span>
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-blue-900/90 leading-snug">
                  {note}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Quick Proof Preview Strip for clean Approved runs (zero issues & zero audit notes) */}
        {attentionRules.length === 0 &&
          auditNotes.length === 0 &&
          availablePreviews.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-slate-100 bg-white">
              {availablePreviews.map((p) => (
                <button
                  key={p.slot}
                  type="button"
                  onClick={() =>
                    onPreviewDoc?.({
                      title: p.title,
                      url: p.url,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/80 hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200 transition"
                >
                  <Eye className="h-3 w-3 text-indigo-600 shrink-0" />
                  <span>{p.buttonLabel}</span>
                </button>
              ))}
            </div>
          )}

        {/* Collapsible Accordion for Passed Checks (Collapsed by default) */}
        {passedRules.length > 0 && (
          <div className="border-t border-slate-100 bg-slate-50/70">
            <button
              type="button"
              onClick={() => setShowPassedChecks((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-100/70 transition"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="text-xs font-semibold text-slate-800">
                  {pluralize(passedRules.length, 'Passed Check')} —{' '}
                  <span className="font-normal text-slate-500">
                    {showPassedChecks ? 'Click to collapse' : 'Click to expand'}
                  </span>
                </span>
              </div>
              {showPassedChecks ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </button>

            {showPassedChecks && (
              <div className="border-t border-slate-200/70 bg-white divide-y divide-slate-100">
                {passedRules.map((rule) => {
                  const view = formatRuleForOperator(rule)
                  return (
                    <div key={rule.rule_id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-slate-900">
                            {view.title}
                          </span>
                          <span className="ml-2 text-[11px] text-slate-400">
                            {view.category}
                          </span>
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          Passed
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600 leading-snug">
                        {view.message}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Outbound Vendor Communication Card (PENDING or REJECTED) */}
      {result.outbound_email && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-5 py-3 text-white">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-indigo-300" />
              <span className="text-xs font-semibold tracking-wide">
                Vendor Follow-Up Email
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyEmail}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 transition"
              >
                {copiedEmail ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy Email
                  </>
                )}
              </button>

              {result.outbound_email.dispatched ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Sent
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleDispatch}
                  disabled={sendingEmail}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                >
                  {sendingEmail ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send Email
                </button>
              )}
            </div>
          </div>

          <div className="p-4 space-y-2.5">
            <div className="grid grid-cols-1 gap-1 text-xs border-b border-slate-100 pb-2.5">
              <div className="flex gap-2">
                <span className="w-14 shrink-0 font-medium text-slate-400">To:</span>
                <span className="text-slate-800">{result.outbound_email.to_email}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-14 shrink-0 font-medium text-slate-400">Subject:</span>
                <span className="font-semibold text-slate-900">{result.outbound_email.subject}</span>
              </div>
              {result.outbound_email.dispatched && result.outbound_email.dispatched_at && (
                <div className="flex gap-2">
                  <span className="w-14 shrink-0 font-medium text-emerald-600">Status:</span>
                  <span className="text-xs text-emerald-700">
                    Sent on {formatTimestamp(result.outbound_email.dispatched_at)}
                  </span>
                </div>
              )}
            </div>

            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700 bg-slate-50/80 rounded-xl p-3.5 max-h-72 overflow-y-auto">
              {result.outbound_email.body}
            </pre>
          </div>
        </div>
      )}

      {/* 3. Collapsible Raw Audit Payload Drawer */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-soft">
        <button
          type="button"
          onClick={() => setShowRawJson((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition"
        >
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-indigo-600" />
            <span className="text-xs font-semibold text-slate-700">
              Extracted Data &amp; Audit Record (JSON)
            </span>
          </div>
          {showRawJson ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {showRawJson && (
          <div className="border-t border-slate-200 bg-slate-950 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">
                Document reader: {formatEngineLabel(result.extracted?.engine_used)}
              </span>
              <button
                type="button"
                onClick={handleCopyJson}
                className="inline-flex items-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition"
              >
                {copiedJson ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy JSON
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-96 overflow-auto font-mono text-[11px] leading-relaxed text-emerald-300">
              {JSON.stringify(
                {
                  submission_id: result.submission_id,
                  decision: result.decision,
                  audit_notes: result.audit_notes,
                  extracted: result.extracted,
                  documents: result.documents,
                  stages: result.stages,
                },
                null,
                2
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
