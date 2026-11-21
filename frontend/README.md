# Khatha Sathi frontend (CHOTU.ai)

A React 18 + Vite + TypeScript + React Router app. It is a pixel-exact port of the Google Stitch designs in [`design-reference/`](design-reference/).

## Setup

Requires Node 18 or newer (tested on Node 24, npm 11).

```bash
npm install
npm run dev          # after starting the backend and copying .env.example to .env
```

For the connected local app, start the backend from `../backend` with
`python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000`, then copy
`.env.example` to `.env`. The frontend runs at http://localhost:5173 and uses
the SQLite-backed API at http://localhost:8000. Local signup OTP: `123456`.
Set `VITE_USE_MOCK_API=true` in `.env` to use the in-browser mock instead.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check (`tsc -b`) and build to `dist/` |
| `npm run preview` | Serve the production build (http://localhost:4173) |
| `npm run lint` | Run ESLint |
| `npm run visual:compare` | Build, then pixel-diff every page against the Stitch originals |
| `npm run visual:interactions` | Build, then diff interaction states against the originals and run the flow checks |
| `npm run test:visual` | Run both of the above |

The first time, install the browser: `npx playwright install chromium`.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `VITE_USE_MOCK_API` | `false` (in `.env.example`) | `true` uses the in-browser mock. `false` calls the real backend. |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Base URL of the real backend |

Never commit `.env`. Only `.env.example` is tracked.

## Routes

| Route | Screen | Source design |
|---|---|---|
| `/` | Landing. Nav smooth-scrolls to `#how`, `#help` and `#faq`. | `design-reference/landing_page.html` |
| `/login` | Log in (Phone/Email tabs, PIN toggle, "Remember counter device") | `design-reference/log_in.html` |
| `/signup` | Sign up (OTP with 30 s resend timer, "Other" domain field) | `design-reference/sign_up.html` |
| `/home` | Home dashboard. Protected: redirects to `/login` without a session. | `design-reference/home_page_files/home_page.html` |
| `/profile` | Shop and account settings. Protected. | `src/pages/Profile.tsx` |
| `/report-issue` | Submit a support report with optional photos. Protected. | `src/pages/ReportIssue.tsx` |
| `/report-sent` | Confirmation for the submitted support report. Protected. | `src/pages/ReportSent.tsx` |
| `/reports` | View previously submitted support reports. Protected. | `src/pages/MyReports.tsx` |
| `/terms`, `/privacy` | Legal pages with **placeholder** text. They use only the existing `.legal*` classes from the Landing CSS. | (not exported, composed from Landing CSS) |
| `/logout` | Clears the session, then goes to `/login` | none |
| anything else | Redirects to `/` | none |

A logged-in user who opens `/login` or `/signup` is sent to `/home`.

## Where things live

```
src/
  pages/        Landing, Login, Signup, Home, Profile, ReportIssue, ReportSent, MyReports, Legal
  styles/       landing.css, home.css, auth-base.css  (VERBATIM copies of the Stitch <style> blocks, do not edit)
                auth.css (Tailwind input for the auth pages)
  hooks/        usePageStyles (route-scoped CSS), useRotator (welcome animations), useToast
  components/   LandingChrome (header/footer), AuthFooter, AuthToast, FieldError, Toast, ProtectedRoute, authPage
  config/       homeFeatures.ts: the 6 Home cards (add a `route` to each once its screen exists)
  services/     api.ts (API layer + mock), session.ts (local/session storage)
  i18n/         Language selector, translations, and language preferences
  utils/        validation.ts
scripts/        visual-compare.ts, interaction-check.ts
design-reference/  Stitch exports (source of truth). home_page_OLD_DRAFT_do_not_use.html is the superseded draft.
```

### CSS isolation (important)

The four designs use conflicting global CSS, so **no stylesheet is global**. Each page calls `usePageStyles()`. This injects that page's CSS as `<style>` tags while the route is mounted and removes them when it unmounts. It also sets the `<body>` classes and the title.

- Landing and Home: their original `<style>` blocks, imported with `?raw`, so they are never processed.
- Log in and Sign up: a real Tailwind 3.4.17 build (the version `cdn.tailwindcss.com` serves), with the exact `tailwind.config` from the HTML (see `tailwind.config.js`). It is imported with `?inline`. The original small `<style>` block (a native `@layer base`, plus the hidden scrollbar) is imported raw, so Tailwind doesn't rewrite it.
- `#root` is `display: contents`, so each page's DOM behaves exactly like the original `body > header/main/footer`.
- If you add a Tailwind class to an auth page in a new file, add that file to `content` in `tailwind.config.js`.

## Mock API (`src/services/api.ts`)

Typed functions: `sendOtp`, `verifyOtp`, `signup`, `login`, `logout`, `getCurrentUser`. With `VITE_USE_MOCK_API=true`:

- There is a 400 ms fake delay.
- Accounts are stored in `localStorage` (`chotu.mock.users`).
- A demo account always exists: phone `9876543210` or email `demo@chotu.shop`, PIN `123456`.
- `verifyOtp` accepts any 6-digit code once an OTP was "sent" to that phone.

The session is stored under `chotu.session`: in `localStorage` when "Remember counter device" is checked, otherwise in `sessionStorage`. Sign up always uses `localStorage`.

The real API uses `POST /auth/otp/send`, `POST /auth/otp/verify`, `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, and `GET /auth/me`, with Bearer token auth. Profile settings use `PUT /auth/profile`; support reports use `POST /support/reports` and `GET /support/reports`. Report photos and profile settings are stored in the local SQLite database. Backend validation errors are displayed from FastAPI's `detail` response.

## Visual comparison

`npm run visual:compare` serves `design-reference/` and `dist/` from one local server. It screenshots each original and its route at widths 1440, 1024, 768, 390 and 360:

- full page
- `setInterval` stubbed, so the rotators stay on their initial frame
- CSS animations disabled
- fonts and images awaited

It diffs the screenshots with pixelmatch and writes `visual-diff/report.md` and the `*-original/app/diff.png` images. The `visual-diff/` folder is gitignored. The run fails if any page/width is above 0.1%.

Only one change is made to an original while testing. `home_page.html` links its font CSS through an absolute `file:///C:/Users/shrav/...` path that only existed on the designer's machine. The test server rewrites that URL to the sibling `css2` file.

`npm run visual:interactions` drives the same interaction on both sides and diffs the viewport: hover, focus ring, mobile menu, tab switch, password toggles, Send OTP, countdown, "Other" domain, toasts, and rotator frames using a fake clock. It then runs the app-only flow checks: redirects, validation, login, sign up, logout, storage, keyboard navigation and reduced motion.
