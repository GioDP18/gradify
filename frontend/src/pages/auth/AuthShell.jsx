import { useCallback, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { AUTH_STATUS, useAuth } from '../../context/AuthContext';
import SplashScreen from '../../components/common/SplashScreen';
import logo from '../../assets/brand/gradify-logo-clear.webp';
import campus from '../../assets/brand/evsu-campus-photo.webp';
import SupportChat from './SupportChat';
import { supportChatUrl } from '../../utils/supportChat';
import './auth.css';

/*
 * The ribbons, traced from the design (1672×941) and drawn in its coordinates:
 *  - top: two gold ribbons with a darker amber stripe between them, under a maroon sliver that
 *    ends two-thirds across (the top-right corner stays cream);
 *  - along the photo: the main gold ribbon narrows to a point about a third of the way down;
 *  - bottom: a gold ribbon leaves the edge and sweeps to the bottom left, with a maroon band
 *    between it and the cream. Both of its edges start on the main (cream) edge line and leave it
 *    in that line's own direction, so the gold grows out of the line as a hairline and widens
 *    smoothly; the shapes run past the line and are clipped exactly to it.
 * Each edge is a smooth curve fitted (least squares) to points measured from the design image,
 * within ~2 px of them; colours are sampled from it.
 */
const RIBBON_PATHS = {
  "cream": "M1364 0 C1276.3 10.3 1185.1 22.6 1104 60 C1097.3 63.1 1040.6 100 1036 104 C1020.6 117.5 1017.4 144 1009 162 C983.1 217.6 965.9 280.6 961 342 C942.1 579.6 941.3 772.1 757 941 L1672 941 L1672 0 Z",
  "photoSide": "M0 0 L1364 0 C1276.3 10.3 1185.1 22.6 1104 60 C1097.3 63.1 1040.6 100 1036 104 C1020.6 117.5 1017.4 144 1009 162 C983.1 217.6 965.9 280.6 961 342 C942.1 579.6 941.3 772.1 757 941 L0 941 Z",
  "maroonTop": "M1201 0 L1364 0 C1276.3 10.3 1185.1 22.6 1104 60 L1104 60 C1112.8 42.4 1181.2 9.9 1201 0 Z",
  "goldTop": "M1059 0 C996.9 74.5 965.5 153.8 959 252 C957 282.1 953.2 312.6 961 342 L961 342 C965.9 280.6 983.1 217.6 1009 162 C1017.4 144 1020.6 117.5 1036 104 C1040.6 100 1097.3 63.1 1104 60 C1112.8 42.4 1181.2 9.9 1201 0 Z",
  "stripe": "M1100 0 C997.7 102.3 976 186 960 330 C970.9 264.9 989.1 155.7 1031 104 C1066.8 59.7 1112.6 29 1161 0 Z",
  "maroonBottom": "M919.3 675 C860.1 854.1 578.5 900.7 420 946 L1000 990 L1000 675 Z",
  "goldBottom": "M936 600 C921.8 671.2 875.8 740.2 815 780 C657.9 883 413.6 910.5 230 946 L420 946 C578.5 900.7 860.1 854.1 919.3 675 L1000 675 L1000 600 Z"
};

function Ribbons() {
  return (
    <svg className="lg__ribbons" viewBox="0 0 1672 941" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lg-cream" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fcf6f2" />
          <stop offset="0.5" stopColor="#fdf9f7" />
          <stop offset="1" stopColor="#fdfaf7" />
        </linearGradient>
        <linearGradient id="lg-gold-top" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="340">
          <stop offset="0" stopColor="#fdd159" />
          <stop offset="0.35" stopColor="#eeb942" />
          <stop offset="1" stopColor="#e6ae3b" />
        </linearGradient>
        <linearGradient id="lg-maroon-top" gradientUnits="userSpaceOnUse" x1="1364" y1="0" x2="1113" y2="52">
          <stop offset="0" stopColor="#7b040d" />
          <stop offset="1" stopColor="#740001" />
        </linearGradient>
        <linearGradient id="lg-gold-bottom" gradientUnits="userSpaceOnUse" x1="930" y1="642" x2="255" y2="941">
          <stop offset="0" stopColor="#f5ba3e" />
          <stop offset="0.2" stopColor="#fccb51" />
          <stop offset="0.4" stopColor="#fac448" />
          <stop offset="0.62" stopColor="#d6922c" />
          <stop offset="0.85" stopColor="#bf7320" />
          <stop offset="1" stopColor="#b2621a" />
        </linearGradient>
        <linearGradient id="lg-maroon-bottom" gradientUnits="userSpaceOnUse" x1="870" y1="780" x2="600" y2="941">
          <stop offset="0" stopColor="#88040e" />
          <stop offset="0.55" stopColor="#78030c" />
          <stop offset="1" stopColor="#6d030b" />
        </linearGradient>
        {/* The photo side of the cream edge: the bottom ribbon and band end exactly on it. */}
        <clipPath id="lg-photo-side" clipPathUnits="userSpaceOnUse">
          <path d={RIBBON_PATHS.photoSide} />
        </clipPath>
      </defs>
      <path d={RIBBON_PATHS.cream} fill="url(#lg-cream)" />
      <path d={RIBBON_PATHS.maroonTop} fill="url(#lg-maroon-top)" />
      <path d={RIBBON_PATHS.goldTop} fill="url(#lg-gold-top)" />
      <path d={RIBBON_PATHS.stripe} fill="#da8818" />
      <g clipPath="url(#lg-photo-side)">
        <path d={RIBBON_PATHS.maroonBottom} fill="url(#lg-maroon-bottom)" />
        <path d={RIBBON_PATHS.goldBottom} fill="url(#lg-gold-bottom)" />
      </g>
    </svg>
  );
}

/**
 * The surroundings shared by the signed-out pages (sign in, forgot password, new password): the
 * campus photo and ribbons, the welcome message, and the white card with the logo. It is one layout
 * route, so moving between those pages changes only what is inside the card; the rest stays put.
 */
export default function AuthShell() {
  const { status } = useAuth();
  const { pathname } = useLocation();
  // The support chat box lives here, so it stays open while moving between the sign-in pages and
  // is gone once the person signs in.
  const chatUrl = supportChatUrl();
  const [chatOpen, setChatOpen] = useState(false);
  const openSupportChat = useCallback(() => setChatOpen(true), []);
  const closeSupportChat = useCallback(() => setChatOpen(false), []);
  const outletContext = useMemo(() => ({ openSupportChat: chatUrl ? openSupportChat : null }), [chatUrl, openSupportChat]);
  // Until the saved session has been checked, nothing is drawn (a signed-in user never sees these pages flash).
  if (status === AUTH_STATUS.LOADING) return <SplashScreen label="Checking your session…" />;
  return (
    <div className="lg">
      {/* Left: campus photo, warmed and fading into maroon, with the welcome message */}
      <div className="lg__photo" aria-hidden="true">
        <img src={campus} alt="" width="1800" height="1011" />
      </div>
      <Ribbons />

      <section className="lg__hero" aria-label="Eastern Visayas State University">
        <p className="lg__kicker">Eastern Visayas State University • Since 1907</p>
        <span className="lg__rule" aria-hidden="true" />
        <p className="lg__headline">
          Your class records,<br />
          <em>made simpler.</em>
        </p>
        <p className="lg__intro">Record attendance and scores, compute grades,<br />and keep every class in one place.</p>
        <p className="lg__values">Excellence • Virtue • Service • Unity</p>
      </section>

      {/* Right: the card */}
      <main className="lg__side">
        <div className="lg__card">
          <img src={logo} alt="Gradify, EVSU Grading System" className="lg__logo" width="560" height="560" />
          {/* Only this part changes between the pages; it fades in so the switch reads as one card changing. */}
          <div key={pathname.split('/')[1]} className="lg__swap">
            <Outlet context={outletContext} />
          </div>
        </div>

        <footer className="lg__footer">
          <span>© {new Date().getFullYear()} GRADIFY • EVSU Grading System</span>
          <span className="lg__footer-sep" aria-hidden="true" />
          <span className="lg__secure"><ShieldCheck fill="currentColor" stroke="#fff" aria-hidden="true" /> Secure instructor access</span>
        </footer>
      </main>
      {chatUrl && <SupportChat url={chatUrl} open={chatOpen} onOpen={openSupportChat} onClose={closeSupportChat} />}
    </div>
  );
}
