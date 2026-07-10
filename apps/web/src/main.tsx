import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}

type Product = { id: string; name: string; dayPrice: number; weekPrice: number | null; twoWeekPrice: number | null };
type Bike = { id: string; status: "HOME" | "RENTED"; product: Product; activeRental?: Rental | null };
type Rental = { id: string; renterName: string; address: string; phone: string; days: number; priceDkk: number; paymentMethod: "MP" | "KT"; rentalDate: string; expectedReturn: string; items: { bikeId: string; productName: string; priceDkk: number }[] };
type LockCode = { id: string; name: string; code: string };
type ProductLine = { id: string; productId: string; bikeId: string };

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const terms = {
  DA: "Lejeren skal ved bortkomst af varen melde dette omgående til udlejeren. Lejeren er til enhver tid erstatningspligtig overfor udlejer ved skade opstået i udlejningsperioden. Varen er udlejet på eget ansvar, også over for offentlige myndigheder. I tilfælde af skade kan der ikke rejses krav mod udlejer. Kun egen forsikring er gældende.",
  DE: "Der Mieter hat bei Abhandenkommen der Waren dieses dem Vermieter umgehend mitzuteilen. Der Mieter ist immer dem Vermieter gegenüber ersatzverpflichtet wegen Schäden, die in der Vermietungsperiode entstanden sind. Das Mieten der Waren geschieht auf eigene Gefahr, auch gegenüber öffentlichen Behörden. Falls Schaden entsteht, kann gegen den Vermieter kein Anspruch erhoben werden. Nur eine eigene Versicherung gilt.",
  EN: "If the item is lost, the hirer must inform the owner immediately. The hirer is at all times liable to the owner to pay damages for any damage occurring during the hire period. The item is hired out at the hirer's own risk, including responsibility before public authorities. In case of damage, no claims can be made against the owner. Only the hirer's own insurance applies."
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Der skete en fejl");
  return response.json();
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

function Signature({ value, onChange }: { value: string; onChange: (png: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const ctx = canvas.getContext("2d")!;
      const png = value || canvas.toDataURL("image/png");
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
        image.onload = () => ctx.drawImage(image, 0, 0, canvas.clientWidth, canvas.clientHeight);
        image.src = png;
      }
    };
    resize();
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
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
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  return <div>
    <canvas
      className="signature"
      ref={canvasRef}
      onPointerDown={(e) => {
        e.preventDefault();
        drawing.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        const ctx = e.currentTarget.getContext("2d")!;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        if (!drawing.current) return;
        drawing.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onChange(e.currentTarget.toDataURL("image/png"));
      }}
      onPointerCancel={() => {
        drawing.current = false;
      }}
    />
    <button className="ghost" type="button" onClick={() => { const c = canvasRef.current!; const ctx = c.getContext("2d")!; ctx.clearRect(0, 0, c.clientWidth, c.clientHeight); onChange(""); }}>Ryd underskrift</button>
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

  const load = async () => {
    const [b, p, r, l] = await Promise.all([api<Bike[]>("/bikes"), api<Product[]>("/products"), api<Rental[]>("/rentals"), api<LockCode[]>("/locks")]);
    setBikes(b); setProducts(p); setRentals(r); setLocks(l);
  };

  useEffect(() => { api("/auth/me").then(() => { setAuthed(true); load(); }).catch(() => setAuthed(false)); }, []);
  if (!authed) return <Login onLogin={() => { setAuthed(true); load(); }} />;

  return <main className="app">
    <header><div><strong>Samsø Cykeludlejning</strong><span>{new Date().toLocaleDateString("da-DK")}</span></div><button onClick={() => load()}>Opdater</button></header>
    {error && <p className="toast">{error}</p>}
    <section className="screen">
      {tab === "kontrakt" && <Contract products={products} onSaved={load} onError={setError} />}
      {tab === "lager" && <Inventory bikes={bikes} onSaved={load} />}
      {tab === "historik" && <History rentals={rentals} />}
      {tab === "laase" && <Locks locks={locks} onSaved={load} />}
    </section>
    <nav>
      {["kontrakt", "lager", "historik", "laase"].map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}
    </nav>
  </main>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("cykel");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return <main className="login"><form onSubmit={async (e) => { e.preventDefault(); try { await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); onLogin(); } catch (err) { setError((err as Error).message); } }}>
    <h1>Cykeludlejning</h1><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Brugernavn" /><input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="Kodeord" /><button>Log ind</button>{error && <p className="toast">{error}</p>}
  </form></main>;
}

