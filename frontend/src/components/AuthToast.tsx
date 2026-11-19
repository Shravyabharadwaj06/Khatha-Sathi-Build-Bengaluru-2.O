/**
 * Toast for the Log in page ("Forgot PIN?"). The auth designs have no toast, so this
 * mirrors the Home page toast (position, colour, padding, 200 ms transition, 1800 ms
 * lifetime) using only existing design tokens (primary-container / on-primary).
 * It is invisible (opacity 0, no pointer events) until shown, so it adds nothing to the layout.
 */
export function AuthToast({ text, show }: { text: string; show: boolean }) {
  return (
    <div
      className={`fixed left-1/2 bottom-6 -translate-x-1/2 ${show ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'} pointer-events-none bg-primary-container text-on-primary px-[19px] py-[13px] font-label-lg text-[14px] font-semibold transition-all duration-200 z-50`}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
