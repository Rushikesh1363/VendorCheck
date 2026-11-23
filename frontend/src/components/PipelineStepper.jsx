import React, { useEffect, useMemo, useRef } from 'react'
import {
  Check,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Clock,
  MinusCircle,
  Circle,
} from 'lucide-react'
import { formatDuration, pluralize } from '../utils/formatters'

export const CHECKLIST_PHASES = [
  {
    id: 'step_1',
    label: 'Step 1 · Reading Documents',
    items: [
      {
        id: 'p2_tax_ocr',
        label: 'Reading tax registration details',
        startSec: 0.0,
      },
      {
        id: 'p2_bank_ocr',
        label: 'Reading bank account details',
        startSec: 2.6,
      },
    ],
  },
  {
    id: 'step_2',
    label: 'Step 2 · Document Check',
    items: [
      {
        id: 'p1_form',
        label: 'Checking required form fields',
        startSec: 5.2,
      },
      {
        id: 'p1_classify',
        label: 'Confirming the right documents were uploaded',
        startSec: 6.1,
      },
    ],
  },
  {
    id: 'step_3',
    label: 'Step 3 · Verification & Fraud Checks',
    items: [
      {
        id: 'p1_validity',
        label: 'Checking certificate expiry dates',
        startSec: 6.9,
      },
      {
        id: 'p3_entity',
        label: 'Matching company and trade names',
        startSec: 7.5,
      },
      {
        id: 'p3_jurisdiction',
        label: 'Verifying tax ID and billing location',
        startSec: 8.1,
      },
      {
        id: 'p3_pan_const',
        label: 'Checking PAN and business type',
        startSec: 8.7,
      },
      {
        id: 'p3_beneficiary',
        label: 'Confirming bank account ownership & number match',
        startSec: 9.3,
      },
      {
        id: 'p3_duplicate',
        label: 'Checking for duplicate vendors or bank accounts',
        startSec: 10.0,
      },
    ],
  },
  {
    id: 'step_4',
    label: 'Step 4 · Final Decision',
    items: [
      {
        id: 'p4_decision',
        label: 'Setting approval status and drafting vendor email',
        startSec: 10.6,
      },
    ],
  },
]

const FLAT_ITEMS = CHECKLIST_PHASES.flatMap((p) =>
  p.items.map((item) => ({ ...item, phaseId: p.id, phaseLabel: p.label }))
)

export function getActiveChecklistItem(elapsedSeconds) {
  let activeIdx = 0
  for (let i = 0; i < FLAT_ITEMS.length; i++) {
    if (elapsedSeconds >= FLAT_ITEMS[i].startSec) {
      activeIdx = i
    }
  }
  return { index: activeIdx, item: FLAT_ITEMS[activeIdx] }
}

function aggregateRules(rulesMap, ids) {
  const present = ids.map((id) => rulesMap[id]).filter(Boolean)
  if (present.length === 0) return null
  if (present.some((r) => r.status === 'FAIL')) {
    const hasCrit = present.some((r) => r.status === 'FAIL' && r.severity === 'CRITICAL')
    return { status: 'fail', critical: hasCrit }
  }
  if (present.some((r) => r.status === 'WARN')) return { status: 'warn', critical: false }
  return { status: 'pass', critical: false }
}

