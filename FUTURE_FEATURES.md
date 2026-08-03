# Future Features

Ideas from the initial brainstorm that are **out of scope for v1** but worth building later.
V1 scope is: job aggregator + tracker with LLM fit-scoring, plus resume/cover-letter tailoring.

## 1. Application autopilot dashboard (daily digest)

A morning digest — delivered by email or shown on app launch — that surfaces:

- New matching jobs found overnight (above a fit-score threshold)
- Applications with no response in 2+ weeks, flagged for follow-up
- Upcoming interviews
- Contacts worth pinging

Builds directly on the v1 tracker data, so this is the most natural next step.
Could run as a scheduled job (cron / launchd) that scrapes sources and emails the digest.

## 2. Interview prep tool

Given a company + role (ideally linked from a tracked application):

- Compile recent company news and context
- Generate likely interview questions for that specific role
- Run mock Q&A sessions with LLM critique of answers

Trigger idea: automatically offer prep when an application moves to "interviewing" status.

## 3. Network mapper (warm intros)

Cross-reference target companies against LinkedIn connections / alumni network to
surface warm-introduction paths. Referrals convert far better than cold applications.

Caveat: LinkedIn blocks scraping — likely needs a manual CSV export of connections
(LinkedIn provides this via Settings → Data Privacy → Get a copy of your data).

## Smaller enhancements to v1

- **More sources**: HN "Who's Hiring" monthly threads, Remotive, WeWorkRemotely,
  niche boards per field; company Greenhouse/Lever/Ashby boards for target companies
- **ATS keyword report**: show which keywords from the posting are missing from the
  tailored resume (helps pass automated resume screeners)
- **Follow-up templates**: LLM-drafted follow-up emails per pipeline stage
- **Salary tracking**: record posted/discussed comp per application, compare across pipeline
- **Analytics**: response rate by source, fit-score vs. response correlation, time-in-stage

## Known constraints (from brainstorm)

- LinkedIn and Indeed actively block scraping — prefer official feeds, RSS, and
  scrape-friendly boards (HN, Remotive, Greenhouse/Lever public postings)
- Fit-scoring and tailoring use the Claude API — requires an API key and per-call cost
