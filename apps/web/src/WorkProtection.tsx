import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useConfirm } from './ConfirmDialog';

type Entry = { value: unknown; label: string; persist: boolean };
type Entries = Record<string, Entry>;
// Survives a session-expiry screen in this page, never a browser refresh.
const pageWork = new Map<string, Entries>();
const unavailableStorage = new Set<string>();
export function hasPageWork() {
  return [...pageWork.values()].some((entries) => Object.keys(entries).length > 0);
}
type Guard = { dirty: boolean; busy: boolean };
type WorkContextValue = {
  entries: Entries;
  storageAvailable: boolean;
  busy: boolean;
  set: (key: string, entry: Entry | null) => void;
  clearAll: () => void;
  guard: (key: string, value: Guard | null) => void;
  navigate: (action: () => void) => Promise<void>;
  allowSignOut: (changingPassword?: boolean) => Promise<boolean>;
};
const WorkContext = createContext<WorkContextValue | null>(null);
export function useWork() {
  const value = useContext(WorkContext);
  if (!value) throw new Error('Work protection requires a workspace.');
  return value;
}
export function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
}
export function WorkProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const storageKey = `classwork:work:v1:${userId}`;
  const [storageAvailable, setStorageAvailable] = useState(!unavailableStorage.has(userId));
  const [entries, setEntries] = useState<Entries>(() => {
    const memory = pageWork.get(userId);
    if (memory) return memory;
    try {
      const data: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
      return Object.fromEntries(
        Object.entries(data).filter(
          ([key, entry]) =>
            /^(assignment:|answers:)/.test(key) &&
            entry &&
            typeof entry === 'object' &&
            entry.persist === true &&
            typeof entry.label === 'string' &&
            'value' in entry,
        ),
      );
    } catch {
      return {};
    }
  });
  const current = useRef(entries);
  const [guards, setGuards] = useState<Record<string, Guard>>({});
  const confirm = useConfirm();
  const busy = Object.values(guards).some((item) => item.busy);
  const sensitive = Object.values(guards).some((item) => item.dirty);
  useBeforeUnload(!!Object.keys(entries).length || sensitive || busy);
  const set = useCallback(
    (key: string, entry: Entry | null) => {
      const next = { ...current.current };
      if (entry) next[key] = entry;
      else delete next[key];
      current.current = next;
      pageWork.set(userId, next);
      setEntries(next);
      try {
        const stored = Object.fromEntries(Object.entries(next).filter(([, item]) => item.persist));
        if (Object.keys(stored).length) sessionStorage.setItem(storageKey, JSON.stringify(stored));
        else sessionStorage.removeItem(storageKey);
        unavailableStorage.delete(userId);
        setStorageAvailable(true);
      } catch {
        unavailableStorage.add(userId);
        setStorageAvailable(false);
      }
    },
    [storageKey, userId],
  );
  const clearAll = useCallback(() => {
    current.current = {};
    pageWork.delete(userId);
    setEntries({});
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* No persistent storage available. */
    }
  }, [storageKey, userId]);
  const guard = useCallback((key: string, value: Guard | null) => {
    setGuards((old) => {
      const next = { ...old };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }, []);
  return (
    <WorkContext.Provider
      value={{
        entries,
        set,
        clearAll,
        guard,
        storageAvailable,
        busy,
        navigate: async (action) => {
          if (busy) return;
          if (
            !sensitive ||
            (await confirm({
              title: 'Leave these password changes?',
              description:
                'Your password fields will be cleared. Other work in progress will stay in this tab.',
              confirmLabel: 'Leave page',
              danger: true,
            }))
          )
            action();
        },
        allowSignOut: async (changingPassword = false) =>
          !busy &&
          ((!Object.keys(current.current).length && (!sensitive || changingPassword)) ||
            (await confirm({
              title: changingPassword
                ? 'Change password and clear unfinished work?'
                : 'Sign out and clear unfinished work?',
              description:
                (changingPassword ? 'Changing your password signs you out. ' : '') +
                'Unsaved assignments, answers, class inputs and invitation codes in this tab will be cleared. Saved assignments will not be affected.',
              confirmLabel: changingPassword ? 'Change password' : 'Clear and sign out',
              danger: true,
            }))),
      }}
    >
      {children}
    </WorkContext.Provider>
  );
}
export function useWorkGuard(key: string, dirty: boolean, busy = false) {
  const { guard } = useWork();
  useEffect(() => {
    guard(key, { dirty, busy });
    return () => guard(key, null);
  }, [guard, key, dirty, busy]);
}
export function useWorkDraft<T>(
  key: string,
  initial: T,
  label: string,
  options: { persist?: boolean; validate?: (value: unknown) => value is T } = {},
) {
  const { entries, set } = useWork();
  const baseline = useRef(initial);
  const entry = entries[key];
  const usable = entry && (!options.validate || options.validate(entry.value));
  const value = usable ? (entry.value as T) : baseline.current;
  const update: Dispatch<SetStateAction<T>> = (action) => {
    const next = typeof action === 'function' ? (action as (old: T) => T)(value) : action;
    set(
      key,
      JSON.stringify(next) === JSON.stringify(baseline.current)
        ? null
        : { value: next, label, persist: options.persist ?? true },
    );
  };
  const clear = useCallback(() => set(key, null), [key, set]);
  return [value, update, clear, !!usable] as const;
}
