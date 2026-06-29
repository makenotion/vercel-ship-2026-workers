import { z } from "zod";
import { decodeRealtimeFeed, type RealtimeJourney, type RealtimeStop } from "./gtfs.ts";

const GEOCODE_URL = "https://geosearch.planninglabs.nyc/v2/search";
const NYS_GEOCODE_URL =
  "https://nysgeohub.ny.gov/arcgis/rest/services/Geocoder/NYS_Geocoder/GeocodeServer/findAddressCandidates";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const STATIONS_URL = "https://data.ny.gov/resource/39hk-dx4f.json";
const PUBLIC_ART_URL = "https://data.cityofnewyork.us/resource/2pg3-gcaa.json";
const MTA_FEED_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/";

const WALKING_METERS_PER_MINUTE = 75;
const BOARDING_BUFFER_MINUTES = 2;
const MINIMUM_RIDE_MINUTES = 5;
const MINIMUM_DESTINATION_STOPS = 2;
const MINIMUM_VISIT_MINUTES = 10;
const ESTIMATED_RETURN_WAIT_MINUTES = 8;
const ROUTE_SEARCH_CONCURRENCY = 4;
const MAX_STOPS_PER_ROUTE_SEARCH = 24;
const ART_STATIONS_PER_QUERY = 6;
const ART_QUERY_PAGE_SIZE = 1000;
const MAX_ART_QUERY_PAGES = 2;
const MAX_FEED_AGE_SECONDS = 180;
const OVERALL_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_JSON_BYTES = 2_000_000;
const MAX_FEED_BYTES = 8_000_000;
const easternTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hour12: true,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
  year: "numeric",
});
const NYC_BOUNDS = {
  east: -73.7002,
  north: 40.9176,
  south: 40.4774,
  west: -74.2591,
} as const;

const feedGroups = [
  { path: "nyct%2Fgtfs", routes: ["1", "2", "3", "4", "5", "6", "7", "S", "GS"] },
  { path: "nyct%2Fgtfs-ace", routes: ["A", "C", "E", "H", "S"] },
  { path: "nyct%2Fgtfs-bdfm", routes: ["B", "D", "F", "M", "FS", "S"] },
  { path: "nyct%2Fgtfs-g", routes: ["G"] },
  { path: "nyct%2Fgtfs-jz", routes: ["J", "Z"] },
  { path: "nyct%2Fgtfs-nqrw", routes: ["N", "Q", "R", "W"] },
  { path: "nyct%2Fgtfs-l", routes: ["L"] },
  { path: "nyct%2Fgtfs-si", routes: ["SI", "SIR"] },
] as const;

const InterestSchema = z.enum(["art", "history", "parks", "surprise"]);

export const PlanOutingInputSchema = z.object({
  startingPoint: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .describe("A New York City address, intersection, venue, or landmark"),
  timeBudgetMinutes: z
    .number()
    .int()
    .min(45)
    .max(240)
    .describe("Total minutes available for the complete round trip"),
  interests: z
    .array(InterestSchema)
    .max(4)
    .optional()
    .describe("What kinds of destinations to favor"),
  maxWalkMinutes: z
    .number()
    .int()
    .min(5)
    .max(20)
    .optional()
    .describe("Maximum walking time for each walking leg"),
});

export type PlanOutingInput = z.infer<typeof PlanOutingInputSchema>;
type Interest = z.infer<typeof InterestSchema>;

type Dependencies = {
  fetch: typeof globalThis.fetch;
  now: () => Date;
};

const defaultDependencies: Dependencies = {
  fetch: globalThis.fetch,
  now: () => new Date(),
};

const GeocodeResponseSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({
        coordinates: z.tuple([z.number(), z.number()]),
      }),
      properties: z
        .object({
          borough: z.string().optional(),
          confidence: z.number().optional(),
          label: z.string(),
          neighbourhood: z.string().optional(),
          postalcode: z.string().optional(),
        })
        .loose(),
    }),
  ),
});

const NysGeocodeResponseSchema = z.object({
  candidates: z.array(
    z.object({
      address: z.string(),
      location: z.object({ x: z.number(), y: z.number() }),
      score: z.number(),
    }),
  ),
});

const NominatimResponseSchema = z.array(
  z.object({
    address: z
      .object({
        borough: z.string().optional(),
        city: z.string().optional(),
        city_district: z.string().optional(),
        neighbourhood: z.string().optional(),
        postcode: z.string().optional(),
        suburb: z.string().optional(),
      })
      .loose()
      .optional(),
    display_name: z.string(),
    lat: z.string(),
    lon: z.string(),
  }),
);

const StationRowSchema = z.object({
  ada: z.string().optional(),
  borough: z.string(),
  complex_id: z.union([z.string(), z.number()]),
  daytime_routes: z.string().optional(),
  gtfs_latitude: z.union([z.string(), z.number()]),
  gtfs_longitude: z.union([z.string(), z.number()]),
  gtfs_stop_id: z.string(),
  stop_name: z.string(),
});

const ArtworkRowSchema = z
  .object({
    address: z.string().optional(),
    alternate_title: z.string().optional(),
    artwork_type1: z.string().optional(),
    artwork_type2: z.string().optional(),
    borough: z.string().optional(),
    date_created: z.string().optional(),
    inscription: z.string().optional(),
    latitude: z.string(),
    location_name: z.string().optional(),
    longitude: z.string(),
    material: z.string().optional(),
    primary_artist_first: z.string().optional(),
    primary_artist_last: z.string().optional(),
    primary_artist_middle: z.string().optional(),
    subject_keyword: z.string().optional(),
    title: z.string(),
  })
  .loose();

type Coordinates = {
  latitude: number;
  longitude: number;
};

type Geocoder = "coordinates" | "nyc-geosearch" | "nys-geocoder" | "openstreetmap";

type Place = Coordinates & {
  borough?: string;
  confidence?: number;
  geocoder: Geocoder;
  label: string;
  neighbourhood?: string;
  postalCode?: string;
};

type Station = Coordinates & {
  ada: boolean;
  borough: string;
  complexId: string;
  members: Array<
    Coordinates & {
      ada: boolean;
      borough: string;
      name: string;
      stopId: string;
    }
  >;
  name: string;
  routes: string[];
  stopId: string;
  stopIds: string[];
};

