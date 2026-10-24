import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  buildDemoActiveTripSeats,
  buildDevDemoArchiveRows,
} from "./demoSoaTripSeed.mjs";
import { randomUUID } from "node:crypto";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { commercePk, getCommerceRecord, resolvePayTarget } from "./commerce.mjs";

const doc = getDocClient();
const SEAT_COUNT = 18;
const TRIP_SK = "SOA_TRIP#ACTIVE";
const TRIP_ARCH_PREFIX = "SOA_TRIP#ARCH#";
const REPORT_TZ = "Africa/Douala";

function commerceDayKey(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function isValidDayKey(raw) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(raw ?? "").trim());
}

function mapSeats(seats) {
  return (Array.isArray(seats) ? seats : []).map((s) => {
    const row = {
      seatNumber: Number(s.seatNumber),
      amountFcfa: Number(s.amountFcfa) || 0,
      paidAt: String(s.paidAt ?? ""),
      transactionId: String(s.transactionId ?? ""),
    };
    const payerName = String(s.payerName ?? "").trim();
    const payerPhone = String(s.payerPhone ?? "").trim();
    if (payerName) row.payerName = payerName;
    if (payerPhone) row.payerPhone = payerPhone;
    return row;
  });
}

function tripRowFromArchive(item) {
  return {
    tripId: String(item.tripId ?? ""),
    totalFcfa: Number(item.totalFcfa) || 0,
    tripStartedAt: String(item.tripStartedAt ?? ""),
    endedAt: String(item.endedAt ?? ""),
    isActive: false,
    seats: mapSeats(item.seats),
  };
}

function emptyTrip(commerceId) {
  const now = new Date().toISOString();
  return {
    commerceId,
    seatCount: SEAT_COUNT,
    totalFcfa: 0,
    seats: [],
    tripStartedAt: now,
  };
}

function tripFromItem(item) {
  if (!item) return null;
  const seats = Array.isArray(item.seats) ? item.seats : [];
  return {
    commerceId: String(item.commerceId ?? ""),
    seatCount: SEAT_COUNT,
    totalFcfa: Number(item.totalFcfa) || 0,
    seats: mapSeats(seats),
    tripStartedAt: String(item.tripStartedAt ?? ""),
  };
}

async function loadTripItem(commerceId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: commercePk(commerceId), SK: TRIP_SK },
    }),
  );
  return res.Item ?? null;
}

export async function getSoaCarTripByAccountId(accountId) {
  const target = await resolvePayTarget(accountId);
  if (!target || target.type !== "commerce") return { error: "NOT_FOUND" };
  const rec = await getCommerceRecord(target.ownerUserId, target.commerceId);
  if (!rec || String(rec.category ?? "").toLowerCase() !== "soa_car") {
    return { error: "NOT_SOA_CAR" };
  }
  const item = await loadTripItem(target.commerceId);
  const trip = item ? tripFromItem(item) : emptyTrip(target.commerceId);
  return { trip };
}

export async function getSoaCarTripForOwner(userId, commerceId) {
  const cid = String(commerceId ?? "").trim();
  if (!cid) return { error: "COMMERCE_REQUIRED" };
  const rec = await getCommerceRecord(userId, cid);
  if (!rec) return { error: "NOT_FOUND" };
  if (String(rec.category ?? "").toLowerCase() !== "soa_car") {
    return { error: "NOT_SOA_CAR" };
  }
  const item = await loadTripItem(cid);
  const trip = item ? tripFromItem(item) : emptyTrip(cid);
  return { trip };
}

async function archiveActiveTripIfNeeded(commerceId, item) {
  const trip = item ? tripFromItem(item) : null;
  if (!trip || trip.seats.length === 0 || trip.totalFcfa <= 0) return;
  const endedAt = new Date().toISOString();
  const tripId = randomUUID();
  const endedMs = Date.parse(endedAt);
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: commercePk(commerceId),
        SK: `${TRIP_ARCH_PREFIX}${String(endedMs).padStart(13, "0")}#${tripId}`,
        entityType: "SOA_CAR_TRIP_ARCH",
        commerceId,
        tripId,
        dayKey: commerceDayKey(endedAt),
        seatCount: SEAT_COUNT,
        totalFcfa: trip.totalFcfa,
        seats: trip.seats,
        tripStartedAt: trip.tripStartedAt,
        endedAt,
      },
    }),
  );
}

