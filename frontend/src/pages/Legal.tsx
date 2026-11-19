import landingCss from '../styles/landing.css?raw';
import { usePageStyles } from '../hooks/usePageStyles';
import { LandingFooter, LandingHeader } from '../components/LandingChrome';

/**
 * /terms and /privacy. These screens were not exported from Stitch, but landing.css
 * already styles them (.legal, .updated, .legal-content, .placeholder), so this page
 * uses ONLY those existing classes plus the Landing header/footer.
 * All body copy below is PLACEHOLDER: replace with the real legal text.
 */
const PAGES = {
  terms: {
    title: 'Terms and Conditions',
    sections: ['Using CHOTU.ai', 'Your account', 'Your shop data', 'Changes to these terms', 'Contact us'],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: ['Information we collect', 'How we use information', 'Voice recordings', 'Your choices', 'Contact us'],
  },
} as const;

export default function Legal({ kind }: { kind: keyof typeof PAGES }) {
  const page = PAGES[kind];
  usePageStyles({ css: [landingCss], title: `CHOTU.ai | ${page.title}` });
  return (
    <>
      <LandingHeader />
      <main>
        <section className="wrap legal">
          <h1>{page.title}</h1>
          <p className="updated">Last updated: [PLACEHOLDER DATE]</p>
          <div className="legal-content">
            <p className="placeholder">
              PLACEHOLDER: The final text of the CHOTU.ai {page.title} has not been written yet. This page shows the layout only; replace every section below with the approved legal text before launch.
            </p>
            {page.sections.map((heading, i) => (
              <div key={heading}>
                <h2>
                  {i + 1}. {heading}
                </h2>
                <p>[PLACEHOLDER] Content for “{heading}” goes here.</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
