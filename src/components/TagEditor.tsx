import clsx from 'clsx';
import { normalizeTag, prefixColorPalette, tagKey } from '../utils/titlePrefix';

// Most tag suggestions shown under the selected tags
const MAX_TAG_SUGGESTIONS = 20;

export interface TagEditorProps
{
  tags: string[];  // selected tags, shown as chips with a remove button
  suggestions: string[];  // existing tags, already ordered by the caller
  onChange: (tags: string[]) => void;
  input: string;  // typed text in the "Add tag…" box (owned by the caller so a typed tag can count on save)
  onInputChange: (input: string) => void;
}

// Tag chips + "Add tag…" input + suggestion chips, shared by the single and bulk tag dialogs
export const TagEditor = ({ tags, suggestions, onChange, input, onInputChange }: TagEditorProps) =>
{
  // Whether a tag (any case) is already selected
  const isSelected = (tag: string) => tags.some(t => tagKey(t) === tagKey(tag));

  // Add a typed or suggested tag (normalised, no case-insensitive duplicates)
  const addTag = (rawTag: string) =>
  {
    const tag = normalizeTag(rawTag);
    if (tag && !isSelected(tag))
    {
      onChange([...tags, tag]);
    }
  };

  const removeTag = (tag: string) =>
  {
    onChange(tags.filter(t => t !== tag));
  };

  // Tag input keys: Enter / "," add the typed tag (without submitting the form), Backspace on empty removes the last tag
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) =>
  {
    if (e.key === 'Enter' || e.key === ',')
    {
      e.preventDefault();
      addTag(input);
      onInputChange('');
    }
    else if (e.key === 'Backspace' && input === '' && tags.length > 0)
    {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  const visibleSuggestions = suggestions.filter(tag => !isSelected(tag)).slice(0, MAX_TAG_SUGGESTIONS);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {/* Selected tags, each with a remove button */}
        {tags.map(tag => (
          <span
            key={tag}
            className={clsx(
              'inline-flex items-center px-1 rounded text-[11px] leading-5 font-medium whitespace-nowrap',
              prefixColorPalette.classesFor(tag)
            )}
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="ml-0.5 px-0.5 opacity-70 hover:opacity-100"
              aria-label={`Remove tag ${tag}`}
              title={`Remove #${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[6rem] px-1.5 py-0.5 border rounded-md dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add tag…"
          aria-label="Add tag"
        />
      </div>
      {visibleSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {/* Existing tags not yet selected: click to add */}
          {visibleSuggestions.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => addTag(tag)}
              className="px-1 rounded border border-gray-300 dark:border-gray-600 text-[11px] leading-4 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={`Add #${tag}`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </>
  );
};
