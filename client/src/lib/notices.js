import { Bell, CheckCircle2, FileText, Truck, AlertTriangle, XCircle, Clock, Package } from 'lucide-react'

// Notifications as the server sends them (utils/notify.js callers): the icon
// and label of each type, and the page each reference opens.

export const TYPE_ICON = {
  info:        FileText,
  success:     CheckCircle2,
  warning:     AlertTriangle,
  error:       XCircle,
  reminder:    Clock,
  delivered:   Truck,
  lot_updated: Package,
}
export const iconFor = (type) => TYPE_ICON[type] || Bell

export const TYPE_LABEL = {
  info:        'Update',
  success:     'Approved',
  warning:     'Needs attention',
  error:       'Not approved',
  delivered:   'Delivery',
  lot_updated: 'Award',
  reminder:    'Reminder',
}

// Keyed by notifications.reference_type. An award notice carries its lot id,
// so it opens the reader's home list.
const TYPE_LINK = {
  pr:       { to: (id) => `/pr/${id}`, label: 'Open PR' },
  lot:      { to: () => '/dashboard',  label: 'Open' },
  delivery: { to: () => '/delivery',   label: 'Open deliveries' },
}

// { to, label } for a notice's reference, or null when it points nowhere.
export function linkFor(n) {
  const link = TYPE_LINK[n.reference_type]
  return link ? { to: link.to(n.reference_id), label: link.label } : null
}
