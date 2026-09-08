"""Classification across processes.

classify() is a pure function of one row's fields: no database, no source, no
run state. So a worker can only return a verdict, the parent applies verdicts in
source order, and SQLite keeps exactly one owner on one thread. That is what
makes a parallel scan produce a byte-identical database and the same checkpoint
ordinals as a serial one -- worker count is a throughput setting, never a rule
setting, and is deliberately absent from the work-directory contract.
"""
import os
import signal

from .common import MinerError
from .filtering import classify

# Set once per worker by the initializer. Workers hold no other state.
_THRESHOLD = None


def _start(threshold):
    global _THRESHOLD
    _THRESHOLD = threshold
    # The parent owns Ctrl-C. A worker raising KeyboardInterrupt of its own
    # races the parent for the same terminal and turns a clean pause, whose
    # checkpoint is already safe, into a pool teardown traceback.
    signal.signal(signal.SIGINT, signal.SIG_IGN)


def _classify(job):
    fields, role = job
    return classify(fields, _THRESHOLD, source_role=role)


def resolve_workers(requested):
    """`auto` is one worker per core. The parent's own per-row work -- Expat,
    pickling, the routing insert -- measures ~0.025 ms against ~1.7 ms of
    classification, so it can feed dozens of workers before it becomes the
    limit; the cap is here for memory, not for scaling."""
    if requested in (None, "auto"):
        return max(1, min(os.cpu_count() or 1, 16))
    try:
        count = int(requested)
    except (TypeError, ValueError):
        raise MinerError("--workers takes a positive count or 'auto'") from None
    if count < 1:
        raise MinerError("--workers takes a positive count or 'auto'")
    return count


class Classifier:
    """One pool for a whole run: eight phases would otherwise pay process
    startup eight times for the same workers."""

    def __init__(self, threshold, workers=1):
        self.threshold, self.workers = threshold, workers
        self.parallel = workers > 1
        self._pool = None

    def _ensure(self):
        if self._pool is None:
            from concurrent.futures import ProcessPoolExecutor
            import multiprocessing
            # Spawn, not fork, on every platform. The live dashboard is already
            # running its own thread by the time a pool is built, and forking a
            # multithreaded process inherits locks no thread will ever release.
            # Spawn also makes a local macOS run exercise the same start method
            # as the Linux host. The cost is one import of the rules per worker,
            # once per run.
            self._pool = ProcessPoolExecutor(
                self.workers, mp_context=multiprocessing.get_context("spawn"),
                initializer=_start, initargs=(self.threshold,))
        return self._pool

    def map(self, jobs):
        """Verdicts positionally aligned to `jobs`; a None job stays None, so a
        row the phase does not classify still occupies its place in the order."""
        work = [job for job in jobs if job is not None]
        if not work:
            return [None] * len(jobs)
        if not self.parallel:
            done = [classify(fields, self.threshold, source_role=role) for fields, role in work]
        else:
            grain = max(16, len(work) // (self.workers * 4))
            try:
                done = list(self._ensure().map(_classify, work, chunksize=grain))
            except Exception as error:
                # A worker that dies (commonly the OOM killer on a small host)
                # must not look like a source or rule failure.
                raise MinerError("Classification worker failed (%s: %s); retry with --workers 1"
                                 % (type(error).__name__, error)) from None
        verdicts = iter(done)
        return [None if job is None else next(verdicts) for job in jobs]

    def close(self):
        if self._pool is not None:
            self._pool.shutdown(wait=True)
            self._pool = None
