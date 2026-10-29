import { GROUP_COLORS, isChromeColorName } from './groupColors';

// chrome.storage.local key for the user-assigned bookmark folder background colors
export const FOLDER_COLORS_KEY = 'sidebar-folder-colors';

// Immutable map of bookmark folder id -> Chrome tab group color name.
// A colored folder tints its own row and every row below it, until a sub-folder
// with its own color takes over for its subtree.
export class FolderColorMap
{
  static readonly EMPTY = new FolderColorMap({});

  private constructor(private readonly colors: Readonly<Record<string, chrome.tabGroups.ColorEnum>>)
  {
  }

  // Parse the stored JSON string; unknown color names are dropped
  static fromJSON(json: string): FolderColorMap
  {
    const raw = JSON.parse(json);
    const colors: Record<string, chrome.tabGroups.ColorEnum> = {};

    // Keep only entries whose value is a known Chrome color name
    if (raw && typeof raw === 'object')
    {
      for (const [folderId, color] of Object.entries(raw))
      {
        if (typeof color === 'string' && isChromeColorName(color))
        {
          colors[folderId] = color as chrome.tabGroups.ColorEnum;
        }
      }
    }
    return new FolderColorMap(colors);
  }

  toJSON(): Record<string, chrome.tabGroups.ColorEnum>
  {
    return { ...this.colors };
  }

  // The folder's own color (not inherited), if any
  get(folderId: string): chrome.tabGroups.ColorEnum | undefined
  {
    return this.colors[folderId];
  }

  // Returns a new map with the folder's color set, or removed when color is null
  with(folderId: string, color: chrome.tabGroups.ColorEnum | null): FolderColorMap
  {
    const next = { ...this.colors };
    if (color)
    {
      next[folderId] = color;
    }
    else
    {
      delete next[folderId];
    }
    return new FolderColorMap(next);
  }

  // Returns a new map with only the folders in liveFolderIds, or this map when every colored folder is still there
  prunedTo(liveFolderIds: ReadonlySet<string>): FolderColorMap
  {
    const deadIds = Object.keys(this.colors).filter(id => !liveFolderIds.has(id));
    if (deadIds.length === 0) return this;

    const next = { ...this.colors };
    // Drop each folder that no longer exists
    for (const id of deadIds)
    {
      delete next[id];
    }
    return new FolderColorMap(next);
  }
}

// Background tint class for a tree row.
// ownColor: the row is a folder with its own color (stronger tint for the header).
// effectiveColor: the color the row shows (own, or inherited from the nearest colored ancestor).
export const getFolderTintClass = (
  ownColor: chrome.tabGroups.ColorEnum | undefined,
  effectiveColor: chrome.tabGroups.ColorEnum | undefined
): string | undefined =>
{
  if (ownColor) return GROUP_COLORS[ownColor]?.bgStrong;
  if (effectiveColor) return GROUP_COLORS[effectiveColor]?.bg;
  return undefined;
};

// Collect the ids of every folder in the given nodes and below them (for pruning colors of deleted folders)
export const collectFolderIds = (nodes: chrome.bookmarks.BookmarkTreeNode[]): Set<string> =>
{
  const ids = new Set<string>();
  const stack = [...nodes];
  // Walk the tree depth-first, keeping folder ids only
  while (stack.length > 0)
  {
    const current = stack.pop()!;
    if (!current.url)
    {
      ids.add(current.id);
      stack.push(...(current.children ?? []));
    }
  }
  return ids;
};
