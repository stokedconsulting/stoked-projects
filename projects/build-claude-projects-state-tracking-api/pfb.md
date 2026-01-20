# Claude Projects State Tracking API

## 1. Feature Overview
**Feature Name:** Claude Projects State Tracking API
**Owner:** TBD
**Status:** Draft
**Target Release:** TBD - Complete when ready

### Summary
A backend API service that provides runtime state tracking for Claude AI project orchestration sessions running in VSCode. The API monitors active sessions through heartbeat mechanisms, detects crashes or stalled sessions, and enables automatic restart/recovery capabilities to ensure projects run to completion. This service complements GitHub Projects (the source of truth for work items) by focusing exclusively on runtime session state and health monitoring.

---

## 2. Problem Statement
### What problem are we solving?
Claude AI orchestration sessions running in VSCode can crash, stop unexpectedly, or stall without completion due to various factors (network issues, resource constraints, runtime errors, machine restarts). Currently, there is no mechanism to detect when a session has stopped running or to enable automatic recovery. This results in incomplete projects and manual intervention to restart work, losing valuable time and context.

### Who is affected?
- **Primary user:** Developers using the Claude VSCode extension for project orchestration who experience session crashes or interruptions
- **Secondary users:** Development team maintaining the orchestration system who need visibility into session health and failure patterns

### Why now?
As project orchestration becomes more complex and long-running, the frequency of incomplete sessions increases. Without state tracking and recovery mechanisms, user productivity suffers and confidence in the orchestration system declines. This is a foundational capability needed before scaling the orchestration system to handle more complex workflows.

---

## 3. Goals & Success Metrics
### Goals
- **Enable session crash detection:** Automatically detect when active orchestration sessions stop responding within configurable timeframes
- **Support automatic recovery:** Provide APIs that enable the VSCode extension to restart failed sessions from their last known state
- **Establish monitoring foundation:** Create infrastructure for tracking session health, machine assignments, and orchestration task progress
- **Ensure data reliability:** Maintain consistent, accurate state information that can be used for recovery decisions

### Success Metrics (How we'll know it worked)
- **Session recovery rate:** 90%+ of crashed sessions successfully detected and recoverable
- **Time to detect failure:** <5 minutes from last heartbeat to failure detection
- **API uptime:** 99.5%+ availability
- **State consistency:** Zero state corruption incidents during recovery operations
- **False positive rate:** <5% incorrect crash detections

---

## 4. User Experience & Scope
### In Scope
- **Session state tracking:** Record and update session ID, machine ID, current orchestration task, and last heartbeat timestamp
- **Project state management:** Track which projects are active, paused, completed, or failed
- **Task monitoring:** Monitor orchestration task status and progression within sessions
- **Health check endpoints:** Provide APIs for heartbeat updates and session health queries
- **Machine/slot tracking:** Track which docker slots/machines are running which sessions
- **Session query APIs:** Allow VSCode extension to query active sessions, detect stalls, and retrieve last known state
- **API key authentication:** Machine-to-machine authentication for VSCode extension access
- **Basic recovery support:** APIs to mark sessions as failed and clear session state for restart

### Out of Scope (Initial Version)
- **Real-time updates:** WebSocket or Server-Sent Events for live state updates (HTTP polling initially)
- **Conflict resolution:** Handling multiple machines trying to run the same project simultaneously
- **Full UI dashboard:** Web-based monitoring interface (VSCode extension UI only initially)
- **Advanced analytics:** Historical trends, performance metrics, or reporting beyond basic logging
- **Multi-region deployment:** Single-region deployment initially
- **Session replay:** Full session history or event log replay capabilities

---

## 5. Assumptions & Constraints
### Assumptions
- VSCode extension can reliably send heartbeats at regular intervals (e.g., every 30-60 seconds)
- GitHub Projects remains the authoritative source for work item definitions and status
- Sessions can be uniquely identified by combination of project ID + machine ID
- MongoDB Atlas has sufficient capacity for read/write operations at expected scale
- VSCode extension has network connectivity to reach claude-projects.truapi.com
- API key rotation and management will be handled externally (not built into this API)

### Constraints
- **Technical:** Must follow NestJS architecture patterns from ../v3/packages/api; MongoDB Atlas as database; SST for deployment
- **Infrastructure:** Single MongoDB Atlas database "claude-projects"; deploy to claude-projects.truapi.com domain
- **Authentication:** API key-based authentication only (no OAuth, no user sessions)
- **Deployment:** Must use `pnpm deploy:prod` workflow compatible with SST
- **Timeline:** No hard deadline - complete when ready, but should prioritize core functionality over advanced features
- **Resources:** Development resources constrained by other project priorities

---

