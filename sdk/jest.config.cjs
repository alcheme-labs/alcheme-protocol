module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: [
    "**/tests/**/*.test.ts",
    "**/tests/**/*.test.js",
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.test.js",
  ],
  moduleFileExtensions: ["ts", "js", "json"],
};
