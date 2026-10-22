# App activity monitoring

Owner enabled monitoring on 2026-10-14. The existing central automation
`92b09c63-2356-4d58-970b-830f541a0483` owns delivery; no second recurring job is needed.

Postgres triggers capture new and meaningfully changed posts, comments, private/group
messages, conversations and meetup requests into `private.gling_activity_events` in
the source transaction. A rolled-back source transaction leaves no event. The feed
contains IDs, event types and timestamps, without titles, bodies or contact details.
Counter/read-state changes are ignored. Operated, seed, admin and test actors remain
observable but do not start reaction AI turns.

The existing central job checks every minute with
`python3 marketing/app_activity_precheck.py check` (55-second precheck timeout).
This is immediate server capture with minute delivery checks, not a promise of
instant AI responses. A busy/offline supervisor leaves server events pending.
The original minute-00/30 supervision and morning report still run; idle event
checks exit 3 without starting AI. Existing publishing/view and safety jobs retain
their schedules.

The connector leases one batch for ten minutes. It saves private, atomic tickets
under `~/Library/Application Support/gling/operations/automation-manager/app-activity`.
Expired work can be reclaimed without dropping late-committing rows. Batch UUID
tombstones prevent an old ACK from acknowledging a new delivery; delivered event
metadata has 30-day retention. Empty checks do not create batch tombstones.

After saving a JSON assessment containing the exact `batch_id`, every
`handled_event_ids` value and `outcome: "reviewed"`, the central owner runs:

```sh
python3 marketing/app_activity_precheck.py ack --batch ACTUAL_UUID --report ACTUAL_ASSESSMENT_JSON
```

The connector saves the assessment hash before ACK and records the returned count.
Reading a ticket alone is not acknowledgement. A zero count is not evidence that a
re-leased batch was handled. A failed check or ACK leaves retry evidence intact.

ADR-0001 remains in force: existing server safety monitoring covers all content;
admin content reads require the existing AAL2 session and audited RPCs. A missing
or expired AI admin connection means `auth_required`, not permission to use SQL or
service credentials to read conversation bodies. Monitoring does not itself permit
new comments, likes, DMs, meetup acceptance or moderation actions.

Checks:

```sh
python3 -m unittest discover -s marketing -p 'test_*precheck.py'
python3 ../output/reviews/app-monitoring-2026-10-14/db/test_outbox.py
```

The second command uses disposable databases in the already-running local
Postgres container. It never connects to production. Installation, native readback,
private probe and runtime receipts are kept in the same dated review directory.

Rollback: restore the prior central prompt, schedule and precheck from the saved
native snapshot; drop only the five `*_activity_monitor` triggers. Keep the private
outbox and receipts for pending-work recovery. Do not change existing safety,
notifications or publication triggers.
