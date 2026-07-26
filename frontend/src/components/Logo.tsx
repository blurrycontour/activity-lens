// App logo rendered inline so its background tile follows the active accent
// color (var(--primary)) instead of being baked into a static image.
interface LogoProps {
  size?: number
  radius?: number
}

export default function Logo({ size = 28, radius = 8 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', borderRadius: radius }}
      role="img"
      aria-label="Activity Lens"
    >
      <rect width="512" height="512" rx="120" ry="120" fill="var(--primary)" />
      <g
        transform="translate(128,128) scale(10.6667)"
        fill="none"
        stroke="#0a0b0e"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </g>
    </svg>
  )
}
