"""Tests for garmin_client CLI runner (called by Node adapter via subprocess)."""
import json
import subprocess
import sys
from pathlib import Path

_PYTHON = [
    str(
        Path(__file__).resolve().parent.parent / ".venv" / "bin" / "python"
        if sys.platform != "win32"
        else "python"
    )
]


class TestCliRunner:
    """The CLI runner must support these subcommands via `python -m garmin_client`."""

    def test_list_activities_subcommand(self):
        """list-activities returns valid JSON array with required fields."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "list-activities", "--start", "0", "--limit", "20"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0, f"stdout: {result.stdout}\nstderr: {result.stderr}"
        data = json.loads(result.stdout)
        assert isinstance(data, list)
        assert len(data) > 0
        for a in data:
            assert "activityId" in a
            assert "startTime" in a
            assert "activityType" in a

    def test_get_activity_subcommand(self):
        """get-activity returns full activity detail with track."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "get-activity", "--activity-id", "12345678"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0, f"stdout: {result.stdout}\nstderr: {result.stderr}"
        data = json.loads(result.stdout)
        assert data["activityId"] == 12345678
        assert "track" in data
        assert len(data["track"]) > 0

    def test_get_activity_non_gps(self):
        """Non-GPS activities return summary with empty track."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "get-activity", "--activity-id", "12345680"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0, f"stdout: {result.stdout}\nstderr: {result.stderr}"
        data = json.loads(result.stdout)
        assert data["activityId"] == 12345680
        track = data.get("track", [])
        assert track == [] or track is None

    def test_unknown_activity_returns_nonzero(self):
        """Unknown ID causes non-zero exit."""
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "get-activity", "--activity-id", "99999999"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0

    def test_invalid_subcommand_returns_nonzero(self):
        result = subprocess.run(
            [*_PYTHON, "-m", "garmin_client", "invalid-command"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0