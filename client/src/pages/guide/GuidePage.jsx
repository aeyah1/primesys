import { useState } from 'react'
import {
  BookOpen, FileText, Gavel, ShoppingCart, Truck,
  Users, CheckCircle, ArrowRight, ChevronDown, ChevronUp,
  ClipboardList, ClipboardCheck, Package, Send, Eye, Pencil,
  Trash2, Bell, Clock, Download, Shield, RotateCcw, XCircle, Archive, Building2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/context/AuthContext'

const ROLE_LABELS = {
  admin:       'Administrator',
  procurement: 'Procurement Officer',
  requestor:   'Requestor',
  supply:      'Supply Officer',
  twg:         'Technical Working Group',
}

const ROLE_COLORS = {
  admin:       'bg-purple-50 border-purple-200 text-purple-800',
  procurement: 'bg-blue-50 border-blue-200 text-blue-800',
  requestor:   'bg-teal-50 border-teal-200 text-teal-800',
  supply:      'bg-blue-50 border-blue-200 text-blue-800',
  twg:         'bg-cyan-50 border-cyan-200 text-cyan-800',
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
  if (role === 'requestor') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As a <strong>Requestor</strong>, you file Purchase Requests for your personal, event, office, or project needs.
        The Technical Working Group (TWG) checks each one before Procurement takes over, and you can track it at any time.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Pencil}      title="Create a Purchase Request" description="Go to Purchase Requests → New Purchase Request. Say what it is for and why, then list your items with a rough price for each. You can save it as a draft and finish later." />
        <Step number={2} icon={Send}        title="It goes to the TWG"        description="Click Submit to TWG when it is ready. It is locked while they review it. To change something, open the PR, click Withdraw to edit, then click Submit to TWG again." />
        <Step number={3} icon={RotateCcw}   title="Respond to the TWG"        description="The TWG approves your PR, asks for a revision, or rejects it, with a comment. If they ask for a revision, click Edit PR, make the changes, and click Submit to TWG." />
        <Step number={4} icon={Eye}         title="Track your PR"             description="Your PR moves from Submitted to Approved by TWG, Bidding, Ready for PO, and Completed, with a notification at every step. The progress box on your PR shows where it is, who has it, and what happens next. If Procurement has had it a while, click Remind Procurement (once per PR per hour)." />
        <Step number={5} icon={CheckCircle} title="PR Completed"              description="You are told as the goods arrive, and if a supplier's delivery date changes, with the new date and why. When everything is delivered, your PR is marked Completed automatically and moves to the Archive." />
      </div>
      <Tip>You can delete a PR only while it is a draft or returned for revision. Deleted, completed, rejected, and cancelled PRs stay in the Archive.</Tip>
    </div>
  )

  if (role === 'twg') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As a member of the <strong>Technical Working Group (TWG)</strong>, you check the specifications of every
        Purchase Request before it reaches Procurement.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={ClipboardCheck} title="Open your review queue" description="Submitted PRs in your review areas land in TWG Reviews. The admin sets your areas, for example Hardware & Equipment or Event Supplies. Open a PR to see every item, quantity, unit cost, and attachment." />
        <Step number={2} icon={CheckCircle}    title="Approve & Forward"      description="If the specifications are right, click Approve & Forward. The PR becomes Approved by TWG and moves to Procurement's queue." />
        <Step number={3} icon={RotateCcw}      title="Request a Revision"     description="If something needs to change, click Request Revision and explain what to fix (a comment is required). The requestor edits the PR and submits it to you again." />
        <Step number={4} icon={XCircle}        title="Reject"                 description="If the request can't go ahead, click Reject and give the reason. A rejected PR is final and stays in the Archive." />
        <Step number={5} icon={ClipboardList}  title="Follow your decisions"  description="Your dashboard shows how many PRs are waiting, your weekly activity, and your recent decisions." />
      </div>
      <Tip>The TWG reviews but doesn't edit PRs. When something needs to change, request a revision so the requestor can fix it. If a PR was filed under the wrong category, request a revision and ask the requestor to change the category.</Tip>
    </div>
  )

  if (role === 'procurement') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As a <strong>Procurement Officer</strong>, you take TWG-approved Purchase Requests through canvassing, the award,
        and the Purchase Order, and follow them until the goods are delivered.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Eye}          title="Canvass approved PRs"    description="PRs approved by the TWG show as Approved by TWG. The Ready to Canvass card on your dashboard groups them by category, and Purchase Requests has category filters and a sort for the oldest approvals. Open one and click Canvass PR to move it to Bidding." />
        <Step number={2} icon={Gavel}        title="Record the award"        description="Under Canvass & Awards on the PR (or in Lots & Awards), click Add Quotation for each supplier's prices, then Award from Quotations: each item goes to the lowest price, and different items can go to different suppliers. Without quotations, use Record Award by Hand. An award can't exceed the approved budget of its items. Once every item is awarded (or dropped, with a reason), the PR is Ready for PO." />
        <Step number={3} icon={ShoppingCart} title="Issue a Purchase Order"  description="Each supplier awarded gets its own PO. Under Purchase Orders on the PR, set the dates and click Issue PO for each supplier. A supplier's PO can go out while other items are still being canvassed. Supply and the requestor are notified." />
        <Step number={4} icon={Truck}        title="Track delivery"          description="Supply records how many of each item arrived, and you can record a delivery from the PR page or the Purchase Orders page too. The Overdue tab on Purchase Orders lists every PO past its expected date. If the supplier gives a new date, click Change Expected Date on the PO and give the reason; the requestor and supply are told. Once every PO is fully delivered, and no item is left to award, the PR is Completed automatically." />
        <Step number={5} icon={XCircle}      title="If a supplier backs out" description="Before anything is delivered, click Cancel PO on that supplier's PO, with a reason. Only its items go back to canvass for a new award; other suppliers' POs stay." />
      </div>
      <Tip>A PR with no award or PO can be deleted; otherwise cancel it instead. Use Reports for spending and pipeline analytics, and Reminders to schedule follow-ups.</Tip>
    </div>
  )

  if (role === 'supply') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As a <strong>Supply Officer</strong>, you receive goods and record deliveries against Purchase Orders.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Bell}     title="Get notified of new POs" description="When a PO is issued, you get a notification. Your dashboard counts the POs that are overdue, due this week, and partly delivered, and lists what is still to receive, soonest due first." />
        <Step number={2} icon={Package}  title="Open the PO"             description="Click a PO on the Purchase Orders page to see its items, how many of each have arrived and are still to come, and its deliveries so far." />
        <Step number={3} icon={Truck}    title="Record the delivery"     description="Click Receive on the PO (or Deliveries → Record Delivery, then pick the PO). Enter how many of each item arrived; everything still to come is filled in for you. Set the delivered date, then attach the invoice with the paperclip button." />
        <Step number={4} icon={Send}     title="Send a note"             description="Use Note on a delivery to tell Procurement and the Requestor something about it, such as an item that arrived damaged. A note doesn't change what was delivered." />
        <Step number={5} icon={Download} title="Download the IAR"        description="Each delivery has its own Inspection and Acceptance Report (IAR) PDF listing the items it brought, on the Deliveries page and in the PO's details." />
      </div>
      <Tip>If only some items arrived, enter just those: the rest stays on the PO until it arrives. When every item is in, the PO is Delivered, and the PR is Completed once all its POs are. After that, its delivery records can only have their dates and notes corrected.</Tip>
    </div>
  )

  if (role === 'admin') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As an <strong>Administrator</strong>, you manage users, quarters, and organization settings, and you can see all procurement activity.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Users}         title="Manage Users"           description="Go to User Management to create accounts, assign roles (Admin, Procurement, Requestor, Supply, TWG), and activate or deactivate users. For a TWG member, tick the review areas (categories) they check; your dashboard warns you when an area has no reviewer. Public sign-up always creates Requestors." />
        <Step number={2} icon={Clock}         title="Manage Quarters"        description="Go to Quarters to create fiscal quarters (Q1–Q4), set each quarter's budget, and mark the active one. Reports compare spending against each budget." />
        <Step number={3} icon={Shield}        title="Oversee all PRs and POs" description="You can see every PR, PO, and delivery. Finished PRs (completed, rejected, or cancelled) stay in the Archive and can't be deleted." />
        <Step number={4} icon={ClipboardList} title="View Reports"           description="Go to Reports for spending by quarter and category, budget use, and PR counts by status." />
        <Step number={5} icon={Building2}     title="Organization settings"  description="Set the fund cluster and responsibility center code in Settings → Organization. They are filled in on every new PR." />
      </div>
      <Tip>New PRs are filed under the active quarter automatically, so keep the current quarter marked active.</Tip>
    </div>
  )

  return null
}

