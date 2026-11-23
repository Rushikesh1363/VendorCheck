import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ShieldCheck,
  BookOpen,
  Activity,
  LayoutDashboard,
  Sparkles,
  AlertCircle,
  Loader2,
  Cpu,
} from 'lucide-react'
import {
  clearAllSubmissions,
  fetchHealth,
  fetchPresets,
  fetchSubmissions,
  resolveApiUrl,
  sendRemediationEmail,
  streamOnboarding,
} from './api'
import PolicyView from './components/PolicyView'
import SubmissionForm from './components/SubmissionForm'
import PipelineStepper, { getActiveChecklistItem } from './components/PipelineStepper'
import ResultView from './components/ResultView'
import AuditDashboard from './components/AuditDashboard'
import PdfPreviewDrawer from './components/PdfPreviewDrawer'

const EMPTY_FORM = {
  legal_entity_name: '',
  dba_trade_name: '',
  entity_constitution: 'Private Limited / Corp',
  country_code: '',
  billing_state: '',
  tax_id: '',
  secondary_tax_id: '',
  bank_account_holder: '',
  account_number: '',
  account_type: 'Current / Commercial',
  routing_code: '',
  contact_email: '',
  scenario_key: '',
}

const EMPTY_ATTACHMENTS = {
  tax_document: null,
  bank_document: null,
  compliance_document: null,
}

const INITIAL_STAGES = {
  1: { state: 'idle', data: null },
  2: { state: 'idle', data: null },
  3: { state: 'idle', data: null },
  4: { state: 'idle', data: null },
}

