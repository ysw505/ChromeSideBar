// Keyboard Space cycling (the "prev-space" / "next-space" commands).
//
// Kept pure so the wrap-around rule can be unit-tested without chrome.*.
// Unlike the panel's swipe gesture, which stops at either end, the keyboard
// commands wrap: next after the last Space goes back to "All", and previous
// from "All" goes to the last Space.

export const USE_SPACES_KEY = 'sidebar-use-spaces';

/**
 * Whether the user has Spaces turned on. useChromeLocalStorage stores the
 * setting as the string 'true' / 'false'; a missing key means the default,
 * which is enabled.
 */
export function isSpacesEnabled(rawValue: unknown): boolean
{
  return rawValue !== 'false' && rawValue !== false;
}

/**
 * Returns the id one step away from currentId in orderedIds, wrapping at both
 * ends. An unknown or missing currentId is treated as the first entry ("All").
 * Returns undefined when there is nothing to switch to (fewer than two ids).
 */
export function nextSpaceId(orderedIds: string[], currentId: string | undefined, direction: -1 | 1): string | undefined
{
  if (orderedIds.length < 2) return undefined;

  const found = currentId === undefined ? -1 : orderedIds.indexOf(currentId);
  const currentIndex = found === -1 ? 0 : found;
  const count = orderedIds.length;
  return orderedIds[(currentIndex + direction + count) % count];
}
