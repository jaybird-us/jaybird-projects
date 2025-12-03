// React 19 compatibility shim - useSyncExternalStoreWithSelector
import { useSyncExternalStore } from 'react'

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  _isEqual?: (a: Selection, b: Selection) => boolean
): Selection {
  const selectedSnapshot = useSyncExternalStore(
    subscribe,
    () => selector(getSnapshot()),
    getServerSnapshot ? () => selector(getServerSnapshot()) : undefined
  )
  return selectedSnapshot
}
