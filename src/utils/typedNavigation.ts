// "Typed addresses open in a new tab" setting: when a bookmark/pinned site's
// tab is sent to another site from the address bar, background.ts opens that
// site in a new tab and sends the associated tab back to its page.
// Pure decision logic lives here so it can be tested without chrome.*.

// chrome.storage.local key. Written by App.tsx via useChromeLocalStorage
// (booleans stored as 'true'/'false'), read by background.ts at navigation time.
export const TYPED_URL_NEW_TAB_KEY = 'sidebar-typed-url-new-tab';

// Parse a stored value; anything other than 'true' means off (the default).
export function parseTypedUrlNewTab(raw: unknown): boolean
{
  return raw === 'true';
}

// Transition types Chrome reports only for navigations started from the omnibox
const ADDRESS_BAR_TRANSITION_TYPES: readonly string[] = [
  'typed',
  'generated',
  'keyword',
  'keyword_generated',
];

// True when a committed navigation came from the address bar.
// Back/forward commits (including our own goBack) never qualify - loop guard.
// Link clicks, reloads, form submits and client/JS redirects do not qualify.
// 'auto_bookmark' is also what a click on Chrome's own bookmarks bar reports, so it counts
// only with the from_address_bar qualifier (a bookmark picked from omnibox suggestions).
export function isAddressBarNavigation(transitionType: string, qualifiers: readonly string[]): boolean
{
  // Back/forward navigation, e.g. the goBack we issue ourselves
  if (qualifiers.includes('forward_back'))
  {
    return false;
  }
  return ADDRESS_BAR_TRANSITION_TYPES.includes(transitionType)
    || qualifiers.includes('from_address_bar');
}

// A URL's host name for comparison: lower case, port and scheme ignored, one leading "www." removed.
// Null when the string is not a valid URL.
function comparableHostOf(url: string): string | null
{
  try
  {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  }
  catch
  {
    return null;
  }
}

// True when the requested URL is on a different host than the bookmark/pinned site's own URL
// (scheme, port and a leading "www." ignored). False when either fails to parse.
export function leavesItemHost(requestedUrl: string, itemUrl: string): boolean
{
  const requestedHost = comparableHostOf(requestedUrl);
  const itemHost = comparableHostOf(itemUrl);

  // Unparseable URLs: do nothing
  if (requestedHost === null || itemHost === null)
  {
    return false;
  }
  return requestedHost !== itemHost;
}

// Remembers the URL each tab asked for in onBeforeNavigate (top frame only),
// i.e. what the user typed before any server redirect, so onCommitted can
// open that URL rather than the redirect target.
export class RequestedUrlTracker
{
  private urlsByTab = new Map<number, string>();

  remember(tabId: number, url: string): void
  {
    this.urlsByTab.set(tabId, url);
  }

  get(tabId: number): string | undefined
  {
    return this.urlsByTab.get(tabId);
  }

  // Read and clear in one step
  take(tabId: number): string | undefined
  {
    const url = this.urlsByTab.get(tabId);
    this.urlsByTab.delete(tabId);
    return url;
  }

  forget(tabId: number): void
  {
    this.urlsByTab.delete(tabId);
  }
}
