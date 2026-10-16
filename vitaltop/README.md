# vitaltop

`vitaltop` is a small Linux system monitor styled like a bedside medical
display. It shows large live CPU and memory traces, load averages,
high-memory processes, and error-priority entries from the current systemd
journal.

## Requirements

- A Linux system with `/proc`
- A C++20 compiler
- CMake 3.20 or newer
- ncurses development headers
- `journalctl` for the optional system-error panel

On openSUSE, the ncurses headers are provided by `ncurses-devel`.

## Build and run

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/vitaltop
```

Use a terminal at least 80 columns by 30 rows. Press `q` to exit. No elevated
permissions are required.

The error panel refreshes every five seconds. Journal visibility follows the
permissions of the account running `vitaltop`; it does not invoke `sudo`.
The CPU trace uses a fixed 0–100% scale. The memory trace uses a clearly labeled
adaptive scale, beginning at 0–10% and expanding in 10-point steps, so low RAM
usage remains visible without misrepresenting the axis. An underscore marks the
fixed 0% baseline, dashes mark the measured level, and a vertical bar marks the
newest sample.

## Generate demo activity

With `vitaltop` running in another terminal, use the included bounded activity
generator to make the CPU and memory traces move:

```sh
python3 generate_activity.py
```

The default run lasts 30 seconds, uses two CPU workers, and holds up to 1 GiB
of touched memory. The script caps memory at 25% of currently available RAM
and caps workers at the machine's CPU count. Both the duration and load are
configurable:

```sh
python3 generate_activity.py --duration 60 --workers 4 --memory-mib 2048
```

Press `Ctrl-C` at any time to stop and release the resources.
