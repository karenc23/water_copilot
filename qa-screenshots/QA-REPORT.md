| Area | Button / flow | Viewport | Result | Note |
| --- | --- | --- | --- | --- |
| Layout | /troubleshoot | laptop | ✅ |  |
| Layout | /dashboard | laptop | ✅ |  |
| Layout | /readings | laptop | ✅ |  |
| Layout | /logbook | laptop | ✅ |  |
| Layout | /handoff | laptop | ✅ |  |
| Layout | /results | laptop | ✅ |  |
| Layout | /evolution | laptop | ✅ |  |
| Story | progress dots shown | laptop | ✅ |  |
| Story | scene holds ≥ 8 s (reading speed + 5 s hold) | laptop | ✅ |  |
| Story | → arrow advances to scene 2 | laptop | ✅ |  |
| Story | space advances to the team | laptop | ✅ |  |
| Story | agent intros ≈ 1.5 s each | laptop | ✅ | 1493 ms |
| Story | click advances | laptop | ✅ | Keeper → Diagnostician |
| Layout | / story | laptop | ✅ |  |
| Story | Enter → /troubleshoot | laptop | ✅ |  |
| Story | Skip intro → /troubleshoot | laptop | ✅ |  |
| Click /troubleshoot | tab “Operator view” | laptop | ✅ |  |
| Click /troubleshoot | tab “See the agents think” | laptop | ✅ | already the active tab (tested via switching in flows) |
| Click /troubleshoot | button “Wake the agents” | laptop | ✅ |  |
| Click /troubleshoot | button “Water looks cloudy and chlorine reading is lower than yester” | laptop | ✅ |  |
| Click /troubleshoot | button “Second backwash today and the filter still won’t clear” | laptop | ✅ |  |
| Click /dashboard | link “Ask the agents →” | laptop | ✅ | → /troubleshoot |
| Click /dashboard | link “Ask the agents what to do →” | laptop | ✅ | → /troubleshoot |
| Click /dashboard | link “All readings” | laptop | ✅ | → /readings |
| Click /dashboard | link “All entries” | laptop | ✅ | → /logbook |
| Click /logbook | checkbox “Escalated only” | laptop | ✅ |  |
| Click /handoff | button “Generate handbook for new operator” | laptop | ✅ |  |
| Click /results | link “Watch the agents evolve →” | laptop | ✅ | → /evolution |
| Click /results | link “Compare the runs →” | laptop | ✅ | → /evolution |
| Click /results | summary “Show as a table” | laptop | ✅ |  |
| Click /results | summary “Round 0 1 strategy best 82%” | laptop | ✅ |  |
| Click /results | summary “Round 1 3 strategies best 85%” | laptop | ✅ |  |
| Click /results | summary “Round 2 3 strategies best 91%” | laptop | ✅ |  |
| Click /results | summary “Round 3 3 strategies best 91%” | laptop | ✅ |  |
| Click /results | summary “Show prompt” | laptop | ✅ |  |
| Click /evolution | button “Pause” | laptop | ✅ |  |
| Click /evolution | button “Restart” | laptop | ✅ |  |
| Click /evolution | button “Jump to the end” | laptop | ✅ |  |
| Troubleshoot · Agent view | example 1: stream finishes, answer card slides in | laptop | ✅ |  |
| Troubleshoot · Agent view | example 1: narration feed filled | laptop | ✅ | 12 bubbles |
| Layout | /troubleshoot agents ex1 | laptop | ✅ |  |
| Troubleshoot · Agent view | example 2: stream finishes, answer card slides in | laptop | ✅ |  |
| Troubleshoot · Agent view | example 2: narration feed filled | laptop | ✅ | 12 bubbles |
| Troubleshoot · Agent view | Replay re-runs the trace | laptop | ✅ |  |
| Troubleshoot · Agent view | Courier drafts (no “sent” claim, no fly-off) | laptop | ✅ |  |
| Troubleshoot · Agent view | “Draft message to expert” opens an editable draft | laptop | ✅ |  |
| Troubleshoot · Agent view | Copy (includes edits) | laptop | ✅ |  |
| Troubleshoot · Agent view | Download .txt | laptop | ✅ | escalation-plant-a-2026-10-11.txt |
| Troubleshoot · Agent view | Open in email (mailto with subject + body) | laptop | ✅ | mailto:?subject=Water Copilot escalation · plant-a · tier RED · F3 Per |
| Layout | /troubleshoot agents ex2 | laptop | ✅ |  |
| Troubleshoot · Operator view | example 1: diagnosis returned | laptop | ✅ |  |
| Layout | /troubleshoot operator ex1 | laptop | ✅ |  |
| Troubleshoot · Operator view | example 2: diagnosis returned | laptop | ✅ |  |
| Troubleshoot · Operator view | “Draft message to expert” opens an editable draft | laptop | ✅ |  |
| Troubleshoot · Operator view | Copy (includes edits) | laptop | ✅ |  |
| Troubleshoot · Operator view | Download .txt | laptop | ✅ | escalation-plant-a-2026-10-11.txt |
| Troubleshoot · Operator view | Open in email (mailto with subject + body) | laptop | ✅ | mailto:?subject=Water Copilot escalation · plant-a · tier RED · F3 Per |
| Layout | /troubleshoot operator ex2 | laptop | ✅ |  |
| Errors | Agent view: empty submit shows a friendly hint | laptop | ✅ |  |
| Errors | Operator view: empty submit shows a friendly hint | laptop | ✅ |  |
| Errors | Agent view: API error → friendly message | laptop | ✅ |  |
| Errors | Operator view: API error → friendly message | laptop | ✅ |  |
| Errors | Handoff: API error → friendly message | laptop | ✅ |  |
| Errors | Save to logbook: missing fields → friendly message | laptop | ✅ |  |
| Errors | Save to logbook: database error → friendly message | laptop | ✅ |  |
| Save to logbook | “Start from the recommended steps” fills the steps | laptop | ✅ |  |
| Save to logbook | entry saved (POST /api/logs → MongoDB) | laptop | ✅ |  |
| Save to logbook | entry appears in the Logbook | laptop | ✅ |  |
| Save to logbook | Keeper recalls the saved incident on the next question | laptop | ✅ |  |
| Logbook | search “filter 2” narrows the list | laptop | ✅ | 5 of 9 entries |
| Logbook | “Escalated only” shows only escalated entries | laptop | ✅ | 2 of 9 entries (2/2 badged) |
| Logbook | no-match search shows an empty state | laptop | ✅ |  |
| Handoff | handbook generated | laptop | ✅ |  |
| Save to logbook | saved entry appears in a newly generated handbook | laptop | ✅ | cites 2026-10-11 |
| Handoff | Copy text | laptop | ✅ |  |
| Handoff | Print opens the print dialog | laptop | ✅ |  |
| Layout | /handoff with handbook | laptop | ✅ |  |
| Evolution | Pause holds the animation | laptop | ✅ |  |
| Evolution | Play resumes | laptop | ✅ |  |
| Evolution | Jump to the end shows the test comparison | laptop | ✅ |  |
| Evolution | round details: “What I changed and why” + hit rate | laptop | ✅ |  |
| Evolution | clicking an orb shows its full prompt | laptop | ✅ |  |
| Evolution | Escape closes the prompt | laptop | ✅ |  |
| Evolution | Restart goes back to round 0 | laptop | ✅ |  |
| Evolution | Parallel vs single agent panel (from results.json) | laptop | ✅ |  |
| Evolution | Explorer hypothesis + lane + targets shown | laptop | ✅ |  |
| Navigation | sidebar order: Troubleshoot · Plant Status · Plant Memory · Handoff Guide · Proof · Agent Evolution | laptop | ✅ | Troubleshoot · Plant Status · Plant Memory · Handoff Guide · Proof · Agent Evolution |
| Navigation | /troubleshoot heading “Troubleshoot” + subtitle | laptop | ✅ | Describe the problem, and watch the agents work it out. |
| Navigation | /dashboard heading “Plant Status” + subtitle | laptop | ✅ | Today’s readings and alerts, reported by the Sentinel · late |
| Navigation | /logbook heading “Plant Memory” + subtitle | laptop | ✅ | Every problem and fix, kept by the Keeper. |
| Navigation | /handoff heading “Handoff Guide” + subtitle | laptop | ✅ | The Keeper writes down what a new operator needs to know. |
| Navigation | /results heading “Proof” + subtitle | laptop | ✅ | How much the agents improved on scenarios they never saw. |
| Navigation | /evolution heading “Agent Evolution” + subtitle | laptop | ✅ | The Critic studies failures, Explorers try fixes, the Judge  |
| Navigation | Plant Status → All readings (/readings), Plant Status stays active | laptop | ✅ |  |
| Navigation | sidebar link from every page to every page (7×6) + back button | laptop | ✅ |  |
| Navigation | logo → story intro | laptop | ✅ |  |
| Navigation | unknown route → 404 page | laptop | ✅ |  |
| Layout | /troubleshoot | ipad | ✅ |  |
| Layout | /dashboard | ipad | ✅ |  |
| Layout | /readings | ipad | ✅ |  |
| Layout | /logbook | ipad | ✅ |  |
| Layout | /handoff | ipad | ✅ |  |
| Layout | /results | ipad | ✅ |  |
| Layout | /evolution | ipad | ✅ |  |
| Story | progress dots shown | ipad | ✅ |  |
| Story | scene holds ≥ 8 s (reading speed + 5 s hold) | ipad | ✅ |  |
| Story | → arrow advances to scene 2 | ipad | ✅ |  |
| Story | space advances to the team | ipad | ✅ |  |
| Story | agent intros ≈ 1.5 s each | ipad | ✅ | 1499 ms |
| Story | click advances | ipad | ✅ | Keeper → Diagnostician |
| Layout | / story | ipad | ✅ |  |
| Story | Enter → /troubleshoot | ipad | ✅ |  |
| Story | Skip intro → /troubleshoot | ipad | ✅ |  |
| Click /troubleshoot | tab “Operator view” | ipad | ✅ |  |
| Click /troubleshoot | tab “See the agents think” | ipad | ✅ | already the active tab (tested via switching in flows) |
| Click /troubleshoot | button “Wake the agents” | ipad | ✅ |  |
| Click /troubleshoot | button “Water looks cloudy and chlorine reading is lower than yester” | ipad | ✅ |  |
| Click /troubleshoot | button “Second backwash today and the filter still won’t clear” | ipad | ✅ |  |
| Click /dashboard | link “Ask the agents →” | ipad | ✅ | → /troubleshoot |
| Click /dashboard | link “Ask the agents what to do →” | ipad | ✅ | → /troubleshoot |
| Click /dashboard | link “All readings” | ipad | ✅ | → /readings |
| Click /dashboard | link “All entries” | ipad | ✅ | → /logbook |
| Click /logbook | checkbox “Escalated only” | ipad | ✅ |  |
| Click /handoff | button “Generate handbook for new operator” | ipad | ✅ |  |
| Click /results | link “Watch the agents evolve →” | ipad | ✅ | → /evolution |
| Click /results | link “Compare the runs →” | ipad | ✅ | → /evolution |
| Click /results | summary “Show as a table” | ipad | ✅ |  |
| Click /results | summary “Round 0 1 strategy best 82%” | ipad | ✅ |  |
| Click /results | summary “Round 1 3 strategies best 85%” | ipad | ✅ |  |
| Click /results | summary “Round 2 3 strategies best 91%” | ipad | ✅ |  |
| Click /results | summary “Round 3 3 strategies best 91%” | ipad | ✅ |  |
| Click /results | summary “Show prompt” | ipad | ✅ |  |
| Click /evolution | button “Pause” | ipad | ✅ |  |
| Click /evolution | button “Restart” | ipad | ✅ |  |
| Click /evolution | button “Jump to the end” | ipad | ✅ |  |
| Troubleshoot · Agent view | example 1: stream finishes, answer card slides in | ipad | ✅ |  |
| Troubleshoot · Agent view | example 1: narration feed filled | ipad | ✅ | 12 bubbles |
| Layout | /troubleshoot agents ex1 | ipad | ✅ |  |
| Troubleshoot · Agent view | example 2: stream finishes, answer card slides in | ipad | ✅ |  |
| Troubleshoot · Agent view | example 2: narration feed filled | ipad | ✅ | 12 bubbles |
| Troubleshoot · Agent view | Replay re-runs the trace | ipad | ✅ |  |
| Troubleshoot · Agent view | Courier drafts (no “sent” claim, no fly-off) | ipad | ✅ |  |
| Troubleshoot · Agent view | “Draft message to expert” opens an editable draft | ipad | ✅ |  |
| Troubleshoot · Agent view | Copy (includes edits) | ipad | ✅ |  |
| Troubleshoot · Agent view | Download .txt | ipad | ✅ | escalation-plant-a-2026-10-11.txt |
| Troubleshoot · Agent view | Open in email (mailto with subject + body) | ipad | ✅ | mailto:?subject=Water Copilot escalation · plant-a · tier RED · F3 Per |
| Layout | /troubleshoot agents ex2 | ipad | ✅ |  |
| Troubleshoot · Operator view | example 1: diagnosis returned | ipad | ✅ |  |
| Layout | /troubleshoot operator ex1 | ipad | ✅ |  |
| Troubleshoot · Operator view | example 2: diagnosis returned | ipad | ✅ |  |
| Troubleshoot · Operator view | “Draft message to expert” opens an editable draft | ipad | ✅ |  |
| Troubleshoot · Operator view | Copy (includes edits) | ipad | ✅ |  |
| Troubleshoot · Operator view | Download .txt | ipad | ✅ | escalation-plant-a-2026-10-11.txt |
| Troubleshoot · Operator view | Open in email (mailto with subject + body) | ipad | ✅ | mailto:?subject=Water Copilot escalation · plant-a · tier RED · F3 Per |
| Layout | /troubleshoot operator ex2 | ipad | ✅ |  |
| Errors | Agent view: empty submit shows a friendly hint | ipad | ✅ |  |
| Errors | Operator view: empty submit shows a friendly hint | ipad | ✅ |  |
| Errors | Agent view: API error → friendly message | ipad | ✅ |  |
| Errors | Operator view: API error → friendly message | ipad | ✅ |  |
| Errors | Handoff: API error → friendly message | ipad | ✅ |  |
| Errors | Save to logbook: missing fields → friendly message | ipad | ✅ |  |
| Errors | Save to logbook: database error → friendly message | ipad | ✅ |  |
| Evolution | Pause holds the animation | ipad | ✅ |  |
| Evolution | Play resumes | ipad | ✅ |  |
| Evolution | Jump to the end shows the test comparison | ipad | ✅ |  |
| Evolution | round details: “What I changed and why” + hit rate | ipad | ✅ |  |
| Evolution | clicking an orb shows its full prompt | ipad | ✅ |  |
| Evolution | Escape closes the prompt | ipad | ✅ |  |
| Evolution | Restart goes back to round 0 | ipad | ✅ |  |
| Evolution | Parallel vs single agent panel (from results.json) | ipad | ✅ |  |
| Evolution | Explorer hypothesis + lane + targets shown | ipad | ✅ |  |
| Navigation | sidebar order: Troubleshoot · Plant Status · Plant Memory · Handoff Guide · Proof · Agent Evolution | ipad | ✅ | Troubleshoot · Plant Status · Plant Memory · Handoff Guide · Proof · Agent Evolution |
| Navigation | /troubleshoot heading “Troubleshoot” + subtitle | ipad | ✅ | Describe the problem, and watch the agents work it out. |
| Navigation | /dashboard heading “Plant Status” + subtitle | ipad | ✅ | Today’s readings and alerts, reported by the Sentinel · late |
| Navigation | /logbook heading “Plant Memory” + subtitle | ipad | ✅ | Every problem and fix, kept by the Keeper. |
| Navigation | /handoff heading “Handoff Guide” + subtitle | ipad | ✅ | The Keeper writes down what a new operator needs to know. |
| Navigation | /results heading “Proof” + subtitle | ipad | ✅ | How much the agents improved on scenarios they never saw. |
| Navigation | /evolution heading “Agent Evolution” + subtitle | ipad | ✅ | The Critic studies failures, Explorers try fixes, the Judge  |
| Navigation | Plant Status → All readings (/readings), Plant Status stays active | ipad | ✅ |  |
| Navigation | sidebar link from every page to every page (7×6) + back button | ipad | ✅ |  |
| Navigation | logo → story intro | ipad | ✅ |  |
| Navigation | unknown route → 404 page | ipad | ✅ |  |

## Console / network problems
none
