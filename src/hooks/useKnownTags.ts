import { useEffect, useState } from 'react';
import { collectTitleTags, tagKey } from '../utils/titlePrefix';

// Wait this long after the last bookmark event before re-reading the tree
const REFRESH_DEBOUNCE_MS = 300;

// The set of tags used in bookmark titles, looked up case-insensitively
export class KnownTags
{
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

  // Canonical spelling of the tag that equals this word (ignoring case), or undefined if it is not a tag
  spellingFor(word: string): string | undefined
  {
    return this.spellingByKey.get(tagKey(word));
  }
}

// Tags currently used in bookmark titles; refreshed when bookmarks change
export function useKnownTags(): KnownTags
{
  const [knownTags, setKnownTags] = useState<KnownTags>(() => new KnownTags());

  useEffect(() =>
  {
    const bookmarks = typeof chrome !== 'undefined' ? chrome.bookmarks : undefined;
    // No bookmarks API (e.g. outside the extension): keep the empty set
    if (!bookmarks?.getTree)
    {
      return;
    }

    let disposed = false;
    const load = () =>
    {
      bookmarks.getTree((tree) =>
      {
        if (disposed)
        {
          return;
        }
        // Ignore read errors; the previous tag set stays in place
        if (chrome.runtime?.lastError || !tree)
        {
          if (import.meta.env.DEV)
          {
            console.log('[useKnownTags] getTree failed', chrome.runtime?.lastError);
          }
          return;
        }
        setKnownTags(new KnownTags(collectTitleTags(tree)));
      });
    };

    // Coalesce bursts of bookmark events into one re-read
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleLoad = () =>
    {
      if (timer)
      {
        clearTimeout(timer);
      }
      timer = setTimeout(() =>
      {
        timer = null;
        load();
      }, REFRESH_DEBOUNCE_MS);
    };

    load();

    const events = [
      bookmarks.onCreated,
      bookmarks.onChanged,
      bookmarks.onRemoved,
      bookmarks.onMoved,
    ];
    // Subscribe to every bookmark change that can add, rename or drop a tag
    for (const event of events)
    {
      event?.addListener(scheduleLoad);
    }

    return () =>
    {
      disposed = true;
      if (timer)
      {
        clearTimeout(timer);
      }
      // Unsubscribe from the same events
      for (const event of events)
      {
        event?.removeListener(scheduleLoad);
      }
    };
  }, []);

  return knownTags;
}
