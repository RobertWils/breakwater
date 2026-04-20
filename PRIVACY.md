# Breakwater Privacy Notice

**Last updated: 2026-04-20**

This notice describes what Breakwater stores, why, for how long, and how to contact us. It covers the pre-prototype and Plan 01 scaffold. It will be superseded by a full privacy policy before any public launch.

## What we store

- **`ipHash`** — SHA-256 of your IP address plus a server-side salt. The raw IP is never written to the database.
- **`emailHash`** — SHA-256 of your lowercased email plus a separate server-side salt. Used to match anonymous scans to your account after you sign in.
- **Scan metadata** — chain, contract addresses, domain, submission timestamp, user agent. Required to run and display a scan.
- **Findings** — the output of our four scanning modules (governance, oracle, signer, frontend).
- **Optional plaintext email (`submittedEmail`)** — if you provide your email on the results page to unlock findings. Stored temporarily so we can deliver the magic-link email and link your account to the scan when you sign in.

We do **not** store full contract source code, your raw IP address, or any browser fingerprint beyond the user-agent string.

## Why we store it

- **Rate limiting and abuse protection** — `ipHash` prevents abuse of free scans without exposing raw IPs.
- **Account linking** — `emailHash` (and temporarily `submittedEmail`) lets us connect scans you ran anonymously to your account when you sign in via magic link.
- **Service delivery** — scan metadata and findings are the product itself.
- **Audit and transparency** — scan attempts (including rejected ones) are logged so we can diagnose issues and show you a history of what was scanned.

## How long we keep it

| Data | Retention |
| --- | --- |
| Scan metadata and findings | 30 days active, then flipped to `EXPIRED`. The record is kept for audit; the public grade is no longer current. |
| Plaintext `submittedEmail` on anonymous scans | Nulled after 90 days if you never signed in (only the hash is kept). |
| `ipHash` on `ScanAttempt` records | Retained indefinitely in Plan 01 for rate-limit and analytics. This retention policy will be reconsidered in Plan 07. |
| Account data (once signed in) | Retained while your account is active. |

## Your rights

Under GDPR/AVG, you have the right to access, export, and delete your personal data. Full self-serve data export and deletion endpoints are on the roadmap for the paid tier. In the meantime, you can request data access or deletion by emailing us (see below) and we will respond within 30 days.

We do not sell personal data. We do not share personal data with third parties except for the service providers we use to operate Breakwater (Vercel, Railway, Resend). Each of these providers operates under its own data-processing terms.

## Contact

Privacy and security questions: **security@breakwater.xyz** (domain and mailbox confirmation pending — if this address bounces, contact Singularity Venture Hub directly).

Breakwater is a venture of Singularity Venture Hub under Intellistake.

## Changes to this notice

Material changes will be reflected in the "Last updated" date at the top of this file. The repository's git history provides a full audit trail of earlier versions.
