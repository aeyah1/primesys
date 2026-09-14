import { useId } from 'react'
import { Input } from '@/components/ui/input'

// Typeable unit field with a suggested-units dropdown.
// Browser-native <datalist> behavior:
//   - Click the field → dropdown of `options` opens
//   - Type freely → user can enter any custom unit (e.g. "carton", "bundle of 50")
//   - Type-ahead → matching suggestions narrow as the user types
export default function UnitInput({ value, onChange, options = [], placeholder = 'unit', className }) {
  const listId = useId()
  return (
    <>
      <Input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={className}
      />
      <datalist id={listId}>
        {options.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </>
  )
}
