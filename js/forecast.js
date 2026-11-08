/*
 * Estimated finish date, from the average rate of progress so far.
 * Pure – no DOM. Works as a browser global (window.MapGoalsForecast) and as a CommonJS module.
 *
 * Dates are ISO strings ("2026-11-08") and are handled as whole UTC days, so
 * daylight-saving changes and time zones can't shift a result by a day.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapGoalsForecast = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MS_PER_DAY = 86400000;
  const MAX_DAYS = 100 * 365; // beyond this an "estimate" is meaningless
  const EPS = 1e-9;

  /** "2026-11-08" → whole days since 1970-01-01 (or null if invalid). */
  function toDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return isNaN(t) ? null : Math.round(t / MS_PER_DAY);
  }

  /** Whole days since 1970-01-01 → "2026-11-08". */
  function fromDay(day) {
    return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
  }

  /**
   * Estimate when the goal will be reached.
   *
   * @param {Array<{date: string, value: number}>} entries  progress, already in the goal's unit
   * @param {number} target                                 goal amount (> 0)
   * @param {object} [opts]
   * @param {string} [opts.startDate]   when the goal started. Without it, the rate is measured
   *                                    from the first entry, and that first day's progress is
   *                                    treated as the baseline.
   * @param {string} [opts.targetDate]  optional deadline, to report ahead/behind and the rate needed.
   *
   * @returns {object} with `status` one of:
   *   'no-target'   – no valid target
   *   'no-data'     – no entries yet
   *   'need-more'   – all progress is on one day, so there's no rate yet
   *   'no-progress' – the average rate is zero or going the wrong way
   *   'too-slow'    – at this rate it would take more than 100 years
   *   'estimate'    – finishDate is the estimated finish
   *   'reached'     – reachedDate is when the target was reached
   */
  function estimateFinish(entries, target, opts = {}) {
    if (!(target > 0)) return { status: 'no-target' };

    const list = (entries || [])
      .map((e) => ({ day: toDay(e.date), value: Number(e.value) }))
      .filter((e) => e.day !== null && isFinite(e.value))
      .sort((a, b) => a.day - b.day);
    if (!list.length) return { status: 'no-data' };

    const total = list.reduce((s, e) => s + e.value, 0);
    const firstDay = list[0].day;
    const lastDay = list[list.length - 1].day;
    const remaining = target - total;

    // Already there: report the day the running total last crossed the target.
    if (remaining <= EPS) {
      let cum = 0;
      let reachedDay = lastDay;
      let below = true;
      for (const e of list) {
        cum += e.value;
        if (below && cum >= target - EPS) reachedDay = e.day;
        below = cum < target - EPS;
      }
      return { status: 'reached', reachedDate: fromDay(reachedDay), total };
    }

    // Average rate per day over the period the progress was made in.
    const startDay = toDay(opts.startDate);
    let fromDayN;
    let progress;
    if (startDay !== null && startDay < lastDay && startDay <= firstDay) {
      fromDayN = startDay;
      progress = total;
    } else {
      fromDayN = firstDay;
      progress = total - list.filter((e) => e.day === firstDay).reduce((s, e) => s + e.value, 0);
    }
    const elapsed = lastDay - fromDayN;

    const base = { total, remaining, basisFrom: fromDay(fromDayN), basisTo: fromDay(lastDay) };
    const targetInfo = deadline(opts.targetDate, lastDay, remaining);

    if (elapsed <= 0) return Object.assign({ status: 'need-more' }, base, targetInfo);
    const ratePerDay = progress / elapsed;
    if (!(ratePerDay > EPS)) return Object.assign({ status: 'no-progress', ratePerDay }, base, targetInfo);

    const daysNeeded = Math.ceil(remaining / ratePerDay - EPS);
    if (daysNeeded > MAX_DAYS) return Object.assign({ status: 'too-slow', ratePerDay }, base, targetInfo);

    const finishDay = lastDay + daysNeeded;
    const out = Object.assign({ status: 'estimate', ratePerDay, daysNeeded, finishDate: fromDay(finishDay) }, base, targetInfo);
    if (targetInfo.targetDate) out.daysLate = finishDay - toDay(targetInfo.targetDate); // > 0 behind, < 0 ahead
    return out;
  }

  /** Rate needed from the last entry to hit an optional deadline. */
  function deadline(targetDate, lastDay, remaining) {
    const td = toDay(targetDate);
    if (td === null) return {};
    const daysToTarget = td - lastDay;
    return {
      targetDate: fromDay(td),
      requiredRatePerDay: daysToTarget > 0 ? remaining / daysToTarget : null, // null: deadline passed
    };
  }

  /** Whole days from `fromIso` to `toIso` (negative if in the past). */
  function daysBetween(fromIso, toIso) {
    const a = toDay(fromIso);
    const b = toDay(toIso);
    return a === null || b === null ? null : b - a;
  }

  /** "today", "tomorrow", "in 5 days", "in 3 weeks", "in about 4 months", "in about 2 years". */
  function describeIn(days) {
    if (days === null || !isFinite(days)) return '';
    if (days < 0) return days === -1 ? 'yesterday' : `${-days} days ago`;
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days < 14) return `in ${days} days`;
    if (days < 63) return `in ${Math.round(days / 7)} weeks`;
    if (days < 730) return `in about ${Math.round(days / 30.4375)} months`;
    return `in about ${Math.round(days / 365.25)} years`;
  }

  /** A span of days in friendly units: "4 days", "2 weeks", "3 months". */
  function describeSpan(days) {
    days = Math.abs(days);
    if (days === 1) return '1 day';
    if (days < 14) return `${days} days`;
    if (days < 63) return `${Math.round(days / 7)} weeks`;
    if (days < 730) return `${Math.round(days / 30.4375)} months`;
    return `${Math.round(days / 365.25)} years`;
  }

  return { toDay, fromDay, estimateFinish, daysBetween, describeIn, describeSpan };
});
