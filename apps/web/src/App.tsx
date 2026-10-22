import { Button, InputField, SelectField } from './Controls';
import { useEffect, useState } from 'react';
import { useLocation, useMatch } from 'react-router-dom';
import { listUrl, readListFilters, useWorkspaceNavigation } from './navigation';
import type { Assignment, AssignmentDetailV2, Classroom, PageResult } from '@amp/contracts';
import { request, useResource } from './api';
import { AssignmentView, type StatsV2 } from './AssignmentView';
import { AssignmentForm } from './AssignmentForm';

import { Login, AccountPanel, type Session } from './Auth';
import { ClassManager } from './ClassManager';
import { Brand, Owl, WorkspaceIcon } from './Owl';
import { WorkProvider, hasPageWork, useBeforeUnload, useWork } from './WorkProtection';
import { useConfirm } from './ConfirmDialog';
const dateLabel = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Keep warning about volatile work while re-authenticating after session expiry.
  useBeforeUnload(!session && hasPageWork());
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request<Session['user']>('/auth/me', undefined, { signal: controller.signal })
      .then((user) => {
        if (!controller.signal.aborted) setSession({ user, token: '' });
      })
      .catch((e) => {
        if (!controller.signal.aborted && e.status !== 401) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const expired = () => {
      setSession(null);
      setNotice('Your session has expired. Please sign in again.');
    };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  if (loading)
    return (
      <main className="empty connection-state" role="status">
        <Owl className="empty-owl" />
        Opening your workspace…
      </main>
    );
  if (error)
    return (
      <main className="empty">
        <p role="alert" className="error">
          {error}
        </p>
        <Button className="primary" onClick={() => setAttempt((v) => v + 1)}>
          Retry connection
        </Button>
      </main>
    );
  return session ? (
    <WorkProvider key={session.user.id} userId={session.user.id}>
      <Workspace
        key={session.user.id}
        session={session}
        onLogout={() => {
          setSession(null);
          setNotice('You have been signed out.');
        }}
      />
    </WorkProvider>
  ) : (
    <Login
      notice={notice}
      onLogin={(value) => {
        setNotice('');
        setSession(value);
      }}
    />
  );
}

function Workspace({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { token, user } = session;
  const work = useWork();
  const confirm = useConfirm();
  const [resumingReview, setResumingReview] = useState<{
    assignmentId: string;
    submissionId: string;
    request: number;
  } | null>(null);
  const teacher = user.role === 'TEACHER';
  const location = useLocation();
  const editMatch = useMatch('/assignments/:id/edit');
  const detailMatch = useMatch('/assignments/:id');
  const isNew = location.pathname === '/assignments/new';
  const isList = location.pathname === '/assignments' || location.pathname === '/';
  const selected = isNew ? null : (editMatch?.params.id ?? detailMatch?.params.id ?? null);
  const composing = isNew || !!editMatch;
  const section =
    location.pathname === '/classes'
      ? 'classes'
      : location.pathname === '/account'
        ? 'account'
        : 'assignments';
  const knownRoute = isList || isNew || !!editMatch || !!detailMatch || section !== 'assignments';
  const filters = readListFilters(location.search);
  const { page, search, classId: classFilter, status: statusFilter } = filters;
  const [revision, setRevision] = useState(0);
  const [searchInput, setSearchInput] = useState(search);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const params = new URLSearchParams({ page: String(page), pageSize: '8' });
  if (classFilter) params.set('classId', classFilter);
  if (statusFilter) params.set('status', statusFilter);
  if (search) params.set('search', search);
  async function logout() {
    if (!(await work.allowSignOut())) return;
    setLoggingOut(true);
    setLogoutError('');
    try {
      await request('/auth/logout', token, { method: 'POST' });
      work.clearAll();
      onLogout();
    } catch (e) {
      setLogoutError((e as Error).message);
    } finally {
      setLoggingOut(false);
    }
  }

  const list = useResource<PageResult<Assignment>>(
    isList ? `/assignments?${params}` : null,
    token,
    revision,
  );
  const classes = useResource<Classroom[]>('/classes', token, revision);
  const detail = useResource<AssignmentDetailV2>(
    section === 'assignments' && selected ? `/assignments/${selected}?schemaVersion=2` : null,
    token,
    revision,
  );
  const stats = useResource<StatsV2>(
    section === 'assignments' && teacher && selected
      ? `/assignments/${selected}/stats?schemaVersion=2`
      : null,
    token,
    revision,
  );
  const { go, listPath, rememberList, rememberedSearch } = useWorkspaceNavigation(
    user.id,
    !!list.data || !!list.error,
  );
  const editing = editMatch ? (detail.data ?? undefined) : undefined;
  useEffect(() => {
    if (isList) setSearchInput(rememberedSearch ?? search);
  }, [isList, location.key, search, rememberedSearch]);
  function changeFilters(change: Partial<typeof filters>) {
    go(listUrl({ ...filters, ...change }));
  }
  function backToList() {
    go(listPath);
  }
  const unfinished = Object.entries(work.entries).filter(([key]) =>
    /^(assignment:|answers:|grading:)/.test(key),
  );
  return (
    <div className={`workspace${composing ? ' workspace-editing' : ''}`}>
      <aside className="sidebar">
        <Brand />
        <span className="eyebrow">WORKSPACE</span>
        <nav aria-label="Workspace navigation">
          {(['assignments', 'classes', 'account'] as const).map((item) => (
            <Button
              key={item}
              className={section === item ? 'nav-current' : 'nav-link'}
              aria-current={section === item ? 'page' : undefined}
              disabled={work.busy}
              onClick={() => {
                const target = item === 'assignments' ? listPath : `/${item}`;
                if (location.pathname + location.search !== target) go(target);
              }}
            >
              <WorkspaceIcon name={item} />
              {item === 'assignments' ? 'Assignments' : item === 'classes' ? 'Classes' : 'Account'}
            </Button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-star" aria-hidden="true">
            ✦
          </span>
          <b>A little wiser, every day.</b>
          <p>
            {teacher ? 'A clear next step for every learner.' : 'Small steps. Lasting progress.'}
          </p>
        </div>
        <div className="profile">
          <span className="avatar">{user.name[0]}</span>
          <div>
            <b>{user.name}</b>
            <small>{teacher ? 'Teacher' : 'Student'}</small>
          </div>
        </div>
        <Button
          className="text-button signout"
          disabled={loggingOut || work.busy}
          onClick={() => void logout()}
        >
          Sign out
        </Button>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            {section === 'assignments' && !isList ? (
              <>
                <Button className="text-button" onClick={backToList}>
                  Assignments
                </Button>
                <span aria-hidden="true">/</span>
                <b aria-current="page">
                  {isNew
                    ? 'New assignment'
                    : composing
                      ? 'Edit assignment'
                      : (detail.data?.title ?? 'Assignment details')}
                </b>
              </>
            ) : (
              <b aria-current="page">
                {section === 'assignments'
                  ? 'Assignments'
                  : section === 'classes'
                    ? 'Classes'
                    : 'Account'}
              </b>
            )}
          </nav>
          <span className="role-tag">{teacher ? 'TEACHER SPACE' : 'STUDENT SPACE'}</span>
        </header>
        {logoutError && (
          <p role="alert" className="error">
            {logoutError}
          </p>
        )}
        {!work.storageAvailable && unfinished.length > 0 && (
          <p className="error" role="status">
            Browser storage is unavailable. Your work is kept while this page stays open. Save
            before refreshing.
          </p>
        )}
        {unfinished.length > 0 && (
          <details className="work-recovery" open={!composing && !selected}>
            <summary>
              Work in progress <span>{unfinished.length}</span>
            </summary>
            <p>
              Kept in this tab until saved or signed out. These changes have not been submitted.
            </p>
            <div>
              {unfinished.map(([key, entry]) => (
                <div className="recovery-item" key={key}>
                  <Button
                    key={key}
                    className="secondary"
                    disabled={work.busy}
                    onClick={() => {
                      const id = key.split(':')[1]!;
                      setResumingReview((previous) =>
                        key.startsWith('grading:')
                          ? {
                              assignmentId: id,
                              submissionId: key.split(':')[2]!,
                              request: (previous?.request ?? 0) + 1,
                            }
                          : null,
                      );
                      go(
                        key === 'assignment:new'
                          ? '/assignments/new'
                          : `/assignments/${id}${key.startsWith('assignment:') ? '/edit' : ''}`,
                      );
                    }}
                  >
                    Resume {entry.label}
                  </Button>
                  <Button
                    className="text-button danger"
                    disabled={work.busy}
                    aria-label={`Discard local copy of ${entry.label}`}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: 'Discard this local copy?',
                          description:
                            'Only unfinished work in this tab will be removed. Saved assignments and submitted answers will stay unchanged.',
                          danger: true,
                        })
                      ) {
                        work.set(key, null);
                        if (composing && key === `assignment:${editing?.id ?? 'new'}`)
                          go(selected ? `/assignments/${selected}` : listPath, { completed: true });
                      }
                    }}
                  >
                    Discard
                  </Button>
                </div>
              ))}
            </div>
          </details>
        )}
        {!knownRoute ? (
          <section className="panel detail-panel">
            <h1>Page not found</h1>
            <p>This page does not exist.</p>
            <Button className="secondary" onClick={backToList}>
              Back to assignments
            </Button>
          </section>
        ) : section === 'classes' ? (
          <ClassManager
            token={token}
            teacher={teacher}
            classes={classes.data ?? []}
            classesLoading={classes.loading}
            classesError={classes.error}
            onChange={() => setRevision((v) => v + 1)}
          />
        ) : section === 'account' ? (
          <AccountPanel onChanged={onLogout} />
        ) : (
          <>
            <section className="page-heading assignment-heading" hidden={!isList}>
              <div className="heading-copy">
                <span className="eyebrow">
                  {teacher ? 'A LITTLE STRUCTURE. ROOM TO GROW.' : 'STAY CURIOUS. KEEP GROWING.'}
                </span>
                <h1>{teacher ? 'Make learning happen.' : 'Your learning, in motion.'}</h1>
                <p className="muted">
                  {teacher
                    ? 'Create assignments and see how your class is doing.'
                    : 'Find your assignments, share your answers, and see your results.'}
                </p>
                {teacher && (
                  <Button
                    className="primary"
                    disabled={work.busy}
                    onClick={() => {
                      rememberList(undefined, searchInput);
                      go('/assignments/new');
                    }}
                  >
                    + New assignment
                  </Button>
                )}
              </div>
              <div className="heading-friend">
                <span className="friend-note">
                  {teacher ? 'Big ideas start here.' : 'One step at a time.'}
                </span>
                <Owl pose={teacher ? 'reading' : 'wave'} />
              </div>
            </section>
            <div className={`assignment-page ${composing ? 'editor-mode' : ''}`}>
              {isList && (
                <section className="panel list-panel assignment-list">
                  <div className="panel-title">
                    <h2>Assignments</h2>
                    <span className="count">{list.data?.total ?? '—'}</span>
                  </div>
                  <form
                    className="filters"
                    onSubmit={(e) => {
                      e.preventDefault();
                      changeFilters({ search: searchInput.trim(), page: 1 });
                    }}
                  >
                    <label>
                      Search title
                      <InputField
                        type="search"
                        maxLength={120}
                        value={searchInput}
                        onChange={(e) => {
                          setSearchInput(e.target.value);
                          rememberList(undefined, e.target.value);
                        }}
                      />
                    </label>
                    <div className="form-row">
                      <label>
                        Filter by class
                        <SelectField
                          value={classFilter}
                          onChange={(selectedValue) => {
                            changeFilters({ classId: selectedValue, page: 1 });
                          }}
                        >
                          <option value="">All classes</option>
                          {classes.data?.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </SelectField>
                      </label>
                      <label>
                        Filter by status
                        <SelectField
                          value={statusFilter}
                          onChange={(selectedValue) => {
                            changeFilters({ status: selectedValue, page: 1 });
                          }}
                        >
                          <option value="">All statuses</option>
                          {teacher && <option value="DRAFT">Draft</option>}
                          <option value="PUBLISHED">Published</option>
                          <option value="CLOSED">Closed</option>
                        </SelectField>
                      </label>
                    </div>
                    <Button className="secondary">Search</Button>
                  </form>
                  {list.loading && (
                    <p className="empty" role="status">
                      Loading assignments…
                    </p>
                  )}
                  {list.error && (
                    <p className="error" role="alert">
                      {list.error}
                      <Button className="secondary" onClick={() => setRevision((v) => v + 1)}>
                        Retry loading assignments
                      </Button>
                    </p>
                  )}
                  {list.data?.items.length === 0 && (
                    <div className="empty">
                      <Owl className="empty-owl" pose={teacher ? 'wave' : 'celebrate'} />
                      <h3>
                        {search || classFilter || statusFilter
                          ? 'No matching assignments.'
                          : teacher
                            ? 'Start with one good question.'
                            : 'You’re all caught up.'}
                      </h3>
                      <p>
                        {search || classFilter || statusFilter
                          ? 'Try another title, class or status.'
                          : teacher
                            ? 'Your first assignment will appear here.'
                            : 'Published assignments from your classes will appear here.'}
                      </p>
                    </div>
                  )}
                  {list.data?.items.map((item) => (
                    <Button
                      className="assignment-row"
                      data-assignment-id={item.id}
                      key={item.id}
                      disabled={work.busy}
                      onClick={() => {
                        rememberList(item.id, searchInput);
                        go(`/assignments/${item.id}`);
                      }}
                    >
                      <div className="row-meta">
                        <span>{item.className}</span>
                        <span
                          className={`status ${item.status === 'DRAFT' ? 'draft' : new Date(item.dueAt) < new Date() ? 'closed' : 'published'}`}
                        >
                          {item.status === 'DRAFT'
                            ? 'Draft'
                            : new Date(item.dueAt) < new Date()
                              ? 'Closed'
                              : 'Published'}
                        </span>
                      </div>
                      <h3>{item.title}</h3>
                      <span className="muted">Due {dateLabel(item.dueAt)}</span>
                      <span className="row-arrow">↗</span>
                    </Button>
                  ))}
                  <div className="pagination">
                    <Button
                      disabled={page === 1 || list.loading}
                      onClick={() => changeFilters({ page: page - 1 })}
                    >
                      ← Previous
                    </Button>
                    <span>Page {page}</span>
                    <Button
                      disabled={!list.data || page * 8 >= list.data.total || list.loading}
                      onClick={() => changeFilters({ page: page + 1 })}
                    >
                      Next →
                    </Button>
                  </div>
                </section>
              )}
              {!isList && (
                <section
                  className={`panel detail-panel ${composing ? 'editor-panel' : ''}`}
                  aria-label="Assignment details"
                >
                  {(selected || composing) && (
                    <Button
                      className={`text-button detail-back ${composing ? 'editor-back' : ''}`}
                      disabled={work.busy}
                      onClick={backToList}
                    >
                      ↑ Back to assignments
                    </Button>
                  )}
                  {composing ? (
                    !teacher ? (
                      <p role="alert">Only teachers can edit assignments.</p>
                    ) : editMatch && !detail.data ? (
                      <p role={detail.error ? 'alert' : 'status'}>
                        {detail.error || 'Opening assignment…'}
                      </p>
                    ) : editing && editing.status !== 'DRAFT' ? (
                      <p role="alert">
                        Published assignments cannot be edited.{' '}
                        <Button
                          className="text-button"
                          onClick={() => go(`/assignments/${selected}`)}
                        >
                          View assignment
                        </Button>
                      </p>
                    ) : classes.data ? (
                      <AssignmentForm
                        key={editing?.id ?? 'new'}
                        initial={editing}
                        token={token}
                        classes={classes.data}
                        onCancel={() => {
                          go(selected ? `/assignments/${selected}` : listPath, {
                            replace: true,
                            completed: true,
                          });
                          setRevision((v) => v + 1);
                        }}
                        onCreateClass={() => go('/classes')}
                        onCreated={(id) => {
                          go(`/assignments/${id}`, { replace: true, completed: true });
                          setRevision((v) => v + 1);
                        }}
                      />
                    ) : (
                      <p role="status">{classes.error || 'Loading classes…'}</p>
                    )
                  ) : detail.data ? (
                    <AssignmentView
                      key={`${detail.data.id}:${revision}`}
                      assignment={detail.data}
                      stats={stats.data}
                      statsError={stats.error}
                      resumeReview={
                        resumingReview?.assignmentId === selected ? resumingReview : null
                      }
                      token={token}
                      teacher={teacher}
                      onEdit={() => {
                        go(`/assignments/${detail.data!.id}/edit`);
                      }}
                      onDeleted={() => {
                        go(listPath, { replace: true, completed: true });
                        setRevision((v) => v + 1);
                      }}
                      onChange={() => {
                        setResumingReview(null);
                        setRevision((v) => v + 1);
                      }}
                    />
                  ) : (
                    <div className="empty detail-empty">
                      <Owl className="detail-owl" />
                      <span className="eyebrow">ONE PLACE TO KEEP TRACK</span>
                      <h2>
                        {detail.loading ? 'Opening assignment…' : 'Unable to open assignment'}
                      </h2>
                      <p role={detail.error ? 'alert' : undefined}>
                        {detail.error ||
                          'This assignment may have been removed or is no longer available.'}
                      </p>
                      {detail.error && (
                        <Button className="secondary" onClick={() => setRevision((v) => v + 1)}>
                          Retry opening assignment
                        </Button>
                      )}
                    </div>
                  )}
                </section>
              )}
            </div>
          </>
        )}
        <footer className="page-footer">
          <span className="footer-brand">
            Classwork <span aria-hidden="true">✦</span>
          </span>
          <span>A little curiosity goes a long way.</span>
        </footer>
      </main>
    </div>
  );
}
