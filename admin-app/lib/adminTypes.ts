export type Overview = {
  today: {
    day: string;
    newUsers: number;
    activeUsers: number;
    gmvFcfa: number;
    txCount: number;
    deposits: number;
    depositVolumeFcfa: number;
    messages: number;
    payments: number;
    transfers: number;
  };
  actives: { dau: number; wau: number; mau: number };
  totals: { users: number; gmvFcfa: number };
};

export type EventRow = {
  id: string;
  type: string;
  at: string;
  title: string;
  summary: string;
  severity: string;
};

export function money(n: number) {
  return `${Math.round(n || 0).toLocaleString("fr-FR")} F`;
}