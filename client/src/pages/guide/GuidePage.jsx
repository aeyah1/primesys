import { useState } from 'react'
import {
  BookOpen, FileText, Gavel, ShoppingCart, Truck,
  Users, CheckCircle, ArrowRight, ChevronDown, ChevronUp,
  ClipboardList, ClipboardCheck, Package, Send, Eye, Pencil,
  Trash2, Bell, Clock, Download, Shield, RotateCcw, XCircle, Archive, Building2, FileBadge, Store, FileStack, ScrollText, Wrench, Scale,
  Paperclip, ShieldCheck,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PRStatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/context/AuthContext'
import PageHeader from '@/components/shared/PageHeader'

const ROLE_LABELS = {
  admin:       'Administrator',
  procurement: 'Procurement Officer',
  requestor:   'End User',
  supply:      'Supply Officer',
  twg:         'Technical Working Group',
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
    <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800 mt-3">
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
        As an <strong>End User</strong>, you file Purchase Requests for your personal, event, office, or project needs.
        The Technical Working Group (TWG) checks each one before Procurement takes over, and you can track it at any time.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Pencil}      title="Create a Purchase Request" description="Click New Request in the menu. Say what it is for and why, and pick the quarter it is for. Then add the items you need one by one from your office's PPMP: only that quarter's items can be requested, up to what is left of each (Add all takes every item of the quarter at once). Under Requested by, type who asked for it (your office head is suggested) and click Digital signature: they sign on the spot, or you upload a picture of their signature. You can save it as a draft and finish later." />
        <Step number={2} icon={Send}        title="It goes to the TWG"        description="Click Submit to TWG when it is ready. It is locked while they review it. To change something, open the PR, click Withdraw to edit, then click Submit to TWG again." />
        <Step number={3} icon={RotateCcw}   title="Respond to the TWG"        description="The TWG approves your PR, asks for a revision, or rejects it, with a comment. If they ask for a revision, click Edit PR, make the changes, and click Submit to TWG. If they reject it, you can still fix it: click Edit and resubmit on the request, change what they pointed out, and submit it again, with nothing to retype." />
        <Step number={4} icon={Eye}         title="Track your PR"             description="Your PR moves from TWG review to Ready for canvass, Canvass, TWG checking the award (IT equipment only), Ready for purchase order, Ordered and Completed, with a notification at every step. The BAC chooses each supplier at its own meeting and Procurement records the award; for IT equipment the TWG then checks the chosen supplier's offer against your specifications, and if it falls short the award is returned and the BAC chooses another supplier. You are told why. Once the award is recorded, your request lists its suppliers with their profiles (address, contact, TIN). The progress box on your PR shows where it is, who has it, and what happens next. Until Procurement starts the canvass it carries a temporary reference (REQ-…); its PR number is assigned then. If Procurement has had it a while, click Remind Procurement (once per PR per hour)." />
        <Step number={5} icon={CheckCircle} title="PR Completed"              description="You are told as the goods arrive, and if a supplier's delivery date changes, with the new date and why. When everything is delivered, your PR is marked Completed automatically and moves to the Archive." />
      </div>
      <Tip>You can delete a PR only while it is a draft or returned for revision. Completed, rejected, and cancelled requests stay under Done in My Requests, and in the Archive.</Tip>
      <Tip>Uploaded the wrong PPMP? Open it under PPMP. Change uploads the corrected file and Edit changes lines on screen; either makes its next version, and the list still shows one PPMP for your office. To remove the PPMP in effect, click Ask to remove and give the reason: an admin decides, and you are told either way. One not in effect yet you can delete yourself.</Tip>
    </div>
  )

  if (role === 'twg') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As a member of the <strong>Technical Working Group (TWG)</strong>, you check the specifications of every
        Purchase Request before it reaches Procurement, and check the winning supplier's offer on an IT or hardware award before its purchase order.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={ClipboardCheck} title="Start from My tasks"   description="My tasks, your home, lists under Needs you every request in your review areas waiting for your review or your check of its award, the oldest first, each with its button (Review request, Check the award). Requests lists every request you can see. The admin sets your areas, for example Hardware & Equipment or Event Supplies. Open a PR to see every item, quantity, unit cost, and attachment." />
        <Step number={2} icon={CheckCircle}    title="Approve"                description="Open the request: the gold Your next step panel says Review the request. If the specifications are right, click Approve. The PR becomes Ready for canvass and moves to Procurement's queue." />
        <Step number={3} icon={RotateCcw}      title="Return for changes"     description="If something needs to change, click Return for changes in the same panel and explain what to fix (a comment is required). The End User edits the PR and submits it to you again." />
        <Step number={4} icon={XCircle}        title="Reject"                 description="If the request can't go ahead, click Reject in the panel and give the reason. Its End User may still change it and submit it to you again; otherwise it stays in the Archive as rejected." />
        <Step number={5} icon={CheckCircle}    title="Check and certify the award" description="When Procurement records the BAC's award of an IT or hardware request, it shows under Needs you on My tasks. Click Check the award: its Canvass & award tab lists each lot's winning supplier, with the items, their prices and what the supplier offered (as Procurement typed it from the RFQ; As specified when it wrote none), and the canvasser's files beside it, opened whole: zoom in or out, fit the width, or go full screen. Check each offer against the RFQ and the specifications, correct what was offered if need be, and mark it Compliant or Non-Compliant, stating the reason; Save keeps your marks to finish later. When every offer complies, click Certify: the window suggests the next Cert. No. (change it to follow the paper series), and you can sign the certificate on the spot, upload a signature, or leave it to sign by hand. Procurement issues the purchase orders next. If an offer falls short, click Return to Procurement with your reason: the award is cancelled, the request goes back to canvass for the BAC's next choice, and the supplier you marked non-compliant can't be recorded for that lot again." />
        <Step number={6} icon={ClipboardList}  title="Follow your decisions"  description="Your dashboard shows how many PRs are waiting, your weekly activity, and your recent decisions." />
      </div>
      <Tip>The TWG reviews but doesn't edit PRs. When something needs to change, request a revision so the End User can fix it. If a PR was filed under the wrong category, request a revision and ask the End User to change the category.</Tip>
      <Tip>Save your signature once under Settings → Profile (or Save as my signature in the approval window): it is filled in on every certificate you issue, and you can still sign differently or leave it off before you confirm.</Tip>
    </div>
  )

  if (role === 'procurement') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As a <strong>Procurement Officer</strong>, you start the canvass of TWG-approved Purchase Requests and print their RFQs, record
        the award the
        Bids and Awards Committee (BAC) decides at its own meeting (the TWG checks it first for IT equipment), then issue the Purchase Orders and follow them until the goods
        are delivered. The BAC has no account in PRimeSys: it decides on paper, and you record its decision.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Eye}          title="Start the canvass"       description="My tasks, your home, lists under Needs you every request the TWG approved, the longest waiting first. Click Start canvass on it, confirm the PR number the system suggests (or change it), and set the mode of procurement; then print the Request for Quotation (Print RFQ in the panel, or the Documents tab), sign it by hand, and give it to the canvasser, who canvasses the suppliers on paper and brings the returned RFQs back to you. On every request the gold Your next step panel holds the next step; the rarer actions (return for changes, return to canvass, cancel) are under More." />
        <Step number={2} icon={Paperclip}    title="Attach the returned RFQs" description="When the canvasser brings the suppliers' RFQs back, open the request: its Canvass & award tab has the canvasser's files. Upload each returned RFQ (a PDF, Word file or photo) and any papers of the BAC's award; they open beside the award form, whole, with zoom and full screen. Only Procurement, admins and the TWG (while it checks an award) can open them. A file attached by mistake can be removed while the request is in canvass." />
        <Step number={3} icon={Gavel}        title="Record the BAC's award"  description="The BAC meets and chooses each lot's supplier on its approved criteria; PRimeSys picks and recommends no one. Click Record the award in the gold panel. For each lot (a request without lots is one lot) type the supplier the BAC chose (the supplier list suggests names as you type, and a blacklisted supplier is pointed out), each item's unit price from that supplier's RFQ, and what it offered when it differs from the specification (blank is As specified); tick the criteria the BAC applied (the list the admin keeps under Organization) and type its remark if any. A lot's award can't be above its approved budget. Drop an item no supplier can supply. Click Review and record: a window shows every lot's supplier with its items, prices, total against its budget and its basis. Click Confirm award, or Go back to change something. When the request's approved budget is ₱50,000 or more (the resolution threshold, set by the admin), the award is adopted in a numbered BAC Resolution for the BAC to sign; below it, it is recorded on the BAC's Abstract of sealed Quotations alone." />
        <Step number={4} icon={ShieldCheck}  title="The TWG's check (IT equipment)" description="An award of IT equipment or hardware goes to the TWG, which checks the winning offers against the specifications and certifies the award; then the purchase orders can be issued. If an offer falls short, the TWG returns the award with its reason: the award is cancelled and the request is back in canvass for you to record the BAC's next choice (the supplier the TWG failed can't be recorded for that lot again). Any other award is Ready for purchase order at once." />
        <Step number={5} icon={Download}     title="Print the documents"     description="Under Awards on the request, each award prints its BAC Resolution when it has one and a Notice of Award for every supplier in it; the TWG's certificate prints there too. The Abstract of sealed Quotations is the BAC's own paper, kept outside PRimeSys. Awards, under Records, lists every award recorded." />
        <Step number={6} icon={ShoppingCart} title="Issue a Purchase Order"  description="Once the award is recorded, each winning supplier gets its own PO. Open the request and click Issue purchase order: its Orders & delivery tab opens; set the dates and click Issue PO for each supplier. A certified supplier's PO can go out while other items are still in canvass. Supply and the End User are notified." />
        <Step number={7} icon={Truck}        title="Track delivery"          description="Supply records how many of each item arrived, and you can record a delivery from the request's Orders & delivery tab or the Purchase Orders page too. The Overdue tab on Purchase Orders lists every PO past its expected date. If the supplier gives a new date, click Change Expected Date on the PO and give the reason; the End User and supply are told. Once every PO is fully delivered, and no item is left to award, the PR is Completed automatically." />
        <Step number={8} icon={XCircle}      title="If a supplier backs out" description="Before anything is delivered, click Cancel PO on that supplier's PO, with a reason. Only its items go back to canvass, through the TWG when needed and the BAC's decision again; other suppliers' POs stay." />
        <Step number={9} icon={Store}        title="Keep the supplier list"  description="Under Suppliers, add each supplier with its details as on its RFQ, business permit or letterhead: address, contact person, phone, email, TIN and PhilGEPS No. You fill a quotation from it, an award takes the winner's details onto its PO, and every request shows the profiles of the suppliers that quoted once you send the quotations on. A profile lists every request the supplier quoted on, what it was awarded and where it was DQ. Mark a supplier Blacklisted, with the reason, and you are warned when you enter its quotation; a supplier with quotations on record stays in the list." />
        <Step number={10} icon={FileStack}   title="RFQ History"            description="Under RFQ History, see every RFQ uploaded to a request, newest first (search by supplier, RFQ No. or PR No.): its supplier, RFQ No., total and whether it was awarded or DQ, with the RFQ opened whole beside the list. Only Procurement and admins see the suppliers' RFQs and prices: here, on each request (its files and every bid), the Abstract and the TWG's bids certificate. The TWG sees a request's while it checks its offers; End Users and Supply never do. The winners, the BAC Resolution and the Notices of Award stay visible." />
      </div>
      <Tip>Once the TWG has approved a PR, it can be deleted until the canvass starts; after that, cancel it instead, with the reason. Deleting someone else's PR asks why, and whoever filed it is told. While the TWG still has it, only an admin can cancel or delete it. Use Reports for spending and pipeline analytics, and Reminders to schedule follow-ups.</Tip>
      <Tip>Every award stays on record with the criteria the BAC applied and, for IT equipment, the TWG's verdict on its offer, for audit.</Tip>
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
        <Step number={3} icon={Truck}    title="Record the delivery"     description="Click Receive on the PO (or Received → Record Delivery, then pick the PO). Enter how many of each item arrived; everything still to come is filled in for you. Set the delivered date, then attach the invoice with the paperclip button." />
        <Step number={4} icon={Send}     title="Send a note"             description="Use Note on a delivery to tell Procurement and the End User something about it, such as an item that arrived damaged. A note doesn't change what was delivered." />
      </div>
      <Tip>If only some items arrived, enter just those: the rest stays on the PO until it arrives. When every item is in, the PO is Delivered, and the PR is Completed once all its POs are. After that, its delivery records can only have their dates and notes corrected.</Tip>
    </div>
  )

  if (role === 'admin') return (
    <div className="space-y-4 pt-3">
      <p className="text-sm text-[--color-text-secondary] leading-relaxed">
        As an <strong>Administrator</strong>, you manage users, offices, and organization settings, and you can see all procurement activity.
      </p>
      <div className="space-y-1">
        <Step number={1} icon={Users}         title="Manage Users"           description="Go to User Management to create accounts, assign roles (Admin, Procurement, End User, Supply, TWG), and activate or deactivate users. For a TWG member, tick the review areas (categories) they check; your dashboard warns you when an area has no reviewer. Public sign-up always creates End Users. Give each person one account: never give someone who files requests (an End User) a TWG or Procurement account too, so nobody reviews or awards their own request. If someone must do both jobs, assign their office's requests to another TWG member's review areas." />
        <Step number={2} icon={Clock}         title="Quarters are automatic"  description="Nobody sets up quarters. Each year's Q1 to Q4 are added on their own, the current quarter follows today's date, and each quarter's budget is what the offices' Final PPMPs plan for it. Reports compare spending against those plans." />
        <Step number={3} icon={Shield}        title="Supervise, don't decide" description="You can see every request under Requests and every finished one in the Archive. TWG reviews belong to its members and awards are recorded by Procurement, so an admin can't make them. Your My tasks page warns you when a TWG area has no reviewer, and you are notified when a request waits for Procurement but no Procurement officer is active." />
        <Step number={4} icon={ClipboardList} title="View Reports"           description="Go to Reports for spending by quarter and category, budget use, and PR counts by status." />
        <Step number={5} icon={Building2}     title="Organization settings"  description="Set the fund cluster and responsibility center code on the Organization page, under Administration in the menu. They are filled in on every new PR. List the award criteria the BAC applies, as approved by the BAC and the Procurement Office; Procurement ticks them on every award. Under Records and uploaded files, set how many days after a request is finished its uploaded files are deleted (90 unless changed; 0 keeps them), and check that encryption of stored files is on. Under Face checks, require staff to confirm it's them with their face at sign-in and before critical actions; set up your own first in Settings, Security. When someone's face can't be read any more, remove their face check by editing their account in User Management, and they set it up again. Under Saved signatures, add each signatory's signature with their consent: it prints over their name once their step is done, on staff copies only." />
        <Step number={6} icon={Store}         title="Suppliers"              description="You keep the supplier list with Procurement: each supplier's profile, the requests it was on, its awards and DQs, and whether it is blacklisted." />
        <Step number={7} icon={FileStack}     title="RFQ History"            description="Every RFQ uploaded to a request, newest first, with its supplier, total and outcome, and a search. Like Procurement, you see the suppliers' RFQs and prices: here, and on each request with its award certificate. You supervise; you don't enter or change them." />
        <Step number={8} icon={ScrollText}    title="Audit Log"              description="Under Administration, the Audit Log lists every change and sign-in in PRimeSys, newest first: who did it (and their role), what, on which request, PPMP or account, when, whether it was done or refused, and from which browser and address. Filter by person, kind of activity, result and dates, or search a name or PR number. Activity in User Management opens one person's panel: their last sign-in (when, browser and address), how much of each kind of activity is on record, their audit trail, their sign-ins, and their transactions (every request they moved, with when). Entries are kept for a year and nobody can edit or delete them; every person reads their own under Account, My activity. When an account or an address has repeated failed sign-ins in a day, your dashboard shows a red warning." />
        <Step number={9} icon={Wrench}        title="Maintenance and errors" description="Before updating or repairing PRimeSys, open Maintenance under Administration in the menu: set when it starts (blank for right away, at most 30 days ahead), when it ends (at most 12 hours later; save a later time to extend it) and a message. Until it starts, every page shows a notice so people save their work; while it is on, everyone but admins sees the maintenance page and can't sign in or save, and it ends by itself at its end time, or when any admin clicks End now. It can be set at most 5 times an hour, the next can't start until 10 minutes after the last ended, and every other admin gets a notice and an email naming who set it. When the server fails an action, the people involved see a short message, every admin gets an email (at most one an hour), and your dashboard counts the failed changes of the last 24 hours, linked to the Audit Log. Back up the database and the uploaded files weekly and before every update (docs/backup-and-restore.md)." />
      </div>
      <Tip>A request filed without a quarter goes under the one today falls in; an End User always picks a quarter of their PPMP's year.</Tip>
    </div>
  )

  return null
}

