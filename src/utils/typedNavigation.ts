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

// Transition types Chrome reports for navigations started from the omnibox
const ADDRESS_BAR_TRANSITION_TYPES: readonly string[] = [
  'typed',
  'generated',
  'keyword',
  'keyword_generated',
  'auto_bookmark',
];

// True when a committed navigation came from the address bar.
// Back/forward commits (including our own goBack) never qualify - loop guard.
// Link clicks, reloads, form submits and client/JS redirects do not qualify.
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

// Parse a URL's origin, or null when the string is not a valid URL
function originOf(url: string): string | null
{
  try
  {
    return new URL(url).origin;
  }
  catch
  {
    return null;
  }
}

// True when the requested URL is on a different origin (scheme + host + port)
// than the bookmark/pinned site's own URL. False when either fails to parse.
export function leavesItemOrigin(requestedUrl: string, itemUrl: string): boolean
{
  const requestedOrigin = originOf(requestedUrl);
  const itemOrigin = originOf(itemUrl);

  // Unparseable URLs: do nothing
  if (requestedOrigin === null || itemOrigin === null)
  {
    return false;
  }
  return requestedOrigin !== itemOrigin;
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
