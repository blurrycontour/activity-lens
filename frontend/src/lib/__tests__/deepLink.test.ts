import { describe, it, expect } from 'vitest'
import { readDeepLink, commentLink } from '../deepLink'

describe('readDeepLink', () => {
  it('reads the tab and the comment a social notification names', () => {
    expect(readDeepLink('/workouts/w_1?tab=social#comment=c_9'))
      .toEqual({ tab: 'social', commentId: 'c_9' })
  })

  // The comment may have been deleted before the notification was opened, in
  // which case the tab is still the right place to land.
  it('reads a tab with no comment', () => {
    expect(readDeepLink('/workouts/w_1?tab=gallery')).toEqual({ tab: 'gallery', commentId: null })
  })

  // A comment only ever lives on Social, so naming one names the tab.
  it('defaults the tab to social when only a comment is named', () => {
    expect(readDeepLink('/workouts/w_1#comment=c_9')).toEqual({ tab: 'social', commentId: 'c_9' })
  })

  it('reports nothing for an ordinary page visit', () => {
    expect(readDeepLink('/workouts/w_1')).toEqual({ tab: null, commentId: null })
  })

  // Fragments the app did not write must not be mistaken for a comment id.
  it('ignores a fragment that names something else', () => {
    expect(readDeepLink('/workouts/w_1#top')).toEqual({ tab: null, commentId: null })
  })

  it('survives a malformed href rather than throwing on it', () => {
    expect(readDeepLink('http://[')).toEqual({ tab: null, commentId: null })
  })
})

describe('commentLink', () => {
  it('round-trips through readDeepLink', () => {
    expect(readDeepLink(commentLink('w_1', 'c_9'))).toEqual({ tab: 'social', commentId: 'c_9' })
  })
})
