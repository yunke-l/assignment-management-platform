import { useState, type FormEvent } from 'react';
import { Owl } from './Owl';
import type { Classroom, ClassMember, Invitation, PageResult } from '@amp/contracts';
import { request, useResource } from './api';
export function ClassManager({
  token,
  teacher,
  classes,
  classesLoading,
  classesError,
  onChange,
}: {
  token: string;
  teacher: boolean;
  classes: Classroom[];
  classesLoading: boolean;
  classesError: string;
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [invitation, setInvitation] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<Classroom>(teacher ? '/classes' : '/classes/join', token, {
        method: 'POST',
        body: JSON.stringify(teacher ? { name } : { invitation: invitation.trim() }),
      });
      setName('');
      setInvitation('');
      setSelected(result.id);
      setNotice(
        teacher
          ? 'Class created.'
          : `Joined ${result.name}. New assignments will appear after your teacher publishes them.`,
      );
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">LEARN TOGETHER</span>
          <h1>Your classes</h1>
          <p className="muted">
            {teacher
              ? 'Create a class, invite students and manage enrollment.'
              : 'Join a class using the code from your teacher.'}
          </p>
        </div>
        <Owl pose="wave" className="heading-owl" />
      </section>
      <div className="workspace-grid">
        <section className="panel detail-panel">
          <h2>{teacher ? 'Create a class' : 'Join a class'}</h2>
          <form onSubmit={submit}>
            <fieldset className="form-fields" disabled={busy}>
              {teacher ? (
                <label>
                  Class name
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              ) : (
                <label>
                  Invitation code
                  <input
                    required
                    value={invitation}
                    onChange={(e) => setInvitation(e.target.value)}
                  />
                </label>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="primary">
                {busy ? 'Saving…' : teacher ? 'Create class' : 'Join class'}
              </button>
            </fieldset>
          </form>
          {notice && (
            <p role="status" className="result">
              {notice}
            </p>
          )}
          <h3 className="section-title">
            {teacher ? 'Your teaching classes' : 'Enrolled classes'}
          </h3>
          {classesLoading && <p role="status">Loading classes…</p>}
          {classesError && (
            <p role="alert" className="error">
              {classesError}
              <button className="secondary" onClick={onChange}>
                Retry classes
              </button>
            </p>
          )}
          {!classesLoading && !classesError && !classes.length && <p>No classes yet.</p>}
          {classes.map((c) =>
            teacher ? (
              <button
                key={c.id}
                className={`assignment-row ${selected === c.id ? 'selected' : ''}`}
                onClick={() => setSelected(c.id)}
              >
                {c.name}
              </button>
            ) : (
              <p key={c.id}>{c.name}</p>
            ),
          )}
        </section>
        {teacher && (
          <section className="panel detail-panel">
            {selected ? (
              <ClassDetails
                key={selected}
                id={selected}
                name={classes.find((c) => c.id === selected)?.name ?? 'Class'}
                token={token}
                onChange={onChange}
              />
            ) : (
              <div className="empty class-empty">
                <Owl className="detail-owl" />
                <h2>A place to learn together.</h2>
                <p>Choose a class to invite students and review its members.</p>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
function ClassDetails({
  id,
  name,
  token,
  onChange,
}: {
  id: string;
  name: string;
  token: string;
  onChange: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [hours, setHours] = useState(48);
  const [maxUses, setMaxUses] = useState(1);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ClassMember | null>(null);
  const members = useResource<PageResult<ClassMember>>(
    `/classes/${id}/members?page=${page}&pageSize=10`,
    token,
    revision,
  );
  const invites = useResource<Invitation[]>(`/classes/${id}/invitations`, token, revision);
  async function act(path: string, method: string, body?: object) {
    setBusy(true);
    setError('');
    try {
      const result = await request<Invitation & { token?: string }>(path, token, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (result.token) setCode(result.token);
      else setCode('');
      setRemoving(null);
      setPage(1);
      setRevision((v) => v + 1);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>{name}</h2>
      <p className="footnote">
        New members receive future assignments. Removing a student stops their access to all
        assignments in this class, including if they rejoin later. Previous scores stay in your
        reports.
      </p>
      <h3>Invite students</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(`/classes/${id}/invitations`, 'POST', { expiresInHours: hours, maxUses });
        }}
      >
        <fieldset className="form-fields" disabled={busy}>
          <div className="form-row">
            <label>
              Expires in hours
              <input
                required
                type="number"
                min={1}
                max={168}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            <label>
              Maximum uses
              <input
                required
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value))}
              />
            </label>
          </div>
          <button className="secondary">Generate invitation</button>
        </fieldset>
      </form>
      {code && (
        <label>
          New invitation code
          <textarea readOnly value={code} onFocus={(e) => e.target.select()} />
          <span className="footnote">Copy and share privately. This code is shown only once.</span>
        </label>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {invites.loading && <p role="status">Loading invitations…</p>}
      {invites.error && (
        <p role="alert" className="error">
          {invites.error}
          <button onClick={() => setRevision((v) => v + 1)}>Retry invitations</button>
        </p>
      )}
      {invites.data?.map((invite, index) => (
        <div className="invite-row" key={invite.id}>
          <span>
            Invitation {index + 1} · {invite.uses}/{invite.maxUses} used
            <small>Expires {new Date(invite.expiresAt).toLocaleString()}</small>
          </span>
          <button
            className="text-button danger"
            disabled={busy}
            onClick={() => void act(`/classes/${id}/invitations/${invite.id}`, 'DELETE')}
          >
            Revoke invitation {index + 1}
          </button>
        </div>
      ))}
      <h3 className="section-title">Members {members.data ? `(${members.data.total})` : ''}</h3>
      {members.loading && <p role="status">Loading members…</p>}
      {members.error && (
        <p role="alert" className="error">
          {members.error}
          <button onClick={() => setRevision((v) => v + 1)}>Retry members</button>
        </p>
      )}
      {members.data?.total === 0 && <p>No students have joined yet.</p>}
      {members.data?.items.map((member) => (
        <div className="invite-row" key={member.id}>
          <span>
            {member.name}
            <small>{member.email}</small>
          </span>
          <button
            className="text-button danger"
            disabled={busy}
            onClick={() => setRemoving(member)}
          >
            Remove {member.name}
          </button>
        </div>
      ))}
      {removing && (
        <div role="alert" className="result">
          <p>
            Remove {removing.name}? Their assignment access will end immediately. Existing scores
            will be kept.
          </p>
          <div className="draft-actions">
            <button className="secondary" disabled={busy} onClick={() => setRemoving(null)}>
              Cancel removal
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void act(`/classes/${id}/members/${removing.id}`, 'DELETE')}
            >
              Confirm removal
            </button>
          </div>
        </div>
      )}
      {members.data && (
        <div className="pagination">
          <button disabled={page === 1 || busy} onClick={() => setPage((v) => v - 1)}>
            Previous members
          </button>
          <span>Page {page}</span>
          <button
            disabled={page * 10 >= members.data.total || busy}
            onClick={() => setPage((v) => v + 1)}
          >
            Next members
          </button>
        </div>
      )}
    </>
  );
}
