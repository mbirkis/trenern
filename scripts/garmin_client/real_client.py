"""Real Garmin client wrapper using the garminconnect library."""


class RealGarminClient:
    """Wraps garminconnect.GarminConnectClient with token management.

    Not fully implemented: requires Garmin credentials, MFA handling,
    and token storage. Use FakeGarminClient for tests.
    """

    def __init__(self, token_dir, source_id):
        self._token_dir = token_dir
        self._source_id = source_id
        self._client = None

    def list_activities(self, start=0, limit=20):
        raise NotImplementedError(
            "RealGarminClient requires authentication. "
            "Use auth-garmin.mjs to bootstrap credentials first, "
            "then call resume(token_path)."
        )

    def get_activity_json(self, activity_id):
        raise NotImplementedError

    def is_authenticated(self):
        return self._client is not None

    def resume(self, token_path):
        raise NotImplementedError