function evaluateResultChecklist(result) {
  if (!result) return {}

  const rulesMap = {}
  for (const r of result.rule_checks || []) {
    rulesMap[r.rule_id] = r
  }

  const out = {}

  // 1. Checking required form fields
  const formRes = aggregateRules(rulesMap, [
    'R1_FORM_COMPLETENESS',
    'R2_IN_PAN_FORMAT',
    'R2_IN_GSTIN_FORMAT',
    'R2_IN_IFSC',
    'R2_US_EIN',
    'R2_US_ABA',
    'R2_UK_VAT',
    'R2_UK_SORT_CODE',
    'R2_AE_TRN',
    'R2_AU_ABN',
  ])
  out.p1_form = formRes
    ? {
        status: formRes.status,
        tag:
          formRes.status === 'fail'
            ? rulesMap.R1_FORM_COMPLETENESS?.status === 'FAIL'
              ? 'Missing fields'
              : 'Invalid format'
            : 'Complete',
      }
    : { status: 'skip', tag: 'Skipped' }

  // 2. Confirming the right documents were uploaded
  const clsRes = aggregateRules(rulesMap, [
    'R1_TAX_DOC_TYPE',
    'R1_BANK_DOC_TYPE',
    'R1_COMPLIANCE_DOC_TYPE',
  ])
  const docCount = (result.documents || []).length
  out.p1_classify = clsRes
    ? {
        status: clsRes.status,
        tag:
          clsRes.status === 'fail'
            ? 'Wrong or missing file'
            : `${pluralize(docCount, 'file')} confirmed`,
      }
    : { status: 'skip', tag: 'No files' }

  // 3. Checking certificate expiry dates
  const valRes = aggregateRules(rulesMap, ['R4_DOCUMENT_VALIDITY'])
  out.p1_validity = valRes
    ? {
        status: valRes.status,
        tag: valRes.status === 'fail' ? 'Expired' : 'Up to date',
      }
    : { status: 'skip', tag: 'Skipped' }

  // 4. Reading tax registration details
  if (result.extracted?.tax_doc) {
    out.p2_tax_ocr = {
      status: 'pass',
      tag: 'Details read',
    }
  } else {
    out.p2_tax_ocr = {
      status: 'skip',
      tag: 'Skipped',
    }
  }

  // 5. Reading bank account details
  if (result.extracted?.bank_doc) {
    out.p2_bank_ocr = {
      status: 'pass',
      tag: 'Details read',
    }
  } else {
    out.p2_bank_ocr = {
      status: 'skip',
      tag: 'Skipped',
    }
  }

  // 6. Matching company and trade names
  if (rulesMap.R3_CRITICAL_FRAUD_MISMATCH?.status === 'FAIL') {
    out.p3_entity = { status: 'fail', tag: 'Name mismatch' }
  } else if (rulesMap.R3_BENEFICIARY_MATCH?.status === 'PASS') {
    const hasDbaNote = (result.audit_notes || []).some((n) =>
      n.toLowerCase().includes('dba')
    )
    out.p3_entity = {
      status: 'pass',
      tag: hasDbaNote ? 'Trade name matched' : 'Matched',
    }
  } else {
    out.p3_entity = { status: 'skip', tag: 'Skipped' }
  }

  // 7. Verifying tax ID and billing location
  const jurRes = aggregateRules(rulesMap, [
    'R2_IN_GSTIN_STATE',
    'R2_CROSS_BORDER_POLICY',
    'R2_TAX_DOC_CROSSMATCH',
    'R2_US_EIN',
    'R2_UK_VAT',
    'R2_AE_TRN',
    'R2_AU_ABN',
  ])
  out.p3_jurisdiction = jurRes
    ? {
        status: jurRes.status,
        tag:
          jurRes.status === 'fail'
            ? rulesMap.R2_IN_GSTIN_STATE?.status === 'FAIL'
              ? 'State mismatch'
              : rulesMap.R2_CROSS_BORDER_POLICY?.status === 'FAIL'
              ? 'Wrong format'
              : 'Tax ID mismatch'
            : 'Verified',
      }
    : { status: 'skip', tag: 'Not applicable' }

  // 8. Checking PAN and business type
  const panRes = aggregateRules(rulesMap, [
    'R2_IN_PAN_CONSTITUTION',
    'R2_IN_GSTIN_PAN_LINK',
  ])
  out.p3_pan_const = panRes
    ? {
        status: panRes.status,
        tag:
          panRes.status === 'fail'
            ? panRes.critical
              ? 'High risk'
              : 'Type mismatch'
            : 'Verified',
      }
    : { status: 'skip', tag: 'Not applicable' }

  // 9. Confirming bank account ownership
  const benRes = aggregateRules(rulesMap, [
    'R3_CRITICAL_FRAUD_MISMATCH',
    'R3_BENEFICIARY_MATCH',
    'R3_BANK_COORDS_MATCH',
    'R3_CORP_ACCOUNT_TYPE',
  ])
  out.p3_beneficiary = benRes
    ? {
        status: benRes.status,
        tag:
          benRes.status === 'fail'
            ? benRes.critical
              ? 'Name mismatch'
              : 'Account issue'
            : benRes.status === 'warn'
            ? 'Waiting for bank proof'
            : 'Confirmed',
      }
    : { status: 'skip', tag: 'Skipped' }

  // 10. Checking for duplicate vendors or bank accounts
  const dupRes = aggregateRules(rulesMap, [
    'R5_DUPLICATE_BANK_ACCOUNT',
    'R5_DUPLICATE_TAX_ID',
  ])
  out.p3_duplicate = dupRes
    ? {
        status: dupRes.status,
        tag:
          dupRes.status === 'fail'
            ? rulesMap.R5_DUPLICATE_BANK_ACCOUNT?.status === 'FAIL'
              ? 'Duplicate bank account'
              : 'Duplicate Tax ID'
            : 'Unique',
      }
    : { status: 'skip', tag: 'Skipped' }

  // 11. Setting approval status and drafting vendor email
  const dec = result.decision
  if (dec === 'APPROVED') {
    out.p4_decision = { status: 'pass', tag: 'Approved' }
  } else if (dec === 'PENDING') {
    out.p4_decision = { status: 'warn', tag: 'Pending · Email ready' }
  } else if (dec === 'REJECTED') {
    out.p4_decision = { status: 'fail', tag: 'Rejected · Escalated' }
  } else {
    out.p4_decision = { status: 'skip', tag: 'Pending' }
  }

  return out
}

