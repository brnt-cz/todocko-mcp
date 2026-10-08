/**
 * Recurrence rules, ported from the app's `src/utils/recurrence.ts`. (TODO-420)
 *
 * MCP had none: `td_update_task` wrote `status: "done"` and stopped, so a
 * recurring task closed through MCP never came back. The app only advances
 * recurrence from its own UI path, so nothing else would either.
 *
 * A copy of the rules is a known risk - this repo has seen two copies of the
 * same thing drift apart. `recurrence.parity.test.ts` therefore runs the app's
 * real function against this one over a table of cases, including the edge
 * cases each rule exists for, and fails on the first disagreement.
 *
 * Keep this file a faithful port. Fix a bug in the app first, then here.
 */

export type RecurrenceType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

/**
 * The types this function knows how to advance.
 *
 * MCP offered `yearly` in four of its schemas while this union had four other
 * members and the switch below had no `default`, so a yearly task landed on no
 * branch at all and came back with the deadline it went in with: it recurred
 * forever on one date and nothing said so. The switch is exhaustive over the
 * union now, which makes the compiler catch the next addition, and this set
 * catches a value that only exists in stored data. (TODO-296)
 */
const KNOWN_RECURRENCE_TYPES: ReadonlySet<string> = new Set([
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'custom',
])

/**
 * Calculate the next deadline based on recurrence settings.
 * @param currentDeadline - Current deadline ISO date string (or null to use today)
 * @param recurrenceType - Type of recurrence
 * @param interval - Number of units to add (default 1)
 * @param recurrenceDay - Target day: weekly 1=Mon..7=Sun (ISO), monthly 1-31 or 0=last day
 * @returns Next deadline as ISO date string (YYYY-MM-DD)
 */
export function calculateNextDeadline(
  currentDeadline: string | null,
  recurrenceType: RecurrenceType,
  interval: number = 1,
  recurrenceDay?: number | null
): string {
  const base = currentDeadline ? new Date(currentDeadline) : new Date()
  // Normalize to date-only (avoid timezone shifts)
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const today = new Date()
  const todayNormalized = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // If the computed next date is in the past, advance from today instead
  const effectiveBase = date < todayNormalized ? todayNormalized : date

  if (!KNOWN_RECURRENCE_TYPES.has(recurrenceType)) {
    console.error(`[recurrence] unknown recurrence type "${recurrenceType}", the deadline was left where it was`)
    return formatDate(effectiveBase)
  }

  switch (recurrenceType) {
    case 'daily':
      effectiveBase.setDate(effectiveBase.getDate() + interval)
      break
    case 'weekly': {
      effectiveBase.setDate(effectiveBase.getDate() + interval * 7)
      if (recurrenceDay != null && recurrenceDay >= 1 && recurrenceDay <= 7) {
        // ISO weekday: 1=Mon..7=Sun → JS getDay(): 0=Sun..6=Sat
        const targetJsDay = recurrenceDay === 7 ? 0 : recurrenceDay
        const diff = (targetJsDay - effectiveBase.getDay() + 7) % 7
        effectiveBase.setDate(effectiveBase.getDate() + diff)
      }
      break
    }
    case 'monthly': {
      // Resolve the target month first, then pick a day that exists in it.
      //
      // Doing it the other way round is the TODO-250 bug: setMonth() on a day the
      // target month does not have rolls over into the month after, so Aug 31 + 1
      // month became Oct 1 and "monthly" silently skipped a month. Clamping
      // afterwards could not repair that — with recurrenceDay set it fixed the day
      // and left the wrong month, turning "the 15th of every month" into a
      // two-month step. Seven days a year land on this (Jan 29-31 and the 31st of
      // Mar, May, Aug, Oct), which is why it went unnoticed.
      //
      // Day 1 is safe for the intermediate date, so the month arithmetic — and its
      // year rollover, for interval > 12 — cannot overflow on the way.
      const targetMonth = new Date(effectiveBase.getFullYear(), effectiveBase.getMonth() + interval, 1)
      const year = targetMonth.getFullYear()
      const month = targetMonth.getMonth()
      const daysInMonth = new Date(year, month + 1, 0).getDate()

      let day: number
      if (recurrenceDay === 0) {
        // Last day of month
        day = daysInMonth
      } else if (recurrenceDay != null) {
        day = Math.min(recurrenceDay, daysInMonth)
      } else {
        // No target day: keep the day of the month, shortened if it does not exist.
        // Note this does not spring back — a Jan 31 deadline becomes Feb 28 and then
        // Mar 28, because only the deadline is stored. Pinning it needs recurrenceDay.
        day = Math.min(effectiveBase.getDate(), daysInMonth)
      }

      // All three set at once, so no intermediate value can overflow either.
      effectiveBase.setFullYear(year, month, day)
      break
    }
    case 'yearly': {
      // Same shape as monthly and for the same reason: land on day 1 of the
      // target year and month first, then pick a day that exists there, so a
      // 29 February deadline does not roll into March in a common year.
      const targetYear = effectiveBase.getFullYear() + interval
      const month = effectiveBase.getMonth()
      const daysInMonth = new Date(targetYear, month + 1, 0).getDate()
      effectiveBase.setFullYear(targetYear, month, Math.min(effectiveBase.getDate(), daysInMonth))
      break
    }
    case 'custom':
      // Custom uses days as the unit
      effectiveBase.setDate(effectiveBase.getDate() + interval)
      break
  }

  return formatDate(effectiveBase)
}

/**
 * Check if recurrence has expired (end date reached).
 * @param recurrenceEndDate - ISO date string of recurrence end date (or null for no end)
 * @returns true if recurrence has expired
 */
export function isRecurrenceExpired(recurrenceEndDate: string | null): boolean {
  if (!recurrenceEndDate) return false
  const endDate = new Date(recurrenceEndDate)
  const today = new Date()
  const todayNormalized = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const endNormalized = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
  return todayNormalized > endNormalized
}

/**
 * Check if a task has recurrence configured.
 */
export function isRecurring(recurrenceType: string | null | undefined): boolean {
  return recurrenceType != null && recurrenceType !== ''
}

/**
 * Format date to YYYY-MM-DD string.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
