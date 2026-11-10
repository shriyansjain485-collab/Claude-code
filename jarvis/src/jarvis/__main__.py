"""Entry point: `python -m jarvis`.

The network guard is installed before anything else is imported, so no other
module gets a chance to open a connection first.
"""

from jarvis.safety import netguard

netguard.install()

from jarvis.cli import main  # noqa: E402  (must come after the guard)

if __name__ == "__main__":
    raise SystemExit(main())
