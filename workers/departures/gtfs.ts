import protobuf from "protobufjs";

const gtfsRealtimeSchema = `
syntax = "proto2";

package transit_realtime;

message FeedMessage {
  required FeedHeader header = 1;
  repeated FeedEntity entity = 2;
}

message FeedHeader {
  required string gtfs_realtime_version = 1;
  optional Incrementality incrementality = 2 [default = FULL_DATASET];
  optional uint64 timestamp = 3;

  enum Incrementality {
    FULL_DATASET = 0;
    DIFFERENTIAL = 1;
  }
}

message FeedEntity {
  required string id = 1;
  optional bool is_deleted = 2 [default = false];
  optional TripUpdate trip_update = 3;
}

message TripDescriptor {
  optional string trip_id = 1;
  optional string start_time = 2;
  optional string start_date = 3;
  optional ScheduleRelationship schedule_relationship = 4;
  optional string route_id = 5;
  optional uint32 direction_id = 6;

  enum ScheduleRelationship {
    SCHEDULED = 0;
    ADDED = 1;
    UNSCHEDULED = 2;
    CANCELED = 3;
    REPLACEMENT = 5;
    DUPLICATED = 6;
    DELETED = 7;
    NEW = 8;
  }
}

message TripUpdate {
  required TripDescriptor trip = 1;
  repeated StopTimeUpdate stop_time_update = 2;
  optional uint64 timestamp = 4;

  message StopTimeEvent {
    optional int32 delay = 1;
    optional int64 time = 2;
    optional int32 uncertainty = 3;
  }

  message StopTimeUpdate {
    optional uint32 stop_sequence = 1;
    optional StopTimeEvent arrival = 2;
    optional StopTimeEvent departure = 3;
    optional string stop_id = 4;
    optional ScheduleRelationship schedule_relationship = 5 [default = SCHEDULED];

    enum ScheduleRelationship {
      SCHEDULED = 0;
      SKIPPED = 1;
      NO_DATA = 2;
      UNSCHEDULED = 3;
    }
  }
}
`;

const feedMessageType = protobuf
  .parse(gtfsRealtimeSchema)
  .root.lookupType("transit_realtime.FeedMessage");

type RawFeed = {
  header?: {
    timestamp?: string | number;
  };
  entity?: Array<{
    id?: string;
    tripUpdate?: {
      trip?: {
        directionId?: number;
        routeId?: string;
        tripId?: string;
        scheduleRelationship?: string;
      };
      stopTimeUpdate?: Array<{
        stopId?: string;
        scheduleRelationship?: string;
        arrival?: { time?: string | number };
        departure?: { time?: string | number };
      }>;
    };
  }>;
};

export type RealtimeStop = {
  arrivalTime?: number;
  baseStopId: string;
  departureTime?: number;
  realtimeStopId: string;
};

export type RealtimeJourney = {
  directionId?: number;
  entityId: string;
  routeId: string;
  stops: RealtimeStop[];
  tripId: string;
};

export type RealtimeFeed = {
  journeys: RealtimeJourney[];
  timestamp?: number;
};

export function decodeRealtimeFeed(bytes: Uint8Array): RealtimeFeed {
  const message = feedMessageType.decode(bytes);
  const feed = feedMessageType.toObject(message, {
    arrays: true,
    defaults: false,
    enums: String,
    longs: String,
    objects: true,
  }) as RawFeed;

  const journeys = (feed.entity ?? []).flatMap((entity): RealtimeJourney[] => {
    const tripUpdate = entity.tripUpdate;
    const routeId = tripUpdate?.trip?.routeId?.trim();
    const tripId = tripUpdate?.trip?.tripId?.trim();
    const directionId = tripUpdate?.trip?.directionId;

    if (
      !tripUpdate ||
      !routeId ||
      !tripId ||
      tripUpdate.trip?.scheduleRelationship === "CANCELED" ||
      tripUpdate.trip?.scheduleRelationship === "DELETED"
    ) {
      return [];
    }

    const stops = (tripUpdate.stopTimeUpdate ?? []).flatMap((stop): RealtimeStop[] => {
      const realtimeStopId = stop.stopId?.trim();

      if (!realtimeStopId || stop.scheduleRelationship === "SKIPPED") {
        return [];
      }

      const arrivalTime = epochSeconds(stop.arrival?.time);
      const departureTime = epochSeconds(stop.departure?.time);

      if (arrivalTime === undefined && departureTime === undefined) {
        return [];
      }

      return [
        {
          arrivalTime,
          baseStopId: normalizeStopId(realtimeStopId),
          departureTime,
          realtimeStopId,
        },
      ];
    });

    if (stops.length < 2) {
      return [];
    }

    return [
      {
        ...(directionId === undefined ? {} : { directionId }),
        entityId: entity.id ?? tripId,
        routeId,
        stops,
        tripId,
      },
    ];
  });

  return {
    journeys,
    timestamp: epochSeconds(feed.header?.timestamp),
  };
}

export function encodeRealtimeFeed(value: object): Uint8Array {
  return feedMessageType.encode(feedMessageType.create(value)).finish();
}

function epochSeconds(value: string | number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const number = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(number) || number < 0) {
    return undefined;
  }

  return number;
}

function normalizeStopId(stopId: string) {
  return /[NS]$/.test(stopId) ? stopId.slice(0, -1) : stopId;
}
