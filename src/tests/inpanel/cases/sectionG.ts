// Section G - Opening a bookmark reuses an already-open tab.
// docs/test/tab-space-association-test-cases.md#section-g---opening-an-item-reuses-a-same-url-tab

import { TestCase } from '../types';
import { createTestBookmark, createTestSpace, TEST_SPACE_WORK_NAME, testUrl } from '../fixtures';
import { openBookmarkTab, openNewTabNative, setFollowActiveTabMode, switchSpaceVerified } from '../actions';
import { assertBookmarkLoaded, assertSameTab, assertTabActive, assertTabCountWithUrl, assertTabExists } from '../assertions';

// G.1 - the bookmark's page is already open in a tab with no association
// (opened natively, as from the omnibox or a link). Opening the bookmark
// should adopt that tab rather than create a duplicate.
export const G1_BOOKMARK_ADOPTS_SAME_URL_TAB: TestCase = {
  id: 'G.1',
  title: 'Opening a bookmark adopts an unassociated tab with the same URL',
  setup: async (getCtx) =>
  {
    await createTestSpace(getCtx, { ref: 'spaceA', name: TEST_SPACE_WORK_NAME });
    await createTestBookmark(getCtx(), 'spaceA', 'G1 bookmark', testUrl('g1-bookmark'), 'bm');
  },
  steps: [
    setFollowActiveTabMode('off'),
    ...switchSpaceVerified('spaceA'),
    openNewTabNative({ url: testUrl('g1-bookmark'), tabRef: 'nativeTab' }),
    assertBookmarkLoaded('bm', false),

    // The actual step under test.
    openBookmarkTab({ bookmarkRef: 'bm', url: testUrl('g1-bookmark'), spaceRef: 'spaceA', tabRef: 'bmTab' }),
    assertSameTab('bmTab', 'nativeTab'),
    assertBookmarkLoaded('bm', true),
    assertTabActive('bmTab'),
    assertTabExists('nativeTab', true),
    assertTabCountWithUrl(testUrl('g1-bookmark'), 1),
  ],
};

export const SECTION_G_CASES: TestCase[] = [
  G1_BOOKMARK_ADOPTS_SAME_URL_TAB,
];
