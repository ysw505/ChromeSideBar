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

// Same value as chrome.tabGroups.TAB_GROUP_ID_NONE (a tab in no group); repeated
// here so this module stays free of chrome.* references
const TAB_GROUP_ID_NONE = -1;

/** Extra rules for which tabs may be adopted. */
export interface AdoptionRules
{
  /**
   * Skip tabs already in a tab group. Set when adopting would move the tab
   * into a Space's group, so it isn't pulled out of the user's own group.
   */
  skipGrouped: boolean;
}

export class SameUrlTabFinder
{
  /**
   * Pick the tab to adopt for `url` from `tabs`, skipping tabs already
   * associated with another bookmark/pinned site, Chrome-pinned tabs, and
   * (with `rules.skipGrouped`) tabs in a tab group. A tab matches on its
   * pending (still-loading) url when there is one, otherwise on its committed
   * url. When several match, the active one wins, otherwise the leftmost
   * (lowest index).
   */
  find(
    tabs: chrome.tabs.Tab[],
    url: string,
    associatedTabIds: Set<number>,
    rules: AdoptionRules = { skipGrouped: false }
  ): chrome.tabs.Tab | undefined
  {
    const target = normalizeUrlForTabMatch(url);
    if (target === undefined) return undefined;

    const candidates = tabs.filter(tab => this.isAdoptable(tab, target, associatedTabIds, rules));
    return this.pickPreferred(candidates);
  }

  private isAdoptable(
    tab: chrome.tabs.Tab,
    target: string,
    associatedTabIds: Set<number>,
    rules: AdoptionRules
  ): boolean
  {
    if (tab.id === undefined || associatedTabIds.has(tab.id)) return false;
    // Chrome-pinned tabs belong to the tab strip's pinned area, never adopt them
    if (tab.pinned === true) return false;
    // A grouped tab would be pulled out of its group by the Space regroup
    if (rules.skipGrouped && tab.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE) return false;
    // A tab navigating elsewhere still has our page as its committed url,
    // so a pending url, when present, is the only one that counts
    if (tab.pendingUrl)
    {
      return this.showsUrl(tab.pendingUrl, target);
    }
    return this.showsUrl(tab.url, target);
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