function StepIcon({ status }) {
  if (status === 'running') {
    return <Loader2 className="h-3.5 w-3.5 text-indigo-600 animate-spin shrink-0" />
  }
  if (status === 'pass') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
  }
  if (status === 'optimistic_pass') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
  }
  if (status === 'fail') {
    return <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
  }
  if (status === 'warn') {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
  }
  if (status === 'skip') {
    return <MinusCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
  }
  return <Circle className="h-3 w-3 text-slate-300 shrink-0" />
}

export default function PipelineStepper({
  result = null,
  isRunning = false,
  elapsedSeconds = 0,
}) {
  const finalStatusMap = useMemo(() => evaluateResultChecklist(result), [result])
  const { index: activeIndex, item: activeItem } = useMemo(
    () => getActiveChecklistItem(elapsedSeconds),
    [elapsedSeconds]
  )
  const activePhaseId = isRunning ? activeItem?.phaseId ?? null : null
  const stepRefs = useRef({})
  const lastScrolledPhaseRef = useRef(null)

  useEffect(() => {
    if (!isRunning || !activePhaseId) {
      lastScrolledPhaseRef.current = null
      return
    }
    if (lastScrolledPhaseRef.current === activePhaseId) return
    const prevPhase = lastScrolledPhaseRef.current
    lastScrolledPhaseRef.current = activePhaseId

    // Run trigger already scrolls cleanly to the Verification Progress header + Step 1.
    // Smoothly keep each subsequent active step in view once per step transition.
    if (!prevPhase && activePhaseId === 'step_1') return

    const el = stepRefs.current[activePhaseId]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isRunning, activePhaseId])

  const flatIndexById = useMemo(() => {
    const map = {}
    FLAT_ITEMS.forEach((item, idx) => {
      map[item.id] = idx
    })
    return map
  }, [])

  const summaryCounts = useMemo(() => {
    if (!result || isRunning) return null
    const vals = Object.values(finalStatusMap)
    return {
      pass: vals.filter((v) => v.status === 'pass').length,
      fail: vals.filter((v) => v.status === 'fail').length,
      warn: vals.filter((v) => v.status === 'warn').length,
    }
  }, [result, isRunning, finalStatusMap])

  const progressPct = useMemo(() => {
    if (isRunning) {
      return Math.min(
        95,
        Math.max(8, Math.round(((activeIndex + 0.6) / FLAT_ITEMS.length) * 100))
      )
    }
    if (result) return 100
    return 0
  }, [isRunning, activeIndex, result])

  const progressBarColor = useMemo(() => {
    if (isRunning) return 'bg-indigo-500'
    if (!result) return 'bg-slate-200'
    if (result.decision === 'APPROVED') return 'bg-emerald-500'
    if (result.decision === 'REJECTED') return 'bg-rose-500'
    return 'bg-amber-500'
  }, [isRunning, result])

  return (
    <div
      className={`rounded-2xl border bg-white transition-colors ${
        isRunning ? 'border-indigo-200' : 'border-slate-200'
      }`}
    >
      {/* Header + 4px Top Progress Bar */}
      <div className="px-5 pt-4 pb-3.5 border-b border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Verification Progress
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Checking documents, details, and compliance rules
            </p>
          </div>

          {isRunning ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white tabular-nums">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span>Checking</span>
              <span className="text-indigo-200">•</span>
              <span>{elapsedSeconds.toFixed(1)}s</span>
            </span>
          ) : result ? (
            <div className="flex items-center gap-2">
              {summaryCounts && (
                <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium">
                  <span className="rounded-full bg-emerald-50 border border-emerald-200/70 px-2.5 py-0.5 text-emerald-700">
                    {summaryCounts.pass} passed
                  </span>
                  {summaryCounts.fail > 0 && (
                    <span className="rounded-full bg-rose-50 border border-rose-200/70 px-2.5 py-0.5 text-rose-700">
                      {pluralize(summaryCounts.fail, 'issue')}
                    </span>
                  )}
                  {summaryCounts.warn > 0 && (
                    <span className="rounded-full bg-amber-50 border border-amber-200/70 px-2.5 py-0.5 text-amber-700">
                      {pluralize(summaryCounts.warn, 'warning')}
                    </span>
                  )}
                </div>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200/70 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                <Clock className="h-3 w-3 text-slate-400" />
                {formatDuration(result.total_latency_ms)}
              </span>
            </div>
          ) : (
            <span className="rounded-full bg-slate-100 border border-slate-200/70 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
              Ready
            </span>
          )}
        </div>

        {/* Sleek 4px proportional progress bar directly beneath header */}
        <div
          className="mt-3 h-1 w-full rounded-full bg-slate-100 overflow-hidden"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Verification progress"
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ease-out ${progressBarColor}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Vertical Pipeline Stepper + Inset Stage Containers */}
      <div className="px-5 py-4">
        {CHECKLIST_PHASES.map((phase, phaseIdx) => {
          const isLastPhase = phaseIdx === CHECKLIST_PHASES.length - 1
          const isFinalPhase = phase.id === 'step_4'

          // Resolve per-item statuses for this stage
          const resolvedItems = phase.items.map((item) => {
            const idx = flatIndexById[item.id]
            let status = 'idle'
            let tag = ''

            if (isRunning) {
              if (idx < activeIndex) {
                status = 'optimistic_pass'
                tag = 'Done'
              } else if (idx === activeIndex) {
                status = 'running'
                tag = 'Checking...'
              }
            } else if (result && finalStatusMap[item.id]) {
              status = finalStatusMap[item.id].status
              tag = finalStatusMap[item.id].tag
            }

            return { ...item, status, tag }
          })

          // Derive stage badge state and stage counter
          let stageState = 'idle'
          let stageCounter = ''

          if (isRunning) {
            const doneInPhase = resolvedItems.filter(
              (i) => i.status === 'optimistic_pass'
            ).length
            const runningInPhase = resolvedItems.some((i) => i.status === 'running')
            if (doneInPhase === resolvedItems.length) {
              stageState = 'optimistic_done'
              stageCounter = `${doneInPhase}/${resolvedItems.length} done`
            } else if (runningInPhase || doneInPhase > 0) {
              stageState = 'running'
              stageCounter = `${doneInPhase}/${resolvedItems.length}`
            }
          } else if (result) {
            const hasFail = resolvedItems.some((i) => i.status === 'fail')
            const hasWarn = resolvedItems.some((i) => i.status === 'warn')
            const applicable = resolvedItems.filter((i) => i.status !== 'skip')
            const passedCnt = applicable.filter((i) => i.status === 'pass').length

            if (hasFail) {
              stageState = 'fail'
            } else if (hasWarn) {
              stageState = 'warn'
            } else if (applicable.length > 0 && passedCnt === applicable.length) {
              stageState = 'pass'
            } else {
              stageState = 'skip'
            }

            if (applicable.length === 0) {
              stageCounter = 'Skipped'
            } else {
              stageCounter = `${passedCnt}/${applicable.length} passed`
            }
          }

          // Numbered circular badge styles
          let badgeClass =
            'bg-slate-100 text-slate-600 border border-slate-200'
          if (stageState === 'pass') {
            badgeClass =
              'bg-emerald-50 text-emerald-700 border border-emerald-200'
          } else if (stageState === 'fail') {
            badgeClass = 'bg-rose-50 text-rose-700 border border-rose-200'
          } else if (stageState === 'warn') {
            badgeClass = 'bg-amber-50 text-amber-700 border border-amber-200'
          } else if (stageState === 'running') {
            badgeClass =
              'bg-indigo-50 text-indigo-700 border border-indigo-300'
          }

          // Inset stage container styling (with Final Decision outcome tint)
          let containerClass =
            'bg-slate-50/60 border border-slate-200/80 divide-y divide-slate-200/60'
          if (isFinalPhase && result && !isRunning) {
            if (result.decision === 'APPROVED') {
              containerClass =
                'bg-emerald-50/50 border border-emerald-200 divide-y divide-emerald-200/60'
            } else if (result.decision === 'REJECTED') {
              containerClass =
                'bg-rose-50/50 border border-rose-200 divide-y divide-rose-200/60'
            } else {
              containerClass =
                'bg-amber-50/50 border border-amber-200 divide-y divide-amber-200/60'
            }
          }

          return (
            <div
              key={phase.id}
              ref={(el) => {
                stepRefs.current[phase.id] = el
              }}
              className={`flex gap-3 scroll-mt-24 ${isLastPhase ? '' : 'pb-3.5'}`}
            >
              {/* Left gutter: circular numbered badge + vertical connector line */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${badgeClass}`}
                >
                  {stageState === 'pass' ? (
                    <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                  ) : (
                    phaseIdx + 1
                  )}
                </div>
                {!isLastPhase && (
                  <div className="mt-1 flex-1 border-l-2 border-slate-200" />
                )}
              </div>

              {/* Right column: Stage header + inset checklist card */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[24px]">
                  <span className="text-xs font-semibold text-slate-700 truncate">
                    {phase.label}
                  </span>
                  {stageCounter && (
                    <span className="shrink-0 text-[11px] font-medium text-slate-400">
                      {stageCounter}
                    </span>
                  )}
                </div>

                <ul className={`rounded-lg overflow-hidden ${containerClass}`}>
                  {resolvedItems.map((item) => {
                    const { status, tag } = item

                    const rowTextClass =
                      status === 'running'
                        ? 'bg-indigo-50/60 text-indigo-950 font-semibold'
                        : status === 'fail'
                        ? 'text-rose-950 font-medium hover:bg-white/80'
                        : status === 'warn'
                        ? 'text-amber-950 font-medium hover:bg-white/80'
                        : status === 'skip'
                        ? 'text-slate-400 hover:bg-white/80'
                        : status === 'pass'
                        ? 'text-slate-700 hover:bg-white/80'
                        : 'text-slate-500 hover:bg-white/80'

                    let pillClass =
                      'bg-slate-100 text-slate-500 border-slate-200/70'
                    if (status === 'pass') {
                      pillClass =
                        'bg-emerald-50 text-emerald-700 border-emerald-200/70'
                    } else if (status === 'warn') {
                      pillClass =
                        'bg-amber-50 text-amber-700 border-amber-200/70'
                    } else if (status === 'fail') {
                      pillClass =
                        'bg-rose-50 text-rose-700 border-rose-200/70'
                    } else if (status === 'running') {
                      pillClass =
                        'bg-indigo-50 text-indigo-700 border-indigo-200/70'
                    } else if (status === 'skip' || status === 'optimistic_pass') {
                      pillClass =
                        'bg-slate-100 text-slate-500 border-slate-200/70'
                    }

                    return (
                      <li
                        key={item.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2 text-xs transition-colors ${rowTextClass}`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <StepIcon status={status} />
                          <span className="truncate">{item.label}</span>
                        </div>
                        {tag && (
                          <span
                            className={`shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full border whitespace-nowrap ${pillClass}`}
                          >
                            {tag}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
