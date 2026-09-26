from unittest.mock import MagicMock
import pytest
from garmin_client.real_client import RealGarminClient, _decode_track_from_detail


def client_with(api):
    client = RealGarminClient('/tmp/garmin-test', 'test')
    client._client = api
    return client


def test_indoor_samples_and_unknown_metrics_are_kept():
    data = {'metricDescriptors': [{'key': 'directTimestamp', 'metricsIndex': 0}, {'key': 'directHeartRate', 'metricsIndex': 1}, {'key': 'directPower', 'metricsIndex': 2}, {'key': 'newMetric', 'metricsIndex': 3}], 'activityDetailMetrics': [{'metrics': [1000, 120, 200, 42]}]}
    assert _decode_track_from_detail(data) == []
    assert _decode_track_from_detail(data, include_non_gps=True) == [{'t': 1000, 'hr': 120, 'power': 200, 'newMetric': 42}]


def test_collect_optional_failures_and_empty_responses():
    class Api:
        def good(self): return {'value': 42}
        def empty(self): return []
        def broken(self): raise RuntimeError('private account details')
    data, statuses = client_with(Api())._collect({k: (k, ()) for k in ['good', 'empty', 'broken', 'missing']})
    assert data == {'good': {'value': 42}}
    assert statuses == {'good': 'ok', 'empty': 'empty', 'broken': 'error', 'missing': 'unsupported'}
    assert 'private' not in str(statuses)


def test_authentication_failure_stops_optional_calls():
    class GarminConnectAuthenticationError(Exception): pass
    class Api:
        def broken(self): raise GarminConnectAuthenticationError()
    with pytest.raises(GarminConnectAuthenticationError):
        client_with(Api())._collect({'daily': ('broken', ())})


def test_health_fetches_all_categories_and_keeps_nested_data():
    api = MagicMock()
    for method in ['get_stats', 'get_heart_rates', 'get_steps_data', 'get_floors', 'get_sleep_data', 'get_hrv_data', 'get_stress_data', 'get_body_battery', 'get_spo2_data', 'get_respiration_data', 'get_intensity_minutes_data', 'get_rhr_day', 'get_max_metrics', 'get_training_status', 'get_training_readiness', 'get_fitnessage_data']:
        getattr(api, method).return_value = {'value': 42}
    result = client_with(api).get_health_json('2026-09-25')
    assert len(result['data']) == 16
    assert set(result['endpointStatus'].values()) == {'ok'}
    api.get_sleep_data.assert_called_once_with('2026-09-25')
    api.get_training_readiness.assert_called_once_with('2026-09-25')


def test_activity_fetches_zones_laps_strength_and_weather():
    api = MagicMock()
    api.get_activity.return_value = {'activityId': 1}
    api.get_activity_details.return_value = {}
    for method in ['get_activity_hr_in_timezones', 'get_activity_power_in_timezones', 'get_activity_splits', 'get_activity_typed_splits', 'get_activity_split_summaries', 'get_activity_exercise_sets', 'get_activity_weather', 'get_heart_rate_zones']:
        getattr(api, method).return_value = [{'value': 42}]
    result = client_with(api).get_activity_json(1)
    assert len(result['garminExtras']) == 8
    assert result['garminExtras']['exerciseSets'] == [{'value': 42}]
