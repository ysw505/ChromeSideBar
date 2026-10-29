// Tags in bookmark names: "#fin #kr argocd" (hashtags anywhere) or the older "fin · argocd" form.
// The tags are shown as colored chips and the rest of the title as the name.

// Legacy separator between tag and name: space, U+00B7 middle dot, space
const LEGACY_SEPARATOR = ' · ';

// A hashtag token: "#" at the start or after whitespace, then 1+ chars that are neither
// whitespace nor "#", ending at whitespace or end of string ("#fin#kr" is not a tag)
const HASHTAG_TOKEN = /(^|\s)#([^\s#]+)(?=\s|$)/gu;

// A tag must contain at least one letter, so "Issue #123" keeps its number
const HAS_LETTER = /\p{L}/u;

export interface TitleTags
{
  tags: string[];
  name: string;
}

// Comparison key for a tag: "Fin" and "fin" are the same tag. Only comparisons, dedupe,
// counts and colors use the key; the first spelling seen is what gets shown or written back.
export function tagKey(tag: string): string
{
  return tag.toLocaleLowerCase();
}

// Ordered tag list without case-insensitive duplicates, keeping each tag's first spelling
class TagList
{
  private readonly items: string[] = [];
  private readonly keys = new Set<string>();

  add(tag: string): void
  {
    const key = tagKey(tag);
    if (!this.keys.has(key))
    {
      this.keys.add(key);
      this.items.push(tag);
    }
  }

  toArray(): string[]
  {
    return [...this.items];
  }
}

// Collapse whitespace runs and trim
function collapseSpaces(text: string): string
{
  return text.replace(/\s+/g, ' ').trim();
}

// Hashtag form: pull out every "#word" token that contains a letter
function parseHashtags(title: string): TitleTags
{
  const tags = new TagList();
  const name = title.replace(HASHTAG_TOKEN, (token: string, lead: string, word: string) =>
  {
    // Numbers-only tokens like "#123" stay in the name
    if (!HAS_LETTER.test(word))
    {
      return token;
    }
    tags.add(word);
    return lead || ' ';
  });
  return { tags: tags.toArray(), name: collapseSpaces(name) };
}

// Legacy form: "a · b · name" -> tags [a, b], name "name"
function parseLegacySeparator(title: string): TitleTags
{
  const segments = title.split(LEGACY_SEPARATOR).map(s => s.trim()).filter(s => s.length > 0);
  if (segments.length < 2)
  {
    return { tags: [], name: title.trim() };
  }
  const tags = new TagList();
  segments.slice(0, -1).forEach(tag => tags.add(tag));
  return { tags: tags.toArray(), name: segments[segments.length - 1] };
}

// Split a title into tags + name, even when nothing is left as the name ("#fin" -> tags [fin], name "")
export function splitTitleTags(title: string): TitleTags
{
  // Hashtags win; the " · " form is only read when no hashtag is present
  const parsed = parseHashtags(title);
  if (parsed.tags.length === 0)
  {
    return parseLegacySeparator(title);
  }
  return parsed;
}

// Split a title into tags + name. Undefined when there are no tags or nothing is left as the name.
export function parseTitleTags(title: string): TitleTags | undefined
{
  const parsed = splitTitleTags(title);
  if (parsed.tags.length === 0 || !parsed.name)
  {
    return undefined;
  }
  return parsed;
}

// Clean up one typed tag: trim, drop leading "#", join inner spaces with "-"
export function normalizeTag(tag: string): string
{
  return tag.trim().replace(/^#+/, '').trim().replace(/\s+/g, '-');
}

// Canonical title: tags first as hashtags, then the name ("#fin #kr argocd")
export function formatTitleTags(tags: string[], name: string): string
{
  const tagList = new TagList();
  // Normalise, drop empties and (case-insensitive) duplicates, keep order
  for (const tag of tags)
  {
    const clean = normalizeTag(tag);
    if (clean)
    {
      tagList.add(clean);
    }
  }
  const cleanTags = tagList.toArray();
  const cleanName = name.trim();
  if (cleanTags.length === 0)
  {
    return cleanName;
  }
  const hashtags = cleanTags.map(tag => `#${tag}`).join(' ');
  return cleanName ? `${hashtags} ${cleanName}` : hashtags;
}

// Bulk tag edit for one title: drop the `remove` tags, append the `add` tags it lacks,
// and rebuild it in the canonical "#tag name" form (legacy " · " titles get rewritten too)
export function retagTitle(title: string, add: string[], remove: Set<string>): string
{
  const parsed = parseTitleTags(title);
  // No tags/name split: either a plain title or one with no name part
  if (!parsed)
  {
    // Tags-only ("#fin #kr") or empty titles have no name to keep; adding tags would
    // still leave a tags-only title that shows as plain text, so leave them untouched
    const hasNoName = parseHashtags(title).tags.length > 0 || !title.trim();
    if (hasNoName || add.length === 0)
    {
      return title;
    }
    return formatTitleTags(add, title);
  }
  // Compare by tag key so "Fin" removes / already covers "fin"
  const removeKeys = new Set([...remove].map(tagKey));
  const kept = parsed.tags.filter(tag => !removeKeys.has(tagKey(tag)));
  // formatTitleTags drops added tags whose key is already kept
  return formatTitleTags([...kept, ...add], parsed.name);
}

// How often each tag is used, with a stable "most used first, then A-Z" order.
// Counted by tag key; the first spelling seen is the one returned.
class TagUsageCounts
{
  private readonly counts = new Map<string, number>();
  private readonly spellings = new Map<string, string>();

  add(tag: string): void
  {
    const key = tagKey(tag);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    if (!this.spellings.has(key))
    {
      this.spellings.set(key, tag);
    }
  }

  has(tag: string): boolean
  {
    return this.counts.has(tagKey(tag));
  }

  mostUsedFirst(): string[]
  {
    const keys = [...this.counts.keys()].sort((a, b) =>
      (this.counts.get(b)! - this.counts.get(a)!) || a.localeCompare(b));
    return keys.map(key => this.spellings.get(key)!);
  }
}

// All tags used in the bookmark tree, ordered for suggestions:
// tags used in the preferred folder first, then every other tag (each group most used first)
export function collectTitleTags(nodes: chrome.bookmarks.BookmarkTreeNode[], preferredParentId?: string | null): string[]
{
  const inFolder = new TagUsageCounts();
  const everywhere = new TagUsageCounts();

  // Walk the whole tree and count tags of bookmark (url) nodes
  const visit = (node: chrome.bookmarks.BookmarkTreeNode): void =>
  {
    if (node.url)
    {
      const parsed = parseTitleTags(node.title);
      // Count each tag of this bookmark
      for (const tag of parsed?.tags ?? [])
      {
        everywhere.add(tag);
        if (preferredParentId && node.parentId === preferredParentId)
        {
          inFolder.add(tag);
        }
      }
    }
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);

  const preferred = inFolder.mostUsedFirst();
  const others = everywhere.mostUsedFirst().filter(tag => !inFolder.has(tag));
  return [...preferred, ...others];
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

// Picks a stable color for a tag: the same tag always gets the same color
export class PrefixColorPalette
{
  constructor(private readonly classes: readonly string[] = PREFIX_TAG_CLASSES)
  {
  }

  classesFor(prefix: string): string
  {
    // Hash the tag key so "Fin" and "fin" get the same color
    return this.classes[PrefixColorPalette.hash(tagKey(prefix)) % this.classes.length];
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
