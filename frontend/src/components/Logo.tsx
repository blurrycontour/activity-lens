// App logo, drawn inline so it follows the active accent (var(--primary))
// rather than baking a colour into a static image.
//
// The mark sits on a transparent ground so it works directly on whatever
// surface hosts it — top bar, login card, browser tab. The only places that
// bake in a dark tile are the maskable PWA icons and the Apple touch icon,
// because those formats composite transparency to black. Those live in
// public/ and are generated from the same geometry; see public/logo.svg.

// Geometry is hand-tuned and must stay identical to public/logo.svg, which the
// icon generator rasterises the PNGs from. Change one, change the other.
// Exported so the share card can stroke the same mark onto a canvas. Canvas
// cannot read `var(--primary)`, so it takes a literal colour and the geometry
// from here rather than keeping a third copy.
export const PULSE_PATH = 'M 380 256 H 319 L 287 360 L 224 151 L 193 256 H 130'

interface LogoProps {
  size?: number
}

export default function Logo({ size = 28 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
      role="img"
      aria-label="Activity Lens"
    >
      <circle
        cx="256"
        cy="256"
        r="190"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="40"
        strokeLinecap="round"
        strokeDasharray="895 300"
        transform="rotate(135 256 256)"
      />
      <path
        d={PULSE_PATH}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
