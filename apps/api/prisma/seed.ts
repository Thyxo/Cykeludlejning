import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  ["Voksencykel 28”/26” med 7 gear", 90, 450, 800, "VOK", 40],
  ["Børnecykel 24”", 70, 350, 500, "B24", 10],
  ["Børnecykel 20” med 3 gear", 70, 350, 500, "B20", 10],
  ["Børnecykel 18” uden gear", 60, 300, 400, "B18", 10],
  ["MTB 29”", 200, 1000, 2000, "MTB", 8],
  ["Elcykel centermotor optil 80 km", 325, 1700, null, "ELC", 8],
  ["Elcykel forhjulsmotor optil 40/50 km", 225, 1250, 2250, "ELF", 8],
  ["Ladcykel med el til 2 børn/cargobike", 450, 2250, null, "LAD", 4],
  ["Hundetrailer / Dogtrailer", 90, 450, 800, "HUN", 5],
  ["Børnetrailer 2 børn max 40 kg", 80, 400, 700, "BT", 5],
  ["Barnesæde max 25 kg / child seat", 30, 150, 200, "BS", 8],
  ["Hundekurv", 50, 250, null, "HK", 5],
  ["Hjelm / Helmet", 25, 125, 200, "HJ", 20],
  ["Levering/afhentning fra", 150, null, null, "LEV", 50],
  ["Aftencykel (16-24)", 50, null, null, "AFT", 20]
] as const;

const productAliases = new Map<string, string[]>([
  ["Voksencykel 28”/26” med 7 gear", ["Voksencykel 28/26 med 7 gear"]],
  ["Børnecykel 24”", ["BÃ¸rnecykel 24"]],
  ["Børnecykel 20” med 3 gear", ["BÃ¸rnecykel 20 med 3 gear"]],
  ["Børnecykel 18” uden gear", ["BÃ¸rnecykel 18 uden gear"]],
  ["MTB 29”", ["MTB 29"]],
  ["Elcykel centermotor optil 80 km", ["Elcykel centermotor op til 80 km"]],
  ["Elcykel forhjulsmotor optil 40/50 km", ["Elcykel forhjulsmotor op til 40/50 km"]],
  ["Ladcykel med el til 2 børn/cargobike", ["Ladcykel med el til 2 bÃ¸rn/cargobike"]],
  ["Hundetrailer / Dogtrailer", ["Hundetrailer/Dogtrailer"]],
  ["Børnetrailer 2 børn max 40 kg", ["BÃ¸rnetrailer 2 bÃ¸rn max 40 kg"]],
  ["Barnesæde max 25 kg / child seat", ["BarnesÃ¦de max 25 kg"]],
  ["Levering/afhentning fra", ["Levering/afhentning"]]
]);

const locks = [
  ["Kode 1", "616"],
  ["Kode 2", "152"],
  ["Kode 3", "906"],
  ["Kode 4", "892"],
  ["Start", "360"],
  ["Slut", "894"]
] as const;

async function main() {
  await prisma.bike.deleteMany({ where: { status: "HOME" } });

  for (const [name, dayPrice, weekPrice, twoWeekPrice] of products) {
    const existingProduct = await prisma.product.findUnique({ where: { name } });
    const aliasProduct = existingProduct ? null : await prisma.product.findFirst({ where: { name: { in: productAliases.get(name) || [] } } });
    if (existingProduct) {
      await prisma.product.update({ where: { id: existingProduct.id }, data: { dayPrice, weekPrice, twoWeekPrice } });
    } else if (aliasProduct) {
      await prisma.product.update({ where: { id: aliasProduct.id }, data: { name, dayPrice, weekPrice, twoWeekPrice } });
    } else {
      await prisma.product.create({ data: { name, dayPrice, weekPrice, twoWeekPrice } });
    }
  }

  for (const [name, code] of locks) {
    await prisma.lockCode.upsert({ where: { name }, create: { name, code }, update: { code } });
  }
}

main().finally(() => prisma.$disconnect());
