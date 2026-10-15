export function Kbd({ keys }: { keys: string[] }) {
  return <span className="gdp-kbd">{keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span>
}
