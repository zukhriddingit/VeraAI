# Founder-release resource assumptions

The active `founder_core` profile intentionally optimizes for operational simplicity:

- one externally hosted authenticated Vera staging instance;
- one managed PostgreSQL database in the same selected region when providers permit;
- one private serverless Maritime Vera worker with a 120-second idle window and a five-minute
  reconciliation trigger;
- no OpenClaw gateway compute;
- no local browser-node connection;
- no browser monitoring schedule; and
- no Redis, replica, sharding, Kubernetes, or multi-region failover.

The worker should sleep when no trigger or explicit non-browser dispatch is active. Gmail polling is
five-minute and bounded. Web Push payloads are small and generic. Browser work remains disabled.

`founder_browser_experimental` would add gateway and node costs, but it is `no_go`; do not provision
or budget that runtime as part of core.

Before each release, record current Maritime compute/credit pricing, managed PostgreSQL
storage/backup pricing, hosted web pricing, and Web Push provider limits in the operator change
ticket. Do not encode a dollar estimate here because platform rates are external and can change
independently of the repository.

Set billing alerts and a hard founder budget in the provider dashboards. A cost alarm must stop
optional schedules before it weakens persistence, audit, or kill-switch enforcement.
