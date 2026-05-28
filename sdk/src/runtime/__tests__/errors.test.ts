import { AlchemeApiError, parseApiErrorResponse } from "../errors";

describe("runtime api errors", () => {
  it("preserves JSON error body details", async () => {
    const error = await parseApiErrorResponse({
      status: 403,
      json: async () => ({
        error: "room_membership_required",
        message: "Room membership required",
        roomKey: "room-1",
      }),
    } as Response);

    expect(error).toBeInstanceOf(AlchemeApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "room_membership_required",
      message: "Room membership required",
      details: { roomKey: "room-1" },
    });
  });

  it("handles non-JSON error bodies", async () => {
    const error = await parseApiErrorResponse({
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    expect(error.code).toBe("request_failed");
  });
});
