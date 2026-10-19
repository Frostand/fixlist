#!/usr/bin/env python3
"""Atomically exchange two existing local directories using the OS primitive.

macOS SDK sys/stdio.h: renamex_np(..., RENAME_SWAP=0x2). No copy/delete
fallback: unsupported platforms/filesystems must leave the old bundle intact.
"""
import ctypes
import os
from pathlib import Path
import stat
import sys


def exchange(source, target):
    source, target = Path(source).absolute(), Path(target).absolute()
    for path in [source, target]:
        for part in [path, *path.parents]:
            if part.is_symlink():
                raise ValueError('Atomic replacement refuses symlinked paths.')
        if not stat.S_ISDIR(path.stat().st_mode):
            raise ValueError('Atomic replacement needs ordinary directories.')
    if source.stat().st_dev != target.stat().st_dev:
        raise ValueError('Atomic replacement needs a single filesystem.')
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        function = libc.renamex_np
        function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        result = function(os.fsencode(source), os.fsencode(target), 2)
    elif sys.platform.startswith('linux') and hasattr(libc, 'renameat2'):
        function = libc.renameat2
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        result = function(-100, os.fsencode(source), -100, os.fsencode(target), 2)
    else:
        raise OSError('This platform lacks atomic directory exchange; previous bundle retained.')
    if result:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: atomic_directory.py <staged-directory> <existing-directory>')
    exchange(sys.argv[1], sys.argv[2])
