import { Children } from 'react'

/**
 * AnimatedList — wraps each direct child with a staggered fade-in-up animation.
 *
 * Usage with children:
 *   <AnimatedList staggerMs={60}>
 *     {items.map(item => <Card key={item.id} />)}
 *   </AnimatedList>
 *
 * Usage with items + renderItem:
 *   <AnimatedList items={data} renderItem={(item, i) => <Row key={i} {...item} />} />
 */
export default function AnimatedList({
  children,
  items,
  renderItem,
  className = '',
  staggerMs = 55,
  tag: Tag = 'div',
}) {
  const wrapItem = (child, i) => (
    <div
      key={i}
      style={{
        animation: 'fade-in-up 0.28s ease-out both',
        animationDelay: `${i * staggerMs}ms`,
      }}
    >
      {child}
    </div>
  )

  if (items && renderItem) {
    return (
      <Tag className={className}>
        {items.map((item, i) => wrapItem(renderItem(item, i), i))}
      </Tag>
    )
  }

  return (
    <Tag className={className}>
      {Children.map(children, (child, i) => child ? wrapItem(child, i) : null)}
    </Tag>
  )
}