async function listArchivedTrips(commerceId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": commercePk(commerceId),
        ":sk": TRIP_ARCH_PREFIX,
      },
    }),
  );
  return (res.Items ?? []).map(tripRowFromArchive);
}

const DEMO_SEED_MARKER_SK = "SOA_TRIP#DEMO_SEED_V2";

async function listArchivedTripItems(commerceId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": commercePk(commerceId),
        ":sk": TRIP_ARCH_PREFIX,
      },
    }),
  );
  return res.Items ?? [];
}

function isDemoSoaTransactionId(txId) {
  return String(txId ?? "").startsWith("demo-soa-");
}

async function ensureDevDemoSoaArchives(commerceId) {
  const stage = String(process.env.STAGE ?? "").toLowerCase();
  if (stage !== "dev") return;
  const marker = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: commercePk(commerceId), SK: DEMO_SEED_MARKER_SK },
    }),
  );
  if (marker.Item) return;

  const archItems = await listArchivedTripItems(commerceId);
  for (const item of archItems) {
    if (String(item.tripId ?? "").startsWith("demo-arch-")) {
      await doc.send(
        new DeleteCommand({
          TableName: getTableName(),
          Key: { PK: item.PK, SK: item.SK },
        }),
      );
    }
  }

  const rows = buildDevDemoArchiveRows();
  for (const row of rows) {
    const endedMs = Date.parse(row.endedAt);
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: commercePk(commerceId),
          SK: `${TRIP_ARCH_PREFIX}${String(endedMs).padStart(13, "0")}#${row.tripId}`,
          entityType: "SOA_CAR_TRIP_ARCH",
          commerceId,
          tripId: row.tripId,
          dayKey: commerceDayKey(row.endedAt),
          seatCount: SEAT_COUNT,
          totalFcfa: row.totalFcfa,
          seats: row.seats,
          tripStartedAt: row.tripStartedAt,
          endedAt: row.endedAt,
        },
      }),
    );
  }

  const activeItem = await loadTripItem(commerceId);
  const active = activeItem ? tripFromItem(activeItem) : emptyTrip(commerceId);
  const activeDemoOnly =
    active.seats.length === 0 ||
    active.seats.every((s) => isDemoSoaTransactionId(s.transactionId));
  if (activeDemoOnly) {
    const now = new Date().toISOString();
    const seats = buildDemoActiveTripSeats();
    const totalFcfa = seats.reduce((s, x) => s + x.amountFcfa, 0);
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: commercePk(commerceId),
          SK: TRIP_SK,
          entityType: "SOA_CAR_TRIP",
          commerceId,
          seatCount: SEAT_COUNT,
          totalFcfa,
          seats,
          tripStartedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
          updatedAt: now,
        },
      }),
    );
  }

  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: commercePk(commerceId),
        SK: DEMO_SEED_MARKER_SK,
        entityType: "SOA_DEMO_SEED",
        commerceId,
        seededAt: new Date().toISOString(),
      },
    }),
  );
}

export async function resetSoaCarTrip(userId, commerceId) {
  const cid = String(commerceId ?? "").trim();
  if (!cid) return { error: "COMMERCE_REQUIRED" };
  const rec = await getCommerceRecord(userId, cid);
  if (!rec) return { error: "NOT_FOUND" };
  if (String(rec.category ?? "").toLowerCase() !== "soa_car") {
    return { error: "NOT_SOA_CAR" };
  }
  const prevItem = await loadTripItem(cid);
  await archiveActiveTripIfNeeded(cid, prevItem);
  const trip = emptyTrip(cid);
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: commercePk(cid),
        SK: TRIP_SK,
        entityType: "SOA_CAR_TRIP",
        commerceId: cid,
        seatCount: SEAT_COUNT,
        totalFcfa: 0,
        seats: [],
        tripStartedAt: trip.tripStartedAt,
        updatedAt: trip.tripStartedAt,
      },
    }),
  );
  return { trip };
}

