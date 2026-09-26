"""Tests for RealGarminClient using offline fake transport (mocked garminconnect)."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest

from garmin_client.client import create_real_client, create_fake_client
from garmin_client.real_client import RealGarminClient


# ---------------------------------------------------------------------------
# Fixture data matching the Garmin Connect API shape
# ---------------------------------------------------------------------------

SAMPLE_ACTIVITIES_JSON = [
    {
        "activityId": 12345678,
        "activityName": "Morning Run",
        "startTime": "2024-06-15T07:30:00.0",
        "activityType": {"typeKey": "running", "typeId": 1},
        "distance": 10000.0,
        "duration": 3600.0,
        "movingDuration": 3500.0,
        "elevationGain": 85.0,
        "averageHeartRate": 145,
        "maxHeartRate": 170,
        "calories": 550,
        "steps": 12000,
        "averageSpeed": 4.2,
        "maxSpeed": 5.1,
        "averageCadence": 82,
        "averagePower": 210,
        "averageTemperature": 18,
        "hasPolyline": True,
        "ownerId": 98765,
        "ownerFullName": "Test User",
        "locationName": "Oslo",
        "timeZone": "Europe/Oslo",
        "beginTimestamp": 1718439000000,
        "endTimestamp": 1718442600000,
    },
    {
        "activityId": 12345680,
        "activityName": "Strength Training",
        "startTime": "2024-06-16T08:00:00.0",
        "activityType": {"typeKey": "strength_training"},
        "distance": 0,
        "duration": 2700,
        "movingDuration": 2700,
        "elevationGain": 0,
        "averageHeartRate": 110,
        "maxHeartRate": 140,
        "calories": 200,
        "hasPolyline": False,
        "ownerId": 98765,
        "ownerFullName": "Test User",
        "locationName": "Home Gym",
        "timeZone": "Europe/Oslo",
        "beginTimestamp": 1718510400000,
        "endTimestamp": 1718513100000,
    },
]

SAMPLE_ACTIVITY_DETAIL_JSON = {
    "activityId": 12345678,
    "activityName": "Morning Run",
    "startTime": "2024-06-15T07:30:00.0",
    "activityType": {"typeKey": "running", "typeId": 1},
    "distance": 10000.0,
    "duration": 3600.0,
    "movingDuration": 3500.0,
    "elevationGain": 85.0,
    "elevationLoss": 83.0,
    "averageHeartRate": 145,
    "maxHeartRate": 170,
    "calories": 550,
    "steps": 12000,
    "averageSpeed": 4.2,
    "maxSpeed": 5.1,
    "averageCadence": 82,
    "averagePower": 210,
    "averageTemperature": 18,
    "averageGrade": 0.5,
    "beginTimestamp": 1718439000000,
    "endTimestamp": 1718442600000,
    "ownerId": 98765,
    "ownerFullName": "Test User",
    "locationName": "Oslo",
    "timeZone": "Europe/Oslo",
    "hasPolyline": True,
    "metricDescriptors": [
        {"key": "lat", "metricsIndex": 0},
        {"key": "lon", "metricsIndex": 1},
        {"key": "ele", "metricsIndex": 2},
        {"key": "heartRate", "metricsIndex": 3},
        {"key": "time", "metricsIndex": 4},
    ],
    "activityDetailMetrics": [
        {"metrics": [59.91333, 10.75297, 100.0, 120, 0]},
        {"metrics": [59.91350, 10.75320, 100.5, 125, 10]},
        {"metrics": [59.91380, 10.75350, 101.0, 130, 20]},
        {"metrics": [59.91400, 10.75400, 101.5, 135, 30]},
        {"metrics": [59.91430, 10.75440, 102.0, 138, 40]},
        {"metrics": [59.91460, 10.75480, 102.5, 140, 50]},
        {"metrics": [59.91490, 10.75520, 103.0, 142, 60]},
        {"metrics": [59.91520, 10.75560, 103.5, 145, 70]},
        {"metrics": [59.91550, 10.75600, 104.0, 148, 80]},
        {"metrics": [59.91580, 10.75640, 104.5, 150, 90]},
    ],
}


# Helper: make a batch of N fake activities to test pagination
def _make_activity_batch(n, start_id=1000):
    return [
        {
            "activityId": start_id + i,
            "activityName": f"Activity {start_id + i}",
            "startTime": f"2024-06-{i % 30 + 1:02d}T08:00:00.0",
            "activityType": {"typeKey": "running", "typeId": 1},
            "distance": 5000.0 + i,
            "duration": 1800.0,
            "hasPolyline": True,
            "beginTimestamp": 1718439000000 + i * 86400000,
        }
        for i in range(n)
    ]


class TestCreateRealClient:
    """create_real_client must return a RealGarminClient instance."""

    def test_returns_real_client(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        assert isinstance(client, RealGarminClient)

    def test_real_client_has_expected_interface(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        assert hasattr(client, "list_activities")
        assert hasattr(client, "get_activity_json")
        assert hasattr(client, "is_authenticated")
        assert hasattr(client, "resume")
        assert hasattr(client, "login")


class TestRealClientResume:
    """RealGarminClient.resume() loads tokens from a garth directory."""

    def test_resume_from_valid_token_dir(self):
        """Resume from a directory containing garth-format token files."""
        with tempfile.TemporaryDirectory() as td:
            token_dir = Path(td) / "garmin-test-garmin"
            token_dir.mkdir(parents=True)
            (token_dir / "oauth1_token.json").write_text(
                json.dumps({
                    "token": "oauth1_token_val",
                    "token_secret": "secret",
                    "domain": "garmin.com",
                })
            )
            (token_dir / "oauth2_token.json").write_text(
                json.dumps({
                    "access_token": "access_val",
                    "refresh_token": "refresh_val",
                    "domain": "garmin.com",
                })
            )

            client = create_real_client(str(token_dir), "test-garmin")
            # Patch the imported name in real_client's namespace
            with patch("garmin_client.real_client.GarminConnect") as MockGarmin:
                mock_instance = MagicMock()
                MockGarmin.return_value = mock_instance
                mock_instance.login.side_effect = persist_tokens

                result = client.resume()
                assert result is True
                # Login called with token directory
                mock_instance.login.assert_called_once_with(
                    tokenstore=str(token_dir.resolve())
                )

    def test_resume_accepts_single_file_tokenstore(self, tmp_path):
        token_dir = tmp_path / 'garmin-connect'
        token_dir.mkdir()
        (token_dir / 'garmin_tokens.json').write_text('{}')
        client = create_real_client(str(token_dir), 'garmin-connect')
        with patch('garmin_client.real_client.GarminConnect') as MockGarmin:
            MockGarmin.return_value.login.return_value = (None, None)
            assert client.resume() is True
            MockGarmin.return_value.login.assert_called_once_with(tokenstore=str(token_dir))

    def test_resume_fails_with_missing_token_dir(self):
        """Resume returns False when token directory doesn't exist."""
        client = create_real_client("/nonexistent/keys/test", "test-garmin")
        result = client.resume()
        assert result is False
        assert client.is_authenticated() is False

    def test_resume_fails_on_api_error(self):
        """Resume returns False when garminconnect raises."""
        with tempfile.TemporaryDirectory() as td:
            token_dir = Path(td)
            (token_dir / "oauth1_token.json").write_text("{}")
            (token_dir / "oauth2_token.json").write_text("{}")

            client = create_real_client(str(token_dir), "test-garmin")
            with patch("garmin_client.real_client.GarminConnect") as MockGarmin:
                mock_instance = MagicMock()
                MockGarmin.return_value = mock_instance
                mock_instance.login.side_effect = Exception("API error")

                result = client.resume()
                assert result is False


