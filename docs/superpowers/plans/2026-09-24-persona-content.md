# Persona Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every seed profile's posts and comments consistent with its fixed age, gender, interests, and temperament, without stock replies crossing profiles.

**Architecture:** Reuse `marketing/profile-personas.json` as the character roster. Assign a named seed author before a post is written, publish only that author, and remove automatic stock comments. Audit and repair existing seed content from a read-only snapshot; never alter member-authored content.

**Tech Stack:** Bash, jq, PostgreSQL, Node test runner.

**Spec:** `marketing/profile-personas.md` and the owner's 2026-09-24 approval in chat.

## Global Constraints

- No new dependency, schema change, app build, or store submission.
- Preserve member-authored posts and comments.
- Back up every production row before changing or removing it.
- A seed comment on a member post needs a relevant, reviewed reply; no automatic quotas.

---

### Task 1: Stop stock text and bind authors

**Files:** `scripts/seed-city-posts.sh`, `scripts/seed-city-posts.test.mjs`, `docs/operations/daily-city-posts.md`

- [x] Add a failing check that an explicit author is required and no stock comment SQL is generated.
- [x] Replace the dynamic author picker with a city-matched, active seed profile lookup; fail the transaction if an author is missing or ambiguous.
- [x] Remove automatic comment and reply insertion. Publish only reviewed post copy.
- [x] Run the focused script test and dry-run SQL check.
- [x] Copy the validated script to the launchd staging location.

### Task 2: Review existing content

**Files:** private snapshot under `~/Library/Application Support/gling/persona-audit/2026-09-24/`, review report in `content/2026-09-24/`

- [x] Inventory every seed post and comment by author; flag exact repeats, shared openings, style mismatch, irrelevant questions, and replies to member posts.
- [ ] Review flagged records in thread context and record a keep/rewrite/remove decision per row.
- [ ] Prepare guarded SQL changes from the snapshot, with row IDs and original text checks.
- [ ] Apply only reviewed changes to seed-authored rows and verify counts and samples.

Completed 2026-09-24: reviewed and hid 1,526 stock comments on seed posts and one malformed stock comment on a member post; retained two comments with member replies. Rewrote the 25 newest seed posts with exact old-body guards and added five individually reviewed comments. The pre-change review CSV still identifies older post candidates for editorial review.

### Task 3: Future copy workflow

**Files:** `content/<date>/posts.json`, `docs/operations/daily-city-posts.md`

- [ ] Select each author from the roster before drafting; compare with that profile's history.
- [x] Write and review any replies individually, in context, without a minimum comment count.
- [x] Confirm a dry run has no member-post comment path or generic response library.
