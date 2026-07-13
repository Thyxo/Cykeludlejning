import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { calculateProductPrice, type PriceProduct } from "./pricing.js";

const app = express();
const prisma = new PrismaClient();
const jwtSecret = process.env.JWT_SECRET || "change-me";
const appOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
const appOrigins = appOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
const username = process.env.APP_USERNAME || "cykel";
const password = process.env.APP_PASSWORD || "sommer";

app.set("trust proxy", 1);
app.use(cors({
  origin(origin, callback) {
    if (!origin || appOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin er ikke tilladt"));
  },
  credentials: true
}));
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

function asyncRoute(handler: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<unknown>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function usesHttpsCookie(req: express.Request) {
  return appOrigins.some((origin) => origin.startsWith("https://")) || req.secure || req.get("x-forwarded-proto") === "https";
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const bearerToken = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = req.cookies.session || bearerToken;
  try {
    jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: "Ikke logget ind" });
  }
}

app.post("/auth/login", (req, res) => {
  const parsed = z.object({ username: z.string(), password: z.string() }).safeParse(req.body);
  if (!parsed.success || parsed.data.username !== username || parsed.data.password !== password) {
    return res.status(401).json({ error: "Forkert brugernavn eller kodeord" });
  }
  const token = jwt.sign({ sub: "staff" }, jwtSecret, { expiresIn: "180d" });
  const crossSiteCookie = usesHttpsCookie(req);
  res.cookie("session", token, {
    httpOnly: true,
    sameSite: crossSiteCookie ? "none" : "lax",
    secure: crossSiteCookie,
    maxAge: 180 * 24 * 60 * 60 * 1000
  });
  res.json({ ok: true, token });
});

app.post("/auth/logout", (req, res) => {
  const crossSiteCookie = usesHttpsCookie(req);
  res.clearCookie("session", { sameSite: crossSiteCookie ? "none" : "lax", secure: crossSiteCookie }).json({ ok: true });
});
app.get("/auth/me", requireAuth, (_req, res) => res.json({ username: "staff" }));

app.get("/products", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await prisma.product.findMany({ orderBy: { name: "asc" } }));
}));

app.get("/bikes", requireAuth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || "").trim();
  res.json(await prisma.bike.findMany({
    where: {
      status: "RENTED",
      ...(q ? {
        OR: [
          { id: { contains: q, mode: "insensitive" } },
          { activeRental: { renterName: { contains: q, mode: "insensitive" } } }
        ]
      } : {})
    },
    include: { product: true, activeRental: true },
    orderBy: { id: "asc" }
  }));
}));

app.post("/bikes/return", requireAuth, asyncRoute(async (req, res) => {
  const { bikeIds } = z.object({ bikeIds: z.array(z.string()).min(1) }).parse(req.body);
  await prisma.$transaction([
    prisma.bike.deleteMany({ where: { id: { in: bikeIds } } }),
    prisma.rental.updateMany({
      where: { activeBikes: { none: {} }, returnedAt: null },
      data: { returnedAt: new Date() }
    })
  ]);
  res.json({ ok: true });
}));

app.post("/pricing", requireAuth, asyncRoute(async (req, res) => {
  const { productIds, days } = z.object({ productIds: z.array(z.string()), days: z.number().int().min(1) }).parse(req.body);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const lines = products.map((product: PriceProduct) => ({ product, ...calculateProductPrice(product, days) }));
  res.json({ total: lines.reduce((sum: number, line: { total: number }) => sum + line.total, 0), lines });
}));

