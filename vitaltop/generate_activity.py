#!/usr/bin/env python3
"""Generate bounded CPU and memory activity for a vitaltop demonstration."""

import argparse
import hashlib
import multiprocessing
import os
import signal
import sys
import time


MIB = 1024 * 1024


def available_memory_mib():
    try:
        with open("/proc/meminfo", encoding="utf-8") as meminfo:
            for line in meminfo:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except (OSError, ValueError):
        pass
    return 1024


def cpu_worker(stop_event, worker_number):
    payload = f"vitaltop-demo-{worker_number}".encode()
    while not stop_event.is_set():
        for _ in range(25_000):
            payload = hashlib.sha256(payload).digest()


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Create temporary CPU and RAM activity for vitaltop."
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=30,
        help="run time in seconds (default: 30, maximum: 300)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=2,
        help="CPU worker processes (default: 2, capped at the CPU count)",
    )
    parser.add_argument(
        "--memory-mib",
        type=int,
        default=1024,
        help="RAM to touch and hold in MiB (default: 1024, capped at 25%% available)",
    )
    return parser.parse_args()


def main():
    arguments = parse_arguments()
    duration = max(1, min(arguments.duration, 300))
    workers = max(0, min(arguments.workers, os.cpu_count() or 1))
    safe_memory_limit = max(1, available_memory_mib() // 4)
    memory_mib = max(0, min(arguments.memory_mib, safe_memory_limit))

    print(
        f"Generating activity for {duration}s: {workers} CPU worker(s), "
        f"{memory_mib} MiB RAM. Press Ctrl-C to stop."
    )

    stop_event = multiprocessing.Event()
    processes = [
        multiprocessing.Process(target=cpu_worker, args=(stop_event, number))
        for number in range(workers)
    ]
    for process in processes:
        process.start()

    memory = []
    try:
        for _ in range(memory_mib):
            block = bytearray(MIB)
            block[::4096] = b"\xA5" * (MIB // 4096)
            memory.append(block)

        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            time.sleep(0.25)
    except KeyboardInterrupt:
        pass
    except MemoryError:
        print("Memory allocation stopped early; cleaning up.", file=sys.stderr)
    finally:
        stop_event.set()
        for process in processes:
            process.join(timeout=2)
            if process.is_alive():
                process.terminate()
                process.join()
        memory.clear()

    print("Activity finished; CPU and memory have been released.")
    return 0


def raise_keyboard_interrupt(_signal, _frame):
    raise KeyboardInterrupt


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, raise_keyboard_interrupt)
    raise SystemExit(main())
