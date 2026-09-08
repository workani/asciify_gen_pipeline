import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlparse


class MinerError(Exception):
    pass


class SpaceLimit(MinerError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def allowed_site(host):
    # Exact host validation: neither lookalike suffixes nor Overflow custom domains.
    import re
    return bool(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*(?:\.meta)?\.stackexchange\.com", host)) or host == "meta.stackexchange.com"


def load_manifest(path):
    path = Path(path).resolve()
    value = json.loads(path.read_text())
    if value.get("version") != 1 or not isinstance(value.get("release"), str) or not value["release"]:
        raise MinerError("Manifest requires version: 1 and a nonempty pinned release")
    sites = value.get("sites", [])
    if not sites or len({s["site"] for s in sites}) != len(sites):
        raise MinerError("Manifest must contain distinct sites")
    for site in sites:
        if not allowed_site(site["site"]):
            raise MinerError("Site outside strict Stack Exchange scope: " + site["site"])
        if bool(site.get("archive")) == bool(site.get("files")):
            raise MinerError("Each site needs either archive or files")
        if site.get("files") and not {"Posts", "Comments"}.issubset(site["files"]):
            raise MinerError("Posts and Comments are required; missing optional tables are reported")
        specs = [site["archive"]] if site.get("archive") else site["files"].values()
        for spec in specs:
            if not isinstance(spec, dict) or not isinstance(spec.get("url"), str):
                raise MinerError("Each source needs a url")
            url = spec["url"]
            parsed = urlparse(url)
            if parsed.scheme not in ("", "https", "http"):
                raise MinerError("Source must be an HTTPS URL or a local path")
            if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
                raise MinerError("Remote sources require HTTPS")
            if parsed.username or parsed.password:
                raise MinerError("Use signed URLs, not URL-embedded credentials")
            if not parsed.scheme:
                spec["url"] = str((path.parent / url).resolve())
            sha = spec.get("sha256")
            if sha is not None and (len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha)):
                raise MinerError("sha256 must contain 64 lowercase hex digits")
    return value


class Budget:
    """Only work-root archives/cache + SQLite (including journals) count."""
    RESERVE = 2 * 1024 * 1024

    def __init__(self, root, limit=10_000_000_000):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.cache = self.root / "cache"
        self.cache.mkdir(exist_ok=True)
        self.limit = int(limit)
        if self.limit < 8 * 1024 * 1024:
            raise MinerError("Storage budget must be at least 8 MiB")

    def used(self):
        return sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file())

    def check(self, extra=0):
        used = self.used()
        if used + extra + self.RESERVE > self.limit:
            raise SpaceLimit("Working storage budget exhausted: %d + %d bytes, cap %d; evidence preserved" % (used, extra, self.limit))
        free = os.statvfs(self.root).f_bavail * os.statvfs(self.root).f_frsize
        if extra + self.RESERVE > free:
            raise SpaceLimit("Insufficient physical disk space; evidence preserved")

    def constrain_db(self, db):
        # DELETE journals can copy old pages. Reserve a full second database,
        # rather than discovering a full disk after a transaction has begun.
        main = next((Path(row[2]).resolve() for row in db.execute("PRAGMA database_list") if row[1] == "main" and row[2]), None)
        # Sibling databases/indexes consume the same budget as source archives.
        owned = {main, Path(str(main) + "-journal"), Path(str(main) + "-wal"), Path(str(main) + "-shm")}
        other_bytes = sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file() and p.resolve() not in owned)
        pagesize = db.execute("PRAGMA page_size").fetchone()[0]
        # Journal page records include framing bytes in addition to page data.
        max_pages = int((self.limit - other_bytes - self.RESERVE) // (2.02 * pagesize))
        current = db.execute("PRAGMA page_count").fetchone()[0]
        if max_pages <= current:
            raise SpaceLimit("Insufficient journal headroom; remove expendable archive cache or raise budget")
        db.execute("PRAGMA max_page_count=%d" % max_pages)
        self.check()
