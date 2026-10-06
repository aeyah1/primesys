import { useSearchParams } from 'react-router-dom'

// A list's filters kept in the URL, so back, refresh and a shared link keep the view; update() drops blank values.
export default function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const update = (changes) => setParams(prev => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(changes)) (v === '' || v == null ? next.delete(k) : next.set(k, String(v)))
    return next
  }, { replace: true })
  return [params, update]
}
