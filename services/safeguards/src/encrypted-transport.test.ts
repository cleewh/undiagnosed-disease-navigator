// services/safeguards/src/encrypted-transport.test.ts
//
// Example-based integration test for encrypted-transport enforcement
// (Safeguards_Service, design "Encrypted transport"). This is the task 29.6
// integration test; it is intentionally example-based (no property tag).
//
// Validates: Requirements 26.6

import { describe, it, expect } from "vitest";

import { guardTransport, guardTransportUrl } from "./transport.js";

describe("encrypted transport enforcement (Req 26.6)", () => {
  describe("guardTransport allows encrypted schemes", () => {
    for (const scheme of ["https", "wss", "tls", "HTTPS", "Wss", " tls "]) {
      it(`allows scheme "${scheme}"`, () => {
        const result = guardTransport({ scheme });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.scheme).toBe(scheme.trim().toLowerCase());
      });
    }

    it("allows an encrypted scheme with an explicit encrypted:true flag", () => {
      expect(guardTransport({ scheme: "https", encrypted: true }).ok).toBe(true);
    });
  });

  describe("guardTransport rejects unencrypted channels", () => {
    for (const scheme of ["http", "ws", "ftp", "none", ""]) {
      it(`rejects scheme "${scheme}" with unencrypted_transport`, () => {
        const result = guardTransport({ scheme });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("unencrypted_transport");
      });
    }

    it("rejects an explicit encrypted:false flag even on an encrypted scheme", () => {
      const result = guardTransport({ scheme: "https", encrypted: false });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("unencrypted_transport");
    });

    it("rejects wss/tls when explicitly flagged unencrypted", () => {
      expect(guardTransport({ scheme: "wss", encrypted: false }).ok).toBe(false);
      expect(guardTransport({ scheme: "tls", encrypted: false }).ok).toBe(false);
    });
  });

  describe("guardTransportUrl allows encrypted URLs", () => {
    for (const url of [
      "https://api.example.com/case",
      "wss://stream.example.com/socket",
      "tls://db.example.com:5432"
    ]) {
      it(`allows URL "${url}"`, () => {
        expect(guardTransportUrl(url).ok).toBe(true);
      });
    }
  });

  describe("guardTransportUrl rejects unencrypted or scheme-less URLs", () => {
    for (const url of [
      "http://api.example.com",
      "ws://stream.example.com/socket",
      "ftp://files.example.com",
      "none://nowhere",
      "no-scheme",
      "api.example.com/case"
    ]) {
      it(`rejects URL "${url}" with unencrypted_transport`, () => {
        const result = guardTransportUrl(url);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("unencrypted_transport");
      });
    }
  });
});
