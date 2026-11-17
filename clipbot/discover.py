"""Find live streams about a topic on YouTube and Twitch."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass

YOUTUBE_LIVE_FILTER = "EgJAAQ%3D%3D"  # YouTube's own "Live" search filter


@dataclass
class LiveStream:
    site: str
    channel: str
    title: str
    url: str
    viewers: int = 0
    language: str = ""
    category: str = ""

    @property
    def key(self) -> str:
        return f"{self.site}:{self.channel.lower()}"

    def to_dict(self) -> dict:
        return asdict(self)


def youtube_live(topic: str, limit: int = 20, extra: list[str] | None = None) -> list[LiveStream]:
    url = (f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(topic)}"
           f"&sp={YOUTUBE_LIVE_FILTER}")
    result = subprocess.run(["yt-dlp", "--flat-playlist", "-J", "--no-warnings",
                             "--playlist-end", str(limit), *(extra or []), url],
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"YouTube search failed: {result.stderr.strip()[-300:]}")
    streams = []
    for e in json.loads(result.stdout).get("entries") or []:
        if e.get("live_status") not in (None, "is_live") or not e.get("id"):
            continue
        streams.append(LiveStream(
            site="youtube", channel=e.get("channel") or e.get("uploader") or e["id"],
            title=e.get("title") or "", url=f"https://www.youtube.com/watch?v={e['id']}",
            viewers=int(e.get("concurrent_view_count") or 0)))
    return streams


class TwitchAPI:
    """Twitch's official Helix API. Needs a free app from dev.twitch.tv/console:
    set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET."""

    def __init__(self) -> None:
        self.client_id = os.environ.get("TWITCH_CLIENT_ID", "")
        self.secret = os.environ.get("TWITCH_CLIENT_SECRET", "")
        self.token = ""
        self.token_expires = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.secret)

    def _auth(self) -> None:
        if self.token and time.time() < self.token_expires - 60:
            return
        body = urllib.parse.urlencode({"client_id": self.client_id, "client_secret": self.secret,
                                       "grant_type": "client_credentials"}).encode()
        with urllib.request.urlopen("https://id.twitch.tv/oauth2/token", data=body, timeout=20) as r:
            data = json.load(r)
        self.token, self.token_expires = data["access_token"], time.time() + data.get("expires_in", 3600)

    def get(self, path: str, params: list[tuple[str, str]]) -> list[dict]:
        self._auth()
        url = f"https://api.twitch.tv/helix/{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"Client-Id": self.client_id,
                                                   "Authorization": f"Bearer {self.token}"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r).get("data", [])

    def live(self, topic: str, limit: int = 20) -> list[LiveStream]:
        """Streams whose title/channel matches the topic, plus top streams in a matching category."""
        logins = [c["broadcaster_login"] for c in
                  self.get("search/channels", [("query", topic), ("live_only", "true"), ("first", str(limit))])]
        streams = self.get("streams", [("user_login", login) for login in logins[:100]]) if logins else []
        categories = self.get("search/categories", [("query", topic), ("first", "1")])
        if categories:
            streams += self.get("streams", [("game_id", categories[0]["id"]), ("first", str(limit))])
        found: dict[str, LiveStream] = {}
        for s in streams:
            found[s["user_login"]] = LiveStream(
                site="twitch", channel=s["user_login"], title=s.get("title", ""),
                url=f"https://www.twitch.tv/{s['user_login']}", viewers=int(s.get("viewer_count", 0)),
                language=s.get("language", ""), category=s.get("game_name", ""))
        return list(found.values())


_twitch = TwitchAPI()
_warned: set[str] = set()


def find_live(topic: str, sites: list[str], limit: int = 20, extra: list[str] | None = None) -> list[LiveStream]:
    streams: list[LiveStream] = []
    for site in sites:
        try:
            if site == "youtube":
                streams += youtube_live(topic, limit, extra)
            elif site == "twitch":
                if _twitch.configured:
                    streams += _twitch.live(topic, limit)
                elif "twitch" not in _warned:
                    _warned.add("twitch")
                    print("  ! Twitch search skipped: set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET "
                          "(free app at dev.twitch.tv/console). See clipbot/README.md.", file=sys.stderr)
        except Exception as exc:  # one site failing shouldn't stop the hunt
            print(f"  ! {site} search failed: {exc}", file=sys.stderr, flush=True)
    return sorted(streams, key=lambda s: -s.viewers)
