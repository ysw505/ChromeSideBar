import React, { forwardRef } from 'react';
import clsx from 'clsx';
import { hashtagOfTerm } from '../utils/searchParser';
import { prefixColorPalette } from '../utils/titlePrefix';

// A "#word" token bounded by start/whitespace/"("/"!" on the left and end/whitespace/")" on the right.
// Visual only: filtering is decided by searchParser, never by this regex.
const TAG_TOKEN = /(^|[\s(!])(#[^\s#()]+)(?=$|[\s)])/g;

// One run of the search text: plain characters, or a token that names a tag
interface SearchTextPiece
{
  text: string;
  tag?: string;
}

// Splits the search text into plain runs and tag tokens, keeping every character in order
class SearchTextPieces
{
  readonly pieces: SearchTextPiece[] = [];

  constructor(value: string)
  {
    let plainStart = 0;
    // Walk each "#word" candidate; only those the parser treats as tags become pills
    for (const match of value.matchAll(TAG_TOKEN))
    {
      const token = match[2];
      const tag = hashtagOfTerm(token);
      if (tag === undefined)
      {
        continue;
      }
      const tokenStart = (match.index ?? 0) + match[1].length;
      this.addPlain(value.slice(plainStart, tokenStart));
      this.pieces.push({ text: token, tag });
      plainStart = tokenStart + token.length;
    }
    this.addPlain(value.slice(plainStart));
  }

  private addPlain(text: string): void
  {
    if (text)
    {
      this.pieces.push({ text });
    }
  }
}

interface SearchTagOverlayProps
{
  value: string;
}

// Mirror of the search input's text, drawn under the transparent input (it also paints the input's background), with "#tag" tokens shown as pills.
// Every class that affects horizontal metrics matches the input (pl-2 pr-16 py-1, 1px border, inherited font),
// so the real input's caret and selection line up with this text. The forwarded ref is the inner
// element the caller translates to follow the input's horizontal scroll.
export const SearchTagOverlay = forwardRef<HTMLDivElement, SearchTagOverlayProps>(({ value }, scrollRef) =>
{
  const { pieces } = new SearchTextPieces(value);

  return (
    <div
      aria-hidden
      className="absolute inset-0 pl-2 pr-16 py-1 border border-transparent rounded pointer-events-none select-none overflow-hidden bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
    >
      {/* Clip box = input content box, so text never paints under the right-side buttons */}
      <div className="overflow-hidden whitespace-pre">
        <div ref={scrollRef} className="whitespace-pre will-change-transform">
          {pieces.map((piece, i) =>
            piece.tag === undefined ? (
              <React.Fragment key={i}>{piece.text}</React.Fragment>
            ) : (
              // "#" stays (transparent) so widths match; pr/-mr cancel out in layout
              <span key={i} className={clsx('rounded pr-0.5 -mr-0.5', prefixColorPalette.classesFor(piece.tag))}>
                <span className="text-transparent">#</span>{piece.text.slice(1)}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
});

SearchTagOverlay.displayName = 'SearchTagOverlay';
