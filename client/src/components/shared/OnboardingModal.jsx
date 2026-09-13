import { useState, useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import {
  X, ArrowRight, ArrowLeft, CheckCircle,
  FileText, Gavel, ShoppingCart, Truck,
  Users, Bell, Calendar, Send, Eye,
  Package, Download, Shield, ClipboardCheck, RotateCcw,
} from 'lucide-react'

const ONBOARDING_KEY = (id) => `primesys_onboarded_${id}`

const SLIDES = {
  requestor: [
    {
      logo: true,
      color: 'from-amber-400 to-orange-400',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as a Requestor. This quick tour shows you how to file purchase requests for personal, event, office, or project needs.',
    },
    {
      Icon:  FileText,
      color: 'from-amber-400 to-yellow-400',
      title: 'Create a Purchase Request',
      body:  'Go to Purchase Requests → New Purchase Request. Pick a purpose (personal, event, office, or project), set your department, and list the items you need.',
    },
    {
      Icon:  Send,
      color: 'from-orange-400 to-red-400',
      title: 'Submit to TWG',
      body:  'Once your items are complete, click Submit to TWG, or Save as draft to finish later. The Technical Working Group reviews your specs first. They\'ll approve, request a revision, or reject, and you\'ll be notified. To change a submitted PR, open it and click Withdraw to edit.',
    },
    {
      Icon:  Eye,
      color: 'from-blue-400 to-indigo-400',
      title: 'Track Your PR',
      body:  'Watch your PR move through: Submitted → Approved by TWG → Bidding → Ready for PO → Completed. You\'ll get a notification at every stage.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-blue-600 to-indigo-500',
      title: 'You\'re all set!',
      body:  'Head to Purchase Requests to create your first PR. If you ever get lost, check the User Guide in the sidebar — it has everything you need.',
    },
  ],

  procurement: [
    {
      logo: true,
      color: 'from-blue-400 to-indigo-400',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as a Procurement Officer. You manage the full lifecycle of every purchase — from review to delivery. Here\'s a quick overview.',
    },
    {
      Icon:  FileText,
      color: 'from-amber-400 to-orange-400',
      title: 'Canvass TWG-Approved PRs',
      body:  'PRs reach you once the Technical Working Group approves them (Approved by TWG). Open one and click Canvass PR to begin canvassing. Status moves to Bidding.',
    },
    {
      Icon:  Gavel,
      color: 'from-purple-400 to-pink-400',
      title: 'Record the Award',
      body:  'On the PR, add each supplier\'s quotation, then click Award from Quotations: each item goes to the lowest price, and different items can go to different suppliers. Each supplier then gets its own purchase order.',
    },
    {
      Icon:  ShoppingCart,
      color: 'from-blue-600 to-indigo-500',
      title: 'Issue a Purchase Order',
      body:  'Open the PR (now Ready for PO) and issue the PO with supplier info and expected delivery date. The Supply Officer and the requestor are notified automatically.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-amber-500 to-yellow-400',
      title: 'You\'re all set!',
      body:  'Check Reports for analytics and use Reminders to schedule follow-ups. The User Guide in the sidebar covers every feature in detail.',
    },
  ],

  supply: [
    {
      logo: true,
      color: 'from-blue-600 to-indigo-500',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as a Supply Officer. Your job is to receive goods and record deliveries against Purchase Orders. Here\'s how it works.',
    },
    {
      Icon:  Bell,
      color: 'from-amber-400 to-orange-400',
      title: 'Get Notified of New POs',
      body:  'When a Purchase Order is issued, you\'ll get a real-time notification. Your dashboard lists what is still to receive, soonest due first, and counts the overdue POs.',
    },
    {
      Icon:  Package,
      color: 'from-blue-400 to-indigo-400',
      title: 'Open the PO',
      body:  'Click a PO on the Purchase Orders page to see its items and how many of each have arrived and are still to come.',
    },
    {
      Icon:  Truck,
      color: 'from-purple-400 to-pink-400',
      title: 'Record the Delivery',
      body:  'Click Receive on the PO, enter how many of each item arrived, and set the date. Download the IAR PDF for filing.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-blue-600 to-indigo-500',
      title: 'You\'re all set!',
      body:  'If only some items arrived, enter just those: the rest stays on the PO until it arrives. Check the User Guide in the sidebar for more details.',
    },
  ],

  twg: [
    {
      logo: true,
      color: 'from-cyan-400 to-blue-400',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as a member of the Technical Working Group. You review the specifications of every Purchase Request before it reaches Procurement. Here\'s how it works.',
    },
    {
      Icon:  ClipboardCheck,
      color: 'from-amber-400 to-orange-400',
      title: 'Your Review Queue',
      body:  'When a Requestor submits a PR, it lands in your TWG Reviews queue. Open it to see every item, quantity, unit cost, and attachment.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-emerald-400 to-teal-400',
      title: 'Approve & Forward',
      body:  'If the specifications are correct, click Approve & Forward. The PR moves to Procurement\'s queue and they can start canvassing suppliers.',
    },
    {
      Icon:  RotateCcw,
      color: 'from-amber-500 to-yellow-400',
      title: 'Request a Revision',
      body:  'If something needs to change, click Request Revision and explain what the Requestor should fix. They get notified and can resubmit after editing. If the request can\'t go ahead, click Reject and give the reason.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-cyan-500 to-blue-500',
      title: 'You\'re all set!',
      body:  'Head to TWG Reviews to start. Your dashboard shows pending count, weekly activity, and your recent decisions. The User Guide has more details.',
    },
  ],

  admin: [
    {
      logo: true,
      color: 'from-purple-400 to-pink-400',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as Administrator. You have full access to the system — users, quarters, PRs, POs, and reports. Here\'s a quick overview.',
    },
    {
      Icon:  Users,
      color: 'from-blue-400 to-indigo-400',
      title: 'Manage Users',
      body:  'Go to User Management to create accounts, assign roles (Admin, Procurement, Requestor, Supply, TWG), and activate or deactivate users. Public sign-up always creates Requestors.',
    },
    {
      Icon:  Calendar,
      color: 'from-amber-400 to-orange-400',
      title: 'Set Up Quarters',
      body:  'Go to Quarters to create fiscal quarters (Q1–Q4) and set the active one. New PRs are filed under the active quarter automatically.',
    },
    {
      Icon:  Shield,
      color: 'from-blue-600 to-indigo-500',
      title: 'Full System View',
      body:  'You can see every PR, PO, and delivery. Finished PRs (completed, rejected, or cancelled) are kept in the Archive and can\'t be deleted. Use Reports for system-wide analytics.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-amber-500 to-yellow-400',
      title: 'You\'re all set!',
      body:  'Start by creating user accounts and setting the active quarter. Everything else is in the User Guide — accessible from the sidebar anytime.',
    },
  ],
}

export default function OnboardingModal({ forceShow = false, onClose }) {
  const { user } = useAuth()
  const [visible,   setVisible]   = useState(false)
  const [step,      setStep]      = useState(0)
  const [direction, setDirection] = useState('right')
  const [animKey,   setAnimKey]   = useState(0)

  useEffect(() => {
    if (!user?.id) return
    if (forceShow) { setStep(0); setVisible(true); return }
    const seen = localStorage.getItem(ONBOARDING_KEY(user.id))
    if (!seen) setVisible(true)
  }, [user?.id, forceShow])

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_KEY(user.id), '1')
    setVisible(false)
    onClose?.()
  }

  if (!visible || !user?.role) return null

  const slides = SLIDES[user.role] || []
  const total  = slides.length
  const slide  = slides[step]
  const isLast = step === total - 1

  const go = (dir) => {
    setDirection(dir)
    setAnimKey(k => k + 1)
    setStep(s => s + (dir === 'right' ? 1 : -1))
  }

  const animClass = direction === 'right'
    ? 'animate-fade-in-left'
    : 'animate-fade-in-right'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', animation: 'fade-in 0.2s ease-out both' }}>

      <div className="relative w-full max-w-lg rounded-2xl bg-[--color-surface] shadow-2xl overflow-hidden animate-scale-in-fast">

        {/* Gradient top bar */}
        <div className={`h-2 w-full bg-gradient-to-r ${slide.color}`} />

        {/* Skip button */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[--color-overlay] transition-colors"
          title="Skip tour"
        >
          <X className="size-4" />
        </button>

        {/* Slide content */}
        <div
          key={animKey}
          className={`px-10 pt-10 pb-7 text-center ${animClass}`}
          style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* Icon */}
          {slide.logo ? (
            <div className="mb-6 flex size-24 items-center justify-center animate-scale-in-fast">
              <img src="/nemsu-logo.png" alt="NEMSU seal" className="size-20 object-contain" />
            </div>
          ) : (
            <div className={`mb-6 flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br ${slide.color} shadow-lg animate-scale-in-fast`}>
              {slide.Icon ? <slide.Icon className="size-10 text-white" /> : null}
            </div>
          )}

          {/* Title */}
          <h2 className="text-2xl font-bold text-[--color-text-primary] mb-3 leading-tight">
            {step === 0 ? `${slide.title.replace('!', '')}, ${user.name?.split(' ')[0]}!` : slide.title}
          </h2>

          {/* Body */}
          <p className="text-sm text-[--color-text-secondary] leading-relaxed max-w-sm">
            {slide.body}
          </p>
        </div>

        {/* Footer */}
        <div className="px-10 pb-8 flex flex-col items-center gap-5">

          {/* Dot indicators */}
          <div className="flex items-center gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => { setDirection(i > step ? 'right' : 'left'); setAnimKey(k => k + 1); setStep(i) }}
                className={`rounded-full transition-all duration-300 ${
                  i === step
                    ? 'w-6 h-2 bg-[--color-brand]'
                    : 'w-2 h-2 bg-[--color-border] hover:bg-[--color-text-muted]'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex w-full items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => go('left')}
              disabled={step === 0}
              className="gap-1.5"
            >
              <ArrowLeft className="size-4" /> Back
            </Button>

            <button
              onClick={dismiss}
              className="text-xs text-[--color-text-muted] hover:text-[--color-text-secondary] transition-colors"
            >
              Skip tour
            </button>

            {isLast ? (
              <Button onClick={dismiss} className="gap-1.5">
                Get Started <CheckCircle className="size-4" />
              </Button>
            ) : (
              <Button onClick={() => go('right')} className="gap-1.5">
                Next <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
