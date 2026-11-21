import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePageStyles } from '../hooks/usePageStyles';
import { useToast } from '../hooks/useToast';
import { listIssueReports, type IssueReport } from '../services/api';
import { getSession } from '../services/session';
import reportCss from '../styles/report.css?raw';

interface ReportSentState {
  report?: IssueReport;
}

function createdLabel(dateValue: string): string {
  const date = new Date(dateValue);
  const isToday = date.toDateString() === new Date().toDateString();
  const day = isToday ? 'today' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(date);
  return `Created ${day} at ${time}`;
}

export default function ReportSent() {
  usePageStyles({ css: [reportCss], bodyClass: 'report-body', title: 'CHOTU.ai | Report received' });
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as ReportSentState | null;
  const [report, setReport] = useState<IssueReport | null>(state?.report ?? null);
  const [isLoading, setIsLoading] = useState(!state?.report);
  const [loadError, setLoadError] = useState('');
  const { text: toastText, show: toastShow, showToast } = useToast();
  const session = getSession();

  useEffect(() => {
    if (state?.report) return;
    let active = true;
    listIssueReports()
      .then((reports) => {
        if (!active) return;
        const latest = reports[0];
        if (latest) setReport(latest);
        else navigate('/home', { replace: true });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load your report.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [navigate, state?.report]);

  const copyReference = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.reference);
      showToast('Reference copied.');
    } catch {
      showToast('Could not copy the reference. Please select it to copy.');
    }
  };

  if (isLoading) {
    return <main className="report-main report-loading" role="status">Loading your report…</main>;
  }

  if (!report) {
    return (
      <main className="report-main report-load-error" role="alert">
        <p>{loadError || 'We could not find a submitted report.'}</p>
        <Link className="report-link-button" to="/reports">See my reports</Link>
        <button className="report-link-button" type="button" onClick={() => navigate('/home')}>Back to shop</button>
      </main>
    );
  }

  const phone = session?.user.phone.replace(/\D/g, '') ?? '9845123456';
  const maskedPhone = phone.length >= 5 ? `+91 ${phone.slice(0, 5)} XXXXX` : '+91 XXXXX XXXXX';
  const shopName = session?.user.shopName || 'Lakshmi Provisions';

  return (
    <div className="report-page">
      <header className="report-header">
        <button className="report-back" type="button" aria-label="Back to shop" onClick={() => navigate('/home')}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>
        <h1>Bill Confirmation</h1>
        <div className="report-header-tools">
          <span className="report-language">EN / HI</span>
          <button className="report-profile" type="button" aria-label="My profile" onClick={() => navigate('/profile')}>
            <span className="material-symbols-outlined" aria-hidden="true">person</span>
          </button>
        </div>
      </header>

      <main className="report-main confirmation-main">
        <div className="confirmation-topline">
          <span className="status-label">Status: Received</span>
          <button className="close-confirmation" type="button" aria-label="Close confirmation" onClick={() => navigate('/home')}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <section className="confirmation-hero">
          <div className="success-mark">
            <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
            <span className="success-spark" aria-hidden="true">✦</span>
          </div>
          <h2>Thank you! We got your report</h2>
          <p>ಧನ್ಯವಾದಗಳು • धन्यवाद • Your shop is our priority.</p>
        </section>

        <section className="ticket-card" aria-label="Report ticket reference">
          <div className="ticket-title">
            <span className="material-symbols-outlined" aria-hidden="true">receipt_long</span>
            <span>Your ticket reference</span>
          </div>
          <strong className="ticket-reference">{report.reference}</strong>
          <button className="copy-reference" type="button" onClick={copyReference}>
            <span className="material-symbols-outlined" aria-hidden="true">content_copy</span>
            Copy Ref ID
          </button>
          <div className="ticket-meta">
            <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
            <span>{createdLabel(report.createdAt)}</span>
            <span aria-hidden="true">•</span>
            <strong>{shopName}</strong>
          </div>
        </section>

        <section className="followup-card">
          <div className="followup-main">
            <span className="followup-icon material-symbols-outlined" aria-hidden="true">chat</span>
            <div>
              <h3>We will reply on WhatsApp within 24 hours.</h3>
              <p>Notification will be sent to your registered counter mobile ({maskedPhone}).</p>
            </div>
          </div>
          <div className="language-promise">
            <span className="material-symbols-outlined" aria-hidden="true">record_voice_over</span>
            <p>Our support speaks <strong>Kannada, Hindi, and English.</strong></p>
          </div>
        </section>

        <div className="interruption-promise">
          <span className="material-symbols-outlined" aria-hidden="true">storefront</span>
          <span>Zero billing interruption guaranteed</span>
          <strong>24x7 AI</strong>
        </div>

        <div className="confirmation-actions">
          <button className="back-to-shop-button" type="button" onClick={() => navigate('/home')}>
            Back to shop
            <span className="material-symbols-outlined" aria-hidden="true">store</span>
          </button>
          <button className="see-reports-button" type="button" onClick={() => navigate('/reports')}>
            See my reports
            <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
        </div>
      </main>
      <div className={`report-toast${toastShow ? ' visible' : ''}`} role="status" aria-live="polite">{toastText}</div>
    </div>
  );
}
