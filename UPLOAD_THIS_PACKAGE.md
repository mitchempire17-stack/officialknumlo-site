# KNUMLO: complete existing-site update (Netlify + GitHub)

This ZIP is the entire GitHub repository root. It is **not** a Netlify manual drag-and-drop asset. It includes serverless functions and must be built from the existing GitHub-linked Netlify site.

## Simplest upload
1. Download the current GitHub repository first as a backup. Back up the production PostgreSQL database separately; a GitHub download does not contain member/payment records.
2. Open the existing repository locally with GitHub Desktop, and select a NEW branch `knumlo-complete-notifications` from the branch Netlify deploys.
3. Extract this ZIP into the **local repository root**, preserving the `.github`, `database`, `netlify`, `site` folders and all files. Replace existing source files with those from this ZIP. DO NOT delete the `.git` directory, and do not put the extracted contents inside another folder.
4. In GitHub Desktop commit the changes and publish the branch. Open a pull request; check the Netlify Deploy Preview. This branch must NOT be assigned your production database or live SMS keys.
5. After review, merge the pull request. Your already linked Netlify site will deploy the full updated build automatically. Do not create a second Netlify site.

## Automatic database install
- On the first production API request (or notification scheduled function), `notification-bootstrap.js` checks whether migration `notification-schema-v2` has run, adds the missing `rejected` membership enum value, creates opt-out, SMS templates, outbox, and message triggers; stores completion in `knumlo_schema_migrations`. It is idempotent and does not reset existing member, password, payment, admin or invoice records.
- Database credentials must already exist and have permission to ALTER TYPE member_status and CREATE TABLE/FUNCTION/TRIGGER. A backup is required before production changes. If migration cannot run, the original API keeps serving, but SMS features are not ready. Check function logs.
- Preview context deliberately skips database migration to protect the live database. Use a separate test environment for end-to-end pre-production SMS and database validation.
- The new SQL scripts are bundled as JavaScript for Netlify; no separate SQL-upload workflow is required.

## SMS launch checklist
Keep `AUTO_SMS_ENABLED=false` and `REMINDERS=off` until verified provider credentials and approved Sender ID are configured. Netlify environment variables: `SMS_PROVIDER=africastalking`, `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID=KNUMLO`, `AT_ENV=production` and existing `DATABASE_URL`, `PGSSL`, `JWT_SECRET` untouched. **Do not commit secrets to GitHub.**
- SMS queue triggers only on **future** member registrations, approvals, rejections, password changes, and verified completed payments; no retroactive broadcast to the uploaded member population.
- Confirm the SMS templates and valid member mobile numbers, delivery costs and opt-out records before enabling. A queue is not proof of handset delivery.
- The `KNUMLO` Sender ID MUST be approved by the SMS provider.
- After approved bank and Paybill details are supplied and confirmed, set real `PAYBILL_NUMBER` and `REMINDERS=on` to enable dues notices/reminders, then redeploy.
- Bank transfers are acknowledged only once an authorised operator records them as completed; no bank feed is connected.
- Netlify scheduled functions require a plan supporting scheduled functions; verify their execution logs.

## Post-deployment validation
1. Open `/api/health` and confirm current portal and logins work.
2. Inspect Netlify function logs for schema migration success or errors. Confirm `knumlo_schema_migrations` has `notification-schema-v2` and `sms_outbox` exists.
3. With your own authorised test phone and a TEST environment, create a member, approve/reject sample applicants, record a completed test payment; validate that outbox entries are accurate and nonduplicate.
4. Make one real test SMS using your own number, enable automated sending only once verified.

**Caution:** No live Netlify account, running PostgreSQL data, SMS provider, or payment callbacks were accessible for integration testing. Do not describe this as live-verified or automatically sending messages yet.
