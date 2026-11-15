import './connect.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OkayChat.in — Connect with us',
  description: 'WhatsApp API and business messaging for teams across industries. Follow OkayChat.in or contact our team.',
};

const profiles = [
  { name: 'Instagram', detail: '@okaychat.in · Product notes & updates', href: 'https://www.instagram.com/okaychat.in/', icon: '◎', tone: 'instagram' },
  { name: 'Threads', detail: '@okaychat.in · Conversation & updates', href: 'https://www.threads.com/@okaychat.in', icon: '@', tone: 'threads' },
  { name: 'LinkedIn', detail: 'Company updates & business messaging', href: 'https://www.linkedin.com/company/145292985/', icon: 'in', tone: 'linkedin' },
  { name: 'Facebook', detail: 'OkayChat.in · Page updates', href: 'https://www.facebook.com/people/OkayChatin/61595273036108/', icon: 'f', tone: 'facebook' },
  { name: 'YouTube', detail: '@OkayChatin · Walkthroughs & explainers', href: 'https://www.youtube.com/@OkayChatin', icon: '▶', tone: 'youtube' },
];

function Arrow() {
  return <svg className="connect-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function ChatMark() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-11.1 6.6L4 19l.9-4.2A7.5 7.5 0 1 1 20 11.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8.5 11.8h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

export default function ConnectPage() {
  return <div className="connect-page">
    <div className="connect-wrap">
      <header className="connect-top">
        <a className="connect-brand" href="/connect" aria-label="OkayChat.in"><img src="/brand/okaychat-wordmark.png" alt="OkayChat.in — Simple Business Conversations" /></a>
        <a className="connect-top-link" href="mailto:okaychat.in@gmail.com">Talk to our team <Arrow/></a>
      </header>
      <main className="connect-main">
        <section className="connect-intro">
          <span className="connect-eyebrow"><span className="connect-dot"/> WHATSAPP API · BUSINESS MESSAGING</span>
          <h1>Simple business conversations, <em>all in one place.</em></h1>
          <p className="connect-lead">OkayChat is building WhatsApp API and business messaging tools for teams across industries. Follow our journey, explore practical workflows, and connect with the team.</p>
          <div className="connect-actions">
            <a className="connect-button connect-primary" href="https://wa.me/918496715761?text=Hi%20OkayChat%2C%20I%E2%80%99d%20like%20to%20learn%20more." target="_blank" rel="noreferrer"><span className="connect-chat-icon"><ChatMark/></span> Talk to OkayChat</a>
            <a className="connect-button connect-secondary" href="#connect-socials">Explore our profiles <span aria-hidden="true">↓</span></a>
          </div>
          <div className="connect-product-preview" aria-label="Illustrative interface concept under development">
            <div className="connect-preview-window">
              <div className="connect-preview-top"><span className="connect-preview-lights"><i/><i/><i/></span><span>INTERFACE CONCEPT</span><b>IN DEVELOPMENT</b></div>
              <div className="connect-preview-body">
                <div className="connect-preview-sidebar"><i/><i/><i/><i/></div>
                <div className="connect-preview-panel">
                  <div className="connect-preview-panel-head"><span/><span/><span/></div>
                  <div className="connect-preview-chat"><i/><span/><span className="connect-preview-bubble"/><span/><span className="connect-preview-bubble short"/></div>
                  <div className="connect-preview-flow"><i/><span/><i/><span/><i/></div>
                </div>
              </div>
            </div>
            <div className="connect-preview-phone" aria-hidden="true"><div className="connect-phone-notch"/><span className="connect-phone-avatar"/><i/><i/><span className="connect-phone-bubble"/><i/><span className="connect-phone-bubble small"/></div>
          </div>
          <p className="connect-note">OkayChat is actively being built. Product previews will be clearly identified.</p>
          <div className="connect-workflow" aria-label="OkayChat workflow overview">
            <span><b>01</b> Conversations</span><i aria-hidden="true"/><span><b>02</b> Contacts & leads</span><i aria-hidden="true"/><span><b>03</b> Follow-ups</span>
          </div>
        </section>
        <aside className="connect-card" id="connect-socials" aria-label="OkayChat social profiles and contact details">
          <div className="connect-card-head"><div><span className="connect-card-kicker">STAY IN THE LOOP</span><h2>Find OkayChat online</h2></div><span className="connect-live"><i/> Official profiles</span></div>
          <nav className="connect-list" aria-label="Social profiles">
            {profiles.map((profile) => <a className="connect-social" href={profile.href} key={profile.name} target="_blank" rel="noreferrer"><span className={`connect-social-icon ${profile.tone}`} aria-hidden="true">{profile.icon}</span><span className="connect-social-copy"><strong>{profile.name}</strong><small>{profile.detail}</small></span><Arrow/></a>)}
          </nav>
          <div className="connect-divider"/>
          <a className="connect-contact" href="mailto:okaychat.in@gmail.com"><span className="connect-mail-icon" aria-hidden="true">✉</span><span><strong>Have a question?</strong><small>We’d be happy to hear from you.</small></span><span className="connect-contact-email">okaychat.in@gmail.com</span></a>
        </aside>
      </main>
      <footer className="connect-footer"><span>© 2026 <strong>OkayChat.in</strong> <i/> WhatsApp API & business messaging</span><nav aria-label="Footer links"><a href="https://www.instagram.com/okaychat.in/">Instagram</a><a href="https://www.linkedin.com/company/145292985/">LinkedIn</a><a href="mailto:okaychat.in@gmail.com">Email us</a></nav></footer>
    </div>
  </div>;
}
