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
  formatDecisionLabel,
  formatEngineLabel,
  formatExecutiveSummary,
  formatRuleForOperator,
  formatTimestamp,
  pluralize,
} from '../utils/formatters'

const DECISION_STYLES = {
  APPROVED: {
    container: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 via-white to-white',
    badge: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20',
    icon: CheckCircle2,
    iconColor: 'text-emerald-600',
    titleColor: 'text-emerald-950',
  },
  PENDING: {
    container: 'border-amber-200/80 bg-gradient-to-br from-amber-50/80 via-white to-white',
    badge: 'bg-amber-500 text-white shadow-sm shadow-amber-500/20',
    icon: AlertTriangle,
    iconColor: 'text-amber-600',
    titleColor: 'text-amber-950',
  },
  REJECTED: {
    container: 'border-rose-200/80 bg-gradient-to-br from-rose-50/80 via-white to-white',
    badge: 'bg-rose-600 text-white shadow-sm shadow-rose-600/20',
    icon: ShieldAlert,
    iconColor: 'text-rose-600',
    titleColor: 'text-rose-950',
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
    title: 'Document Preview',
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

  // Reset accordion state when viewing a new submission run
  useEffect(() => {
    setShowPassedChecks(false)
  }, [result?.submission_id])

  if (!result) return null

  const style = DECISION_STYLES[result.decision] || DECISION_STYLES.PENDING
  const DecisionIcon = style.icon

  const attentionRules = result.rule_checks
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

  const passedRules = result.rule_checks.filter((r) => r.status === 'PASS')

  const passCount = passedRules.length
  const warnCount = result.rule_checks.filter((r) => r.status === 'WARN').length
  const failCount = result.rule_checks.filter((r) => r.status === 'FAIL').length

  const summaryText = formatExecutiveSummary(result)

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
    <div className="space-y-6">
      {/* 1. Decision Banner */}
      <div className={`rounded-2xl border p-5 shadow-card ${style.container}`}>
        <div className="flex items-start gap-3.5">
          <div className="mt-0.5 shrink-0">
            <DecisionIcon className={`h-7 w-7 ${style.iconColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`inline-flex items-center rounded-lg px-3 py-1 text-xs font-bold tracking-wide ${style.badge}`}
              >
                {formatDecisionLabel(result.decision)}
              </span>
              <span className="text-[11px] text-slate-400">
                Case {result.submission_id}
              </span>
            </div>

            <p className={`mt-2.5 text-sm font-medium leading-relaxed ${style.titleColor}`}>
              {summaryText}
            </p>

            {/* Clean Document Preview Buttons (Slide-Over Drawer) */}
            {result.documents && result.documents.length > 0 && (
              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                {result.documents.map((doc) => {
                  const isWrong = doc.classification === 'WRONG_DOCUMENT' || !doc.readable
                  const previewUrl = resolveDocPreviewUrl(doc, attachments)
                  const meta = SLOT_PROOF_META[doc.slot] || {
                    title: 'Document Proof',
                    buttonLabel: 'Preview Document',
                  }

                  const btnClasses = `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    isWrong
                      ? 'bg-rose-100/90 text-rose-800 hover:bg-rose-200/80'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200/90 hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-300'
                  }`

                  return previewUrl ? (
                    <button
                      key={`${doc.slot}-${doc.filename}`}
                      type="button"
                      onClick={() =>
                        onPreviewDoc?.({
                          title: meta.title,
                          url: previewUrl,
                        })
                      }
                      className={btnClasses}
                    >
                      <Eye
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isWrong ? 'text-rose-600' : 'text-indigo-600'
                        }`}
                      />
                      <span>{meta.buttonLabel}</span>
                    </button>
                  ) : (
                    <span
                      key={`${doc.slot}-${doc.filename}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500"
                    >
                      <Eye className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>{meta.title}</span>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Audit Notes (e.g., UK DBA Entity Resolution) */}
        {result.audit_notes && result.audit_notes.length > 0 && (
          <div className="mt-4 space-y-2">
            {result.audit_notes.map((note, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2.5 rounded-xl bg-indigo-50/80 px-3.5 py-2.5 text-xs text-indigo-950"
              >
                <Info className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-indigo-700 mr-1.5">Audit Note:</span>
                  <span>{note}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Verification Results Cards */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Verification Results</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Issues needing attention are shown first
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            {failCount > 0 && (
              <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-rose-700">
                {pluralize(failCount, 'Issue')}
              </span>
            )}
            {warnCount > 0 && (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700">
                {pluralize(warnCount, 'Warning')}
              </span>
            )}
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700">
              {passCount} Passed
            </span>
          </div>
        </div>

        {/* Prominent FAIL & WARN rules (no Expected/Found boxes, with one-click PDF preview) */}
        {attentionRules.length > 0 ? (
          <div className="space-y-3 mb-4">
            {attentionRules.map((rule) => {
              const view = formatRuleForOperator(rule)
              const relatedDoc = getRelatedDocumentForRule(rule, result.documents, attachments)
              const isWarn = rule.status === 'WARN'
              const isCritical = rule.severity === 'CRITICAL' && rule.status === 'FAIL'

              const cardStyle = isWarn
                ? 'bg-amber-50/55 border-l-4 border-l-amber-400 border-y border-r border-amber-200/70'
                : isCritical
                ? 'bg-rose-50/65 border-l-4 border-l-rose-600 border-y border-r border-rose-200/80'
                : 'bg-rose-50/40 border-l-4 border-l-rose-400 border-y border-r border-rose-200/70'

              const statusBadge = isWarn ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                  Needs Review
                </span>
              ) : isCritical ? (
                <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  Critical Risk
                </span>
              ) : (
                <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-800">
                  Action Needed
                </span>
              )

              return (
                <div
                  key={rule.rule_id}
                  className={`rounded-xl p-4 transition ${cardStyle}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500">
                        {view.category}
                      </div>
                      <div className="text-sm font-semibold text-slate-900 mt-0.5">
                        {view.title}
                      </div>
                    </div>
                    <div className="shrink-0">{statusBadge}</div>
                  </div>

                  <p className="mt-1.5 text-xs text-slate-700 leading-relaxed">
                    {view.message}
                  </p>

                  {relatedDoc && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewDoc?.({
                            title: relatedDoc.title,
                            url: relatedDoc.url,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-slate-200/90 hover:bg-indigo-50 hover:ring-indigo-300 transition shadow-2xs"
                      >
                        <Eye className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                        <span>{relatedDoc.buttonLabel}</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50/70 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              All {pluralize(passCount, 'compliance check')} passed with no issues found.
            </span>
          </div>
        )}

        {/* Collapsible Accordion for Passed Checks (Collapsed by default) */}
        {passedRules.length > 0 && (
          <div className="rounded-xl bg-slate-50/80 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPassedChecks((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-100/70 transition"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
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
                    <div key={rule.rule_id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-slate-900">
                            {view.title}
                          </span>
                          <span className="ml-2 text-[11px] text-slate-400">
                            {view.category}
                          </span>
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                          Passed
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 leading-relaxed">
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

      {/* 3. Outbound Vendor Communication Card (PENDING or REJECTED) */}
      {result.outbound_email && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-5 py-3.5 text-white">
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

          <div className="p-5 space-y-3">
            <div className="grid grid-cols-1 gap-1.5 text-xs border-b border-slate-100 pb-3">
              <div className="flex gap-2">
                <span className="w-16 shrink-0 font-medium text-slate-400">To:</span>
                <span className="text-slate-800">{result.outbound_email.to_email}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-16 shrink-0 font-medium text-slate-400">Subject:</span>
                <span className="font-semibold text-slate-900">{result.outbound_email.subject}</span>
              </div>
              {result.outbound_email.dispatched && result.outbound_email.dispatched_at && (
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 font-medium text-emerald-600">Status:</span>
                  <span className="text-xs text-emerald-700">
                    Sent on {formatTimestamp(result.outbound_email.dispatched_at)}
                  </span>
                </div>
              )}
            </div>

            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700 bg-slate-50/80 rounded-xl p-4 max-h-80 overflow-y-auto">
              {result.outbound_email.body}
            </pre>
          </div>
        </div>
      )}

      {/* 4. Collapsible Raw Audit Payload Drawer */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-soft">
        <button
          type="button"
          onClick={() => setShowRawJson((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50 transition"
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
