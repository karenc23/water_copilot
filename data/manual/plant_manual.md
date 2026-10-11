# Chena Village Water Treatment Plant — Operator Manual

**Plant ID:** chena-village-01
**System type:** Groundwater source, gas chlorination, pressure sand filtration
**Population served:** ~310
**Last revision:** March 2024

> This manual is the authority for all operating thresholds. The copilot never
> invents a chemical dose or a safety limit — every number it cites comes from
> the page references below.

---

## Page 1 — Water Quality Standards & Hard Limits

These are the regulatory and manufacturer limits for this plant. Any reading
outside the ESCALATE band is a health-critical event and must be reported to the
Remote Maintenance Worker (RMW) the same day.

| Parameter | Normal range | Warning band | ESCALATE (health-critical) |
|---|---|---|---|
| Free chlorine residual | 0.5 – 2.0 mg/L | 0.3 – 0.49 mg/L | **below 0.3 mg/L** or **above 4.0 mg/L** |
| Turbidity | below 0.3 NTU | 0.3 – 0.99 NTU | **1.0 NTU or higher** |
| pH | 6.8 – 7.8 | 6.5 – 6.79 or 7.81 – 8.2 | **below 6.5** or **above 8.5** |

**Rule 1A.** Free chlorine below 0.3 mg/L means the water may not be disinfected.
This always escalates, regardless of any other reading.

**Rule 1B.** Turbidity at or above 1.0 NTU can shield pathogens from chlorine.
This always escalates.

**Rule 1C.** A boil-water notice is considered when chlorine is below 0.3 mg/L
**and** turbidity is at or above 1.0 NTU at the same time.

---

## Page 2 — Daily Monitoring & Drift Rules

Operators log free chlorine, turbidity, and pH once per day from the treated
water tap.

**Drift rules (code, not AI — the plant watches trends so the operator doesn't
have to remember):**

- **Drift 2A — Chlorine decline:** free chlorine drops on 3 consecutive days,
  even while still in the normal range. Likely cause: chlorinator feed rate
  drifting down, or a developing demand (contamination, biofilm).
- **Drift 2B — Turbidity climb:** turbidity rises on 3 consecutive days. Likely
  cause: filter nearing breakthrough; schedule a backwash (Page 4).
- **Drift 2C — pH swing:** pH moves more than 0.5 units in one day. Likely
  cause: soda ash feed problem or source change.

A drift warning is advisory. It does not by itself escalate unless a reading
also crosses an ESCALATE band on Page 1.

---

## Page 3 — Gas Chlorination System

The plant uses a 150 lb gas chlorine cylinder feeding a vacuum regulator and
injector.

**3A — Low chlorine residual, cylinder has gas.** Check the injector vacuum
line for a leak or blockage. Confirm the rotameter ball is at the set feed rate.
If the ball is stuck or the vacuum is lost, the injector check valve is the most
common failure.

**3B — Low chlorine residual, cylinder near empty.** A 150 lb cylinder reads
near zero on the scale. Switch to the standby cylinder (Page 3C). Never run the
plant without a confirmed residual.

**3C — Cylinder changeover.** Close the main valve on the empty cylinder, vent
the regulator, swap to the standby cylinder, replace the lead gasket, open
slowly, and leak-check with ammonia swab (white vapor = leak).

**3D — Chlorine gas leak (SAFETY).** A visible leak, a sharp smell at the
cylinder, or an alarm is an immediate evacuation and RMW call. Do not attempt a
repair alone. This always escalates.

**3E — High chlorine residual (above 4.0 mg/L).** Reduce the rotameter feed
rate. If residual stays high, the regulator may be stuck open — escalate.

---

## Page 4 — Pressure Sand Filter

**4A — Backwash procedure.** Backwash when turbidity climbs toward 0.3 NTU or on
the scheduled interval, whichever comes first. Open the backwash valve, run for
10 minutes until the sight glass runs clear, then return to service and run to
waste for 5 minutes before sending to the tank.

**4B — High turbidity after backwash.** If turbidity is still high after a full
backwash, the filter media may be channeled or exhausted. Reduce flow and
escalate for a media inspection.

**4C — Short filter runs.** If the filter needs backwashing far more often than
normal (for example, several times in a few weeks when it used to run a month),
suspect a source water change or failing media. Flag as a recurring problem.

---

## Page 5 — pH / Soda Ash Feed

**5A — Low pH (corrosive water).** Low pH corrodes pipes and can raise lead and
copper. Confirm the soda ash feeder is running and the day tank is not empty.
Increase feed per the dosing table. pH below 6.5 escalates.

**5B — High pH.** Reduce soda ash feed. pH above 8.5 reduces chlorine
effectiveness and escalates.

---

## Page 6 — Source Water & Storage

**6A — Pressure tank waterlogged.** Rapid pump cycling usually means a
waterlogged pressure tank or failed bladder. Not health-critical by itself;
log it and schedule service.

**6B — Storage tank low level.** If the treated storage tank is dropping faster
than usual with no change in demand, suspect a leak in the distribution line.
Log it; escalate only if pressure loss risks back-siphonage.

**6C — Power outage / plant restart.** After any outage, confirm chlorine
residual before sending water to the system. Run to waste until residual is in
the normal range.

---

## Page 7 — Escalation & Who to Call

**Remote Maintenance Worker (RMW):** covers this region, reachable by phone and
email. Expect travel delays of days.

**When to escalate (summary):**
- Any ESCALATE-band reading on Page 1.
- Any chlorine gas leak (Page 3D).
- Turbidity still high after a full backwash (Page 4B).
- A recurring problem the operator cannot resolve.

**Expert handoff packet.** When escalating, send: last 14 days of readings,
steps already tried, outcome of each, and photos of gauges or leaks. This lets
the RMW diagnose remotely instead of a phone-tag marathon.

---

## Page 8 — Operator Handoff Notes

When an operator leaves, the next operator inherits this plant's history through
the logbook. The handoff guide is generated from the logs: recurring problems,
what usually works, who to call, and what maintenance is overdue. Record plant
quirks here before departure.
