/**
 * A rough average mechanical power for a ride, when no power meter recorded it.
 *
 * The standard cycling model: the power at the wheel is what it takes to
 * overcome rolling resistance, push air aside, and climb — divided by the
 * drivetrain's efficiency. Computed from the ride's averages rather than
 * per-sample, so it is a ballpark for the summary card, not a training number:
 * using the average speed for the aerodynamic term (which grows with the cube
 * of speed) understates a variable ride, and the constants below are typical
 * road-bike values, not this rider's.
 *
 *   - Crr  rolling resistance coefficient (tyre on tarmac)
 *   - CdA  drag area (rider on the hoods)
 *   - rho  air density at sea level
 *   - bike an assumed bike-and-kit mass added to the rider's
 */
const G = 9.80665
const CRR = 0.005
const CD_A = 0.4
const RHO = 1.225
const DRIVETRAIN = 0.97
const BIKE_KG = 9

/** Estimated average watts, or null when there is not enough to estimate from. */
export function estimateAvgCyclingPower(distanceM: number, movingSec: number, elevGainM: number, riderKg: number): number | null {
  if (distanceM <= 0 || movingSec <= 0) return null
  const mass = (riderKg > 0 ? riderKg : 70) + BIKE_KG
  const v = distanceM / movingSec
  const rolling = CRR * mass * G * v
  const air = 0.5 * CD_A * RHO * v ** 3
  // Total climbing work spread over the whole moving time.
  const climb = (mass * G * Math.max(0, elevGainM)) / movingSec
  const watts = (rolling + air + climb) / DRIVETRAIN
  return watts > 0 ? Math.round(watts) : null
}
