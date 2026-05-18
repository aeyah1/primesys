export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'hsl(var(--brand) / <alpha-value>)',
          light:   'hsl(var(--brand-light) / <alpha-value>)',
          dark:    'hsl(var(--brand-dark) / <alpha-value>)',
        },
        canvas:  'hsl(var(--canvas) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        overlay: 'hsl(var(--overlay) / <alpha-value>)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      fontSize: {
        'ui-xs':   ['var(--text-xs)',   { lineHeight: '1.5' }],
        'ui-sm':   ['var(--text-sm)',   { lineHeight: '1.5' }],
        'ui-base': ['var(--text-base)', { lineHeight: '1.6' }],
        'ui-md':   ['var(--text-md)',   { lineHeight: '1.5' }],
        'ui-lg':   ['var(--text-lg)',   { lineHeight: '1.4' }],
        'ui-xl':   ['var(--text-xl)',   { lineHeight: '1.3' }],
        'ui-2xl':  ['var(--text-2xl)',  { lineHeight: '1.2' }],
        'ui-3xl':  ['var(--text-3xl)',  { lineHeight: '1.1' }],
      },

      /* ── Keyframes ──────────────────────────────────────────── */
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-down': {
          from: { opacity: '0', transform: 'translateY(-10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-left': {
          from: { opacity: '0', transform: 'translateX(14px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'fade-in-right': {
          from: { opacity: '0', transform: 'translateX(-14px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        'scale-in-fast': {
          '0%':   { opacity: '0', transform: 'scale(0.85)' },
          '60%':  { transform: 'scale(1.04)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'page-enter': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1',   transform: 'scale(1)' },
          '50%':       { opacity: '0.7', transform: 'scale(0.88)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':       { transform: 'translateY(-5px)' },
        },
        'pop': {
          '0%':   { transform: 'scale(1)' },
          '35%':  { transform: 'scale(1.12)' },
          '70%':  { transform: 'scale(0.96)' },
          '100%': { transform: 'scale(1)' },
        },
        'wiggle': {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '20%':  { transform: 'rotate(-4deg)' },
          '40%':  { transform: 'rotate(4deg)' },
          '60%':  { transform: 'rotate(-3deg)' },
          '80%':  { transform: 'rotate(3deg)' },
        },
        'ping-once': {
          '0%':          { transform: 'scale(1)',   opacity: '1' },
          '80%, 100%':   { transform: 'scale(1.9)', opacity: '0' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '40%':  { transform: 'translateY(-6px)' },
          '60%':  { transform: 'translateY(-3px)' },
        },
      },

      /* ── Animation utilities ────────────────────────────────── */
      animation: {
        'fade-in':      'fade-in 0.2s ease-out both',
        'fade-in-up':   'fade-in-up 0.28s ease-out both',
        'fade-in-down': 'fade-in-down 0.2s ease-out both',
        'fade-in-left': 'fade-in-left 0.25s ease-out both',
        'fade-in-right': 'fade-in-right 0.25s ease-out both',
        'scale-in':     'scale-in 0.2s ease-out both',
        'scale-in-fast': 'scale-in-fast 0.22s ease-out both',
        'slide-up':     'slide-up 0.3s ease-out both',
        'page':         'page-enter 0.22s ease-out both',
        'shimmer':      'shimmer 1.6s ease-in-out infinite',
        'pulse-soft':   'pulse-soft 2.2s ease-in-out infinite',
        'spin-slow':    'spin-slow 3s linear infinite',
        'float':        'float 3.2s ease-in-out infinite',
        'pop':          'pop 0.25s ease-out both',
        'wiggle':       'wiggle 0.5s ease-in-out',
        'ping-once':    'ping-once 0.8s cubic-bezier(0, 0, 0.2, 1)',
        'bounce-subtle': 'bounce-subtle 0.5s ease-out',
      },

      /* ── Transition durations ───────────────────────────────── */
      transitionDuration: {
        '80':  '80ms',
        '250': '250ms',
        '400': '400ms',
      },
    }
  },
  plugins: []
}