export default function GuidePage() {
  const { user } = useAuth()
  const role = user?.role

  const modules = [
    { icon: FileText,     label: 'Purchase Requests', color: 'text-amber-600',   bg: 'bg-amber-50'   },
    { icon: Gavel,        label: 'Lots & Awards',     color: 'text-blue-600',    bg: 'bg-blue-50'    },
    { icon: ShoppingCart, label: 'Purchase Orders',   color: 'text-purple-600',  bg: 'bg-purple-50'  },
    { icon: Truck,        label: 'Delivery Tracking', color: 'text-blue-600', bg: 'bg-blue-50' },
  ]

  const sections = [
    {
      icon: BookOpen,
      title: 'What is PRimeSys?',
      defaultOpen: true,
      content: (
        <>
          <p className="text-sm text-[--color-text-secondary] leading-relaxed mt-3">
            <strong>PRimeSys</strong> is a web-based procurement monitoring system for NEMSU Cantilan Campus.
            It tracks the entire procurement process, from Purchase Request (PR) creation through TWG review,
            award, and Purchase Order, all the way to delivery, replacing manual paper-based workflows.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {modules.map(({ icon: Icon, label, color, bg }, i) => (
              <div
                key={label}
                className={`flex flex-col items-center gap-2 rounded-xl border border-[--color-border] ${bg} px-3 py-4 animate-fade-in-up hover:scale-105 transition-transform duration-200`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <Icon className={`size-6 ${color} animate-float`} style={{ animationDelay: `${i * 200}ms` }} />
                <p className="text-xs font-semibold text-center text-[--color-text-secondary]">{label}</p>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      icon: Users,
      title: `Your Guide — ${ROLE_LABELS[role] || 'All Users'}`,
      defaultOpen: true,
      content: <RoleGuide role={role} />,
    },
    {
      icon: ArrowRight,
      title: 'Full System Workflow',
      defaultOpen: false,
      content: (
        <>
          <p className="text-sm text-[--color-text-secondary] mt-3 mb-5 leading-relaxed">
            This is the complete flow of a procurement cycle from start to finish, showing which role does what at each step.
          </p>
          <div className="space-y-0">
            {[
              { number: 1, role: 'Requestor',   color: 'bg-amber-500', icon: Pencil,         title: 'Requestor files the PR',         desc: 'The requestor lists the items with quantities, units, and estimated costs. Saving sends the PR to the TWG (Submitted).' },
              { number: 2, role: 'TWG',         color: 'bg-cyan-600',  icon: ClipboardCheck, title: 'TWG reviews the specifications', desc: 'The TWG approves the PR (Approved by TWG), asks for a revision (the requestor edits and resubmits), or rejects it (final).' },
              { number: 3, role: 'Procurement', color: 'bg-blue-600',  icon: ClipboardList,  title: 'Procurement canvasses the PR',   desc: 'Procurement clicks Canvass PR on an approved PR. Status changes to Bidding.' },
              { number: 4, role: 'Procurement', color: 'bg-blue-600',  icon: Gavel,          title: 'The award is recorded',          desc: "Procurement records the suppliers' quotations and awards each item to the lowest price. One PR can go to several suppliers." },
              { number: 5, role: 'Procurement', color: 'bg-blue-600',  icon: ShoppingCart,   title: 'Purchase Order is issued',       desc: 'Procurement issues the PO from the PR page with the supplier, amount, and expected delivery date. Supply and the requestor are notified.' },
              { number: 6, role: 'Supply',      color: 'bg-blue-600',  icon: Truck,          title: 'Supply records the delivery',    desc: 'Supply receives the goods and records how many of each item arrived, with an Inspection and Acceptance Report (IAR) for each delivery.' },
              { number: 7, role: 'System',      color: 'bg-gray-500',  icon: CheckCircle,    title: 'PR is marked Completed',         desc: 'When every PO is fully delivered, the PR is marked Completed automatically. It then stays in the Archive with its full history.' },
            ].map(step => (
              <Step key={step.number} number={step.number} icon={step.icon} title={`[${step.role}] ${step.title}`} description={step.desc} color={step.color} />
            ))}
          </div>
        </>
      ),
    },
    {
      icon: FileText,
      title: 'PR Status Explained',
      defaultOpen: false,
      content: (
        <div className="mt-3 space-y-0 divide-y divide-[--color-border]">
          {[
            ['draft',              'Not submitted yet. Only its creator can see and edit it.'],
            ['submitted',          'Waiting for the Technical Working Group (TWG) to review it. Locked while under review.'],
            ['revision_requested', 'The TWG asked for changes. The requestor edits the PR and submits it again.'],
            ['twg_review',         'The TWG approved the specifications. Waiting for Procurement to canvass it.'],
            ['rejected',           'The TWG rejected the request. Final, and kept in the Archive.'],
            ['bidding',            'Procurement is canvassing suppliers.'],
            ['for_po',             'A supplier has been awarded. Procurement issues the Purchase Order, then the PR waits for delivery.'],
            ['completed',          'The goods were fully delivered. Final, and kept in the Archive.'],
            ['cancelled',          'Procurement cancelled the PR while it had no active Purchase Order. Final, and kept in the Archive.'],
          ].map(([status, desc], i) => (
            <div key={status} className="flex items-start gap-3 py-3 animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
              <span className="shrink-0 mt-0.5"><PRStatusBadge status={status} /></span>
              <p className="text-sm text-[--color-text-secondary] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: ClipboardList,
      title: 'Features Overview',
      defaultOpen: false,
      content: (
        <div className="mt-2">
          {[
            { icon: FileText,       title: 'Purchase Requests', description: 'Create, submit, and track PRs with items, file attachments, and a full activity log.' },
            { icon: ClipboardCheck, title: 'TWG Review',        description: 'The Technical Working Group checks every PR\'s specifications before Procurement acts on it.' },
            { icon: Gavel,          title: 'Lots & Awards',     description: "Record suppliers' quotations, award each item (one PR can go to several suppliers), and see each supplier's purchase order." },
            { icon: ShoppingCart,   title: 'Purchase Orders',   description: 'Issued by Procurement for awarded PRs, one per supplier. Tracks the supplier, amount, what has arrived of each item, and which POs are overdue. A PO can be cancelled before delivery so its items can be awarded again.' },
            { icon: Truck,          title: 'Deliveries',        description: 'Record how many of each item arrived, attach invoices, and download Inspection and Acceptance Reports (IAR) as PDF.' },
            { icon: Archive,        title: 'Archive',           description: 'Completed, cancelled, rejected, and deleted PRs, grouped by quarter. Nothing is permanently erased.' },
            { icon: Bell,           title: 'Notifications',     description: 'Real-time in-app notifications for status changes, new POs, deliveries, and reminders.' },
            { icon: Clock,          title: 'Reminders',         description: 'Schedule reminders for yourself or others. Due reminders are emailed automatically.' },
            { icon: Download,       title: 'PDF Export',        description: 'Download PR Forms, Abstract of Quotations, Purchase Orders, and IAR documents for printing or filing.' },
            { icon: ClipboardList,  title: 'Reports',           description: 'Spending by quarter and category, budget use, and PR counts by status (Procurement & Admin only).' },
            { icon: Users,          title: 'User Management',   description: 'Admin creates accounts, assigns roles, and activates or deactivates users. Public sign-up always creates Requestors; every other role is assigned here.' },
            { icon: Trash2,         title: 'Delete & Edit',     description: 'Requestors edit or delete their PRs while they are drafts or returned for revision. Procurement can delete a PR that has no award or PO; otherwise it is cancelled. Deleted PRs go to the Archive.' },
          ].map((f, i) => (
            <div key={f.title} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
              <Feature icon={f.icon} title={f.title} description={f.description} />
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: Bell,
      title: 'Tips & Reminders',
      defaultOpen: false,
      content: (
        <div className="mt-3 space-y-3">
          {[
            'New PRs are filed under the current active quarter automatically. If no quarter is active, the PR is numbered by year instead.',
            'All notifications appear in the bell icon (top right). Click "View all" to see the full notification history.',
            'You can download the PR Form PDF at any time from the PR page. The Abstract of Quotations is available once the TWG has approved the PR.',
            'To change your password, go to Settings → Security.',
            'Reminders can be set for any date. The system emails you automatically when they are due.',
          ].map((tip, i) => (
            <div key={i} className="animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
              <Tip>{tip}</Tip>
            </div>
          ))}
        </div>
      ),
    },
  ]
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="animate-fade-in-down">
        <h1 className="text-2xl font-bold text-[--color-text-primary] flex items-center gap-2">
          <BookOpen className="size-6 text-[--color-brand] animate-float" /> User Guide
        </h1>
        <p className="text-sm text-[--color-text-muted] mt-1">
          Everything you need to know about using PRimeSys.
        </p>
      </div>

      {/* Role badge */}
      {role && (
        <div className={`animate-scale-in inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${ROLE_COLORS[role]}`}>
          <Shield className="size-4" />
          You are logged in as: <strong>{ROLE_LABELS[role]}</strong>
        </div>
      )}

      {/* Sections */}
      {sections.map((s, i) => (
        <div key={s.title} className="animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
          <Section icon={s.icon} title={s.title} defaultOpen={s.defaultOpen}>
            {s.content}
          </Section>
        </div>
      ))}

    </div>
  )
}
