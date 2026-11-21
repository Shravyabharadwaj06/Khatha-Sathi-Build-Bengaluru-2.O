import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageStyles } from '../hooks/usePageStyles';
import { listIssueReports, type IssueReport } from '../services/api';
import reportCss from '../styles/report.css?raw';

const CATEGORY_LABELS: Record<string, string> = {
  login: 'Login',
  voice: 'Voice & Lang',
  stock: 'Stock / Items',
  customers: 'Customers',
  bills: 'Bills / Khata',
  upi: 'UPI Payment',
  slow: 'Slow / Stuck',
  other: 'Other Issue',
};

function formatCreatedAt(dateValue: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateValue));
}

export default function MyReports() {
  usePageStyles({ css: [reportCss], bodyClass: 'report-body', title: 'CHOTU.ai | My reports' });
  const navigate = useNavigate();
  const [reports, setReports] = useState<IssueReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    listIssueReports()
      .then((items) => {
        if (active) setReports(items);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load your reports.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="report-page">
      <header className="report-header">
        <button className="report-back" type="button" aria-label="Back to shop" onClick={() => navigate('/home')}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>
        <h1>My Reports</h1>
        <Link className="report-profile" to="/profile" aria-label="My profile">
          <span className="material-symbols-outlined" aria-hidden="true">person</span>
        </Link>
      </header>
      <main className="report-main reports-main">
        <section className="reports-heading">
          <p className="report-kicker">Support history</p>
          <h2>Your reports</h2>
          <p>Keep track of the issues you have sent to the Chotu support team.</p>
        </section>

        {isLoading ? (
          <p className="reports-message" role="status">Loading your reports…</p>
        ) : error ? (
          <p className="reports-message report-error" role="alert">{error}</p>
        ) : reports.length === 0 ? (
          <section className="empty-reports">
            <span className="material-symbols-outlined" aria-hidden="true">inbox</span>
            <h3>No reports yet</h3>
            <p>If something is not working, tell us and we will help.</p>
            <Link className="report-link-button" to="/report-issue">Report an issue</Link>
          </section>
        ) : (
          <ul className="reports-list">
            {reports.map((report) => (
              <li className="report-history-card" key={report.id}>
                <div className="history-card-top">
                  <span className="status-label">Received</span>
                  <strong>{report.reference}</strong>
                </div>
                <p>{report.description}</p>
                <div className="history-card-meta">
                  <span>{report.categories.map((category) => CATEGORY_LABELS[category] ?? category).join(' · ')}</span>
                  <time dateTime={report.createdAt}>{formatCreatedAt(report.createdAt)}</time>
                </div>
                {report.attachments.length > 0 && (
                  <small>{report.attachments.length} photo{report.attachments.length === 1 ? '' : 's'} attached</small>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="reports-actions">
          <Link className="back-to-shop-button" to="/report-issue">Report another issue</Link>
          <Link className="see-reports-button" to="/home">Back to shop</Link>
        </div>
      </main>
    </div>
  );
}
