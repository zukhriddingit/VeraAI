# Founder-release resource assumptions

The release intentionally optimizes for operational simplicity rather than horizontal scale:

- one externally hosted Vera web instance;
- one managed PostgreSQL database in the same selected region when providers permit;
- one private serverless Maritime Vera worker with a 120-second idle window and a five-minute reconciliation trigger;
- one always-on Maritime OpenClaw gateway for the founder;
- one local founder browser node/profile;
- no Redis, replica, sharding, Kubernetes, or multi-region failover.

The always-on gateway is the dominant Maritime compute assumption; the worker should sleep when no trigger or explicit dispatch is active. Gmail polling is five-minute and bounded. Browser work is not scheduled. Web Push payloads are small and generic.

Before each release, record current Maritime compute/credit pricing, managed PostgreSQL storage/backup pricing, hosted web pricing, and Web Push provider limits in the operator change ticket. Do not encode a dollar estimate here because platform rates are external and can change independently of the repository.

Set billing alerts and a hard founder budget in the provider dashboards. A cost alarm must stop optional schedules and browser experiments before it weakens persistence, audit, or kill-switch enforcement.
