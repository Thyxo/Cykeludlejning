import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
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
  const token = req.cookies.session;
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
  res.json({ ok: true });
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
    where: q ? {
      OR: [
        { id: { contains: q, mode: "insensitive" } },
        { activeRental: { renterName: { contains: q, mode: "insensitive" } } }
      ]
    } : undefined,
    include: { product: true, activeRental: true },
    orderBy: { id: "asc" }
  }));
}));

app.post("/bikes/return", requireAuth, asyncRoute(async (req, res) => {
  const { bikeIds } = z.object({ bikeIds: z.array(z.string()).min(1) }).parse(req.body);
  await prisma.$transaction([
    prisma.bike.updateMany({ where: { id: { in: bikeIds } }, data: { status: "HOME", activeRentalId: null } }),
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
    signaturePng: z.string().min(100)
  }).parse(req.body);
  if (!data.acceptedTerms) return res.status(400).json({ error: "Lejebetingelser skal accepteres" });
  if (!data.bikeSelections?.length && !data.bikeIds?.length) return res.status(400).json({ error: "Vælg mindst ét produkt" });
  const requestedBikeIds = data.bikeSelections?.map((selection) => selection.bikeId.trim()) || data.bikeIds || [];
  if (new Set(requestedBikeIds).size !== requestedBikeIds.length) return res.status(400).json({ error: "Samme nr. er valgt flere gange" });

  const bikes = data.bikeSelections?.length
    ? await Promise.all(data.bikeSelections.map(async (selection) => {
      const product = await prisma.product.findUnique({ where: { id: selection.productId } });
      if (!product) throw new Error("Produktet findes ikke");
      const bikeId = selection.bikeId.trim();
      const existing = await prisma.bike.findUnique({ where: { id: bikeId }, include: { product: true } });
      if (existing && existing.status !== "HOME") throw new Error(`${bikeId} er allerede udlejet`);
      if (existing && existing.productId !== selection.productId) throw new Error(`${bikeId} findes allerede som ${existing.product.name}`);
      return existing || await prisma.bike.create({ data: { id: bikeId, productId: selection.productId }, include: { product: true } });
    }))
    : await prisma.bike.findMany({ where: { id: { in: requestedBikeIds }, status: "HOME" }, include: { product: true } });
  const expectedCount = requestedBikeIds.length;
  if (bikes.length !== expectedCount) return res.status(409).json({ error: "En eller flere cykler er allerede udlejet" });

  const items = bikes.map((bike: { id: string; product: PriceProduct }) => {
    const price = calculateProductPrice(bike.product, data.days).total;
    return { bikeId: bike.id, productName: bike.product.name, priceDkk: price };
  });
  const priceDkk = items.reduce((sum: number, item: { priceDkk: number }) => sum + item.priceDkk, 0);
  const expectedReturn = new Date();
  expectedReturn.setDate(expectedReturn.getDate() + data.days);

  const rental = await prisma.rental.create({
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
  await prisma.bike.updateMany({ where: { id: { in: requestedBikeIds } }, data: { status: "RENTED", activeRentalId: rental.id } });
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
