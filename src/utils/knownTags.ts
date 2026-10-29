import { collectTitleTags, tagKey } from './titlePrefix';

// The set of tags used in bookmark titles, looked up case-insensitively
export class KnownTags
{
  static readonly EMPTY = new KnownTags();

  private readonly spellingByKey = new Map<string, string>();

  // spellings: most used first; the first spelling seen for a key is the canonical one
  constructor(spellings: string[] = [])
  {
    // Keep the first spelling per tag key
    for (const spelling of spellings)
    {
      const key = tagKey(spelling);
      if (!this.spellingByKey.has(key))
      {
        this.spellingByKey.set(key, spelling);
      }
    }
  }

  // Tags of every bookmark title in the given (live) bookmark tree
  static fromTree(nodes: chrome.bookmarks.BookmarkTreeNode[]): KnownTags
  {
    return new KnownTags(collectTitleTags(nodes));
  }

  // Canonical spelling of the tag that equals this word (ignoring case), or undefined if it is not a tag
  spellingFor(word: string): string | undefined
  {
    return this.spellingByKey.get(tagKey(word));
  }
}
