export type PriceProduct = {
  id: string;
  name: string;
  dayPrice: number;
  weekPrice: number | null;
  twoWeekPrice: number | null;
};

export function calculateProductPrice(product: PriceProduct, days: number) {
  let remaining = Math.max(1, Math.floor(days));
  let total = 0;
  const steps: { label: string; count: number; price: number }[] = [];

  const useStep = (size: number, label: string, price: number | null) => {
    if (!price) return;
    const count = Math.floor(remaining / size);
    if (!count) return;
    remaining -= count * size;
    total += count * price;
    steps.push({ label, count, price });
  };

  useStep(14, "2 uger", product.twoWeekPrice);
  useStep(7, "uge", product.weekPrice);
  useStep(1, "dag", product.dayPrice);

  return { total, steps };
}
