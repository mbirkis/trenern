"""Tests for Garmin Client module using fake transport (no real API calls)."""
import json
import os
import tempfile
from pathlib import Path

# We test the module's public interface through the CLI runner.
# For unit testing the core logic, we import the client builder directly.
from garmin_client.client import (
    GarminClientInterface,
    create_fake_client,
    create_real_client,
)


class TestActivityListing:
    """list_activities returns activity summaries in expected format."""

    def test_returns_list_of_activities(self):
        client = create_fake_client()
        activities = client.list_activities(start=0, limit=20)
        assert isinstance(activities, list)
        assert len(activities) > 0

    def test_each_activity_has_required_fields(self):
        client = create_fake_client()
        activities = client.list_activities(start=0, limit=20)
        for a in activities:
            # Every activity must have a stable Garmin activity ID
            assert "activityId" in a, f"missing activityId in {a}"
            assert a["activityId"] is not None
            # Must have a start time
            assert "startTime" in a, f"missing startTime in {a}"
            # Must have a type
            assert "activityType" in a, f"missing activityType in {a}"
            assert "typeKey" in a["activityType"]

    def test_strength_training_has_no_polyline(self):
        """Non-GPS activities (strength, yoga, etc.) are still included."""
        client = create_fake_client()
        activities = client.list_activities(start=0, limit=20)
        strength = [a for a in activities if a["activityName"] == "Strength Training"]
        assert len(strength) == 1, "Strength Training must be in list"
        assert strength[0]["hasPolyline"] is False


class TestGetActivityJson:
    """get_activity_json returns full activity detail including GPS track."""

    def test_returns_full_activity_with_track_for_gps_activity(self):
        client = create_fake_client()
        detail = client.get_activity_json(activity_id="12345678")
        assert detail is not None
        assert "activityId" in detail
        assert detail["activityId"] == 12345678
        assert "track" in detail
        assert len(detail["track"]) > 0
        # Track points must have lat/lon
        pt = detail["track"][0]
        assert "lat" in pt
        assert "lon" in pt

    def test_non_gps_activity_returns_no_track(self):
        """Strength/hike activities without GPS still return summary but empty track."""
        client = create_fake_client()
        detail = client.get_activity_json(activity_id="12345680")
        assert detail is not None
        assert detail["activityId"] == 12345680
        # No track for GPS-less activities
        track = detail.get("track", [])
        assert track == [] or track is None, f"Expected no track, got {len(track)} points"

    def test_unknown_activity_raises_error(self):
        client = create_fake_client()
        try:
            client.get_activity_json(activity_id="99999999")
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "not found" in str(e).lower() or "unknown" in str(e).lower()


class TestFakeClientSession:
    """Fake client handles auth-like checks."""

    def test_is_authenticated_returns_true_by_default(self):
        client = create_fake_client()
        assert client.is_authenticated() is True

    def test_resume_returns_true(self):
        client = create_fake_client()
        assert client.resume(token_path="/tmp/fake") is True


class TestActivityIdStability:
    """Garmin activity IDs are stable across sync runs."""

    def test_same_activity_same_id(self):
        """Re-listing returns same ID for same activity."""
        client = create_fake_client()
        activities_a = client.list_activities(start=0, limit=20)
        activities_b = client.list_activities(start=0, limit=20)
        ids_a = [(a["activityId"], a.get("startTime", "")) for a in activities_a]
        ids_b = [(a["activityId"], a.get("startTime", "")) for a in activities_b]
        assert ids_a == ids_b

    def test_reget_returns_same_detail(self):
        client = create_fake_client()
        d1 = client.get_activity_json(activity_id="12345678")
        d2 = client.get_activity_json(activity_id="12345678")
        assert d1["activityId"] == d2["activityId"]
        assert len(d1["track"]) == len(d2["track"])


class TestIncrementalSyncKey:
    """Activities produce a stable cache key for ingest's modifiedTime check."""

    def test_cache_key_includes_activity_id_and_timestamp(self):
        client = create_fake_client()
        activities = client.list_activities(start=0, limit=20)
        for a in activities:
            assert "activityId" in a
            assert "beginTimestamp" in a or "startTime" in a