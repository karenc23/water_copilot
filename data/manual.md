# Kettle Creek Water Treatment Plant — Operator Manual

> **FICTIONAL DOCUMENT.** Kettle Creek, this plant, and this manual are invented for testing the Water Copilot software. Do not use this manual to operate a real water system. Limits are based on U.S. EPA drinking water standards, but real plants must follow their own approved procedures and their state's instructions.

Plant ID: **plant-a** · Revision 3 (fictional)

## 1. About This Plant

**1.1 System overview.** Kettle Creek is a rural Alaska village of about 350 people. Raw water is pumped from Kettle Lake to two pressure sand filters, after polyaluminum chloride (PACl) coagulant is added. Filtered water is disinfected with sodium hypochlorite, adjusted with soda ash for pH, and stored in a heated 150,000-gallon tank. The distribution system is an above-ground circulating loop heated by a boiler, serving homes, the school, the clinic, and the washeteria. Average demand is about 30,000 gallons per day.

**1.2 Daily readings and normal ranges.** Take readings at the entry point (clearwell outlet) every day by 9:00 AM.

| Reading | Target | Take action | Emergency (Section 8) |
| --- | --- | --- | --- |
| Free chlorine | 0.8–1.5 mg/L | below 0.5 or above 2.0 mg/L | below 0.2 or above 4.0 mg/L |
| Filtered turbidity | below 0.15 NTU | 0.25 NTU or higher | above 1.0 NTU |
| pH | 7.0–7.8 | below 6.8 or above 8.0 | below 6.5 or above 8.5 |

The emergency limits come from EPA rules: 4.0 mg/L is the maximum residual disinfectant level for chlorine; water entering the distribution system must have at least 0.2 mg/L of chlorine; filtered turbidity must never be above 1 NTU and must be 0.3 NTU or lower in 95% of samples each month; 6.5–8.5 is EPA's recommended pH range.

**1.3 Logging.** Write every problem in the logbook: the date, your name, what you saw, every step you took, the result, and whether you escalated. The next operator depends on this.

## 2. Filters and Backwash

**2.1 Normal operation.** Run one filter at a time and swap duty filters each week. Record headloss (the pressure difference across the filter) and run hours every day. Do not change the coagulant dose yourself. Only the Remote Maintenance Worker (RMW) changes it, after a jar test.

**2.2 When to backwash.** Backwash the duty filter when any of these happens first: filtered turbidity reaches 0.25 NTU, headloss reaches 8 psi above clean-filter headloss, or the filter has run 72 hours. During spring breakup and fall lake turnover, filter runs may be much shorter. That is expected, so keep backwashing as needed.

**2.3 Backwash procedure.** (1) Take the filter offline. (2) Open the backwash valves and backwash for 10–15 minutes, until the waste water runs clear. (3) Rinse with filter-to-waste for at least 10 minutes, and keep rinsing until turbidity is below 0.15 NTU. (4) Return the filter to service.

**2.4 After backwash.** Check turbidity again after 1 hour and after 4 hours. Record the new clean-filter headloss. If turbidity is still 0.25 NTU or higher after 4 hours, backwash again.

**2.5 Filter problems that won't go away.** Contact the RMW (Section 8.1) if turbidity stays above 0.3 NTU after two backwashes in a row, if filter runs keep getting shorter outside breakup or turnover season, if you find sand in the clearwell or backwash waste, or if the same filter problem has happened 3 times in 30 days. These signs point to media loss, mudballs, or underdrain damage, and need an inspection.

## 3. Chlorine Disinfection

**3.1 Targets.** Keep free chlorine at the entry point between 0.8 and 1.5 mg/L. Chlorine is the village's main protection against germs, so treat any low reading seriously.

**3.2 Low residual (0.2–0.5 mg/L).** (1) Check the day tank level. If it's low, mix a fresh batch: 1 gallon of 12.5% sodium hypochlorite into the day tank, then fill with treated water to the 20-gallon mark. (2) Check that the feed pump is running and primed (Section 7.3). (3) Check the batch date. Batches older than 7 days lose strength, faster in a warm room. (4) If needed, raise the feed pump stroke in 5% steps, no more than 10% per hour. (5) Retest 30 minutes after each change.

**3.3 Residual below 0.2 mg/L — emergency.** Take all steps in 3.2 right away, switch to the standby feed pump if the duty pump has failed, and contact the RMW now. If the residual cannot be brought back to 0.2 mg/L within 4 hours, it is a treatment technique violation. The RMW or operator must notify ADEC (Alaska Department of Environmental Conservation) by the end of the next business day, and a boil-water notice may be needed (Section 8.2).

**3.4 High residual.** Above 2.0 mg/L: lower the feed pump stroke in 5% steps and retest 30 minutes after each change. Check that the last batch was mixed correctly. Above 4.0 mg/L: stop the feed pump, contact the RMW, and do not restart it until the residual is below 2.0 mg/L.

**3.5 Slow downward drift.** If chlorine has gone down 3 or more days in a row, act even if it is still in the target range. The usual causes are a weak or old batch, a worn pump diaphragm or check valve, or more chlorine demand in warmer or more turbid raw water. Mix a fresh batch, inspect the pump, and log the trend.

## 4. Turbidity