app.post("/rentals", requireAuth, asyncRoute(async (req, res) => {
  const data = z.object({
    renterName: z.string().min(1),
    address: z.string().min(1),
    phone: z.string().min(1),
    bikeIds: z.array(z.string()).min(1).optional(),
    bikeSelections: z.array(z.object({ productId: z.string().min(1), bikeId: z.string().min(1) })).min(1).optional(),
    days: z.number().int().min(1),
    paymentMethod: z.enum(["MP", "KT"]),
    acceptedTerms: z.boolean(),
    signaturePng: z.string(),
    forceReRent: z.boolean().optional()
  }).parse(req.body);
  if (!data.acceptedTerms) return res.status(400).json({ error: "Lejebetingelser skal accepteres" });
  if (!data.bikeSelections?.length && !data.bikeIds?.length) return res.status(400).json({ error: "Vælg mindst ét produkt" });
  const requestedBikeIds = data.bikeSelections?.map((selection) => selection.bikeId.trim()) || data.bikeIds || [];
  if (new Set(requestedBikeIds).size !== requestedBikeIds.length) return res.status(400).json({ error: "Samme nr. er valgt flere gange" });

  const selections = data.bikeSelections?.map((selection) => ({ productId: selection.productId, bikeId: selection.bikeId.trim() })) || [];
  const products = await prisma.product.findMany({ where: { id: { in: selections.map((selection) => selection.productId) } } }) as PriceProduct[];
  const productById = new Map<string, PriceProduct>(products.map((product: PriceProduct) => [product.id, product]));
  if (selections.some((selection) => !productById.has(selection.productId))) throw new Error("Produktet findes ikke");

  const existingBikes = await prisma.bike.findMany({ where: { id: { in: requestedBikeIds }, status: "RENTED" } }) as { id: string }[];
  if (existingBikes.length && !data.forceReRent) {
    return res.status(409).json({
      code: "BIKE_ALREADY_RENTED",
      bikeIds: existingBikes.map((bike: { id: string }) => bike.id),
      error: "En eller flere cykler er allerede udlejet"
    });
  }

  const items = selections.map((selection) => {
    const product = productById.get(selection.productId)!;
    const price = calculateProductPrice(product, data.days).total;
    return { bikeId: selection.bikeId, productName: product.name, priceDkk: price };
  });
  const priceDkk = items.reduce((sum: number, item: { priceDkk: number }) => sum + item.priceDkk, 0);
  const expectedReturn = new Date();
  expectedReturn.setDate(expectedReturn.getDate() + data.days - 1);

  const rental = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (existingBikes.length) {
      await tx.bike.updateMany({ where: { id: { in: existingBikes.map((bike: { id: string }) => bike.id) } }, data: { status: "HOME", activeRentalId: null } });
    }
    const createdRental = await tx.rental.create({
      data: {
        renterName: data.renterName,
        address: data.address,
        phone: data.phone,
        days: data.days,
        priceDkk,
        paymentMethod: data.paymentMethod,
        acceptedTerms: data.acceptedTerms,
        signaturePng: data.signaturePng,
        expectedReturn,
        items: { create: items }
      },
      include: { items: true }
    });
    await Promise.all(selections.map((selection) => tx.bike.upsert({
      where: { id: selection.bikeId },
      create: { id: selection.bikeId, productId: selection.productId, status: "RENTED", activeRentalId: createdRental.id },
      update: { productId: selection.productId, status: "RENTED", activeRentalId: createdRental.id }
    })));
    if (existingBikes.length) {
      await tx.rental.updateMany({
        where: { activeBikes: { none: {} }, returnedAt: null },
        data: { returnedAt: new Date() }
      });
    }
    return createdRental;
  });
  res.status(201).json(rental);
}));

app.get("/rentals", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await prisma.rental.findMany({ include: { items: true }, orderBy: { createdAt: "desc" }, take: 200 }));
}));

app.get("/locks", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await prisma.lockCode.findMany({ orderBy: { name: "asc" } }));
}));

app.put("/locks/:id", requireAuth, asyncRoute(async (req, res) => {
  const body = z.object({ name: z.string().min(1), code: z.string().min(1) }).parse(req.body);
  res.json(await prisma.lockCode.update({ where: { id: req.params.id }, data: body }));
}));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message || "Ugyldige oplysninger" });
  if (err instanceof Error && err.message === "Origin er ikke tilladt") return res.status(403).json({ error: err.message });
  if (err instanceof Error) return res.status(400).json({ error: err.message });
  return res.status(500).json({ error: "Der skete en fejl" });
});

app.listen(process.env.PORT || 4000, () => {
  console.log(`API klar på port ${process.env.PORT || 4000}`);
});
