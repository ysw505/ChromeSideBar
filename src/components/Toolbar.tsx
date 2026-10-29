import { Settings, Volume2, ChevronDown, X, Save, Clock, Bookmark, Trash2, RotateCcwSquare, RotateCwSquare, HelpCircle, Search } from 'lucide-react';
import React, { forwardRef, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import clsx from 'clsx';
import { SearchTagOverlay } from './SearchTagOverlay';
import { hashtagOfTerm, isTermBoundary } from '../utils/searchParser';
import { prefixColorPalette, hasLetter } from '../utils/titlePrefix';
import { KnownTags } from '../utils/knownTags';
import * as DropdownMenu from './menu/DropdownMenu';
import { useShowActiveTab } from '../hooks/useFollowActiveTab';
import { useSpacesContext } from '../contexts/SpacesContext';
import { tabHistoryManagerProxy } from '../managers/proxies/tabHistoryManagerProxy';
import { TabHistoryItem } from '../managers/shared/tabHistoryManagerApi';

interface ToolbarProps
{
  filterLiveTabsActive: boolean;
  onFilterLiveTabsToggle: () => void;
  onAudioDialogOpen: () => void;
  // When defined, enables long-press mode: quick click jumps to the latest audio tab, hold opens the list
  onAudioTabJump?: () => void;
  onMenuToggle: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement>;
  audioButtonRef?: React.RefObject<HTMLButtonElement>;
  // Text filter props
  filterText: string;
  onFilterTextChange: (text: string) => void;
  // Enter with search text: open the first visible bookmark for that text; true if one was opened
  onSubmitFilter?: (text: string) => boolean;
  // Arrow keys with search text: move the Enter target highlight (1 = down, -1 = up); true if handled
  onMoveHighlight?: (delta: 1 | -1) => boolean;
  // True while an arrow-key highlight marks the bookmark row Enter opens
  bookmarkRowHighlighted?: boolean;
  // Tags used in bookmark titles, for the "turn this word into #tag" hint
  knownTags?: KnownTags;
  savedFilters: string[];
  recentFilters: string[];
  onSaveFilter: (text: string) => void;
  onDeleteSavedFilter: (text: string) => void;
  onApplyFilter: (text: string) => void;
  onUpdateRecent?: (text: string, existingEntry?: string) => void;
  onShowToast?: (message: string) => void;
  showFilterArea?: boolean;
  onToggleFilterArea?: () => void;
  // When it becomes true, focus the search input once (shown by the parent first if it was hidden)
  autoFocusFilterOnMount?: boolean;
  hasUnreadNews?: boolean;
}


// Custom icon for the "show active tab" button: indented tree rows with a
// gutter arrow pointing at the active child row. Same 24x24 stroke-2 rounded
// style as the lucide icons around it (design notes in docs/features/033).
const TreeGutterIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 5h16" />
    <path d="M11 12h9" />
    <path d="M11 19h9" />
    <path d="M3 12h3" />
    <path d="m4.5 9.5 2.5 2.5-2.5 2.5" />
  </svg>
);

const DEBOUNCE_MS = 300;

// Search words end where the search parser ends a term (isTermBoundary), and a tag must
// contain a letter (hasLetter, same rule as the parser), so "123" never offers a tag

// The word of the search text that the caret is in or touching, with its position
class CaretToken
{
  private constructor(readonly start: number, readonly end: number, readonly text: string)
  {
  }

  // The word around the caret, or undefined when the caret sits between boundaries
  static at(value: string, caret: number | null): CaretToken | undefined
  {
    if (caret === null || caret < 0 || caret > value.length)
    {
      return undefined;
    }
    let start = caret;
    // Walk left to the previous boundary
    while (start > 0 && !isTermBoundary(value[start - 1]))
    {
      start--;
    }
    let end = caret;
    // Walk right to the next boundary
    while (end < value.length && !isTermBoundary(value[end]))
    {
      end++;
    }
    return start < end ? new CaretToken(start, end, value.slice(start, end)) : undefined;
  }

  // Plain word (not already "#tag") that could name a tag
  get couldBeTag(): boolean
  {
    return !this.text.startsWith('#') && hasLetter(this.text);
  }

  // Identity of this word at this position, used to remember an Escape dismissal
  get id(): string
  {
    return `${this.start}:${this.text}`;
  }

  // The search text with this word replaced by "#spelling"; a trailing space is added
  // when the word ends the text so the next term can be typed right away
  replaceWithTag(value: string, spelling: string): { value: string; caret: number }
  {
    const after = value.slice(this.end);
    const inserted = `#${spelling}${after.length === 0 ? ' ' : ''}`;
    return {
      value: value.slice(0, this.start) + inserted + after,
      caret: this.start + inserted.length,
    };
  }
}