type Artwork = Coordinates & {
  address?: string;
  artist?: string;
  borough?: string;
  created?: string;
  distanceMeters: number;
  inscription?: string;
  locationName?: string;
  material?: string;
  subject?: string;
  title: string;
  type?: string;
};

type ArtworkRecord = Omit<Artwork, "distanceMeters">;

type CatchableJourney = {
  departureTime: number;
  journey: RealtimeJourney;
  originDistanceMeters: number;
  originIndex: number;
  originStation: Station;
  originWalkMinutes: number;
};

type DestinationCandidate = {
  arrivalTime: number;
  station: Station;
};

type RouteSearch = {
  candidates: DestinationCandidate[];
  catchable: CatchableJourney;
  departureIndex: number;
  truncated: boolean;
};

type ReturnOption =
  | {
      arrivalAtOrigin: number;
      departureFromDestination: number;
      journey: RealtimeJourney;
      kind: "live";
      travelSeconds: number;
    }
  | {
      kind: "estimated";
      routeId: string;
      travelSeconds: number;
    };

type OutingSearchResult = {
  artwork: Artwork;
  candidate: DestinationCandidate;
  catchable: CatchableJourney;
  departureIndex: number;
  returnOption: ReturnOption;
  returnTiming: ReturnType<typeof buildReturnTiming>;
  stopsChecked: number;
};

type RouteSearchOutcome = {
  outing?: OutingSearchResult;
  stopsChecked: number;
};

export async function planOutingWorkflow(
  input: PlanOutingInput,
  dependencies: Dependencies = defaultDependencies,
) {
  const now = dependencies.now();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const deadlineSeconds = nowSeconds + input.timeBudgetMinutes * 60;
  const overallSignal = AbortSignal.timeout(OVERALL_TIMEOUT_MS);
  const interests = input.interests ?? ["surprise"];
  const maxWalkMinutes = input.maxWalkMinutes ?? 10;
  const warnings: string[] = [];

  const place = await geocode(input.startingPoint, dependencies, overallSignal);

  if (place.geocoder === "nys-geocoder") {
    warnings.push(
      "NYC GeoSearch was unavailable or had no match; the official New York State geocoder was used.",
    );
  } else if (place.geocoder === "openstreetmap") {
    warnings.push(
      "NYC GeoSearch and the New York State geocoder were unavailable or had no match; OpenStreetMap was used.",
    );
  }

  const stations = await getStations(dependencies, overallSignal);
  const origin = findNearestStation(place, stations);
  const originDistanceMeters = distanceMeters(place, origin);
  const originWalkMinutes = walkingMinutes(originDistanceMeters);
  const stationByStopId = stationsByStopId(stations);

  if (originWalkMinutes > maxWalkMinutes) {
    return {
      status: "no-plan" as const,
      asOf: formatEasternTime(nowSeconds),
      reason: "The nearest subway station is beyond the maximum walking time.",
      origin: {
        place,
        nearestStation: stationSummary(origin),
        walkMinutes: originWalkMinutes,
      },
      sources: geocoderSources(place.geocoder),
      warnings,
    };
  }

  const { failedFeeds, journeys, newestFeedTimestamp } = await getRealtimeJourneys(
    origin.routes,
    nowSeconds,
    dependencies,
    overallSignal,
  );

  if (failedFeeds > 0) {
    warnings.push(`${failedFeeds} relevant MTA realtime feed(s) were unavailable.`);
  }

  const catchableJourneys = findCatchableJourneys({
    journeys,
    maxWalkMinutes,
    nowSeconds,
    origin,
    place,
    stationByStopId,
  });

  if (catchableJourneys.length === 0) {
    return {
      status: "no-plan" as const,
      asOf: formatEasternTime(nowSeconds),
      reason: "No catchable train was present in the current MTA realtime feed.",
      origin: {
        place,
        nearestStation: stationSummary(origin),
        walkMinutes: originWalkMinutes,
      },
      sources: geocoderSources(place.geocoder),
      warnings,
    };
  }

  const routeSearches = buildRouteSearches({
    catchableJourneys,
    deadlineSeconds,
    stationByStopId,
  });
  const { results: searchResults, searchesRun } = await runRouteSearches({
    deadlineSeconds,
    dependencies,
    interests,
    journeys,
    maxWalkMinutes,
    overallSignal,
    routeSearches,
  });
  const failedSearches = searchResults.filter((result) => result.status === "rejected").length;
  const truncatedSearches = routeSearches
    .slice(0, searchesRun)
    .filter((search) => search.truncated).length;

  if (searchesRun > 0 && failedSearches === searchesRun) {
    throw new Error("Every route search failed because NYC Open Data was unavailable.");
  }

  if (failedSearches > 0) {
    warnings.push(`${failedSearches} route search(es) were unavailable.`);
  }

  if (truncatedSearches > 0) {
    warnings.push(`${truncatedSearches} route search(es) reached the 24-stop inspection limit.`);
  }

  const outing = searchResults
    .flatMap((result) =>
      result.status === "fulfilled" && result.value.outing ? [result.value.outing] : [],
    )
    .toSorted(
      (left, right) =>
        left.catchable.departureTime - right.catchable.departureTime ||
        right.candidate.arrivalTime - left.candidate.arrivalTime ||
        left.catchable.journey.routeId.localeCompare(right.catchable.journey.routeId) ||
        left.catchable.journey.tripId.localeCompare(right.catchable.journey.tripId) ||
        left.candidate.station.complexId.localeCompare(right.candidate.station.complexId),
    )[0];

  if (outing) {
    const {
      artwork,
      candidate,
      catchable,
      departureIndex,
      returnOption,
      returnTiming,
      stopsChecked,
    } = outing;
    const destinationWalkMinutes = walkingMinutes(artwork.distanceMeters);
    const arrivalAtArtwork = candidate.arrivalTime + destinationWalkMinutes * 60;

    if (returnOption.kind === "estimated") {
      warnings.push(
        "The return uses a currently observed reverse-service pattern, not a promised departure; check MTA service before returning.",
      );
    }

    warnings.push("MTA arrival predictions can change after this plan is generated.");

    return {
      status: "planned" as const,
      asOf: formatEasternTime(nowSeconds),
      origin: {
        place,
        station: stationSummary(catchable.originStation),
        distanceMeters: Math.round(catchable.originDistanceMeters),
        walkMinutes: catchable.originWalkMinutes,
      },
      outbound: {
        route: catchable.journey.routeId,
        tripId: catchable.journey.tripId,
        departureTime: formatEasternTime(catchable.departureTime),
        arrivalTime: formatEasternTime(candidate.arrivalTime),
        destinationStation: stationSummary(candidate.station),
        rideMinutes: minutesBetween(catchable.departureTime, candidate.arrivalTime),
        earlierCatchableTrips: departureIndex,
        stopsChecked,
      },
      destination: {
        artwork: artworkSummary(artwork),
        walkMinutesEachWay: destinationWalkMinutes,
        arrivalAtArtwork: formatEasternTime(arrivalAtArtwork),
      },
      returnPlan: {
        ...returnTiming,
        verification: returnOption.kind,
        route: returnOption.kind === "live" ? returnOption.journey.routeId : returnOption.routeId,
        tripId: returnOption.kind === "live" ? returnOption.journey.tripId : undefined,
      },
      deadline: formatEasternTime(deadlineSeconds),
      realtimeFeedTimestamp: newestFeedTimestamp
        ? formatEasternTime(newestFeedTimestamp)
        : undefined,
      routeSearchesFailed: failedSearches,
      routeSearchesRun: searchesRun,
      routeSearchesTruncated: truncatedSearches,
      steps: buildSuccessfulSteps({
        failedFeeds,
        journeys,
        origin,
        outing,
        place,
        routeSearches,
        searchResults,
        searchesRun,
      }),
      sources: [
        ...geocoderSources(place.geocoder),
        {
          name: "MTA Subway Stations",
          url: "https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f",
        },
        { name: "MTA GTFS-Realtime", url: "https://api.mta.info/" },
        {
          name: "NYC Public Design Commission Outdoor Public Art Inventory",
          url: "https://data.cityofnewyork.us/d/2pg3-gcaa",
        },
      ],
      warnings,
    };
  }

  return {
    status: "no-plan" as const,
    asOf: formatEasternTime(nowSeconds),
    reason:
      "The current departures did not produce an artwork stop with enough time for a reasonable return.",
    origin: {
      place,
      nearestStation: stationSummary(origin),
      walkMinutes: originWalkMinutes,
    },
    routeSearchesFailed: failedSearches,
    routeSearchesRun: searchesRun,
    routeSearchesTruncated: truncatedSearches,
    stopsChecked: searchResults.reduce(
      (total, result) => total + (result.status === "fulfilled" ? result.value.stopsChecked : 0),
      0,
    ),
    sources: geocoderSources(place.geocoder),
    warnings,
  };
}