export default function GuidePage() {
  const { user } = useAuth()
  const role = user?.role

  const modules = [
    { icon: FileText,     label: 'Requests',          color: 'text-amber-600',   bg: 'bg-amber-50'   },
    { icon: Gavel,        label: 'Canvass & Awards',  color: 'text-blue-600',    bg: 'bg-blue-50'    },
    { icon: ShoppingCart, label: 'Purchase Orders',   color: 'text-blue-600',  bg: 'bg-blue-50'  },
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
            <strong>PRimeSys</strong> is a web-based procurement management system for NEMSU Cantilan Campus.
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
      icon: ClipboardCheck,
      title: 'Every request reads the same',
      defaultOpen: true,
      content: (
        <p className="text-sm text-[--color-text-secondary] mt-3 leading-relaxed">
          Open any request and you see, top to bottom: what it is (its number, status and budget); its six steps (Request, TWG review,
          Canvass, Award, Purchase order, Delivery) with the one it is on; and the gold <strong>Your next step</strong> panel with your
          button. When it is not your turn, the panel says who has it. The work itself is in the tabs: Overview, Canvass &amp; award,
          Orders &amp; delivery, Documents and History; the tab holding your next step has a gold dot. Rarer actions (return for
          changes, cancel, delete) are under More.
        </p>
      ),
    },
    {
      icon: Users,
      title: `Your guide: ${ROLE_LABELS[role] || 'All Users'}`,
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
              { number: 1, role: 'End User',   color: 'bg-amber-500', icon: Pencil,         title: 'End User files the PR', desc: 'The End User lists the items with quantities, units, and estimated costs. Saving sends the PR to the TWG (Submitted).' },
              { number: 2, role: 'TWG',         color: 'bg-blue-600',  icon: ClipboardCheck, title: 'TWG reviews the specifications', desc: 'The TWG approves the PR (Ready for canvass), returns it for changes (the End User edits and resubmits), or does not approve it (the End User may change it and resubmit it).' },
              { number: 3, role: 'Procurement', color: 'bg-blue-600',  icon: ClipboardList,  title: 'Procurement starts the canvass', desc: 'Procurement clicks Start canvass on an approved PR and prints the RFQ. The canvasser canvasses the suppliers on paper. Status changes to Canvass.' },
              { number: 4, role: 'BAC, Procurement', color: 'bg-blue-600', icon: Gavel,  title: 'The BAC decides; Procurement records it', desc: "The canvasser gives the returned RFQs back to Procurement. The BAC meets and chooses each lot's winner on its approved criteria, outside PRimeSys. Procurement records the winner, its prices and the criteria applied, adopted in a BAC Resolution (below the threshold, on the BAC's Abstract). A PR in several lots can go to several suppliers." },
              { number: 5, role: 'TWG',         color: 'bg-blue-600',  icon: ClipboardCheck, title: 'The TWG checks the award',      desc: 'For IT equipment and hardware, the TWG checks the winning offer against the specifications and marks each item Compliant or Non-Compliant, with the reason. It certifies the award in a numbered certificate, or returns it to Procurement for the BAC\'s next choice.' },
              { number: 6, role: 'Procurement', color: 'bg-blue-600',  icon: ShoppingCart,   title: 'Purchase Order is issued',       desc: 'Procurement issues the PO from the PR page with the supplier, amount, and expected delivery date. Supply and the End User are notified.' },
              { number: 7, role: 'Supply',      color: 'bg-blue-600',  icon: Truck,          title: 'Supply records the delivery',    desc: 'Supply receives the goods and records how many of each item arrived, attaching the invoice or proof of delivery.' },
              { number: 8, role: 'System',      color: 'bg-gray-500',  icon: CheckCircle,    title: 'PR is marked Completed',         desc: 'When every PO is fully delivered, the PR is marked Completed automatically. It then stays in the Archive with its full history.' },
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
            ['revision_requested', 'The TWG asked for changes. The End User edits the PR and submits it again.'],
            ['twg_review',         'The TWG approved the specifications. Waiting for Procurement to start the canvass.'],
            ['rejected',           'The TWG rejected the request. Its End User may reopen it to change and resubmit it; otherwise it stays in the Archive.'],
            ['bidding',            'The canvasser canvasses the suppliers and gives the returned RFQs back to Procurement; the BAC chooses the winners at its meeting and Procurement records its award.'],
            ['twg_certification',  'IT equipment: the TWG checks the winning offer against the specifications. It certifies the award, or returns it to Procurement for the BAC\'s next choice.'],
            ['for_po',             'The winners are awarded. Procurement issues the Purchase Orders.'],
            ['ordered',            'Every Purchase Order is issued. The Supply Office records the delivery.'],
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
            { icon: ClipboardList,  title: 'My tasks',          description: "Every role's home, first in the menu with a count: under Needs you, each request waiting for you with the button that opens its work; under Waiting on others, the ones you follow, with who has them." },
            { icon: FileText,       title: 'Requests',          description: 'Every request you may see, by status, with who has each one now; End Users have My Requests instead. A request opens on one page for everyone: its six steps, your next step with its button, and tabs for its canvass, orders, documents and history.' },
            { icon: ShoppingCart,   title: 'Purchase Orders',   description: 'Issued by Procurement for awarded requests, one per supplier, by how their delivery stands: overdue, due this week, partly delivered and so on. A row opens the PO: its items, what arrived, its deliveries and its documents.' },
            { icon: Truck,          title: 'Deliveries',        description: 'Every delivery recorded on a PO: what arrived, when and who received it, with invoices and proof of delivery. A row opens its PO.' },
            { icon: Gavel,          title: 'Awards',            description: 'Every award recorded, with its BAC Resolution and its Abstract to print, and the criteria the BAC applied (Procurement and Admin).' },
            { icon: FileStack,      title: 'RFQ History',       description: 'Every RFQ uploaded to a request, opened beside the list. Only Procurement and admins see the suppliers\' RFQs and prices, anywhere in PRimeSys; the TWG while it checks a request\'s offers.' },
            { icon: FileBadge,      title: 'Certificates',      description: 'Every TWG Certification already issued, newest first: when the TWG approves a request, and when it certifies an award. Search by Cert. No., PR number or title, and print any of them.' },
            { icon: Store,          title: 'Suppliers',         description: 'Each supplier\'s profile, the requests it quoted on, its awards and DQs (Procurement and Admin).' },
            { icon: Archive,        title: 'Archive',           description: 'Every request you can see, by quarter or whole year, with its figures: filter it by category or office, export it as CSV, or print the register. Deleted requests are kept here too; nothing is permanently erased.' },
            { icon: ClipboardList,  title: 'Reports',           description: 'Spending by quarter and category against what the PPMPs plan, and where the requests are (Procurement and Admin).' },
            { icon: Bell,           title: 'Notifications',     description: 'Every update PRimeSys sent you, by day, with All and Unread; each opens what it is about.' },
            { icon: ScrollText,     title: 'My activity',       description: 'Everyone\'s own history, under Account: everything you did in PRimeSys and every sign-in to your account, newest first, with when and from where. Read only: nobody can change or delete an entry.' },
            { icon: Shield,         title: 'Face check',        description: 'Staff (TWG, Procurement, Supply, Admin) set one up under Settings, Security, with their consent: the camera turns the face into 128 numbers, kept encrypted, never a photo. When the admin requires it, staff look at the camera, turn their head a little and back at sign-in and before critical actions such as recording an award or issuing a PO. One check covers the next 5 minutes. End Users never take one.' },
            { icon: Clock,          title: 'Reminders',        description: 'Procurement and Admin schedule email reminders for themselves or others, sent at the time they pick.' },
            { icon: Users,          title: 'User Management',   description: 'The admin creates accounts, assigns roles and offices, approves sign-ups, and opens each person\'s activity. Public sign-up always creates End Users.' },
            { icon: Building2,      title: 'Organization and Maintenance', description: 'Admin pages: the campus details printed on every form, the signatories and offices; and pausing PRimeSys for an update.' },
            { icon: Download,       title: 'Printed forms',     description: 'PR Forms, Requests for Quotation, TWG Certifications, BAC Resolutions, Notices of Award and Purchase Orders, from the Documents tab of each request.' },
            { icon: Trash2,         title: 'Delete and edit',   description: 'End Users edit or delete their requests while they are drafts or returned for changes. Procurement can delete one until its canvass starts, with the reason; after that it is cancelled. Deleted requests go to the Archive.' },
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
            'A request filed without a quarter goes under the one today falls in.',
            'New notifications appear in the bell (top right). Click "View all", or Notifications in the menu, for the full list.',
            'You can download the PR Form PDF at any time from the PR page. The Request for Quotation is available once the TWG has approved the PR.',
            'To change your password, open Settings, then Security.',
            'The first time you sign in on a browser, PRimeSys emails you a 6-digit code to confirm it is you (check Spam if it is not there). With Remember this device ticked (it is, unless you untick it), that browser is then remembered for 30 days; untick it on a shared or public computer. Settings → Security lists your remembered devices: remove any you don\'t recognize, then change your password.',
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
      <PageHeader title="User Guide" sub={`How PRimeSys works, and what you do in it${role ? ` as ${/^[AEIOU]/.test(ROLE_LABELS[role]) ? 'an' : 'a'} ${ROLE_LABELS[role]}` : ''}.`} />

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
