import { useCallback, useEffect, useRef, useState } from 'react';

/** Same timing as the Home page script: show, then hide after 1800 ms (timer restarts on each call). */
export const TOAST_MS = 1800;

export function useToast() {
  const [text, setText] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef<number>();
  const showToast = useCallback((message: string) => {
    setText(message);
    setShow(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(false), TOAST_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { text, show, showToast };
}
