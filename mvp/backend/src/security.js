const ONE_SECOND_MS = 1000;

function toSingleValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "";
    }
    return toSingleValue(value[0]);
  }
  if (value && typeof value === "object") {
    return sanitizeObject(value);
  }
  return value;
}

function sanitizeObject(source) {
  if (!source || typeof source !== "object") {
    return source;
  }
  for (const key of Object.keys(source)) {
    source[key] = toSingleValue(source[key]);
  }
  return source;
}

export function applyBasicSecurityHeaders(config) {
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

    if (config.nodeEnv === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    }

    next();
  };
}

export function preventParameterPollution() {
  return (req, _res, next) => {
    if (req.query) {
      sanitizeObject(req.query);
    }
    if (req.body && typeof req.body === "object") {
      sanitizeObject(req.body);
    }
    next();
  };
}

export function createRateLimiter({ name, windowMs, max, keyBuilder, message }) {
  const bucket = new Map();

  // Keep memory bounded for long-running services.
  const cleanupInterval = Math.max(windowMs, 60 * ONE_SECOND_MS);
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of bucket.entries()) {
      if (value.resetAt <= now) {
        bucket.delete(key);
      }
    }
  }, cleanupInterval).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyBuilder(req);
    const existing = bucket.get(key);

    let state = existing;
    if (!state || state.resetAt <= now) {
      state = {
        count: 0,
        resetAt: now + windowMs
      };
    }

    state.count += 1;
    bucket.set(key, state);

    const remaining = Math.max(0, max - state.count);
    const retryAfterSeconds = Math.ceil((state.resetAt - now) / ONE_SECOND_MS);

    res.setHeader("X-RateLimit-Policy", `${name};w=${Math.floor(windowMs / ONE_SECOND_MS)};m=${max}`);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(state.resetAt / ONE_SECOND_MS)));

    if (state.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, retryAfterSeconds)));
      return res.status(429).json({ error: message });
    }

    next();
  };
}
