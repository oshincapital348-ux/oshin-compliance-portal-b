import React, { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { Plus, Trash2, Download, FileText, Building2, Landmark, ClipboardList, TrendingUp, ShieldCheck } from "lucide-react";

const INK = "#152238";
const INK_2 = "#1F3252";
const GOLD = "#AD8A34";
const GOLD_L = "#F3EBD6";
const GREEN = "#2A5F52";
const PAPER = "#FBF9F4";
const LINE = "#DFDACB";
const TEXT = "#23262B";
const MUTED = "#6B6656";

const fmt = (n) =>
  (isFinite(n) ? n : 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const pct = (n) => `${(isFinite(n) ? n : 0).toFixed(1)}%`;

const YEARS = [1, 2, 3, 4, 5];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function emptyLine(extra = {}) {
  return { id: uid(), name: "", ...extra };
}

export default function App() {
  const [tab, setTab] = useState("inputs");

  // ---------------------------------------------------------------------
  // ACCESS GATE
  // Browsing is free. Filling in data + generating a report is paid,
  // except for a super admin. Enforcement happens in /api (serverless
  // functions), never in this component — this file only reflects
  // whatever the server told it via `accessToken`.
  // ---------------------------------------------------------------------
  const [access, setAccess] = useState("locked"); // "locked" | "paid" | "admin"
  const [accessToken, setAccessToken] = useState(null);
  const [checkingLink, setCheckingLink] = useState(true);

  // Central place any unlock path (Razorpay, approval link, admin login)
  // goes through — persists to localStorage so a page refresh doesn't force
  // the customer to pay again mid-session.
  const handleUnlock = (mode, token) => {
    setAccess(mode);
    setAccessToken(token);
    try {
      localStorage.setItem("oshinAccess", JSON.stringify({ mode, token }));
    } catch {
      // localStorage can fail in rare cases (private browsing limits, etc.) —
      // access still works for this page load, just won't survive a refresh.
    }
  };

  const handleLogout = () => {
    setAccess("locked");
    setAccessToken(null);
    try {
      localStorage.removeItem("oshinAccess");
    } catch {}
  };

  // On load: first check for an approval-link token in the URL (?access=…),
  // then fall back to whatever was saved locally from an earlier unlock in
  // this browser. Either way, the server re-validates before trusting it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkToken = params.get("access");

    let savedToken = null;
    try {
      const saved = JSON.parse(localStorage.getItem("oshinAccess") || "null");
      savedToken = saved?.token || null;
    } catch {
      savedToken = null;
    }

    const tokenToCheck = linkToken || savedToken;
    if (!tokenToCheck) {
      setCheckingLink(false);
      return;
    }

    fetch("/api/validate-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenToCheck }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) handleUnlock(data.mode === "admin" ? "admin" : "paid", tokenToCheck);
        else localStorage.removeItem("oshinAccess"); // stale/expired — clear it
      })
      .catch(() => {})
      .finally(() => {
        setCheckingLink(false);
        // Clean any token out of the visible URL so it isn't sitting in
        // browser history / accidentally shared further.
        if (linkToken) window.history.replaceState({}, "", window.location.pathname);
      });
  }, []);



  const [entrepreneur, setEntrepreneur] = useState({
    name: "",
    business: "",
    address: "",
    mobile: "",
    email: "",
  });

  const [capex, setCapex] = useState({
    land: 0,
    workshed: 0,
    furniture: 0,
    preliminary: 0,
    contingency: 0,
  });
  const [machinery, setMachinery] = useState([{ id: uid(), name: "", qty: 0, rate: 0 }]);

  const [finance, setFinance] = useState({
    ownPct: 5,
    interestRate: 11,
    tenureYears: 5,
  });

  const [products, setProducts] = useState([{ id: uid(), name: "", qty: 0, rate: 0 }]);
  const [capacityUtil, setCapacityUtil] = useState([70, 75, 80, 85, 90]);

  const [rawMaterials, setRawMaterials] = useState([{ id: uid(), name: "", qty: 0, rate: 0 }]);
  const [wages, setWages] = useState([{ id: uid(), name: "", workers: 0, perMonth: 0 }]);

  const [opex, setOpex] = useState({ repairs: 0, power: 0, otherOverhead: 0 });
  const [admin, setAdmin] = useState({
    salary: 0,
    telephone: 0,
    stationery: 0,
    advertisement: 0,
    workshedRent: 0,
    misc: 0,
  });
  const [depRate, setDepRate] = useState(10);

  const [details, setDetails] = useState({
    employment: 0,
    powerRequirement: "",
    implementationMonths: 0,
    payBackYears: 5,
    place: "",
    date: new Date().toISOString().slice(0, 10),
  });

  const [narrative, setNarrative] = useState({ introduction: "", aboutPromoter: "" });

  const defaultIntro = (business, prods) =>
    `${business || "The enterprise"} is engaged in delivering high-quality products and reliable, timely service to customers across different market segments. The unit proposes to manufacture and supply ${
      prods.length ? prods.map((p) => p.name).filter(Boolean).join(", ") : "the products listed above"
    }, with a strong focus on quality, timely delivery and customer satisfaction. Growing demand in this segment has created substantial opportunity for well-run units that combine quality, durability and competitive pricing, and this project has been drawn up to meet that demand using efficient production methods and skilled workmanship.`;

  const defaultAbout = (name, business) =>
    `${name || "The applicant"} is the proprietor of ${business || "the proposed unit"}, a dedicated entrepreneur with a vision to build a successful, sustainable business. Recognising the growing demand in this segment, ${
      name ? name.split(" ")[0] : "the promoter"
    } has undertaken this venture to provide quality products at competitive prices while ensuring customer satisfaction through timely delivery and consistent workmanship. The promoter is committed to maintaining high standards through the use of quality materials, efficient processes and continuous improvement, alongside ethical and cost-effective business practices.`;


  // ---------- line item helpers ----------
  const updateLine = (setter, id, field, value) =>
    setter((list) => list.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  const addLine = (setter, extra) => setter((list) => [...list, emptyLine(extra)]);
  const removeLine = (setter, id) => setter((list) => list.filter((l) => l.id !== id));

  // ---------- core calculations ----------
  const calc = useMemo(() => {
    const machineryTotal = machinery.reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.rate) || 0), 0);
    const fixedCapital = Number(capex.land) + Number(capex.workshed) + machineryTotal + Number(capex.furniture);
    const totalCapEx = fixedCapital + Number(capex.preliminary) + Number(capex.contingency);

    const salesAt100 = products.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.rate) || 0), 0);
    const rawMaterialAt100 = rawMaterials.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
    const wagesAt100 = wages.reduce((s, w) => s + (Number(w.workers) || 0) * (Number(w.perMonth) || 0) * 12, 0);

    const productionCostAt100 = rawMaterialAt100 + wagesAt100 + Number(opex.repairs) + Number(opex.power) + Number(opex.otherOverhead);
    const adminCostAt100 =
      Number(admin.salary) + Number(admin.telephone) + Number(admin.stationery) + Number(admin.advertisement) + Number(admin.workshedRent) + Number(admin.misc);
    const manufacturingCostAt100 = productionCostAt100 + adminCostAt100;

    const workingCapital =
      (rawMaterialAt100 * 90) / 365 + (productionCostAt100 * 30) / 365 + (manufacturingCostAt100 * 30) / 365 + (manufacturingCostAt100 * 30) / 365;

    const totalProjectCost = totalCapEx + workingCapital;
    const ownContribution = (totalProjectCost * Number(finance.ownPct)) / 100;
    const bankFinance = totalProjectCost - ownContribution;
    const termLoan = totalProjectCost > 0 ? bankFinance * (totalCapEx / totalProjectCost) : 0;
    const wcLoan = totalProjectCost > 0 ? bankFinance * (workingCapital / totalProjectCost) : 0;

    const tenure = Number(finance.tenureYears) || 5;
    const rate = Number(finance.interestRate) || 0;

    function loanSchedule(principal) {
      const installment = principal / tenure;
      let opening = principal;
      const rows = [];
      for (let i = 0; i < tenure; i++) {
        const interest = (opening * rate) / 100;
        const closing = Math.max(0, opening - installment);
        rows.push({ opening, installment, interest, closing });
        opening = closing;
      }
      return rows;
    }
    const termSchedule = loanSchedule(termLoan);
    const wcSchedule = loanSchedule(wcLoan);

    // depreciation (WDV) on workshed + machinery + furniture, over 5 years
    const depreciableBase = Number(capex.workshed) + machineryTotal + Number(capex.furniture);
    let depOpening = depreciableBase;
    const depSchedule = [];
    for (let i = 0; i < 5; i++) {
      const dep = (depOpening * Number(depRate)) / 100;
      const closing = depOpening - dep;
      depSchedule.push({ opening: depOpening, dep, closing });
      depOpening = closing;
    }

    // 5-year projections driven by capacity utilization
    const years = capacityUtil.map((cap, i) => {
      const f = cap / 100;
      const sales = salesAt100 * f;
      const rawMaterial = rawMaterialAt100 * f;
      const wagesY = wagesAt100 * f;
      const repairs = Number(opex.repairs) * f;
      const power = Number(opex.power) * f;
      const otherOverhead = Number(opex.otherOverhead) * f;
      const dep = depSchedule[i] ? depSchedule[i].dep : 0;
      const productionCost = rawMaterial + wagesY + repairs + power + otherOverhead + dep;

      const salary = Number(admin.salary) * f;
      const telephone = Number(admin.telephone) * f;
      const stationery = Number(admin.stationery) * f;
      const advertisement = Number(admin.advertisement) * f;
      const workshedRent = Number(admin.workshedRent) * f;
      const misc = Number(admin.misc) * f;
      const adminCost = salary + telephone + stationery + advertisement + workshedRent + misc;

      const termInterest = termSchedule[i] ? termSchedule[i].interest : 0;
      const termInstallment = termSchedule[i] ? termSchedule[i].installment : 0;
      const wcInterest = wcSchedule[i] ? wcSchedule[i].interest : 0;
      const wcInstallment = wcSchedule[i] ? wcSchedule[i].installment : 0;

      const costOfSale = productionCost + adminCost + termInterest + wcInterest;
      const netProfit = sales - costOfSale;

      const dscrNumerator = netProfit + dep;
      // DSCR denominator: term loan interest + installment, plus WC interest —
      // but NOT WC principal repayment. Working capital is a revolving
      // facility serviced through the operating cycle itself, not amortized
      // like a term loan, so its principal isn't part of the debt-service
      // burden DSCR is meant to measure.
      const dscrDenominator = termInterest + termInstallment + wcInterest;
      const dscr = dscrDenominator > 0 ? dscrNumerator / dscrDenominator : 0;

      // Break-even split: term loan interest is fixed (doesn't vary with
      // output), so it belongs in fixed cost alongside admin cost and
      // depreciation. Working capital interest scales with the operating
      // cycle, so it's grouped with variable costs. This way Fixed +
      // Variable reconciles exactly to Cost of Sale.
      const variableCost = rawMaterial + wagesY + repairs + power + otherOverhead + wcInterest;
      const fixedCost = adminCost + dep + termInterest;
      const contribution = sales - variableCost;
      const bepPct = contribution > 0 ? (fixedCost / contribution) * 100 : 0;
      const bepSales = contribution > 0 ? (fixedCost / contribution) * sales : 0;

      return {
        capacity: cap,
        sales,
        rawMaterial,
        wages: wagesY,
        repairs,
        power,
        otherOverhead,
        dep,
        productionCost,
        salary,
        telephone,
        stationery,
        advertisement,
        workshedRent,
        misc,
        adminCost,
        termInterest,
        termInstallment,
        wcInterest,
        wcInstallment,
        costOfSale,
        netProfit,
        dscr,
        fixedCost,
        variableCost,
        contribution,
        bepPct,
        bepSales,
      };
    });

    const avgDscr = years.reduce((s, y) => s + y.dscr, 0) / (years.length || 1);

    return {
      machineryTotal,
      fixedCapital,
      totalCapEx,
      salesAt100,
      rawMaterialAt100,
      wagesAt100,
      productionCostAt100,
      adminCostAt100,
      manufacturingCostAt100,
      workingCapital,
      totalProjectCost,
      ownContribution,
      bankFinance,
      termLoan,
      wcLoan,
      termSchedule,
      wcSchedule,
      depSchedule,
      years,
      avgDscr,
    };
  }, [capex, machinery, finance, products, capacityUtil, rawMaterials, wages, opex, admin, depRate]);

  // ---------- excel export ----------
  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();

    const topSheet = [
      ["PROJECT AT A GLANCE"],
      [],
      ["Name of entrepreneur", entrepreneur.name],
      ["Business / unit name", entrepreneur.business],
      ["Address", entrepreneur.address],
      ["Mobile", entrepreneur.mobile],
      ["Email", entrepreneur.email],
      [],
      ["Total project cost", calc.totalProjectCost],
      ["Own contribution", calc.ownContribution],
      ["Term loan", calc.termLoan],
      ["Working capital loan", calc.wcLoan],
      ["Interest rate (%)", finance.interestRate],
      ["Repayment tenure (years)", finance.tenureYears],
      ["Average DSCR", calc.avgDscr.toFixed(2)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(topSheet), "Top Sheet");

    const costSheet = [
      ["COST OF PROJECT"],
      [],
      ["Land", capex.land],
      ["Workshed", capex.workshed],
      ["Machinery", calc.machineryTotal],
      ["Furniture & fixtures", capex.furniture],
      ["Fixed capital", calc.fixedCapital],
      ["Preliminary & pre-operative cost", capex.preliminary],
      ["Contingency", capex.contingency],
      ["Total capital expenditure", calc.totalCapEx],
      ["Working capital", calc.workingCapital],
      ["Total project cost", calc.totalProjectCost],
      [],
      ["Machinery detail"],
      ["Item", "Qty", "Rate", "Amount"],
      ...machinery.map((m) => [m.name, Number(m.qty), Number(m.rate), Number(m.qty) * Number(m.rate)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(costSheet), "Cost of Project");

    const plHeader = ["Particulars", ...YEARS.map((y) => `Year ${y}`)];
    const plSheet = [
      ["PROJECTED PROFIT & LOSS ACCOUNT"],
      [],
      plHeader,
      ["Capacity utilization %", ...calc.years.map((y) => y.capacity)],
      ["Sales", ...calc.years.map((y) => Math.round(y.sales))],
      ["Raw materials", ...calc.years.map((y) => Math.round(y.rawMaterial))],
      ["Wages", ...calc.years.map((y) => Math.round(y.wages))],
      ["Repairs & maintenance", ...calc.years.map((y) => Math.round(y.repairs))],
      ["Power & fuel", ...calc.years.map((y) => Math.round(y.power))],
      ["Other overheads", ...calc.years.map((y) => Math.round(y.otherOverhead))],
      ["Depreciation", ...calc.years.map((y) => Math.round(y.dep))],
      ["Production cost", ...calc.years.map((y) => Math.round(y.productionCost))],
      ["Administrative cost", ...calc.years.map((y) => Math.round(y.adminCost))],
      ["Interest - term loan", ...calc.years.map((y) => Math.round(y.termInterest))],
      ["Interest - working capital", ...calc.years.map((y) => Math.round(y.wcInterest))],
      ["Cost of sale", ...calc.years.map((y) => Math.round(y.costOfSale))],
      ["Net profit", ...calc.years.map((y) => Math.round(y.netProfit))],
      [],
      ["DSCR", ...calc.years.map((y) => y.dscr.toFixed(2))],
      ["Average DSCR", calc.avgDscr.toFixed(2)],
      [],
      ["Break-even point %", ...calc.years.map((y) => y.bepPct.toFixed(1))],
      ["Break-even sales", ...calc.years.map((y) => Math.round(y.bepSales))],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plSheet), "P&L and DSCR");

    const loanSheet = [
      ["TERM LOAN REPAYMENT SCHEDULE"],
      ["Year", "Opening balance", "Installment", "Interest", "Closing balance"],
      ...calc.termSchedule.map((r, i) => [i + 1, Math.round(r.opening), Math.round(r.installment), Math.round(r.interest), Math.round(r.closing)]),
      [],
      ["WORKING CAPITAL LOAN REPAYMENT SCHEDULE"],
      ["Year", "Opening balance", "Installment", "Interest", "Closing balance"],
      ...calc.wcSchedule.map((r, i) => [i + 1, Math.round(r.opening), Math.round(r.installment), Math.round(r.interest), Math.round(r.closing)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(loanSheet), "Loan Schedules");

    XLSX.writeFile(wb, `${(entrepreneur.business || "project-report").replace(/\s+/g, "-")}.xlsx`);
  };

  const introText = narrative.introduction || defaultIntro(entrepreneur.business, products);
  const aboutText = narrative.aboutPromoter || defaultAbout(entrepreneur.name, entrepreneur.business);

  const downloadPdf = () => {
    window.print();
  };

  const inputCls =
    "w-full bg-white border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1";
  const inputStyle = { borderColor: LINE };

  return (
    <div style={{ background: PAPER, color: TEXT, fontFamily: "ui-sans-serif, system-ui" }} className="w-full min-h-full">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .print-page { page-break-after: always; padding: 28px 34px; font-family: Georgia, 'Times New Roman', serif; color: #111; }
          .print-page:last-child { page-break-after: auto; }
          .print-table { width: 100%; border-collapse: collapse; font-size: 12px; }
          .print-table th, .print-table td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
          .print-table th { background: #f0efe8; }
        }
        .print-only { display: none; }
      `}</style>
      {/* header */}
      <div style={{ background: INK }} className="px-6 py-5 no-print">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <img src="/oshin-logo.png" alt="Oshin Capital" style={{ height: 34, marginBottom: 8 }} />
            <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-white text-2xl">
              Project report generator
            </h1>
          </div>
          <div className="flex gap-2">
            {access !== "locked" && (
              <>
                <button
                  onClick={downloadPdf}
                  className="flex items-center gap-2 px-4 py-2 rounded text-sm font-medium border"
                  style={{ borderColor: "rgba(255,255,255,0.3)", color: "#fff" }}
                >
                  <FileText size={16} /> Download report (PDF)
                </button>
                <button
                  onClick={downloadExcel}
                  className="flex items-center gap-2 px-4 py-2 rounded text-sm font-medium"
                  style={{ background: GOLD, color: INK }}
                >
                  <Download size={16} /> Download report (.xlsx)
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-2 rounded text-xs font-medium border"
                  style={{ borderColor: "rgba(255,255,255,0.3)", color: "rgba(255,255,255,0.75)" }}
                  title="Lock this browser again (clears saved access)"
                >
                  Log out
                </button>
              </>
            )}
          </div>
        </div>

        {/* live sanction strip */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3 no-print">
          {[
            ["Total project cost", `₹ ${fmt(calc.totalProjectCost)}`],
            ["Term loan", `₹ ${fmt(calc.termLoan)}`],
            ["Working capital loan", `₹ ${fmt(calc.wcLoan)}`],
            ["Own contribution", `₹ ${fmt(calc.ownContribution)}`],
            ["Average DSCR", calc.avgDscr.toFixed(2)],
          ].map(([label, val], i) => (
            <div key={i} style={{ background: INK_2, borderColor: "rgba(255,255,255,0.08)" }} className="rounded border px-3 py-2.5">
              <div style={{ color: "rgba(255,255,255,0.55)" }} className="text-[11px] uppercase tracking-wide mb-1">
                {label}
              </div>
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} className="text-white text-base">
                {val}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* tabs */}
      {checkingLink ? (
        <div className="px-6 py-24 text-center text-sm" style={{ color: MUTED }}>Checking access…</div>
      ) : access === "locked" ? (
        <PayGate onUnlock={handleUnlock} />
      ) : (
      <>
      <div style={{ borderBottom: `1px solid ${LINE}`, background: "#fff" }} className="px-6 flex gap-1 no-print">
        {[
          ["inputs", "Project inputs", ClipboardList],
          ["report", "Generated report", FileText],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-2 px-4 py-3 text-sm border-b-2 -mb-px"
            style={{
              borderColor: tab === key ? GOLD : "transparent",
              color: tab === key ? INK : MUTED,
              fontWeight: tab === key ? 500 : 400,
            }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="p-6 no-print">
        {tab === "inputs" ? (
          <div className="space-y-6 max-w-5xl">
            {/* entrepreneur */}
            <Section icon={Building2} title="Entrepreneur & unit details">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Name of entrepreneur">
                  <input className={inputCls} style={inputStyle} value={entrepreneur.name} onChange={(e) => setEntrepreneur({ ...entrepreneur, name: e.target.value })} />
                </Field>
                <Field label="Business / unit name">
                  <input className={inputCls} style={inputStyle} value={entrepreneur.business} onChange={(e) => setEntrepreneur({ ...entrepreneur, business: e.target.value })} />
                </Field>
                <Field label="Address">
                  <input className={inputCls} style={inputStyle} value={entrepreneur.address} onChange={(e) => setEntrepreneur({ ...entrepreneur, address: e.target.value })} />
                </Field>
                <Field label="Mobile">
                  <input className={inputCls} style={inputStyle} value={entrepreneur.mobile} onChange={(e) => setEntrepreneur({ ...entrepreneur, mobile: e.target.value })} />
                </Field>
              </div>
            </Section>

            {/* cost of project */}
            <Section icon={Landmark} title="Cost of project">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <Field label="Land (₹)"><NumInput value={capex.land} onChange={(v) => setCapex({ ...capex, land: v })} /></Field>
                <Field label="Workshed (₹)"><NumInput value={capex.workshed} onChange={(v) => setCapex({ ...capex, workshed: v })} /></Field>
                <Field label="Furniture & fixtures (₹)"><NumInput value={capex.furniture} onChange={(v) => setCapex({ ...capex, furniture: v })} /></Field>
                <Field label="Preliminary & pre-operative (₹)"><NumInput value={capex.preliminary} onChange={(v) => setCapex({ ...capex, preliminary: v })} /></Field>
                <Field label="Contingency (₹)"><NumInput value={capex.contingency} onChange={(v) => setCapex({ ...capex, contingency: v })} /></Field>
              </div>

              <LineItemTable
                title="Machinery"
                rows={machinery}
                columns={[
                  { key: "name", label: "Item", type: "text" },
                  { key: "qty", label: "Qty", type: "number" },
                  { key: "rate", label: "Rate (₹)", type: "number" },
                ]}
                amount={(r) => (Number(r.qty) || 0) * (Number(r.rate) || 0)}
                onChange={(id, f, v) => updateLine(setMachinery, id, f, v)}
                onAdd={() => addLine(setMachinery, { qty: 0, rate: 0 })}
                onRemove={(id) => removeLine(setMachinery, id)}
              />
              <div className="text-sm mt-2" style={{ color: MUTED }}>
                Fixed capital: <b style={{ color: TEXT }}>₹ {fmt(calc.fixedCapital)}</b> &nbsp;·&nbsp; Total capital expenditure: <b style={{ color: TEXT }}>₹ {fmt(calc.totalCapEx)}</b>
              </div>
            </Section>

            {/* means of finance */}
            <Section icon={ShieldCheck} title="Means of finance & loan terms">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Own contribution (%)"><NumInput value={finance.ownPct} onChange={(v) => setFinance({ ...finance, ownPct: v })} /></Field>
                <Field label="Interest rate (% p.a.)"><NumInput value={finance.interestRate} onChange={(v) => setFinance({ ...finance, interestRate: v })} /></Field>
                <Field label="Repayment tenure (years)"><NumInput value={finance.tenureYears} onChange={(v) => setFinance({ ...finance, tenureYears: v })} /></Field>
                <Field label="Depreciation rate (% WDV)"><NumInput value={depRate} onChange={setDepRate} /></Field>
              </div>
            </Section>

            {/* products & sales */}
            <Section icon={TrendingUp} title="Products, sales & capacity utilization">
              <LineItemTable
                title="Products / services (at 100% capacity)"
                rows={products}
                columns={[
                  { key: "name", label: "Product", type: "text" },
                  { key: "qty", label: "Qty / year", type: "number" },
                  { key: "rate", label: "Rate (₹)", type: "number" },
                ]}
                amount={(r) => (Number(r.qty) || 0) * (Number(r.rate) || 0)}
                onChange={(id, f, v) => updateLine(setProducts, id, f, v)}
                onAdd={() => addLine(setProducts, { qty: 0, rate: 0 })}
                onRemove={(id) => removeLine(setProducts, id)}
              />
              <div className="text-sm mt-2 mb-4" style={{ color: MUTED }}>
                Annual sales at 100% capacity: <b style={{ color: TEXT }}>₹ {fmt(calc.salesAt100)}</b>
              </div>

              <div className="text-xs uppercase tracking-wide mb-2" style={{ color: MUTED }}>Capacity utilization by year</div>
              <div className="grid grid-cols-5 gap-3">
                {capacityUtil.map((c, i) => (
                  <Field key={i} label={`Year ${i + 1} (%)`}>
                    <NumInput value={c} onChange={(v) => setCapacityUtil((arr) => arr.map((x, idx) => (idx === i ? v : x)))} />
                  </Field>
                ))}
              </div>
            </Section>

            {/* raw materials & wages */}
            <Section icon={ClipboardList} title="Raw materials, wages & operating expenses">
              <LineItemTable
                title="Raw materials (at 100% capacity)"
                rows={rawMaterials}
                columns={[
                  { key: "name", label: "Material", type: "text" },
                  { key: "qty", label: "Qty / year", type: "number" },
                  { key: "rate", label: "Rate (₹)", type: "number" },
                ]}
                amount={(r) => (Number(r.qty) || 0) * (Number(r.rate) || 0)}
                onChange={(id, f, v) => updateLine(setRawMaterials, id, f, v)}
                onAdd={() => addLine(setRawMaterials, { qty: 0, rate: 0 })}
                onRemove={(id) => removeLine(setRawMaterials, id)}
              />

              <div className="mt-4">
                <LineItemTable
                  title="Wages (at 100% capacity)"
                  rows={wages}
                  columns={[
                    { key: "name", label: "Role", type: "text" },
                    { key: "workers", label: "Workers", type: "number" },
                    { key: "perMonth", label: "Wage / month (₹)", type: "number" },
                  ]}
                  amount={(r) => (Number(r.workers) || 0) * (Number(r.perMonth) || 0) * 12}
                  onChange={(id, f, v) => updateLine(setWages, id, f, v)}
                  onAdd={() => addLine(setWages, { workers: 0, perMonth: 0 })}
                  onRemove={(id) => removeLine(setWages, id)}
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                <Field label="Repairs & maintenance (₹/yr)"><NumInput value={opex.repairs} onChange={(v) => setOpex({ ...opex, repairs: v })} /></Field>
                <Field label="Power & fuel (₹/yr)"><NumInput value={opex.power} onChange={(v) => setOpex({ ...opex, power: v })} /></Field>
                <Field label="Other overheads (₹/yr)"><NumInput value={opex.otherOverhead} onChange={(v) => setOpex({ ...opex, otherOverhead: v })} /></Field>
              </div>

              <div className="text-xs uppercase tracking-wide mt-5 mb-2" style={{ color: MUTED }}>Administrative expenses (₹/yr, at 100% capacity)</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Salary"><NumInput value={admin.salary} onChange={(v) => setAdmin({ ...admin, salary: v })} /></Field>
                <Field label="Telephone"><NumInput value={admin.telephone} onChange={(v) => setAdmin({ ...admin, telephone: v })} /></Field>
                <Field label="Stationery & postage"><NumInput value={admin.stationery} onChange={(v) => setAdmin({ ...admin, stationery: v })} /></Field>
                <Field label="Advertisement"><NumInput value={admin.advertisement} onChange={(v) => setAdmin({ ...admin, advertisement: v })} /></Field>
                <Field label="Workshed rent"><NumInput value={admin.workshedRent} onChange={(v) => setAdmin({ ...admin, workshedRent: v })} /></Field>
                <Field label="Other misc."><NumInput value={admin.misc} onChange={(v) => setAdmin({ ...admin, misc: v })} /></Field>
              </div>
            </Section>

            <Section icon={FileText} title="Report narrative & top-sheet details">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Field label="Employment generated"><NumInput value={details.employment} onChange={(v) => setDetails({ ...details, employment: v })} /></Field>
                <Field label="Power requirement"><input className={inputCls} style={inputStyle} value={details.powerRequirement} onChange={(e) => setDetails({ ...details, powerRequirement: e.target.value })} /></Field>
                <Field label="Implementation period (months)"><NumInput value={details.implementationMonths} onChange={(v) => setDetails({ ...details, implementationMonths: v })} /></Field>
                <Field label="Pay back period (years)"><NumInput value={details.payBackYears} onChange={(v) => setDetails({ ...details, payBackYears: v })} /></Field>
                <Field label="Place"><input className={inputCls} style={inputStyle} value={details.place} onChange={(e) => setDetails({ ...details, place: e.target.value })} /></Field>
                <Field label="Report date"><input type="date" className={inputCls} style={inputStyle} value={details.date} onChange={(e) => setDetails({ ...details, date: e.target.value })} /></Field>
              </div>
              <Field label="Introduction (leave blank to use auto-drafted text)">
                <textarea rows={4} className={inputCls} style={inputStyle} placeholder={defaultIntro(entrepreneur.business, products)} value={narrative.introduction} onChange={(e) => setNarrative({ ...narrative, introduction: e.target.value })} />
              </Field>
              <div className="h-3" />
              <Field label="About the promoter (leave blank to use auto-drafted text)">
                <textarea rows={4} className={inputCls} style={inputStyle} placeholder={defaultAbout(entrepreneur.name, entrepreneur.business)} value={narrative.aboutPromoter} onChange={(e) => setNarrative({ ...narrative, aboutPromoter: e.target.value })} />
              </Field>
            </Section>
          </div>
        ) : (
          <Report entrepreneur={entrepreneur} calc={calc} finance={finance} capex={capex} machinery={machinery} depRate={depRate} />
        )}
      </div>

      <PrintableReport
        entrepreneur={entrepreneur}
        calc={calc}
        finance={finance}
        capex={capex}
        machinery={machinery}
        products={products}
        rawMaterials={rawMaterials}
        wages={wages}
        opex={opex}
        admin={admin}
        depRate={depRate}
        details={details}
        introText={introText}
        aboutText={aboutText}
      />
      </>
      )}
    </div>
  );
}

function PayGate({ onUnlock }) {
  const [mode, setMode] = useState("choose"); // "choose" | "qr" | "admin"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [utr, setUtr] = useState("");
  const [contact, setContact] = useState("");
  const [upiSubmitted, setUpiSubmitted] = useState(false);

  const [adminCode, setAdminCode] = useState("");
  const [adminToken, setAdminToken] = useState(null);
  const [approveUtr, setApproveUtr] = useState("");
  const [approveContact, setApproveContact] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);

  const [payDetails, setPayDetails] = useState(null); // { upiId, amount, qrDataUrl }

  // ---- Razorpay: opens in this same window, verifies server-side via
  // signature, and unlocks the software immediately on success — no link
  // to share, no manual approval. This is the only fully automatic path;
  // it costs Razorpay's standard ~2% per transaction. ----
  const payWithRazorpay = async () => {
    setBusy(true);
    setError("");
    try {
      const orderRes = await fetch("/api/create-razorpay-order", { method: "POST" });
      if (!orderRes.ok) throw new Error("Could not start payment. Please try again.");
      const order = await orderRes.json();

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.id,
        name: "Oshin Capital",
        description: "Project report generation fee",
        handler: async (response) => {
          setBusy(true);
          try {
            const verifyRes = await fetch("/api/verify-razorpay-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const verify = await verifyRes.json();
            if (verify.ok) onUnlock("paid", verify.accessToken);
            else setError("Payment could not be verified. Contact support if you were charged.");
          } catch {
            setError("Payment verification failed. Contact support if you were charged.");
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
        theme: { color: "#AD8A34" },
      });
      rzp.on("payment.failed", () => { setError("Payment failed. Please try again."); setBusy(false); });
      rzp.open();
    } catch (e) {
      setError(e.message || "Something went wrong.");
      setBusy(false);
    }
  };

  // ---- QR: UPI ID + amount come from server env vars, so only whoever has
  // Vercel dashboard access (the super admin) can change where money goes
  // or how much is charged. The QR image is generated client-side from a
  // standard UPI deep link — no gateway, no per-transaction fee, but
  // requires the admin to manually approve (see admin panel). ----
  const openQr = async () => {
    setMode("qr");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/get-payment-details");
      if (!res.ok) throw new Error("Could not load payment details.");
      const { upiId, amount, payeeName } = await res.json();

      const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
        payeeName || "Oshin Capital"
      )}&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent("Project report fee")}`;

      const QRCode = (await import("qrcode")).default;
      const qrDataUrl = await QRCode.toDataURL(upiUrl, { width: 260, margin: 1 });

      setPayDetails({ upiId, amount, qrDataUrl });
    } catch (e) {
      setError(e.message || "Could not load QR code. Please try again.");
      setMode("choose");
    } finally {
      setBusy(false);
    }
  };

  // ---- No automated verification (free path) — submit a claim, admin confirms manually ----
  const submitUpiClaim = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/submit-upi-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utr, contact }),
      });
      if (!res.ok) throw new Error("Could not submit. Please try again.");
      setUpiSubmitted(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Super admin: code is checked server-side, never in this file ----
  const submitAdmin = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/verify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: adminCode }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminToken(data.accessToken);
        setMode("admin-panel");
      } else setError("Incorrect admin code.");
    } catch {
      setError("Could not verify. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // ---- Approve a customer's payment: mints an access link, the customer's
  // browser unlocks itself automatically the moment they open it ----
  const approveClaim = async () => {
    setBusy(true);
    setError("");
    setGeneratedLink("");
    try {
      const res = await fetch("/api/approve-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ contact: approveContact, utr: approveUtr }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error("Could not generate link.");
      const link = `${window.location.origin}${window.location.pathname}?access=${data.accessToken}`;
      setGeneratedLink(link);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-6 py-16 flex justify-center">
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, maxWidth: 460 }} className="w-full p-8 text-center">
        <img src="/oshin-logo.png" alt="Oshin Capital" style={{ height: 32, margin: "0 auto 12px" }} />
        <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-xl mb-3">
          Generate your project report
        </h2>
        <p className="text-sm mb-6" style={{ color: MUTED }}>
          Browsing this tool is free. To enter your project details and generate a bank-ready
          report (Excel + PDF), a report-generation fee applies.
        </p>

        {error && <p className="text-xs mb-4" style={{ color: "#B3261E" }}>{error}</p>}

        {mode === "choose" && (
          <div className="space-y-2">
            <button onClick={payWithRazorpay} disabled={busy} className="w-full py-2.5 rounded text-sm font-medium" style={{ background: GOLD, color: INK }}>
              {busy ? "Opening payment…" : "Pay online — instant access"}
            </button>
            <button onClick={openQr} disabled={busy} className="w-full py-2.5 rounded text-sm font-medium border" style={{ borderColor: LINE, color: TEXT }}>
              {busy ? "Loading…" : "Scan QR to pay (UPI, no gateway fee)"}
            </button>
            <button onClick={() => setMode("admin")} className="w-full pt-3 text-xs underline" style={{ color: MUTED }}>
              Super admin access
            </button>
          </div>
        )}

        {mode === "qr" && !upiSubmitted && (
          <div>
            {busy && !payDetails ? (
              <p className="text-sm py-8" style={{ color: MUTED }}>Loading QR code…</p>
            ) : payDetails ? (
              <>
                <div className="border rounded p-4 mb-3" style={{ borderColor: LINE }}>
                  <img src={payDetails.qrDataUrl} alt="UPI payment QR code" className="mx-auto mb-3" width={220} height={220} />
                  <p style={{ color: MUTED }} className="text-xs mb-1">Pay to UPI ID</p>
                  <p className="font-medium text-sm mb-2">{payDetails.upiId}</p>
                  <p style={{ color: MUTED }} className="text-xs mb-1">Amount</p>
                  <p className="font-medium">₹ {payDetails.amount}</p>
                </div>
                <p className="text-xs mb-3" style={{ color: MUTED }}>
                  Scan with any UPI app (GPay, PhonePe, Paytm, or your bank app), or use the UPI ID directly. After paying, enter the transaction reference below.
                </p>
                <input className="w-full border rounded px-2 py-2 text-sm mb-2" style={{ borderColor: LINE }} placeholder="UTR / transaction reference no." value={utr} onChange={(e) => setUtr(e.target.value)} />
                <input className="w-full border rounded px-2 py-2 text-sm mb-3" style={{ borderColor: LINE }} placeholder="Your email or mobile (for confirmation)" value={contact} onChange={(e) => setContact(e.target.value)} />
                <button onClick={submitUpiClaim} disabled={busy || !utr || !contact} className="w-full py-2.5 rounded text-sm font-medium" style={{ background: GOLD, color: INK }}>
                  {busy ? "Submitting…" : "I've paid — submit for verification"}
                </button>
              </>
            ) : null}
            <button onClick={() => { setMode("choose"); setPayDetails(null); }} className="w-full pt-3 text-xs underline" style={{ color: MUTED }}>Back</button>
          </div>
        )}

        {mode === "qr" && upiSubmitted && (
          <div className="text-sm" style={{ color: MUTED }}>
            <p>Thanks — we've received your reference. Access is unlocked once our team confirms the transfer (usually within a few hours). We'll message you at <b style={{ color: TEXT }}>{contact}</b> with an access link.</p>
          </div>
        )}

        {mode === "admin" && (
          <div>
            <input type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} placeholder="Admin code" className="w-full border rounded px-2 py-2 text-sm mb-2" style={{ borderColor: LINE }} />
            <button onClick={submitAdmin} disabled={busy || !adminCode} className="w-full py-2.5 rounded text-sm font-medium" style={{ background: INK, color: "#fff" }}>
              {busy ? "Checking…" : "Enter"}
            </button>
            <button onClick={() => setMode("choose")} className="w-full pt-3 text-xs underline" style={{ color: MUTED }}>Back</button>
          </div>
        )}

        {mode === "admin-panel" && (
          <div className="text-left">
            <button
              onClick={() => onUnlock("admin", adminToken)}
              className="w-full py-2.5 rounded text-sm font-medium mb-4"
              style={{ background: INK, color: "#fff" }}
            >
              Enter portal as admin
            </button>

            <div style={{ borderTop: `1px solid ${LINE}` }} className="pt-4">
              <p className="text-xs uppercase tracking-wide mb-3 text-center" style={{ color: MUTED }}>Approve a customer's payment</p>
              <input
                className="w-full border rounded px-2 py-2 text-sm mb-2"
                style={{ borderColor: LINE }}
                placeholder="UTR / transaction reference (from your bank app)"
                value={approveUtr}
                onChange={(e) => setApproveUtr(e.target.value)}
              />
              <input
                className="w-full border rounded px-2 py-2 text-sm mb-3"
                style={{ borderColor: LINE }}
                placeholder="Customer's email or mobile"
                value={approveContact}
                onChange={(e) => setApproveContact(e.target.value)}
              />
              <button
                onClick={approveClaim}
                disabled={busy || !approveContact}
                className="w-full py-2.5 rounded text-sm font-medium"
                style={{ background: GOLD, color: INK }}
              >
                {busy ? "Generating…" : "Generate access link"}
              </button>

              {generatedLink && (
                <div className="mt-3 p-3 rounded text-xs break-all" style={{ background: GOLD_L, border: `1px solid ${LINE}` }}>
                  <p className="mb-2" style={{ color: MUTED }}>Send this link to the customer — opening it unlocks the report generator automatically, valid for 7 days:</p>
                  <p className="font-mono mb-2">{generatedLink}</p>
                  <button onClick={copyLink} className="text-xs underline" style={{ color: INK }}>
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                </div>
              )}
            </div>

            <button onClick={() => { setMode("choose"); setGeneratedLink(""); setAdminToken(null); }} className="w-full pt-4 text-xs underline text-center" style={{ color: MUTED }}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10 }} className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={16} style={{ color: GREEN }} />
        <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-[15px]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      className="w-full bg-white border rounded px-2 py-1.5 text-sm focus:outline-none"
      style={{ borderColor: LINE, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
    />
  );
}

function LineItemTable({ title, rows, columns, amount, onChange, onAdd, onRemove }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide" style={{ color: MUTED }}>{title}</div>
        <button onClick={onAdd} className="flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ color: GREEN, border: `1px solid ${LINE}` }}>
          <Plus size={13} /> Add row
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ borderBottom: `1px solid ${LINE}`, color: MUTED }} className="text-left font-normal py-1.5 px-1 text-xs uppercase">
                  {c.label}
                </th>
              ))}
              <th style={{ borderBottom: `1px solid ${LINE}`, color: MUTED }} className="text-right font-normal py-1.5 px-1 text-xs uppercase">Amount</th>
              <th style={{ borderBottom: `1px solid ${LINE}` }} className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((c) => (
                  <td key={c.key} className="py-1 px-1">
                    {c.type === "number" ? (
                      <NumInput value={r[c.key]} onChange={(v) => onChange(r.id, c.key, v)} />
                    ) : (
                      <input
                        className="w-full bg-white border rounded px-2 py-1.5 text-sm focus:outline-none"
                        style={{ borderColor: LINE }}
                        value={r[c.key]}
                        onChange={(e) => onChange(r.id, c.key, e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td className="text-right px-2 text-sm" style={{ fontFamily: "ui-monospace, monospace" }}>
                  {fmt(amount(r))}
                </td>
                <td>
                  <button onClick={() => onRemove(r.id)} aria-label="Remove row">
                    <Trash2 size={14} style={{ color: MUTED }} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportTable({ title, rows }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10 }} className="p-5 mb-5">
      <h3 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-[15px] mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: `1px solid ${LINE}`, color: MUTED }} className="text-left font-normal py-1.5 text-xs uppercase">Particulars</th>
              {YEARS.map((y) => (
                <th key={y} style={{ borderBottom: `1px solid ${LINE}`, color: MUTED }} className="text-right font-normal py-1.5 text-xs uppercase px-2">
                  Year {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="py-1.5" style={{ fontWeight: row.bold ? 500 : 400, color: row.bold ? TEXT : MUTED }}>{row.label}</td>
                {row.values.map((v, j) => (
                  <td key={j} className="py-1.5 text-right px-2" style={{ fontFamily: "ui-monospace, monospace", fontWeight: row.bold ? 500 : 400 }}>
                    {row.isPct ? pct(v) : fmt(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PrintableReport({ entrepreneur, calc, finance, capex, machinery, products, rawMaterials, wages, opex, admin, depRate, details, introText, aboutText }) {
  const y = calc.years;
  const rmList = rawMaterials.map((r) => r.name).filter(Boolean).join(", ");

  return (
    <div className="print-only">
      {/* PAGE 1 — COVER PAGE: LETTERHEAD + INTRODUCTION + PROMOTER */}
      <div className="print-page" style={{ padding: 0 }}>
        <div style={{ background: "#152238", padding: "28px 34px", color: "#fff" }}>
          <img src="/oshin-logo.png" alt="Oshin Capital" style={{ height: 30, marginBottom: 14, filter: "brightness(0) invert(1)" }} />
          <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#AD8A34", margin: 0 }}>
            Detailed Project Report
          </p>
          <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 24, margin: "6px 0 2px" }}>
            {entrepreneur.business || "Proposed Enterprise"}
          </h1>
          <p style={{ fontSize: 12, color: "#cfd6e4", margin: 0 }}>Prepared for {entrepreneur.name || "the applicant"} &middot; {details.date}</p>
        </div>

        <div style={{ display: "flex", borderBottom: "2px solid #AD8A34" }}>
          {[
            ["Total project cost", `Rs. ${fmt(calc.totalProjectCost)}`],
            ["Term loan sought", `Rs. ${fmt(calc.termLoan)}`],
            ["Avg. DSCR", calc.avgDscr.toFixed(2)],
          ].map(([label, val], i) => (
            <div key={i} style={{ flex: 1, padding: "12px 16px", borderRight: i < 2 ? "1px solid #eee" : "none", background: "#f7f5ef" }}>
              <p style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8574", margin: "0 0 3px" }}>{label}</p>
              <p style={{ fontSize: 15, fontWeight: "bold", margin: 0, color: "#152238" }}>{val}</p>
            </div>
          ))}
        </div>

        <div style={{ padding: "24px 34px" }}>
          <h3 style={{ fontSize: 13, color: "#152238", borderLeft: "3px solid #AD8A34", paddingLeft: 8 }}>1. Introduction</h3>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 20 }}>{introText}</p>
          <h3 style={{ fontSize: 13, color: "#152238", borderLeft: "3px solid #AD8A34", paddingLeft: 8 }}>2. About the promoter</h3>
          <p style={{ fontSize: 12.5, lineHeight: 1.6 }}>{aboutText}</p>
        </div>
      </div>

      {/* PAGE 2 — TOP SHEET */}
      <div className="print-page">
        <h2 style={{ textAlign: "center", textDecoration: "underline", fontSize: 15 }}>Project at a glance — top sheet</h2>
        <table className="print-table" style={{ marginTop: 14 }}>
          <tbody>
            <tr><td style={{ width: 28 }}>1</td><td>Name of the entrepreneur</td><td><b>{entrepreneur.name}</b></td></tr>
            <tr><td>2</td><td>Constitution</td><td>Individual</td></tr>
            <tr><td>3</td><td>Unit address</td><td>{entrepreneur.address}<br />Mobile: {entrepreneur.mobile} &nbsp; Email: {entrepreneur.email}</td></tr>
            <tr><td>4</td><td>Name of the project / business</td><td>{entrepreneur.business}</td></tr>
            <tr><td>5</td><td>Cost of project</td><td>Rs. {fmt(calc.totalProjectCost)}</td></tr>
            <tr>
              <td>6</td><td>Means of finance</td>
              <td>
                Term loan: Rs. {fmt(calc.termLoan)}<br />
                Working capital loan: Rs. {fmt(calc.wcLoan)}<br />
                Own contribution: Rs. {fmt(calc.ownContribution)}
              </td>
            </tr>
            <tr><td>7</td><td>Average debt service coverage ratio</td><td>{calc.avgDscr.toFixed(2)}</td></tr>
            <tr><td>8</td><td>Pay back period</td><td>{details.payBackYears} years</td></tr>
            <tr><td>9</td><td>Project implementation period</td><td>{details.implementationMonths} months</td></tr>
            <tr><td>10</td><td>Break even point (year 1)</td><td>{pct(y[0]?.bepPct || 0)}</td></tr>
            <tr><td>11</td><td>Employment</td><td>{details.employment}</td></tr>
            <tr><td>12</td><td>Power requirement</td><td>{details.powerRequirement}</td></tr>
            <tr><td>13</td><td>Major raw materials</td><td>{rmList}</td></tr>
            <tr><td>14</td><td>Estimated annual sales turnover (100% capacity)</td><td>Rs. {fmt(calc.salesAt100)}</td></tr>
          </tbody>
        </table>
      </div>

      {/* PAGE 3 — COST OF PROJECT + MEANS OF FINANCE */}
      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>3. Cost of project</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <tbody>
            <tr><td>Land</td><td style={{ textAlign: "right" }}>{fmt(capex.land)}</td></tr>
            <tr><td>Workshed</td><td style={{ textAlign: "right" }}>{fmt(capex.workshed)}</td></tr>
            <tr><td>Machinery</td><td style={{ textAlign: "right" }}>{fmt(calc.machineryTotal)}</td></tr>
            <tr><td>Furniture & fixtures</td><td style={{ textAlign: "right" }}>{fmt(capex.furniture)}</td></tr>
            <tr><td>Preliminary & pre-operative cost</td><td style={{ textAlign: "right" }}>{fmt(capex.preliminary)}</td></tr>
            <tr><td>Contingency</td><td style={{ textAlign: "right" }}>{fmt(capex.contingency)}</td></tr>
            <tr><td><b>Total capital expenditure</b></td><td style={{ textAlign: "right" }}><b>{fmt(calc.totalCapEx)}</b></td></tr>
            <tr><td><b>Working capital</b></td><td style={{ textAlign: "right" }}><b>{fmt(calc.workingCapital)}</b></td></tr>
            <tr><td><b>Total project cost</b></td><td style={{ textAlign: "right" }}><b>{fmt(calc.totalProjectCost)}</b></td></tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>3.1 Means of financing</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <tbody>
            <tr><td>Own contribution ({finance.ownPct}%)</td><td style={{ textAlign: "right" }}>{fmt(calc.ownContribution)}</td></tr>
            <tr><td>Term loan</td><td style={{ textAlign: "right" }}>{fmt(calc.termLoan)}</td></tr>
            <tr><td>Working capital loan</td><td style={{ textAlign: "right" }}>{fmt(calc.wcLoan)}</td></tr>
            <tr><td><b>Total</b></td><td style={{ textAlign: "right" }}><b>{fmt(calc.ownContribution + calc.termLoan + calc.wcLoan)}</b></td></tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>3.2 Term loan repayment schedule @ {finance.interestRate}%</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Year</th><th>Opening</th><th>Installment</th><th>Interest</th><th>Closing</th></tr></thead>
          <tbody>
            {calc.termSchedule.map((r, i) => (
              <tr key={i}><td>{i + 1}</td><td style={{ textAlign: "right" }}>{fmt(r.opening)}</td><td style={{ textAlign: "right" }}>{fmt(r.installment)}</td><td style={{ textAlign: "right" }}>{fmt(r.interest)}</td><td style={{ textAlign: "right" }}>{fmt(r.closing)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* PAGE 4 — DEPRECIATION + SALES SCHEDULE */}
      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>3.3 Depreciation schedule (WDV @ {depRate}%)</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{YEARS.map((yr) => <th key={yr}>Year {yr}</th>)}</tr></thead>
          <tbody>
            <tr><td>Opening balance</td>{calc.depSchedule.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.opening)}</td>)}</tr>
            <tr><td>Depreciation</td>{calc.depSchedule.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.dep)}</td>)}</tr>
            <tr><td>Closing balance</td>{calc.depSchedule.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.closing)}</td>)}</tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>4. Schedule of sales realization (100% capacity)</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Product</th><th>Rate</th><th>Qty / year</th><th>Amount</th></tr></thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={i}><td>{p.name}</td><td style={{ textAlign: "right" }}>{fmt(p.rate)}</td><td style={{ textAlign: "right" }}>{fmt(p.qty)}</td><td style={{ textAlign: "right" }}>{fmt((Number(p.qty) || 0) * (Number(p.rate) || 0))}</td></tr>
            ))}
            <tr><td colSpan={3}><b>Total</b></td><td style={{ textAlign: "right" }}><b>{fmt(calc.salesAt100)}</b></td></tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>4.1 Capacity utilization</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{YEARS.map((yr) => <th key={yr}>Year {yr}</th>)}</tr></thead>
          <tbody>
            <tr><td>Capacity utilization</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{pct(r.capacity)}</td>)}</tr>
            <tr><td>Sales / receipts</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.sales)}</td>)}</tr>
          </tbody>
        </table>
      </div>

      {/* PAGE 5 — RAW MATERIALS, WAGES, EXPENSES */}
      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>5. Raw materials (100% capacity)</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Material</th><th>Rate</th><th>Qty / year</th><th>Amount</th></tr></thead>
          <tbody>
            {rawMaterials.map((r, i) => (
              <tr key={i}><td>{r.name}</td><td style={{ textAlign: "right" }}>{fmt(r.rate)}</td><td style={{ textAlign: "right" }}>{fmt(r.qty)}</td><td style={{ textAlign: "right" }}>{fmt((Number(r.qty) || 0) * (Number(r.rate) || 0))}</td></tr>
            ))}
            <tr><td colSpan={3}><b>Total</b></td><td style={{ textAlign: "right" }}><b>{fmt(calc.rawMaterialAt100)}</b></td></tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>5.1 Wages</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Role</th><th>Workers</th><th>Wage / month</th><th>Amount / year</th></tr></thead>
          <tbody>
            {wages.map((w, i) => (
              <tr key={i}><td>{w.name}</td><td style={{ textAlign: "right" }}>{fmt(w.workers)}</td><td style={{ textAlign: "right" }}>{fmt(w.perMonth)}</td><td style={{ textAlign: "right" }}>{fmt((Number(w.workers) || 0) * (Number(w.perMonth) || 0) * 12)}</td></tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>5.2 Other manufacturing expenses (100% capacity)</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <tbody>
            <tr><td>Repairs & maintenance</td><td style={{ textAlign: "right" }}>{fmt(opex.repairs)}</td></tr>
            <tr><td>Power & fuel</td><td style={{ textAlign: "right" }}>{fmt(opex.power)}</td></tr>
            <tr><td>Other overheads</td><td style={{ textAlign: "right" }}>{fmt(opex.otherOverhead)}</td></tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>6. Administrative expenses (100% capacity)</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <tbody>
            <tr><td>Salary</td><td style={{ textAlign: "right" }}>{fmt(admin.salary)}</td></tr>
            <tr><td>Telephone</td><td style={{ textAlign: "right" }}>{fmt(admin.telephone)}</td></tr>
            <tr><td>Stationery & postage</td><td style={{ textAlign: "right" }}>{fmt(admin.stationery)}</td></tr>
            <tr><td>Advertisement</td><td style={{ textAlign: "right" }}>{fmt(admin.advertisement)}</td></tr>
            <tr><td>Workshed rent</td><td style={{ textAlign: "right" }}>{fmt(admin.workshedRent)}</td></tr>
            <tr><td>Other miscellaneous</td><td style={{ textAlign: "right" }}>{fmt(admin.misc)}</td></tr>
            <tr><td><b>Total</b></td><td style={{ textAlign: "right" }}><b>{fmt(calc.adminCostAt100)}</b></td></tr>
          </tbody>
        </table>
      </div>

      {/* PAGE 6 — WORKING CAPITAL + P&L */}
      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>7. Assessment of working capital</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <tbody>
            <tr><td>Raw material (90 days)</td><td style={{ textAlign: "right" }}>{fmt((calc.rawMaterialAt100 * 90) / 365)}</td></tr>
            <tr><td>Stock in process (30 days on production cost)</td><td style={{ textAlign: "right" }}>{fmt((calc.productionCostAt100 * 30) / 365)}</td></tr>
            <tr><td>Finished goods (30 days on manufacturing cost)</td><td style={{ textAlign: "right" }}>{fmt((calc.manufacturingCostAt100 * 30) / 365)}</td></tr>
            <tr><td>Receivables (30 days on manufacturing cost)</td><td style={{ textAlign: "right" }}>{fmt((calc.manufacturingCostAt100 * 30) / 365)}</td></tr>
            <tr><td><b>Total working capital requirement</b></td><td style={{ textAlign: "right" }}><b>{fmt(calc.workingCapital)}</b></td></tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>8. Projected profit & loss account</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{YEARS.map((yr) => <th key={yr}>Year {yr}</th>)}</tr></thead>
          <tbody>
            <tr><td>Sales / receipts</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.sales)}</td>)}</tr>
            <tr><td>Production cost</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.productionCost)}</td>)}</tr>
            <tr><td>Administrative cost</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.adminCost)}</td>)}</tr>
            <tr><td>Interest (term loan)</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.termInterest)}</td>)}</tr>
            <tr><td>Interest (working capital)</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.wcInterest)}</td>)}</tr>
            <tr><td><b>Cost of sale</b></td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}><b>{fmt(r.costOfSale)}</b></td>)}</tr>
            <tr><td><b>Net profit</b></td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}><b>{fmt(r.netProfit)}</b></td>)}</tr>
          </tbody>
        </table>
      </div>

      {/* PAGE 7 — DSCR + BREAK-EVEN */}
      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>9. Calculation of debt service coverage ratio (DSCR)</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{YEARS.map((yr) => <th key={yr}>Year {yr}</th>)}</tr></thead>
          <tbody>
            <tr><td>Net profit + depreciation</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.netProfit + r.dep)}</td>)}</tr>
            <tr><td>Interest + installment</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.termInterest + r.termInstallment + r.wcInterest + r.wcInstallment)}</td>)}</tr>
            <tr><td><b>DSCR</b></td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}><b>{r.dscr.toFixed(2)}</b></td>)}</tr>
          </tbody>
        </table>
        <p style={{ fontSize: 12.5, marginTop: 6 }}>Average DSCR: <b>{calc.avgDscr.toFixed(2)}</b></p>

        <h3 style={{ fontSize: 13, marginTop: 14 }}>10. Break-even point and ratio analysis</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{YEARS.map((yr) => <th key={yr}>Year {yr}</th>)}</tr></thead>
          <tbody>
            <tr><td>Fixed cost</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.fixedCost)}</td>)}</tr>
            <tr><td>Variable cost</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.variableCost)}</td>)}</tr>
            <tr><td>Break-even point</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{pct(r.bepPct)}</td>)}</tr>
            <tr><td>Break-even sales</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.bepSales)}</td>)}</tr>
          </tbody>
        </table>
      </div>

      {/* PAGE 8 — SIGNATURE */}
      <div className="print-page">
        <p style={{ fontSize: 12.5, marginTop: 40 }}>
          This project report has been prepared based on the data furnished by the entrepreneur whose details are given in the application.
        </p>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 60 }}>
          <div>
            <p style={{ fontSize: 12.5 }}>Place: {details.place}</p>
            <p style={{ fontSize: 12.5 }}>Date: {details.date}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 12.5 }}>Full name:</p>
            <p style={{ fontSize: 13, fontWeight: "bold" }}>{entrepreneur.name}</p>
          </div>
        </div>
        <p style={{ fontSize: 10, color: "#888", marginTop: 80, textAlign: "center" }}>
          Generated free via compliance.oshin-capital.com
        </p>
      </div>
    </div>
  );
}