function Contract({ products, onSaved, onError }: { products: Product[]; onSaved: () => void; onError: (msg: string) => void }) {
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [daysInput, setDaysInput] = useState("1");
  const [form, setForm] = useState({ renterName: "", address: "", phone: "", paymentMethod: "MP", acceptedTerms: false, signaturePng: "" });
  const [showTerms, setShowTerms] = useState(false);
  const days = Math.max(1, Number.parseInt(daysInput || "1", 10) || 1);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const productResults = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    if (!query) return products.slice(0, 6);
    return products.filter((product) => product.name.toLowerCase().includes(query)).slice(0, 6);
  }, [productQuery, products]);
  const price = lines.reduce((sum, line) => {
    const product = productById.get(line.productId);
    return product ? sum + priceProduct(product, days) : sum;
  }, 0);
  const addProduct = (product: Product) => {
    setLines((current) => [...current, { id: crypto.randomUUID(), productId: product.id, bikeId: "" }]);
    setProductQuery("");
  };
  const updateLine = (id: string, bikeId: string) => {
    setLines((current) => current.map((line) => line.id === id ? { ...line, bikeId } : line));
  };
  const removeLine = (id: string) => {
    setLines((current) => current.filter((line) => line.id !== id));
  };
  const save = async () => {
    try {
      if (!lines.length) throw new Error("Vælg mindst ét produkt");
      if (lines.some((line) => !line.bikeId.trim())) throw new Error("Skriv nr. på alle valgte produkter");
      await api("/rentals", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          days,
          bikeSelections: lines.map((line) => ({ productId: line.productId, bikeId: line.bikeId.trim() })),
          paymentMethod: form.paymentMethod
        })
      });
      setLines([]); setProductQuery(""); setDaysInput("1"); setForm({ renterName: "", address: "", phone: "", paymentMethod: "MP", acceptedTerms: false, signaturePng: "" }); onSaved();
    } catch (err) { onError((err as Error).message); }
  };
  return <section><h2>Lynkontrakt</h2>
    <label>Navn<input value={form.renterName} onChange={(e) => setForm({ ...form, renterName: e.target.value })} /></label>
    <label>Adresse<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
    <label>Telefonnummer<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
    <label>Produkt<input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Søg produkt" /></label>
    <div className="productResults">{productResults.map((product) => <button type="button" key={product.id} onClick={() => addProduct(product)}>{product.name}</button>)}</div>
    <div className="cards">{lines.map((line) => { const product = productById.get(line.productId); if (!product) return null; return <article className="productLine manualLine" key={line.id}><div><strong>{product.name}</strong><small>{priceProduct(product, days)} kr</small></div><label>Nr.<input value={line.bikeId} onChange={(e) => updateLine(line.id, e.target.value)} placeholder="Cykel nr." /></label><button type="button" onClick={() => removeLine(line.id)}>Fjern</button></article>; })}</div>
    <label>Periode<input inputMode="numeric" pattern="[0-9]*" value={daysInput} onChange={(e) => setDaysInput(e.target.value.replace(/\D/g, ""))} onBlur={() => setDaysInput((value) => value || "1")} /></label>
    <div className="price">Pris i DKK <strong>{price} kr</strong></div>
    <label>Betalingsmåde<select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option>MP</option><option>KT</option></select></label>
    <label>Dato<input value={new Date().toLocaleDateString("da-DK")} readOnly /></label>
    <label>Lejer (underskrift)<Signature value={form.signaturePng} onChange={(signaturePng) => setForm({ ...form, signaturePng })} /></label>
    <label className="check"><input type="checkbox" checked={form.acceptedTerms} onChange={(e) => setForm({ ...form, acceptedTerms: e.target.checked })} /><span onClick={() => setShowTerms(true)}>Lejebetingelser accepteret</span></label>
    <button className="primary" onClick={save}>Gem kontrakt</button>
    {showTerms && <Terms onClose={() => setShowTerms(false)} />}
  </section>;
}

function Inventory({ bikes, onSaved }: { bikes: Bike[]; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const filtered = bikes.filter((bike) => `${bike.id} ${bike.activeRental?.renterName || ""}`.toLowerCase().includes(q.toLowerCase()));
  return <section><h2>Lager</h2><input placeholder="Søg cykel eller lejer" value={q} onChange={(e) => setQ(e.target.value)} /><div className="bikeList">{filtered.map((bike) => <label className={`bike ${bike.status.toLowerCase()}`} key={bike.id}><input type="checkbox" checked={selected.includes(bike.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, bike.id] : selected.filter((id) => id !== bike.id))} /><b>{bike.id}</b><span>{bike.status === "HOME" ? "Hjemme" : `Udlejet til ${bike.activeRental?.renterName}`}</span><small>{bike.status === "RENTED" && `Retur ${new Date(bike.activeRental!.expectedReturn).toLocaleDateString("da-DK")}`}</small></label>)}</div><button className="primary" onClick={async () => { await api("/bikes/return", { method: "POST", body: JSON.stringify({ bikeIds: selected }) }); setSelected([]); onSaved(); }}>Marker valgte retur</button></section>;
}

function History({ rentals }: { rentals: Rental[] }) {
  return <section><h2>Kontrakter</h2><div className="cards">{rentals.map((rental) => <article className="card" key={rental.id}><h3>{rental.renterName}</h3><p>{rental.items.map((i) => i.bikeId).join(", ")} · {rental.priceDkk} kr · {rental.paymentMethod}</p><small>{new Date(rental.rentalDate).toLocaleDateString("da-DK")} til {new Date(rental.expectedReturn).toLocaleDateString("da-DK")}</small></article>)}</div></section>;
}

function Locks({ locks, onSaved }: { locks: LockCode[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, LockCode>>({});
  return <section><h2>Kodelåse</h2><div className="cards">{locks.map((lock) => { const item = draft[lock.id] || lock; return <article className="card lock" key={lock.id}><input value={item.name} onChange={(e) => setDraft({ ...draft, [lock.id]: { ...item, name: e.target.value } })} /><input value={item.code} onChange={(e) => setDraft({ ...draft, [lock.id]: { ...item, code: e.target.value } })} /><button onClick={async () => { await api(`/locks/${lock.id}`, { method: "PUT", body: JSON.stringify(item) }); onSaved(); }}>Gem</button></article>; })}</div></section>;
}

function Terms({ onClose }: { onClose: () => void }) {
  return <div className="modal"><article><h2>Lejebetingelser</h2>{Object.entries(terms).map(([lang, text]) => <p key={lang}><b>{lang}</b>: {text}</p>)}<button className="primary" onClick={onClose}>Luk</button></article></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
