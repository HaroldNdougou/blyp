export const DEMO_SOA_PAYERS: ReadonlyArray<{
  payerName: string;
  payerPhone: string;
}> = [
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

export function demoSoaPayerByIndex(index: number): {
  payerName: string;
  payerPhone: string;
} {
  const i = Math.abs(Math.floor(index)) % DEMO_SOA_PAYERS.length;
  return DEMO_SOA_PAYERS[i]!;
}

export function demoSoaPayerForSeed(seed: string): {
  payerName: string;
  payerPhone: string;
} {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h = (h + s.charCodeAt(i) * 31) % DEMO_SOA_PAYERS.length;
  }
  return DEMO_SOA_PAYERS[h]!;
}
