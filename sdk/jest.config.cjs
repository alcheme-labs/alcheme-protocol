module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: [
    "<rootDir>/src/runtime/__tests__/communication.test.ts",
    "<rootDir>/src/runtime/__tests__/errors.test.ts",
    "<rootDir>/src/runtime/__tests__/fetch.test.ts",
    "<rootDir>/src/runtime/__tests__/knowledge-context.test.ts",
    "<rootDir>/src/runtime/__tests__/source-materials.test.ts",
    "<rootDir>/src/runtime/__tests__/voice.test.ts"
  ],
  moduleFileExtensions: ["ts", "js", "json"]
};
