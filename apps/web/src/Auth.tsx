import { useState, type FormEvent } from 'react';
import type { Actor } from '@amp/contracts';
import { request } from './api';
import { Brand, Owl } from './Owl';
import { useConfirm } from './ConfirmDialog';
import { useBeforeUnload, useWork, useWorkGuard } from './WorkProtection';
export type Session = { token: string; user: Actor };
export function Login({
  onLogin,
  notice,
}: {
  onLogin: (session: Session) => void;
  notice: string;
}) {
  const [registering, setRegistering] = useState(false);
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [invitation, setInvitation] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useBeforeUnload(!!(name || invitation) || (registering && !!(email || password)) || busy);
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
        <Brand />
        <span className="eyebrow">SMALL STEPS. BRIGHT IDEAS.</span>
        <h1>
          A little curiosity.
          <br />
          <span>A world of possibility.</span>
        </h1>
        <p>
          A calmer place to teach. A brighter place to learn. Bring your classroom together, one
          good question at a time.
        </p>
        <div className="owl-scene">
          <div className="scene-halo" />
          <span className="scene-spark spark-one" aria-hidden="true">
            ✦
          </span>
          <span className="scene-spark spark-two" aria-hidden="true">
            ✧
          </span>
          <span className="scene-leaf leaf-one" aria-hidden="true" />
          <span className="scene-leaf leaf-two" aria-hidden="true" />
          <Owl label="Ollie the owl reading a book" />
          <span className="owl-caption">Meet Ollie. Big on little discoveries.</span>
        </div>
        <div className="intro-path">
          <span>
            <span className="path-number">01</span>
            <b>Create</b>
          </span>
          <i>→</i>
          <span>
            <span className="path-number">02</span>
            <b>Submit</b>
          </span>
          <i>→</i>
          <span>
            <span className="path-number">03</span>
            <b>Review</b>
          </span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="login-greeting">
            A good day to learn <span aria-hidden="true">✦</span>
          </span>
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
            onClick={async () => {
              if (
                registering &&
                (name || invitation || password) &&
                !(await confirm({
                  title: 'Leave account setup?',
                  description:
                    'Your password will be cleared. Your name, email and invitation stay on this page until it is refreshed.',
                  confirmLabel: 'Go to sign in',
                }))
              )
                return;
              setRegistering((v) => !v);
              setError('');
              setPassword('');
            }}
          >
            {registering
              ? 'Already have an account? Sign in'
              : 'Have an invitation? Create an account'}
          </button>
          <p className="login-footnote">A little focus. A lot of possibility.</p>
        </div>
      </section>
    </main>
  );
}
export function AccountPanel({ onChanged }: { onChanged: () => void }) {
  const work = useWork();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useWorkGuard('password', !!(currentPassword || newPassword), busy);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !(await work.allowSignOut(true))) return;
    setBusy(true);
    setError('');
    try {
      await request('/auth/password', undefined, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      work.clearAll();
      onChanged();
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
          <span className="eyebrow">YOUR OWN LITTLE CORNER</span>
          <h1>Your account</h1>
          <p className="muted">Keep your sign-in details up to date.</p>
        </div>
        <Owl pose="wave" className="heading-owl" />
      </section>
      <section className="panel detail-panel account-panel">
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
    </>
  );
}
