import assert from "node:assert/strict";
import test from "node:test";
import { encodeRealtimeFeed } from "./gtfs.ts";
import { planOuting } from "./index.ts";
import { formatEasternTime, PlanOutingInputSchema, planOutingWorkflow } from "./lib.ts";

const now = new Date("2026-06-28T16:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

const stationRows = [
  {
    ada: "0",
    borough: "M",
    complex_id: "1",
    daytime_routes: "2",
    gtfs_latitude: "40.6900",
    gtfs_longitude: "-74.0100",
    gtfs_stop_id: "100",
    stop_name: "Far constituent",
  },
  {
    ada: "1",
    borough: "M",
    complex_id: "1",
    daytime_routes: "1",
    gtfs_latitude: "40.7001",
    gtfs_longitude: "-74.0001",
    gtfs_stop_id: "101",
    stop_name: "Origin",
  },
  {
    ada: "0",
    borough: "M",
    complex_id: "2",
    daytime_routes: "1",
    gtfs_latitude: "40.7100",
    gtfs_longitude: "-73.9900",
    gtfs_stop_id: "102",
    stop_name: "Middle",
  },
  {
    ada: "1",
    borough: "M",
    complex_id: "3",
    daytime_routes: "1",
    gtfs_latitude: "40.7200",
    gtfs_longitude: "-73.9800",
    gtfs_stop_id: "103",
    stop_name: "Destination",
  },
  {
    ada: "0",
    borough: "M",
    complex_id: "4",
    daytime_routes: "1",
    gtfs_latitude: "40.7300",
    gtfs_longitude: "-73.9700",
    gtfs_stop_id: "104",
    stop_name: "Farther",
  },
  {
    ada: "0",
    borough: "M",
    complex_id: "5",
    daytime_routes: "1",
    gtfs_latitude: "40.7400",
    gtfs_longitude: "-73.9600",
    gtfs_stop_id: "105",
    stop_name: "Farthest",
  },
  {
    ada: "0",
    borough: "M",
    complex_id: "6",
    daytime_routes: "2",
    gtfs_latitude: "40.6900",
    gtfs_longitude: "-74.0200",
    gtfs_stop_id: "106",
    stop_name: "Other middle",
  },
  {
    ada: "0",
    borough: "M",
    complex_id: "7",
    daytime_routes: "2",
    gtfs_latitude: "40.6800",
    gtfs_longitude: "-74.0300",
    gtfs_stop_id: "107",
    stop_name: "Other farther",
  },
  {
    ada: "0",
    borough: "M",
    complex_id: "8",
    daytime_routes: "2",
    gtfs_latitude: "40.6700",
    gtfs_longitude: "-74.0400",
    gtfs_stop_id: "108",
    stop_name: "Other farthest",
  },
];

const realtimeFeed = encodeRealtimeFeed({
  header: {
    gtfsRealtimeVersion: "2.0",
    timestamp: String(nowSeconds),
  },
  entity: [
    {
      id: "far-outbound",
      tripUpdate: {
        trip: { routeId: "2", tripId: "far-outbound-trip" },
        stopTimeUpdate: [stop("100N", 4), stop("102N", 9), stop("103N", 14)],
      },
    },
    {
      id: "outbound",
      tripUpdate: {
        trip: { directionId: 0, routeId: "1", tripId: "outbound-trip" },
        stopTimeUpdate: [
          stop("101N", 5),
          stop("102N", 10),
          stop("103N", 15),
          stop("104N", 20),
          stop("105N", 25),
        ],
      },
    },
    {
      id: "other-outbound",
      tripUpdate: {
        trip: { directionId: 1, routeId: "2", tripId: "other-outbound-trip" },
        stopTimeUpdate: [stop("101S", 6), stop("106S", 11), stop("107S", 16), stop("108S", 21)],
      },
    },
    {
      id: "later-outbound",
      tripUpdate: {
        trip: { directionId: 0, routeId: "1", tripId: "later-outbound-trip" },
        stopTimeUpdate: [
          stop("101N", 7),
          stop("102N", 12),
          stop("103N", 17),
          stop("104N", 22),
          stop("105N", 27),
        ],
      },
    },
    {
      id: "return",
      tripUpdate: {
        trip: { routeId: "1", tripId: "return-trip" },
        stopTimeUpdate: [stop("103S", 35), stop("102S", 40), stop("101S", 45)],
      },
    },
  ],
});

test("plans an outing through dependent API results", async () => {
  const fetchCalls: string[] = [];
  const artRequestTracker = { active: 0, maxActive: 0 };
  const result = await planOutingWorkflow(
    {
      startingPoint: "Ship venue",
      timeBudgetMinutes: 90,
    },
    {
      fetch: mockFetch(
        fetchCalls,
        [
          {
            address: "Destination Plaza",
            artwork_type2: "Artwork",
            inscription: "A very surprising inscription",
            latitude: "40.7201,",
            longitude: "-73.9801",
            material: "Bronze",
            subject_keyword: "Transit",
            title: "The Departure",
          },
        ],
        { artRequestTracker },
      ),
      now: () => now,
    },
  );

  assert.equal(result.status, "planned");

  if (result.status !== "planned") {
    return;
  }

  assert.equal(result.origin.station.name, "Origin");
  assert.equal(result.asOf, "06/28/2026 12:00:00 PM EDT");
  assert.deepEqual(result.origin.station.routes, ["1", "2"]);
  assert.equal(result.origin.station.stopId, "101");
  assert.equal(result.outbound.route, "1");
  assert.equal(result.outbound.departureTime, "06/28/2026 12:05:00 PM EDT");
  assert.equal(result.outbound.arrivalTime, "06/28/2026 12:15:00 PM EDT");
  assert.equal(result.outbound.destinationStation.name, "Destination");
  assert.equal(result.outbound.stopsChecked, 3);
  assert.equal(result.routeSearchesRun, 2);
  assert.equal(result.destination.artwork.title, "The Departure");
  assert.equal(result.returnPlan.verification, "live");
  assert.equal(result.returnPlan.tripId, "return-trip");
  assert.equal(result.returnPlan.departureFromDestination, "06/28/2026 12:35:00 PM EDT");
  assert.equal(result.steps.length, 8);
  assert.match(result.steps[0], /Resolved Ship venue, Manhattan, NY with NYC Planning GeoSearch/);
  assert.match(result.steps[1], /Located Origin as the nearest station complex/);
  assert.match(result.steps[2], /Loaded 5 realtime trip predictions/);
  assert.match(result.steps[3], /Ran 2 route-and-direction searches with up to 4 concurrent/);
  assert.match(
    result.steps[4],
    /Route search 1 northbound, departing 06\/28\/2026 12:05:00 PM EDT: checked 3 stop\(s\) inward and found "The Departure" near Destination/,
  );
  assert.match(
    result.steps[5],
    /Route search 2 southbound, departing 06\/28\/2026 12:06:00 PM EDT: checked 2 stop\(s\), but none satisfied/,
  );
  assert.match(result.steps[6], /Selected "The Departure" near Destination/);
  assert.match(
    result.steps[7],
    /Validated a live return on route 1, departing 06\/28\/2026 12:35:00 PM EDT/,
  );
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));

  const geocodeCall = fetchCalls.findIndex((url) => url.includes("geosearch"));
  const stationsCall = fetchCalls.findIndex((url) => url.includes("39hk-dx4f"));
  const realtimeCall = fetchCalls.findIndex((url) => url.includes("mtagtfsfeeds"));
  const artworkCall = fetchCalls.findIndex((url) => url.includes("2pg3-gcaa"));

  assert.ok(geocodeCall < stationsCall);
  assert.ok(stationsCall < realtimeCall);
  assert.ok(realtimeCall < artworkCall);
  assert.equal(artRequestTracker.maxActive, 2);
  assert.equal(fetchCalls.filter((url) => url.includes("2pg3-gcaa")).length, 2);
});

