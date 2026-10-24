const DEMO_SOA_PAYERS = [
  { payerName: "Jean Kamga", payerPhone: "677123456" },
  { payerName: "Marie Ndjomo", payerPhone: "691234567" },
  { payerName: "Paul Mbarga", payerPhone: "655987654" },
  { payerName: "Aïcha Bello", payerPhone: "699112233" },
  { payerName: "Samuel Fongang", payerPhone: "670445566" },
  { payerName: "Clarisse Atangana", payerPhone: "676554433" },
  { payerName: "Brice Owona", payerPhone: "694221100" },
  { payerName: "Sandrine Etoga", payerPhone: "658990011" },
  { payerName: "Ibrahim Sadiq", payerPhone: "693778845" },
  { payerName: "Grace Tchoumi", payerPhone: "671223344" },
  { payerName: "Rodrigue Nana", payerPhone: "690112233" },
  { payerName: "Estelle Bekolo", payerPhone: "656778899" },
  { payerName: "Franklin Nguema", payerPhone: "688445566" },
  { payerName: "Patricia Abega", payerPhone: "697334455" },
  { payerName: "Hervé Mvondo", payerPhone: "654667788" },
  { payerName: "Nadège Kuate", payerPhone: "692556677" },
  { payerName: "Alain Tchinda", payerPhone: "675889900" },
  { payerName: "Sylvie Mengue", payerPhone: "698001122" },
  { payerName: "Didier Anguissa", payerPhone: "653445577" },
  { payerName: "Béatrice Ngo", payerPhone: "696778812" },
];

const PAYMENTS_PER_TRIP_TODAY = 20;
const PAYMENTS_PER_TRIP_MIN = 8;

function demoSoaPayerByIndex(index) {
  const i = Math.abs(Math.floor(index)) % DEMO_SOA_PAYERS.length;
  return DEMO_SOA_PAYERS[i];
}

function demoPaymentsCountForTrip(dayIndex, _tripIndex) {
  if (dayIndex === 0) return PAYMENTS_PER_TRIP_TODAY;
  return Math.max(PAYMENTS_PER_TRIP_MIN, PAYMENTS_PER_TRIP_TODAY - dayIndex);
}

export function buildDemoTripSeats(dayIndex, tripIndex, baseMs, paymentCount) {
  const seats = [];
  for (let p = 0; p < paymentCount; p++) {
    const seatNumber = ((p + tripIndex * 2) % 18) + 1;
    const payerIdx = (p + dayIndex * 3 + tripIndex) % 20;
    const payer = demoSoaPayerByIndex(payerIdx);
    const amountFcfa = 1200 + ((p * 211 + dayIndex * 97 + tripIndex * 53) % 4800);
    const paidAt = new Date(baseMs - p * 3 * 60_000).toISOString();
    const transactionId = `demo-soa-${dayIndex}-${tripIndex}-${p}`;
    seats.push({
      seatNumber,
      amountFcfa,
      paidAt,
      transactionId,
      payerName: payer.payerName,
      payerPhone: payer.payerPhone,
    });
  }
  seats.sort((a, b) => a.seatNumber - b.seatNumber);
  return seats;
}

export function buildDemoActiveTripSeats() {
  return buildDemoTripSeats(0, 9, Date.now(), 12);
}

export function buildDevDemoArchiveRows() {
  const rows = [];
  for (let dayIndex = 0; dayIndex < 14; dayIndex++) {
    const tripCount = dayIndex % 4 === 0 ? 3 : dayIndex % 2 === 0 ? 2 : 1;
    for (let t = 0; t < tripCount; t++) {
      const baseMs = Date.now() - dayIndex * 86_400_000 - t * 52 * 60_000;
      const endedAt = new Date(baseMs).toISOString();
      const startedAt = new Date(baseMs - 38 * 60_000).toISOString();
      const paymentCount = demoPaymentsCountForTrip(dayIndex, t);
      const seats = buildDemoTripSeats(dayIndex, t, baseMs, paymentCount);
      const totalFcfa = seats.reduce((sum, s) => sum + s.amountFcfa, 0);
      rows.push({
        tripId: `demo-arch-${dayIndex}-${t}`,
        totalFcfa,
        tripStartedAt: startedAt,
        endedAt,
        seats,
      });
    }
  }
  return rows;
}
