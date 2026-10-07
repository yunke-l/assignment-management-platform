import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Prompt = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
const ConfirmContext = createContext<(prompt: Prompt) => Promise<boolean>>(() =>
  Promise.resolve(false),
);
export const useConfirm = () => useContext(ConfirmContext);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  function finish(value: boolean) {
    dialog.current?.close();
    resolve.current?.(value);
    resolve.current = null;
    setPrompt(null);
    previousFocus.current?.focus();
  }
  useEffect(() => {
    if (prompt) dialog.current?.showModal();
  }, [prompt]);
  return (
    <ConfirmContext.Provider
      value={(next) => {
        if (resolve.current) return Promise.resolve(false);
        previousFocus.current = document.activeElement as HTMLElement;
        return new Promise<boolean>((done) => {
          resolve.current = done;
          setPrompt(next);
        });
      }}
    >
      {children}
      {prompt && (
        <dialog
          ref={dialog}
          className="confirm-dialog"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-description"
          onCancel={(event) => {
            event.preventDefault();
            finish(false);
          }}
        >
          <span className="dialog-icon" aria-hidden="true">
            !
          </span>
          <h2 id="confirm-title">{prompt.title}</h2>
          <p id="confirm-description" className="muted">
            {prompt.description}
          </p>
          <div className="dialog-actions">
            <button className="secondary" autoFocus onClick={() => finish(false)}>
              {prompt.cancelLabel ?? 'Keep working'}
            </button>
            <button
              className={`primary ${prompt.danger ? 'danger' : ''}`}
              onClick={() => finish(true)}
            >
              {prompt.confirmLabel ?? 'Discard changes'}
            </button>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  );
}
