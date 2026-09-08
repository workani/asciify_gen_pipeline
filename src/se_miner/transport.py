"""Pinned seekable sources; HTTP ranges with bounded LRU and disk fallback."""
import hashlib
import io
import json
import re
import time
from http.client import HTTPException
from collections import OrderedDict
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .common import MinerError, digest
from .events import NETWORK, RETRY, SOURCE, event, redact


class NoRanges(MinerError):
    pass


def request(url, headers=None, attempts=4, observer=None):
    def waited(delay, status=None, error=None):
        if observer:
            observer(event(RETRY, url=redact(url), attempt=attempt + 1, attempts=attempts,
                           delay=delay, status=status, error=error))
    for attempt in range(attempts):
        try:
            response = urlopen(Request(url, headers={"User-Agent": "SE-symbol-miner/1", "Accept-Encoding": "identity", **(headers or {})}), timeout=45)
            if url.startswith("https://") and not response.geturl().startswith("https://"):
                response.close()
                raise MinerError("Refusing an HTTPS-to-HTTP source redirect")
            return response
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt + 1 == attempts:
                raise MinerError("Source HTTP request failed (%s)" % error.code) from None
            delay = error.headers.get("Retry-After", "")
            if delay.isdigit() and int(delay) > 60:
                raise MinerError("Source requests a long retry delay; resume later") from None
            pause = int(delay) if delay.isdigit() else min(2 ** attempt, 10)
            waited(pause, status=error.code)
            time.sleep(pause)
        except (URLError, TimeoutError, OSError) as error:
            if attempt + 1 == attempts:
                raise MinerError("Source request failed after bounded retries") from None
            pause = min(2 ** attempt, 10)
            waited(pause, error=type(error).__name__)
            time.sleep(pause)


def validator(headers):
    etag = headers.get("ETag")
    if etag and not etag.startswith("W/"):
        return {"etag": etag}
    modified = headers.get("Last-Modified")
    return {"last_modified": modified} if modified else {}


class RangeReader(io.RawIOBase):
    def __init__(self, url, expected=None, block_size=4 * 1024 * 1024, cache_blocks=4, observer=None):
        self.url, self.pos = url, 0
        self.block_size, self.cache_blocks = block_size, cache_blocks
        self.cache = OrderedDict()
        self.observer = observer
        self.requests, self.transferred = 0, 0
        with request(url, {"Range": "bytes=0-0"}, observer=observer) as response:
            self.requests += 1
            self._seen(1, 1)
            if response.status != 206:
                raise NoRanges("Server does not support byte ranges")
            match = re.fullmatch(r"bytes 0-0/(\d+)", response.headers.get("Content-Range", ""))
            if not match or len(response.read(2)) != 1:
                raise MinerError("Invalid range probe response")
            self.transferred += 1
            self.identity = {"size": int(match[1]), **validator(response.headers)}
        if len(self.identity) == 1:
            raise NoRanges("No stable HTTP validator; use verified bounded cache")
        if expected and expected != self.identity:
            raise MinerError("Source changed since checkpoint; use a new work directory/release")
        self.size = self.identity["size"]

    def _seen(self, requests, transferred):
        if self.observer:
            self.observer(event(NETWORK, requests=requests, bytes=transferred))

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset if whence == 2 else -1
        if position < 0:
            raise MinerError("Invalid archive seek")
        self.pos = position
        return self.pos

    def _block(self, index):
        if index in self.cache:
            self.cache.move_to_end(index)
            return self.cache[index]
        start = index * self.block_size
        end = min(self.size, start + self.block_size) - 1
        headers = {"Range": "bytes=%d-%d" % (start, end)}
        if "etag" in self.identity:
            headers["If-Match"] = self.identity["etag"]
        else:
            headers["If-Unmodified-Since"] = self.identity["last_modified"]
        for attempt in range(4):
            try:
                with request(self.url, headers, observer=self.observer) as response:
                    self.requests += 1
                    expected = "bytes %d-%d/%d" % (start, end, self.size)
                    if response.status != 206 or response.headers.get("Content-Range") != expected:
                        raise MinerError("Server stopped honoring exact byte ranges")
                    if validator(response.headers) != {k: v for k, v in self.identity.items() if k != "size"}:
                        raise MinerError("Source validator changed during reading")
                    data = response.read(end - start + 2)
                    self.transferred += len(data)
                    if len(data) != end - start + 1:
                        raise OSError("Truncated HTTP range")
                    self._seen(1, len(data))
                    break
            except (OSError, TimeoutError, EOFError, HTTPException):
                if attempt == 3:
                    raise MinerError("Truncated range after bounded retries") from None
                time.sleep(min(2 ** attempt, 10))
        self.cache[index] = data
        while len(self.cache) > self.cache_blocks:
            self.cache.popitem(last=False)
        return data

    def read(self, size=-1):
        if size < 0:
            raise MinerError("Unbounded source reads are forbidden")
        if size > 16 * 1024 * 1024:
            raise MinerError("Read exceeds bounded buffer size")
        pieces = []
        left = min(size, max(0, self.size - self.pos))
        while left:
            block = self._block(self.pos // self.block_size)
            offset = self.pos % self.block_size
            piece = block[offset:offset + left]
            pieces.append(piece)
            self.pos += len(piece)
            left -= len(piece)
        return b"".join(pieces)

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)

    def close(self):
        self.cache.clear()
        super().close()


