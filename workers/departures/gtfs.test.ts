import assert from "node:assert/strict";
import test from "node:test";
import { decodeRealtimeFeed } from "./gtfs.ts";

// Hand-wired from the official GTFS-Realtime field numbers and independently
// checked with protoc --decode_raw. This must not use the local test encoder.
const feedFixture = new Uint8Array([
  10, 11, 10, 3, 50, 46, 48, 24, 128, 226, 207, 170, 6, 18, 45, 10, 1, 101, 26, 40, 10, 6, 10, 1,
  116, 42, 1, 49, 18, 14, 18, 6, 16, 188, 226, 207, 170, 6, 34, 4, 49, 48, 49, 78, 18, 14, 26, 6,
  16, 248, 226, 207, 170, 6, 34, 4, 49, 48, 50, 78,
]);

test("decodes an independently encoded GTFS-Realtime feed", () => {
  assert.deepEqual(decodeRealtimeFeed(feedFixture), {
    journeys: [
      {
        entityId: "e",
        routeId: "1",
        stops: [
          {
            arrivalTime: 1_700_000_060,
            baseStopId: "101",
            departureTime: undefined,
            realtimeStopId: "101N",
          },
          {
            arrivalTime: undefined,
            baseStopId: "102",
            departureTime: 1_700_000_120,
            realtimeStopId: "102N",
          },
        ],
        tripId: "t",
      },
    ],
    timestamp: 1_700_000_000,
  });
});