test("falls back through the NYS geocoder to OpenStreetMap for landmarks", async () => {
  const fetchCalls: string[] = [];
  const result = await planOutingWorkflow(
    {
      startingPoint: "Pier 17",
      timeBudgetMinutes: 90,
    },
    {
      fetch: mockFetch(
        fetchCalls,
        [
          {
            latitude: "40.7201",
            longitude: "-73.9801",
            title: "The Departure",
          },
        ],
        { geocoder: "openstreetmap" },
      ),
      now: () => now,
    },
  );

  assert.equal(result.status, "planned");

  if (result.status !== "planned") {
    return;
  }

  assert.equal(result.origin.place.geocoder, "openstreetmap");
  assert.match(result.warnings[0], /OpenStreetMap/);
  assert.ok(result.sources.some(({ name }) => name === "© OpenStreetMap contributors (Nominatim)"));
  assert.equal(fetchCalls.filter((url) => url.includes("geosearch")).length, 2);
  assert.equal(fetchCalls.filter((url) => url.includes("nysgeohub")).length, 1);
  assert.equal(fetchCalls.filter((url) => url.includes("nominatim")).length, 1);
});

test("uses the official NYS fallback for street addresses", async () => {
  const fetchCalls: string[] = [];
  const result = await planOutingWorkflow(
    {
      startingPoint: "89 South Street",
      timeBudgetMinutes: 90,
    },
    {
      fetch: mockFetch(
        fetchCalls,
        [
          {
            latitude: "40.7201",
            longitude: "-73.9801",
            title: "The Departure",
          },
        ],
        { geocoder: "nys" },
      ),
      now: () => now,
    },
  );

  assert.equal(result.status, "planned");

  if (result.status !== "planned") {
    return;
  }

  assert.equal(result.origin.place.geocoder, "nys-geocoder");
  assert.match(result.warnings[0], /New York State geocoder/);
  assert.equal(fetchCalls.filter((url) => url.includes("nominatim")).length, 0);
  const nysCallUrl = fetchCalls.find((url) => url.includes("nysgeohub"));
  assert.ok(nysCallUrl);
  const nysCall = new URL(nysCallUrl);
  assert.equal(nysCall.searchParams.get("SingleLine"), "89 South Street, New York, NY");
});