**4.1 Limits.** Target below 0.15 NTU. EPA requires 0.3 NTU or lower in 95% of monthly samples, and never above 1 NTU.

**4.2 Rising turbidity (0.25–1.0 NTU).** (1) Confirm with the bench turbidimeter (Section 4.4). (2) Backwash per 2.3. (3) Check the raw water. Breakup, turnover, and storms raise raw turbidity. (4) Check that the coagulant pump is running. (5) Increase readings to every 4 hours until turbidity is below 0.15 NTU.

**4.3 Above 1.0 NTU — emergency.** Any filtered reading above 1.0 NTU that the bench meter confirms is an EPA limit exceedance. Stop sending that filter's water to the clearwell if you can, contact the RMW immediately, and contact ADEC within 24 hours. A boil-water notice is likely (Section 8.2).

**4.4 Instrument checks.** Each day, compare the online turbidimeter to the bench meter. If they differ by more than 0.1 NTU, recalibrate the online meter with fresh standards. A reading that stays exactly the same for days, or reads near zero, usually means the sample line is blocked or frozen (Section 6.3).

## 5. pH

**5.1 Targets and meter calibration.** Keep pH between 7.0 and 7.8. Calibrate the pH meter daily with pH 7 and pH 10 buffers.

**5.2 Low pH (below 6.8).** Low pH makes water corrosive and can release lead and copper from home plumbing. Check the soda ash day tank and feed pump (Section 7.3), and raise the soda ash pump stroke in 5% steps, retesting after 1 hour.

**5.3 High pH (above 8.0).** Chlorine works much less well above pH 8. Lower the soda ash pump stroke in 5% steps, and keep chlorine in the upper half of the target range (Section 3.1) until pH is back below 7.8.

**5.4 Outside 6.5–8.5.** Contact the RMW (Section 8.1).

## 6. Freeze Protection

**6.1 Normal.** Keep the plant building at 55°F or warmer. Keep the circulating loop return water at 40°F or warmer, and check it every shift from October to May.

**6.2 Low loop temperature or circulation pump trouble.** If return water falls below 40°F: check that the circulation pump is running, and switch to the standby pump if it isn't. Check the boiler and reset it if it has faulted. Check heat-add settings. Recheck the temperature after 1 hour.

**6.3 Frozen sample lines and false readings.** A frozen or blocked sample line can make instruments show a "perfect" reading that never changes. Thaw the line with the heat trace or a heat gun (never an open flame), let it flush for 10 minutes, and confirm with bench tests.

**6.4 Frozen mains or loss of circulation.** If any part of the loop stops circulating for more than 2 hours in below-freezing weather, or a line is frozen or broken, contact the RMW immediately. Check distribution pressure (Section 7.4).

## 7. Pump Failures

**7.1 Pumps at this plant.** Raw water pumps (duty and standby), high-service pumps (duty and standby), circulation pumps (duty and standby), and chemical feed pumps for hypochlorite, soda ash, and PACl (each with a spare on the shelf).

**7.2 Pump won't run.** Switch to the standby pump first. Then check the breaker, the motor overload, the float or pressure switch, and the alarm panel, and reset if tripped. If a breaker trips again right after being reset, leave it off and contact the RMW. If both duty and standby pumps fail, contact the RMW immediately.

**7.3 Chemical feed pump loss of prime.** Signs: chlorine or pH dropping while the day tank level stays the same. Open the bleed valve and run the pump until a steady stream of solution comes out with no bubbles. Check the foot valve and suction line for air leaks or crystals. If prime is lost again within a week, replace the check valves with the spare kit.

**7.4 Low distribution pressure.** Normal pressure is 40–60 psi. Below 35 psi: check the high-service pumps (Section 7.2) and look for leaks or main breaks. Below 20 psi anywhere in the system, germs can be pulled into the pipes. This is a boil-water notice trigger (Section 8.2).

**7.5 After a power outage.** Before sending water to the clearwell, restart each filter with filter-to-waste (Section 2.3, step 3). Confirm that the chemical feed pumps restarted, and check chlorine and turbidity within 1 hour.

## 8. Getting Help: RMW and Boil-Water Notices

**8.1 Contact the Remote Maintenance Worker (RMW) when:** chlorine is below 0.2 or above 4.0 mg/L; filtered turbidity is above 1.0 NTU, or above 0.3 NTU after two backwashes; pH is below 6.5 or above 8.5; distribution pressure is below 20 psi; circulation has been lost for more than 2 hours or a line is frozen; both duty and standby pumps have failed; **the same problem has happened 3 or more times in 30 days, even if you fixed it each time**; or you are unsure whether a problem could affect health. When in doubt, call. The RMW and ADEC contact numbers are on the contact sheet by the control panel.

**8.2 Boil-water notice triggers.** Turbidity above 1.0 NTU; chlorine below 0.2 mg/L for more than 4 hours; pressure below 20 psi; a main break; or a positive E. coli sample.

**8.3 Issuing a boil-water notice.** Contact the RMW and ADEC first. They will decide whether a notice is needed and help with the wording. If a trigger in 8.2 has happened and you cannot reach either of them within 2 hours, issue a precautionary notice yourself. Post it at the washeteria, school, clinic, store, and post office, and announce it on the village VHF channel. A Tier 1 public notice must go out within 24 hours. Keep the notice in place until ADEC says to lift it.
