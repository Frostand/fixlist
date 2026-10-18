#!/usr/bin/env python3
"""Read a bounded artifact beneath an anchored root without following symlinks.

Each directory component is opened relative to the preceding directory FD with
O_NOFOLLOW. Validation of strings/realpaths alone cannot prevent parent swaps.
The caller captures stdout privately; this helper never logs input bytes.
"""
import os
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
import stat
import sys


@contextmanager
def directory_beneath(root, relative=''):
    """Anchor reads and writes to ordinary directory FDs, never symlink targets."""
    root = Path(root)
    relative = PurePosixPath(relative)
    if not root.is_absolute() or '..' in root.parts or relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Invalid local artifact directory.')
    nofollow = os.O_RDONLY | os.O_NOFOLLOW
    directory = os.open('/', nofollow | os.O_DIRECTORY)
    try:
        for component in [*root.parts[1:], *relative.parts]:
            if component in ('', '.', '..'):
                raise ValueError('Invalid artifact ancestor.')
            child = os.open(component, nofollow | os.O_DIRECTORY, dir_fd=directory)
            os.close(directory); directory = child
        yield directory
    finally:
        os.close(directory)


def read_beneath(root, relative, maximum, *, with_stat=False):
    relative = PurePosixPath(relative)
    if relative.is_absolute() or '..' in relative.parts or not relative.parts or not 1 <= maximum <= 64*1024*1024:
        raise ValueError('Invalid local artifact path/bound.')
    with directory_beneath(root, relative.parent) as directory:
        descriptor = os.open(relative.parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum:
                raise ValueError('Invalid artifact size/type.')
            parts, count = [], 0
            while True:
                part = os.read(descriptor, min(1024*1024, maximum+1-count))
                if not part:
                    break
                parts.append(part); count += len(part)
                if count > maximum:
                    raise ValueError('Artifact grew beyond its bound.')
            after = os.fstat(descriptor)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ValueError('Artifact changed while reading.')
            data = b''.join(parts)
            return (data, after) if with_stat else data
        finally:
            os.close(descriptor)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Usage: read_local_artifact.py <source-root> <relative-file> <max-bytes>')
    sys.stdout.buffer.write(read_beneath(sys.argv[1], sys.argv[2], int(sys.argv[3])))
