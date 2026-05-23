import { useState } from 'react'
import {
  BookOpen, FileText, Gavel, ShoppingCart, Truck,
  Users, CheckCircle, ArrowRight, ChevronDown, ChevronUp,
  ClipboardList, Trophy, Package, Send, Eye, Pencil,
  Trash2, Bell, Clock, Download, Shield,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'

const ROLE_LABELS = {
  admin:       'Administrator',
  procurement: 'Procurement Officer',
  extension:   'Extension Officer',
  supply:      'Supply Officer',
}

const ROLE_COLORS = {
  admin:       'bg-purple-50 border-purple-200 text-purple-800',
  procurement: 'bg-blue-50 border-blue-200 text-blue-800',
  extension:   'bg-amber-50 border-amber-200 text-amber-800',
  supply:      'bg-emerald-50 border-emerald-200 text-emerald-800',
}

function Section({ icon: Icon, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-[--color-brand]" />
          <span className="font-semibold text-[--color-text-primary] text-base">{title}</span>
        </div>
        {open ? <ChevronUp className="size-4 text-[--color-text-muted]" /> : <ChevronDown className="size-4 text-[--color-text-muted]" />}
      </button>
      {open && (
        <CardContent className="pt-0 pb-5 px-5 border-t border-[--color-border]">
          {children}
        </CardContent>
      )}
    </Card>
  )
}

function Step({ number, title, description, icon: Icon, color = 'bg-[--color-brand]' }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${color} text-white font-bold text-sm`}>
          {number}
        </div>
        <div className="w-px flex-1 bg-[--color-border] mt-2" />
      </div>
      <div className="pb-6">
        <div className="flex items-center gap-2 mb-1">
          {Icon && <Icon className="size-4 text-[--color-text-muted]" />}
          <p className="font-semibold text-[--color-text-primary]">{title}</p>
        </div>
        <p className="text-sm text-[--color-text-secondary] leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function Tip({ children }) {
  return (
    <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800 mt-3">
      <Bell className="size-4 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

function Feature({ icon: Icon, title, description }) {
  return (
    <div className="flex gap-3 py-3 border-b border-[--color-border] last:border-0">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[--color-surface-raised]">
        <Icon className="size-4 text-[--color-brand]" />
      </div>
      <div>
        <p className="font-semibold text-[--color-text-primary] text-sm">{title}</p>
        <p className="text-sm text-[--color-text-secondary] mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function RoleGuide({ role }) {
  if (role === 'extension') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As an <strong>Extension Officer</strong>, your job is to create and submit Purchase Requests for your projects or events.
        Once submitted, procurement takes over. You can track your PR's progress at any time.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Pencil}   title="Create a Purchase Request"        description="Go to Purchase Requests → New Purchase Request. Fill in the title, select a quarter, then add your items (description, quantity, unit, estimated cost per item)." />
        <Step number={2} icon={Send}     title="Submit the PR"                    description="Once your items are complete, click Submit inside the PR detail page. This sends it to Procurement for review. You will not be able to edit it after submission." />
        <Step number={3} icon={Eye}      title="Track your PR"                    description="Visit Purchase Requests anytime to see the status of your PR: Submitted → Bidding → Ready for PO → Completed." />
        <Step number={4} icon={Bell}     title="Send a Reminder (optional)"       description="Inside your PR, click Remind Procurement if it has been sitting too long. There is a 1-hour cooldown between reminders." />
        <Step number={5} icon={CheckCircle} title="PR Completed"                  description="When the goods are delivered and accepted, your PR will be marked as Completed automatically." />
      </div>
      <Tip>You can only edit or delete a PR before you submit it. Once submitted, contact Procurement if changes are needed.</Tip>
    </div>
  )

  if (role === 'procurement') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As a <strong>Procurement Officer</strong>, you manage the full lifecycle of Purchase Requests — from reviewing submissions
        all the way to issuing Purchase Orders and tracking deliveries.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Eye}           title="Review submitted PRs"           description="New submissions are highlighted in the PR list. Open the PR to review items, then click Canvass PR to move it to Bidding." />
        <Step number={2} icon={Gavel}         title="Create Lots & Award Suppliers"  description="Go to Lots & Awards. Create lots for the PR, fill in the supplier details, and mark each lot as Awarded. Once all lots are awarded, the PR automatically moves to Ready for PO." />
        <Step number={3} icon={ShoppingCart}  title="Issue a Purchase Order"         description="Inside the PR (now in Ready for PO status), fill in the issued date and expected delivery date, then click Issue Purchase Order." />
        <Step number={4} icon={Truck}         title="Track Delivery"                 description="Monitor delivery status in the Deliveries section. You can also update delivery status directly from the PR detail page." />
        <Step number={5} icon={CheckCircle}   title="PR is Completed"                description="When the supply officer confirms full delivery, the PR status changes to Completed automatically." />
      </div>
      <Tip>Use Reports for analytics and trends. Reminders let you schedule follow-up tasks for yourself or other users.</Tip>
    </div>
  )

  if (role === 'supply') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As a <strong>Supply Officer</strong>, you receive goods and record deliveries against Purchase Orders.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Bell}         title="Get notified of new POs"        description="When a PO is issued, you receive a real-time notification. You can also check the Deliveries page for all pending deliveries." />
        <Step number={2} icon={Package}      title="Check Lots & Awards"            description="Visit Lots & Awards to see which suppliers were awarded and what items to expect in the delivery." />
        <Step number={3} icon={Truck}        title="Record the delivery"            description="Go to Deliveries → Record Delivery. Select the PO, set the delivered date, choose Complete or Partial, and add notes." />
        <Step number={4} icon={Send}         title="Send a delivery update"         description="Use the Update button on any delivery to notify Procurement and the Extension Officer of the current delivery status (Pending, Partial, or Complete)." />
        <Step number={5} icon={Download}     title="Download the IAR"               description="After recording a delivery, you can download the Inspection and Acceptance Report (IAR) PDF from the Deliveries page." />
      </div>
      <Tip>If only some items arrived, record it as Partial. You can record another delivery later for the remaining items.</Tip>
    </div>
  )

  if (role === 'admin') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As an <strong>Administrator</strong>, you have full access to the system — you can manage users, quarters, and oversee all procurement activity.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Users}        title="Manage Users"                   description="Go to User Management to create accounts, assign roles (Admin, Procurement, Extension, Supply), and activate or deactivate users." />
        <Step number={2} icon={Clock}        title="Manage Quarters"                description="Go to Quarters to create fiscal quarters (Q1–Q4) and set the active quarter. PRs are tied to a quarter for reporting purposes." />
        <Step number={3} icon={Shield}       title="Oversee all PRs and POs"        description="You have full access to read, edit, and delete any PR or PO in the system regardless of who created it." />
        <Step number={4} icon={ClipboardList} title="View Reports"                  description="Go to Reports for system-wide analytics: PR counts by status, PO trends, delivery performance, and more." />
        <Step number={5} icon={Bell}         title="System Notifications"           description="All real-time events (new submissions, deliveries, reminders) are surfaced through the notification bell in the header." />
      </div>
      <Tip>Create at least one active Quarter before Extension Officers can submit PRs — the quarter field is required on every PR.</Tip>
    </div>
  )

  return null
}

export default function GuidePage() {
  const { user } = useAuth()
  const role = user?.role

  return (
    <div className="space-y-4 max-w-3xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[--color-text-primary] flex items-center gap-2">
          <BookOpen className="size-6 text-[--color-brand]" /> User Guide
        </h1>
        <p className="text-sm text-[--color-text-muted] mt-1">
          Everything you need to know about using PRimeSys.
        </p>
      </div>

      {/* Role badge */}
      {role && (
        <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${ROLE_COLORS[role]}`}>
          <Shield className="size-4" />
          You are logged in as: <strong>{ROLE_LABELS[role]}</strong>
        </div>
      )}

      {/* What is PRimeSys */}
      <Section icon={BookOpen} title="What is PRimeSys?">
        <p className="text-sm text-[--color-text-secondary] leading-relaxed mt-3">
          <strong>PRimeSys</strong> is a web-based procurement management system for NEMSU Cantilan Campus.
          It digitizes and tracks the entire procurement process — from Purchase Request (PR) creation
          all the way to delivery confirmation — replacing manual paper-based workflows.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { icon: FileText,     label: 'Purchase Requests', color: 'text-amber-600',   bg: 'bg-amber-50'   },
            { icon: Gavel,        label: 'Lots & Bidding',    color: 'text-blue-600',    bg: 'bg-blue-50'    },
            { icon: ShoppingCart, label: 'Purchase Orders',   color: 'text-purple-600',  bg: 'bg-purple-50'  },
            { icon: Truck,        label: 'Delivery Tracking', color: 'text-emerald-600', bg: 'bg-emerald-50' },
          ].map(({ icon: Icon, label, color, bg }) => (
            <div key={label} className={`flex flex-col items-center gap-2 rounded-xl border border-[--color-border] ${bg} px-3 py-4`}>
              <Icon className={`size-6 ${color}`} />
              <p className="text-xs font-semibold text-center text-[--color-text-secondary]">{label}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Your Role Guide */}
      <Section icon={Users} title={`Your Guide — ${ROLE_LABELS[role] || 'All Users'}`}>
        <RoleGuide role={role} />
      </Section>

      {/* Full System Workflow */}
      <Section icon={ArrowRight} title="Full System Workflow" defaultOpen={false}>
        <p className="text-sm text-[--color-text-secondary] mt-3 mb-5 leading-relaxed">
          This is the complete flow of a procurement cycle from start to finish, showing which role does what at each step.
        </p>
        <div className="space-y-0">
          {[
            { number: 1, role: 'Extension',   color: 'bg-amber-500',   icon: Pencil,       title: 'Extension creates a PR',         desc: 'Extension Officer creates a new Purchase Request, fills in items with descriptions, quantities, units, and estimated costs.' },
            { number: 2, role: 'Extension',   color: 'bg-amber-500',   icon: Send,         title: 'Extension submits the PR',        desc: 'The PR is submitted to Procurement. Status changes from Draft → Submitted.' },
            { number: 3, role: 'Procurement', color: 'bg-blue-600',    icon: ClipboardList, title: 'Procurement canvasses the PR',   desc: 'Procurement reviews the PR and clicks "Canvass PR". Status changes from Submitted → Bidding.' },
            { number: 4, role: 'Procurement', color: 'bg-blue-600',    icon: Gavel,        title: 'Lots are created and awarded',    desc: 'Procurement creates lots in Lots & Awards and assigns suppliers. Once all lots are awarded, PR moves to Ready for PO automatically.' },
            { number: 5, role: 'Procurement', color: 'bg-blue-600',    icon: ShoppingCart, title: 'Purchase Order is issued',        desc: 'Procurement issues a PO from the PR detail page with the supplier, amount, and expected delivery date.' },
            { number: 6, role: 'Supply',      color: 'bg-emerald-600', icon: Truck,        title: 'Supply records delivery',         desc: 'Supply Officer receives the goods and records the delivery (Full or Partial). Supply can also send delivery status updates.' },
            { number: 7, role: 'System',      color: 'bg-gray-500',    icon: CheckCircle,  title: 'PR is marked Completed',          desc: 'Once all items are fully delivered, the PR status automatically becomes Completed.' },
          ].map(step => (
            <Step key={step.number} number={step.number} icon={step.icon} title={`[${step.role}] ${step.title}`} description={step.desc} color={step.color} />
          ))}
        </div>
      </Section>

      {/* PR Statuses explained */}
      <Section icon={FileText} title="PR Status Explained" defaultOpen={false}>
        <div className="mt-3 space-y-0 divide-y divide-[--color-border]">
          {[
            { status: 'Draft',        color: 'bg-gray-100 text-gray-700',      desc: 'PR has been created but not yet submitted. Only the creator can see and edit it.' },
            { status: 'Submitted',    color: 'bg-amber-100 text-amber-800',    desc: 'PR has been submitted to Procurement and is awaiting review.' },
            { status: 'Bidding',      color: 'bg-blue-100 text-blue-800',      desc: 'Procurement is canvassing — creating lots and selecting suppliers.' },
            { status: 'Ready for PO', color: 'bg-purple-100 text-purple-800',  desc: 'All lots have been awarded. Procurement can now issue a Purchase Order.' },
            { status: 'Completed',    color: 'bg-emerald-100 text-emerald-800', desc: 'The goods have been fully delivered and accepted.' },
            { status: 'Cancelled',    color: 'bg-red-100 text-red-800',        desc: 'The PR was cancelled and will not proceed further.' },
          ].map(({ status, color, desc }) => (
            <div key={status} className="flex items-start gap-3 py-3">
              <span className={`inline-block shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold mt-0.5 ${color}`}>{status}</span>
              <p className="text-sm text-[--color-text-secondary] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Features overview */}
      <Section icon={ClipboardList} title="Features Overview" defaultOpen={false}>
        <div className="mt-2">
          <Feature icon={FileText}     title="Purchase Requests"    description="Create, submit, and track PRs. Supports item grouping by project/section, file attachments, and activity logs." />
          <Feature icon={Gavel}        title="Lots & Awards"        description="Group PR items into lots for RA 9184 bidding compliance. Assign supplier details and award amounts per lot." />
          <Feature icon={ShoppingCart} title="Purchase Orders"      description="Automatically generated from awarded lots. Tracks supplier info, amounts, and delivery status." />
          <Feature icon={Truck}        title="Deliveries"           description="Record full or partial deliveries. Download Inspection and Acceptance Reports (IAR) as PDF." />
          <Feature icon={Bell}         title="Notifications"        description="Real-time in-app notifications for status changes, new POs, deliveries, and reminders." />
          <Feature icon={Clock}        title="Reminders"            description="Schedule reminders for yourself or others. Overdue reminders are sent via email automatically." />
          <Feature icon={Download}     title="PDF Export"           description="Download PR Forms, Abstract of Quotations, and IAR documents for printing or filing." />
          <Feature icon={ClipboardList} title="Reports"             description="Dashboard analytics showing PR counts by status, PO trends, and delivery performance (Procurement & Admin only)." />
          <Feature icon={Users}        title="User Management"      description="Admin can create accounts, assign roles, and activate or deactivate users." />
          <Feature icon={Trash2}       title="Delete & Edit"        description="Extension Officers can edit or delete their own PRs from the list or detail page. Procurement can delete any PR." />
        </div>
      </Section>

      {/* Tips */}
      <Section icon={Bell} title="Tips & Reminders" defaultOpen={false}>
        <div className="mt-3 space-y-3">
          <Tip>The active Quarter must be set by an Admin before PRs can be submitted. Contact your admin if you see a quarter error.</Tip>
          <Tip>All notifications appear in the bell icon (top right). Click "View all" to see the full notification history.</Tip>
          <Tip>You can download the PR Form PDF at any point from the PR detail page. The Abstract of Quotations is available once the PR reaches Bidding stage.</Tip>
          <Tip>If your email or password needs to be changed, go to Settings → Security.</Tip>
          <Tip>Reminders can be set for any date — the system will email you automatically when they are due.</Tip>
        </div>
      </Section>

    </div>
  )
}
