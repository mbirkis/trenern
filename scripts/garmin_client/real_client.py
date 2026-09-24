"""Real Garmin client wrapper using the garminconnect library.

Uses the installed garminconnect.Garmin class for API operations.
Token storage uses garth dump/load directory format (oauth1_token.json +
oauth2_token.json) as managed by garminconnect.Garmin.login(tokenstore=...).

GPS track data is decoded from the metricDescriptors + activityDetailMetrics
format returned by get_activity_details().
"""
import json
import logging
import os
from getpass import getpass
from pathlib import Path

from garminconnect import Garmin as GarminConnect

logger = logging.getLogger(__name__)

# The garminconnect library caps single requests at 1000 activities.
MAX_ACTIVITY_LIMIT = 1000


def _decode_track_from_detail(detail):
    """Decode metricDescriptors + activityDetailMetrics into unified track points.

    The Garmin API returns GPS data as positional arrays with descriptors mapping
    index->key. This produces the unified format the parser expects:
      [{lat, lon, ele?, hr?, t?, ...}, ...]

    Returns empty list if no valid GPS data is present.
    """
    descriptors = detail.get("metricDescriptors") or []
    samples = detail.get("activityDetailMetrics") or []

    if not descriptors or not samples:
        return []

    idx_to_key = {}
    for d in descriptors:
        key = d.get("key")
        idx = d.get("metricsIndex")
        if isinstance(key, str) and isinstance(idx, (int, float)) and idx >= 0:
            idx_to_key[int(idx)] = key

    if not idx_to_key:
        return []

    # Map garminconnect metric key names to our track field names
    KEY_MAP = {
        "lat": "lat",
        "lon": "lon",
        "lng": "lon",
        "ele": "ele",
        "elevation": "ele",
        "altitude": "ele",
        "heartRate": "hr",
        "time": "t",
        "cadence": "cad",
        "speed": "speed",
    }

    track = []
    for sample in samples:
        metrics = sample.get("metrics") or []
        pt = {}
        for idx, key_name in idx_to_key.items():
            if idx < len(metrics) and metrics[idx] is not None:
                mapped = KEY_MAP.get(key_name, key_name)
                pt[mapped] = metrics[idx]
        if "lat" in pt and "lon" in pt:
            track.append(pt)

    return track


def _merge_summary_and_detail(summary, detail):
    """Merge activity summary fields with detail fields.

    Detail takes precedence, but summary provides fields the detail endpoint
    may omit (e.g. startTime, activityName, activityType structure).
    Returns a single merged dict.
    """
    merged = dict(summary)
    merged.update(detail)
    return merged


class RealGarminClient:
    """Wraps garminconnect.Garmin with token management and CLI-friendly interface.

    Tokens are stored as a garth dump directory (oauth1_token.json +
    oauth2_token.json) at token_dir. This matches the format used by
    garminconnect.Garmin.login(tokenstore=...).

    Usage:
        # Resume from saved tokens:
        client = RealGarminClient(token_dir, source_id)
        if client.resume():
            activities = client.list_activities(0, 20)

        # Fresh login (interactive, prompts for password via getpass):
        client = RealGarminClient(token_dir, source_id)
        client.login("user@example.com")
    """

    def __init__(self, token_dir, source_id):
        self._token_dir = Path(token_dir).expanduser().resolve()
        self._source_id = source_id
        self._client = None

    # ── auth ──────────────────────────────────────────────────────────────

    def resume(self):
        """Load saved session tokens from the garth directory at token_dir.

        Returns True if tokens exist and are valid, False otherwise.
        Does NOT prompt for credentials.
        """
        oauth1 = self._token_dir / "oauth1_token.json"
        oauth2 = self._token_dir / "oauth2_token.json"

        if not oauth1.exists() or not oauth2.exists():
            logger.debug("Token directory %s missing token files", self._token_dir)
            return False

        try:
            api = GarminConnect()
            api.login(tokenstore=str(self._token_dir))
            self._client = api
            return True
        except Exception as exc:
            logger.warning(
                "Failed to resume session from %s: %s", self._token_dir, exc
            )
            self._client = None
            return False

    def login(self, email, mfa_callback=None):
        """Interactive login. Password read via getpass (masked, never in argv).

        Args:
            email: Garmin Connect account email.
            mfa_callback: Optional callable that returns the MFA code string.
                          Default prompts interactively.

        Returns True on success.
        """
        password = getpass("Garmin password: ")

        if mfa_callback is None:

            def default_mfa():
                return input("Garmin 2FA code: ")

            prompt_mfa = default_mfa
        else:
            prompt_mfa = mfa_callback

        api = GarminConnect(
            email=email,
            password=password,
            prompt_mfa=prompt_mfa,
        )
        api.login(tokenstore=str(self._token_dir))

        if not all((self._token_dir / name).is_file() for name in ("oauth1_token.json", "oauth2_token.json")):
            raise RuntimeError("Garmin login succeeded, but token files were not saved")
        self._token_dir.chmod(0o700)
        for f in self._token_dir.iterdir():
            if f.is_file():
                f.chmod(0o600)

        self._client = api
        return True

    def is_authenticated(self):
        """Return True if the client has a live authenticated session."""
        return self._client is not None

    # ── data access ───────────────────────────────────────────────────────

    def _ensure_authenticated(self):
        if not self._client:
            raise RuntimeError(
                "RealGarminClient is not authenticated. "
                "Call resume() with a valid token directory or login() first."
            )

    def list_activities(self, start=0, limit=20):
        """Return list of activity summaries from Garmin Connect API.

        Handles pagination for requests beyond the API's single-call limit
        (MAX_ACTIVITY_LIMIT = 1000).
        """
        self._ensure_authenticated()
        result = []
        remaining = limit
        offset = start

        while remaining > 0:
            batch_size = min(remaining, MAX_ACTIVITY_LIMIT)
            batch = self._client.get_activities(start=offset, limit=batch_size)
            if not batch:
                break
            result.extend(batch)
            remaining -= len(batch)
            offset += len(batch)
            if len(batch) < batch_size:
                break

        return result

    def get_activity_json(self, activity_id):
        """Return full activity detail including decoded GPS track.

        Combines get_activity() (summary) with get_activity_details()
        (full metrics + GPS). GPS track is decoded from the raw
        metricDescriptors format into unified {lat, lon, ele, hr, t} points.

        Raises ValueError if the activity_id is unknown.
        """
        self._ensure_authenticated()
        try:
            summary = self._client.get_activity(str(activity_id))
            detail = self._client.get_activity_details(
                str(activity_id), maxchart=2000, maxpoly=4000
            )
        except Exception as exc:
            raise ValueError(
                f"Activity {activity_id} not found or API error: {exc}"
            ) from exc

        merged = _merge_summary_and_detail(summary, detail)
        merged["track"] = _decode_track_from_detail(detail)
        return merged