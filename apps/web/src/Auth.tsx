import { useState, type FormEvent } from 'react';
import type { Actor } from '@amp/contracts';
import { request } from './api';
export type Session = { token: string; user: Actor };
export function Login({
  onLogin,
  notice,
}: {
  onLogin: (session: Session) => void;
  notice: string;
}) {
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [invitation, setInvitation] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<Session>(
        registering ? '/auth/register' : '/auth/login',
        undefined,
        {
          method: 'POST',
          body: JSON.stringify(
            registering
              ? { email, password, name, invitation: invitation.trim() }
              : { email, password },
          ),
        },
      );
      onLogin({ user: result.user, token: '' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="intro">
        <div className="brand">
          c<span>Classwork</span>
        </div>
        <span className="eyebrow">A LITTLE STRUCTURE. MORE LEARNING.</span>
        <h1>
          From assigned
          <br />
          to understood.
        </h1>
        <p>
          A shared space for teachers to set the next challenge and students to show what they know.
        </p>
        <div className="intro-path">
          <span>
            01
            <br />
            <b>Create</b>
          </span>
          <i>→</i>
          <span>
            02
            <br />
            <b>Submit</b>
          </span>
          <i>→</i>
          <span>
            03
            <br />
            <b>Review</b>
          </span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">YOUR LEARNING WORKSPACE</span>
          <h2>{registering ? 'Join your workspace.' : 'Welcome back.'}</h2>
          <p className="muted">
            {registering
              ? 'Use the invitation supplied by your teacher or administrator.'
              : 'Sign in to open your assignments.'}
          </p>
          {notice && <p role="status">{notice}</p>}
          <form onSubmit={submit}>
            <fieldset className="form-fields" disabled={busy}>
              {registering && (
                <>
                  <label>
                    Your name
                    <input
                      required
                      maxLength={100}
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Invitation code
                    <input
                      required
                      autoComplete="off"
                      value={invitation}
                      onChange={(e) => setInvitation(e.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                Email
                <input
                  required
                  type="email"
                  maxLength={254}
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  required
                  type="password"
                  minLength={registering ? 12 : 1}
                  maxLength={128}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {registering && <p className="footnote">Use 12–128 characters for your password.</p>}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="primary wide">
                {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in →'}
              </button>
            </fieldset>
          </form>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setRegistering((v) => !v);
              setError('');
              setPassword('');
            }}
          >
            {registering
              ? 'Already have an account? Sign in'
              : 'Have an invitation? Create an account'}
          </button>
        </div>
      </section>
    </main>
  );
}
export function AccountPanel({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('/auth/password', undefined, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel detail-panel">
      <h2>Change password</h2>
      <p className="muted">Changing your password signs out all your sessions.</p>
      <form onSubmit={submit}>
        <fieldset className="form-fields" disabled={busy}>
          <label>
            Current password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            New password
            <input
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary">{busy ? 'Updating…' : 'Change password'}</button>
        </fieldset>
      </form>
    </section>
  );
}
