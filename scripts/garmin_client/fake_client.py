"""Fake Garmin client using fixture data — no network calls."""
import json
from pathlib import Path

_fixtures_dir = Path(__file__).resolve().parent / "tests" / "fixtures"


class FakeGarminClient:
    """Returns canned fixture data. Used for testing the source adapter."""

    def __init__(self, fixtures_dir=None):
        self._dir = Path(fixtures_dir or _fixtures_dir)
        with open(self._dir / "test_activities.json") as f:
            self._activities = json.load(f)
        with open(self._dir / "test_activity_detail.json") as f:
            # Index by activityId for lookup
            self._details = {}
            detail = json.load(f)
            self._details[str(detail["activityId"])] = detail

    def list_activities(self, start=0, limit=20):
        """Return the fixture activity list."""
        return self._activities[start:start + limit]

    def get_activity_json(self, activity_id):
        """Return fixture detail. Unknown IDs raise ValueError."""
        a_id = str(activity_id)
        if a_id not in self._details:
            # Try constructing from activities list for non-detailed ones
            for a in self._activities:
                if str(a["activityId"]) == a_id:
                    return {
                        **a,
                        "track": [],
                        "elevationLoss": a.get("elevationGain", 0),
                        "movingDuration": a.get("duration", 0),
                    }
            raise ValueError(f"Activity {activity_id} not found")
        return dict(self._details[a_id])

    def is_authenticated(self):
        return True

    def resume(self, token_path):
        return True