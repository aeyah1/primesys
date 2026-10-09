import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ZoomIn, ZoomOut, Maximize2, Minimize2, Download } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { downloadFile, blobErrorMessage } from '@/lib/download'
import { openPdf } from '@/lib/pdf'
import api from '@/lib/axios'
import { previewable } from './ScanViewer'

const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const TOOL = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors'

// The size of an element, kept up to date.
function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    if (!ref.current) return undefined
    const watch = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    watch.observe(ref.current)
    return () => watch.disconnect()
  }, [ref])
  return size
}

// The scale that fits a page of width x height into the box: the whole page, or its width.
const fitScale = (fit, page, box) => (fit === 'page'
  ? Math.min(box.width / page.width, box.height / page.height)
  : box.width / page.width)

// One PDF page drawn as a picture at the given scale, sharp on high-density screens.
function PdfPage({ doc, number, zoom, box, onFit }) {
  const canvas = useRef(null)
  const [base, setBase] = useState(null)
  useEffect(() => {
    let live = true
    doc.getPage(number).then(p => { if (live) setBase({ page: p, ...p.getViewport({ scale: 1 }) }) })
    return () => { live = false }
  }, [doc, number])
  const scale = base && box.width ? (typeof zoom === 'number' ? zoom : fitScale(zoom, base, box)) : null
  useEffect(() => { if (number === 1 && base && box.width) onFit(fitScale('page', base, box), fitScale('width', base, box)) }, [number, base, box, onFit])
  useEffect(() => {
    if (!base || !scale) return undefined
    const ratio = window.devicePixelRatio || 1
    const view = base.page.getViewport({ scale: scale * ratio })
    const el = canvas.current
    el.width = Math.floor(view.width)
    el.height = Math.floor(view.height)
    el.style.width = `${Math.floor(view.width / ratio)}px`
    el.style.height = `${Math.floor(view.height / ratio)}px`
    const task = base.page.render({ canvas: el, viewport: view })
    task.promise.catch(() => {})
    return () => task.cancel()
  }, [base, scale])
  if (!base) return <Skeleton className="mx-auto h-[60vh] w-full max-w-lg" />
  return <canvas ref={canvas} className="mx-auto block bg-white shadow-md" onContextMenu={e => e.preventDefault()} />
}

// A PDF's every page, one under the other.
function PdfPages({ data, zoom, box, onFit, onPages }) {
  const [doc, setDoc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let opened = null
    setDoc(null); setFailed(false)
    openPdf(data.slice(0)).then(d => { opened = d; setDoc(d); onPages(d.numPages) }).catch(() => setFailed(true))
    return () => { opened?.loadingTask.destroy() }
  }, [data, onPages])
  if (failed) return <p className="py-16 text-center text-sm text-[--color-text-secondary]">The PDF could not be opened here.</p>
  if (!doc) return <Skeleton className="mx-auto h-[60vh] w-full max-w-lg" />
  return (
    <div className="space-y-4">
      {Array.from({ length: doc.numPages }, (_, k) => <PdfPage key={k} doc={doc} number={k + 1} zoom={zoom} box={box} onFit={onFit} />)}
    </div>
  )
}

// A picture at the given scale; a fit scale shows all of it, or its full width.
function Picture({ url, name, zoom, box, onFit }) {
  const [natural, setNatural] = useState(null)
  useEffect(() => { if (natural && box.width) onFit(fitScale('page', natural, box), fitScale('width', natural, box)) }, [natural, box, onFit])
  const scale = natural && box.width ? (typeof zoom === 'number' ? zoom : fitScale(zoom, natural, box)) : null
  return (
    <img src={url} alt={name} draggable={false} onContextMenu={e => e.preventDefault()}
      onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
      style={scale ? { width: natural.width * scale, maxWidth: 'none' } : { maxWidth: '100%' }}
      className="mx-auto block bg-white shadow-md" />
  )
}

