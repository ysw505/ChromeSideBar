// Finds an already-open tab showing the same page as a bookmark or pinned
// site, so opening the item can reuse that tab instead of creating a
// duplicate. Pure - no chrome.* calls - so the matching rule is unit-testable.

/**
 * Normalize a URL for "is this the same page" comparison: drops the #fragment
 * only. The query string is kept (e.g. GitHub `issues?q=...` filters are
 * different pages), and http/https stay distinct. Returns undefined when the
 * URL doesn't parse.
 */
export function normalizeUrlForTabMatch(url: string): string | undefined
{
  try
  {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  }
  catch
  {
    return undefined;
  }
}

export class SameUrlTabFinder
{
  /**
   * Pick the tab to adopt for `url` from `tabs`, skipping tabs already
   * associated with another bookmark/pinned site. A tab matches on its
   * committed url or its pending (still-loading) url. When several match,
   * the active one wins, otherwise the leftmost (lowest index).
   */
  find(tabs: chrome.tabs.Tab[], url: string, associatedTabIds: Set<number>): chrome.tabs.Tab | undefined
  {
    const target = normalizeUrlForTabMatch(url);
    if (target === undefined) return undefined;

    const candidates = tabs.filter(tab => this.isAdoptable(tab, target, associatedTabIds));
    return this.pickPreferred(candidates);
  }

  private isAdoptable(tab: chrome.tabs.Tab, target: string, associatedTabIds: Set<number>): boolean
  {
    if (tab.id === undefined || associatedTabIds.has(tab.id)) return false;
    return this.showsUrl(tab.url, target) || this.showsUrl(tab.pendingUrl, target);
  }

  private showsUrl(tabUrl: string | undefined, target: string): boolean
  {
    if (!tabUrl) return false;
    return normalizeUrlForTabMatch(tabUrl) === target;
  }

  private pickPreferred(candidates: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined
  {
    const active = candidates.find(tab => tab.active);
    if (active) return active;

    // No active match - fall back to the leftmost matching tab
    let leftmost: chrome.tabs.Tab | undefined;
    for (const tab of candidates)
    {
      if (leftmost === undefined || tab.index < leftmost.index)
      {
        leftmost = tab;
      }
    }
    return leftmost;
  }
}
