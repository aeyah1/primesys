import { useState, useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import {
  X, ArrowRight, ArrowLeft, CheckCircle,
  FileText, Gavel, ShoppingCart, Truck,
  Users, Bell, Calendar, BookOpen, Send, Eye,
  Package, Download, Shield,
} from 'lucide-react'

const ONBOARDING_KEY = (id) => `primesys_onboarded_${id}`

const SLIDES = {
  extension: [
    {
      icon: '👋',
      color: 'from-amber-400 to-orange-400',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as an Extension Officer. This quick tour will show you exactly what you can do here. It\'ll only take a minute.',
    },
    {
      Icon:  FileText,
      color: 'from-amber-400 to-yellow-400',
      title: 'Create a Purchase Request',
      body:  'When your office needs supplies, go to Purchase Requests → New Purchase Request. Fill in your items — description, quantity, unit, and estimated cost.',
    },
    {
      Icon:  Send,
      color: 'from-orange-400 to-red-400',
      title: 'Submit to Procurement',
      body:  'Once your items are complete, open the PR and click Submit. Procurement will take over from there. You won\'t be able to edit it after submitting.',
    },
    {
      Icon:  Eye,
      color: 'from-blue-400 to-indigo-400',
      title: 'Track Your PR',
      body:  'Watch your PR move through: Submitted → Bidding → Ready for PO → Completed. You\'ll get a notification at every stage.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-emerald-400 to-teal-400',
      title: 'You\'re all set!',
      body:  'Head to Purchase Requests to create your first PR. If you ever get lost, check the User Guide in the sidebar — it has everything you need.',
    },
  ],

  procurement: [
    {
      icon: '👋',
      color: 'from-blue-400 to-indigo-400',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as a Procurement Officer. You manage the full lifecycle of every purchase — from review to delivery. Here\'s a quick overview.',
    },
    {
      Icon:  FileText,
      color: 'from-amber-400 to-orange-400',
      title: 'Review Submitted PRs',
      body:  'New submissions appear highlighted in the PR list. Open a PR and click Canvass PR to begin the bidding process. Status moves to Bidding.',
    },
    {
      Icon:  Gavel,
      color: 'from-purple-400 to-pink-400',
      title: 'Create Lots & Award Suppliers',
      body:  'Go to Lots & Awards to group PR items into lots and assign suppliers. Once all lots are awarded, the PR automatically moves to Ready for PO.',
    },
    {
      Icon:  ShoppingCart,
      color: 'from-emerald-400 to-teal-400',
      title: 'Issue a Purchase Order',
      body:  'Open the PR (now Ready for PO) and issue the PO with supplier info and expected delivery date. The Supply Officer will be notified automatically.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-emerald-400 to-green-400',
      title: 'You\'re all set!',
      body:  'Check Reports for analytics and use Reminders to schedule follow-ups. The User Guide in the sidebar covers every feature in detail.',
    },
  ],

  supply: [
    {
      icon: '👋',
      color: 'from-emerald-400 to-teal-400',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as a Supply Officer. Your job is to receive goods and record deliveries against Purchase Orders. Here\'s how it works.',
    },
    {
      Icon:  Bell,
      color: 'from-amber-400 to-orange-400',
      title: 'Get Notified of New POs',
      body:  'When a Purchase Order is issued, you\'ll get a real-time notification. You can also check the Deliveries page anytime for all pending deliveries.',
    },
    {
      Icon:  Package,
      color: 'from-blue-400 to-indigo-400',
      title: 'Check Lots & Awards',
      body:  'Visit Lots & Awards to see which suppliers were awarded and what items to expect. This helps you verify what\'s coming in.',
    },
    {
      Icon:  Truck,
      color: 'from-purple-400 to-pink-400',
      title: 'Record the Delivery',
      body:  'Go to Deliveries → Record Delivery. Select the PO, set the date, choose Complete or Partial, and add notes. Download the IAR PDF for filing.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-emerald-400 to-teal-400',
      title: 'You\'re all set!',
      body:  'If only some items arrived, record it as Partial and record again when the rest arrive. Check the User Guide in the sidebar for more details.',
    },
  ],

  admin: [
    {
      icon: '👋',
      color: 'from-purple-400 to-pink-400',
      title: 'Welcome to PRimeSys!',
      body:  'You\'re logged in as Administrator. You have full access to the system — users, quarters, PRs, POs, and reports. Here\'s a quick overview.',
    },
    {
      Icon:  Users,
      color: 'from-blue-400 to-indigo-400',
      title: 'Manage Users',
      body:  'Go to User Management to create accounts, assign roles (Admin, Procurement, Extension, Supply), and activate or deactivate users.',
    },
    {
      Icon:  Calendar,
      color: 'from-amber-400 to-orange-400',
      title: 'Set Up Quarters',
      body:  'Go to Quarters to create fiscal quarters (Q1–Q4) and set the active one. Extension Officers need an active quarter before they can submit PRs.',
    },
    {
      Icon:  Shield,
      color: 'from-emerald-400 to-teal-400',
      title: 'Full System Access',
      body:  'You can read, edit, and delete any PR or PO in the system. Use Reports for system-wide analytics and trends across all procurement activity.',
    },
    {
      Icon:  CheckCircle,
      color: 'from-emerald-400 to-green-400',
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
          <div className={`mb-6 flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br ${slide.color} shadow-lg animate-scale-in-fast`}>
            {slide.icon
              ? <span className="text-4xl">{slide.icon}</span>
              : slide.Icon
                ? <slide.Icon className="size-10 text-white" />
                : null
            }
          </div>

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