export async function getSoaCarDayReport(userId, commerceId, dayKeyRaw) {
  const cid = String(commerceId ?? "").trim();
  const dayKey = String(dayKeyRaw ?? "").trim();
  if (!cid) return { error: "COMMERCE_REQUIRED" };
  if (!isValidDayKey(dayKey)) return { error: "DAY_INVALID" };
  const rec = await getCommerceRecord(userId, cid);
  if (!rec) return { error: "NOT_FOUND" };
  if (String(rec.category ?? "").toLowerCase() !== "soa_car") {
    return { error: "NOT_SOA_CAR" };
  }
  await ensureDevDemoSoaArchives(cid);
  const archived = (await listArchivedTrips(cid)).filter(
    (t) => commerceDayKey(t.endedAt) === dayKey,
  );
  const todayKey = commerceDayKey(new Date().toISOString());
  const trips = [...archived];
  if (dayKey === todayKey) {
    const item = await loadTripItem(cid);
    if (item) {
      const active = tripFromItem(item);
      trips.push({
        tripId: "active",
        totalFcfa: active.totalFcfa,
        tripStartedAt: active.tripStartedAt,
        endedAt: null,
        isActive: true,
        seats: active.seats,
      });
    }
  }
  trips.sort(
    (a, b) =>
      Date.parse(b.tripStartedAt || b.endedAt || 0) -
      Date.parse(a.tripStartedAt || a.endedAt || 0),
  );
  const totalFcfa = trips.reduce((sum, t) => sum + (t.totalFcfa || 0), 0);
  return {
    dayKey,
    totalFcfa,
    tripCount: trips.length,
    trips,
  };
}

export async function assertSoaSeatAvailable(commerceId, seatNumber) {
  const cid = String(commerceId ?? "").trim();
  const seat = Math.floor(Number(seatNumber));
  if (!Number.isFinite(seat) || seat < 1 || seat > SEAT_COUNT) {
    return { error: "SEAT_INVALID" };
  }
  const item = await loadTripItem(cid);
  const trip = item ? tripFromItem(item) : emptyTrip(cid);
  return { ok: true, trip };
}

export async function recordSoaSeatPayment(
  commerceId,
  seatNumber,
  amountFcfa,
  transactionId,
  payerMeta = {},
) {
  const cid = String(commerceId ?? "").trim();
  const seat = Math.floor(Number(seatNumber));
  const amt = Math.floor(Number(amountFcfa));
  const txId = String(transactionId ?? "").trim();
  if (!cid || !txId) return { error: "INVALID" };
  if (!Number.isFinite(seat) || seat < 1 || seat > SEAT_COUNT) {
    return { error: "SEAT_INVALID" };
  }
  if (!Number.isFinite(amt) || amt <= 0) return { error: "AMOUNT_INVALID" };

  const item = await loadTripItem(cid);
  const trip = item ? tripFromItem(item) : emptyTrip(cid);
  const now = new Date().toISOString();
  const payerName = String(payerMeta.payerName ?? "").trim();
  const payerPhone = String(payerMeta.payerPhone ?? "").trim();
  const nextSeat = {
    seatNumber: seat,
    amountFcfa: amt,
    paidAt: now,
    transactionId: txId,
    ...(payerName ? { payerName } : {}),
    ...(payerPhone ? { payerPhone } : {}),
  };
  const seats = [...trip.seats, nextSeat].sort(
    (a, b) => a.seatNumber - b.seatNumber,
  );
  const totalFcfa = seats.reduce((sum, s) => sum + s.amountFcfa, 0);
  const nextTrip = {
    commerceId: cid,
    seatCount: SEAT_COUNT,
    totalFcfa,
    seats,
    tripStartedAt: trip.tripStartedAt || now,
  };
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: commercePk(cid),
        SK: TRIP_SK,
        entityType: "SOA_CAR_TRIP",
        commerceId: cid,
        seatCount: SEAT_COUNT,
        totalFcfa,
        seats,
        tripStartedAt: nextTrip.tripStartedAt,
        updatedAt: now,
      },
    }),
  );
  return { trip: nextTrip };
}
