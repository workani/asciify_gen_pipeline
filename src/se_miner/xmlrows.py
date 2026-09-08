"""Incremental XML rows. Reject DTD/entity declarations and oversized records."""
from xml.parsers import expat
from .common import MinerError

MAX_ROW_BYTES = 4 * 1024 * 1024


def parse_rows(chunks, callback, root_name, max_row_bytes=MAX_ROW_BYTES):
    parser = expat.ParserCreate()
    stack, count = [], 0
    last_boundary = 0

    def start(name, attrs):
        nonlocal count, last_boundary
        if not stack:
            if name.lower() != root_name.lower():
                raise MinerError("Unexpected XML root: " + name)
        elif len(stack) != 1 or name != "row":
            raise MinerError("Unexpected nested XML element: " + name)
        stack.append(name)
        if name == "row":
            if sum(len(k.encode()) + len(v.encode()) for k, v in attrs.items()) > max_row_bytes:
                raise MinerError("XML row exceeds bounded size; coverage is incomplete")
            count += 1
            callback(attrs, count)

    def end(name):
        nonlocal last_boundary
        stack.pop()
        last_boundary = parser.CurrentByteIndex

    def forbid(*_args):
        raise MinerError("DTD and entity declarations are forbidden")

    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.StartDoctypeDeclHandler = forbid
    parser.EntityDeclHandler = forbid
    parser.ExternalEntityRefHandler = forbid
    total = 0
    try:
        for chunk in chunks:
            # Bound an incomplete attribute/row before Expat can accumulate it
            # indefinitely. Calls use small chunks, not whole files.
            total += len(chunk)
            parser.Parse(chunk, False)
            if total - last_boundary > max_row_bytes + 256 * 1024:
                raise MinerError("Unterminated/oversized XML record")
        parser.Parse(b"", True)
    except expat.ExpatError as error:
        raise MinerError("Malformed XML at line %d: %s" % (error.lineno, error)) from None
    return count
