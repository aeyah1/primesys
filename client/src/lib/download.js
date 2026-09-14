import api from '@/lib/axios'

// Protected files (PDFs, attachments) are fetched through the shared axios
// instance, so every request carries the signed-in user's token. A failed
// request throws, so an error reply is never saved or shown as the file.

// Opens a server-generated PDF in a new tab.
export async function openPdf(endpoint) {
  const res = await api.get(endpoint, { responseType: 'blob' })
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Saves a file under the given name.
export async function downloadFile(endpoint, filename) {
  const res = await api.get(endpoint, { responseType: 'blob' })
  const url  = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
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
