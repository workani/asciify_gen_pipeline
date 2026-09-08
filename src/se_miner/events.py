"""Structured progress vocabulary shared by mining code and any presentation layer.

Mining code emits plain dicts and never imports a renderer. A renderer consumes
them and never calls back into the pipeline, the store, or SQLite. That boundary
is what lets a display thread stay responsive while the miner blocks inside
libarchive, Expat, or a socket, without touching SQLite thread ownership.
"""

RUN_STARTED = "run_started"
RUN_FINISHED = "run_finished"
SITE_STARTED = "site_started"
SITE_COMPLETE = "site_complete"
SITE_FAILED = "site_failed"
INVENTORY = "inventory"
SOURCE = "source"
NETWORK = "network"
RETRY = "retry"
STAGE_STARTED = "stage_started"
STAGE_SKIPPED = "stage_skipped"
STAGE_COMPLETE = "stage_complete"
REPLAY = "replay"
PROGRESS = "progress"
CHECKPOINT = "checkpoint"
WORKING = "working"
METRICS = "metrics"
LOG = "log"

# Site phases in execution order, with the source table each one must read.
PHASE_TABLE = {
    "discover_posts": "Posts",
    "discover_comments": "Comments",
    "discover_history": "PostHistory",
    "discover_duplicates": "PostLinks",
    "resolve_threads": None,
    "collect_posts": "Posts",
    "collect_comments": "Comments",
    "collect_history": "PostHistory",
}
SITE_PHASES = tuple(PHASE_TABLE)

# Phases that disappear entirely when their optional table is absent.
OPTIONAL_PHASES = {"discover_history": "PostHistory", "discover_duplicates": "PostLinks",
                   "collect_history": "PostHistory"}

# A completed discovery pass counted every row of its table under the same pinned
# source identity, so the matching collection pass inherits a denominator that is
# actually true rather than an estimate. Transport rejects a changed source, so a
# complete checkpoint cannot outlive the row count it describes.
COLLECT_SOURCE = {"collect_posts": "discover_posts", "collect_comments": "discover_comments",
                  "collect_history": "discover_history"}

PHASE_LABELS = {
    "inventory": "Inventorying archive tables",
    "discover_posts": "Discovering posts",
    "discover_comments": "Scanning comments",
    "discover_history": "Scanning post history",
    "discover_duplicates": "Mapping duplicate links",
    "resolve_threads": "Resolving candidate threads",
    "collect_posts": "Collecting full discussions",
    "collect_comments": "Collecting thread comments",
    "collect_history": "Collecting original revisions",
    "complete": "Finalizing site",
}


def phase_label(phase):
    if phase in PHASE_LABELS:
        return PHASE_LABELS[phase]
    return (phase or "").replace("_", " ").capitalize() or "Working"


def event(kind, **fields):
    return {"event": kind, **fields}


def redact(url):
    """Signed source URLs carry credentials in the query string; never paint them."""
    if not url:
        return ""
    text = str(url)
    if not text.startswith(("http://", "https://")):
        return text.rsplit("/", 1)[-1] or text
    return text.split("?", 1)[0].split("#", 1)[0]
