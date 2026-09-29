import { describe, it, expect } from "vitest";
import { loginVerdict, visitorFrom, MAX_FAILURES_PER_IP, MAX_FAILURES_TOTAL } from "../src/loginGuard";

describe("loginVerdict", () => {
  it("allows until an IP reaches the failure limit", () => {
    expect(loginVerdict(MAX_FAILURES_PER_IP - 1, 0)).toBe("allow");
    expect(loginVerdict(MAX_FAILURES_PER_IP, MAX_FAILURES_PER_IP)).toBe("blocked_ip");
  });

  it("blocks everyone when guesses come from many places", () => {
    expect(loginVerdict(0, MAX_FAILURES_TOTAL)).toBe("blocked_all");
  });
});

describe("visitorFrom", () => {
  it("reads Cloudflare's headers and names the device", () => {
    const v = visitorFrom(
      new Headers({
        "cf-connecting-ip": "203.0.113.9",
        "cf-ipcountry": "KR",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      })
    );
    expect(v).toEqual({ ip: "203.0.113.9", country: "KR", device: "iPhone · Safari" });
  });

  it("copes with missing headers", () => {
    expect(visitorFrom(new Headers())).toEqual({ ip: "unknown", country: "?", device: "알 수 없는 기기" });
  });
});
