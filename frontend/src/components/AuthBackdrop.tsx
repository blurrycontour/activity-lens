/**
 * The ambient wash behind the signed-out screens.
 *
 * Two blurred accent glows and a faint route trace. Purely decorative and
 * inert to pointers. Shared by the login and server-setup screens: the frosted
 * `.auth-card` blurs whatever is behind it, so a screen that used the card
 * without this had nothing to blur and read as a flat panel.
 */
export default function AuthBackdrop() {
  return (
    <div className="auth-ambient" aria-hidden="true">
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      {/* Each line ends with a straight run off the right edge. For that join
          to read as smooth, the preceding curve has to *exit* along the same
          direction — so every S command's second control point is placed on
          the line between its endpoint and the final point. Move an endpoint
          and you have to move its control point to match, or the curve kinks
          where it meets the straight. */}
      <svg className="auth-trace" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" fill="none">
        <g stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
          <path d="M-40 430 C 120 400 180 250 320 280 S 520 342 660 300 L 860 240" />
          <path d="M-40 520 C 140 500 220 380 360 400 S 572 450 700 410 L 860 360" opacity="0.6" />
          <path d="M-40 330 C 100 300 200 180 300 200 S 508 220 640 190 L 860 140" opacity="0.4" />
        </g>
      </svg>
    </div>
  )
}