async function geocode(
  startingPoint: string,
  dependencies: Dependencies,
  overallSignal: AbortSignal,
): Promise<Place> {
  const coordinateInput = parseCoordinateInput(startingPoint);

  if (coordinateInput) {
    return { ...coordinateInput, geocoder: "coordinates", label: startingPoint };
  }

  const providers = [geocodeWithNyc, geocodeWithNys, geocodeWithOpenStreetMap];

  for (const provider of providers) {
    try {
      const place = await provider(startingPoint, dependencies, overallSignal);

      if (place) {
        return place;
      }
    } catch {
      if (overallSignal.aborted) {
        throw new Error("Location lookup timed out before the starting point could be resolved.");
      }
    }
  }

  throw new Error(
    `No available geocoder could resolve ${JSON.stringify(startingPoint)} within New York City.`,
  );
}

async function geocodeWithNyc(
  startingPoint: string,
  dependencies: Dependencies,
  overallSignal: AbortSignal,
): Promise<Place | undefined> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("text", startingPoint);
  url.searchParams.set("size", "5");

  const payload = await fetchJson(url, dependencies, overallSignal);
  const response = GeocodeResponseSchema.parse(payload);
  const feature = response.features.find(({ geometry }) => {
    const [longitude, latitude] = geometry.coordinates;
    return isInNycBounds({ latitude, longitude });
  });

  if (!feature) {
    return undefined;
  }

  const [longitude, latitude] = feature.geometry.coordinates;

  return {
    borough: feature.properties.borough,
    confidence: feature.properties.confidence,
    geocoder: "nyc-geosearch",
    label: feature.properties.label,
    latitude,
    longitude,
    neighbourhood: feature.properties.neighbourhood,
    postalCode: feature.properties.postalcode,
  };
}

async function geocodeWithNys(
  startingPoint: string,
  dependencies: Dependencies,
  overallSignal: AbortSignal,
): Promise<Place | undefined> {
  const url = new URL(NYS_GEOCODE_URL);
  url.searchParams.set("SingleLine", qualifyForNysGeocoder(startingPoint));
  url.searchParams.set("f", "json");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("location", "-73.9857,40.7484");
  url.searchParams.set("maxLocations", "5");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set(
    "searchExtent",
    `${NYC_BOUNDS.west},${NYC_BOUNDS.south},${NYC_BOUNDS.east},${NYC_BOUNDS.north}`,
  );

  const response = NysGeocodeResponseSchema.parse(
    await fetchJson(url, dependencies, overallSignal),
  );
  const candidate = response.candidates
    .filter(
      ({ location, score }) =>
        score >= 95 && isInNycBounds({ latitude: location.y, longitude: location.x }),
    )
    .toSorted((left, right) => right.score - left.score)[0];

  if (!candidate) {
    return undefined;
  }

  return {
    confidence: candidate.score / 100,
    geocoder: "nys-geocoder",
    label: candidate.address,
    latitude: candidate.location.y,
    longitude: candidate.location.x,
  };
}

async function geocodeWithOpenStreetMap(
  startingPoint: string,
  dependencies: Dependencies,
  overallSignal: AbortSignal,
): Promise<Place | undefined> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("accept-language", "en");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("bounded", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("q", startingPoint);
  url.searchParams.set(
    "viewbox",
    `${NYC_BOUNDS.west},${NYC_BOUNDS.north},${NYC_BOUNDS.east},${NYC_BOUNDS.south}`,
  );

  const response = NominatimResponseSchema.parse(
    await fetchJson(url, dependencies, overallSignal, { maxAttempts: 1 }),
  );

  for (const result of response) {
    const latitude = numericValue(result.lat);
    const longitude = numericValue(result.lon);

    if (latitude === undefined || longitude === undefined) {
      continue;
    }

    if (!isInNycBounds({ latitude, longitude })) {
      continue;
    }

    return {
      borough: result.address?.borough ?? result.address?.city_district,
      geocoder: "openstreetmap",
      label: result.display_name,
      latitude,
      longitude,
      neighbourhood: result.address?.neighbourhood ?? result.address?.suburb,
      postalCode: result.address?.postcode,
    };
  }

  return undefined;
}

