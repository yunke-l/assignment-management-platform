import { useEffect, useLayoutEffect, useRef } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { useWork } from './WorkProtection';

export type ListFilters = { page: number; search: string; classId: string; status: string };
export function readListFilters(search: string): ListFilters {
  const params = new URLSearchParams(search);
  const page = Number(params.get('page') ?? 1);
  return {
    page: Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1,
    search: (params.get('search') ?? '').trim().slice(0, 120),
    classId: params.get('classId') ?? '',
    status: ['DRAFT', 'PUBLISHED', 'CLOSED'].includes(params.get('status') ?? '')
      ? params.get('status')!
      : '',
  };
}
export function listUrl(filters: ListFilters) {
  const params = new URLSearchParams();
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.search) params.set('search', filters.search);
  if (filters.classId) params.set('classId', filters.classId);
  if (filters.status) params.set('status', filters.status);
  return `/assignments${params.size ? `?${params}` : ''}`;
}

type Position = { y: number; focusId?: string; searchInput?: string };
type Memory = { list: string; positions: Record<string, Position> };
const memories = new Map<string, Memory>();
function loadMemory(userId: string): Memory {
  if (memories.has(userId)) return memories.get(userId)!;
  const memory: Memory = { list: '/assignments', positions: {} };
  try {
    const stored = JSON.parse(sessionStorage.getItem(`classwork:navigation:${userId}`) ?? 'null');
    if (stored && typeof stored.list === 'string' && /^\/assignments(?:\?|$)/.test(stored.list)) {
      memory.list = listUrl(readListFilters(stored.list.split('?')[1] ?? ''));
      if (stored.positions && typeof stored.positions === 'object') {
        for (const [key, value] of Object.entries(stored.positions).slice(-20)) {
          const position = value as Position | null;
          if (
            key.startsWith('/assignments') &&
            position &&
            Number.isFinite(position.y) &&
            position.y >= 0
          )
            memory.positions[key] = {
              y: position.y,
              focusId: typeof position.focusId === 'string' ? position.focusId : undefined,
              searchInput:
                typeof position.searchInput === 'string'
                  ? position.searchInput.slice(0, 120)
                  : undefined,
            };
        }
      }
    }
  } catch {
    /* Navigation still works with in-memory state when storage is unavailable. */
  }
  memories.set(userId, memory);
  return memory;
}

export function useWorkspaceNavigation(userId: string, listReady: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const work = useWork();
  const memory = useRef(loadMemory(userId)).current;
  const bypass = useRef(false);
  const checking = useRef(false);
  const isList = location.pathname === '/assignments';
  const url = location.pathname + location.search;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      work.navigationProtected &&
      !bypass.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked' || checking.current) return;
    checking.current = true;
    void work
      .navigate(blocker.proceed)
      .then((proceeded) => {
        if (!proceeded) blocker.reset();
      })
      .finally(() => {
        checking.current = false;
      });
  }, [blocker, work]);
  useLayoutEffect(() => {
    bypass.current = false;
  }, [location.key]);
  useEffect(() => {
    if (location.pathname === '/') void navigate('/assignments', { replace: true });
  }, [location.pathname, navigate]);
  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.key]);
  useLayoutEffect(() => {
    if (!isList || !listReady) return;
    const position = memory.positions[url];
    const frame = requestAnimationFrame(() => {
      if (position?.focusId)
        document
          .querySelector<HTMLElement>(`[data-assignment-id="${CSS.escape(position.focusId)}"]`)
          ?.focus({ preventScroll: true });
      window.scrollTo(0, position?.y ?? 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [isList, listReady, url, location.key, memory]);
  useEffect(() => {
    if (!isList || !listReady) return;
    memory.list = url;
    const persist = () => {
      try {
        sessionStorage.setItem(`classwork:navigation:${userId}`, JSON.stringify(memory));
      } catch {
        /* Optional navigation state must not block work. */
      }
    };
    const record = () => {
      memory.positions[url] = { ...memory.positions[url], y: window.scrollY };
      persist();
    };
    persist();
    window.addEventListener('scroll', record, { passive: true });
    window.addEventListener('pagehide', record);
    return () => {
      window.removeEventListener('scroll', record);
      window.removeEventListener('pagehide', record);
    };
  }, [isList, listReady, url, memory, userId]);

  return {
    location,
    listPath: isList ? url : memory.list,
    rememberedSearch: memory.positions[url]?.searchInput,
    go: (to: string, options?: { replace?: boolean; completed?: boolean }) => {
      if (options?.completed) bypass.current = true;
      // Commit the URL and controls together so consecutive filter changes use current values.
      void navigate(to, { replace: options?.replace, flushSync: true });
    },
    rememberList: (focusId?: string, searchInput?: string) => {
      if (!isList) return;
      memory.list = url;
      memory.positions[url] = { y: window.scrollY, focusId, searchInput };
      // Keep navigation storage bounded as filters change during a long session.
      const keys = Object.keys(memory.positions);
      if (keys.length > 20) delete memory.positions[keys[0]!];
      try {
        sessionStorage.setItem(`classwork:navigation:${userId}`, JSON.stringify(memory));
      } catch {
        /* The in-memory copy is sufficient for navigation. */
      }
    },
  };
}
