"""Interface protocol for Garmin Connect clients (real and fake)."""


class GarminClientInterface:
    """Minimal interface that both real and fake Garmin clients implement."""

    def list_activities(self, start=0, limit=20):
        """Return list of activity summaries.

        Each item has at minimum:
          activityId (int/str), startTime (str), activityType (dict with typeKey)
          beginTimestamp (ms epoch), duration, distance, hasPolyline (bool)
        """
        raise NotImplementedError

    def get_activity_json(self, activity_id):
        """Return full activity detail including GPS track (if any).

        Returns dict with activity summary fields plus 'track' array of
        {lat, lon, ele?, hr?, t?} points. Non-GPS activities get empty track.
        Raises ValueError if activity_id is unknown.
        """
        raise NotImplementedError

    def is_authenticated(self):
        """Return True if the client has valid credentials loaded."""
        raise NotImplementedError

    def resume(self, token_path):
        """Load saved session token from disk. Returns True if successful."""
        raise NotImplementedError