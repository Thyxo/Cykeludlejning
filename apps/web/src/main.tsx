import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}

type Product = { id: string; name: string; dayPrice: number; weekPrice: number | null; twoWeekPrice: number | null };
type Bike = { id: string; status: "HOME" | "RENTED"; product: Product; activeRental?: Rental | null };
type Rental = {
  id: string;
  renterName: string;
  address: string;
  phone: string;
  days: number;
  priceDkk: number;
  paymentMethod: "MP" | "KT";
  acceptedTerms: boolean;
  signaturePng: string;
  rentalDate: string;
  expectedReturn: string;
  returnedAt?: string | null;
  items: { bikeId: string; productName: string; priceDkk: number }[];
};
type LockCode = { id: string; name: string; code: string };
type ProductLine = { id: string; productId: string; bikeId: string };

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const BRAND_LOGO = "/samsoe-logo.png";
const navLabels: Record<string, string> = {
  kontrakt: "kontrakt",
  lager: "lager",
  historik: "historik",
  laase: "koder"
};

class ApiError extends Error {
  status: number;
  code?: string;
  bikeIds?: string[];

  constructor(status: number, body: { error?: string; code?: string; bikeIds?: string[] }) {
    super(body.error || "Der skete en fejl");
    this.status = status;
    this.code = body.code;
    this.bikeIds = body.bikeIds;
  }
}

const productSearchAliases: Record<string, string[]> = {
  voksen: ["voksencykel", "damecykel", "herrecykel"],
  voksencykel: ["voksen"],
  barn: ["bornecykel", "barnecykel", "junior", "boern"],
  el: ["elcykel", "electric"],
  elcykel: ["el"],
  lad: ["ladcykel", "cargo", "cargobike"],
  anhanger: ["trailer", "anhaenger"],
  trailer: ["anhanger", "anhaenger"]
};
const terms = {
  DA: "Lejeren skal ved bortkomst af varen melde dette omgående til udlejeren. Lejeren er til enhver tid erstatningspligtig overfor udlejer ved skade opstået i udlejningsperioden. Varen er udlejet på eget ansvar, også over for offentlige myndigheder. I tilfælde af skade kan der ikke rejses krav mod udlejer. Kun egen forsikring er gældende.",
  DE: "Der Mieter hat bei Abhandenkommen der Waren dieses dem Vermieter umgehend mitzuteilen. Der Mieter ist immer dem Vermieter gegenüber ersatzverpflichtet wegen Schäden, die in der Vermietungsperiode entstanden sind. Das Mieten der Waren geschieht auf eigene Gefahr, auch gegenüber öffentlichen Behörden. Falls Schaden entsteht, kann gegen den Vermieter kein Anspruch erhoben werden. Nur eine eigene Versicherung gilt.",
  EN: "If the item is lost, the hirer must inform the owner immediately. The hirer is at all times liable to the owner to pay damages for any damage occurring during the hire period. The item is hired out at the hirer's own risk, including responsibility before public authorities. In case of damage, no claims can be made against the owner. Only the hirer's own insurance applies."
};

function getSessionToken() {
  return localStorage.getItem("sessionToken") || "";
}

function setSessionToken(token: string) {
  if (token) localStorage.setItem("sessionToken", token);
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getSessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { ...options, credentials: "include", headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

function priceProduct(product: Product, days: number) {
  let rest = days;
  let total = 0;
  if (product.twoWeekPrice) {
    const count = Math.floor(rest / 14);
    total += count * product.twoWeekPrice;
    rest -= count * 14;
  }
  if (product.weekPrice) {
    const count = Math.floor(rest / 7);
    total += count * product.weekPrice;
    rest -= count * 7;
  }
  total += rest * product.dayPrice;
  return total;
}

function expectedReturnDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days - 1);
  return date;
}

function formatReturnDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getDate()}/${date.getMonth() + 1}-${String(date.getFullYear()).slice(-2)}`;
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00e6/g, "ae")
    .replace(/\u00f8/g, "oe")
    .replace(/\u00e5/g, "aa")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function productSearchText(product: Product) {
  const normalizedName = normalizeSearch(product.name);
  const extraTerms = Object.entries(productSearchAliases)
    .filter(([term, aliases]) => normalizedName.includes(term) || aliases.some((alias) => normalizedName.includes(alias)))
    .flatMap(([term, aliases]) => [term, ...aliases]);
  return normalizeSearch([product.name, ...extraTerms].join(" "));
}

function productMatchesQuery(product: Product, query: string) {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const searchText = productSearchText(product);
  return words.length > 0 && words.every((word) => searchText.includes(word));
}

function SignaturePad({ value, onChange, className = "signature" }: { value: string; onChange: (png: string) => void; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const moved = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const drawContainedImage = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) => {
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const canvasRatio = width / height;
    const drawWidth = imageRatio > canvasRatio ? width : height * imageRatio;
    const drawHeight = imageRatio > canvasRatio ? width / imageRatio : height;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    let cancelled = false;
    const resize = () => {
      const ctx = canvas.getContext("2d")!;
      const png = value;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111";
      if (png.length > 200) {
        const image = new Image();
        image.onload = () => {
          if (!cancelled) drawContainedImage(ctx, image, canvas.clientWidth, canvas.clientHeight);
        };
        image.src = png;
      }
    };
    resize();
    addEventListener("resize", resize);
    return () => {
      cancelled = true;
      removeEventListener("resize", resize);
    };
  }, [value]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    event.preventDefault();
    const ctx = event.currentTarget.getContext("2d")!;
    const p = point(event);
    const previous = lastPoint.current;
    if (previous && Math.hypot(p.x - previous.x, p.y - previous.y) < 2) return;
    moved.current = true;
    lastPoint.current = p;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Some mobile browsers release pointer capture before React receives the final event.
    }
    if (moved.current) onChange(event.currentTarget.toDataURL("image/png"));
  };

  return <canvas
      className={className}
      ref={canvasRef}
      onPointerDown={(e) => {
        e.preventDefault();
        drawing.current = true;
        moved.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        lastPoint.current = p;
        const ctx = e.currentTarget.getContext("2d")!;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    />;
}

function Signature({ value, onChange }: { value: string; onChange: (png: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const closeExpanded = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    setExpanded(false);
  };

  return <div>
    <SignaturePad value={value} onChange={onChange} />
    <div className="signatureActions">
      <button className="ghost" type="button" onClick={() => setExpanded(true)}>Skriv stort</button>
      <button className="ghost danger" type="button" onClick={() => onChange("")}>Ryd underskrift</button>
    </div>
    {expanded && <div className="modal signatureModal"><article>
      <div className="modalHeader"><div><h2>Underskrift</h2><p>Drej gerne telefonen til landscape</p></div><button type="button" onClick={closeExpanded}>Færdig</button></div>
      <SignaturePad value={value} onChange={onChange} className="signature signatureLarge" />
      <div className="modalActions"><button type="button" onClick={() => onChange("")}>Ryd</button><button className="primary" type="button" onClick={closeExpanded}>Gem</button></div>
    </article></div>}
  </div>;
}

function App() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState("kontrakt");
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [locks, setLocks] = useState<LockCode[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  const load = async () => {
    const [bikesResult, productsResult, rentalsResult, locksResult] = await Promise.allSettled([
      api<Bike[]>("/bikes"),
      api<Product[]>("/products"),
      api<Rental[]>("/rentals"),
      api<LockCode[]>("/locks")
    ]);
    if (bikesResult.status === "fulfilled") setBikes(bikesResult.value);
    if (productsResult.status === "fulfilled") setProducts(productsResult.value);
    if (rentalsResult.status === "fulfilled") setRentals(rentalsResult.value);
    if (locksResult.status === "fulfilled") setLocks(locksResult.value);

    const failed = [bikesResult, productsResult, rentalsResult, locksResult].find((result) => result.status === "rejected");
    if (failed?.status === "rejected") setError((failed.reason as Error).message);
  };

  useEffect(() => { api("/auth/me").then(() => { setAuthed(true); load(); }).catch(() => { localStorage.removeItem("sessionToken"); setAuthed(false); }); }, []);
  if (!authed) return <Login onLogin={() => { setAuthed(true); load(); }} />;

  return <main className="app">
    <header><div className="brandLockup"><img src={BRAND_LOGO} alt="Samsø Cykeludlejning" /><div><strong>Samsø Cykeludlejning</strong><span>Svenskgyden 4, Mårup · 30 86 85 23</span></div></div><button onClick={() => load()}>Opdater</button></header>
    {error && <p className="toast">{error}</p>}
    <section className="screen">
      {tab === "kontrakt" && <Contract products={products} onSaved={load} onError={setError} />}
      {tab === "lager" && <Inventory bikes={bikes} onSaved={load} />}
      {tab === "historik" && <History rentals={rentals} />}
      {tab === "laase" && <Locks locks={locks} onSaved={load} />}
    </section>
    <nav>
      {["kontrakt", "lager", "historik", "laase"].map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{navLabels[item]}</button>)}
    </nav>
  </main>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("cykel");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return <main className="login"><form onSubmit={async (e) => { e.preventDefault(); try { const result = await api<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); setSessionToken(result.token); onLogin(); } catch (err) { setError((err as Error).message); } }}>
    <div className="loginBrand"><img className="loginLogo" src={BRAND_LOGO} alt="Samsø Cykeludlejning" /></div>
    <h1>Cykeludlejning</h1><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Brugernavn" /><input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="Kodeord" /><button>Log ind</button>{error && <p className="toast">{error}</p>}
  </form></main>;
}

function Contract({ products, onSaved, onError }: { products: Product[]; onSaved: () => void; onError: (msg: string) => void }) {
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [daysInput, setDaysInput] = useState("1");
  const [form, setForm] = useState({ renterName: "", address: "", phone: "", paymentMethod: "MP", acceptedTerms: false, signaturePng: "" });
  const [showTerms, setShowTerms] = useState(false);
  const [quantityProduct, setQuantityProduct] = useState<Product | null>(null);
  const [quantityInput, setQuantityInput] = useState("1");
  const days = Math.max(1, Number.parseInt(daysInput || "1", 10) || 1);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const productResults = useMemo(() => {
    const query = productQuery.trim();
    if (!query) return [];
    return products.filter((product) => productMatchesQuery(product, query)).slice(0, 8);
  }, [productQuery, products]);
  const price = lines.reduce((sum, line) => {
    const product = productById.get(line.productId);
    return product ? sum + priceProduct(product, days) : sum;
  }, 0);
  const addProduct = (product: Product, quantity = 1) => {
    const count = Math.max(1, Math.min(99, Math.floor(quantity)));
    setLines((current) => [
      ...current,
      ...Array.from({ length: count }, () => ({ id: crypto.randomUUID(), productId: product.id, bikeId: "" }))
    ]);
    setProductQuery("");
  };
  const openQuantityDialog = (product: Product) => {
    setQuantityProduct(product);
    setQuantityInput("1");
  };
  const confirmQuantity = () => {
    if (!quantityProduct) return;
    addProduct(quantityProduct, Number.parseInt(quantityInput || "1", 10) || 1);
    setQuantityProduct(null);
  };
  const updateLine = (id: string, bikeId: string) => {
    setLines((current) => current.map((line) => line.id === id ? { ...line, bikeId } : line));
  };
  const removeLine = (id: string) => {
    setLines((current) => current.filter((line) => line.id !== id));
  };
  const save = async (forceReRent = false) => {
    try {
      if (!lines.length) throw new Error("Vælg mindst ét produkt");
      if (lines.some((line) => !line.bikeId.trim())) throw new Error("Skriv nr. på alle valgte produkter");
      await api("/rentals", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          days,
          bikeSelections: lines.map((line) => ({ productId: line.productId, bikeId: line.bikeId.trim() })),
          paymentMethod: form.paymentMethod,
          forceReRent
        })
      });
      setLines([]); setProductQuery(""); setDaysInput("1"); setForm({ renterName: "", address: "", phone: "", paymentMethod: "MP", acceptedTerms: false, signaturePng: "" }); onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === "BIKE_ALREADY_RENTED") {
        const bikeText = err.bikeIds?.join(", ") || "en eller flere cykler";
        const confirmed = window.confirm(`${bikeText} er allerede ude. Er du sikker på du vil leje cyklen igen, eller vil du markere den som modtaget først?\n\nTryk OK for at markere den modtaget og sætte den på den nye kontrakt.`);
        if (confirmed) await save(true);
        return;
      }
      onError((err as Error).message);
    }
  };
  return <section><h2>Lynkontrakt</h2>
    <label>Navn<input value={form.renterName} onChange={(e) => setForm({ ...form, renterName: e.target.value })} /></label>
    <label>Adresse<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
    <label>Telefonnummer<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
    <label>Produkt<input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Skriv fx Voksencykel" autoComplete="off" /></label>
    <div className="productResults">
      {productResults.map((product) => <button type="button" key={product.id} onClick={() => openQuantityDialog(product)}><strong>{product.name}</strong><small>{priceProduct(product, days)} kr</small></button>)}
      {!products.length && <p className="hint">Indlæser produkter...</p>}
      {products.length > 0 && productQuery.trim() && !productResults.length && <p className="hint">Ingen produkter fundet</p>}
    </div>
    <div className="cards selectedProducts">{lines.map((line) => { const product = productById.get(line.productId); if (!product) return null; return <article className="productLine manualLine" key={line.id}><div><strong>{product.name}</strong><small>{priceProduct(product, days)} kr</small></div><label>Nr.<input value={line.bikeId} onChange={(e) => updateLine(line.id, e.target.value)} placeholder="Cykel nr." autoComplete="off" /></label><button type="button" onClick={() => removeLine(line.id)}>Fjern</button></article>; })}</div>
    <div className="periodRow"><label>Periode<input inputMode="numeric" pattern="[0-9]*" value={daysInput} onChange={(e) => setDaysInput(e.target.value.replace(/\D/g, ""))} onBlur={() => setDaysInput((value) => value || "1")} /></label><label>Afleveringsdag<input value={formatReturnDate(expectedReturnDate(days))} readOnly /></label></div>
    <div className="price">Pris i DKK <strong>{price} kr</strong></div>
    <label>Betalingsmåde<select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option>MP</option><option>KT</option></select></label>
    <label>Dato<input value={new Date().toLocaleDateString("da-DK")} readOnly /></label>
    <div className="fieldLabel"><span>Lejer (underskrift)</span><Signature value={form.signaturePng} onChange={(signaturePng) => setForm({ ...form, signaturePng })} /></div>
    <label className="check"><input type="checkbox" checked={form.acceptedTerms} onChange={(e) => setForm({ ...form, acceptedTerms: e.target.checked })} /><span onClick={() => setShowTerms(true)}>Lejebetingelser accepteret</span></label>
    <button className="primary" onClick={() => save()}>Gem kontrakt</button>
    {quantityProduct && <QuantityDialog product={quantityProduct} value={quantityInput} onChange={setQuantityInput} onCancel={() => setQuantityProduct(null)} onConfirm={confirmQuantity} />}
    {showTerms && <Terms onClose={() => setShowTerms(false)} />}
  </section>;
}

function QuantityDialog({ product, value, onChange, onCancel, onConfirm }: { product: Product; value: string; onChange: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal quantityModal"><article>
    <h2>Hvor mange?</h2>
    <p>{product.name}</p>
    <input autoFocus inputMode="numeric" pattern="[0-9]*" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); }} />
    <div className="modalActions"><button type="button" onClick={onCancel}>Annuller</button><button className="primary" type="button" onClick={onConfirm}>Tilføj</button></div>
  </article></div>;
}

function Inventory({ bikes, onSaved }: { bikes: Bike[]; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const filtered = bikes.filter((bike) => `${bike.id} ${bike.product.name} ${bike.activeRental?.renterName || ""}`.toLowerCase().includes(q.toLowerCase()));
  const groups = Array.from(filtered.reduce((map, bike) => {
    const key = bike.activeRental?.id || bike.id;
    const group = map.get(key) || { rental: bike.activeRental, bikes: [] as Bike[] };
    group.bikes.push(bike);
    map.set(key, group);
    return map;
  }, new Map<string, { rental?: Rental | null; bikes: Bike[] }>()).values());
  const returnSelected = async () => {
    if (!selected.length) return;
    await api("/bikes/return", { method: "POST", body: JSON.stringify({ bikeIds: selected }) });
    setSelected([]);
    onSaved();
  };
  return <section><h2>Lager</h2>
    <input placeholder="Søg cykel eller lejer" value={q} onChange={(e) => setQ(e.target.value)} />
    {!groups.length && <p className="hint">Ingen cykler ude</p>}
    <div className="rentalGroups">{groups.map((group) => <article className="rentalGroup" key={group.rental?.id || group.bikes[0]?.id}>
      <h3>{group.rental?.renterName || "Uden kontrakt"}</h3>
      <div className="bikeList">{group.bikes.map((bike) => <label className="bike rented" key={bike.id}>
        <input type="checkbox" checked={selected.includes(bike.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, bike.id] : selected.filter((id) => id !== bike.id))} />
        <b>{bike.product.name}</b>
        <span>{bike.id}</span>
        <small>retur {formatReturnDate(bike.activeRental?.expectedReturn || new Date())}</small>
      </label>)}</div>
    </article>)}</div>
    <button className="primary" disabled={!selected.length} onClick={returnSelected}>Marker valgte modtaget</button>
  </section>;
}

/*
function InventoryOld({ bikes, onSaved }: { bikes: Bike[]; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const filtered = bikes.filter((bike) => `${bike.id} ${bike.activeRental?.renterName || ""}`.toLowerCase().includes(q.toLowerCase()));
  return <section><h2>Lager</h2><input placeholder="Søg cykel eller lejer" value={q} onChange={(e) => setQ(e.target.value)} /><div className="bikeList">{filtered.map((bike) => <label className={`bike ${bike.status.toLowerCase()}`} key={bike.id}><input type="checkbox" checked={selected.includes(bike.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, bike.id] : selected.filter((id) => id !== bike.id))} /><b>{bike.id}</b><span>{bike.status === "HOME" ? "Hjemme" : `Udlejet til ${bike.activeRental?.renterName}`}</span><small>{bike.status === "RENTED" && `Retur ${new Date(bike.activeRental!.expectedReturn).toLocaleDateString("da-DK")}`}</small></label>)}</div><button className="primary" onClick={async () => { await api("/bikes/return", { method: "POST", body: JSON.stringify({ bikeIds: selected }) }); setSelected([]); onSaved(); }}>Marker valgte retur</button></section>;
}

*/
function History({ rentals }: { rentals: Rental[] }) {
  const [query, setQuery] = useState("");
  const [selectedRental, setSelectedRental] = useState<Rental | null>(null);
  const filteredRentals = useMemo(() => {
    const search = normalizeSearch(query);
    if (!search) return rentals;
    return rentals.filter((rental) => {
      const text = normalizeSearch([
        rental.renterName,
        rental.address,
        rental.phone,
        rental.paymentMethod,
        rental.priceDkk,
        formatReturnDate(rental.rentalDate),
        formatReturnDate(rental.expectedReturn),
        rental.items.map((item) => `${item.productName} ${item.bikeId}`).join(" ")
      ].join(" "));
      return search.split(/\s+/).filter(Boolean).every((word) => text.includes(word));
    });
  }, [query, rentals]);

  return <section><h2>Kontrakter</h2>
    <input placeholder="Søg navn, telefon, cykel nr. eller produkt" value={query} onChange={(e) => setQuery(e.target.value)} />
    {!filteredRentals.length && <p className="hint">Ingen kontrakter fundet</p>}
    <div className="cards">{filteredRentals.map((rental) => <article className="card historyCard" key={rental.id}>
      <div>
        <h3>{rental.renterName}</h3>
        <p>{rental.items.map((item) => item.bikeId).join(", ")} · {rental.priceDkk} kr · {rental.paymentMethod}</p>
        <small>{formatReturnDate(rental.rentalDate)} til {formatReturnDate(rental.expectedReturn)}</small>
      </div>
      <button type="button" onClick={() => setSelectedRental(rental)}>Åbn kontrakt</button>
    </article>)}</div>
    {selectedRental && <ContractDetails rental={selectedRental} onClose={() => setSelectedRental(null)} />}
  </section>;
}

function ContractDetails({ rental, onClose }: { rental: Rental; onClose: () => void }) {
  return <div className="modal contractModal"><article>
    <div className="modalHeader"><div><h2>Kontrakt</h2><p>{rental.renterName}</p></div><button type="button" onClick={onClose}>Luk</button></div>
    <div className="contractInfo">
      <div><span>Navn</span><strong>{rental.renterName}</strong></div>
      <div><span>Adresse</span><strong>{rental.address}</strong></div>
      <div><span>Telefonnummer</span><strong>{rental.phone}</strong></div>
      <div><span>Periode</span><strong>{rental.days} dage</strong></div>
      <div><span>Dato</span><strong>{formatReturnDate(rental.rentalDate)}</strong></div>
      <div><span>Afleveringsdag</span><strong>{formatReturnDate(rental.expectedReturn)}</strong></div>
      <div><span>Betaling</span><strong>{rental.paymentMethod}</strong></div>
      <div><span>Pris i DKK</span><strong>{rental.priceDkk} kr</strong></div>
      <div><span>Handelsbetingelser</span><strong>{rental.acceptedTerms ? "Accepteret" : "Ikke accepteret"}</strong></div>
      {rental.returnedAt && <div><span>Returneret</span><strong>{formatReturnDate(rental.returnedAt)}</strong></div>}
    </div>
    <div className="contractItems">
      <h3>Produkter</h3>
      {rental.items.map((item) => <div className="contractItem" key={item.bikeId}>
        <span>{item.productName}</span><strong>{item.bikeId}</strong><small>{item.priceDkk} kr</small>
      </div>)}
    </div>
    <div className="signaturePreview">
      <h3>Underskrift</h3>
      {rental.signaturePng ? <img src={rental.signaturePng} alt={`Underskrift fra ${rental.renterName}`} /> : <p className="hint">Ingen underskrift gemt</p>}
    </div>
  </article></div>;
}

/*
function HistoryOld({ rentals }: { rentals: Rental[] }) {
  return <section><h2>Kontrakter</h2><div className="cards">{rentals.map((rental) => <article className="card" key={rental.id}><h3>{rental.renterName}</h3><p>{rental.items.map((i) => i.bikeId).join(", ")} · {rental.priceDkk} kr · {rental.paymentMethod}</p><small>{new Date(rental.rentalDate).toLocaleDateString("da-DK")} til {new Date(rental.expectedReturn).toLocaleDateString("da-DK")}</small></article>)}</div></section>;
}

*/
function Locks({ locks, onSaved }: { locks: LockCode[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, LockCode>>({});
  return <section><h2>Kodelåse</h2><div className="cards">{locks.map((lock) => { const item = draft[lock.id] || lock; return <article className="card lock" key={lock.id}><input value={item.name} onChange={(e) => setDraft({ ...draft, [lock.id]: { ...item, name: e.target.value } })} /><input value={item.code} onChange={(e) => setDraft({ ...draft, [lock.id]: { ...item, code: e.target.value } })} /><button onClick={async () => { await api(`/locks/${lock.id}`, { method: "PUT", body: JSON.stringify(item) }); onSaved(); }}>Gem</button></article>; })}</div></section>;
}

function Terms({ onClose }: { onClose: () => void }) {
  return <div className="modal"><article><h2>Lejebetingelser</h2>{Object.entries(terms).map(([lang, text]) => <p key={lang}><b>{lang}</b>: {text}</p>)}<button className="primary" onClick={onClose}>Luk</button></article></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
