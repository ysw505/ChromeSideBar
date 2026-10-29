import { useState, useEffect, useMemo } from 'react';
import clsx from 'clsx';
import { Dialog } from './Dialog';
import { TagEditor } from './TagEditor';
import { parseTitleTags, normalizeTag, prefixColorPalette, tagKey } from '../utils/titlePrefix';

// How many of the selected bookmarks carry each tag (first-seen order).
// Grouped by tag key, so "Fin" and "fin" count as one tag shown with its first spelling.
class TagCoverage
{
  private readonly counts = new Map<string, number>();
  private readonly spellings = new Map<string, string>();

  constructor(nodes: chrome.bookmarks.BookmarkTreeNode[], readonly total: number = nodes.length)
  {
    // Count each tag once per bookmark (parseTitleTags already dedupes by key within a title)
    for (const node of nodes)
    {
      for (const tag of parseTitleTags(node.title)?.tags ?? [])
      {
        const key = tagKey(tag);
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
        if (!this.spellings.has(key))
        {
          this.spellings.set(key, tag);
        }
      }
    }
  }

  tags(): string[]
  {
    return [...this.spellings.values()];
  }

  countOf(tag: string): number
  {
    return this.counts.get(tagKey(tag)) ?? 0;
  }

  isOnAll(tag: string): boolean
  {
    return this.countOf(tag) === this.total;
  }
}

export interface BookmarkTagsBulkDialogProps
{
  isOpen: boolean;
  nodes: chrome.bookmarks.BookmarkTreeNode[];  // selected bookmarks (folders already left out)
  ignoredFolderCount?: number;  // folders in the selection, mentioned in the header
  existingTags?: string[];  // tag suggestions, already ordered by the caller
  onApply: (add: string[], remove: Set<string>) => void;
  onClose: () => void;
}

// Add / remove tags on several bookmarks at once
export const BookmarkTagsBulkDialog = ({
  isOpen,
  nodes,
  ignoredFolderCount = 0,
  existingTags = [],
  onApply,
  onClose
}: BookmarkTagsBulkDialogProps) =>
{
  const [added, setAdded] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  // Start empty each time the dialog opens
  useEffect(() =>
  {
    if (isOpen)
    {
      setAdded([]);
      setTagInput('');
      setRemoved(new Set());
    }
  }, [isOpen]);

  const coverage = useMemo(() => new TagCoverage(nodes), [nodes]);
  // Tags already on every selected bookmark would add nothing
  const suggestions = existingTags.filter(tag => !coverage.isOnAll(tag));

  // A typed but not yet entered tag counts as added (same as the single Edit dialog)
  const typedTag = normalizeTag(tagInput);
  const typedIsNew = typedTag && !added.some(tag => tagKey(tag) === tagKey(typedTag));
  const addedWithTyped = typedIsNew ? [...added, typedTag] : added;
  const hasChanges = addedWithTyped.length > 0 || removed.size > 0;

  const toggleRemoved = (tag: string) =>
  {
    const next = new Set(removed);
    // Second click un-marks the tag
    if (next.has(tag))
    {
      next.delete(tag);
    }
    else
    {
      next.add(tag);
    }
    setRemoved(next);
  };

  const handleSubmit = (e: React.FormEvent) =>
  {
    e.preventDefault();
    if (!hasChanges)
    {
      return;
    }
    onApply(addedWithTyped, removed);
    onClose();
  };

  const bookmarkWord = nodes.length === 1 ? 'bookmark' : 'bookmarks';
  const folderNote = ignoredFolderCount > 0
    ? ` (${ignoredFolderCount} ${ignoredFolderCount === 1 ? 'folder' : 'folders'} ignored)`
    : '';
  const currentTags = coverage.tags();

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Tags"
      maxWidth="max-w-sm"
    >
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <p className="text-gray-500 dark:text-gray-400">{nodes.length} {bookmarkWord}{folderNote}</p>

        <div>
          <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">Current tags</label>
          {currentTags.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-[11px]">No tags yet</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {/* Union of tags on the selection: click to mark for removal from all */}
              {currentTags.map(tag =>
              {
                const isRemoved = removed.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleRemoved(tag)}
                    className={clsx(
                      'inline-flex items-center px-1 rounded text-[11px] leading-5 font-medium whitespace-nowrap',
                      prefixColorPalette.classesFor(tag),
                      isRemoved && 'line-through opacity-40'
                    )}
                    title={isRemoved ? 'Click to keep' : 'Click to remove from all'}
                    aria-pressed={isRemoved}
                  >
                    {tag}
                    {!coverage.isOnAll(tag) && (
                      <span className="ml-1 opacity-70 font-normal">{coverage.countOf(tag)}/{coverage.total}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">Add tags</label>
          <TagEditor
            tags={added}
            suggestions={suggestions}
            onChange={setAdded}
            input={tagInput}
            onInputChange={setTagInput}
          />
        </div>

        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!hasChanges}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-500"
          >
            Apply
          </button>
        </div>
      </form>
    </Dialog>
  );
};