// A whole "#tag" term next to the caret, which Backspace/Delete remove in one keystroke
class PillToken
{
  private constructor(readonly start: number, readonly end: number)
  {
  }

  // True when position i is the edge of a search word (text edge or a boundary character)
  private static isEdge(value: string, i: number): boolean
  {
    return i <= 0 || i >= value.length || isTermBoundary(value[i]);
  }

  // The pill whose last character is right before the caret ("#fin|"), if any
  static endingAt(value: string, caret: number): PillToken | undefined
  {
    // A caret inside a word ("#f|in") keeps normal character editing
    if (caret < value.length && !isTermBoundary(value[caret]))
    {
      return undefined;
    }
    let nameStart = caret;
    // Walk left over the tag name to its "#"
    while (nameStart > 0 && value[nameStart - 1] !== '#' && !isTermBoundary(value[nameStart - 1]))
    {
      nameStart--;
    }
    const start = nameStart - 1;
    // Need a "#" that itself starts a word, followed by a non-empty name
    if (start < 0 || value[start] !== '#' || nameStart === caret || !PillToken.isEdge(value, start - 1))
    {
      return undefined;
    }
    return PillToken.ifTag(value, start, caret);
  }

  // The pill that starts right at the caret ("|#fin"), if any
  static startingAt(value: string, caret: number): PillToken | undefined
  {
    // Need a "#" at the caret that starts a word
    if (value[caret] !== '#' || !PillToken.isEdge(value, caret - 1))
    {
      return undefined;
    }
    let end = caret + 1;
    // Walk right over the tag name
    while (end < value.length && value[end] !== '#' && !isTermBoundary(value[end]))
    {
      end++;
    }
    // The name must end at a word boundary, not run into another "#"
    if (end < value.length && !isTermBoundary(value[end]))
    {
      return undefined;
    }
    return PillToken.ifTag(value, caret, end);
  }

  // A pill for [start, end) only when the parser treats that term as a tag
  private static ifTag(value: string, start: number, end: number): PillToken | undefined
  {
    return hashtagOfTerm(value.slice(start, end)) !== undefined ? new PillToken(start, end) : undefined;
  }

  // The search text without this pill, with the caret where the pill began
  removeFrom(value: string): { value: string; caret: number }
  {
    return { value: value.slice(0, this.start) + value.slice(this.end), caret: this.start };
  }
}

