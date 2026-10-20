"""Optional process memory evidence; absence is reported instead of guessed."""
import ctypes
import os


def peak_working_set_bytes() -> int | None:
    if os.name != "nt":
        return None

    class Counters(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong),
                    ("peak", ctypes.c_size_t), ("working", ctypes.c_size_t),
                    ("peak_paged", ctypes.c_size_t), ("paged", ctypes.c_size_t),
                    ("peak_nonpaged", ctypes.c_size_t), ("nonpaged", ctypes.c_size_t),
                    ("pagefile", ctypes.c_size_t), ("peak_pagefile", ctypes.c_size_t)]

    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong]
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        return None
    return int(counters.peak)
