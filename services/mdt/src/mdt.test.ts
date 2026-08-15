// services/mdt/src/mdt.test.ts
//
// Compile-sanity and core-behaviour unit tests for the MDT_Service (task 23.1,
// Requirement 12). These verify concrete examples of the required behaviour;
// the property tests (tasks 23.2–23.4) cover universal properties.

import { describe, expect, it } from "vitest";

import {
  addComment,
  castVote,
  createTask,
  openMdtRecord,
  recordDecision,
  registeredUserResolver,
  MAX_COMMENT_LENGTH,
  MDT_STATUS_DECIDED,
  MDT_STATUS_OPEN
} from "./index.js";

const AT = "2024-01-01T12:00:00.000Z";
const registered = registeredUserResolver(["alice", "bob", "carol"]);

function openRecord() {
  const result = openMdtRecord({
    caseId: "case-1",
    hypothesisId: "hyp-1",
    createdById: "alice",
    at: AT,
    isAuthorised: true
  });
  if (!result.ok) throw new Error("expected record to open");
  return result.record;
}

describe("openMdtRecord", () => {
  it("opens an empty collaboration record for a card", () => {
    const record = openRecord();
    expect(record.entityType).toBe("MdtDecision");
    expect(record.hypothesisId).toBe("hyp-1");
    expect(record.status).toBe(MDT_STATUS_OPEN);
    expect(record.comments).toEqual([]);
    expect(record.votes).toEqual([]);
  });

  it("rejects an unauthorised open, producing no record", () => {
    const result = openMdtRecord({
      caseId: "case-1",
      hypothesisId: "hyp-1",
      createdById: "mallory",
      at: AT,
      isAuthorised: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_authorised");
  });
});

describe("addComment (Req 12.1, 12.2, 12.7)", () => {
  it("stores a valid comment with author, timestamp, and resolved mentions", () => {
    const result = addComment(openRecord(), {
      authorId: "alice",
      body: "Please review, @bob",
      at: AT,
      mentions: ["bob", "bob"],
      isAuthorised: true,
      isRegisteredUser: registered
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comment.authorId).toBe("alice");
      expect(result.comment.at).toBe(AT);
      expect(result.comment.mentions).toEqual(["bob"]);
      expect(result.record.comments).toHaveLength(1);
    }
  });

  it("rejects an empty comment and a too-long comment, leaving the record unchanged", () => {
    const record = openRecord();
    for (const body of ["", "x".repeat(MAX_COMMENT_LENGTH + 1)]) {
      const result = addComment(record, {
        authorId: "alice",
        body,
        at: AT,
        isAuthorised: true,
        isRegisteredUser: registered
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_comment_length");
        expect(result.record).toBe(record);
      }
    }
  });

  it("rejects a comment mentioning an unregistered user", () => {
    const result = addComment(openRecord(), {
      authorId: "alice",
      body: "hi @nobody",
      at: AT,
      mentions: ["nobody"],
      isAuthorised: true,
      isRegisteredUser: registered
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unregistered_mention");
  });

  it("rejects an unauthorised comment leaving the record unchanged", () => {
    const record = openRecord();
    const result = addComment(record, {
      authorId: "mallory",
      body: "hi",
      at: AT,
      isAuthorised: false,
      isRegisteredUser: registered
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_authorised");
      expect(result.record).toBe(record);
    }
  });
});

describe("castVote (Req 12.5, 12.7)", () => {
  it("keeps at most one vote per user by replacing a repeat vote", () => {
    let record = openRecord();
    const first = castVote(record, {
      userId: "alice",
      value: "support",
      at: AT,
      isAuthorised: true,
      isRegisteredUser: registered
    });
    expect(first.ok).toBe(true);
    if (first.ok) record = first.record;

    const second = castVote(record, {
      userId: "alice",
      value: "oppose",
      at: AT,
      isAuthorised: true,
      isRegisteredUser: registered
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.replacedPrevious).toBe(true);
      expect(second.record.votes).toHaveLength(1);
      expect(second.record.votes[0]?.value).toBe("oppose");
    }
  });

  it("rejects an unauthorised vote leaving the record unchanged", () => {
    const record = openRecord();
    const result = castVote(record, {
      userId: "alice",
      value: "support",
      at: AT,
      isAuthorised: false,
      isRegisteredUser: registered
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.record).toBe(record);
  });
});

describe("recordDecision (Req 12.3, 12.6, 12.7)", () => {
  it("records decision, disposition, participants, and timestamp", () => {
    const result = recordDecision(openRecord(), {
      decision: "Refer for segregation testing",
      disposition: "unresolved",
      participants: ["alice", "bob", "alice"],
      userId: "alice",
      at: AT,
      isAuthorised: true,
      isRegisteredUser: registered
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.decision).toBe("Refer for segregation testing");
      expect(result.record.disposition).toBe("unresolved");
      expect(result.record.participants).toEqual(["alice", "bob"]);
      expect(result.record.decidedAt).toBe(AT);
      expect(result.record.status).toBe(MDT_STATUS_DECIDED);
    }
  });

  it("rejects a decision with an unregistered participant", () => {
    const result = recordDecision(openRecord(), {
      decision: "d",
      disposition: "p",
      participants: ["nobody"],
      userId: "alice",
      at: AT,
      isAuthorised: true,
      isRegisteredUser: registered
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unregistered_user");
  });
});

describe("createTask (Req 12.4, 12.7)", () => {
  it("assigns a task to exactly one registered user", () => {
    const result = createTask({
      caseId: "case-1",
      assigneeId: "bob",
      description: "Order confirmatory panel",
      createdById: "alice",
      at: AT,
      isAuthorised: true,
      isRegisteredUser: registered
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.assigneeId).toBe("bob");
      expect(result.task.state).toBe("open");
    }
  });

  it("rejects a task assigned to an unregistered user", () => {
    const result = createTask({
      caseId: "case-1",
      assigneeId: "nobody",
      description: "x",
      createdById: "alice",
      at: AT,
      isAuthorised: true,
      isRegisteredUser: registered
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unregistered_assignee");
  });
});