class TestRealClientListActivities:
    """RealGarminClient.list_activities uses garminconnect.get_activities()."""

    def test_list_activities_delegates_to_api(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        with (
            patch("garmin_client.real_client.GarminConnect") as MockGarmin,
            patch.object(client, "_ensure_authenticated", return_value=True),
        ):
            mock_instance = MagicMock()
            MockGarmin.return_value = mock_instance
            client._client = mock_instance
            mock_instance.get_activities.return_value = SAMPLE_ACTIVITIES_JSON

            result = client.list_activities(start=0, limit=20)
            assert len(result) == 2
            mock_instance.get_activities.assert_called_once_with(
                start=0, limit=20
            )

    def test_list_activities_returns_api_format_with_activity_id(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            client._client.get_activities.return_value = SAMPLE_ACTIVITIES_JSON

            result = client.list_activities(start=0, limit=20)
            assert result[0]["activityId"] == 12345678
            assert result[1]["activityId"] == 12345680

    def test_list_activities_includes_non_gps_activities(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            client._client.get_activities.return_value = SAMPLE_ACTIVITIES_JSON

            result = client.list_activities(start=0, limit=20)
            types = [a["activityType"]["typeKey"] for a in result]
            assert "strength_training" in types

    def test_list_activities_paginates_beyond_max(self):
        """When limit > MAX_ACTIVITY_LIMIT (1000), multiple API calls."""
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            # Each call returns a full batch of 1000
            def mock_get_activities(start=0, limit=20, **kw):
                count = min(limit, 1000)
                return _make_activity_batch(count, start_id=start + 100000)
            client._client.get_activities.side_effect = mock_get_activities

            result = client.list_activities(start=0, limit=2500)
            assert len(result) >= 2000, f"Expected ~2500, got {len(result)}"
            # Should have called get_activities at least 2 times (1000+1000+500)
            assert client._client.get_activities.call_count >= 2


class TestRealClientGetActivityJson:
    """get_activity_json merges summary + detail and maps GPS fields."""

    def test_get_activity_json_returns_detail_with_track(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            client._client.get_activity.return_value = SAMPLE_ACTIVITIES_JSON[0]
            client._client.get_activity_details.return_value = SAMPLE_ACTIVITY_DETAIL_JSON

            result = client.get_activity_json(12345678)
            assert result is not None
            assert result["activityId"] == 12345678
            assert "track" in result
            assert len(result["track"]) > 0

    def test_gps_track_points_have_lat_lon_ele_hr_t(self):
        """Track points decoded from metricDescriptors have lat/lon/ele/hr/t."""
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            client._client.get_activity.return_value = SAMPLE_ACTIVITIES_JSON[0]
            client._client.get_activity_details.return_value = SAMPLE_ACTIVITY_DETAIL_JSON

            result = client.get_activity_json(12345678)
            pt = result["track"][0]
            assert "lat" in pt
            assert "lon" in pt
            assert pt["lat"] == 59.91333
            assert pt["lon"] == 10.75297
            assert pt.get("ele") == 100.0
            assert pt.get("hr") == 120
            assert pt.get("t") == 0

    def test_non_gps_activity_returns_summary_with_empty_track(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            client._client.get_activity.return_value = SAMPLE_ACTIVITIES_JSON[1]
            client._client.get_activity_details.return_value = {
                "activityId": 12345680,
                "activityName": "Strength Training",
                "activityType": {"typeKey": "strength_training"},
                "metricDescriptors": [],
                "activityDetailMetrics": [],
            }

            result = client.get_activity_json(12345680)
            assert result["activityId"] == 12345680
            track = result.get("track", [])
            assert track == []

    def test_unknown_id_raises_value_error(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            client._client.get_activity.side_effect = Exception("Activity not found")

            with pytest.raises(ValueError, match="Activity 99999999"):
                client.get_activity_json(99999999)

    def test_summary_and_detail_fields_are_merged(self):
        """Detail fields add to or override summary fields."""
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            summary = dict(SAMPLE_ACTIVITIES_JSON[0])
            detail = dict(SAMPLE_ACTIVITY_DETAIL_JSON)
            # Detail has fields summary doesn't
            detail["elevationLoss"] = 83.0
            detail["averageGrade"] = 0.5
            client._client.get_activity.return_value = summary
            client._client.get_activity_details.return_value = detail

            result = client.get_activity_json(12345678)
            # Both summary and detail fields present
            assert result["activityName"] == "Morning Run"
            assert result["elevationLoss"] == 83.0
            assert result["averageGrade"] == 0.5


def persist_tokens(*, tokenstore):
    directory = Path(tokenstore)
    directory.mkdir(parents=True, exist_ok=True)
    for name in ('oauth1_token.json', 'oauth2_token.json'):
        (directory / name).write_text('{}')
    return None, None


class TestRealClientLogin:
    """RealGarminClient.login handles interactive auth securely."""

    def test_login_creates_garmin_and_calls_login(self, tmp_path):
        client = create_real_client(str(tmp_path / 'garmin'), "test-garmin")
        with (
            patch("garmin_client.real_client.GarminConnect") as MockGarmin,
            patch("garmin_client.real_client.getpass", return_value="secret"),
        ):
            mock_instance = MagicMock()
            MockGarmin.return_value = mock_instance
            mock_instance.login.side_effect = persist_tokens

            result = client.login("test@example.com")
            assert result is True
            # Verify GarminConnect was constructed with email (password was
            # provided by patched getpass — value determined at runtime)
            call_kwargs = MockGarmin.call_args.kwargs
            assert call_kwargs.get("email") == "test@example.com"
            assert "password" in call_kwargs, "password must be passed"
            # prompt_mfa should be a callable
            prompt_mfa = call_kwargs.get("prompt_mfa")
            assert callable(prompt_mfa), "prompt_mfa must be a callable"
            # Login was called with token directory
            mock_instance.login.assert_called_once_with(
                tokenstore=str(client._token_dir)
            )

    def test_login_with_mfa_prompts_for_code(self, tmp_path):
        """MFA callback is forwarded to the Garmin client."""
        client = create_real_client(str(tmp_path / 'garmin'), "test-garmin")
        mfa_code = None

        def mfa_callback():
            return "123456"

        with (
            patch("garmin_client.real_client.GarminConnect") as MockGarmin,
            patch("garmin_client.real_client.getpass", return_value="secret"),
        ):
            mock_instance = MagicMock()
            MockGarmin.return_value = mock_instance
            mock_instance.login.side_effect = persist_tokens

            result = client.login("test@example.com", mfa_callback=mfa_callback)
            assert result is True

    def test_login_saves_tokens_on_success(self):
        with tempfile.TemporaryDirectory() as td:
            token_dir = Path(td)
            client = create_real_client(str(token_dir), "test-garmin")
            with (
                patch("garmin_client.real_client.GarminConnect") as MockGarmin,
                patch("garmin_client.real_client.getpass", return_value="p"),
            ):
                mock_instance = MagicMock()
                MockGarmin.return_value = mock_instance
                mock_instance.login.side_effect = persist_tokens

                result = client.login("test@example.com")
                assert result is True
    def test_login_accepts_single_file_tokenstore_and_restricts_permissions(self, tmp_path):
        token_dir = tmp_path / 'garmin-connect'
        token_dir.mkdir(mode=0o755)
        client = create_real_client(str(token_dir), 'garmin-connect')
        def persist_single(*, tokenstore):
            (Path(tokenstore) / 'garmin_tokens.json').write_text('{}')
            return None, None
        with (patch('garmin_client.real_client.GarminConnect') as MockGarmin,
              patch('garmin_client.real_client.getpass', return_value='secret')):
            MockGarmin.return_value.login.side_effect = persist_single
            assert client.login('test@example.com') is True
        assert (token_dir.stat().st_mode & 0o777) == 0o700
        assert ((token_dir / 'garmin_tokens.json').stat().st_mode & 0o777) == 0o600

    def test_login_fails_when_garmin_did_not_persist_tokens(self, tmp_path):
        client = create_real_client(str(tmp_path / 'garmin'), 'test-garmin')
        with (patch('garmin_client.real_client.GarminConnect') as MockGarmin,
              patch('garmin_client.real_client.getpass', return_value='secret')):
            MockGarmin.return_value.login.return_value = (None, None)
            with pytest.raises(RuntimeError, match='token'):
                client.login('test@example.com')


class TestRealClientStableIds:
    """Activity IDs are stable Garmin IDs, not derived from distance/time."""

    def test_activity_id_is_garmin_provided_not_derived(self):
        client = create_real_client("/tmp/keys", "test-garmin")
        with patch.object(client, "_ensure_authenticated", return_value=True):
            client._client = MagicMock()
            client._client.get_activities.return_value = SAMPLE_ACTIVITIES_JSON

            results = client.list_activities(start=0, limit=20)
            for a in results:
                assert "activityId" in a
                assert isinstance(a["activityId"], int)


class TestCliNoFakeOnMissingToken:
    """CLI must never use fake client in runtime, even without token."""

    def test_cli_errors_without_token(self):
        """Running list-activities without --token must fail."""
        python_bin = str(
            Path(__file__).resolve().parent.parent / ".venv" / "bin" / "python"
        )
        result = subprocess.run(
            [python_bin, "-m", "garmin_client", "list-activities"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode != 0
        # Must mention token in error
        err = (result.stderr + result.stdout).lower()
        assert "token" in err


class TestGpsFromRawMetricDescriptors:
    """GPS track points decoded from raw metricDescriptors format."""

    def test_decode_garmin_direct_metric_keys(self):
        from garmin_client.real_client import _decode_track_from_detail

        detail = {
            "metricDescriptors": [
                {"key": "directTimestamp", "metricsIndex": 0},
                {"key": "directLongitude", "metricsIndex": 1},
                {"key": "directHeartRate", "metricsIndex": 2},
                {"key": "directLatitude", "metricsIndex": 3},
                {"key": "directElevation", "metricsIndex": 4},
                {"key": "directSpeed", "metricsIndex": 5},
                {"key": "directDoubleCadence", "metricsIndex": 6},
            ],
            "activityDetailMetrics": [
                {"metrics": [1718439000000, 10.75297, 120, 59.91333, 100, 3.5, 160]},
                {"metrics": [1718439010000, 10.75320, 125, 59.91350, 101, 3.6, 162]},
                {"metrics": [1718439020000, None, 130, None, 102, 3.6, 162]},
            ],
        }
        track = _decode_track_from_detail(detail)
        assert len(track) == 2
        assert track[0] == {
            "t": 1718439000000, "lon": 10.75297, "hr": 120,
            "lat": 59.91333, "ele": 100, "speed": 3.5, "cad": 160,
        }
        assert track[1]["lat"] == 59.91350

    def test_parse_metric_descriptors_to_track(self):
        from garmin_client.real_client import _decode_track_from_detail

        detail = SAMPLE_ACTIVITY_DETAIL_JSON
        track = _decode_track_from_detail(detail)
        assert len(track) == 10
        assert track[0]["lat"] == 59.91333
        assert track[0]["lon"] == 10.75297
        assert track[0]["hr"] == 120
        assert "ele" in track[0]

    def test_decode_empty_detail_returns_empty_track(self):
        from garmin_client.real_client import _decode_track_from_detail

        assert _decode_track_from_detail({}) == []
        assert _decode_track_from_detail(
            {"metricDescriptors": [], "activityDetailMetrics": []}
        ) == []
