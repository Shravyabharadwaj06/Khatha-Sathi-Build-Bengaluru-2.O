import authBaseCss from '../styles/auth-base.css?raw';
import authCss from '../styles/auth.css?inline';

/** Same order as the originals: inline <style> (native `@layer base`) first, then the Tailwind output. */
export const AUTH_CSS = [authBaseCss, authCss];

/** Verbatim <body class> of log_in.html and sign_up.html. */
export const AUTH_BODY_CLASS = 'bg-surface font-body-md text-on-surface min-h-screen flex flex-col justify-between';