## 6. Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Heartbeat interval too short causes excessive database writes | High - database overload, cost increase | Start with 60-second intervals; implement configurable intervals; add rate limiting per session |
| Session detection accuracy suffers from network blips | Medium - false positives trigger unnecessary restarts | Implement grace period (2-3 missed heartbeats) before marking as failed; add retry logic |
| MongoDB Atlas database unavailable during critical operations | High - state loss, recovery failure | Implement connection retry logic; use MongoDB Atlas multi-AZ deployment; add health check endpoints |
| SST deployment complexity delays launch | Medium - timeline impact | Reference v3/packages/api deployment configuration; allocate time for deployment testing; document deployment process |
| API keys compromised or leaked | High - unauthorized access | Implement API key rotation process; add request logging; rate limiting per API key; document security best practices |
| State corruption during concurrent updates | High - recovery failures | Use MongoDB transactions where appropriate; implement optimistic locking for state updates; add state validation |
| Insufficient database indexing causes slow queries | Medium - poor performance at scale | Design indexes upfront for common queries (session ID, machine ID, last heartbeat); monitor query performance |

---

## 7. Dependencies
### Team Dependencies
- Access to MongoDB Atlas account and credentials (via senvn)
- Access to domain configuration for claude-projects.truapi.com
- Coordination with VSCode extension development for API integration

### External Systems / Vendors
- **MongoDB Atlas:** Database hosting and management
- **SST (Serverless Stack):** Deployment and infrastructure management
- **AWS:** Underlying infrastructure for SST deployment (Lambda, API Gateway, etc.)
- **GitHub API:** Access to GitHub Projects data (read-only for reference)

### Data or Infrastructure Dependencies
- **v3/packages/api architecture:** Reference implementation for NestJS patterns, authentication, deployment configuration
- **senvn:** Environment variable and secret management
- **pnpm:** Package management and monorepo tooling
- **VSCode extension:** Client implementation for heartbeat sending and state queries

---

## 8. Open Questions
- **Heartbeat interval:** What is the optimal balance between detection speed and database load? (Proposed: 60 seconds, but needs validation)
- **Retry logic:** How many missed heartbeats before marking session as failed? (Proposed: 3 consecutive misses = 3 minutes)
- **Data retention policy:** How long should we retain completed/failed session data? (Proposed: 30 days for analytics, then archive/delete)
- **Rate limiting:** What are appropriate rate limits per API key to prevent abuse? (Proposed: 100 requests/minute per key)
- **Stale session cleanup:** Should we auto-cleanup sessions older than X hours with no heartbeat? (Proposed: 24 hours)
- **Restart behavior:** Should the API automatically trigger restarts or just provide state for extension to decide? (Proposed: extension decides)
- **Machine ID format:** How should machines be uniquely identified? (hostname? UUID? MAC address?)
- **Docker slot tracking:** What information needs to be tracked about docker slots? (slot number, resource limits, availability?)
- **Concurrent session handling:** Should we enforce one session per project, or allow multiple machines to work on different tasks?

---

## 9. Non-Goals
Explicitly state what success does **not** require:

- **Full-featured monitoring dashboard:** Success does not require a comprehensive web UI - VSCode extension integration is sufficient initially
- **Multi-region deployment:** Single region deployment is acceptable for initial version
- **Complex authentication systems:** OAuth, SAML, or multi-tenant authentication not required - API keys are sufficient
- **Real-time WebSocket support:** HTTP polling is acceptable for v1; real-time updates can be added later
- **Session analytics and reporting:** Historical analysis, dashboards, and trend reports are not required initially
- **Automated session restart:** The API only needs to support restart capability - actual restart orchestration handled by extension
- **Conflict resolution mechanisms:** Handling race conditions when multiple machines access same project is out of scope initially
- **Session event log:** Complete audit trail of all session events not required - only current state matters
- **Cross-project orchestration:** Tracking dependencies or relationships between projects not required
- **Performance optimization for 1000+ concurrent sessions:** Optimize for tens of concurrent sessions initially

---

## 10. Notes & References
### Reference Architecture
- **v3 API codebase:** `/Users/stoked/work/v3/packages/api/` - NestJS implementation patterns, authentication, deployment configuration
- **Current project location:** `/Users/stoked/work/claude-projects/`

### Technical Documentation
- **NestJS Documentation:** https://docs.nestjs.com/ - Framework reference
- **MongoDB Atlas:** https://www.mongodb.com/docs/atlas/ - Database setup and operations
- **SST Documentation:** https://docs.sst.dev/ - Deployment and infrastructure as code
- **GitHub Projects API:** https://docs.github.com/en/graphql/reference/objects#projectv2 - For reference integration

### Related Context
- Domain: `claude-projects.truapi.com`
- Database: MongoDB Atlas, database name "claude-projects"
- Secret management: senvn
- Deployment command: `pnpm deploy:prod`
- Authentication: API Keys (machine-to-machine)
- Initial client: VSCode extension

### Key Design Decisions (to be validated during implementation)
- Use heartbeat mechanism rather than event-driven state changes for simplicity
- Session state stored as documents in MongoDB with TTL indexes for auto-cleanup
- RESTful API design rather than GraphQL for initial version
- Stateless API design - all state in MongoDB, no in-memory caching initially
