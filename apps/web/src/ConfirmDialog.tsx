import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '@mantine/core';
import classes from './theme.module.css';

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
  function finish(value: boolean) {
    resolve.current?.(value);
    resolve.current = null;
    setPrompt(null);
  }
  return (
    <ConfirmContext.Provider
      value={(next) => {
        if (resolve.current) return Promise.resolve(false);
        return new Promise<boolean>((done) => {
          resolve.current = done;
          setPrompt(next);
        });
      }}
    >
      {children}
      <Modal
        opened={prompt !== null}
        onClose={() => finish(false)}
        title={prompt?.title}
        centered
        size={440}
        withCloseButton={false}
        closeOnClickOutside={false}
        overlayProps={{ backgroundOpacity: 0.4, blur: 3 }}
        transitionProps={{ duration: 0 }}
      >
        {prompt && (
          <>
            <p className={classes.description}>{prompt.description}</p>
            <div className="dialog-actions">
              <Button variant="default" data-autofocus onClick={() => finish(false)}>
                {prompt.cancelLabel ?? 'Keep working'}
              </Button>
              <Button color={prompt.danger ? '#a74439' : undefined} onClick={() => finish(true)}>
                {prompt.confirmLabel ?? 'Discard changes'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}