async function getStations(dependencies: Dependencies, overallSignal: AbortSignal) {
  const url = new URL(STATIONS_URL);
  url.searchParams.set(
    "$select",
    "gtfs_stop_id,complex_id,stop_name,borough,daytime_routes,gtfs_latitude,gtfs_longitude,ada",
  );
  url.searchParams.set("$limit", "5000");

  const rows = parseRows(StationRowSchema, await fetchJson(url, dependencies, overallSignal));
  const groups = new Map<string, Station>();

  for (const row of rows) {
    const latitude = numericValue(row.gtfs_latitude);
    const longitude = numericValue(row.gtfs_longitude);

    if (latitude === undefined || longitude === undefined) {
      continue;
    }

    const complexId = String(row.complex_id);
    const existing = groups.get(complexId);
    const routes = splitRoutes(row.daytime_routes);
    const member = {
      ada: row.ada === "1",
      borough: row.borough,
      latitude,
      longitude,
      name: row.stop_name,
      stopId: row.gtfs_stop_id,
    };

    if (existing) {
      existing.stopIds = unique([...existing.stopIds, row.gtfs_stop_id]);
      existing.routes = unique([...existing.routes, ...routes]);
      existing.ada ||= row.ada === "1";
      existing.members.push(member);
      continue;
    }

    groups.set(complexId, {
      ada: row.ada === "1",
      borough: row.borough,
      complexId,
      latitude,
      longitude,
      members: [member],
      name: row.stop_name,
      routes,
      stopId: row.gtfs_stop_id,
      stopIds: [row.gtfs_stop_id],
    });
  }

  return [...groups.values()];
}

function findNearestStation(place: Coordinates, stations: Station[]) {
  const station = stations
    .flatMap((complex) =>
      complex.members.map((member) => ({
        ...complex,
        ...member,
      })),
    )
    .toSorted((left, right) => distanceMeters(place, left) - distanceMeters(place, right))[0];

  if (!station) {
    throw new Error("The MTA station catalog did not return any usable stations.");
  }

  return station;
}

async function getRealtimeJourneys(
  routes: string[],
  nowSeconds: number,
  dependencies: Dependencies,
  overallSignal: AbortSignal,
) {
  const urls = feedUrlsForRoutes(routes);
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const bytes = await fetchBytes(url, dependencies, overallSignal);
      const feed = decodeRealtimeFeed(bytes);

      if (
        feed.timestamp !== undefined &&
        (nowSeconds - feed.timestamp > MAX_FEED_AGE_SECONDS || feed.timestamp > nowSeconds + 60)
      ) {
        throw new Error(`Stale MTA realtime feed: ${url}`);
      }

      return feed;
    }),
  );
  const feeds = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  if (feeds.length === 0) {
    throw new Error("All relevant MTA realtime feeds were unavailable or stale.");
  }

  return {
    failedFeeds: results.length - feeds.length,
    journeys: deduplicateJourneys(feeds.flatMap((feed) => feed.journeys)),
    newestFeedTimestamp: feeds
      .flatMap((feed) => (feed.timestamp === undefined ? [] : [feed.timestamp]))
      .toSorted((left, right) => right - left)[0],
  };
}

function feedUrlsForRoutes(routes: string[]) {
  const normalizedRoutes = new Set(routes.map((route) => route.toUpperCase()));
  const matchingGroups = feedGroups.filter((group) =>
    group.routes.some((route) => normalizedRoutes.has(route)),
  );
  const groups = matchingGroups.length > 0 ? matchingGroups : feedGroups.slice(0, -1);

  return groups.map((group) => new URL(group.path, MTA_FEED_BASE));
}

function findCatchableJourneys({
  journeys,
  maxWalkMinutes,
  nowSeconds,
  origin,
  place,
  stationByStopId,
}: {
  journeys: RealtimeJourney[];
  maxWalkMinutes: number;
  nowSeconds: number;
  origin: Station;
  place: Place;
  stationByStopId: Map<string, Station>;
}) {
  const originIds = new Set(origin.stopIds);

  return journeys
    .flatMap((journey): CatchableJourney[] => {
      return journey.stops.flatMap((stop, originIndex): CatchableJourney[] => {
        const originStation = stationByStopId.get(stop.baseStopId);

        if (!originIds.has(stop.baseStopId) || !originStation) {
          return [];
        }

        const originDistanceMeters = distanceMeters(place, originStation);
        const originWalkMinutes = walkingMinutes(originDistanceMeters);
        const readyAtStation = nowSeconds + (originWalkMinutes + BOARDING_BUFFER_MINUTES) * 60;
        const stopDepartureTime = departureTime(stop);

        if (originWalkMinutes > maxWalkMinutes || stopDepartureTime < readyAtStation) {
          return [];
        }

        return [
          {
            departureTime: stopDepartureTime,
            journey,
            originDistanceMeters,
            originIndex,
            originStation,
            originWalkMinutes,
          },
        ];
      });
    })
    .toSorted(
      (left, right) =>
        left.departureTime - right.departureTime ||
        left.journey.routeId.localeCompare(right.journey.routeId) ||
        left.journey.tripId.localeCompare(right.journey.tripId),
    );
}

function getDestinationCandidates({
  catchable,
  deadlineSeconds,
  stationByStopId,
}: {
  catchable: CatchableJourney;
  deadlineSeconds: number;
  stationByStopId: Map<string, Station>;
}): DestinationCandidate[] {
  const seenComplexes = new Set<string>();

  return catchable.journey.stops
    .slice(catchable.originIndex + MINIMUM_DESTINATION_STOPS)
    .flatMap((stop) => {
      const station = stationByStopId.get(stop.baseStopId);
      const arrivalTime = arrivalTimeAt(stop);
      const rideSeconds = arrivalTime - catchable.departureTime;

      if (
        !station ||
        station.complexId === catchable.originStation.complexId ||
        seenComplexes.has(station.complexId) ||
        rideSeconds < MINIMUM_RIDE_MINUTES * 60
      ) {
        return [];
      }

      seenComplexes.add(station.complexId);

      const earliestPossibleFinish =
        arrivalTime + MINIMUM_VISIT_MINUTES * 60 + rideSeconds + catchable.originWalkMinutes * 60;

      if (earliestPossibleFinish > deadlineSeconds) {
        return [];
      }

      return [{ arrivalTime, station }];
    })
    .toSorted(
      (left, right) =>
        right.arrivalTime - left.arrivalTime ||
        left.station.complexId.localeCompare(right.station.complexId),
    );
}

