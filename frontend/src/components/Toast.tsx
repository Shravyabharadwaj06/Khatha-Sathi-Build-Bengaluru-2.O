/** Home page toast: markup identical to `<div class="toast" role="status" aria-live="polite">` (styled by home.css). */
export function HomeToast({ text, show }: { text: string; show: boolean }) {
  return (
    <div className={show ? 'toast show' : 'toast'} role="status" aria-live="polite">
      {text}
    </div>
  );
}
