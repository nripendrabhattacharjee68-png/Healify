#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8787}"
PATIENT_PHONE="+919999000001"

send_otp_resp="$(curl -s -X POST "$BASE_URL/auth/send-otp" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PATIENT_PHONE\",\"role\":\"patient\"}")"

echo "send_otp: $send_otp_resp"

code="$(printf '%s' "$send_otp_resp" | sed -n 's/.*"demo_code":"\([0-9]\{6\}\)".*/\1/p')"
if [[ -z "$code" ]]; then
  echo "Could not parse demo_code" >&2
  exit 1
fi

verify_resp="$(curl -s -X POST "$BASE_URL/auth/verify-otp" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PATIENT_PHONE\",\"role\":\"patient\",\"code\":\"$code\"}")"

echo "verify_otp: $verify_resp"

user_id="$(printf '%s' "$verify_resp" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [[ -z "$user_id" ]]; then
  echo "Could not parse user id" >&2
  exit 1
fi

access_token="$(printf '%s' "$verify_resp" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
if [[ -z "$access_token" ]]; then
  echo "Could not parse access token" >&2
  exit 1
fi

refresh_token="$(printf '%s' "$verify_resp" | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')"
if [[ -z "$refresh_token" ]]; then
  echo "Could not parse refresh token" >&2
  exit 1
fi

auth_header="Authorization: Bearer $access_token"

onboard_resp="$(curl -s -X POST "$BASE_URL/patients/onboarding" -H 'content-type: application/json' -H "$auth_header" \
  -d "{\"user_id\":\"$user_id\",\"name\":\"Smoke Patient\",\"affected_side\":\"left\",\"stroke_date\":\"2026-01-15\",\"mobility_level\":\"moderate\",\"caregiver_phone\":\"+919999000002\",\"consent_accepted\":true}")"

echo "onboarding: $onboard_resp"

session_resp="$(curl -s -X POST "$BASE_URL/sessions/start" -H 'content-type: application/json' -H "$auth_header" \
  -d "{\"patient_id\":\"$user_id\"}")"

echo "session_start: $session_resp"

session_id="$(printf '%s' "$session_resp" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"

curl -s -X POST "$BASE_URL/sessions/$session_id/checkin" -H 'content-type: application/json' -H "$auth_header" \
  -d '{"pain_pre":2,"fatigue_pre":3,"red_flags":{"chest_pain":false,"uncontrolled_bp":false,"new_neuro":false}}' >/dev/null

curl -s -X POST "$BASE_URL/sessions/$session_id/exercise-result" -H 'content-type: application/json' -H "$auth_header" \
  -d '{"exercise_code":"seated_knee_extension","total_reps":10,"valid_reps":7,"avg_rom":35,"avg_quality":72,"assisted_reps":2}' >/dev/null

finish_resp="$(curl -s -X POST "$BASE_URL/sessions/$session_id/finish" -H 'content-type: application/json' -H "$auth_header" \
  -d '{"pain_post":3,"fatigue_post":4}')"

echo "session_finish: $finish_resp"

echo "progress:"
curl -s "$BASE_URL/patients/$user_id/progress?days=7" -H "$auth_header"

echo

refresh_resp="$(curl -s -X POST "$BASE_URL/auth/refresh" -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$refresh_token\"}")"
echo "refresh: $refresh_resp"

rotated_access="$(printf '%s' "$refresh_resp" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
rotated_refresh="$(printf '%s' "$refresh_resp" | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')"
if [[ -z "$rotated_access" || -z "$rotated_refresh" ]]; then
  echo "Could not parse rotated tokens" >&2
  exit 1
fi

logout_resp="$(curl -s -X POST "$BASE_URL/auth/logout" -H 'content-type: application/json' \
  -H "Authorization: Bearer $rotated_access" \
  -d "{\"refresh_token\":\"$rotated_refresh\"}")"
echo "logout: $logout_resp"

refresh_after_logout_http="$(curl -s -o /tmp/helify_refresh_after_logout.json -w '%{http_code}' -X POST \
  "$BASE_URL/auth/refresh" -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$rotated_refresh\"}")"
echo "refresh_after_logout_status: $refresh_after_logout_http"
if [[ "$refresh_after_logout_http" -lt 400 ]]; then
  echo "Expected refresh token to be rejected after logout" >&2
  cat /tmp/helify_refresh_after_logout.json >&2
  exit 1
fi