function buildRouteSearches({
  catchableJourneys,
  deadlineSeconds,
  stationByStopId,
}: {
  catchableJourneys: CatchableJourney[];
  deadlineSeconds: number;
  stationByStopId: Map<string, Station>;
}) {
  const searches: RouteSearch[] = [];
  const seenRoutes = new Set<string>();

  for (const [departureIndex, catchable] of catchableJourneys.entries()) {
    const key = routeSearchKey(catchable);

    if (seenRoutes.has(key)) {
      continue;
    }

    const allCandidates = getDestinationCandidates({
      catchable,
      deadlineSeconds,
      stationByStopId,
    });
    const candidates = allCandidates.slice(0, MAX_STOPS_PER_ROUTE_SEARCH);

    if (candidates.length === 0) {
      continue;
    }

    seenRoutes.add(key);
    searches.push({
      candidates,
      catchable,
      departureIndex,
      truncated: allCandidates.length > MAX_STOPS_PER_ROUTE_SEARCH,
    });
  }

  return searches;
}

function routeSearchKey(catchable: CatchableJourney) {
  const originStop = catchable.journey.stops[catchable.originIndex];
  const compassDirection = originStop.realtimeStopId.match(/[NS]$/)?.[0];
  const direction =
    catchable.journey.directionId ??
    compassDirection ??
    catchable.journey.stops[catchable.originIndex + 1]?.baseStopId ??
    catchable.journey.tripId;

  return `${catchable.journey.routeId}:${direction}`;
}

async function runRouteSearches({
  deadlineSeconds,
  dependencies,
  interests,
  journeys,
  maxWalkMinutes,
  overallSignal,
  routeSearches,
}: {
  deadlineSeconds: number;
  dependencies: Dependencies;
  interests: Interest[];
  journeys: RealtimeJourney[];
  maxWalkMinutes: number;
  overallSignal: AbortSignal;
  routeSearches: RouteSearch[];
}) {
  const results = new Array<PromiseSettledResult<RouteSearchOutcome>>(routeSearches.length);
  let nextSearchIndex = 0;

  async function runNextSearch(): Promise<void> {
    while (nextSearchIndex < routeSearches.length) {
      const searchIndex = nextSearchIndex;
      nextSearchIndex += 1;

      try {
        results[searchIndex] = {
          status: "fulfilled",
          value: await searchRoute({
            deadlineSeconds,
            dependencies,
            interests,
            journeys,
            maxWalkMinutes,
            overallSignal,
            search: routeSearches[searchIndex],
          }),
        };
      } catch (reason) {
        results[searchIndex] = { reason, status: "rejected" };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ROUTE_SEARCH_CONCURRENCY, routeSearches.length) }, () =>
      runNextSearch(),
    ),
  );

  return { results, searchesRun: routeSearches.length };
}

async function searchRoute({
  deadlineSeconds,
  dependencies,
  interests,
  journeys,
  maxWalkMinutes,
  overallSignal,
  search,
}: {
  deadlineSeconds: number;
  dependencies: Dependencies;
  interests: Interest[];
  journeys: RealtimeJourney[];
  maxWalkMinutes: number;
  overallSignal: AbortSignal;
  search: RouteSearch;
}): Promise<RouteSearchOutcome> {
  const { candidates, catchable, departureIndex } = search;
  let stopsChecked = 0;

  for (let index = 0; index < candidates.length; index += ART_STATIONS_PER_QUERY) {
    const candidateChunk = candidates.slice(index, index + ART_STATIONS_PER_QUERY);
    const artworks = await fetchArtworkChunk(
      candidateChunk.map((candidate) => candidate.station),
      maxWalkMinutes,
      dependencies,
      overallSignal,
    );

    for (const candidate of candidateChunk) {
      stopsChecked += 1;
      const artwork = findArtworkNear(candidate.station, artworks, maxWalkMinutes, interests);

      if (!artwork) {
        continue;
      }

      const destinationWalkMinutes = walkingMinutes(artwork.distanceMeters);
      const arrivalAtArtwork = candidate.arrivalTime + destinationWalkMinutes * 60;
      const readyToReturn =
        arrivalAtArtwork +
        (MINIMUM_VISIT_MINUTES + destinationWalkMinutes + BOARDING_BUFFER_MINUTES) * 60;
      const returnOption = findReturnOption({
        deadlineSeconds,
        destination: candidate.station,
        journeys,
        origin: catchable.originStation,
        originWalkMinutes: catchable.originWalkMinutes,
        readyToReturn,
      });

      if (!returnOption) {
        continue;
      }

      const returnTiming = buildReturnTiming({
        deadlineSeconds,
        destinationWalkMinutes,
        originWalkMinutes: catchable.originWalkMinutes,
        outboundArrival: candidate.arrivalTime,
        returnOption,
      });

      if (returnTiming.minutesAtArtwork < MINIMUM_VISIT_MINUTES) {
        continue;
      }

      return {
        outing: {
          artwork,
          candidate,
          catchable,
          departureIndex,
          returnOption,
          returnTiming,
          stopsChecked,
        },
        stopsChecked,
      };
    }
  }

  return { stopsChecked };
}

function stationsByStopId(stations: Station[]) {
  return new Map(
    stations.flatMap((complex) =>
      complex.members.map(
        (member) =>
          [
            member.stopId,
            {
              ...complex,
              ...member,
            },
          ] as const,
      ),
    ),
  );
}

