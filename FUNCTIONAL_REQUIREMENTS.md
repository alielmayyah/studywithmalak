# Functional requirements

- Authenticated members enter one shared room and see each member's online presence and study state.
- Members can start a study session with an optional subject, take and resume breaks, and finish. Study time is calculated from saved timestamps, excluding breaks.
- Together time is the overlap between member study intervals. Today's totals clip intervals to local day boundaries.
- The room shows today's personal totals, Together time, completed sessions, a shared daily goal, and recent activity.
- History lists the 100 most recent completed sessions with their active durations.
- Focus mode keeps the shared timer and member status visible.
- Offline and connection failures are shown to the user. Data reloads after reconnection.
