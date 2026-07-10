import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  ["Voksencykel 28/26 med 7 gear", 90, 450, 800],
  ["Børnecykel 24", 70, 350, 500],
  ["Børnecykel 20 med 3 gear", 70, 350, 500],
  ["Børnecykel 18 uden gear", 60, 300, 400],
  ["MTB 29", 200, 1000, 2000],
  ["Elcykel centermotor op til 80 km", 325, 1700, null],
  ["Elcykel forhjulsmotor op til 40/50 km", 225, 1250, 2250],
  ["Ladcykel med el til 2 børn/cargobike", 450, 2250, null],
  ["Hundetrailer/Dogtrailer", 90, 450, 800],
  ["Børnetrailer 2 børn max 40 kg", 80, 400, 700],
  ["Barnesæde max 25 kg", 30, 150, 200],
  ["Hundekurv", 50, 250, null],
  ["Hjelm", 25, 125, 200],
  ["Levering/afhentning", 150, null, null],
  ["Aftencykel (16-24)", 50, null, null]
] as const;

const locks = [
  ["Kode 1", "616"],
  ["Kode 2", "152"],
  ["Kode 3", "906"],
  ["Kode 4", "892"],
  ["Start", "360"],
  ["Slut", "894"]
] as const;

async function main() {
  for (const [name, dayPrice, weekPrice, twoWeekPrice] of products) {
    await prisma.product.upsert({
      where: { name },
      create: { name, dayPrice, weekPrice, twoWeekPrice },
      update: { dayPrice, weekPrice, twoWeekPrice }
    });
  }

  const adult = await prisma.product.findUniqueOrThrow({ where: { name: products[0][0] } });
  for (let n = 100; n <= 140; n += 1) {
    await prisma.bike.upsert({
      where: { id: `D${n}` },
      create: { id: `D${n}`, productId: adult.id },
      update: {}
    });
  }

  for (const [name, code] of locks) {
    await prisma.lockCode.upsert({ where: { name }, create: { name, code }, update: { code } });
  }
}

main().finally(() => prisma.$disconnect());
