export { default as AnimatedPage }   from './AnimatedPage'
export { default as AnimatedList }   from './AnimatedList'
export { default as AnimatedNumber } from './AnimatedNumber'

/**
 * Utility: returns inline style for staggered animation delay.
 * Usage: <div style={stagger(index)} className="animate-fade-in-up">
 */
export const stagger = (index, baseMs = 55) => ({
  animation: 'fade-in-up 0.28s ease-out both',
  animationDelay: `${index * baseMs}ms`,
})
