import { FormFieldset } from './Controls';
import { useState, type FormEvent } from 'react';
import { Alert, Button, TextInput } from '@mantine/core';
import type { Actor } from '@amp/contracts';
import { inviteTokenSchema } from '@amp/contracts';
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
  const [invitationError, setInvitationError] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useBeforeUnload(!!(name || invitation) || (registering && !!(email || password)) || busy);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setInvitationError('');
    setError('');
    if (registering) {
      const result = inviteTokenSchema.safeParse(invitation);
      if (!result.success) {
        setInvitationError(result.error.issues[0]!.message);
        return;
      }
    }
    setBusy(true);
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
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>{registering ? 'Create account' : 'Sign in'}</h2>
          <p className="muted">
            {registering
              ? 'Use the invitation supplied by your teacher or administrator.'
              : 'Sign in to open your assignments.'}
          </p>
          {notice && <p role="status">{notice}</p>}
          <form onSubmit={submit}>
            <FormFieldset className="form-fields" disabled={busy}>
              {registering && (
                <>
                  <TextInput
                    label="Your name"
                    required
                    maxLength={100}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <TextInput
                    label="Invitation code"
                    description="Ask your teacher or administrator for a code, then paste the full 43-character code here."
                    error={
                      invitationError ? <span role="alert">{invitationError}</span> : undefined
                    }
                    required
                    autoComplete="off"
                    value={invitation}
                    onChange={(e) => {
                      setInvitation(e.target.value);
                      setInvitationError('');
                    }}
                  />
                </>
              )}
              <TextInput
                label="Email"
                required
                type="email"
                maxLength={254}
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <TextInput
                label="Password"
                required
                type="password"
                minLength={registering ? 12 : 1}
                maxLength={128}
                autoComplete={registering ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {registering && <p className="footnote">Use 12–128 characters for your password.</p>}
              {error && (
                <Alert role="alert" color="red" mt="md">
                  {error}
                </Alert>
              )}
              <Button type="submit" fullWidth loading={busy} mt="sm" mb={4}>
                {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in →'}
              </Button>
            </FormFieldset>
          </form>
          <Button
            className="auth-switch"
            variant="subtle"
            fullWidth
            mt="md"
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
              setInvitationError('');
              setPassword('');
            }}
          >
            {registering
              ? 'Already have an account? Sign in'
              : 'Have an invitation? Create an account'}
          </Button>
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
          <h1>Your account</h1>
          <p className="muted">Keep your sign-in details up to date.</p>
        </div>
        <Owl pose="wave" className="heading-owl" />
      </section>
      <section className="panel detail-panel account-panel">
        <h2>Change password</h2>
        <p className="muted">Changing your password signs out all your sessions.</p>
        <form onSubmit={submit}>
          <FormFieldset className="form-fields" disabled={busy}>
            <TextInput
              label="Current password"
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <TextInput
              label="New password"
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
            {error && (
              <Alert role="alert" color="red" mt="md">
                {error}
              </Alert>
            )}
            <Button type="submit" loading={busy}>
              {busy ? 'Updating…' : 'Change password'}
            </Button>
          </FormFieldset>
        </form>
      </section>
    </>
  );
}
