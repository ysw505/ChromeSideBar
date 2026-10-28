import { useState, useRef, useEffect } from 'react';
import { Dialog } from './Dialog';
import { TagEditor } from './TagEditor';
import { parseTitleTags, formatTitleTags } from '../utils/titlePrefix';

export interface BookmarkEditModalProps
{
  isOpen: boolean;
  node: chrome.bookmarks.BookmarkTreeNode | null;
  createInParentId?: string | null;  // If set, create mode; else edit mode
  onSave: (id: string, title: string, url?: string) => void;
  onCreate?: (parentId: string, title: string, url: string) => Promise<string | null>;  // Returns error message or null on success
  onClose: () => void;
  nameTags?: boolean;  // edit "#tag" parts of a bookmark name as chips (the tags setting)
  existingTags?: string[];  // tag suggestions, already ordered by the caller
}

export const BookmarkEditModal = ({
  isOpen,
  node,
  createInParentId,
  onSave,
  onCreate,
  onClose,
  nameTags = false,
  existingTags = []
}: BookmarkEditModalProps) =>
{
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isCreateMode = !!createInParentId;
  // Tags section: only for bookmarks (not folders) and only with the tags setting on
  const editsTags = nameTags && (isCreateMode || !!node?.url);

  // Reset state and focus input when dialog opens
  useEffect(() =>
  {
    if (isOpen)
    {
      setError(null);  // Clear any previous error
      setTagInput('');
      if (isCreateMode)
      {
        // Create mode: start with empty fields
        setTitle('');
        setTags([]);
        setUrl('');
      }
      else if (node)
      {
        // Edit mode: populate from existing node, splitting tags off the name when editing tags
        const parsed = editsTags ? parseTitleTags(node.title) : undefined;
        setTitle(parsed ? parsed.name : node.title);
        setTags(parsed ? parsed.tags : []);
        setUrl(node.url || '');
      }
      // Focus after a short delay to ensure portal is mounted
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, node, isCreateMode, editsTags]);

  // In edit mode, require node; in create mode, require parentId
  if (!isCreateMode && !node) return null;
  if (isCreateMode && !createInParentId) return null;

  const isFolder = !isCreateMode && node && !node.url;

  // Normalize URL by adding https:// if no protocol is specified
  const normalizeUrl = (inputUrl: string): string =>
  {
    const trimmed = inputUrl.trim();
    if (!trimmed) return trimmed;
    // Check if URL already has a protocol
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const handleSubmit = async (e: React.FormEvent) =>
  {
    e.preventDefault();
    // With tags on, the name part is required (a title of only tags would show as plain text)
    if (editsTags && !title.trim())
    {
      setError('Name is required');
      return;
    }
    const normalizedUrl = normalizeUrl(url);
    // With tags on, the saved title is rebuilt as "#tag1 #tag2 name" (a typed but un-added tag counts too)
    const savedTitle = editsTags ? formatTitleTags([...tags, tagInput], title) : title;
    if (isCreateMode && onCreate && createInParentId)
    {
      const errorMsg = await onCreate(createInParentId, savedTitle, normalizedUrl);
      if (errorMsg)
      {
        setError(errorMsg);
        return;  // Keep dialog open so user can fix the issue
      }
    }
    else if (node)
    {
      onSave(node.id, savedTitle, isFolder ? undefined : normalizedUrl);
    }
    onClose();
  };

  const dialogTitle = isCreateMode ? 'New Bookmark' : `Edit ${isFolder ? 'Folder' : 'Bookmark'}`;
  const submitButtonText = isCreateMode ? 'Create' : 'Save';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={dialogTitle}
      maxWidth="max-w-sm"
    >
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        {editsTags && (
          <div>
            <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">Tags</label>
            <TagEditor
              tags={tags}
              suggestions={existingTags}
              onChange={setTags}
              input={tagInput}
              onInputChange={setTagInput}
            />
          </div>
        )}

        <div>
          <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">Name</label>
          <input
            ref={inputRef}
            className="w-full px-2 py-1.5 border rounded-md dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required={editsTags}
          />
        </div>

        {(isCreateMode || !isFolder) && (
          <div>
            <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">URL</label>
            <input
              className="w-full px-2 py-1.5 border rounded-md dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); }}
              required={isCreateMode}
              placeholder={isCreateMode ? 'https://example.com' : undefined}
            />
            {error && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
        )}

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
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-md"
          >
            {submitButtonText}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
