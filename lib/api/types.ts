export type ApiUser = {
  phone: string;
  balanceFcfa: number;
};

export type TransactionItem = {
  id: string;
  type: "sent" | "received";
  amountFcfa: number;
  counterpartyName: string;
  counterpartyPhone: string | null;
  createdAt: string;
};