test("returns a stable error when no geocoder can resolve the input", async () => {
  await assert.rejects(
    planOutingWorkflow(
      {
        startingPoint: "Definitely nowhere",
        timeBudgetMinutes: 90,
      },
      {
        fetch: mockFetch([], [], { geocoder: "none" }),
        now: () => now,
      },
    ),
    /No available geocoder could resolve "Definitely nowhere" within New York City/,
  );
});

test("returns a bounded no-plan result when downstream stops have no nearby art", async () => {
  const fetchCalls: string[] = [];
  const result = await planOutingWorkflow(
    {
      interests: ["art"],
      maxWalkMinutes: 10,
      startingPoint: "Ship venue",
      timeBudgetMinutes: 90,
    },
    {
      fetch: mockFetch(fetchCalls, []),
      now: () => now,
    },
  );

  assert.equal(result.status, "no-plan");
  assert.match(result.reason, /artwork stop/);
  assert.equal("steps" in result, false);
  assert.equal(fetchCalls.filter((url) => url.includes("2pg3-gcaa")).length, 2);
});

test("keeps a plan when one concurrent route search fails", async () => {
  const result = await planOutingWorkflow(
    {
      startingPoint: "Ship venue",
      timeBudgetMinutes: 90,
    },
    {
      fetch: mockFetch(
        [],
        [
          {
            latitude: "40.7201",
            longitude: "-73.9801",
            title: "The Departure",
          },
        ],
        {
          failArtQuery: (url) => url.searchParams.get("$where")?.includes("-74.04") ?? false,
        },
      ),
      now: () => now,
    },
  );

  assert.equal(result.status, "planned");

  if (result.status !== "planned") {
    return;
  }

  assert.equal(result.routeSearchesFailed, 1);
  assert.ok(result.warnings.some((warning) => warning.includes("route search(es)")));
});

test("reports unavailable when every concurrent route search fails", async () => {
  await assert.rejects(
    planOutingWorkflow(
      {
        startingPoint: "Ship venue",
        timeBudgetMinutes: 90,
      },
      {
        fetch: mockFetch([], [], { failArtQuery: () => true }),
        now: () => now,
      },
    ),
    /Every route search failed because NYC Open Data was unavailable/,
  );
});

test("paginates deterministic artwork queries", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({
    latitude: "40.5000",
    longitude: "-73.8000",
    title: `Far artwork ${index}`,
  }));
  const fetchCalls: string[] = [];
  const result = await planOutingWorkflow(
    {
      startingPoint: "Ship venue",
      timeBudgetMinutes: 90,
    },
    {
      fetch: mockFetch(fetchCalls, [], {
        artworkPages: [
          firstPage,
          [{ latitude: "40.7201", longitude: "-73.9801", title: "Second Page Art" }],
        ],
      }),
      now: () => now,
    },
  );

  assert.equal(result.status, "planned");

  if (result.status === "planned") {
    assert.equal(result.destination.artwork.title, "Second Page Art");
  }

  const artCalls = fetchCalls.filter((url) => url.includes("2pg3-gcaa"));
  assert.equal(artCalls.length, 4);
  assert.ok(
    artCalls.every(
      (url) =>
        new URL(url).searchParams.get("$order") ===
        "title ASC, latitude ASC, longitude ASC, :id ASC",
    ),
  );
  assert.deepEqual(
    artCalls.map((url) => new URL(url).searchParams.get("$offset")),
    ["0", "0", "1000", "1000"],
  );
});