class Sources:
    def __init__(self, budget, pin, observer=None):
        self.budget, self.pin = budget, pin
        self.identities = {}
        self.observer = observer
        self.stats = {"http_requests": 0, "http_bytes": 0}

    def _note(self, action, url, **fields):
        if self.observer:
            self.observer(event(SOURCE, action=action, url=redact(url), **fields))

    def open(self, spec):
        url = spec["url"]
        key = digest({"url": url, "sha256": spec.get("sha256")})
        expected = self.pin(key, None)
        if not url.startswith(("https://", "http://")):
            self._note("verifying", url, note="Verifying local source")
            path = Path(url)
            stat = path.stat()
            fingerprint = (stat.st_size, stat.st_mtime_ns)
            if self.identities.get(key, (None,))[0] != fingerprint:
                sha = hashlib.sha256()
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        sha.update(chunk)
                identity = {"size": stat.st_size, "sha256": sha.hexdigest()}
                self.identities[key] = (fingerprint, identity)
            identity = self.identities[key][1]
            self._verify(identity, expected, spec)
            self.pin(key, identity)
            return path.open("rb")
        self._note("opening", url, note="Opening remote source")
        try:
            expected_http = {k: v for k, v in expected.items() if k != "sha256"} if expected and ("etag" in expected or "last_modified" in expected) else None
            stream = RangeReader(url, expected_http, observer=self.observer)
            identity = dict(stream.identity)
            if spec.get("etag") and identity.get("etag") != spec["etag"]:
                stream.close()
                raise MinerError("Source ETag differs from pinned manifest")
            if spec.get("catalog_size") and identity["size"] != spec["catalog_size"]:
                stream.close()
                raise MinerError("Source length differs from catalog manifest")
            if spec.get("sha256"):
                if expected_http and expected.get("sha256") == spec["sha256"]:
                    identity["sha256"] = expected["sha256"]
                else:
                    self._note("hashing", url, note="Hashing source to verify sha256",
                               total=identity["size"])
                    sha, hashed = hashlib.sha256(), 0
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        sha.update(chunk)
                        hashed += len(chunk)
                        self._note("hashing", url, note="Hashing source to verify sha256",
                                   done=hashed, total=identity["size"], quiet=True)
                    identity["sha256"] = sha.hexdigest()
                    stream.seek(0)
                if identity["sha256"] != spec["sha256"]:
                    stream.close()
                    raise MinerError("Source checksum mismatch")
            self._verify(identity, expected, spec)
            self.pin(key, identity)
            original_close = stream.close
            def close():
                if not stream.closed:
                    self.stats["http_requests"] += stream.requests
                    self.stats["http_bytes"] += stream.transferred
                original_close()
            stream.close = close
            return stream
        except NoRanges:
            pass
        return self._cached(spec, key, expected)

    def _verify(self, identity, expected, spec):
        if expected and identity != expected:
            raise MinerError("Source changed since checkpoint; choose a new work directory")
        if spec.get("sha256") and identity.get("sha256") != spec["sha256"]:
            raise MinerError("Source checksum mismatch")
        if spec.get("catalog_size") and identity["size"] != spec["catalog_size"]:
            raise MinerError("Source length differs from catalog manifest")

    def _cached(self, spec, key, expected):
        path = self.budget.cache / (key + ".archive")
        self._note("cache", spec["url"], note="Ranges unavailable; using verified bounded cache")
        if path.exists():
            # Rehash cache on each reopen; never trust an interrupted or edited file.
            sha = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    sha.update(chunk)
            identity = {"size": path.stat().st_size, "sha256": sha.hexdigest()}
            self._verify(identity, expected, spec)
            self.pin(key, identity)
            return path.open("rb")
        temp = path.with_suffix(".partial")
        temp.unlink(missing_ok=True)
        sha, size = hashlib.sha256(), 0
        try:
            with request(spec["url"], observer=self.observer) as response, temp.open("wb") as target:
                self.stats["http_requests"] += 1
                if response.status != 200:
                    raise MinerError("Expected full archive response for cache fallback")
                if spec.get("etag") and validator(response.headers).get("etag") != spec["etag"]:
                    raise MinerError("Source ETag differs from pinned manifest")
                length = response.headers.get("Content-Length")
                if length:
                    self.budget.check(int(length))
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk: break
                    self.budget.check(len(chunk))
                    target.write(chunk)
                    sha.update(chunk)
                    size += len(chunk)
                    self.stats["http_bytes"] += len(chunk)
                    if self.observer:
                        self.observer(event(NETWORK, requests=0, bytes=len(chunk)))
                if length and size != int(length):
                    raise MinerError("Truncated archive download")
            identity = {"size": size, "sha256": sha.hexdigest()}
            self._verify(identity, expected, spec)
            self.pin(key, identity)
            temp.replace(path)
            return path.open("rb")
        except BaseException:
            temp.unlink(missing_ok=True)
            raise

    def reclaim(self):
        for path in self.budget.cache.glob("*"):
            if path.suffix in (".archive", ".partial"):
                path.unlink()
