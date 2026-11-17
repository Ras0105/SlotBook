import { Link } from 'react-router-dom';
import { listProviders } from '../api';
import { useAuth } from '../auth/AuthContext';
import Icon from '../components/Icon';
import NextAppointmentCard from '../components/NextAppointmentCard';
import useAsync from '../hooks/useAsync';
import { tzLabel } from '../lib/time';

// A made-up booking card for the hero. Purely decorative (aria-hidden): it shows what booking feels like.
function HeroPreview() {
  const days = [
    ['Mon', '16'],
    ['Tue', '17'],
    ['Wed', '18'],
    ['Thu', '19'],
  ];
  const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview__card">
        <div className="preview__top">
          <span className="preview__dot" />
          <div>
            <strong>General checkup</strong>
            <span>30 min · Kolkata time</span>
          </div>
        </div>
        <div className="preview__days">
          {days.map(([wd, num], i) => (
            <span key={num} className={i === 1 ? 'is-on' : ''}>
              <small>{wd}</small>
              <b>{num}</b>
            </span>
          ))}
        </div>
        <div className="preview__slots">
          {times.map((t, i) => (
            <span key={t} className={i === 2 ? 'is-on' : i === 1 ? 'is-taken' : ''}>
              {t}
            </span>
          ))}
        </div>
        <div className="preview__bar">
          <span>Tue 17 Nov · 10:00</span>
          <b>Confirm</b>
        </div>
      </div>
      <div className="preview__toast">
        <span className="preview__tick">✓</span>
        <span>
          <strong>You’re booked</strong>
          <small>Confirmation sent by email</small>
        </span>
      </div>
    </div>
  );
}

const STEPS = [
  { n: '1', title: 'Find a provider', text: 'Search by service, like dentist, tutor or haircut, and open the one you want.' },
  { n: '2', title: 'Pick a time', text: 'See the real open times for each day. Taken times simply don’t appear.' },
  { n: '3', title: 'You’re booked', text: 'Confirm in one tap. Both of you get an email, and you can reschedule or cancel later.' },
];

const FEATURES = [
  { icon: 'clock', title: 'Live availability', text: 'Times come straight from each provider’s working hours and time off, so what you see is bookable.' },
  { icon: 'shield', title: 'No double bookings', text: 'Two people can’t take the same slot. If someone is a second faster, you’re told and shown fresh times.' },
  { icon: 'globe', title: 'Time zones handled', text: 'Times show in the provider’s time zone, with a note when your own clock differs.' },
  { icon: 'refresh', title: 'Easy changes', text: 'Move or cancel an appointment from one screen. Your old time stays yours until the new one is confirmed.' },
  { icon: 'mail', title: 'Emails and reminders', text: 'Booked, rescheduled or cancelled: everyone gets a clear email, and a reminder arrives the day before.' },
  { icon: 'mail', title: 'Email confirmations', text: 'Booked, rescheduled or cancelled: everyone involved gets a clear email.' },
  { icon: 'moon', title: 'Light and dark', text: 'Pick the look that’s easiest on your eyes, or let it follow your device.' },
];

export default function LandingPage() {
  const { user, status } = useAuth();
  const authed = status === 'authed' && user;
  // A few real providers make the page feel alive. If the request fails the section just doesn't appear.
  const { data } = useAsync((signal) => listProviders({ limit: 3 }, signal), []);
  const featured = Array.isArray(data) ? data.slice(0, 3) : [];

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero__inner">
          <div className="hero__copy">
            <p className="eyebrow">Online appointment booking</p>
            <h1>
              Book the right time, <span className="hero__accent">in seconds.</span>
            </h1>
            <p className="hero__lede">
              Choose a provider, pick a time that’s really free, and you’re booked. No phone calls, no waiting for a reply, no double
              bookings.
            </p>
            <div className="hero__cta">
              <Link className="btn btn--primary btn--large" to="/providers">
                Find a provider
              </Link>
              {authed ? (
                <Link className="btn btn--secondary btn--large" to={user.role === 'admin' ? '/admin' : '/appointments'}>
                  {user.role === 'admin' ? 'Open admin' : 'My appointments'}
                </Link>
              ) : (
                <Link className="btn btn--secondary btn--large" to="/register">
                  Create a free account
                </Link>
              )}
            </div>
            <p className="hero__trust">Free for customers · Takes about a minute · Works on any device</p>
          </div>
          <HeroPreview />
        </div>
      </section>

      {authed && user.role !== 'admin' && <NextAppointmentCard />}

      <section className="section" aria-labelledby="how-title">
        <div className="section__inner">
          <h2 id="how-title" className="section__title">
            Three steps from “I need an appointment” to done
          </h2>
          <div className="steps">
            {STEPS.map((step) => (
              <article className="step" key={step.n}>
                <span className="step__n" aria-hidden="true">
                  {step.n}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="section section--tint" aria-labelledby="featured-title">
          <div className="section__inner">
            <div className="section__head">
              <h2 id="featured-title" className="section__title">
                Available to book now
              </h2>
              <Link to="/providers">See all providers →</Link>
            </div>
            <div className="featured">
              {featured.map((p) => (
                <Link className="featured__card" key={p.id} to={`/providers/${p.id}`}>
                  <span className="featured__len">
                    <b>{p.appointment_duration_minutes}</b> min
                  </span>
                  <span className="featured__name">{p.service_name}</span>
                  <span className="muted">{tzLabel(p.timezone)} time</span>
                  <span className="featured__go">See times →</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="features-title">
        <div className="section__inner">
          <h2 id="features-title" className="section__title">
            Made to be dependable
          </h2>
          <div className="features">
            {FEATURES.map((f) => (
              <article className="feature" key={f.title}>
                <span className="feature__icon" aria-hidden="true">
                  <Icon name={f.icon} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="providers-title">
        <div className="section__inner">
          <div className="cta-band">
            <div>
              <h2 id="providers-title">Run a practice, studio or class?</h2>
              <p>
                Set your working hours and time off once. Customers book themselves into the gaps, and you see every booking in one
                dashboard.
              </p>
            </div>
            <Link className="btn btn--signal btn--large" to={authed && user.role === 'customer' ? '/become-provider' : authed ? '/providers' : '/register'}>
              {authed && user.role === 'customer' ? 'Become a provider' : authed ? 'Browse providers' : 'Get started free'}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
