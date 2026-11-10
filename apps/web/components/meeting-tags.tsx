/**
 * Tags de identificação da reunião (lista e sala). A cor do TIPO é derivada
 * do nome (mesmo nome → mesma cor em qualquer tela) a partir de uma paleta
 * fixa — sem coluna nova nem configuração.
 */
const TYPE_PALETTE = [
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800',
  'bg-orange-100 text-orange-800',
] as const;

export function typeTagClass(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TYPE_PALETTE[hash % TYPE_PALETTE.length]!;
}

export function MeetingTypeTag({ name }: { name: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${typeTagClass(name)}`}>🏷 {name}</span>
  );
}