export const Toolbar = forwardRef<HTMLButtonElement, ToolbarProps>(({
  filterLiveTabsActive,
  onFilterLiveTabsToggle,
  onAudioDialogOpen,
  onAudioTabJump,
  onMenuToggle,
  menuButtonRef,
  audioButtonRef,
  filterText,
  onFilterTextChange,
  onSubmitFilter,
  onMoveHighlight,
  bookmarkRowHighlighted = false,
  knownTags = KnownTags.EMPTY,
  savedFilters,
  recentFilters,
  onSaveFilter,
  onDeleteSavedFilter,
  onApplyFilter,
  onUpdateRecent,
  onShowToast,
  showFilterArea = false,
  onToggleFilterArea,
  autoFocusFilterOnMount = false,
  hasUnreadNews = false,
}, _ref) =>
{
  const activeButtonClass = 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 active:bg-blue-200 dark:active:bg-blue-800';
  const inactiveButtonClass = 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 dark:active:bg-gray-500';

  // "Show active tab" button: switch to the active tab's space and scroll to it
  const showActiveTab = useShowActiveTab();

  // This sidebar's own window. Every tab-history call names it explicitly, so
  // background never has to guess which window the request came from.
  const { windowId } = useSpacesContext();

  // Tab history navigation shortcuts
  const [prevTabShortcut, setPrevTabShortcut] = useState<string>('');
  const [nextTabShortcut, setNextTabShortcut] = useState<string>('');

  // Tab history dropdown state. The row type is the manager's own
  // TabHistoryItem, so the dropdown and getHistoryDetails share one
  // declaration instead of two copies that can drift.
  const [historyDropdown, setHistoryDropdown] = useState<'prev' | 'next' | null>(null);
  const [historyBefore, setHistoryBefore] = useState<TabHistoryItem[]>([]);
  const [historyAfter, setHistoryAfter] = useState<TabHistoryItem[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  // Long-press state for the audio button (used when onAudioTabJump is provided)
  const audioHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioIsLongPressRef = useRef(false);

  const handleAudioMouseDown = useCallback((e: React.MouseEvent) =>
  {
    if (e.button !== 0 || !onAudioTabJump) return;
    audioIsLongPressRef.current = false;
    audioHoldTimerRef.current = setTimeout(() =>
    {
      audioIsLongPressRef.current = true;
      onAudioDialogOpen();
    }, 400);
  }, [onAudioDialogOpen, onAudioTabJump]);

  const handleAudioMouseUp = useCallback(() =>
  {
    if (!onAudioTabJump) return;
    if (audioHoldTimerRef.current)
    {
      clearTimeout(audioHoldTimerRef.current);
      audioHoldTimerRef.current = null;
    }
    if (!audioIsLongPressRef.current)
    {
      onAudioTabJump();
    }
  }, [onAudioTabJump]);

  const handleAudioMouseLeave = useCallback(() =>
  {
    if (audioHoldTimerRef.current)
    {
      clearTimeout(audioHoldTimerRef.current);
      audioHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() =>
  {
    chrome.commands.getAll((commands) =>
    {
      for (const cmd of commands)
      {
        if (cmd.name === 'prev-used-tab' && cmd.shortcut)
        {
          setPrevTabShortcut(cmd.shortcut);
        }
        else if (cmd.name === 'next-used-tab' && cmd.shortcut)
        {
          setNextTabShortcut(cmd.shortcut);
        }
      }
    });
  }, []);

  // Tab history navigation handlers
  const handlePrevUsedTab = useCallback(() =>
  {
    if (windowId === null) return;
    tabHistoryManagerProxy.navigate(windowId, -1);
  }, [windowId]);

  const handleNextUsedTab = useCallback(() =>
  {
    if (windowId === null) return;
    tabHistoryManagerProxy.navigate(windowId, 1);
  }, [windowId]);

  // Fetch tab history for dropdown
  const fetchTabHistory = useCallback(async () =>
  {
    if (windowId === null) return;
    const details = await tabHistoryManagerProxy.getHistoryDetails(windowId);
    setHistoryBefore(details.before || []);
    setHistoryAfter(details.after || []);
  }, [windowId]);

  // Handle click-and-hold for history dropdown
  const handleHistoryMouseDown = useCallback((direction: 'prev' | 'next') =>
  {
    // If dropdown is already showing, dismiss it and don't start timer
    // (similar to Chrome's back/forward buttons behavior)
    if (historyDropdown !== null)
    {
      setHistoryDropdown(null);
      return;
    }

    // Clear any existing timer
    if (holdTimerRef.current)
    {
      clearTimeout(holdTimerRef.current);
    }

    // Start hold timer (300ms to show dropdown)
    holdTimerRef.current = setTimeout(() =>
    {
      fetchTabHistory();
      setHistoryDropdown(direction);
      holdTimerRef.current = null;
    }, 300);
  }, [fetchTabHistory, historyDropdown]);

  const handleHistoryMouseUp = useCallback((direction: 'prev' | 'next') =>
  {
    // If timer is still running, it was a quick click - navigate
    if (holdTimerRef.current)
    {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (direction === 'prev')
      {
        handlePrevUsedTab();
      }
      else
      {
        handleNextUsedTab();
      }
    }
    // If timer already fired or dropdown was just dismissed - don't navigate
  }, [handlePrevUsedTab, handleNextUsedTab]);

  const handleHistoryMouseLeave = useCallback(() =>
  {
    // Cancel hold timer if mouse leaves before it fires
    if (holdTimerRef.current)
    {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  // Navigate to specific history item
  const handleHistoryItemClick = useCallback((index: number) =>
  {
    if (windowId !== null)
    {
      tabHistoryManagerProxy.navigateToIndex(windowId, index);
    }
    setHistoryDropdown(null);
  }, [windowId]);

  // DropdownMenu handles click-outside and escape key automatically

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inner element of the "#tag" pill overlay; translated to follow the input's horizontal scroll
  const tagOverlayScrollRef = useRef<HTMLDivElement>(null);
  const syncTagOverlayScroll = useCallback(() =>
  {
    const input = inputRef.current;
    const overlay = tagOverlayScrollRef.current;
    if (input && overlay)
    {
      overlay.style.transform = `translateX(${-input.scrollLeft}px)`;
    }
  }, []);

  // Syntax help popover state
  const [showSyntaxHelp, setShowSyntaxHelp] = useState(false);
  const syntaxHelpRef = useRef<HTMLDivElement>(null);
  const syntaxHelpButtonRef = useRef<HTMLButtonElement>(null);

  // Local input value for immediate display (debounced before filtering)
  const [inputValue, setInputValue] = useState(filterText);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track current session's recent entry (for updating instead of adding new)
  const [sessionRecentEntry, setSessionRecentEntry] = useState<string | null>(null);

  // Tag hint: when the word at the caret equals an existing tag, offer to turn it into "#tag"
  const [caretPos, setCaretPos] = useState<number | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  // Word dismissed with Escape; its hint stays hidden until the word changes
  const [dismissedTokenId, setDismissedTokenId] = useState<string | null>(null);
  // Caret position to restore after a tag conversion re-renders the input
  const pendingCaretRef = useRef<number | null>(null);

  const caretToken = CaretToken.at(inputValue, caretPos);
  const tagHintSpelling = caretToken?.couldBeTag ? knownTags.spellingFor(caretToken.text) : undefined;
  const tagHint = inputFocused && caretToken && tagHintSpelling !== undefined && caretToken.id !== dismissedTokenId
    ? { token: caretToken, spelling: tagHintSpelling }
    : undefined;

  // Read the caret from the input after typing, clicking or moving the selection
  const updateCaretPos = useCallback(() =>
  {
    setCaretPos(inputRef.current?.selectionStart ?? null);
  }, []);

  // Place the caret after a tag conversion, once the new text is in the input
  useLayoutEffect(() =>
  {
    const caret = pendingCaretRef.current;
    const input = inputRef.current;
    if (caret !== null && input)
    {
      pendingCaretRef.current = null;
      input.focus();
      input.setSelectionRange(caret, caret);
      setCaretPos(caret);
    }
  }, [inputValue]);

  // Typing at the end can scroll the input without a scroll event, so resync after each value change
  useLayoutEffect(() =>
  {
    syncTagOverlayScroll();
  }, [inputValue, syncTagOverlayScroll]);

  // Sync inputValue when filterText changes externally (e.g., from selecting a filter)
  useEffect(() =>
  {
    setInputValue(filterText);
  }, [filterText]);

  // Debounced filter change
  const handleInputChange = useCallback((value: string) =>
  {
    const oldValue = inputValue.trim();
    const newValue = value.trim();

    // Detect "select all and clear/replace" pattern:
    // If old value had meaningful content (3+ chars) and is being cleared or replaced
    const hadMeaningfulContent = oldValue.length >= 3;
    const isCleared = newValue.length === 0;
    const isReplacement = newValue.length > 0 &&
      newValue.length <= 2 &&
      !oldValue.toLowerCase().startsWith(newValue.toLowerCase());

    // If clearing or replacing meaningful content, save the old search first
    if (hadMeaningfulContent && (isCleared || isReplacement) && onUpdateRecent)
    {
      onUpdateRecent(oldValue, sessionRecentEntry ?? undefined);
      setSessionRecentEntry(null); // Start fresh session
    }

    setInputValue(value);

    // Clear existing timer
    if (debounceTimerRef.current)
    {
      clearTimeout(debounceTimerRef.current);
    }

    // If cleared completely, reset session and apply immediately
    if (newValue === '')
    {
      setSessionRecentEntry(null);
      onFilterTextChange('');
      return;
    }

    // Debounce the actual filter change
    debounceTimerRef.current = setTimeout(() =>
    {
      onFilterTextChange(value);
    }, DEBOUNCE_MS);
  }, [onFilterTextChange, inputValue, sessionRecentEntry, onUpdateRecent]);

  // Cleanup debounce timer on unmount
  useEffect(() =>
  {
    return () =>
    {
      if (debounceTimerRef.current)
      {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Commit current search to recent (on blur or Enter)
  const commitToRecent = useCallback(() =>
  {
    const trimmed = inputValue.trim();
    if (!trimmed || !onUpdateRecent) return;

    // Update existing entry or add new
    onUpdateRecent(trimmed, sessionRecentEntry ?? undefined);
    setSessionRecentEntry(trimmed);
  }, [inputValue, sessionRecentEntry, onUpdateRecent]);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() =>
  {
    const handleClickOutside = (e: MouseEvent) =>
    {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        dropdownButtonRef.current &&
        !dropdownButtonRef.current.contains(e.target as Node)
      )
      {
        setShowDropdown(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) =>
    {
      if (e.key === 'Escape' && showDropdown)
      {
        e.preventDefault();
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () =>
    {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showDropdown]);

  // Close syntax help popover when clicking outside or pressing Escape
  useEffect(() =>
  {
    if (!showSyntaxHelp) return;

    const handleClickOutside = (e: MouseEvent) =>
    {
      if (
        syntaxHelpRef.current &&
        !syntaxHelpRef.current.contains(e.target as Node) &&
        syntaxHelpButtonRef.current &&
        !syntaxHelpButtonRef.current.contains(e.target as Node)
      )
      {
        setShowSyntaxHelp(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) =>
    {
      if (e.key === 'Escape')
      {
        e.preventDefault();
        setShowSyntaxHelp(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () =>
    {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showSyntaxHelp]);

  // Focus the search input and put the cursor at the end. Returns false when the
  // input is not rendered (search bar hidden).
  const focusInputWithCursorAtEnd = useCallback((): boolean =>
  {
    const input = inputRef.current;
    if (!input)
    {
      return false;
    }
    input.focus();
    // Use setSelectionRange for controlled inputs to avoid fighting with React
    const len = input.value.length;
    input.setSelectionRange(len, len);
    return true;
  }, []);

  // Set when the input should be focused as soon as it is rendered
  // (search bar was hidden when the focus request came in)
  const pendingFocusRef = useRef(false);
  // The open-time auto-focus runs at most once per page load
  const didAutoFocusRef = useRef(false);

  // Latest toggle callback, so the command listener below (registered once) never calls a stale one
  const onToggleFilterAreaRef = useRef(onToggleFilterArea);
  onToggleFilterAreaRef.current = onToggleFilterArea;

  // Open-time auto-focus: the parent turns this prop on once after reading the setting
  useEffect(() =>
  {
    if (autoFocusFilterOnMount && !didAutoFocusRef.current)
    {
      didAutoFocusRef.current = true;
      pendingFocusRef.current = true;
    }
  }, [autoFocusFilterOnMount]);

  // Fulfil a pending focus request once the search input is rendered
  useEffect(() =>
  {
    if (showFilterArea && pendingFocusRef.current && inputRef.current)
    {
      pendingFocusRef.current = false;
      focusInputWithCursorAtEnd();
    }
  }, [showFilterArea, autoFocusFilterOnMount, focusInputWithCursorAtEnd]);

  // Listen for Chrome extension commands directly
  useEffect(() =>
  {
    const handleCommand = (command: string) =>
    {
      // Focus the search box; if the search bar is hidden, show it and focus after it renders
      if (command === 'focus-filter-input')
      {
        if (!focusInputWithCursorAtEnd() && onToggleFilterAreaRef.current)
        {
          pendingFocusRef.current = true;
          onToggleFilterAreaRef.current();
        }
      }
    };

    chrome.commands.onCommand.addListener(handleCommand);
    return () => chrome.commands.onCommand.removeListener(handleCommand);
  }, [focusInputWithCursorAtEnd]);

  // Enter with search text: open the first visible bookmark, then clear the search.
  // Uses the input's current text, since the debounced filter may not have caught up yet.
  const submitFilter = useCallback(() =>
  {
    if (!inputValue.trim() || !onSubmitFilter)
    {
      return;
    }

    // Opened a bookmark: clear the search box and the filter
    if (onSubmitFilter(inputValue))
    {
      if (debounceTimerRef.current)
      {
        clearTimeout(debounceTimerRef.current);
      }
      setInputValue('');
      setSessionRecentEntry(null);
      onFilterTextChange('');
    }
  }, [inputValue, onSubmitFilter, onFilterTextChange]);

  // Turn the hinted word into "#tag" and refilter, keeping the caret right after the tag
  const convertHintToTag = useCallback(() =>
  {
    if (!tagHint)
    {
      return;
    }
    const next = tagHint.token.replaceWithTag(inputValue, tagHint.spelling);
    pendingCaretRef.current = next.caret;
    handleInputChange(next.value);
  }, [tagHint, inputValue, handleInputChange]);

  // The tag hint and the recent-searches list share the spot under the input; the hint wins
  const hasTagHint = tagHint !== undefined;
  useEffect(() =>
  {
    if (hasTagHint)
    {
      setShowDropdown(false);
    }
  }, [hasTagHint]);

  // Handle input keydown: arrows move the Enter target (with text) or open the dropdown (empty), Enter commits
  const handleInputKeydown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) =>
  {
    // Enter that confirms an IME composition (e.g. Korean) is not a submit
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229))
    {
      return;
    }

    // Backspace/Delete next to a "#tag" pill remove the whole pill (plain caret, no modifiers, not composing)
    const isPillKey = e.key === 'Backspace' || e.key === 'Delete';
    const input = e.currentTarget;
    if (isPillKey && !e.nativeEvent.isComposing && e.keyCode !== 229
      && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
      && input.selectionStart !== null && input.selectionStart === input.selectionEnd)
    {
      const pill = e.key === 'Backspace'
        ? PillToken.endingAt(inputValue, input.selectionStart)
        : PillToken.startingAt(inputValue, input.selectionStart);
      if (pill)
      {
        e.preventDefault();
        const next = pill.removeFrom(inputValue);
        pendingCaretRef.current = next.caret;
        handleInputChange(next.value);
        return;
      }
    }

    // Tag hint showing: Tab (always) or Enter (unless an arrow-key row highlight is set, then Enter
    // opens that row below) converts the word to "#tag"; Escape hides the hint for this word
    // (Shift+Tab keeps moving focus backwards)
    const convertKey = (e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !bookmarkRowHighlighted);
    if (tagHint && (convertKey || e.key === 'Escape'))
    {
      e.preventDefault();
      e.stopPropagation();
      if (convertKey)
      {
        convertHintToTag();
      }
      else
      {
        setDismissedTokenId(tagHint.token.id);
      }
      return;
    }

    const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    // With search text, arrows pick which bookmark row Enter opens; focus stays in the input
    if (isArrow && inputValue.trim() && onMoveHighlight)
    {
      e.preventDefault();
      // Close the recent-searches list so it doesn't cover the moving highlight
      setShowDropdown(false);
      onMoveHighlight(e.key === 'ArrowDown' ? 1 : -1);
    }
    else if (e.key === 'ArrowDown')
    {
      e.preventDefault();
      setShowDropdown(true);
    }
    else if (e.key === 'Enter')
    {
      e.preventDefault();
      commitToRecent();
      submitFilter();
    }
  }, [commitToRecent, submitFilter, inputValue, onMoveHighlight, tagHint, convertHintToTag, handleInputChange, bookmarkRowHighlighted]);

  // Handle input blur to commit to recent
  const handleInputBlur = useCallback(() =>
  {
    setInputFocused(false);
    commitToRecent();
  }, [commitToRecent]);

  const handleSaveFilter = () =>
  {
    const trimmed = inputValue.trim();
    if (trimmed && !savedFilters.includes(trimmed))
    {
      onSaveFilter(trimmed);
      onShowToast?.(`"${trimmed}" filter saved`);
    }
  };

  const handleSelectFilter = (text: string) =>
  {
    // Commit current search to recent before switching (if any)
    commitToRecent();

    // Apply the selected filter and start a new session
    onApplyFilter(text);
    setSessionRecentEntry(text);
    setShowDropdown(false);
  };

  const handleClearFilter = () =>
  {
    // Clear debounce timer
    if (debounceTimerRef.current)
    {
      clearTimeout(debounceTimerRef.current);
    }
    setInputValue('');
    setSessionRecentEntry(null);
    onFilterTextChange('');
  };

  const canSave = inputValue.trim() && !savedFilters.includes(inputValue.trim());

  return (
    <div className="flex flex-col border-b border-gray-200 dark:border-gray-700">
      {/* Top row - Filter buttons and settings */}
      <div className="flex items-center justify-between px-2 py-1">
        {/* Left side - Tab history and Filter buttons */}
        <div className="flex items-center gap-1">
          {/* Tab history navigation - Previous */}
          <DropdownMenu.Root
            open={historyDropdown === 'prev'}
            onOpenChange={(open) => !open && setHistoryDropdown(null)}
            anchorRef={prevButtonRef}
          >
            <button
              ref={prevButtonRef}
              onMouseDown={() => handleHistoryMouseDown('prev')}
              onMouseUp={() => handleHistoryMouseUp('prev')}
              onMouseLeave={handleHistoryMouseLeave}
              title={`Previous used tab${prevTabShortcut ? ` (${prevTabShortcut})` : ''}\nHold for history`}
              className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${
                historyDropdown === 'prev' ? activeButtonClass : inactiveButtonClass
              }`}
            >
              <RotateCcwSquare size={16} className="-rotate-90" />
            </button>

            <DropdownMenu.Content className="min-w-48 max-w-72 max-h-64 overflow-y-auto">
              {historyBefore.length > 0 ? (
                historyBefore.map((item) => (
                  <DropdownMenu.Item
                    key={item.tabId}
                    onSelect={() => handleHistoryItemClick(item.index)}
                  >
                    {item.favIconUrl ? (
                      <img src={item.favIconUrl} alt="" className="w-4 h-4 flex-shrink-0 mr-2" />
                    ) : (
                      <div className="w-4 h-4 flex-shrink-0 bg-gray-300 dark:bg-gray-600 rounded mr-2" />
                    )}
                    <span className="truncate">{item.title}</span>
                  </DropdownMenu.Item>
                ))
              ) : (
                <div className="px-3 py-2 text-gray-500 dark:text-gray-400">
                  No previous tabs
                </div>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          {/* Tab history navigation - Next */}
          <DropdownMenu.Root
            open={historyDropdown === 'next'}
            onOpenChange={(open) => !open && setHistoryDropdown(null)}
            anchorRef={nextButtonRef}
          >
            <button
              ref={nextButtonRef}
              onMouseDown={() => handleHistoryMouseDown('next')}
              onMouseUp={() => handleHistoryMouseUp('next')}
              onMouseLeave={handleHistoryMouseLeave}
              title={`Next used tab${nextTabShortcut ? ` (${nextTabShortcut})` : ''}\nHold for history`}
              className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${
                historyDropdown === 'next' ? activeButtonClass : inactiveButtonClass
              }`}
            >
              <RotateCwSquare size={16} className="rotate-90" />
            </button>

            <DropdownMenu.Content className="min-w-48 max-w-72 max-h-64 overflow-y-auto">
              {historyAfter.length > 0 ? (
                historyAfter.map((item) => (
                  <DropdownMenu.Item
                    key={item.tabId}
                    onSelect={() => handleHistoryItemClick(item.index)}
                  >
                    {item.favIconUrl ? (
                      <img src={item.favIconUrl} alt="" className="w-4 h-4 flex-shrink-0 mr-2" />
                    ) : (
                      <div className="w-4 h-4 flex-shrink-0 bg-gray-300 dark:bg-gray-600 rounded mr-2" />
                    )}
                    <span className="truncate">{item.title}</span>
                  </DropdownMenu.Item>
                ))
              ) : (
                <div className="px-3 py-2 text-gray-500 dark:text-gray-400">
                  No next tabs
                </div>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          {/* Separator */}
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />

          {/* Audio dialog button */}
          <button
            ref={audioButtonRef}
            onClick={onAudioTabJump ? undefined : onAudioDialogOpen}
            onMouseDown={onAudioTabJump ? handleAudioMouseDown : undefined}
            onMouseUp={onAudioTabJump ? handleAudioMouseUp : undefined}
            onMouseLeave={onAudioTabJump ? handleAudioMouseLeave : undefined}
            title={onAudioTabJump ? 'Click to jump to audio tab · Hold to show list' : 'Show tabs playing audio/video'}
            className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${inactiveButtonClass}`}
          >
            <Volume2 size={16} />
          </button>

          {/* Scroll to active tab button */}
          <button
            onClick={showActiveTab}
            title="Show active tab"
            className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${inactiveButtonClass}`}
          >
            <TreeGutterIcon size={16} />
          </button>

          {/* Separator */}
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />

          {/* Toggle search bar button */}
          {onToggleFilterArea && (
            <button
              onClick={onToggleFilterArea}
              title={showFilterArea ? "Hide search bar" : "Show search bar"}
              className={`p-1.5 rounded transition-all duration-150 focus:outline-none ${
                showFilterArea ? activeButtonClass : inactiveButtonClass
              }`}
            >
              <Search size={16} />
            </button>
          )}

        </div>

        {/* Right side - Settings gear button */}
        <div className="relative">
          <button
            ref={menuButtonRef}
            onClick={onMenuToggle}
            title="Menu"
            className={`p-1.5 rounded transition-all duration-150 ${inactiveButtonClass}`}
          >
            <Settings size={16} />
          </button>
          {/* Red dot badge for unread news */}
          {hasUnreadNews && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-red-500 rounded-full pointer-events-none" />
          )}
        </div>
      </div>

      {/* Bottom row - Text filter (conditionally rendered) */}
      {showFilterArea && (
        <>
        <div className="flex items-center gap-1 px-2 pb-1.5">
          <div className="relative flex-1 flex items-center">
            {/* Visible copy of the input text with "#tag" pills; sits under the (relative, transparent) input so caret and selection draw on top */}
            <SearchTagOverlay ref={tagOverlayScrollRef} value={inputValue} />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) =>
              {
                setCaretPos(e.target.selectionStart);
                handleInputChange(e.target.value);
              }}
              onKeyDown={handleInputKeydown}
              onKeyUp={updateCaretPos}
              onClick={updateCaretPos}
              onSelect={updateCaretPos}
              onFocus={() =>
              {
                setInputFocused(true);
                updateCaretPos();
              }}
              onBlur={handleInputBlur}
              onScroll={syncTagOverlayScroll}
              placeholder="Filter by title or URL..."
              className="relative w-full pl-2 pr-16 py-1 border border-gray-300 dark:border-gray-600 rounded bg-transparent text-transparent caret-gray-900 dark:caret-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />

            {/* Clear button - inside input on right */}
            {inputValue && (
              <button
                onClick={handleClearFilter}
                title="Clear filter"
                className="absolute right-8 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={14} />
              </button>
            )}

            {/* Dropdown button - inside input on right */}
            <button
              ref={dropdownButtonRef}
              onClick={() => setShowDropdown(!showDropdown)}
              title="Saved Filters"
              className="absolute right-1 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <ChevronDown size={16} />
            </button>

            {/* Tag hint: the word at the caret is an existing tag; Enter or click turns it into "#tag" */}
            {tagHint && (
              <div
                className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50"
              >
                <div
                  // mousedown + preventDefault keeps focus in the input (no blur, no recent-commit)
                  onMouseDown={(e) =>
                  {
                    e.preventDefault();
                    convertHintToTag();
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <span className={clsx('rounded px-1 text-xs', prefixColorPalette.classesFor(tagHint.spelling))}>
                    {tagHint.spelling}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Enter or Tab: filter by tag</span>
                </div>
              </div>
            )}

            {/* Dropdown menu (never together with the tag hint) */}
            {showDropdown && !tagHint && (
              <div
                ref={dropdownRef}
                className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 max-h-64 overflow-y-auto"
              >
                {/* Saved Filters Section */}
                {savedFilters.length > 0 && (
                  <>
                    <div className="px-3 py-1 font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <Bookmark size={12} />
                      Saved Filters
                    </div>
                    {savedFilters.map((filter) => (
                      <div
                        key={`saved-${filter}`}
                        className="flex items-center justify-between px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer group"
                      >
                        <span
                          onClick={() => handleSelectFilter(filter)}
                          className="flex-1 text-gray-700 dark:text-gray-200 truncate"
                        >
                          {filter}
                        </span>
                        <button
                          onClick={(e) =>
                          {
                            e.stopPropagation();
                            onDeleteSavedFilter(filter);
                          }}
                          className="p-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete saved filter"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </>
                )}

                {/* Recent Filters Section */}
                {recentFilters.length > 0 && (
                  <>
                    {savedFilters.length > 0 && (
                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                    )}
                    <div className="px-3 py-1 font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <Clock size={12} />
                      Recent
                    </div>
                    {recentFilters.map((filter) => (
                      <div
                        key={`recent-${filter}`}
                        onClick={() => handleSelectFilter(filter)}
                        className="px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                      >
                        <span className="text-gray-700 dark:text-gray-200 truncate block">
                          {filter}
                        </span>
                      </div>
                    ))}
                  </>
                )}

                {/* Empty state */}
                {savedFilters.length === 0 && recentFilters.length === 0 && (
                  <div className="px-3 py-2 text-gray-500 dark:text-gray-400 text-center">
                    No saved or recent filters
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save button */}
          <button
            onClick={handleSaveFilter}
            disabled={!canSave}
            title={canSave ? "Save filter" : inputValue.trim() ? "Already saved" : "Enter filter text first"}
            className={`p-1.5 rounded transition-all duration-150 ${
              canSave
                ? 'text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                : 'text-gray-300 dark:text-gray-600'
            }`}
          >
            <Save size={16} />
          </button>

          {/* Syntax help button */}
          <div className="relative">
            <button
              ref={syntaxHelpButtonRef}
              onClick={() => setShowSyntaxHelp(!showSyntaxHelp)}
              title="Search syntax help"
              className="p-1.5 rounded transition-all duration-150 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <HelpCircle size={16} />
            </button>

            {/* Syntax help popover */}
            {showSyntaxHelp && (
              <div
                ref={syntaxHelpRef}
                className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 px-3 z-50 w-56 text-sm"
              >
                <div className="font-medium text-gray-700 dark:text-gray-200 mb-2">Search Syntax</div>
                <div className="space-y-1 text-gray-600 dark:text-gray-400 text-xs">
                  <div className="flex justify-between"><span>space</span><span className="text-gray-500">implicit AND</span></div>
                  <div className="flex justify-between"><span>&&</span><span className="text-gray-500">AND</span></div>
                  <div className="flex justify-between"><span>||</span><span className="text-gray-500">OR</span></div>
                  <div className="flex justify-between"><span>!</span><span className="text-gray-500">NOT</span></div>
                  <div className="flex justify-between"><span>( )</span><span className="text-gray-500">grouping</span></div>
                  <div className="flex justify-between"><span>"..." '...'</span><span className="text-gray-500">exact phrase</span></div>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2">
                  <div className="text-gray-500 dark:text-gray-500 text-xs mb-1">Examples:</div>
                  <div className="space-y-0.5 text-gray-600 dark:text-gray-400 text-xs">
                    <div>youtube canada</div>
                    <div>youtube || instagram</div>
                    <div>react !tutorial</div>
                    <div>(a || b) && c</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Open tabs only checkbox */}
        <label
          className="flex items-center gap-1.5 px-2 pb-1.5 cursor-pointer select-none"
          title="When checked, only shows bookmarks and pinned sites that are currently open in a tab"
        >
          <input
            type="checkbox"
            checked={filterLiveTabsActive}
            onChange={onFilterLiveTabsToggle}
            className="w-3.5 h-3.5 accent-blue-500"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">With open tabs</span>
        </label>
        </>
      )}
    </div>
  );
});

Toolbar.displayName = 'Toolbar';
