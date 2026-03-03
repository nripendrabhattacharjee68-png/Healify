import jwt from "jsonwebtoken";
import { config } from "./config.js";

export function issueAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      phone: user.phone || ""
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
