import { FormFieldset, InputField, Button, TextAreaField } from './Controls';
import { useState, type FormEvent } from 'react';
import { Owl } from './Owl';
import type { Classroom, ClassMember, Invitation, PageResult } from '@amp/contracts';
import { request, useResource } from './api';
import { useWork, useWorkDraft, useWorkGuard } from './WorkProtection';
import { useConfirm } from './ConfirmDialog';
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
  const [input, setInput, clearInput] = useWorkDraft(
    'class-input',
    { name: '', invitation: '' },
    'Class input',
    { persist: false },
  );
  const { name, invitation } = input;
  const work = useWork();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useWorkGuard('class-input', false, busy);
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
      clearInput();
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
            <FormFieldset className="form-fields" disabled={busy}>
              {teacher ? (
                <label>
                  Class name
                  <InputField
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setInput((old) => ({ ...old, name: e.target.value }))}
                  />
                </label>
              ) : (
                <label>
                  Invitation code
                  <InputField
                    required
                    value={invitation}
                    onChange={(e) => setInput((old) => ({ ...old, invitation: e.target.value }))}
                  />
                </label>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <Button className="primary">
                {busy ? 'Saving…' : teacher ? 'Create class' : 'Join class'}
              </Button>
            </FormFieldset>
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
              <Button className="secondary" onClick={onChange}>
                Retry classes
              </Button>
            </p>
          )}
          {!classesLoading && !classesError && !classes.length && <p>No classes yet.</p>}
          {classes.map((c) =>
            teacher ? (
              <Button
                key={c.id}
                className={`assignment-row ${selected === c.id ? 'selected' : ''}`}
                disabled={work.busy}
                onClick={() => setSelected(c.id)}
              >
                {c.name}
              </Button>
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
  const [draft, setDraft] = useWorkDraft(
    `invite:${id}`,
    { hours: 48, maxUses: 1, code: '', invitationId: '' },
    `Invitation for ${name}`,
    { persist: false },
  );
  const { hours, maxUses, code } = draft;
  const [copyNotice, setCopyNotice] = useState('');
  const confirm = useConfirm();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ClassMember | null>(null);
  useWorkGuard(`class-action:${id}`, false, busy);
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
      if (result.token) {
        setDraft((old) => ({ ...old, code: result.token!, invitationId: result.id }));
        setCopyNotice('');
      } else if (method === 'DELETE' && path.endsWith(`/invitations/${draft.invitationId}`))
        setDraft((old) => ({ ...old, code: '', invitationId: '' }));
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
  async function generate() {
    if (busy) return;
    if (
      code &&
      !(await confirm({
        title: 'Generate another invitation?',
        description:
          'Copy the current code first. A new code will replace this display; the previous invitation will stay active until it expires or is revoked.',
        confirmLabel: 'Generate new code',
        cancelLabel: 'Keep current code',
      }))
    )
      return;
    await act(`/classes/${id}/invitations`, 'POST', { expiresInHours: hours, maxUses });
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyNotice('Copied. Share this code privately.');
    } catch {
      setCopyNotice('Copy is unavailable. Select the code and copy it manually.');
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
          void generate();
        }}
      >
        <FormFieldset className="form-fields" disabled={busy}>
          <div className="form-row">
            <label>
              Expires in hours
              <InputField
                required
                type="number"
                min={1}
                max={168}
                value={hours}
                onChange={(e) => setDraft((old) => ({ ...old, hours: Number(e.target.value) }))}
              />
            </label>
            <label>
              Maximum uses
              <InputField
                required
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => setDraft((old) => ({ ...old, maxUses: Number(e.target.value) }))}
              />
            </label>
          </div>
          <div className="preset-row" aria-label="Invitation duration presets">
            {[24, 48, 168].map((value) => (
              <Button
                type="button"
                className="preset"
                aria-pressed={hours === value}
                key={value}
                onClick={() => setDraft((old) => ({ ...old, hours: value }))}
              >
                {value === 168 ? '7 days' : `${value} hours`}
              </Button>
            ))}
          </div>
          <Button className="primary">{busy ? 'Generating…' : 'Generate invitation'}</Button>
        </FormFieldset>
      </form>
      {code && (
        <div className="invitation-code">
          <label htmlFor={`invite-code-${id}`}>New invitation code</label>
          <TextAreaField
            id={`invite-code-${id}`}
            readOnly
            value={code}
            onFocus={(e) => e.target.select()}
            aria-describedby={`invite-help-${id}`}
          />
          <div className="copy-row">
            <span id={`invite-help-${id}`}>
              Kept while this page stays open. Copy before refreshing or signing out.
            </span>
            <Button type="button" className="secondary" onClick={() => void copyCode()}>
              Copy code
            </Button>
          </div>
          {copyNotice && (
            <p role="status" className="copy-status">
              {copyNotice}
            </p>
          )}
        </div>
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
          <Button onClick={() => setRevision((v) => v + 1)}>Retry invitations</Button>
        </p>
      )}
      {invites.data?.map((invite, index) => (
        <div className="invite-row" key={invite.id}>
          <span>
            Invitation {index + 1} · {invite.uses}/{invite.maxUses} used
            <small>Expires {new Date(invite.expiresAt).toLocaleString('en-US')}</small>
          </span>
          <Button
            className="text-button danger"
            disabled={busy}
            onClick={() => void act(`/classes/${id}/invitations/${invite.id}`, 'DELETE')}
          >
            Revoke invitation {index + 1}
          </Button>
        </div>
      ))}
      <h3 className="section-title">Members {members.data ? `(${members.data.total})` : ''}</h3>
      {members.loading && <p role="status">Loading members…</p>}
      {members.error && (
        <p role="alert" className="error">
          {members.error}
          <Button onClick={() => setRevision((v) => v + 1)}>Retry members</Button>
        </p>
      )}
      {members.data?.total === 0 && <p>No students have joined yet.</p>}
      {members.data?.items.map((member) => (
        <div className="invite-row" key={member.id}>
          <span>
            {member.name}
            <small>{member.email}</small>
          </span>
          <Button
            className="text-button danger"
            disabled={busy}
            onClick={() => setRemoving(member)}
          >
            Remove {member.name}
          </Button>
        </div>
      ))}
      {removing && (
        <div role="alert" className="result">
          <p>
            Remove {removing.name}? Their assignment access will end immediately. Existing scores
            will be kept.
          </p>
          <div className="draft-actions">
            <Button className="secondary" disabled={busy} onClick={() => setRemoving(null)}>
              Cancel removal
            </Button>
            <Button
              className="primary"
              disabled={busy}
              onClick={() => void act(`/classes/${id}/members/${removing.id}`, 'DELETE')}
            >
              Confirm removal
            </Button>
          </div>
        </div>
      )}
      {members.data && (
        <div className="pagination">
          <Button disabled={page === 1 || busy} onClick={() => setPage((v) => v - 1)}>
            Previous members
          </Button>
          <span>Page {page}</span>
          <Button
            disabled={page * 10 >= members.data.total || busy}
            onClick={() => setPage((v) => v + 1)}
          >
            Next members
          </Button>
        </div>
      )}
    </>
  );
}