function Report({ entrepreneur, calc, finance, capex, machinery, depRate }) {
  const y = calc.years;
  return (
    <div className="max-w-5xl">
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10 }} className="p-5 mb-5">
        <h3 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-[15px] mb-3">Project at a glance</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-2 text-sm">
          <div><span style={{ color: MUTED }}>Entrepreneur: </span>{entrepreneur.name}</div>
          <div><span style={{ color: MUTED }}>Unit: </span>{entrepreneur.business}</div>
          <div><span style={{ color: MUTED }}>Total project cost: </span>₹ {fmt(calc.totalProjectCost)}</div>
          <div><span style={{ color: MUTED }}>Own contribution: </span>₹ {fmt(calc.ownContribution)} ({finance.ownPct}%)</div>
          <div><span style={{ color: MUTED }}>Term loan: </span>₹ {fmt(calc.termLoan)}</div>
          <div><span style={{ color: MUTED }}>Working capital loan: </span>₹ {fmt(calc.wcLoan)}</div>
          <div><span style={{ color: MUTED }}>Interest rate: </span>{finance.interestRate}% p.a.</div>
          <div><span style={{ color: MUTED }}>Repayment tenure: </span>{finance.tenureYears} years</div>
          <div><span style={{ color: MUTED }}>Average DSCR: </span>{calc.avgDscr.toFixed(2)}</div>
        </div>
      </div>

      <ReportTable
        title="Projected profit & loss account"
        rows={[
          { label: "Capacity utilization", values: y.map((r) => r.capacity), isPct: true },
          { label: "Sales / receipts", values: y.map((r) => r.sales), bold: true },
          { label: "Raw materials", values: y.map((r) => r.rawMaterial) },
          { label: "Wages", values: y.map((r) => r.wages) },
          { label: "Repairs & maintenance", values: y.map((r) => r.repairs) },
          { label: "Power & fuel", values: y.map((r) => r.power) },
          { label: "Other overheads", values: y.map((r) => r.otherOverhead) },
          { label: "Depreciation", values: y.map((r) => r.dep) },
          { label: "Production cost", values: y.map((r) => r.productionCost), bold: true },
          { label: "Administrative cost", values: y.map((r) => r.adminCost), bold: true },
          { label: "Interest — term loan", values: y.map((r) => r.termInterest) },
          { label: "Interest — working capital", values: y.map((r) => r.wcInterest) },
          { label: "Cost of sale", values: y.map((r) => r.costOfSale), bold: true },
          { label: "Net profit", values: y.map((r) => r.netProfit), bold: true },
        ]}
      />

      <ReportTable
        title="Debt service coverage ratio (DSCR)"
        rows={[{ label: "DSCR", values: y.map((r) => r.dscr), bold: true }]}
      />

      <ReportTable
        title="Break-even analysis"
        rows={[
          { label: "Fixed cost", values: y.map((r) => r.fixedCost) },
          { label: "Variable cost", values: y.map((r) => r.variableCost) },
          { label: "Contribution", values: y.map((r) => r.contribution) },
          { label: "Break-even point", values: y.map((r) => r.bepPct), isPct: true, bold: true },
          { label: "Break-even sales", values: y.map((r) => r.bepSales) },
        ]}
      />

      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10 }} className="p-5">
        <h3 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-[15px] mb-3">Term loan repayment schedule</h3>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Year", "Opening balance", "Installment", "Interest", "Closing balance"].map((h) => (
                <th key={h} style={{ borderBottom: `1px solid ${LINE}`, color: MUTED }} className="text-left font-normal py-1.5 text-xs uppercase px-1">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calc.termSchedule.map((r, i) => (
              <tr key={i}>
                <td className="py-1.5 px-1">{i + 1}</td>
                <td className="py-1.5 px-1" style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(r.opening)}</td>
                <td className="py-1.5 px-1" style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(r.installment)}</td>
                <td className="py-1.5 px-1" style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(r.interest)}</td>
                <td className="py-1.5 px-1" style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(r.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
