"""Folder allowlist: Jarvis can only touch files inside folders you approved.

Every path is fully resolved first (following `..` and symlinks), so tricks
like `~/Documents/../.ssh/id_rsa` or a symlink pointing outside are caught.
Sensitive files (keys, password stores, `.env`) are refused even inside an
allowed folder.
"""

from __future__ import annotations

import fnmatch
from pathlib import Path


class PathNotAllowed(PermissionError):
    """The path is outside the allowlist or is a sensitive file."""


SENSITIVE_DIR_NAMES = {
    ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".password-store",
    "keychains", ".git", ".config", ".1password",
}
SENSITIVE_FILE_PATTERNS = [
    ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.kdbx", "*.keychain",
    "*.keychain-db", "id_rsa*", "id_ed25519*", "id_ecdsa*", ".netrc", ".npmrc",
    ".pypirc", "*.ovpn", "*password*.csv", "*passwords*.txt", "credentials",
    "credentials.json", "*.gpg", "*.asc", "login.keychain*", "cookies.sqlite",
    "audit.log", "jarvis.pid",
]


def is_sensitive(path: Path) -> bool:
    lowered_parts = [part.lower() for part in path.parts]
    if any(part in SENSITIVE_DIR_NAMES for part in lowered_parts[:-1]):
        return True
    name = path.name.lower()
    if name in SENSITIVE_DIR_NAMES:
        return True
    return any(fnmatch.fnmatch(name, pattern) for pattern in SENSITIVE_FILE_PATTERNS)


class PathPolicy:
    def __init__(self, allowed_folders: list[Path]):
        self.allowed = [Path(folder).expanduser().resolve() for folder in allowed_folders]

    def _root_of(self, resolved: Path) -> Path | None:
        for root in self.allowed:
            if resolved == root or root in resolved.parents:
                return root
        return None

    def check(self, path: str | Path) -> Path:
        """Return the fully resolved path, or raise PathNotAllowed."""
        text = str(path)
        if "\x00" in text:
            raise PathNotAllowed("That path contains an invalid character.")
        candidate = Path(text).expanduser()
        if not candidate.is_absolute():
            # Relative paths are looked for inside the first allowed folder.
            if not self.allowed:
                raise PathNotAllowed("No folders are allowed in config.toml.")
            candidate = self.allowed[0] / candidate
        resolved = candidate.resolve()
        root = self._root_of(resolved)
        if root is None:
            raise PathNotAllowed(
                f"'{text}' is outside the folders allowed in config.toml (allowed_folders)."
            )
        # Only the part below the allowed folder is judged, so the location
        # of the allowed folder itself never matters.
        if resolved != root and is_sensitive(resolved.relative_to(root)):
            raise PathNotAllowed(
                f"'{text}' looks like a password, key or other sensitive file. I never open those."
            )
        return resolved

    def is_allowed(self, path: str | Path) -> bool:
        try:
            self.check(path)
            return True
        except PathNotAllowed:
            return False
