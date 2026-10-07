import { useEffect, useRef, useState } from 'react';
import type {
  Assignment,
  AssignmentDetail,
  AssignmentStats,
  Classroom,
  PageResult,
  Submission,
  SubmissionRow,
} from '@amp/contracts';
import { request, useResource } from './api';
import { AssignmentForm } from './AssignmentForm';

import { Login, AccountPanel, type Session } from './Auth';
import { ClassManager } from './ClassManager';
import { Brand, Owl, WorkspaceIcon } from './Owl';
import {
  WorkProvider,
  hasPageWork,
  useBeforeUnload,
  useWork,
  useWorkDraft,
  useWorkGuard,
} from './WorkProtection';
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
        <button className="primary" onClick={() => setAttempt((v) => v + 1)}>
          Retry connection
        </button>
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
  const [resuming, setResuming] = useState<string | null>(null);
  const teacher = user.role === 'TEACHER';
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<AssignmentDetail | undefined>();
  const [section, setSection] = useState<'assignments' | 'classes' | 'account'>('assignments');
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [detailRequest, setDetailRequest] = useState(0);
  const listPanel = useRef<HTMLElement>(null);
  const detailPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if ((selected || composing) && window.matchMedia('(max-width: 1080px)').matches) {
      detailPanel.current?.scrollIntoView({ block: 'start' });
    }
  }, [selected, composing, detailRequest]);
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
    section === 'assignments' ? `/assignments?${params}` : null,
    token,
    revision,
  );
  const classes = useResource<Classroom[]>('/classes', token, revision);
  const detail = useResource<AssignmentDetail>(
    section === 'assignments' && selected ? `/assignments/${selected}` : null,
    token,
    revision,
  );
  const stats = useResource<AssignmentStats>(
    section === 'assignments' && teacher && selected ? `/assignments/${selected}/stats` : null,
    token,
    revision,
  );
  useEffect(() => {
    if (resuming && detail.data?.id === resuming) {
      if (detail.data.status === 'DRAFT') {
        setEditing(detail.data);
        setComposing(true);
      }
      setResuming(null);
    }
  }, [detail.data, resuming]);
  const unfinished = Object.entries(work.entries).filter(([key]) =>
    /^(assignment:|answers:)/.test(key),
  );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand />
        <span className="eyebrow">WORKSPACE</span>
        <nav aria-label="Workspace navigation">
          {(['assignments', 'classes', 'account'] as const).map((item) => (
            <button
              key={item}
              className={section === item ? 'nav-current' : 'nav-link'}
              aria-current={section === item ? 'page' : undefined}
              disabled={work.busy}
              onClick={() => {
                if (section !== item) void work.navigate(() => setSection(item));
              }}
            >
              <WorkspaceIcon name={item} />
              {item === 'assignments' ? 'Assignments' : item === 'classes' ? 'Classes' : 'Account'}
            </button>
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
        <button
          className="text-button signout"
          disabled={loggingOut || work.busy}
          onClick={() => void logout()}
        >
          Sign out
        </button>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <span>
            Workspace /{' '}
            <b>
              {section === 'assignments'
                ? 'Assignments'
                : section === 'classes'
                  ? 'Classes'
                  : 'Account'}
            </b>
          </span>
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
                  <button
                    key={key}
                    className="secondary"
                    disabled={work.busy}
                    onClick={() =>
                      void work.navigate(() => {
                        setSection('assignments');
                        setDetailRequest((v) => v + 1);
                        if (key === 'assignment:new') {
                          setEditing(undefined);
                          setSelected(null);
                          setComposing(true);
                        } else {
                          const id = key.split(':')[1]!;
                          setSelected(id);
                          setComposing(false);
                          setResuming(key.startsWith('assignment:') ? id : null);
                        }
                      })
                    }
                  >
                    Resume {entry.label}
                  </button>
                  <button
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
                        if (key === `assignment:${editing?.id ?? 'new'}`) setComposing(false);
                      }
                    }}
                  >
                    Discard
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
        {section === 'classes' ? (
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
            <section className="page-heading assignment-heading" hidden={composing}>
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
                  <button
                    className="primary"
                    disabled={work.busy}
                    onClick={() => {
                      setEditing(undefined);
                      setComposing(true);
                      setSelected(null);
                      setDetailRequest((value) => value + 1);
                    }}
                  >
                    + New assignment
                  </button>
                )}
              </div>
              <div className="heading-friend">
                <span className="friend-note">
                  {teacher ? 'Big ideas start here.' : 'One step at a time.'}
                </span>
                <Owl pose={teacher ? 'reading' : 'wave'} />
              </div>
            </section>
            <div className={`workspace-grid ${composing ? 'editor-mode' : ''}`}>
              <section className="panel list-panel" ref={listPanel} hidden={composing}>
                <div className="panel-title">
                  <h2>Assignments</h2>
                  <span className="count">{list.data?.total ?? '—'}</span>
                </div>
                <form
                  className="filters"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearch(searchInput.trim());
                    setPage(1);
                  }}
                >
                  <label>
                    Search title
                    <input
                      type="search"
                      maxLength={120}
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      Filter by class
                      <select
                        value={classFilter}
                        onChange={(e) => {
                          setClassFilter(e.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">All classes</option>
                        {classes.data?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Filter by status
                      <select
                        value={statusFilter}
                        onChange={(e) => {
                          setStatusFilter(e.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">All statuses</option>
                        {teacher && <option value="DRAFT">Draft</option>}
                        <option value="PUBLISHED">Published</option>
                        <option value="CLOSED">Closed</option>
                      </select>
                    </label>
                  </div>
                  <button className="secondary">Search</button>
                </form>
                {list.loading && (
                  <p className="empty" role="status">
                    Loading assignments…
                  </p>
                )}
                {list.error && (
                  <p className="error" role="alert">
                    {list.error}
                    <button className="secondary" onClick={() => setRevision((v) => v + 1)}>
                      Retry loading assignments
                    </button>
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
                  <button
                    className={`assignment-row ${selected === item.id ? 'selected' : ''}`}
                    key={item.id}
                    disabled={work.busy}
                    onClick={() => {
                      setSelected(item.id);
                      setComposing(false);
                      setDetailRequest((value) => value + 1);
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
                  </button>
                ))}
                <div className="pagination">
                  <button
                    disabled={page === 1 || list.loading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ← Previous
                  </button>
                  <span>Page {page}</span>
                  <button
                    disabled={!list.data || page * 8 >= list.data.total || list.loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next →
                  </button>
                </div>
              </section>
              <section
                className={`panel detail-panel ${composing ? 'editor-panel' : ''}`}
                ref={detailPanel}
                aria-label="Assignment details"
              >
                {(selected || composing) && (
                  <button
                    className={`text-button detail-back ${composing ? 'editor-back' : ''}`}
                    disabled={work.busy}
                    onClick={() => {
                      if (composing) setComposing(false);
                      else listPanel.current?.scrollIntoView({ block: 'start' });
                    }}
                  >
                    ↑ Back to assignments
                  </button>
                )}
                {composing ? (
                  classes.data ? (
                    <AssignmentForm
                      key={editing?.id ?? 'new'}
                      initial={editing}
                      token={token}
                      classes={classes.data}
                      onCancel={() => {
                        setComposing(false);
                        setRevision((v) => v + 1);
                      }}
                      onCreateClass={() => setSection('classes')}
                      onCreated={(id) => {
                        setComposing(false);
                        setSelected(id);
                        setPage(1);
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
                    token={token}
                    teacher={teacher}
                    onEdit={() => {
                      setEditing(detail.data!);
                      setComposing(true);
                    }}
                    onDeleted={() => {
                      setSelected(null);
                      setPage(1);
                      setRevision((v) => v + 1);
                    }}
                    onChange={() => setRevision((v) => v + 1)}
                  />
                ) : (
                  <div className="empty detail-empty">
                    <Owl className="detail-owl" />
                    <span className="eyebrow">ONE PLACE TO KEEP TRACK</span>
                    <h2>{detail.loading ? 'Opening assignment…' : 'The details are here.'}</h2>
                    <p role={detail.error ? 'alert' : undefined}>
                      {detail.error || 'Choose an assignment to see its questions and progress.'}
                    </p>
                    {detail.error && (
                      <button className="secondary" onClick={() => setRevision((v) => v + 1)}>
                        Retry opening assignment
                      </button>
                    )}
                  </div>
                )}
              </section>
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

function AssignmentView({
  assignment,
  stats,
  statsError,
  token,
  teacher,
  onChange,
  onEdit,
  onDeleted,
}: {
  assignment: AssignmentDetail;
  stats: AssignmentStats | null;
  statsError: string;
  token: string;
  teacher: boolean;
  onChange: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const work = useWork();
  const [answerDraft, setAnswerDraft, clearAnswers, hasAnswers] = useWorkDraft<{
    answers: Record<string, number>;
    retry: { fingerprint: string; id: string } | null;
  }>(`answers:${assignment.id}`, { answers: {}, retry: null }, assignment.title, {
    validate: (
      value,
    ): value is {
      answers: Record<string, number>;
      retry: { fingerprint: string; id: string } | null;
    } => {
      if (!value || typeof value !== 'object') return false;
      const v = value as typeof answerDraft;
      return (
        !!v.answers &&
        typeof v.answers === 'object' &&
        Object.entries(v.answers).every(([id, choice]) =>
          assignment.questions.some(
            (q) =>
              q.id === id && Number.isInteger(choice) && choice >= 0 && choice < q.options.length,
          ),
        ) &&
        (v.retry === null ||
          (!!v.retry && typeof v.retry.fingerprint === 'string' && typeof v.retry.id === 'string'))
      );
    },
  });
  const answers = answerDraft.answers;
  useEffect(() => {
    if (assignment.submission && hasAnswers) clearAnswers();
  }, [assignment.submission, hasAnswers, clearAnswers]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useWorkGuard(`assignment-action:${assignment.id}`, false, busy);
  const closed = new Date(assignment.dueAt) <= new Date();
  async function act(action: 'publish' | 'submit') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'publish')
        await request(`/assignments/${assignment.id}/publish`, token, { method: 'POST' });
      else {
        const values = assignment.questions.map((q) => ({
          questionId: q.id,
          selectedIndex: answers[q.id],
        }));
        const fingerprint = JSON.stringify(values);
        const retry =
          answerDraft.retry?.fingerprint === fingerprint
            ? answerDraft.retry
            : { fingerprint, id: crypto.randomUUID() };
        setAnswerDraft((old) => ({ ...old, retry }));
        await request<Submission>(`/assignments/${assignment.id}/submissions`, token, {
          method: 'POST',
          body: JSON.stringify({ requestId: retry.id, answers: values }),
        });
      }
      if (action === 'submit') clearAnswers();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteDraft() {
    setBusy(true);
    setError('');
    try {
      await request(`/assignments/${assignment.id}`, token, { method: 'DELETE' });
      work.set(`assignment:${assignment.id}`, null);
      work.set(`answers:${assignment.id}`, null);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <span className="eyebrow">{assignment.className}</span>
      <h2 className="detail-title">{assignment.title}</h2>
      <p className="description">
        {assignment.description || 'Read each question and choose one answer.'}
      </p>
      <div className="due-line">
        Due {dateLabel(assignment.dueAt)} · {assignment.questions.length}{' '}
        {assignment.questions.length === 1 ? 'question' : 'questions'}
      </div>
      {teacher && stats && (
        <div className="stats">
          <div>
            <b>
              {stats.submitted} / {stats.enrolled}
            </b>
            <span>Submitted</span>
          </div>
          <div>
            <b>{stats.averagePercent == null ? '—' : `${stats.averagePercent}%`}</b>
            <span>Average score</span>
          </div>
        </div>
      )}
      {statsError && (
        <p role="alert" className="error">
          {statsError}
        </p>
      )}
      {assignment.submission && (
        <div className="result submission-result" role="status">
          <Owl pose="celebrate" className="result-owl" />
          <div>
            <b>
              Submitted · {assignment.submission.score} / {assignment.submission.maxScore} points
            </b>
            <span>{dateLabel(assignment.submission.submittedAt)}</span>
          </div>
        </div>
      )}
      {assignment.questions.map((q, index) => (
        <fieldset
          className="question"
          key={q.id}
          disabled={teacher || !!assignment.submission || closed || busy}
        >
          <legend>
            <span className="question-number">{index + 1}</span>
            {q.prompt}
            <small>{q.points} pts</small>
          </legend>
          {q.options.map((option, i) => (
            <label className={`option ${teacher && q.correctIndex === i ? 'correct' : ''}`} key={i}>
              <input
                type="radio"
                name={q.id}
                value={i}
                checked={answers[q.id] === i}
                onChange={() =>
                  setAnswerDraft((old) => ({ ...old, answers: { ...old.answers, [q.id]: i } }))
                }
              />
              {option}
              {teacher && q.correctIndex === i && <small>Answer key</small>}
            </label>
          ))}
        </fieldset>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {teacher && assignment.status === 'PUBLISHED' && (
        <SubmissionReport id={assignment.id} token={token} />
      )}
      {teacher && assignment.status === 'DRAFT' && (
        <div className="draft-actions">
          <button className="secondary" disabled={busy} onClick={onEdit}>
            Edit draft
          </button>
          <button
            className="secondary danger"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            Delete draft
          </button>
          {confirmDelete && (
            <div role="alert">
              <p>Delete this draft, its questions and any unsaved edits in this tab?</p>
              <button className="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>
                Keep draft
              </button>
              <button className="primary" disabled={busy} onClick={() => void deleteDraft()}>
                Confirm delete
              </button>
            </div>
          )}
        </div>
      )}
      {teacher && assignment.status === 'DRAFT' && work.entries[`assignment:${assignment.id}`] && (
        <p className="footnote">
          Save or discard your local edits before publishing this assignment.
        </p>
      )}
      {teacher && assignment.status === 'DRAFT' && (
        <button
          className="primary wide"
          disabled={busy || closed || !!work.entries[`assignment:${assignment.id}`]}
          onClick={() => void act('publish')}
        >
          {busy ? 'Publishing…' : 'Publish to class →'}
        </button>
      )}
      {!teacher && !assignment.submission && (
        <>
          <p className="footnote">
            {hasAnswers ? 'Your answers are kept in this tab but have not been submitted. ' : ''}One
            attempt. Review your answers before submitting.
          </p>
          <button
            className="primary wide"
            disabled={
              busy || closed || assignment.questions.some((q) => answers[q.id] === undefined)
            }
            onClick={() => void act('submit')}
          >
            {closed ? 'Deadline passed' : busy ? 'Submitting…' : 'Submit answers →'}
          </button>
        </>
      )}
    </div>
  );
}

function SubmissionReport({ id, token }: { id: string; token: string }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const report = useResource<PageResult<SubmissionRow>>(
    `/assignments/${id}/submissions?page=${page}&pageSize=10`,
    token,
    revision,
  );
  return (
    <section className="submission-report">
      <h3>Student progress</h3>
      {report.loading && <p role="status">Loading progress…</p>}
      {report.error && (
        <p role="alert" className="error">
          {report.error}
          <button className="secondary" onClick={() => setRevision((v) => v + 1)}>
            Retry progress
          </button>
        </p>
      )}
      {report.data && (
        <>
          <p className="footnote">
            Recipients are fixed when published. Removed students remain in the report.
          </p>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Student submission results</caption>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {report.data.items.map((item) => (
                  <tr key={item.studentId}>
                    <td>
                      {item.name}
                      <small>
                        {item.email}
                        {item.removed ? ' · Removed' : ''}
                      </small>
                    </td>
                    <td>
                      {item.submission
                        ? `${item.submission.score} / ${item.submission.maxScore}`
                        : 'Not submitted'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.data.total === 0 && (
            <p>No students were enrolled when this assignment was published.</p>
          )}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
              Previous students
            </button>
            <span>Page {page}</span>
            <button disabled={page * 10 >= report.data.total} onClick={() => setPage((v) => v + 1)}>
              Next students
            </button>
          </div>
        </>
      )}
    </section>
  );
}
