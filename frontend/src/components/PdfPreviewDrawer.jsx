import React, { useEffect } from 'react'
import { FileText, X } from 'lucide-react'

export default function PdfPreviewDrawer({ doc, onClose }) {
  useEffect(() => {
    if (!doc) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [doc, onClose])

  if (!doc || !doc.url) return null

  return (
    <aside
      role="dialog"
      aria-label={`${doc.title} preview`}
      className="fixed top-0 right-0 h-screen z-[60] w-full lg:w-[58%] bg-white shadow-2xl border-l border-slate-200 flex flex-col"
    >
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3.5 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <FileText className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-bold text-slate-900 truncate">
            {doc.title}
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close document preview"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Independent Scrollable PDF Viewport */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-slate-100">
        <iframe
          key={doc.url}
          src={doc.url}
          title={doc.title}
          className="w-full h-full border-0 block"
        />
      </div>
    </aside>
  )
}
