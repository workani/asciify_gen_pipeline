"""libarchive streaming bridge with seek callbacks; never extracts to disk."""
import ctypes as C
import ctypes.util
from pathlib import PurePosixPath

from .common import MinerError


def library():
    name = ctypes.util.find_library("archive")
    if not name:
        raise MinerError("libarchive is required for .7z/.zip/.tar sources (macOS system library or Linux libarchive)")
    lib = C.CDLL(name)
    signatures = {
        "archive_read_new": (C.c_void_p, []),
        "archive_read_support_filter_all": (C.c_int, [C.c_void_p]),
        "archive_read_support_format_all": (C.c_int, [C.c_void_p]),
        "archive_read_set_seek_callback": (C.c_int, [C.c_void_p, C.c_void_p]),
        "archive_read_open2": (C.c_int, [C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p]),
        "archive_read_next_header": (C.c_int, [C.c_void_p, C.POINTER(C.c_void_p)]),
        "archive_entry_pathname": (C.c_char_p, [C.c_void_p]),
        "archive_entry_filetype": (C.c_uint, [C.c_void_p]),
        "archive_read_data": (C.c_ssize_t, [C.c_void_p, C.c_void_p, C.c_size_t]),
        "archive_read_data_skip": (C.c_int, [C.c_void_p]),
        "archive_error_string": (C.c_char_p, [C.c_void_p]),
        "archive_read_free": (C.c_int, [C.c_void_p]),
    }
    for name, (restype, argtypes) in signatures.items():
        fn = getattr(lib, name)
        fn.restype, fn.argtypes = restype, argtypes
    return lib


class Archive:
    def __init__(self, stream):
        self.stream, self.lib, self.callback_error = stream, library(), None
        self.handle = self.lib.archive_read_new()
        self.buffer = C.create_string_buffer(256 * 1024)
        read_type = C.CFUNCTYPE(C.c_ssize_t, C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p))
        seek_type = C.CFUNCTYPE(C.c_int64, C.c_void_p, C.c_void_p, C.c_int64, C.c_int)
        skip_type = C.CFUNCTYPE(C.c_int64, C.c_void_p, C.c_void_p, C.c_int64)

        def read(_archive, _data, pointer):
            try:
                data = stream.read(len(self.buffer))
                C.memmove(self.buffer, data, len(data))
                pointer[0] = C.cast(self.buffer, C.c_void_p)
                return len(data)
            except BaseException as error:
                self.callback_error = error
                return -1

        def seek(_archive, _data, offset, whence):
            try:
                return stream.seek(offset, whence)
            except BaseException as error:
                self.callback_error = error
                return -1

        def skip(_archive, _data, amount):
            try:
                before = stream.tell()
                return stream.seek(amount, 1) - before
            except BaseException as error:
                self.callback_error = error
                return -1

        self.callbacks = (read_type(read), seek_type(seek), skip_type(skip))
        try:
            self._check(self.lib.archive_read_support_filter_all(self.handle))
            self._check(self.lib.archive_read_support_format_all(self.handle))
            self._check(self.lib.archive_read_set_seek_callback(self.handle, self.callbacks[1]))
            self._check(self.lib.archive_read_open2(self.handle, None, None, self.callbacks[0], self.callbacks[2], None))
        except BaseException:
            self.close()
            raise

    def _check(self, result):
        if self.callback_error:
            raise self.callback_error
        if result < 0:
            message = self.lib.archive_error_string(self.handle)
            raise MinerError("Archive error: " + (message.decode(errors="replace") if message else str(result)))
        return result

    def members(self):
        entry = C.c_void_p()
        while True:
            status = self.lib.archive_read_next_header(self.handle, C.byref(entry))
            if status == 1: break
            self._check(status)
            raw = self.lib.archive_entry_pathname(entry)
            if raw is None:
                raise MinerError("Archive member has no name")
            name = raw.decode("utf-8", errors="strict")
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name:
                raise MinerError("Unsafe archive member path")
            kind = self.lib.archive_entry_filetype(entry)
            if kind not in (0o100000, 0o040000):
                raise MinerError("Archive contains a non-regular member")
            yield name, kind == 0o100000
            self._check(self.lib.archive_read_data_skip(self.handle))

    def chunks(self):
        output = C.create_string_buffer(256 * 1024)
        while True:
            size = self._check(self.lib.archive_read_data(self.handle, output, len(output)))
            if not size: break
            yield output.raw[:size]

    def close(self):
        if self.handle:
            self.lib.archive_read_free(self.handle)
            self.handle = None

    def __enter__(self): return self
    def __exit__(self, *_args): self.close()