function parseRows<T>(schema: z.ZodType<T>, payload: unknown) {
  const rows = z.array(z.unknown()).parse(payload);
  return rows.flatMap((row): T[] => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

async function fetchArtworkChunk(
  stations: Station[],
  maxWalkMinutes: number,
  dependencies: Dependencies,
  overallSignal: AbortSignal,
): Promise<ArtworkRecord[]> {
  const radiusMeters = maxWalkMinutes * WALKING_METERS_PER_MINUTE;
  const stationBounds = stations.map((station) => {
    const latitudeDelta = radiusMeters / 111_320;
    const longitudeDelta = radiusMeters / (111_320 * Math.cos(toRadians(station.latitude)));

    return {
      maxLatitude: station.latitude + latitudeDelta,
      maxLongitude: station.longitude + longitudeDelta,
      minLatitude: station.latitude - latitudeDelta,
      minLongitude: station.longitude - longitudeDelta,
    };
  });
  const url = new URL(PUBLIC_ART_URL);

  url.searchParams.set(
    "$select",
    [
      "title",
      "alternate_title",
      "primary_artist_first",
      "primary_artist_middle",
      "primary_artist_last",
      "date_created",
      "artwork_type1",
      "artwork_type2",
      "material",
      "location_name",
      "address",
      "borough",
      "subject_keyword",
      "inscription",
      "latitude",
      "longitude",
    ].join(","),
  );
  url.searchParams.set(
    "$where",
    [
      "latitude like '40.%'",
      "longitude like '-7%'",
      `(${stationBounds
        .map(
          (bounds) =>
            `(replace(latitude, ',', '')::number between ${bounds.minLatitude.toFixed(6)} and ${bounds.maxLatitude.toFixed(6)} and replace(longitude, ',', '')::number between ${bounds.minLongitude.toFixed(6)} and ${bounds.maxLongitude.toFixed(6)})`,
        )
        .join(" or ")})`,
    ].join(" and "),
  );
  url.searchParams.set("$order", "title ASC, latitude ASC, longitude ASC, :id ASC");
  url.searchParams.set("$limit", String(ART_QUERY_PAGE_SIZE));

  const artworks: ArtworkRecord[] = [];

  for (let page = 0; page < MAX_ART_QUERY_PAGES; page += 1) {
    url.searchParams.set("$offset", String(page * ART_QUERY_PAGE_SIZE));
    const payload = await fetchJson(url, dependencies, overallSignal);
    const rawRows = z.array(z.unknown()).parse(payload);
    const rows = parseRows(ArtworkRowSchema, rawRows);

    artworks.push(...artworkRecordsFromRows(rows));

    if (rawRows.length < ART_QUERY_PAGE_SIZE) {
      return uniqueArtworks(artworks);
    }
  }

  throw new Error("The public-art query exceeded its pagination limit.");
}

function uniqueArtworks(artworks: ArtworkRecord[]) {
  return [
    ...new Map(
      artworks.map((artwork) => [
        `${artwork.latitude}:${artwork.longitude}:${artwork.title}:${artwork.artist ?? ""}`,
        artwork,
      ]),
    ).values(),
  ];
}

function artworkRecordsFromRows(rows: Array<z.infer<typeof ArtworkRowSchema>>): ArtworkRecord[] {
  return rows.flatMap((row): ArtworkRecord[] => {
    const latitude = dirtyCoordinate(row.latitude);
    const longitude = dirtyCoordinate(row.longitude);

    if (latitude === undefined || longitude === undefined) {
      return [];
    }

    const artist = [
      cleanText(row.primary_artist_first),
      cleanText(row.primary_artist_middle),
      cleanText(row.primary_artist_last),
    ]
      .filter(Boolean)
      .join(" ");

    return [
      {
        address: cleanText(row.address),
        artist: artist || undefined,
        borough: cleanText(row.borough),
        created: cleanText(row.date_created),
        inscription: cleanText(row.inscription),
        latitude,
        locationName: cleanText(row.location_name),
        longitude,
        material: cleanText(row.material),
        subject: cleanText(row.subject_keyword),
        title: cleanText(row.title) ?? "Untitled",
        type: cleanText(row.artwork_type2) ?? cleanText(row.artwork_type1),
      },
    ];
  });
}

function findArtworkNear(
  station: Station,
  artworks: ArtworkRecord[],
  maxWalkMinutes: number,
  interests: Interest[],
) {
  const radiusMeters = maxWalkMinutes * WALKING_METERS_PER_MINUTE;
  const nearby = artworks.flatMap((artwork): Artwork[] => {
    const distance = distanceMeters(station, artwork);

    return distance <= radiusMeters ? [{ ...artwork, distanceMeters: distance }] : [];
  });

  return nearby.toSorted(
    (left, right) =>
      artworkScore(right, interests) - artworkScore(left, interests) ||
      left.distanceMeters - right.distanceMeters ||
      left.title.localeCompare(right.title),
  )[0];
}

function findReturnOption({
  deadlineSeconds,
  destination,
  journeys,
  origin,
  originWalkMinutes,
  readyToReturn,
}: {
  deadlineSeconds: number;
  destination: Station;
  journeys: RealtimeJourney[];
  origin: Station;
  originWalkMinutes: number;
  readyToReturn: number;
}): ReturnOption | undefined {
  const destinationIds = new Set([destination.stopId]);
  const originIds = new Set([origin.stopId]);
  const patterns = journeys.flatMap((journey) => {
    const destinationIndex = journey.stops.findIndex((stop) => destinationIds.has(stop.baseStopId));

    if (destinationIndex < 0) {
      return [];
    }

    const originIndex = journey.stops.findIndex(
      (stop, index) => index > destinationIndex && originIds.has(stop.baseStopId),
    );

    if (originIndex < 0) {
      return [];
    }

    const departureFromDestination = departureTime(journey.stops[destinationIndex]);
    const arrivalAtOrigin = arrivalTimeAt(journey.stops[originIndex]);
    const travelSeconds = arrivalAtOrigin - departureFromDestination;

    if (travelSeconds <= 0) {
      return [];
    }

    return [
      {
        arrivalAtOrigin,
        departureFromDestination,
        journey,
        travelSeconds,
      },
    ];
  });

  const live = patterns
    .filter(
      (pattern) =>
        pattern.departureFromDestination >= readyToReturn &&
        pattern.arrivalAtOrigin + originWalkMinutes * 60 <= deadlineSeconds,
    )
    .toSorted(
      (left, right) =>
        left.departureFromDestination - right.departureFromDestination ||
        left.journey.routeId.localeCompare(right.journey.routeId),
    )[0];

  if (live) {
    return { ...live, kind: "live" };
  }

  const observedDurations = patterns
    .map((pattern) => pattern.travelSeconds)
    .toSorted((left, right) => left - right);

  if (observedDurations.length === 0) {
    return undefined;
  }

  const conservativeDuration = observedDurations[Math.floor(observedDurations.length * 0.75)];
  const routeId = patterns.toSorted(
    (left, right) =>
      left.travelSeconds - right.travelSeconds ||
      left.journey.routeId.localeCompare(right.journey.routeId),
  )[0].journey.routeId;

  return {
    kind: "estimated",
    routeId,
    travelSeconds: conservativeDuration,
  };
}

function buildReturnTiming({
  deadlineSeconds,
  destinationWalkMinutes,
  originWalkMinutes,
  outboundArrival,
  returnOption,
}: {
  deadlineSeconds: number;
  destinationWalkMinutes: number;
  originWalkMinutes: number;
  outboundArrival: number;
  returnOption: ReturnOption;
}) {
  const arrivalAtArtwork = outboundArrival + destinationWalkMinutes * 60;

  if (returnOption.kind === "live") {
    const leaveArtworkBy =
      returnOption.departureFromDestination -
      (destinationWalkMinutes + BOARDING_BUFFER_MINUTES) * 60;

    return {
      arrivalBackAtStart: formatEasternTime(returnOption.arrivalAtOrigin + originWalkMinutes * 60),
      departureFromDestination: formatEasternTime(returnOption.departureFromDestination),
      leaveArtworkBy: formatEasternTime(leaveArtworkBy),
      minutesAtArtwork: minutesBetween(arrivalAtArtwork, leaveArtworkBy),
      estimatedStationToStationMinutes: Math.ceil(returnOption.travelSeconds / 60),
    };
  }

  const estimatedWaitSeconds = ESTIMATED_RETURN_WAIT_MINUTES * 60;
  const leaveArtworkBy =
    deadlineSeconds -
    (destinationWalkMinutes + BOARDING_BUFFER_MINUTES) * 60 -
    estimatedWaitSeconds -
    returnOption.travelSeconds -
    originWalkMinutes * 60;

  return {
    arrivalBackAtStart: formatEasternTime(deadlineSeconds),
    departureFromDestination: undefined,
    leaveArtworkBy: formatEasternTime(leaveArtworkBy),
    minutesAtArtwork: minutesBetween(arrivalAtArtwork, leaveArtworkBy),
    estimatedStationToStationMinutes: Math.ceil(returnOption.travelSeconds / 60),
    estimatedWaitMinutes: ESTIMATED_RETURN_WAIT_MINUTES,
  };
}

async function fetchJson(
  url: URL,
  dependencies: Dependencies,
  overallSignal: AbortSignal,
  options: { maxAttempts?: number } = {},
) {
  const response = await request(url, dependencies, overallSignal, "application/json", options);
  const text = await response.text();

  if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
    throw new Error(`JSON response exceeded ${MAX_JSON_BYTES} bytes: ${url.origin}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Invalid JSON response from ${url.origin}.`);
  }
}

async function fetchBytes(url: URL, dependencies: Dependencies, overallSignal: AbortSignal) {
  const response = await request(url, dependencies, overallSignal, "application/x-protobuf");
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength > MAX_FEED_BYTES) {
    throw new Error(`MTA feed exceeded ${MAX_FEED_BYTES} bytes.`);
  }

  return bytes;
}

