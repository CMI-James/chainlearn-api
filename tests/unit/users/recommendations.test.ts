import { describe, it, expect } from "vitest";
import {
  rankCourses,
  scoreCourse,
  targetLevel,
  DIFFICULTY_ORDER,
  type CandidateCourse,
  type RecommendationProfile,
} from "../../../src/modules/users/recommendations.js";

const baseProfile: RecommendationProfile = {
  learningGoal: null,
  background: null,
  pace: "medium",
  interestTags: [],
  highestCompletedLevel: -1,
  averageScorePercent: null,
};

function course(overrides: Partial<CandidateCourse> & { id: string }): CandidateCourse {
  return {
    title: "Course",
    description: "A course",
    difficulty: "beginner",
    tags: [],
    peerEnrollments: 0,
    ...overrides,
  };
}

describe("targetLevel", () => {
  it("starts at beginner for a new learner", () => {
    expect(targetLevel(baseProfile)).toBe(0);
  });

  it("moves one level above the highest completed", () => {
    expect(targetLevel({ ...baseProfile, highestCompletedLevel: 0 })).toBe(1);
  });

  it("stays at the reached level when quiz scores are low", () => {
    expect(
      targetLevel({ ...baseProfile, highestCompletedLevel: 1, averageScorePercent: 40 }),
    ).toBe(1);
  });

  it("skips ahead for a fast learner with high scores", () => {
    expect(
      targetLevel({ ...baseProfile, pace: "fast", highestCompletedLevel: 0, averageScorePercent: 95 }),
    ).toBe(2);
  });

  it("caps at the top difficulty level when the user has completed everything (#593)", () => {
    const topLevel = DIFFICULTY_ORDER.length - 1;
    expect(
      targetLevel({ ...baseProfile, highestCompletedLevel: topLevel, averageScorePercent: 95, pace: "fast" }),
    ).toBe(topLevel);
  });

  it("stays at beginner for a slow-paced new learner with no completion history", () => {
    expect(targetLevel({ ...baseProfile, pace: "slow", highestCompletedLevel: -1 })).toBe(0);
  });
});

describe("scoreCourse", () => {
  it("scores a matching course higher than an unrelated one", () => {
    const profile = { ...baseProfile, interestTags: ["stellar", "wallets"], learningGoal: "learn stellar smart contracts" };
    const match = scoreCourse(profile, course({ id: "a", tags: ["stellar"], description: "Stellar smart contracts" }), 0);
    const other = scoreCourse(profile, course({ id: "b", tags: ["cooking"], difficulty: "advanced" }), 0);
    expect(match.confidence).toBeGreaterThan(other.confidence);
    expect(match.reasons.length).toBeGreaterThan(0);
  });

  it("keeps confidence within 0 and 1", () => {
    const profile = { ...baseProfile, interestTags: ["a"], learningGoal: "alpha beta gamma delta" };
    const scored = scoreCourse(
      profile,
      course({ id: "a", tags: ["a"], title: "alpha beta gamma", peerEnrollments: 5 }),
      5,
    );
    expect(scored.confidence).toBeLessThanOrEqual(1);
    expect(scored.confidence).toBeGreaterThan(0);
  });
});

describe("rankCourses", () => {
  it("orders by confidence, limits the result and drops zero-signal courses", () => {
    const profile = { ...baseProfile, interestTags: ["stellar"] };
    const ranked = rankCourses(
      profile,
      [
        course({ id: "low", title: "Low", tags: ["x"], difficulty: "advanced" }),
        course({ id: "high", title: "High", tags: ["stellar"] }),
        course({ id: "mid", title: "Mid", tags: ["x"], peerEnrollments: 3 }),
      ],
      2,
    );
    expect(ranked.map((r) => r.courseId)).toEqual(["high", "mid"]);
  });

  it("returns an empty list for a candidate pool with no signal at all (#593)", () => {
    const ranked = rankCourses(baseProfile, [
      course({ id: "a", difficulty: "advanced" }),
      course({ id: "b", difficulty: "advanced" }),
    ]);
    expect(ranked).toEqual([]);
  });

  it("still ranks beginner-level courses for a brand-new learner with no history (#593)", () => {
    const ranked = rankCourses(baseProfile, [
      course({ id: "beginner-course", difficulty: "beginner" }),
      course({ id: "advanced-course", difficulty: "advanced" }),
    ]);
    expect(ranked.map((r) => r.courseId)).toEqual(["beginner-course"]);
  });

  it("recommends the top difficulty level for a learner who has completed everything (#593)", () => {
    const topLevel = DIFFICULTY_ORDER.length - 1;
    const profile = { ...baseProfile, highestCompletedLevel: topLevel, averageScorePercent: 90 };
    const ranked = rankCourses(profile, [
      course({ id: "advanced-course", difficulty: "advanced" }),
      course({ id: "beginner-course", difficulty: "beginner" }),
    ]);
    expect(ranked[0]?.courseId).toBe("advanced-course");
  });

  it("returns an empty list when given no candidates", () => {
    expect(rankCourses(baseProfile, [])).toEqual([]);
  });

  it("respects a limit larger than the candidate pool without erroring", () => {
    const profile = { ...baseProfile, interestTags: ["stellar"] };
    const ranked = rankCourses(profile, [course({ id: "only", tags: ["stellar"] })], 10);
    expect(ranked).toHaveLength(1);
  });
});
