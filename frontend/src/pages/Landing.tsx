import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import landingCss from '../styles/landing.css?raw';
import shopOwner from '../assets/shop-owner.jpg';
import { usePageStyles } from '../hooks/usePageStyles';
import { LandingFooter, LandingHeader } from '../components/LandingChrome';

/** Source: design-reference/landing_page.html */
export default function Landing() {
  usePageStyles({ css: [landingCss], title: 'CHOTU.ai | Your shop, understood in every language' });

  // Arriving from another route via /#how etc.: scroll to the section.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      <LandingHeader onLanding />
      <main>
        <section className="wrap hero" id="signup">
          <div className="hero-card">
            <img src={shopOwner} alt="A woman shop owner speaking with a customer in her busy neighborhood shop" />
            <div className="hero-copy">
              <p className="eyebrow">A little help for your shop</p>
              <h1>
                Your shop,<br />understood in<br />every language.
              </h1>
              <span className="brandline">CHOTU.ai</span>
              <p>CHOTU.ai helps shop owners communicate effortlessly with every customer and get reliable support for everyday shop tasks.</p>
              <p className="language">Chotu can speak in any language.</p>
              <div className="hero-buttons">
                <Link className="btn" to="/signup">Sign up</Link>
                <Link className="btn outline" to="/login">Log in</Link>
              </div>
            </div>
            <div className="device-note">Zero installation needed. Runs directly on mobile, tablet or desktop.</div>
          </div>
        </section>
        <section className="wrap intro">
          <h2>
            More ease in every<br />shop conversation.
          </h2>
          <p>From helping you talk with customers to offering a hand with everyday shop tasks, Chotu is a friendly assistant for the busy moments that make up your day.</p>
        </section>
        <section className="section" id="how">
          <div className="wrap">
            <div className="section-heading">
              <h2 className="section-title">How it works</h2>
              <p>Getting started is simple. Open Chotu and begin with what you need.</p>
            </div>
            <div className="steps">
              <article className="step">
                <span className="number">01 / START</span>
                <h3>Open Chotu</h3>
                <p>Visit CHOTU.ai on a device you already use.</p>
              </article>
              <article className="step">
                <span className="number">02 / ASK</span>
                <h3>Tell Chotu what you need</h3>
                <p>Use your own words and speak in any language.</p>
              </article>
              <article className="step">
                <span className="number">03 / CONTINUE</span>
                <h3>Get help as you go</h3>
                <p>Keep the conversation going as shop needs come up.</p>
              </article>
            </div>
          </div>
        </section>
        <section className="section" id="help">
          <div className="wrap">
            <div className="section-heading">
              <h2 className="section-title">
                A hand with the<br />everyday things
              </h2>
              <p>Here are a few examples of the kinds of things a shop owner might ask an assistant for.</p>
            </div>
            <div className="help-grid">
              <article className="help-card">
                <h3>Talking with customers</h3>
                <p>Get help understanding what a customer is asking or finding the right words to respond.</p>
              </article>
              <article className="help-card">
                <h3>Everyday shop tasks</h3>
                <p>Ask for a hand thinking through a task that comes up during your workday.</p>
              </article>
              <article className="help-card">
                <h3>Questions as they come</h3>
                <p>Describe what is on your mind and get conversational support for the next step.</p>
              </article>
            </div>
          </div>
        </section>
        <section className="wrap language-band">
          <h2>
            Every language<br />has a place here.
          </h2>
          <div>
            <p>Chotu can speak in any language, so shop owners and customers can communicate in the language that feels natural to them.</p>
            <strong>Speak naturally. Get understood.</strong>
          </div>
        </section>
        <section className="section" id="faq">
          <div className="wrap">
            <div className="section-heading">
              <h2 className="section-title">
                A few things<br />you might wonder
              </h2>
            </div>
            <div className="faq-list">
              <article className="faq-item">
                <h3>How do I get started?</h3>
                <p>Open CHOTU.ai on your mobile, tablet or desktop and start a conversation. There is no installation needed.</p>
              </article>
              <article className="faq-item">
                <h3>What languages can Chotu speak?</h3>
                <p>Chotu can speak in any language. You can begin in the language that feels most comfortable to you.</p>
              </article>
              <article className="faq-item">
                <h3>How do I access my account?</h3>
                <p>Use the Log in link to access your account, or Sign up to get started. Account access details are provided during sign up.</p>
              </article>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