async function request(
  url: URL,
  dependencies: Dependencies,
  overallSignal: AbortSignal,
  accept: string,
  { maxAttempts = 2 }: { maxAttempts?: number } = {},
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await dependencies.fetch(url, {
        headers: {
          accept,
          "user-agent":
            "departures-vercel-ship-demo/0.1 (+https://github.com/makenotion/vercel-ship-2026-workers)",
        },
        signal: AbortSignal.any([overallSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });

      if (response.ok) {
        const length = Number(response.headers.get("content-length"));

        if (Number.isFinite(length) && length > MAX_FEED_BYTES) {
          throw new Error(`Response from ${url.origin} was too large.`);
        }

        return response;
      }

      lastError = new Error(`${url.origin} returned HTTP ${response.status}.`);
      await response.body?.cancel();

      if (response.status !== 429 && response.status < 500) {
        break;
      }
    } catch (error) {
      lastError = error;

      if (overallSignal.aborted) {
        break;
      }
    }

    if (attempt < maxAttempts - 1) {
      await delay(150 * (attempt + 1), overallSignal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url.origin}`);
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function deduplicateJourneys(journeys: RealtimeJourney[]) {
  return [
    ...new Map(
      journeys.map((journey) => [
        `${journey.routeId}:${journey.tripId}:${journey.stops[0]?.realtimeStopId}`,
        journey,
      ]),
    ).values(),
  ];
}

function stationSummary(station: Station) {
  return {
    adaAccessible: station.ada,
    borough: station.borough,
    complexId: station.complexId,
    latitude: station.latitude,
    longitude: station.longitude,
    name: station.name,
    routes: station.routes.toSorted(),
    stopId: station.stopId,
    stopIds: station.stopIds,
  };
}

function geocoderSources(geocoder: Geocoder) {
  switch (geocoder) {
    case "coordinates":
      return [];
    case "nyc-geosearch":
      return [
        {
          name: "NYC Planning GeoSearch",
          url: "https://geosearch.planninglabs.nyc/docs/",
        },
      ];
    case "nys-geocoder":
      return [
        {
          name: "New York State Geocoder",
          url: "https://gis.ny.gov/nys-geocoding-service",
        },
      ];
    case "openstreetmap":
      return [
        {
          name: "© OpenStreetMap contributors (Nominatim)",
          url: "https://www.openstreetmap.org/copyright",
        },
      ];
  }
}

function buildSuccessfulSteps({
  failedFeeds,
  journeys,
  origin,
  outing,
  place,
  routeSearches,
  searchesRun,
  searchResults,
}: {
  failedFeeds: number;
  journeys: RealtimeJourney[];
  origin: Station;
  outing: OutingSearchResult;
  place: Place;
  routeSearches: RouteSearch[];
  searchesRun: number;
  searchResults: PromiseSettledResult<RouteSearchOutcome>[];
}) {
  const steps = [
    geocodingStep(place),
    `Located ${origin.name} as the nearest station complex, about ${walkingMinutes(distanceMeters(place, origin))} minutes away on foot.`,
    `Loaded ${journeys.length} realtime trip predictions from the relevant MTA feeds${failedFeeds > 0 ? `; ${failedFeeds} feed(s) were unavailable` : ""}.`,
    `Ran ${searchesRun} route-and-direction searches with up to ${ROUTE_SEARCH_CONCURRENCY} concurrent, checking at most ${MAX_STOPS_PER_ROUTE_SEARCH} stops per search from farthest to nearest.`,
  ];

  for (let index = 0; index < searchesRun; index += 1) {
    const search = routeSearches[index];
    const result = searchResults[index];
    const route = search.catchable.journey.routeId;
    const direction = routeDirectionLabel(search.catchable);
    const departure = formatEasternTime(search.catchable.departureTime);

    if (result.status === "rejected") {
      steps.push(
        `Route search ${route} ${direction}, departing ${departure}: the artwork lookup was unavailable.`,
      );
    } else if (result.value.outing) {
      steps.push(
        `Route search ${route} ${direction}, departing ${departure}: checked ${result.value.stopsChecked} stop(s) inward and found ${JSON.stringify(result.value.outing.artwork.title)} near ${result.value.outing.candidate.station.name}.`,
      );
    } else {
      steps.push(
        `Route search ${route} ${direction}, departing ${departure}: checked ${result.value.stopsChecked} stop(s), but none satisfied the artwork, visit-time, and return constraints.`,
      );
    }
  }

  steps.push(
    `Selected ${JSON.stringify(outing.artwork.title)} near ${outing.candidate.station.name} after checking ${outing.stopsChecked} stop(s) on route ${outing.catchable.journey.routeId}.`,
  );

  if (outing.returnOption.kind === "live") {
    steps.push(
      `Validated a live return on route ${outing.returnOption.journey.routeId}, departing ${outing.returnTiming.departureFromDestination}.`,
    );
  } else {
    steps.push(
      `Validated an estimated return on route ${outing.returnOption.routeId} using an observed reverse-service travel pattern.`,
    );
  }

  return steps;
}

function geocodingStep(place: Place) {
  switch (place.geocoder) {
    case "coordinates":
      return `Used the supplied coordinates for ${place.label}.`;
    case "nyc-geosearch":
      return `Resolved ${place.label} with NYC Planning GeoSearch.`;
    case "nys-geocoder":
      return `NYC Planning GeoSearch had no usable result; resolved ${place.label} with the New York State Geocoder.`;
    case "openstreetmap":
      return `NYC Planning GeoSearch and the New York State Geocoder had no usable result; resolved ${place.label} with OpenStreetMap Nominatim.`;
  }
}

function routeDirectionLabel(catchable: CatchableJourney) {
  const realtimeStopId = catchable.journey.stops[catchable.originIndex].realtimeStopId;

  if (realtimeStopId.endsWith("N")) {
    return "northbound";
  }

  if (realtimeStopId.endsWith("S")) {
    return "southbound";
  }

  return catchable.journey.directionId === undefined
    ? "with an unspecified direction"
    : `direction ${catchable.journey.directionId}`;
}

function artworkSummary(artwork: Artwork) {
  return {
    address: artwork.address,
    artist: artwork.artist,
    borough: artwork.borough,
    created: artwork.created,
    distanceMeters: Math.round(artwork.distanceMeters),
    inscription: artwork.inscription?.slice(0, 500),
    latitude: artwork.latitude,
    locationName: artwork.locationName,
    longitude: artwork.longitude,
    material: artwork.material,
    subject: artwork.subject,
    title: artwork.title,
    type: artwork.type,
  };
}

function artworkScore(artwork: Artwork, interests: Interest[]) {
  const text = [artwork.type, artwork.subject, artwork.locationName].filter(Boolean).join(" ");
  let score = artwork.inscription ? 8 : 0;

  if (interests.includes("art") && /artwork|sculpture|statue|mural/i.test(text)) {
    score += 25;
  }

  if (interests.includes("history") && /monument|memorial|marker|tablet/i.test(text)) {
    score += 25;
  }

  if (interests.includes("parks") && /park|square|plaza|greenway/i.test(text)) {
    score += 25;
  }

  if (interests.includes("surprise")) {
    score += artwork.inscription ? 12 : 0;
    score += artwork.subject ? 8 : 0;
    score += artwork.material ? 4 : 0;
  }

  return score - artwork.distanceMeters / 100;
}

function splitRoutes(routes: string | undefined) {
  return routes?.split(/[,\s]+/).filter(Boolean) ?? [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function cleanText(value: string | undefined) {
  const text = value?.trim();
  return !text || text.toUpperCase() === "NULL" ? undefined : text;
}

function numericValue(value: string | number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function dirtyCoordinate(value: string) {
  const number = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(number) ? number : undefined;
}

function parseCoordinateInput(value: string): Coordinates | undefined {
  const match = value.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);

  if (!match) {
    return undefined;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const coordinates = { latitude, longitude };

  return isInNycBounds(coordinates) ? coordinates : undefined;
}

function qualifyForNysGeocoder(value: string) {
  return /\b(?:new york|nyc|brooklyn|queens|bronx|staten island)\b|,\s*ny(?:\s|,|\d|$)/i.test(value)
    ? value
    : `${value}, New York, NY`;
}

function isInNycBounds({ latitude, longitude }: Coordinates) {
  return (
    latitude >= NYC_BOUNDS.south &&
    latitude <= NYC_BOUNDS.north &&
    longitude >= NYC_BOUNDS.west &&
    longitude <= NYC_BOUNDS.east
  );
}

function distanceMeters(left: Coordinates, right: Coordinates) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function walkingMinutes(distance: number) {
  return Math.max(1, Math.ceil(distance / WALKING_METERS_PER_MINUTE));
}

function departureTime(stop: RealtimeStop) {
  return stop.departureTime ?? stop.arrivalTime ?? 0;
}

function arrivalTimeAt(stop: RealtimeStop) {
  return stop.arrivalTime ?? stop.departureTime ?? 0;
}

function minutesBetween(startSeconds: number, endSeconds: number) {
  return Math.max(0, Math.floor((endSeconds - startSeconds) / 60));
}

export function formatEasternTime(epochSeconds: number) {
  const parts = easternTimeFormatter.formatToParts(new Date(epochSeconds * 1000));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return `${part("month")}/${part("day")}/${part("year")} ${part("hour")}:${part("minute")}:${part("second")} ${part("dayPeriod")} ${part("timeZoneName")}`;
}