export default function App() {
  const [activeTab, setActiveTab] = useState('live')
  const [health, setHealth] = useState(null)
  const [previewDoc, setPreviewDoc] = useState(null)

  // Presets & Form state
  const [presets, setPresets] = useState([])
  const [activePresetId, setActivePresetId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [attachments, setAttachments] = useState(EMPTY_ATTACHMENTS)

  // Live Pipeline execution state
  const [isRunning, setIsRunning] = useState(false)
  const [stageStates, setStageStates] = useState(INITIAL_STAGES)
  const [currentResult, setCurrentResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [liveStatusText, setLiveStatusText] = useState('')
  const elapsedTimerRef = useRef(null)
  const stageAdvanceTimerRef = useRef(null)
  const receivedBackendEventRef = useRef(false)
  const resultsRef = useRef(null)

  const clearPipelineTimers = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (stageAdvanceTimerRef.current) {
      clearTimeout(stageAdvanceTimerRef.current)
      stageAdvanceTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => clearPipelineTimers()
  }, [clearPipelineTimers])

  // Audit Dashboard state
  const [submissions, setSubmissions] = useState([])
  const [kpis, setKpis] = useState({ total: 0, approved: 0, pending: 0, rejected: 0 })
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingDashboard, setLoadingDashboard] = useState(false)

  const loadPresetIntoForm = useCallback((preset) => {
    setActivePresetId(preset.id)
    setForm({ ...EMPTY_FORM, ...preset.form_data })
    const nextAttachments = { ...EMPTY_ATTACHMENTS }
    for (const slot of ['tax_document', 'bank_document', 'compliance_document']) {
      const meta = preset.files_meta?.[slot]
      if (meta) {
        nextAttachments[slot] = {
          type: 'preset',
          filename: meta.filename,
          previewUrl: resolveApiUrl(meta.url),
          file: null,
        }
      }
    }
    setAttachments(nextAttachments)
    setErrorMsg(null)
  }, [])

  const refreshDashboard = useCallback(
    async (statusOverride, queryOverride) => {
      setLoadingDashboard(true)
      try {
        const st = statusOverride !== undefined ? statusOverride : statusFilter
        const q = queryOverride !== undefined ? queryOverride : searchQuery
        const data = await fetchSubmissions(st, q)
        setSubmissions(data.submissions || [])
        setKpis(data.kpis || { total: 0, approved: 0, pending: 0, rejected: 0 })
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingDashboard(false)
      }
    },
    [statusFilter, searchQuery]
  )

  // Initial load: health, presets, and audit dashboard
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [h, pData] = await Promise.all([fetchHealth(), fetchPresets()])
        if (!mounted) return
        setHealth(h)
        const loadedPresets = pData.presets || []
        setPresets(loadedPresets)
      } catch (err) {
        if (mounted) {
          setErrorMsg(
            'Unable to connect to Vendorcheck backend API on port 8000. Ensure FastAPI is running.'
          )
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadPresetIntoForm])

  useEffect(() => {
    refreshDashboard()
  }, [refreshDashboard])

  const handleFormChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleAttachFile = (slot, file) => {
    const previewUrl = URL.createObjectURL(file)
    setAttachments((prev) => ({
      ...prev,
      [slot]: {
        type: 'upload',
        filename: file.name,
        previewUrl,
        file,
      },
    }))
  }

  const handleRemoveAttachment = (slot) => {
    setAttachments((prev) => ({
      ...prev,
      [slot]: null,
    }))
  }

  const handleReset = () => {
    clearPipelineTimers()
    setPreviewDoc(null)
    setActivePresetId(null)
    setForm(EMPTY_FORM)
    setAttachments(EMPTY_ATTACHMENTS)
    setStageStates(INITIAL_STAGES)
    setCurrentResult(null)
    setErrorMsg(null)
    setElapsedSeconds(0)
    setLiveStatusText('')
  }

  const handleGoHome = () => {
    clearPipelineTimers()
    setPreviewDoc(null)
    setActiveTab('live')
    setStageStates(INITIAL_STAGES)
    setCurrentResult(null)
    setErrorMsg(null)
    setElapsedSeconds(0)
    setLiveStatusText('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleRunPipeline = async () => {
    clearPipelineTimers()
    receivedBackendEventRef.current = false
    setIsRunning(true)
    setErrorMsg(null)
    setCurrentResult(null)
    setElapsedSeconds(0)

    // Immediately scroll smoothly to the live verification checklist / results panel
    if (window.innerWidth >= 1024) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const modelLabel = health?.gemini_configured
      ? 'Gemini 3.5 Flash-Lite'
      : 'pdfplumber OCR fallback'

    // Immediately highlight Stage 1 as actively running
    setStageStates({
      1: {
        state: 'running',
        data: null,
        runningMessage: `Classifying PDFs via ${modelLabel}...`,
      },
      2: { state: 'idle', data: null },
      3: { state: 'idle', data: null },
      4: { state: 'idle', data: null },
    })
    setLiveStatusText(
      `Stage 1 of 4 · Intake & Doc Classification — Inspecting & classifying PDFs with ${modelLabel}...`
    )

    // Start live-ticking elapsed timer (100ms resolution)
    const runStart = performance.now()
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds((performance.now() - runStart) / 1000)
    }, 100)

    // Smoothly advance active highlight to Stage 2 after ~2s while awaiting backend response
    stageAdvanceTimerRef.current = setTimeout(() => {
      if (receivedBackendEventRef.current) return
      setStageStates((prev) => ({
        ...prev,
        1: prev[1]?.state === 'done' ? prev[1] : { state: 'optimistic_done', data: null },
        2:
          prev[2]?.state === 'done'
            ? prev[2]
            : {
                state: 'running',
                data: null,
                runningMessage: `Calling ${modelLabel}...`,
              },
      }))
      setLiveStatusText(
        `Stage 2 of 4 · Multimodal Field Extraction — Calling ${modelLabel} for structured JSON extraction...`
      )
    }, 2000)

    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => {
      if (v !== null && v !== undefined) {
        fd.append(k, String(v))
      }
    })

    const presetFieldMap = {
      tax_document: 'tax_preset_file',
      bank_document: 'bank_preset_file',
      compliance_document: 'compliance_preset_file',
    }

    for (const slot of ['tax_document', 'bank_document', 'compliance_document']) {
      const att = attachments[slot]
      if (!att) continue
      if (att.type === 'upload' && att.file) {
        fd.append(slot, att.file, att.filename)
      } else if (att.type === 'preset' && att.filename) {
        fd.append(presetFieldMap[slot], att.filename)
      }
    }

    const STAGE_STATUS_LABELS = {
      1: `Stage 1 of 4 · Intake & Doc Classification — Verifying PDF types via ${modelLabel}...`,
      2: `Stage 2 of 4 · Multimodal Field Extraction — Extracting structured JSON via ${modelLabel}...`,
      3: 'Stage 3 of 4 · Cross-Field & Jurisdiction Rules — Running deterministic tax, fraud & expiry checks...',
      4: 'Stage 4 of 4 · Decision & Remediation — Routing final approval & drafting vendor notices...',
    }

    try {
      const finalRes = await streamOnboarding(fd, (ev) => {
        if (!receivedBackendEventRef.current) {
          receivedBackendEventRef.current = true
          if (stageAdvanceTimerRef.current) {
            clearTimeout(stageAdvanceTimerRef.current)
            stageAdvanceTimerRef.current = null
          }
        }

        if (ev.event === 'stage_start') {
          setStageStates((prev) => ({
            ...prev,
            [ev.stage_number]: { state: 'running', data: null },
          }))
          if (STAGE_STATUS_LABELS[ev.stage_number]) {
            setLiveStatusText(STAGE_STATUS_LABELS[ev.stage_number])
          }
        } else if (ev.event === 'stage_complete') {
          setStageStates((prev) => ({
            ...prev,
            [ev.stage.stage_number]: { state: 'done', data: ev.stage },
          }))
        } else if (ev.event === 'complete') {
          if (ev.result?.stages?.length) {
            const finalStages = { ...INITIAL_STAGES }
            for (const st of ev.result.stages) {
              finalStages[st.stage_number] = { state: 'done', data: st }
            }
            setStageStates(finalStages)
          }
          setCurrentResult(ev.result)
        }
      })

      if (finalRes) {
        if (finalRes.stages?.length) {
          const finalStages = { ...INITIAL_STAGES }
          for (const st of finalRes.stages) {
            finalStages[st.stage_number] = { state: 'done', data: st }
          }
          setStageStates(finalStages)
        }
        setCurrentResult(finalRes)
        refreshDashboard()
      }
    } catch (err) {
      setErrorMsg(err.message || 'Verification pipeline encountered an unexpected error.')
      setStageStates(INITIAL_STAGES)
    } finally {
      clearPipelineTimers()
      setIsRunning(false)
    }
  }

  const handleSendEmail = async (submissionId) => {
    const res = await sendRemediationEmail(submissionId)
    if (res?.submission) {
      if (currentResult?.submission_id === submissionId) {
        setCurrentResult(res.submission)
      }
      refreshDashboard()
    }
  }

  const handleClearAll = async () => {
    await clearAllSubmissions()
    refreshDashboard()
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Executive Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between gap-4">
            {/* Brand */}
            <button
              type="button"
              onClick={handleGoHome}
              title="Go to Home"
              className="flex items-center gap-2.5 min-w-0 text-left group focus:outline-none cursor-pointer"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-slate-900 text-white shadow-sm group-hover:opacity-90 group-active:scale-95 transition">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex flex-col justify-center">
                <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-tight truncate group-hover:text-indigo-700 transition">
                  Vendorcheck
                </h1>
                <p className="text-[11px] font-medium text-slate-500 leading-tight truncate">
                  Automated Vendor Onboarding &amp; Verification
                </p>
              </div>
            </button>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 shrink-0">
              <nav className="flex items-center rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('live')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    activeTab === 'live'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Activity className="h-3.5 w-3.5 text-indigo-600" />
                  Live Onboarding Run
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('dashboard')
                    refreshDashboard()
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    activeTab === 'dashboard'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutDashboard className="h-3.5 w-3.5 text-indigo-600" />
                  Audit Dashboard
                  <span className="ml-0.5 rounded-full bg-indigo-100 px-1.5 py-0.2 text-[10px] font-extrabold text-indigo-700">
                    {kpis.total}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('policy')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    activeTab === 'policy'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
                  <span className="hidden sm:inline">Policy &amp; Assumptions</span>
                  <span className="sm:hidden">Policy</span>
                </button>
              </nav>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 sm:px-6 lg:px-8 py-7">
        {errorMsg && (
          <div className="mb-6 flex items-center gap-2.5 rounded-xl bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {activeTab === 'live' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
            {/* Left Column: Vendor Submission Portal */}
            <div className="lg:col-span-5 space-y-3">
              <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/40 px-3.5 py-2.5">
                <span className="inline-flex items-center rounded-full bg-indigo-100/90 border border-indigo-200/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-800">
                  VENDOR PORTAL · SIMULATED INPUT
                </span>
                <p className="mt-1 text-[11px] text-slate-600 leading-snug">
                  Represents the form &amp; documents submitted by the vendor (use a preset or
                  upload custom PDFs to test).
                </p>
              </div>

              <SubmissionForm
                presets={presets}
                activePresetId={activePresetId}
                onSelectPreset={loadPresetIntoForm}
                form={form}
                onFormChange={handleFormChange}
                attachments={attachments}
                onAttachFile={handleAttachFile}
                onRemoveAttachment={handleRemoveAttachment}
                onPreviewDoc={setPreviewDoc}
                onReset={handleReset}
                onRunPipeline={handleRunPipeline}
                isRunning={isRunning}
              />
            </div>

            {/* Right Column: Live Execution View */}
            <div ref={resultsRef} className="lg:col-span-7 space-y-4 scroll-mt-20">
              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 px-3.5 py-2.5">
                <span className="inline-flex items-center rounded-full bg-emerald-100/90 border border-emerald-200/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  INTERNAL PROCUREMENT VIEW · ENGINE OUTPUT
                </span>
                <p className="mt-1 text-[11px] text-slate-600 leading-snug">
                  Automated verification results, audit notes, and vendor follow-up draft visible
                  only to internal Ops.
                </p>
              </div>

              {!isRunning && !currentResult ? (
                <div className="rounded-2xl border border-indigo-200/80 border-t-4 border-t-indigo-600 bg-gradient-to-b from-indigo-50/60 to-white p-6 shadow-sm">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <h3 className="text-base font-semibold text-indigo-950">
                      Ready for Autonomous Vendor Verification
                    </h3>
                  </div>

                  <div className="bg-white/90 border border-indigo-100 rounded-lg p-3.5 mt-3 space-y-2.5 text-xs text-slate-600 leading-relaxed">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-700">
                        1
                      </span>
                      <p>
                        <span className="font-semibold text-slate-900">
                          Pick a test case on the left
                        </span>{' '}
                        — Click any Sample Scenario button to auto-fill the form (or enter your own
                        vendor details &amp; PDFs).
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-700">
                        2
                      </span>
                      <p>
                        <span className="font-semibold text-slate-900">
                          Scroll to the bottom &amp; submit
                        </span>{' '}
                        — Scroll to the end of the left form and click the{' '}
                        <span className="font-semibold text-slate-900">Run Verification</span>{' '}
                        button to start the pipeline.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-indigo-100/80">
                    <div className="text-xs font-semibold text-slate-700 mb-3">
                      What happens when you run verification:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-white border border-slate-200/80 rounded-lg p-3.5">
                        <div className="text-xs font-semibold text-slate-900">
                          1. Document Reading
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                          Extracts tax IDs, legal names, and banking details directly from uploaded
                          PDFs.
                        </p>
                      </div>
                      <div className="bg-white border border-slate-200/80 rounded-lg p-3.5">
                        <div className="text-xs font-semibold text-slate-900">
                          2. Completeness Check
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                          Confirms mandatory jurisdiction fields and verifies the correct proof
                          types were attached.
                        </p>
                      </div>
                      <div className="bg-white border border-slate-200/80 rounded-lg p-3.5">
                        <div className="text-xs font-semibold text-slate-900">
                          3. Fraud &amp; Policy Rules
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                          Cross-checks expiry dates, trade vs. legal names, entity PAN types, bank
                          ownership, and duplicates.
                        </p>
                      </div>
                      <div className="bg-white border border-slate-200/80 rounded-lg p-3.5">
                        <div className="text-xs font-semibold text-slate-900">
                          4. Decision &amp; Outreach
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                          Assigns an audit status (Approved, Pending, or Rejected) and drafts the
                          vendor response email.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <PipelineStepper
                    result={currentResult}
                    isRunning={isRunning}
                    elapsedSeconds={elapsedSeconds}
                  />

                  {currentResult ? (
                    <ResultView
                      result={currentResult}
                      attachments={attachments}
                      onSendEmail={handleSendEmail}
                      onPreviewDoc={setPreviewDoc}
                    />
                  ) : isRunning ? (
                    (() => {
                      const activeStep = getActiveChecklistItem(elapsedSeconds)
                      return (
                        <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-b from-indigo-50/50 via-white to-white p-10 text-center shadow-soft">
                          <div className="relative mx-auto flex h-14 w-14 items-center justify-center mb-4">
                            <span className="absolute inset-0 rounded-full bg-indigo-400/20 animate-ping" />
                            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">
                              <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                          </div>
                          <h3 className="text-base font-bold text-slate-900">
                            Verification in Progress
                          </h3>
                          <p className="mt-1.5 text-[11px] font-semibold text-indigo-500">
                            {activeStep.item.phaseLabel}
                          </p>
                          <p className="mt-1 text-xs font-medium text-slate-700 max-w-md mx-auto leading-relaxed">
                            {activeStep.item.label}...
                          </p>
                          <div className="mt-4 inline-flex items-center justify-center">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700 tabular-nums">
                              Elapsed: {elapsedSeconds.toFixed(1)}s
                            </span>
                          </div>
                        </div>
                      )
                    })()
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : activeTab === 'dashboard' ? (
          <AuditDashboard
            submissions={submissions}
            kpis={kpis}
            statusFilter={statusFilter}
            searchQuery={searchQuery}
            onStatusFilterChange={(st) => {
              setStatusFilter(st)
              refreshDashboard(st, searchQuery)
            }}
            onSearchChange={(q) => {
              setSearchQuery(q)
              refreshDashboard(statusFilter, q)
            }}
            onRefresh={() => refreshDashboard()}
            onClearAll={handleClearAll}
            onSendEmail={handleSendEmail}
            onPreviewDoc={setPreviewDoc}
            loading={loadingDashboard}
          />
        ) : (
          <PolicyView health={health} />
        )}
      </main>

      <PdfPreviewDrawer doc={previewDoc} onClose={() => setPreviewDoc(null)} />
    </div>
  )
}
