/** Validation message using only existing design tokens: body-sm text style + `error` (#ba1a1a). Renders nothing when valid. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="font-body-sm text-body-sm text-error" id={id} role="alert">
      {message}
    </p>
  );
}
