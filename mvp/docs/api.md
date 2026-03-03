# Helify Paralysis MVP API Contract

## 1) POST /auth/send-otp
Request:
```json
{
  "phone": "+919999999999",
  "role": "patient"
}
```
Response:
```json
{
  "request_id": "otp_...",
  "expires_at": "2026-03-03T12:00:00.000Z"
}
```

## 2) POST /auth/verify-otp
Request:
```json
{
  "phone": "+919999999999",
  "role": "patient",
  "code": "123456"
}
```
Response:
```json
{
  "user": {
    "id": "usr_...",
    "role": "patient",
    "phone": "+919999999999"
  },
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": "7d"
}
```

All protected endpoints require:
`Authorization: Bearer <access_token>`

## 3) GET /me/profile
Response:
```json
{
  "user": { "id": "usr_...", "role": "patient" },
  "patient_profile": {
    "affected_side": "left",
    "stroke_date": "2026-01-01",
    "mobility_level": "mild"
  },
  "active_plan": {
    "id": "pln_...",
    "target_sessions_per_week": 5
  }
}
```

## 4) POST /patients/onboarding
Request:
```json
{
  "user_id": "usr_patient",
  "name": "Patient A",
  "affected_side": "left",
  "stroke_date": "2026-01-01",
  "mobility_level": "moderate",
  "caregiver_phone": "+919888888888",
  "consent_accepted": true
}
```

## 5) POST /sessions/start
Request:
```json
{ "patient_id": "usr_patient" }
```
Response:
```json
{ "session": { "id": "ses_...", "status": "started" } }
```

## 6) POST /sessions/{id}/checkin
Request:
```json
{
  "pain_pre": 3,
  "fatigue_pre": 4,
  "red_flags": {
    "chest_pain": false,
    "uncontrolled_bp": false,
    "new_neuro": false
  }
}
```
Response:
```json
{
  "session": { "id": "ses_...", "status": "started" },
  "has_red_flag": false
}
```

## 7) POST /sessions/{id}/exercise-result
Request:
```json
{
  "exercise_code": "seated_knee_extension",
  "total_reps": 10,
  "valid_reps": 7,
  "avg_rom": 35,
  "avg_quality": 72,
  "assisted_reps": 4
}
```

## 8) POST /sessions/{id}/finish
Request:
```json
{
  "pain_post": 4,
  "fatigue_post": 5
}
```
Response:
```json
{
  "session": { "id": "ses_...", "status": "completed" },
  "alerts": []
}
```

## 9) GET /patients/{id}/progress?days=7
Response:
```json
{
  "trend": [
    {
      "date": "2026-03-01",
      "completed_sessions": 1,
      "valid_rep_rate": 70,
      "pain_delta": 1
    }
  ],
  "totals": {
    "completed_sessions": 4,
    "adherence_pct": 80
  }
}
```

## 10) GET /physio/alerts?status=open
Response:
```json
[
  {
    "id": "alr_...",
    "patient_id": "usr_patient",
    "type": "RED_FLAG_CHECKIN",
    "severity": "high",
    "status": "open"
  }
]
```

## 11) POST /physio/alerts/{id}/resolve
Request:
```json
{
  "physio_id": "usr_physio",
  "resolution_note": "Called patient and paused exercise"
}
```

## 12) POST /physio/patients/{id}/plan
Request:
```json
{
  "target_sessions_per_week": 5,
  "knee_extension_reps": 10,
  "straight_leg_raise_reps": 8,
  "ankle_or_heel_slide_reps": 10
}
```
