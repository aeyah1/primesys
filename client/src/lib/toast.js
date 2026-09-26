import { toast as sonner } from 'sonner'

// The app's pop-up messages (sonner). Errors stay until they are closed, so
// they can be read in full; everything else fades (the Toaster's duration).
export const toast = Object.assign((...args) => sonner(...args), sonner, {
  error: (message, options = {}) => sonner.error(message, { duration: Infinity, ...options }),
})