// The pages in a scrolling box with the zoom tools; `expanded` fills the screen.
function Viewer({ file, data, url, expanded, onExpand }) {
  const box = useRef(null)
  const size = useSize(box)
  const inner = { width: Math.max(size.width - 32, 0), height: Math.max(size.height - 32, 0) }
  const [zoom, setZoom] = useState('page')
  const [fits, setFits] = useState(null)
  const [pages, setPages] = useState(null)
  const onFit = useRef((page, width) => setFits(f => (f?.page === page && f?.width === width ? f : { page, width }))).current
  const onPages = useRef((n) => setPages(n)).current
  const current = typeof zoom === 'number' ? zoom : fits?.[zoom] ?? 1
  const step = (up) => setZoom(up ? STEPS.find(s => s > current + 0.01) ?? STEPS.at(-1) : [...STEPS].reverse().find(s => s < current - 0.01) ?? STEPS[0])

  return (
    <div className={`flex flex-col ${expanded ? 'h-full' : 'h-[70vh]'}`}>
      <div className="flex flex-wrap items-center gap-1 border-b border-[--color-border] bg-[--color-surface] px-2 py-1.5">
        <button type="button" className={`${TOOL} hover:bg-[--color-overlay]`} onClick={() => step(false)} aria-label="Zoom out"><ZoomOut className="size-3.5" /></button>
        <span className="w-12 text-center text-[11px] font-semibold tabular-nums text-[--color-text-secondary]">{Math.round(current * 100)}%</span>
        <button type="button" className={`${TOOL} hover:bg-[--color-overlay]`} onClick={() => step(true)} aria-label="Zoom in"><ZoomIn className="size-3.5" /></button>
        {[['page', 'Whole page'], ['width', 'Fit width']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setZoom(key)} aria-pressed={zoom === key}
            className={`${TOOL} ${zoom === key ? 'bg-[--color-brand] text-white' : 'text-[--color-text-secondary] hover:bg-[--color-overlay]'}`}>{label}</button>
        ))}
        {pages > 1 && <span className="ml-1 text-[11px] text-[--color-text-muted]">{pages} pages</span>}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" className={`${TOOL} text-[--color-text-secondary] hover:bg-[--color-overlay]`} onClick={onExpand}>
            {expanded ? <><Minimize2 className="size-3.5" /> Close</> : <><Maximize2 className="size-3.5" /> Full screen</>}
          </button>
        </span>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto bg-[--color-canvas] p-4">
        {file.mimetype === 'application/pdf'
          ? <PdfPages data={data} zoom={zoom} box={inner} onFit={onFit} onPages={onPages} />
          : <Picture url={url} name={file.original_name} zoom={zoom} box={inner} onFit={onFit} />}
      </div>
    </div>
  )
}

/* A canvass document shown whole in the page, as pictures: every page of a
   PDF, or the photo, with zoom (whole page, fit width, 50 to 300%) and a full
   screen view. View only: no print or edit tools; other file types download. */
export default function DocumentViewer({ prId, file }) {
  const [expanded, setExpanded] = useState(false)
  const path = file ? `/pr/${prId}/attachments/${file.id}/download` : null
  const { data, isError } = useQuery({
    queryKey: ['canvass-doc', prId, file?.id],
    queryFn: () => api.get(path, { responseType: 'arraybuffer' }).then(r => r.data),
    enabled: !!file && previewable(file.mimetype),
    staleTime: Infinity,
  })
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!data || file?.mimetype === 'application/pdf') return undefined
    const made = URL.createObjectURL(new Blob([data], { type: file.mimetype }))
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [data, file])
  useEffect(() => {
    if (!expanded) return undefined
    const close = (e) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [expanded])
  const download = () => downloadFile(path, file.original_name).catch(async (err) => toast.error(await blobErrorMessage(err, 'Download failed')))

  if (!file) return <p className="px-4 py-16 text-center text-sm text-[--color-text-muted]">No canvass documents are attached yet.</p>
  if (!previewable(file.mimetype) || isError) {
    return (
      <div className="space-y-3 px-4 py-16 text-center">
        <p className="text-sm text-[--color-text-secondary]">{isError ? 'The file could not be opened here.' : 'This file type opens outside the page.'}</p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={download}><Download className="size-3.5" /> Download {file.original_name}</Button>
      </div>
    )
  }
  if (!data || (file.mimetype !== 'application/pdf' && !url)) return <Skeleton className="h-[70vh] rounded-none" />
  const viewer = (full) => <Viewer file={file} data={data} url={url} expanded={full} onExpand={() => setExpanded(!full)} />
  return (
    <>
      {viewer(false)}
      {expanded && createPortal(
        <div role="dialog" aria-modal="true" aria-label={file.original_name} className="fixed inset-0 z-[100] bg-black/70 p-3 sm:p-6">
          <div className="h-full overflow-hidden rounded-xl bg-[--color-surface] shadow-2xl">{viewer(true)}</div>
        </div>,
        document.body,
      )}
    </>
  )
}
