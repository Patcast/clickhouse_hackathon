import type { UserInfoEntity, UserReadingProfile } from "./contract.js";

const SYNTHETIC_UPDATED_AT = "2026-08-28T00:00:00.000Z";

const profiles: Array<{
  id: string;
  readingProfile: UserReadingProfile;
}> = [
  {
    id: "user_demo_001",
    readingProfile: {
      lexileBand: { min: 200, target: 300, max: 400 },
      fleschKincaidGrade: 1,
      daleChall: 5.2,
      preferredCategories: ["Lit"],
      preferredTopics: ["animals", "friendship"],
    },
  },
  {
    id: "user_demo_002",
    readingProfile: {
      lexileBand: { min: 200, target: 300, max: 400 },
      fleschKincaidGrade: 2,
      daleChall: 6,
      preferredCategories: ["Lit"],
      preferredTopics: ["family", "adventure"],
    },
  },
  {
    id: "user_demo_003",
    readingProfile: {
      lexileBand: { min: 400, target: 500, max: 600 },
      fleschKincaidGrade: 2.2,
      daleChall: 6.2,
      preferredCategories: ["Lit"],
      preferredTopics: ["folktales", "kindness"],
    },
  },
  {
    id: "user_demo_004",
    readingProfile: {
      lexileBand: { min: 400, target: 500, max: 600 },
      fleschKincaidGrade: 3.6,
      daleChall: 5.2,
      preferredCategories: ["Lit"],
      preferredTopics: ["mystery", "friendship"],
    },
  },
  {
    id: "user_demo_005",
    readingProfile: {
      lexileBand: { min: 400, target: 500, max: 600 },
      fleschKincaidGrade: 2.9,
      daleChall: 5.8,
      preferredCategories: ["Info"],
      preferredTopics: ["animals", "nature"],
    },
  },
  {
    id: "user_demo_006",
    readingProfile: {
      lexileBand: { min: 400, target: 500, max: 600 },
      fleschKincaidGrade: 3.9,
      daleChall: 6.4,
      preferredCategories: ["Info"],
      preferredTopics: ["space", "science"],
    },
  },
  {
    id: "user_demo_007",
    readingProfile: {
      lexileBand: { min: 600, target: 700, max: 800 },
      fleschKincaidGrade: 4.2,
      daleChall: 7.2,
      preferredCategories: ["Lit"],
      preferredTopics: ["adventure", "mythology"],
    },
  },
  {
    id: "user_demo_008",
    readingProfile: {
      lexileBand: { min: 600, target: 700, max: 800 },
      fleschKincaidGrade: 5.2,
      daleChall: 5.9,
      preferredCategories: ["Lit"],
      preferredTopics: ["historical fiction", "mystery"],
    },
  },
  {
    id: "user_demo_009",
    readingProfile: {
      lexileBand: { min: 600, target: 700, max: 800 },
      fleschKincaidGrade: 5,
      daleChall: 7.1,
      preferredCategories: ["Info"],
      preferredTopics: ["history", "technology"],
    },
  },
  {
    id: "user_demo_010",
    readingProfile: {
      lexileBand: { min: 800, target: 900, max: 1000 },
      fleschKincaidGrade: 5.6,
      daleChall: 7.8,
      preferredCategories: ["Info"],
      preferredTopics: ["environment", "engineering"],
    },
  },
];

// CLEAR calibrates passage difficulty. These are synthetic matching targets,
// not measured student scores or real child records.
export function loadSyntheticUsers(): UserInfoEntity[] {
  return profiles.map((profile) => ({
    ...structuredClone(profile),
    updatedAt: SYNTHETIC_UPDATED_AT,
  }));
}