test("caps each route search at 24 inward candidates", async () => {
  const fetchCalls: string[] = [];
  const manyStations = Array.from({ length: 27 }, (_, index) => ({
    ada: "1",
    borough: "M",
    complex_id: String(200 + index),
    daytime_routes: "1",
    gtfs_latitude: String(40.7 + index * 0.001),
    gtfs_longitude: "-74",
    gtfs_stop_id: String(200 + index),
    stop_name: index === 0 ? "Origin" : `Stop ${index}`,
  }));
  const manyStopsFeed = encodeRealtimeFeed({
    header: {
      gtfsRealtimeVersion: "2.0",
      timestamp: String(nowSeconds),
    },
    entity: [
      {
        id: "many-stops",
        tripUpdate: {
          trip: { directionId: 0, routeId: "1", tripId: "many-stops-trip" },
          stopTimeUpdate: manyStations.map((station, index) =>
            stop(`${station.gtfs_stop_id}N`, 5 + index * 3),
          ),
        },
      },
    ],
  });
  const result = await planOutingWorkflow(
    {
      startingPoint: "Ship venue",
      timeBudgetMinutes: 240,
    },
    {
      fetch: mockFetch(fetchCalls, [], {
        realtimeFixture: manyStopsFeed,
        stationFixture: manyStations,
      }),
      now: () => now,
    },
  );

  assert.equal(result.status, "no-plan");
  assert.equal("stopsChecked" in result ? result.stopsChecked : undefined, 24);
  assert.equal("routeSearchesTruncated" in result ? result.routeSearchesTruncated : undefined, 1);
  const artCalls = fetchCalls.filter((url) => url.includes("2pg3-gcaa"));
  assert.equal(artCalls.length, 4);
  assert.deepEqual(
    artCalls.map(
      (url) => new URL(url).searchParams.get("$where")?.match(/replace\(latitude/g)?.length,
    ),
    [6, 6, 6, 6],
  );
  assert.ok(result.warnings.some((warning) => warning.includes("24-stop inspection limit")));
});

test("runs every route search through a four-wide concurrency pool", async () => {
  const routes = ["1", "2", "3", "4", "5"];
  const artRequestTracker = { active: 0, maxActive: 0 };
  const poolStations = [
    {
      ada: "1",
      borough: "M",
      complex_id: "300",
      daytime_routes: routes.join(" "),
      gtfs_latitude: "40.7",
      gtfs_longitude: "-74",
      gtfs_stop_id: "300",
      stop_name: "Origin",
    },
    ...routes.flatMap((route, index) => [
      {
        ada: "1",
        borough: "M",
        complex_id: `${route}10`,
        daytime_routes: route,
        gtfs_latitude: String(40.705 + index * 0.02),
        gtfs_longitude: "-73.99",
        gtfs_stop_id: `${route}10`,
        stop_name: `${route} middle`,
      },
      {
        ada: "1",
        borough: "M",
        complex_id: `${route}11`,
        daytime_routes: route,
        gtfs_latitude: String(40.71 + index * 0.02),
        gtfs_longitude: "-73.98",
        gtfs_stop_id: `${route}11`,
        stop_name: `${route} destination`,
      },
    ]),
  ];
  const poolFeed = encodeRealtimeFeed({
    header: {
      gtfsRealtimeVersion: "2.0",
      timestamp: String(nowSeconds),
    },
    entity: [
      ...routes.map((route, index) => ({
        id: `route-${route}`,
        tripUpdate: {
          trip: { directionId: 0, routeId: route, tripId: `route-${route}-trip` },
          stopTimeUpdate: [
            stop("300N", 5 + index),
            stop(`${route}10N`, 10 + index),
            stop(`${route}11N`, 15 + index),
          ],
        },
      })),
      {
        id: "route-5-return",
        tripUpdate: {
          trip: { directionId: 1, routeId: "5", tripId: "route-5-return-trip" },
          stopTimeUpdate: [stop("511S", 35), stop("510S", 40), stop("300S", 45)],
        },
      },
    ],
  });
  const result = await planOutingWorkflow(
    {
      startingPoint: "Ship venue",
      timeBudgetMinutes: 90,
    },
    {
      fetch: mockFetch([], [], {
        artRequestTracker,
        realtimeFixture: poolFeed,
        stationFixture: poolStations,
      }),
      now: () => now,
    },
  );

  assert.equal(result.status, "no-plan");
  assert.equal("routeSearchesRun" in result ? result.routeSearchesRun : undefined, 5);
  assert.equal(artRequestTracker.maxActive, 4);

  const recovered = await planOutingWorkflow(
    {
      startingPoint: "Ship venue",
      timeBudgetMinutes: 90,
    },
    {
      fetch: mockFetch(
        [],
        [{ latitude: "40.7901", longitude: "-73.9801", title: "Fifth Route Art" }],
        {
          failArtQuery: (url) => !(url.searchParams.get("$where")?.includes("40.783") ?? false),
          realtimeFixture: poolFeed,
          stationFixture: poolStations,
        },
      ),
      now: () => now,
    },
  );

  assert.equal(recovered.status, "planned");

  if (recovered.status === "planned") {
    assert.equal(recovered.outbound.route, "5");
    assert.equal(recovered.routeSearchesFailed, 4);
    assert.equal(recovered.routeSearchesRun, 5);
  }
});

test("keeps preferences optional in the exposed tool contract", () => {
  const input = PlanOutingInputSchema.parse({
    startingPoint: "Pier 17",
    timeBudgetMinutes: 60,
  });
  const required = (planOuting.inputSchema as { required?: string[] }).required;

  assert.equal(input.interests, undefined);
  assert.equal(input.maxWalkMinutes, undefined);
  assert.deepEqual(required, ["startingPoint", "timeBudgetMinutes"]);
  assert.match(planOuting.description, /steps array/i);
  assert.match(
    planOuting.description,
    /use that array to tell the user how the result was reached/i,
  );
  assert.match(planOuting.description, /do not suggest alternatives/i);
});

test("formats timestamps in Eastern time across daylight saving changes", () => {
  assert.equal(formatEasternTime(nowSeconds), "06/28/2026 12:00:00 PM EDT");
  assert.equal(
    formatEasternTime(Math.floor(new Date("2026-01-15T12:00:00.000Z").getTime() / 1000)),
    "01/15/2026 07:00:00 AM EST",
  );
});

function stop(stopId: string, minutesFromNow: number) {
  const time = String(nowSeconds + minutesFromNow * 60);

  return {
    arrival: { time },
    departure: { time },
    stopId,
  };
}

function mockFetch(
  fetchCalls: string[],
  artworks: object[],
  {
    artRequestTracker,
    artworkPages,
    failArtQuery,
    geocoder = "nyc",
    realtimeFixture = realtimeFeed,
    stationFixture = stationRows,
  }: {
    artRequestTracker?: { active: number; maxActive: number };
    artworkPages?: object[][];
    failArtQuery?: (url: URL) => boolean;
    geocoder?: "none" | "nyc" | "nys" | "openstreetmap";
    realtimeFixture?: Uint8Array;
    stationFixture?: object[];
  } = {},
) {
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    fetchCalls.push(url.toString());

    if (url.hostname === "geosearch.planninglabs.nyc") {
      if (geocoder !== "nyc") {
        return new Response("Unavailable", { status: 503 });
      }

      return jsonResponse({
        features: [
          {
            geometry: { coordinates: [-74, 40.7] },
            properties: { label: "Ship venue, Manhattan, NY" },
          },
        ],
      });
    }

    if (url.hostname === "nysgeohub.ny.gov") {
      return jsonResponse({
        candidates:
          geocoder === "nys"
            ? [
                {
                  address: "89 South Street, New York, NY, 10038",
                  location: { x: -74, y: 40.7 },
                  score: 100,
                },
              ]
            : [],
      });
    }

    if (url.hostname === "nominatim.openstreetmap.org") {
      return jsonResponse(
        geocoder === "openstreetmap"
          ? [
              {
                address: { borough: "Manhattan", postcode: "10038" },
                display_name: "Pier 17, Manhattan, New York, NY, 10038",
                lat: "40.7",
                lon: "-74",
              },
            ]
          : [],
      );
    }

    if (url.hostname === "data.ny.gov") {
      return jsonResponse(stationFixture);
    }

    if (url.hostname === "api-endpoint.mta.info") {
      const body = new ArrayBuffer(realtimeFixture.byteLength);
      new Uint8Array(body).set(realtimeFixture);
      return new Response(body, { status: 200 });
    }

    if (url.hostname === "data.cityofnewyork.us") {
      if (failArtQuery?.(url)) {
        return new Response("Unavailable", { status: 503 });
      }

      if (artRequestTracker) {
        artRequestTracker.active += 1;
        artRequestTracker.maxActive = Math.max(
          artRequestTracker.maxActive,
          artRequestTracker.active,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        artRequestTracker.active -= 1;
      }

      const offset = Number(url.searchParams.get("$offset") ?? 0);
      return jsonResponse(artworkPages?.[offset / 1000] ?? artworks);
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
