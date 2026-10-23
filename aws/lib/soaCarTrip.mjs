import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { commercePk, getCommerceRecord, resolvePayTarget } from "./commerce.mjs";

const doc = getDocClient();
const SEAT_COUNT = 18;
const TRIP_SK = "SOA_TRIP#ACTIVE";

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
    seats: seats.map((s) => ({
      seatNumber: Number(s.seatNumber),
      amountFcfa: Number(s.amountFcfa) || 0,
      paidAt: String(s.paidAt ?? ""),
      transactionId: String(s.transactionId ?? ""),
    })),
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

export async function resetSoaCarTrip(userId, commerceId) {
  const cid = String(commerceId ?? "").trim();
  if (!cid) return { error: "COMMERCE_REQUIRED" };
  const rec = await getCommerceRecord(userId, cid);
  if (!rec) return { error: "NOT_FOUND" };
  if (String(rec.category ?? "").toLowerCase() !== "soa_car") {
    return { error: "NOT_SOA_CAR" };
  }
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
  const nextSeat = {
    seatNumber: seat,
    amountFcfa: amt,
    paidAt: now,
    transactionId: txId,
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
