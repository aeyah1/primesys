import { Component } from 'react'
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react'
import { Button } from '@/components/ui/button'

// A page whose file is gone after an update (a tab left open while PRimeSys was updated) reloads once by itself.
const STALE = /dynamically imported module|Importing a module script failed|module script|Loading chunk/i
const RELOADED = 'primesys_reloaded_at'

function reloadOnce() {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOADED)) || 0 } catch { /* storage blocked: reload anyway */ }
  if (Date.now() - last < 30_000) return false
  try { sessionStorage.setItem(RELOADED, String(Date.now())) } catch { /* storage blocked */ }
  window.location.reload()
  return true
}

/* Catches a page that crashes, so the person gets a way back instead of a blank screen: Reload, or the Dashboard.
   `full` fills the window (around the whole app); otherwise it sits in the page area and the menu stays usable.
   A new `resetKey` (the address) clears it, so going to another page works again. */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error) {
    console.error(error)
    if (STALE.test(error?.message || '')) reloadOnce()
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={`flex items-center justify-center px-4 ${this.props.full ? 'min-h-screen' : 'py-16'}`}
        style={this.props.full ? { background: 'var(--color-canvas)' } : undefined}>
        <div className="w-full max-w-md rounded-2xl border border-[--color-border] bg-[--color-surface] p-8 text-center shadow-lg">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="size-6 text-red-600" />
          </div>
          <h1 className="mt-4 text-ui-xl font-bold text-[--color-text-primary]">Something went wrong on this page</h1>
          <p className="mt-2 text-sm text-[--color-text-secondary]">
            Reload the page, or go back to My tasks. If it keeps happening, tell your administrator what you were doing.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => { window.location.href = '/dashboard' }}>
              <LayoutDashboard className="size-3.5" /> Go to My tasks
            </Button>
            <Button className="gap-1.5" onClick={() => window.location.reload()}><RefreshCw className="size-3.5" /> Reload</Button>
          </div>
        </div>
      </div>
    )
  }
}
