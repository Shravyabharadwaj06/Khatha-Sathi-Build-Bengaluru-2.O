import { Link } from "react-router-dom";

/** Footer shared verbatim by Log in and Sign up. */
export function AuthFooter() {
  return (
    <footer className="w-full bg-surface-container-low">
      <div className="max-w-7xl mx-auto px-margin lg:px-margin-desktop py-space-md flex flex-col sm:flex-row items-center justify-between gap-space-sm">
        <p className="font-body-sm text-body-sm text-on-surface-variant">© 2025 CHOTU.ai Technologies. All rights reserved.</p>
        <div className="flex items-center gap-space-md font-label-md text-label-md uppercase text-on-surface-variant">
          <Link className="hover:text-on-surface transition-colors" data-path="terms-and-conditions" to="/terms">
            Terms and Conditions
          </Link>
          <span className="text-outline-variant">•</span>
          <Link className="hover:text-on-surface transition-colors" data-path="privacy-policy" to="/privacy">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}
