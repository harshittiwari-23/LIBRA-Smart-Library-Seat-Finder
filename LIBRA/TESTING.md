# LIBRA — hackathon judge test checklist

**Execute these scenarios after deploying to an actual Firebase project.** The checked results below are procedures and *expected* outcomes, **not claims that cloud tests have been run**.

Use two Chrome profiles: **Student A** and **Student B**. Use a third profile for **Admin**. In admin settings, keep the QR print sheet available. Track timestamps on both browser screens and Firestore to measure latency. Each scenario should be executed on real deployed code.

| # | Test scenario | Actions | Expected verified result |
|---|---|---|---|
| 1 | Simultaneous booking | A and B choose F1-S01; click Reserve almost simultaneously. | Exactly one succeeds. The loser sees an error. One active booking exists for that seat. |
| 2 | Already occupied | A checks in to F1-S01; B attempts to reserve it. | B cannot reserve an occupied seat; backend blocks stale clicks. |
| 3 | Invalid QR | A reserves F1-S02, then scans a code for F1-S03 or types nonsense. | Server rejects invalid format, wrong seat, or wrong token; occupancy remains RESERVED. |
| 4 | Refresh during break | A checks in, starts break, waits 1 minute, then refreshes. | Break status and remaining time rehydrate using stored deadline, not a reset 20-minute timer. |
| 5 | Break expiry | A starts break and does not return for 20 minutes. | Queue task eventually marks seat AVAILABLE, deletes active booking and logs `break-expired`; fallback job handles delayed/missing tasks. Measure dispatch delay. |
| 6 | Return before expiry | A scans the same seat QR during break. | Server marks OCCUPIED, logs a returned break session and stale expiry task does nothing. |
| 7 | Different simultaneous seats | A reserves F1-S01 while B reserves F2-S01. | Both can succeed; unrelated seats do not block one another. |
| 8 | Internet disconnect | In DevTools toggle Offline, attempt booking, then restore connection. | Booking is rejected locally while offline; cached map warning appears; sync reconnects. |
| 9 | Unauthorized admin | Student B opens `admin.html` and directly queries `seatSecrets` or `bookings` Firestore. | Redirect to dashboard. Rules deny admin-only data; even browser edits cannot obtain claim. |
| 10 | Multi-device live map | A reserves, checks in, starts break, and cancels while B and Admin watch. | All connected viewers update after Firestore emits snapshots. Record actual latencies; 5 seconds is a goal, not an SLA. |

## Extra critical checks

- A tries to reserve F1-S01 then F1-S02. The second booking must be rejected by the `activeBookings/{uid}` transaction lock.
- A books and does not scan the QR. After 10 minutes the reservation is released.
- Student A scans an old code after cancellation. The server rejects it because there is no valid active booking.
- An attacker sends fake values or edits Firestore from DevTools: `seats` and `bookings` writes fail due to rules.
- Resetting / changing a device's clock affects only the cosmetic countdown, not server-side check-in expiry.
- Canceling an occupied booking records the final occupied duration and makes the seat available.

## Automated checks supplied

From the `functions` directory:

```powershell
npm test
```

The included Node unit tests verify QR parsing and token hash matching, expiry boundaries, and occupied-time accounting. They **do not** simulate the full real Firestore concurrency, Firebase rules, scanner camera or Cloud Tasks delivery. Those require the judge scenarios above or a separately configured Emulator Suite integration suite.

## Timing measurement sheet

| Test | Action at (hh:mm:ss) | Seen on other device at | Elapsed sec | Pass under 5 sec? |
|---|---|---|---|---|
| Reservation | | | | |
| QR check-in | | | | |
| Start break | | | | |
| Return | | | | |
| End session | | | | |
| 20-minute deadline release | | | | |

If expiry is delayed, state the delay and show the Cloud Tasks/Cloud Scheduler record; do not mark it as a five-second pass.
