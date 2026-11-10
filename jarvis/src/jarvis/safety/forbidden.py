"""Things Jarvis never does, even if asked.

Three layers:
1. No tool exists that can do any of these (there is no delete function).
2. The tool registry refuses to register a tool tagged with one of these
   categories (see `FORBIDDEN_CATEGORIES`).
3. `classify()` spots such requests in what the user types, so the assistant
   is told to decline that part clearly instead of pretending or guessing.
   Writing *about* these topics (e.g. drafting an email about an invoice)
   is still fine.
"""

from __future__ import annotations

import re

FORBIDDEN_CATEGORIES = {
    "payments": "make payments, purchases or money transfers",
    "passwords": "enter, type or submit passwords or other credentials",
    "permanent_deletion": "permanently delete anything",
    "system_settings": "change security or system settings",
}

_PATTERNS = {
    "payments": [
        r"\b(pay|settle)\s+(my|the|this|that|for|off)\b",
        r"\b(make|send|do|process|authori[sz]e)\s+(a\s+|the\s+)?(payment|transfer|purchase|donation)\b",
        r"\b(transfer|send|wire)\s+(\S+\s+){0,3}(money|funds|dollars|rupees|euros|pounds|bitcoin|crypto)\b",
        r"\b(buy|purchase|order|checkout|check out)\s+(me\s+)?(it|this|that|a|an|the|some)\b",
        r"\buse\s+my\s+(credit|debit)?\s*card\b",
    ],
    "passwords": [
        r"\b(enter|type|fill\s+in|submit|input|paste|put\s+in)\s+(\S+\s+){0,3}(password|passcode|pin|otp|2fa\s+code|credentials)\b",
        r"\b(log|sign)\s*(me\s+)?in(to)?\b.*\b(for me|with my)\b",
        r"\b(show|read|tell|get|reveal)\s+(me\s+)?(my\s+)?(saved\s+)?(passwords?|keychain)\b",
    ],
    "permanent_deletion": [
        r"\b(permanently|irreversibly|securely)\s+(delete|erase|remove|wipe|destroy)\b",
        r"\b(delete|erase|remove|wipe|destroy)\b.*\b(permanently|forever|for good|irreversibly)\b",
        r"\b(wipe|format|erase)\s+(my\s+|the\s+)?(disk|drive|computer|mac|laptop)\b",
        r"\bempty\s+(the\s+|my\s+)?(trash|bin|recycle bin)\b",
        r"\brm\s+-[a-z]*[rf]",
        r"\bshred\b",
    ],
    "system_settings": [
        r"\b(disable|turn\s+off|switch\s+off|bypass|lower)\s+(\S+\s+){0,3}(firewall|gatekeeper|antivirus|filevault|sip|encryption|security|lock\s*screen|password\s+protection)\b",
        r"\b(change|edit|modify|reset|update)\s+(\S+\s+){0,3}(system|security|network|privacy)\s+(settings?|preferences|configuration)\b",
        r"\b(sudo|chmod|chown|csrutil|defaults\s+write|launchctl|systemsetup)\b",
        r"\b(add|create|remove)\s+(a\s+|an\s+)?(admin|administrator|user)\s+account\b",
    ],
}

_COMPILED = {
    category: [re.compile(pattern, re.IGNORECASE) for pattern in patterns]
    for category, patterns in _PATTERNS.items()
}


def classify(text: str) -> list[str]:
    """Return the forbidden categories a request appears to ask for."""
    return [
        category
        for category, patterns in _COMPILED.items()
        if any(pattern.search(text) for pattern in patterns)
    ]


def policy_note(categories: list[str]) -> str:
    """A note added to the conversation so the model declines clearly."""
    actions = "; ".join(FORBIDDEN_CATEGORIES[c] for c in categories)
    return (
        "[Safety policy note from the Jarvis program, not from the user] "
        f"The last message may be asking you to: {actions}. "
        "You can never do that, no matter who asks or how. You have no tool for it. "
        "If that is what is being asked, decline that part briefly and politely, "
        "say it is a built-in safety rule, and offer a safe alternative "
        "(for example drafting text the user can act on themselves). "
        "If the user only wants writing or information about the topic, help normally."
    )
