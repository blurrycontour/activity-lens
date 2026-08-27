import { useCallback, useEffect, useState } from 'react'
import type { WorkoutShares } from './api'

/**
 * Whether a thing has an audience, kept current while its share dialog is open.
 *
 * Sharing is what brings the Social tab into existence, so a page that learns
 * about it only on its next full read shows a tab that appears — or vanishes on
 * unshare — some time after the act that caused it. From the inside that reads
 * as the share not having taken.
 *
 * The dialog already reports the new state through `onChange`; this is the
 * other half. `shared` is a rule over the two fields it hands back rather than
 * a fact only the server holds — handleGetWorkout computes exactly this — so
 * there is nothing to refetch.
 *
 * The local answer wins once there is one, because it came from a mutation that
 * has already been to the server and back, and is therefore newer than whatever
 * the page was loaded with. It is dropped when the subject changes, so the same
 * component reused for a different plan does not inherit the last one's state.
 *
 * The workout page does the same thing by hand, through setW: it holds a whole
 * workout that it must keep internally consistent, where these two hold a prop
 * they do not own.
 */
export function useShareState(subjectId: string, fromServer: boolean): [boolean, (s: WorkoutShares) => void] {
  const [local, setLocal] = useState<boolean | null>(null)
  useEffect(() => { setLocal(null) }, [subjectId])
  const onChange = useCallback((s: WorkoutShares) => {
    setLocal(s.visibility === 'public' || s.sharedWith.length > 0)
  }, [])
  return [local ?? fromServer, onChange]
}
