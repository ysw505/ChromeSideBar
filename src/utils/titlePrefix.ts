// "prefix · rest" bookmark names: split the prefix off so it can be shown as a colored tag

// Separator between prefix and rest: space, U+00B7 middle dot, space
const PREFIX_SEPARATOR = ' · ';

export interface TitlePrefix
{
  prefix: string;
  rest: string;
}

// Split a title on the first " · ". Returns undefined unless both sides are non-empty after trim.
export function splitTitlePrefix(title: string): TitlePrefix | undefined
{
  const separatorIndex = title.indexOf(PREFIX_SEPARATOR);
  if (separatorIndex < 0)
  {
    return undefined;
  }

  const prefix = title.slice(0, separatorIndex).trim();
  const rest = title.slice(separatorIndex + PREFIX_SEPARATOR.length).trim();
  if (!prefix || !rest)
  {
    return undefined;
  }
  return { prefix, rest };
}

// Fixed tag colors (light + dark). Full class strings so Tailwind picks them up.
const PREFIX_TAG_CLASSES = [
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200',
];

// Picks a stable color for a prefix: the same prefix always gets the same color
export class PrefixColorPalette
{
  constructor(private readonly classes: readonly string[] = PREFIX_TAG_CLASSES)
  {
  }

  classesFor(prefix: string): string
  {
    return this.classes[PrefixColorPalette.hash(prefix) % this.classes.length];
  }

  // Deterministic 32-bit string hash (FNV-1a), unsigned
  private static hash(text: string): number
  {
    let hash = 0x811c9dc5;
    // Mix in each UTF-16 code unit
    for (let i = 0; i < text.length; i++)
    {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
}

export const prefixColorPalette = new PrefixColorPalette();
