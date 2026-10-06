import api from '@/lib/axios'
import { toast } from '@/lib/toast'

// Protected files (PDFs, attachments) are fetched through the shared axios
// instance, so every request carries the signed-in user's token. A failed
// request throws, so an error reply is never saved or shown as the file.

// The file name the server gave (Content-Disposition), else the fallback.
const fileNameOf = (res, fallback) => /filename="([^"]+)"/.exec(res.headers?.['content-disposition'] || '')?.[1] || fallback

// Saves what a blob URL holds under the given name.
function saveUrl(url, filename) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// Opens a server-generated PDF in a new tab. A browser that blocks the tab gets the file saved instead, so it can still be printed.
export async function openPdf(endpoint) {
  const res = await api.get(endpoint, { responseType: 'blob' })
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
  if (!window.open(url, '_blank')) {
    saveUrl(url, fileNameOf(res, 'document.pdf'))
    toast.info('The browser blocked the new tab, so the PDF was saved to your downloads instead.')
  }
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Saves a file under the given name (else the one the server gave).
export async function downloadFile(endpoint, filename) {
  const res = await api.get(endpoint, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  saveUrl(url, filename || fileNameOf(res, 'download'))
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Saves rows (arrays of cell values) as a CSV file made in the browser.
export function downloadCSV(filename, rows) {
  const csv  = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// The server's message from a failed blob request (the body arrives as a Blob).
export async function blobErrorMessage(err, fallback) {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).message || fallback } catch { return fallback }
  }
  return data?.message || fallback
}
