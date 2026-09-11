import React, { useState, useMemo, useEffect, useRef } from "react";
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
  const [showPriceList, setShowPriceList] = useState(false);
  // In-app browsers (opened from Gmail/WhatsApp/Instagram/Facebook links
  // instead of a real browser) frequently strip out the native print
  // dialog, so "Download report (PDF)" — which relies on window.print() —
  // can silently do nothing there. Detect it and point people to the real
  // browser instead of leaving them stuck with no explanation.
  const [inAppBrowser, setInAppBrowser] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isInApp = /FBAN|FBAV|Instagram|Line\/|GSA\/|; wv\)|WhatsApp/i.test(ua) || (/\bGmail\b/i.test(ua) && /Android/i.test(ua));
    setInAppBrowser(isInApp);
  }, []);
  const [showGuide, setShowGuide] = useState(() => {
    try {
      return localStorage.getItem("oshinGuideDismissed") !== "1";
    } catch {
      return true;
    }
  });
  const dismissGuide = () => {
    setShowGuide(false);
    try {
      localStorage.setItem("oshinGuideDismissed", "1");
    } catch {}
  };


  // ---------------------------------------------------------------------
  // ACCESS GATE
  // Browsing is free. Filling in data + generating a report is paid,
  // except for a super admin. Enforcement happens in /api (serverless
  // functions), never in this component — this file only reflects
  // whatever the server told it via `accessToken`.
  // ---------------------------------------------------------------------
  const [access, setAccess] = useState("locked"); // "locked" | "paid" | "admin"
  const [accessToken, setAccessToken] = useState(null);
  const [linkError, setLinkError] = useState(null);
  // Which report a "paid" session was actually paid for ("dpr" | "cma" | null).
  // A payment made for one report type must never unlock the other — this is
  // the client-side half of that guarantee; the server enforces it for real
  // in consume-access.js regardless of what this state says.
  const [accessReportType, setAccessReportType] = useState(null);
  const [checkingLink, setCheckingLink] = useState(true);

  // Central place any unlock path (Razorpay, approval link, admin login)
  // goes through — persists to localStorage so a page refresh doesn't force
  // the customer to pay again mid-session.
  const handleUnlock = (mode, token, boundReportType = null) => {
    setAccess(mode);
    setAccessToken(token);
    setAccessReportType(mode === "paid" ? (boundReportType || "dpr") : null);
    try {
      localStorage.setItem("oshinAccess", JSON.stringify({ mode, token, reportType: mode === "paid" ? (boundReportType || "dpr") : null }));
    } catch {
      // localStorage can fail in rare cases (private browsing limits, etc.) —
      // access still works for this page load, just won't survive a refresh.
    }
  };

  const handleLogout = () => {
    setAccess("locked");
    setAccessToken(null);
    setAccessReportType(null);
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
        if (data.ok) {
          const mode = data.mode === "admin" ? "admin" : "paid";
          handleUnlock(mode, tokenToCheck, data.reportType);
          // A paid link is generated for one specific report — jump the UI
          // straight to it, instead of leaving the customer on the wrong
          // tab wondering why the toggle won't let them download.
          if (mode === "paid" && data.reportType) setReportType(data.reportType);
        } else {
          localStorage.removeItem("oshinAccess"); // stale/expired — clear it
          // Only show an explanation if a link was actually clicked (not
          // just a saved-but-expired session from an earlier visit) — that
          // was the exact confusion here: a customer's inbox had two
          // report-ready emails, an older already-used one and a fresh one,
          // and tapping the wrong one silently showed the payment screen
          // with no explanation of why.
          if (linkToken) {
            setLinkError(
              data.reason === "already-used"
                ? "This link has already been used to generate a report. If you have a newer email from us, use that link instead — otherwise contact support for a new one."
                : "This link has expired or isn't valid anymore. If you have a more recent email from us, use that link instead — otherwise contact support for a new one."
            );
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setCheckingLink(false);
        // Clean any token out of the visible URL so it isn't sitting in
        // browser history / accidentally shared further.
        if (linkToken) window.history.replaceState({}, "", window.location.pathname);
      });
  }, []);

  // A "quick approve" link from the admin alert email (?quickApprove=1&...)
  // pre-fills the approval form so nothing needs retyping — it does NOT
  // skip login or the click itself, that check stays in place on purpose.
  const [quickApproveData, setQuickApproveData] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("quickApprove") !== "1") return;

    setQuickApproveData({
      utr: params.get("utr") || "",
      contact: params.get("contact") || "",
      amount: params.get("amount") || "",
      reportType: params.get("reportType") === "cma" ? "cma" : "dpr",
    });
    setPayModalOpen(true);
    // Scrub the claim details out of the visible URL / browser history right
    // away — they've already been captured into state above.
    window.history.replaceState({}, "", window.location.pathname);
  }, []);


  // Top-level: which kind of report is being generated. "dpr" is the
  // proposed-project term-loan report (PMEGP/MUDRA/MSME — same engine,
  // different framing). "cma" is a structurally different assessment —
  // it's for an EXISTING business's working-capital limit, using the
  // Nayak Committee (turnover method) and Tandon Committee (I & II)
  // methodologies banks actually use, not a new project's P&L/DSCR.
  const [reportType, setReportType] = useState("dpr"); // "dpr" | "cma"

  // Which loan scheme this report is for — changes eligibility framing,
  // top-sheet labels, and PDF titles. The underlying financial engine
  // (P&L, DSCR, Balance Sheet, Cash Flow) is identical across all three —
  // these are standard term-loan structures, they just differ in
  // eligibility rules and how a bank expects the report to be framed.
  const [scheme, setScheme] = useState("pmegp"); // "pmegp" | "mudra" | "msme"

  const SCHEME_LABELS = {
    pmegp: { title: "PMEGP Project Report", short: "PMEGP" },
    mudra: { title: "MUDRA Loan Project Report", short: "MUDRA" },
    msme: { title: "MSME Term Loan Project Report", short: "MSME" },
  };

  // MUDRA loans are collateral-free and capped at ₹10 lakh, split into three
  // tiers by loan amount (term loan + working capital loan combined).
  const getMudraCategory = (totalLoan) => {
    if (totalLoan <= 50000) return "Shishu (up to ₹50,000)";
    if (totalLoan <= 500000) return "Kishore (₹50,000 – ₹5,00,000)";
    if (totalLoan <= 1000000) return "Tarun (₹5,00,000 – ₹10,00,000)";
    return "Exceeds MUDRA limit (₹10,00,000)";
  };

  const [entrepreneur, setEntrepreneur] = useState({
    name: "",
    business: "",
    address: "",
    mobile: "",
    email: "",
    pan: "",
    udyamNo: "",
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

  // ======================================================================
  // CMA / WORKING CAPITAL ASSESSMENT — completely separate data model from
  // the DPR engine above. This assesses an EXISTING business across 5
  // periods (typically: actual, provisional, and 3 years projected).
  // ======================================================================
  const [cmaEntrepreneur, setCmaEntrepreneur] = useState({ name: "", business: "", address: "", mobile: "", email: "" });
  const [cmaPeriodLabels, setCmaPeriodLabels] = useState([
    "Actual (last FY)", "Provisional (this FY)", "Projected Yr 1", "Projected Yr 2", "Projected Yr 3",
  ]);
  const emptyCmaPeriod = () => ({
    domesticSales: 0, exportSales: 0, otherIncome: 0,
    purchases: 0, openingStock: 0, closingStock: 0,
    sgaExpenses: 0, interest: 0, depreciation: 0,
    otherNonOpIncome: 0, otherNonOpExpense: 0, taxProvision: 0,
    shortTermBorrowings: 0, sundryCreditors: 0, otherCurrentLiabilities: 0,
    termLoans: 0, otherTermLiabilities: 0,
    shareCapital: 0,
    cashAndBank: 0, receivables: 0, stockInTrade: 0, otherCurrentAssets: 0,
    grossBlock: 0, depreciationToDate: 0,
  });
  const [cmaPeriods, setCmaPeriods] = useState(Array.from({ length: 5 }, emptyCmaPeriod));

  const updateCmaPeriod = (index, field, value) => {
    setCmaPeriods((periods) => periods.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const defaultIntro = (business, prods) => {
    const productNames = prods.map((p) => p.name).filter(Boolean).join(", ");
    return `${business || "The enterprise"} is engaged in delivering high-quality products and reliable, timely service to customers across different market segments. The unit proposes to manufacture and supply ${
      productNames || "the products listed above"
    }, with a strong focus on quality, timely delivery and customer satisfaction. Growing demand in this segment has created substantial opportunity for well-run units that combine quality, durability and competitive pricing, and this project has been drawn up to meet that demand using efficient production methods and skilled workmanship.`;
  };

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

      // Salary is a committed staff cost — paid in full regardless of
      // capacity utilization (you don't send staff home at 70% capacity),
      // and grows with a standard annual increment rather than shrinking
      // with output like variable manufacturing costs do.
      const SALARY_ANNUAL_GROWTH = 1.05;
      const salary = Number(admin.salary) * Math.pow(SALARY_ANNUAL_GROWTH, i);
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

    // --- Balance Sheet ---
    // Reverse-engineered from the original reference document by cross-
    // checking every subtotal until all five years reconciled exactly:
    // - Term/WC Loan liability for year N = that loan's OPENING balance for
    //   year N (i.e. balance at the start of the year, before that year's
    //   repayment) — matches the schedule tables shown elsewhere.
    // - "Profit" is that year's net profit added to net worth, not a
    //   running cumulative total — this matches the reference exactly,
    //   even though it's a simplification of true retained-earnings
    //   accounting.
    // - Preliminary & pre-operative expenses are written off at 25% WDV
    //   per year, shown as a memo line but excluded from the assets total
    //   (matches the reference — likely because a bank doesn't count a
    //   fictitious/non-cash asset toward real net worth).
    // - Current Assets mirrors the working-capital loan's opening balance
    //   for that year (the working capital being financed).
    // - Cash in Bank/Hand is the balancing plug so Total Assets always
    //   equals Total Liabilities.
    const balanceSheet = years.map((y, i) => {
      const promotersCapital = ownContribution;
      const profit = y.netProfit;
      const termLoanLiability = termSchedule[i] ? termSchedule[i].opening : 0;
      const wcLoanLiability = wcSchedule[i] ? wcSchedule[i].opening : 0;
      const totalLiabilities = promotersCapital + profit + termLoanLiability + wcLoanLiability;

      const grossFixedAssets = depSchedule[i] ? depSchedule[i].opening : 0;
      const lessDepreciation = depSchedule[i] ? depSchedule[i].dep : 0;
      const netFixedAssets = depSchedule[i] ? depSchedule[i].closing : 0;
      const preliminaryExpenses = Number(capex.preliminary) * Math.pow(0.75, i);
      const currentAssets = wcLoanLiability;
      const cashInBank = totalLiabilities - netFixedAssets - currentAssets;
      const totalAssets = netFixedAssets + currentAssets + cashInBank;

      return {
        promotersCapital, profit, termLoanLiability, wcLoanLiability, totalLiabilities,
        grossFixedAssets, lessDepreciation, netFixedAssets, preliminaryExpenses, currentAssets, cashInBank, totalAssets,
      };
    });

    // --- Cash Flow Statement ---
    // Same reverse-engineering approach: inflows are net profit + non-cash
    // depreciation added back + that year's opening loan balances + the
    // one-time promoter's capital injection (Year 1 only). Outflows are
    // that year's loan installments plus the working-capital funds tied up
    // (mirrors the Current Assets figure above). Closing balance carries
    // forward as next year's opening balance.
    let cashOpening = 0;
    const cashFlow = years.map((y, i) => {
      const termLoanInflow = termSchedule[i] ? termSchedule[i].opening : 0;
      const wcLoanInflow = wcSchedule[i] ? wcSchedule[i].opening : 0;
      const promotersCapitalInflow = i === 0 ? ownContribution : 0;
      const totalInflow = y.netProfit + y.dep + termLoanInflow + wcLoanInflow + promotersCapitalInflow;

      const termRepayment = termSchedule[i] ? termSchedule[i].installment : 0;
      const wcRepayment = wcSchedule[i] ? wcSchedule[i].installment : 0;
      const currentAssetsUse = wcLoanInflow;
      const totalOutflow = termRepayment + wcRepayment + currentAssetsUse;

      const opening = cashOpening;
      const surplus = totalInflow - totalOutflow;
      const closing = opening + surplus;
      cashOpening = closing;

      return { totalInflow, termRepayment, wcRepayment, currentAssetsUse, totalOutflow, opening, surplus, closing };
    });

    // --- Basic ratios ---
    // Standard definitions (current liabilities = that year's loan
    // installments due; net worth = promoter's capital + that year's
    // profit). These are defensible, conventional formulas — note they may
    // not numerically match older bank templates that used a different,
    // undocumented convention for these two specific rows.
    const ratios = years.map((y, i) => {
      const currentLiabilities = (termSchedule[i]?.installment || 0) + (wcSchedule[i]?.installment || 0);
      const currentRatio = currentLiabilities > 0 ? balanceSheet[i].currentAssets / currentLiabilities : null;
      const totalDebt = balanceSheet[i].termLoanLiability + balanceSheet[i].wcLoanLiability;
      const netWorth = balanceSheet[i].promotersCapital + balanceSheet[i].profit;
      const debtEquityRatio = netWorth > 0 ? totalDebt / netWorth : null; // null = not meaningful (zero/negative net worth)
      return { currentRatio, debtEquityRatio };
    });

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
      balanceSheet,
      cashFlow,
      ratios,
    };
  }, [capex, machinery, finance, products, capacityUtil, rawMaterials, wages, opex, admin, depRate]);

  // ======================================================================
  // CMA calculation engine. Every formula below was verified by hand
  // against the original Suyog Tours & Travels reference document
  // (Nayak Committee turnover method and Tandon Committee I & II) before
  // being written here — see the independent checks run during development.
  // ======================================================================
  const cmaCalc = useMemo(() => {
    let cumulativeSurplus = 0;

    const periods = cmaPeriods.map((p) => {
      // --- Form II: Operating Statement ---
      const totalSales = Number(p.domesticSales) + Number(p.exportSales);
      const totalIncome = totalSales + Number(p.otherIncome);
      const costOfSales = Number(p.purchases) + Number(p.openingStock) - Number(p.closingStock);
      const grossProfit = totalIncome - costOfSales;
      const ebitda = grossProfit - Number(p.sgaExpenses); // operating profit before interest & depreciation
      const operatingProfitAfterID = ebitda - Number(p.interest) - Number(p.depreciation);
      const otherNonOpNet = Number(p.otherNonOpIncome) - Number(p.otherNonOpExpense);
      const pbt = operatingProfitAfterID + otherNonOpNet;
      const netProfit = pbt - Number(p.taxProvision);

      cumulativeSurplus += netProfit;

      // --- Form III: Balance Sheet ---
      const totalCurrentLiabilities = Number(p.shortTermBorrowings) + Number(p.sundryCreditors) + Number(p.otherCurrentLiabilities);
      const totalTermLiabilities = Number(p.termLoans) + Number(p.otherTermLiabilities);
      const totalOutsideLiabilities = totalCurrentLiabilities + totalTermLiabilities;
      const netWorth = Number(p.shareCapital) + cumulativeSurplus; // tangible net worth (assumes no intangibles)
      const totalLiabilitiesBS = totalOutsideLiabilities + netWorth;

      const totalCurrentAssets = Number(p.cashAndBank) + Number(p.receivables) + Number(p.stockInTrade) + Number(p.otherCurrentAssets);
      const netFixedAssets = Number(p.grossBlock) - Number(p.depreciationToDate);
      const totalAssets = totalCurrentAssets + netFixedAssets;

      const netWorkingCapital = totalCurrentAssets - totalCurrentLiabilities;
      const currentRatio = totalCurrentLiabilities > 0 ? totalCurrentAssets / totalCurrentLiabilities : null;
      const quickRatio = totalCurrentLiabilities > 0 ? (totalCurrentAssets - Number(p.stockInTrade)) / totalCurrentLiabilities : null;
      const tolTnwRatio = netWorth > 0 ? totalOutsideLiabilities / netWorth : null;

      // --- Form V: Bank finance for working capital ---
      // Method 1 — Nayak Committee turnover method
      const pct25OfTurnover = totalSales * 0.25;
      const margin5pct = totalSales * 0.05;
      const nayakRow7 = pct25OfTurnover - margin5pct;
      const nayakRow8 = pct25OfTurnover - netWorkingCapital;
      const mpbfNayak = Math.min(nayakRow7, nayakRow8);

      // Method 2 — Tandon Committee, First Method of Lending
      const otherCLexclBank = Number(p.sundryCreditors) + Number(p.otherCurrentLiabilities);
      const workingCapitalGap = totalCurrentAssets - otherCLexclBank;
      const minNwcTandon1 = workingCapitalGap * 0.25;
      const tandon1Row6 = workingCapitalGap - minNwcTandon1;
      const tandon1Row7 = workingCapitalGap - netWorkingCapital;
      const mpbfTandon1 = Math.min(tandon1Row6, tandon1Row7);

      // Method 3 — Tandon Committee, Second Method of Lending
      const minNwcTandon2 = totalCurrentAssets * 0.25;
      const tandon2Row6 = workingCapitalGap - minNwcTandon2;
      const tandon2Row7 = workingCapitalGap - netWorkingCapital;
      const mpbfTandon2 = Math.min(tandon2Row6, tandon2Row7);

      // --- Misc ratios ---
      const grossProfitRatio = totalIncome > 0 ? (grossProfit / totalIncome) * 100 : null;
      const operatingCostRatio = totalIncome > 0 ? ((costOfSales + Number(p.sgaExpenses)) / totalIncome) * 100 : null;
      const operatingProfitRatio = totalIncome > 0 ? (ebitda / totalIncome) * 100 : null;
      const netProfitRatio = totalIncome > 0 ? (netProfit / totalIncome) * 100 : null;
      const interestCoverageRatio = Number(p.interest) > 0 ? ebitda / Number(p.interest) : null;
      const debtEquityRatio = netWorth > 0 ? totalTermLiabilities / netWorth : null;
      const debtAssetsRatio = totalAssets > 0 ? totalOutsideLiabilities / totalAssets : null;
      const capitalTurnoverRatio = netWorth > 0 ? totalIncome / netWorth : null;
      const totalAssetsTurnoverRatio = totalAssets > 0 ? totalIncome / totalAssets : null;
      const returnOnCapitalEmployed = (netWorth + totalTermLiabilities) > 0 ? (ebitda / (netWorth + totalTermLiabilities)) * 100 : null;

      return {
        totalSales, totalIncome, costOfSales, grossProfit, ebitda, operatingProfitAfterID, pbt, netProfit,
        retainedProfit: netProfit, cumulativeSurplus,
        totalCurrentLiabilities, totalTermLiabilities, totalOutsideLiabilities, netWorth, totalLiabilitiesBS,
        totalCurrentAssets, netFixedAssets, totalAssets, netWorkingCapital,
        currentRatio, quickRatio, tolTnwRatio,
        mpbfNayak, mpbfTandon1, mpbfTandon2,
        grossProfitRatio, operatingCostRatio, operatingProfitRatio, netProfitRatio, interestCoverageRatio,
        debtEquityRatio, debtAssetsRatio, capitalTurnoverRatio, totalAssetsTurnoverRatio, returnOnCapitalEmployed,
      };
    });

    return { periods };
  }, [cmaPeriods]);

  // ---------- pay-to-download, with tiered pricing per project size ----------
  // Browsing and filling in the form is free. Payment is required only at
  // the moment of download, and the price is computed from the project
  // cost actually entered — so this needs to happen after the form is
  // filled in, not before. Each successful download consumes that
  // payment (single-use, enforced in consume-access.js); a second report
  // needs a fresh payment.
  const [downloadBlocked, setDownloadBlocked] = useState(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [pendingDownload, setPendingDownload] = useState(null); // "pdf" | "xlsx" | null

  const runDownload = (type) => {
    if (type === "pdf") window.print();
    else if (reportType === "cma") generateCmaExcel();
    else generateExcel();
  };

  const requestDownload = async (type) => {
    setDownloadBlocked(null);

    if (access === "admin") {
      runDownload(type);
      return;
    }

    if (access === "paid" && accessToken) {
      try {
        const res = await fetch("/api/consume-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: accessToken, reportType }),
        });
        const data = await res.json();
        if (data.ok) {
          runDownload(type);
          return;
        }
        setDownloadBlocked(
          data.reason === "already-used"
            ? "Your previous report has already been generated with this payment. Please pay again to generate a new one."
            : data.reason === "wrong-report-type"
            ? `That payment was for the ${data.reportType === "cma" ? "CMA / Working Capital" : "Project Report (DPR)"} report, not this one. Please pay again for this report.`
            : "Your access has expired. Please pay again to generate a new report."
        );
      } catch {
        // network hiccup — fall through to request a fresh payment
      }
    }

    setPendingDownload(type);
    setPayModalOpen(true);
  };

  const downloadPdf = () => requestDownload("pdf");
  const downloadExcel = () => requestDownload("xlsx");


  // ---------- excel export ----------
  const generateExcel = () => {
    const wb = XLSX.utils.book_new();

    const topSheet = [
      ["PROJECT AT A GLANCE"],
      ["Loan scheme", SCHEME_LABELS[scheme].title],
      ...(scheme === "mudra" ? [["MUDRA category", getMudraCategory(calc.termLoan + calc.wcLoan)]] : []),
      [],
      ["Name of entrepreneur", entrepreneur.name],
      ["Business / unit name", entrepreneur.business],
      ["Address", entrepreneur.address],
      ["Mobile", entrepreneur.mobile],
      ["Email", entrepreneur.email],
      ["PAN", entrepreneur.pan],
      ["Udyam Registration No.", entrepreneur.udyamNo],
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

    const bsHeader = ["Particulars", ...YEARS.map((y) => `Year ${y}`)];
    const bsSheet = [
      ["PROJECTED BALANCE SHEET"],
      [],
      bsHeader,
      ["Promoter's capital", ...calc.balanceSheet.map((b) => Math.round(b.promotersCapital))],
      ["Profit", ...calc.balanceSheet.map((b) => Math.round(b.profit))],
      ["Term loan", ...calc.balanceSheet.map((b) => Math.round(b.termLoanLiability))],
      ["Working capital loan", ...calc.balanceSheet.map((b) => Math.round(b.wcLoanLiability))],
      ["Total liabilities", ...calc.balanceSheet.map((b) => Math.round(b.totalLiabilities))],
      [],
      ["Gross fixed assets", ...calc.balanceSheet.map((b) => Math.round(b.grossFixedAssets))],
      ["Less: depreciation", ...calc.balanceSheet.map((b) => Math.round(b.lessDepreciation))],
      ["Net fixed assets", ...calc.balanceSheet.map((b) => Math.round(b.netFixedAssets))],
      ["Preliminary & pre-op. expenses", ...calc.balanceSheet.map((b) => Math.round(b.preliminaryExpenses))],
      ["Current assets", ...calc.balanceSheet.map((b) => Math.round(b.currentAssets))],
      ["Cash in bank/hand", ...calc.balanceSheet.map((b) => Math.round(b.cashInBank))],
      ["Total assets", ...calc.balanceSheet.map((b) => Math.round(b.totalAssets))],
      [],
      ["Current ratio", ...calc.ratios.map((r) => r.currentRatio === null ? "N/A" : r.currentRatio.toFixed(2))],
      ["Debt-equity ratio", ...calc.ratios.map((r) => r.debtEquityRatio === null ? "N/A" : r.debtEquityRatio.toFixed(2))],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bsSheet), "Balance Sheet");

    const cfSheet = [
      ["CASH FLOW STATEMENT"],
      [],
      bsHeader,
      ["Total inflow", ...calc.cashFlow.map((c) => Math.round(c.totalInflow))],
      ["Repayment of term loan", ...calc.cashFlow.map((c) => Math.round(c.termRepayment))],
      ["Repayment of working capital loan", ...calc.cashFlow.map((c) => Math.round(c.wcRepayment))],
      ["Working capital deployed", ...calc.cashFlow.map((c) => Math.round(c.currentAssetsUse))],
      ["Total outflow", ...calc.cashFlow.map((c) => Math.round(c.totalOutflow))],
      ["Opening cash balance", ...calc.cashFlow.map((c) => Math.round(c.opening))],
      ["Surplus for the year", ...calc.cashFlow.map((c) => Math.round(c.surplus))],
      ["Closing cash balance", ...calc.cashFlow.map((c) => Math.round(c.closing))],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cfSheet), "Cash Flow");

    XLSX.writeFile(wb, `${(entrepreneur.business || "project-report").replace(/\s+/g, "-")}.xlsx`);
  };

  const generateCmaExcel = () => {
    const wb = XLSX.utils.book_new();
    const header = ["Particulars", ...cmaPeriodLabels];
    const r2 = (n) => Math.round(n);
    const pctOrNA = (v) => (v === null ? "N/A" : v.toFixed(2));

    const topSheet = [
      ["CMA / WORKING CAPITAL ASSESSMENT"],
      [],
      ["Name of entrepreneur", cmaEntrepreneur.name],
      ["Business / unit name", cmaEntrepreneur.business],
      ["Address", cmaEntrepreneur.address],
      ["Mobile", cmaEntrepreneur.mobile],
      ["Email", cmaEntrepreneur.email],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(topSheet), "Top Sheet");

    const formII = [
      ["FORM II — OPERATING STATEMENT"],
      [],
      header,
      ["Domestic sales", ...cmaPeriods.map((p) => r2(p.domesticSales))],
      ["Export sales", ...cmaPeriods.map((p) => r2(p.exportSales))],
      ["Other income", ...cmaPeriods.map((p) => r2(p.otherIncome))],
      ["Total income", ...cmaCalc.periods.map((p) => r2(p.totalIncome))],
      ["Cost of sales", ...cmaCalc.periods.map((p) => r2(p.costOfSales))],
      ["Gross profit", ...cmaCalc.periods.map((p) => r2(p.grossProfit))],
      ["Selling, general & admin expenses", ...cmaPeriods.map((p) => r2(p.sgaExpenses))],
      ["Operating profit (EBITDA)", ...cmaCalc.periods.map((p) => r2(p.ebitda))],
      ["Interest", ...cmaPeriods.map((p) => r2(p.interest))],
      ["Depreciation", ...cmaPeriods.map((p) => r2(p.depreciation))],
      ["Profit before tax", ...cmaCalc.periods.map((p) => r2(p.pbt))],
      ["Provision for tax", ...cmaPeriods.map((p) => r2(p.taxProvision))],
      ["Net profit", ...cmaCalc.periods.map((p) => r2(p.netProfit))],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formII), "Form II - Operating Stmt");

    const formIII = [
      ["FORM III — ANALYSIS OF BALANCE SHEET"],
      [],
      header,
      ["Short term borrowings from bank", ...cmaPeriods.map((p) => r2(p.shortTermBorrowings))],
      ["Sundry creditors", ...cmaPeriods.map((p) => r2(p.sundryCreditors))],
      ["Other current liabilities", ...cmaPeriods.map((p) => r2(p.otherCurrentLiabilities))],
      ["Total current liabilities", ...cmaCalc.periods.map((p) => r2(p.totalCurrentLiabilities))],
      ["Term loans", ...cmaPeriods.map((p) => r2(p.termLoans))],
      ["Other term liabilities", ...cmaPeriods.map((p) => r2(p.otherTermLiabilities))],
      ["Total term liabilities", ...cmaCalc.periods.map((p) => r2(p.totalTermLiabilities))],
      ["Total outside liabilities", ...cmaCalc.periods.map((p) => r2(p.totalOutsideLiabilities))],
      ["Share capital", ...cmaPeriods.map((p) => r2(p.shareCapital))],
      ["Net worth (incl. retained profit)", ...cmaCalc.periods.map((p) => r2(p.netWorth))],
      ["Total liabilities", ...cmaCalc.periods.map((p) => r2(p.totalLiabilitiesBS))],
      [],
      ["Cash & bank", ...cmaPeriods.map((p) => r2(p.cashAndBank))],
      ["Receivables", ...cmaPeriods.map((p) => r2(p.receivables))],
      ["Stock-in-trade", ...cmaPeriods.map((p) => r2(p.stockInTrade))],
      ["Other current assets", ...cmaPeriods.map((p) => r2(p.otherCurrentAssets))],
      ["Total current assets", ...cmaCalc.periods.map((p) => r2(p.totalCurrentAssets))],
      ["Gross block", ...cmaPeriods.map((p) => r2(p.grossBlock))],
      ["Depreciation to date", ...cmaPeriods.map((p) => r2(p.depreciationToDate))],
      ["Net fixed assets", ...cmaCalc.periods.map((p) => r2(p.netFixedAssets))],
      ["Total assets", ...cmaCalc.periods.map((p) => r2(p.totalAssets))],
      [],
      ["Net working capital", ...cmaCalc.periods.map((p) => r2(p.netWorkingCapital))],
      ["Current ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.currentRatio))],
      ["TOL/TNW ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.tolTnwRatio))],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formIII), "Form III - Balance Sheet");

    const formV = [
      ["FORM V — BANK FINANCE FOR WORKING CAPITAL"],
      [],
      header,
      ["METHOD 1: TURNOVER METHOD (NAYAK COMMITTEE)"],
      ["Projected turnover", ...cmaCalc.periods.map((p) => r2(p.totalSales))],
      ["Total current assets", ...cmaCalc.periods.map((p) => r2(p.totalCurrentAssets))],
      ["Net working capital", ...cmaCalc.periods.map((p) => r2(p.netWorkingCapital))],
      ["MPBF (Turnover method)", ...cmaCalc.periods.map((p) => r2(p.mpbfNayak))],
      [],
      ["METHOD 2: TANDON COMMITTEE — FIRST METHOD OF LENDING"],
      ["MPBF (Tandon I)", ...cmaCalc.periods.map((p) => r2(p.mpbfTandon1))],
      [],
      ["METHOD 3: TANDON COMMITTEE — SECOND METHOD OF LENDING"],
      ["MPBF (Tandon II)", ...cmaCalc.periods.map((p) => r2(p.mpbfTandon2))],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formV), "Form V - MPBF");

    const ratiosSheet = [
      ["MISCELLANEOUS RATIOS"],
      [],
      header,
      ["Gross profit ratio (%)", ...cmaCalc.periods.map((p) => pctOrNA(p.grossProfitRatio))],
      ["Operating cost ratio (%)", ...cmaCalc.periods.map((p) => pctOrNA(p.operatingCostRatio))],
      ["Operating profit ratio (%)", ...cmaCalc.periods.map((p) => pctOrNA(p.operatingProfitRatio))],
      ["Net profit ratio (%)", ...cmaCalc.periods.map((p) => pctOrNA(p.netProfitRatio))],
      ["Interest coverage ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.interestCoverageRatio))],
      ["Current ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.currentRatio))],
      ["Quick ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.quickRatio))],
      ["Debt-equity ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.debtEquityRatio))],
      ["TOL/TNW ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.tolTnwRatio))],
      ["Debt-assets ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.debtAssetsRatio))],
      ["Capital turnover ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.capitalTurnoverRatio))],
      ["Total assets turnover ratio", ...cmaCalc.periods.map((p) => pctOrNA(p.totalAssetsTurnoverRatio))],
      ["Return on capital employed (%)", ...cmaCalc.periods.map((p) => pctOrNA(p.returnOnCapitalEmployed))],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ratiosSheet), "Ratios");

    XLSX.writeFile(wb, `${(cmaEntrepreneur.business || "cma-report").replace(/\s+/g, "-")}-CMA.xlsx`);
  };

  const introText = narrative.introduction || defaultIntro(entrepreneur.business, products);
  const aboutText = narrative.aboutPromoter || defaultAbout(entrepreneur.name, entrepreneur.business);

  // Applies what the chat assistant proposed — only ever called after the
  // customer clicks "Apply" on the review card, never automatically. This
  // is DPR-only for now (the CMA multi-period model is a different shape
  // the assistant doesn't currently propose into).
  const applyFormUpdates = (u) => {
    if (!u) return;
    if (u.entrepreneur) setEntrepreneur((prev) => ({ ...prev, ...u.entrepreneur }));
    if (u.capex) setCapex((prev) => ({ ...prev, ...u.capex }));
    if (u.addMachinery?.length) setMachinery((prev) => [...prev, ...u.addMachinery.map((m) => ({ id: uid(), name: m.name || "", qty: Number(m.qty) || 0, rate: Number(m.rate) || 0 }))]);
    if (u.finance) setFinance((prev) => ({ ...prev, ...u.finance }));
    if (u.addProducts?.length) setProducts((prev) => [...prev, ...u.addProducts.map((p) => ({ id: uid(), name: p.name || "", qty: Number(p.qty) || 0, rate: Number(p.rate) || 0 }))]);
    if (Array.isArray(u.capacityUtil) && u.capacityUtil.length === 5) setCapacityUtil(u.capacityUtil.map((n) => Number(n) || 0));
    if (u.addRawMaterials?.length) setRawMaterials((prev) => [...prev, ...u.addRawMaterials.map((m) => ({ id: uid(), name: m.name || "", qty: Number(m.qty) || 0, rate: Number(m.rate) || 0 }))]);
    if (u.addWages?.length) setWages((prev) => [...prev, ...u.addWages.map((w) => ({ id: uid(), name: w.name || "", workers: Number(w.workers) || 0, perMonth: Number(w.perMonth) || 0 }))]);
    if (u.opex) setOpex((prev) => ({ ...prev, ...u.opex }));
    if (u.admin) setAdmin((prev) => ({ ...prev, ...u.admin }));
    if (u.depRate != null) setDepRate(Number(u.depRate) || 10);
    if (u.details) setDetails((prev) => ({ ...prev, ...u.details }));
    if (u.narrative) setNarrative((prev) => ({ ...prev, ...u.narrative }));
  };

  // A compact snapshot of what's already filled in, sent to the assistant
  // so it doesn't re-ask about fields the customer already answered. Kept
  // to just values (no internal row IDs) to save tokens.
  const chatFormSnapshot =
    reportType === "cma"
      ? { reportType: "cma", entrepreneur: cmaEntrepreneur, note: "CMA form — this assistant can currently explain CMA fields but can only auto-fill the DPR form." }
      : {
          reportType: "dpr",
          scheme,
          entrepreneur,
          capex,
          machinery: machinery.filter((m) => m.name),
          finance,
          products: products.filter((p) => p.name),
          capacityUtil,
          rawMaterials: rawMaterials.filter((m) => m.name),
          wages: wages.filter((w) => w.name),
          opex,
          admin,
          depRate,
          details,
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
              {SCHEME_LABELS[scheme].title}
            </h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowPriceList(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-full text-sm font-bold border"
              style={{ borderColor: "rgba(255,255,255,0.3)", color: "#fff" }}
              title="See our full price list"
            >
              Pricing
            </button>
            <button
              onClick={() => { setTab("inputs"); setShowGuide(true); try { localStorage.removeItem("oshinGuideDismissed"); } catch {} }}
              className="flex items-center gap-2 px-3 py-2 rounded-full text-sm font-bold border"
              style={{ borderColor: "rgba(255,255,255,0.3)", color: "#fff" }}
              title="Show the quick guide again"
            >
              ?
            </button>
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
            {access === "locked" && (
              <button
                onClick={() => { setPendingDownload(null); setPayModalOpen(true); }}
                className="flex items-center gap-2 px-3 py-2 rounded text-xs font-medium border"
                style={{ borderColor: "rgba(255,255,255,0.3)", color: "rgba(255,255,255,0.75)" }}
              >
                Super admin access
              </button>
            )}
            {access !== "locked" && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 rounded text-xs font-medium border"
                style={{ borderColor: "rgba(255,255,255,0.3)", color: "rgba(255,255,255,0.75)" }}
                title="Lock this browser again (clears saved access)"
              >
                Log out
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          {[
            ["dpr", "Project Report (DPR)"],
            ["cma", "CMA / Working Capital"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setReportType(key)}
              className="px-3 py-1.5 rounded text-xs font-bold border"
              style={{
                borderColor: reportType === key ? GOLD : "rgba(255,255,255,0.3)",
                background: reportType === key ? "rgba(173,138,52,0.15)" : "transparent",
                color: reportType === key ? GOLD : "rgba(255,255,255,0.7)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {reportType === "dpr" && (
          <div className="flex gap-2 mt-3">
            {Object.entries(SCHEME_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setScheme(key)}
                className="px-3 py-1.5 rounded-full text-xs font-medium border"
                style={{
                  borderColor: scheme === key ? GOLD : "rgba(255,255,255,0.25)",
                  background: scheme === key ? GOLD : "transparent",
                  color: scheme === key ? INK : "rgba(255,255,255,0.75)",
                }}
              >
                {label.short}
              </button>
            ))}
          </div>
        )}

        {linkError && (
          <div
            className="mt-4 px-4 py-3 rounded text-sm no-print"
            style={{ background: "#4a1f1f", color: "#ffd6d6", border: "1px solid #B3261E" }}
          >
            {linkError}{" "}
            <button onClick={() => setLinkError(null)} className="underline font-medium">
              Dismiss
            </button>
          </div>
        )}

        {inAppBrowser && (
          <div
            className="mt-4 px-4 py-3 rounded text-sm no-print"
            style={{ background: "#4a3a1f", color: "#ffe9c2", border: "1px solid #ad8a34" }}
          >
            You're viewing this inside another app's built-in browser (like Gmail or WhatsApp), which often blocks PDF downloads.
            For the smoothest experience, tap your device's menu (usually ⋮ or a share icon) and choose{" "}
            <b>"Open in Chrome"</b> or <b>"Open in Safari"</b>, then come back to download your report from there.
          </div>
        )}

        {downloadBlocked && (
          <div
            className="mt-4 px-4 py-3 rounded text-sm no-print"
            style={{ background: "#4a1f1f", color: "#ffd6d6", border: "1px solid #B3261E" }}
          >
            {downloadBlocked}{" "}
            <button onClick={() => { setDownloadBlocked(null); setPayModalOpen(true); }} className="underline font-medium">
              Make a new payment
            </button>
          </div>
        )}

        {/* live sanction strip */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3 no-print">
          {(reportType === "dpr"
            ? [
                ["Total project cost", `₹ ${fmt(calc.totalProjectCost)}`],
                ["Term loan", `₹ ${fmt(calc.termLoan)}`],
                ["Working capital loan", `₹ ${fmt(calc.wcLoan)}`],
                ["Own contribution", `₹ ${fmt(calc.ownContribution)}`],
                ["Average DSCR", calc.avgDscr.toFixed(2)],
              ]
            : (() => {
                const latest = cmaCalc.periods[cmaCalc.periods.length - 1];
                return [
                  ["Latest turnover", `₹ ${fmt(latest.totalSales)}`],
                  ["MPBF — Turnover method", `₹ ${fmt(latest.mpbfNayak)}`],
                  ["MPBF — Tandon I", `₹ ${fmt(latest.mpbfTandon1)}`],
                  ["MPBF — Tandon II", `₹ ${fmt(latest.mpbfTandon2)}`],
                  ["Current ratio", latest.currentRatio === null ? "N/A" : latest.currentRatio.toFixed(2)],
                ];
              })()
          ).map(([label, val], i) => (
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

        {reportType === "dpr" && scheme === "mudra" && (
          <div className="mt-3 px-4 py-3 rounded text-sm no-print" style={{
            background: (calc.termLoan + calc.wcLoan) > 1000000 ? "#4a1f1f" : INK_2,
            color: (calc.termLoan + calc.wcLoan) > 1000000 ? "#ffd6d6" : "rgba(255,255,255,0.85)",
            border: `1px solid ${(calc.termLoan + calc.wcLoan) > 1000000 ? "#B3261E" : "rgba(255,255,255,0.15)"}`,
          }}>
            <b>MUDRA category:</b> {getMudraCategory(calc.termLoan + calc.wcLoan)}
            {(calc.termLoan + calc.wcLoan) > 1000000 && (
              <> — this project's loan amount exceeds MUDRA's ₹10,00,000 collateral-free limit. Consider the MSME or PMEGP option instead.</>
            )}
          </div>
        )}
      </div>

      {/* tabs */}
      {checkingLink ? (
        <div className="px-6 py-24 text-center text-sm" style={{ color: MUTED }}>Checking access…</div>
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
        {reportType === "cma" ? (
          <CmaInputsAndReport
            tab={tab}
            cmaEntrepreneur={cmaEntrepreneur}
            setCmaEntrepreneur={setCmaEntrepreneur}
            cmaPeriodLabels={cmaPeriodLabels}
            setCmaPeriodLabels={setCmaPeriodLabels}
            cmaPeriods={cmaPeriods}
            updateCmaPeriod={updateCmaPeriod}
            cmaCalc={cmaCalc}
          />
        ) : tab === "inputs" ? (
          <div className="space-y-6 max-w-5xl">
            {showGuide && (
              <div style={{ background: GOLD_L, border: `1px solid ${LINE}`, borderRadius: 10 }} className="p-5 relative">
                <button
                  onClick={dismissGuide}
                  className="absolute top-3 right-3 text-xs underline"
                  style={{ color: MUTED }}
                >
                  Dismiss
                </button>
                <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-[15px] mb-3">
                  Quick guide — how this works
                </h2>
                <ol className="text-sm space-y-1.5 list-decimal list-inside" style={{ color: TEXT }}>
                  <li>Fill in your name, business, and contact details below.</li>
                  <li>Enter what you're spending on machinery/equipment — add a row for each item.</li>
                  <li>List your products and expected yearly sales at full capacity.</li>
                  <li>Add your raw materials, staff wages, and running expenses (rent, power, etc.).</li>
                  <li>Fill in a few final details — employment, place, and report date.</li>
                  <li>Switch to the <b>Generated report</b> tab above to preview everything.</li>
                  <li>Click <b>Download report</b> to get your PDF or Excel file — bank-ready. The Excel button downloads directly. The PDF button opens your device's print screen — choose <b>"Save as PDF"</b> as the destination/printer, then save. On phone, this is usually under a printer icon or a dropdown in the print preview.</li>
                </ol>
                <p className="text-xs mt-3" style={{ color: MUTED }}>
                  Tip: figures marked "at 100% capacity" mean your maximum yearly output if running at full scale — the tool automatically scales this down for each year using the capacity percentages you set.
                </p>
              </div>
            )}

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
                <Field label="Email">
                  <input type="email" className={inputCls} style={inputStyle} value={entrepreneur.email} onChange={(e) => setEntrepreneur({ ...entrepreneur, email: e.target.value })} />
                </Field>
                <Field label="PAN (optional)">
                  <input className={inputCls} style={inputStyle} value={entrepreneur.pan} onChange={(e) => setEntrepreneur({ ...entrepreneur, pan: e.target.value.toUpperCase() })} placeholder="e.g. HBVPS4301F" />
                </Field>
                <Field label="Udyam Registration No. (optional)">
                  <input className={inputCls} style={inputStyle} value={entrepreneur.udyamNo} onChange={(e) => setEntrepreneur({ ...entrepreneur, udyamNo: e.target.value.toUpperCase() })} placeholder="e.g. UDYAM-MH-20-0352266" />
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

      {reportType === "dpr" && (
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
          scheme={scheme}
          schemeTitle={SCHEME_LABELS[scheme].title}
          mudraCategory={scheme === "mudra" ? getMudraCategory(calc.termLoan + calc.wcLoan) : null}
        />
      )}
      {reportType === "cma" && (
        <CmaPrintableReport
          entrepreneur={cmaEntrepreneur}
          periodLabels={cmaPeriodLabels}
          periods={cmaPeriods}
          calc={cmaCalc}
        />
      )}
      </>

      )}

      {showPriceList && <PriceListModal onClose={() => setShowPriceList(false)} />}

      <ChatWidget reportType={reportType} formSnapshot={chatFormSnapshot} onApplyUpdates={applyFormUpdates} />

      {payModalOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 no-print"
          style={{ background: "rgba(21,34,56,0.6)", zIndex: 50 }}
          onClick={(e) => { if (e.target === e.currentTarget) setPayModalOpen(false); }}
        >
          <div className="w-full max-w-md">
            <PayGate
              reportType={reportType}
              projectCost={reportType === "cma" ? (cmaCalc.periods[cmaCalc.periods.length - 1]?.totalSales || 0) : calc.totalProjectCost}
              customerContact={(reportType === "cma" ? (cmaEntrepreneur.email || cmaEntrepreneur.mobile) : (entrepreneur.email || entrepreneur.mobile)) || ""}
              onClose={() => { setPayModalOpen(false); setPendingDownload(null); }}
              onShowPricing={() => setShowPriceList(true)}
              quickApproveData={quickApproveData}
              onUnlock={(mode, token, boundReportType) => {
                handleUnlock(mode, token, boundReportType);
                setPayModalOpen(false);
                if (pendingDownload) {
                  if (mode === "admin") {
                    runDownload(pendingDownload);
                    setPendingDownload(null);
                  } else {
                    fetch("/api/consume-access", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ token, reportType }),
                    })
                      .then((r) => r.json())
                      .then((data) => {
                        if (data.ok) runDownload(pendingDownload);
                        else setDownloadBlocked("Payment succeeded but the report could not be generated. Please contact support.");
                      })
                      .finally(() => setPendingDownload(null));
                  }
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// The customer-facing help assistant. Talks through what fields mean, can
// search the web for current facts, and can propose form values — but only
// EVER applies them after the customer explicitly clicks "Apply". Nothing
// here silently touches the report.
function ChatWidget({ reportType, formSnapshot, onApplyUpdates }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // [{role, content}]
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingUpdates, setPendingUpdates] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pendingUpdates, busy]);

  const sendMessages = async (msgList) => {
    setBusy(true);
    setError("");
    setPendingUpdates(null);
    // Matches (and stays just under) the server's own 30s limit — if the
    // server is going to time out anyway, no reason to leave the customer
    // staring at "…" for even longer waiting to find that out.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgList, reportType, formSnapshot }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setMessages((m) => [...m, { role: "assistant", content: data.reply || "…" }]);
      if (data.proposedUpdates && Object.keys(data.proposedUpdates).length > 0) {
        setPendingUpdates(data.proposedUpdates);
      }
    } catch (e) {
      setError(e.name === "AbortError" ? "That took too long to respond. Please try again." : e.message);
    } finally {
      clearTimeout(timeoutId);
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    sendMessages(nextMessages);
  };

  // Retries the same conversation as-is — useful for the free-tier
  // rate-limit/overload errors, which are transient and often succeed a
  // few seconds later without needing to retype anything.
  const retry = () => sendMessages(messages);

  const applyUpdates = () => {
    onApplyUpdates(pendingUpdates);
    setPendingUpdates(null);
    setMessages((m) => [...m, { role: "user", content: "(Applied those to the form)" }]);
  };

  // Human-readable one-line summary of what's being proposed, for the
  // review card — not every field, just enough to recognize it at a glance.
  const summarizeUpdates = (u) => {
    const parts = [];
    if (u.entrepreneur) parts.push(`business details`);
    if (u.capex) parts.push(`project cost fields`);
    if (u.addMachinery?.length) parts.push(`${u.addMachinery.length} machinery item(s)`);
    if (u.finance) parts.push(`loan terms`);
    if (u.addProducts?.length) parts.push(`${u.addProducts.length} product(s)`);
    if (u.capacityUtil) parts.push(`capacity utilization`);
    if (u.addRawMaterials?.length) parts.push(`${u.addRawMaterials.length} raw material(s)`);
    if (u.addWages?.length) parts.push(`${u.addWages.length} wage role(s)`);
    if (u.opex) parts.push(`manufacturing expenses`);
    if (u.admin) parts.push(`admin expenses`);
    if (u.depRate != null) parts.push(`depreciation rate`);
    if (u.details) parts.push(`report details`);
    if (u.narrative) parts.push(`report text`);
    return parts.join(", ") || "some fields";
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 rounded-full shadow-lg px-4 py-3 text-sm font-medium no-print"
        style={{ background: GOLD, color: INK, zIndex: 40 }}
      >
        💬 Need help?
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-5 right-5 w-full max-w-sm rounded-lg shadow-2xl flex flex-col no-print"
      style={{ background: "#fff", border: `1px solid ${LINE}`, maxHeight: "70vh", zIndex: 40 }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ background: INK, borderRadius: "8px 8px 0 0" }}>
        <span className="text-sm font-medium text-white">Report assistant</span>
        <button onClick={() => setOpen(false)} className="text-white text-lg" aria-label="Close">×</button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 200 }}>
        {messages.length === 0 && (
          <p className="text-xs" style={{ color: MUTED }}>
            Not sure what to put in a field, or want help figuring out realistic numbers for your business? Ask here —
            I can look things up and suggest values for you to review before anything's filled in.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
            <div
              className="inline-block px-3 py-2 rounded-lg max-w-[85%] text-left"
              style={m.role === "user" ? { background: GOLD_L, color: TEXT } : { background: "#f2f2f2", color: TEXT }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs" style={{ color: MUTED }}>Thinking…</p>}
        {error && (
          <div className="text-xs" style={{ color: "#B3261E" }}>
            <p className="mb-1">{error}</p>
            <button onClick={retry} className="underline font-medium">Retry</button>
          </div>
        )}

        {pendingUpdates && (
          <div className="text-xs p-3 rounded" style={{ background: GOLD_L, border: `1px solid ${LINE}` }}>
            <p className="mb-2">I can fill in: <b>{summarizeUpdates(pendingUpdates)}</b>. Review the form after applying — you can always edit anything.</p>
            <div className="flex gap-3">
              <button onClick={applyUpdates} className="underline font-medium" style={{ color: INK }}>Apply to form</button>
              <button onClick={() => setPendingUpdates(null)} className="underline" style={{ color: MUTED }}>Ignore</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 p-3 border-t" style={{ borderColor: LINE }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about any field…"
          className="flex-1 border rounded px-3 py-2 text-sm"
          style={{ borderColor: LINE }}
        />
        <button onClick={send} disabled={busy || !input.trim()} className="px-3 py-2 rounded text-sm font-medium" style={{ background: INK, color: "#fff" }}>
          Send
        </button>
      </div>
    </div>
  );
}


// Shows the exact same tiers computeFee() uses server-side (fetched fresh
// from /api/pricing?mode=list, not hardcoded here) — so this can never show
// a customer a price different from what they're actually charged, even if
// PRICING_TIERS changes later.
function PriceListModal({ onClose }) {
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/pricing?mode=list")
      .then((r) => r.json())
      .then((data) => setTiers(Array.isArray(data.tiers) ? data.tiers : []))
      .catch(() => setError(true));
  }, []);

  const formatAmt = (rupees) => {
    if (rupees >= 10000000) {
      const cr = rupees / 10000000;
      return `₹${Number.isInteger(cr) ? cr : cr.toFixed(2)} Cr`;
    }
    if (rupees >= 100000) {
      const lac = rupees / 100000;
      return `₹${Number.isInteger(lac) ? lac : lac.toFixed(2)} Lacs`;
    }
    return `₹${rupees.toLocaleString("en-IN")}`;
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50 no-print" style={{ background: "rgba(15,15,20,0.55)" }}>
      <div className="rounded-lg p-6 w-full max-w-lg relative" style={{ background: "#fff" }}>
        <button onClick={onClose} className="absolute top-4 right-4 text-lg" style={{ color: MUTED }} aria-label="Close">
          ×
        </button>
        <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-xl mb-1">
          Price list
        </h2>
        <p className="text-sm mb-4" style={{ color: MUTED }}>
          Same pricing for both the Project Report (DPR) and CMA / Working Capital reports — based on your total project cost (or turnover, for CMA).
          Already paid for one? You'll only pay the difference (or nothing) for the other, using the same email or mobile number.
        </p>

        {error && <p className="text-sm" style={{ color: MUTED }}>Couldn't load pricing right now — please try again in a moment.</p>}
        {!tiers && !error && <p className="text-sm" style={{ color: MUTED }}>Loading…</p>}

        {tiers && tiers.length > 0 && (
          <div className="border rounded overflow-hidden" style={{ borderColor: LINE }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: GOLD_L }}>
                  <th className="text-left py-2 px-3" style={{ color: MUTED }}>S.No.</th>
                  <th className="text-left py-2 px-3" style={{ color: MUTED }}>Project cost range</th>
                  <th className="text-right py-2 px-3" style={{ color: MUTED }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t, i) => (
                  <tr key={t.maxCost} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td className="py-2 px-3" style={{ color: MUTED }}>{i + 1}</td>
                    <td className="py-2 px-3">
                      {i === 0 ? `Up to ${formatAmt(t.maxCost)}` : `${formatAmt(tiers[i - 1].maxCost)} – ${formatAmt(t.maxCost)}`}
                    </td>
                    <td className="py-2 px-3 text-right font-medium">₹{t.fee.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs mt-4" style={{ color: MUTED }}>
          Questions? Email <a href="mailto:support@oshin-capital.com" style={{ color: INK, textDecoration: "underline" }}>support@oshin-capital.com</a> or WhatsApp{" "}
          <a href="https://wa.me/919503945982" target="_blank" rel="noreferrer" style={{ color: INK, textDecoration: "underline" }}>+91 95039 45982</a>.
        </p>
      </div>
    </div>
  );
}

function PayGate({ onUnlock, projectCost = 0, onClose, reportType = "dpr", onShowPricing, quickApproveData = null, customerContact = "" }) {
  const [mode, setMode] = useState(quickApproveData ? "admin" : "choose"); // "choose" | "qr" | "admin"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [utr, setUtr] = useState("");
  const [contact, setContact] = useState("");
  const [upiSubmitted, setUpiSubmitted] = useState(false);

  const [adminCode, setAdminCode] = useState("");
  const [adminToken, setAdminToken] = useState(null);
  const [approveUtr, setApproveUtr] = useState(quickApproveData?.utr || "");
  const [approveContact, setApproveContact] = useState(quickApproveData?.contact || "");
  const [approveAmount, setApproveAmount] = useState(quickApproveData?.amount || "");
  const [approveReportType, setApproveReportType] = useState(quickApproveData?.reportType || "dpr"); // which report this link is good for
  const [generatedLink, setGeneratedLink] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const [payDetails, setPayDetails] = useState(null); // { upiId, amount, qrDataUrl }

  const [stats, setStats] = useState(null); // { configured, count, recent }
  const [statsLoading, setStatsLoading] = useState(false);

  // The fee depends on the project cost entered in the form — fetched from
  // the server (which owns the authoritative pricing tiers) so what's
  // displayed here always matches what actually gets charged.
  const [fee, setFee] = useState(null);
  const [feeLoading, setFeeLoading] = useState(true);
  // If this contact already paid for the OTHER report type recently, the
  // difference gets credited automatically — never charge the same
  // customer full price twice for the two halves of one bank submission.
  const [discount, setDiscount] = useState(null);
  // Whether Razorpay is actually able to take real payments right now
  // (false while your account's website review is pending, or if test
  // keys are still in place) — drives whether "Pay online" is shown at all.
  const [razorpayLive, setRazorpayLive] = useState(true);
  useEffect(() => {
    setFeeLoading(true);
    const params = new URLSearchParams({ mode: "fee", projectCost, reportType, contact: customerContact || "" });
    fetch(`/api/pricing?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setFee(data.fee);
        setDiscount(data.discount || null);
        setRazorpayLive(Boolean(data.razorpayLive));
      })
      .catch(() => setFee(null))
      .finally(() => setFeeLoading(false));
  }, [projectCost, reportType, customerContact]);

  // ---- Razorpay: opens in this same window, verifies server-side via
  // signature, and unlocks the software immediately on success — no link
  // to share, no manual approval. This is the only fully automatic path;
  // it costs Razorpay's standard ~2% per transaction. ----
  const payWithRazorpay = async () => {
    setBusy(true);
    setError("");
    try {
      const orderRes = await fetch("/api/create-razorpay-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectCost, reportType, contact: customerContact || "" }),
      });
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
            if (verify.ok) onUnlock("paid", verify.accessToken, verify.reportType);
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
  // Fee fully covered by a repeat-customer discount — nothing to actually
  // charge, so skip Razorpay/QR entirely and mint access directly. The
  // server recomputes the discount independently; it never trusts fee===0
  // just because the browser says so.
  const claimFreeReport = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/claim-free-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectCost, reportType, contact: customerContact || "" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Could not claim this report.");
      onUnlock("paid", data.accessToken, data.reportType);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openQr = async () => {
    setMode("qr");
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode: "qr", projectCost, reportType, contact: customerContact || "" });
      const res = await fetch(`/api/pricing?${params}`);
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
        body: JSON.stringify({ utr, contact, amount: payDetails?.amount || null, reportType }),
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
        body: JSON.stringify({ code: adminCode.trim() }),
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
    setEmailSent(false);
    try {
      const res = await fetch("/api/approve-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ contact: approveContact, utr: approveUtr, amount: approveAmount || null, reportType: approveReportType }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error("Could not generate link.");
      setGeneratedLink(data.link);
      setEmailSent(Boolean(data.emailSent));
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

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/admin-stats", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = await res.json();
      setStats(data);
    } catch {
      setStats({ configured: false, count: 0, recent: [] });
    } finally {
      setStatsLoading(false);
    }
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, maxWidth: 460, position: "relative" }} className="w-full p-8 text-center mx-auto">
        <img src="/oshin-logo.png" alt="Oshin Capital" style={{ height: 32, margin: "0 auto 12px" }} />
        {onClose && (
          <button onClick={onClose} className="absolute top-4 right-4 text-lg" style={{ color: MUTED }} aria-label="Close">
            ×
          </button>
        )}

        <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-xl mb-3">
          Generate your project report
        </h2>
        <p className="text-sm mb-2" style={{ color: MUTED }}>
          {feeLoading ? (
            "Calculating your fee based on project size…"
          ) : fee !== null ? (
            <>
              Based on your figures, the report-generation fee is <b style={{ color: TEXT }}>₹{fee}</b>.{" "}
              <button onClick={onShowPricing} className="underline" style={{ color: INK }}>
                See full price list
              </button>
            </>
          ) : (
            "A report-generation fee applies, based on your project size."
          )}
        </p>

        {discount && (
          <p className="text-xs mb-6 px-3 py-2 rounded" style={{ background: GOLD_L, color: TEXT }}>
            ✓ You've already paid ₹{discount.otherAmountPaid} for your {discount.otherReportType === "cma" ? "CMA / Working Capital" : "Project Report (DPR)"} —
            we've credited that, saving you ₹{discount.savedAmount} on this report.
          </p>
        )}
        {!discount && <div className="mb-6" />}

        {error && <p className="text-xs mb-4" style={{ color: "#B3261E" }}>{error}</p>}

        {mode === "choose" && (
          <div className="space-y-2">
            {!feeLoading && fee === 0 ? (
              <button onClick={claimFreeReport} disabled={busy} className="w-full py-2.5 rounded text-sm font-medium" style={{ background: GOLD, color: INK }}>
                {busy ? "Unlocking…" : "Get your report — fully covered, ₹0"}
              </button>
            ) : (
              <>
                {razorpayLive ? (
                  <button onClick={payWithRazorpay} disabled={busy || feeLoading} className="w-full py-2.5 rounded text-sm font-medium" style={{ background: GOLD, color: INK }}>
                    {busy ? "Opening payment…" : `Pay online${fee !== null ? ` ₹${fee}` : ""} — instant access`}
                  </button>
                ) : (
                  <p className="text-xs px-1 pb-1" style={{ color: MUTED }}>
                    Instant card/online payment is temporarily unavailable while our payment provider finishes account
                    verification. Please use the QR code below in the meantime — it works right now.
                  </p>
                )}
                <button onClick={openQr} disabled={busy || feeLoading} className="w-full py-2.5 rounded text-sm font-medium border" style={{ borderColor: LINE, color: TEXT }}>
                  {busy ? "Loading…" : "Scan QR to pay (UPI, no gateway fee)"}
                </button>
              </>
            )}
            <button onClick={() => setMode("admin")} className="w-full pt-3 text-xs underline" style={{ color: MUTED }}>
              Super admin access
            </button>
          </div>
        )}

        <div className="mt-6 pt-4 text-xs" style={{ borderTop: `1px solid ${LINE}`, color: MUTED }}>
          Need help? Email{" "}
          <a href="mailto:support@oshin-capital.com" style={{ color: INK, textDecoration: "underline" }}>
            support@oshin-capital.com
          </a>{" "}
          or WhatsApp{" "}
          <a href="https://wa.me/919503945982" target="_blank" rel="noreferrer" style={{ color: INK, textDecoration: "underline" }}>
            +91 95039 45982
          </a>
        </div>

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
              <div className="flex gap-2 mb-2">
                {[["dpr", "Project Report (DPR)"], ["cma", "CMA / Working Capital"]].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setApproveReportType(key)}
                    className="flex-1 py-2 rounded text-xs font-medium border"
                    style={{
                      borderColor: approveReportType === key ? GOLD : LINE,
                      background: approveReportType === key ? GOLD_L : "transparent",
                      color: approveReportType === key ? INK : MUTED,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs mb-2" style={{ color: MUTED }}>
                Pick which report this payment was for — the link only unlocks that one.
              </p>
              <input
                className="w-full border rounded px-2 py-2 text-sm mb-2"
                style={{ borderColor: LINE }}
                placeholder="UTR / transaction reference (from your bank app)"
                value={approveUtr}
                onChange={(e) => setApproveUtr(e.target.value)}
              />
              <input
                className="w-full border rounded px-2 py-2 text-sm mb-2"
                style={{ borderColor: LINE }}
                placeholder="Customer's email or mobile"
                value={approveContact}
                onChange={(e) => setApproveContact(e.target.value)}
              />
              <input
                type="number"
                className="w-full border rounded px-2 py-2 text-sm mb-3"
                style={{ borderColor: LINE }}
                placeholder="Amount received (₹)"
                value={approveAmount}
                onChange={(e) => setApproveAmount(e.target.value)}
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
                  {emailSent ? (
                    <p className="mb-2 font-medium" style={{ color: TEXT }}>
                      ✓ Emailed automatically to {approveContact}. No further action needed unless it doesn't arrive.
                    </p>
                  ) : (
                    <p className="mb-2" style={{ color: MUTED }}>
                      {approveContact.includes("@")
                        ? "Couldn't auto-email this (check RESEND_API_KEY is set) — send it manually below."
                        : "This contact looks like a phone number — WhatsApp it with one click, or copy the link below."}{" "}
                      Opening it unlocks the <b style={{ color: TEXT }}>{approveReportType === "cma" ? "CMA / Working Capital" : "Project Report (DPR)"}</b>{" "}
                      generator automatically. Valid for 24 hours, one report only.
                    </p>
                  )}
                  <p className="font-mono mb-2">{generatedLink}</p>
                  <div className="flex gap-3">
                    <button onClick={copyLink} className="text-xs underline" style={{ color: INK }}>
                      {copied ? "Copied!" : "Copy link"}
                    </button>
                    {!approveContact.includes("@") && (
                      <a
                        href={`https://wa.me/${approveContact.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
                          `Hi! Your payment is confirmed. Click here to generate your report: ${generatedLink}`
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline"
                        style={{ color: INK }}
                      >
                        Send via WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${LINE}` }} className="pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs uppercase tracking-wide" style={{ color: MUTED }}>Activity</p>
                <button onClick={loadStats} disabled={statsLoading} className="text-xs underline" style={{ color: INK }}>
                  {statsLoading ? "Loading…" : stats ? "Refresh" : "Load activity"}
                </button>
              </div>

              {stats && !stats.configured && (
                <p className="text-xs" style={{ color: MUTED }}>
                  Activity tracking isn't set up yet — add a free Upstash Redis database (Vercel → Storage → Create Database) and set <code>UPSTASH_REDIS_REST_URL</code> / <code>UPSTASH_REDIS_REST_TOKEN</code> to start recording transactions.
                </p>
              )}

              {stats && stats.configured && (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="rounded p-3" style={{ background: GOLD_L, border: `1px solid ${LINE}` }}>
                      <p style={{ color: MUTED }} className="text-xs">Reports generated</p>
                      <p className="text-2xl font-bold" style={{ color: INK }}>{stats.count}</p>
                    </div>
                    <div className="rounded p-3" style={{ background: GOLD_L, border: `1px solid ${LINE}` }}>
                      <p style={{ color: MUTED }} className="text-xs">Revenue collected</p>
                      <p className="text-2xl font-bold" style={{ color: INK }}>₹{stats.revenue.toLocaleString("en-IN")}</p>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {stats.recent.length === 0 && <p className="text-xs" style={{ color: MUTED }}>No activity yet.</p>}
                    {stats.recent.map((r, i) => (
                      <div key={i} className="text-xs p-2 rounded" style={{ background: "#fafafa", border: `1px solid ${LINE}` }}>
                        <span className="font-medium">{r.method === "repeat-discount" ? "Free (repeat-customer discount)" : r.method}</span>
                        {r.reportType && <span> &middot; {r.reportType === "cma" ? "CMA" : "DPR"}</span>}
                        {r.amount ? <span> &middot; ₹{r.amount}</span> : r.method === "repeat-discount" ? <span> &middot; ₹0</span> : null}
                        {r.status === "pending" && <span style={{ color: "#B3261E" }}> &middot; pending</span>}
                        <span style={{ color: MUTED }}> &middot; {new Date(r.at).toLocaleString()}</span>
                        {r.contact && <div style={{ color: MUTED }}>{r.contact}</div>}
                        {r.utr && <div style={{ color: MUTED }}>UTR: {r.utr}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button onClick={() => { setMode("choose"); setGeneratedLink(""); setAdminToken(null); setStats(null); }} className="w-full pt-4 text-xs underline text-center" style={{ color: MUTED }}>Back</button>
          </div>
        )}
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
      onFocus={(e) => e.target.select()}
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

function PrintableReport({ entrepreneur, calc, finance, capex, machinery, products, rawMaterials, wages, opex, admin, depRate, details, introText, aboutText, scheme, schemeTitle, mudraCategory }) {
  const y = calc.years;
  const rmList = rawMaterials.map((r) => r.name).filter(Boolean).join(", ");

  return (
    <div className="print-only">
      {/* PAGE 1 — COVER PAGE: LETTERHEAD + INTRODUCTION + PROMOTER */}
      <div className="print-page" style={{ padding: 0 }}>
        <div style={{ background: "#152238", padding: "28px 34px", color: "#fff" }}>
          <p style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#AD8A34", margin: 0 }}>
            {schemeTitle || "Detailed Project Report"}
          </p>
          <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 24, margin: "6px 0 2px" }}>
            {entrepreneur.business || "Proposed Enterprise"}
          </h1>
          <p style={{ fontSize: 12, color: "#cfd6e4", margin: 0 }}>Promoter: {entrepreneur.name || "—"} &middot; {details.date}</p>
        </div>

        <div style={{ display: "flex", borderBottom: "2px solid #AD8A34" }}>
          {[
            ["Total project cost", `Rs. ${fmt(calc.totalProjectCost)}`],
            ["Term loan sought", `Rs. ${fmt(calc.termLoan)}`],
            [mudraCategory ? "MUDRA category" : "Avg. DSCR", mudraCategory || calc.avgDscr.toFixed(2)],
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
        <p style={{ textAlign: "center", fontSize: 11, color: "#666", marginTop: 4 }}>
          Loan scheme: <b>{schemeTitle || "PMEGP Project Report"}</b>
          {mudraCategory && <> &middot; Category: <b>{mudraCategory}</b></>}
        </p>
        <table className="print-table" style={{ marginTop: 14 }}>
          <tbody>
            <tr><td style={{ width: 28 }}>1</td><td>Name of the entrepreneur</td><td><b>{entrepreneur.name}</b></td></tr>
            <tr><td>2</td><td>Constitution</td><td>Individual</td></tr>
            <tr><td>3</td><td>Mobile</td><td>{entrepreneur.mobile}</td></tr>
            <tr><td>4</td><td>Email</td><td>{entrepreneur.email}</td></tr>
            <tr><td>5</td><td>PAN</td><td>{entrepreneur.pan}</td></tr>
            <tr><td>6</td><td>Udyam Registration No.</td><td>{entrepreneur.udyamNo}</td></tr>
            <tr><td>7</td><td>Unit address</td><td>{entrepreneur.address}</td></tr>
            <tr><td>8</td><td>Name of the project / business</td><td>{entrepreneur.business}</td></tr>
            <tr><td>9</td><td>Cost of project</td><td>Rs. {fmt(calc.totalProjectCost)}</td></tr>
            <tr>
              <td>10</td><td>Means of finance</td>
              <td>
                Term loan: Rs. {fmt(calc.termLoan)}<br />
                Working capital loan: Rs. {fmt(calc.wcLoan)}<br />
                Own contribution: Rs. {fmt(calc.ownContribution)}
              </td>
            </tr>
            <tr><td>11</td><td>Average debt service coverage ratio</td><td>{calc.avgDscr.toFixed(2)}</td></tr>
            <tr><td>12</td><td>Pay back period</td><td>{details.payBackYears} years</td></tr>
            <tr><td>13</td><td>Project implementation period</td><td>{details.implementationMonths} months</td></tr>
            <tr><td>14</td><td>Break even point (year 1)</td><td>{pct(y[0]?.bepPct || 0)}</td></tr>
            <tr><td>15</td><td>Employment</td><td>{details.employment}</td></tr>
            <tr><td>16</td><td>Power requirement</td><td>{details.powerRequirement}</td></tr>
            <tr><td>17</td><td>Major raw materials</td><td>{rmList}</td></tr>
            <tr><td>18</td><td>Estimated annual sales turnover (100% capacity)</td><td>Rs. {fmt(calc.salesAt100)}</td></tr>
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
            <tr><td>Interest + installment</td>{y.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(r.termInterest + r.termInstallment + r.wcInterest)}</td>)}</tr>
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

      {/* PAGE 8 — PROJECTED BALANCE SHEET + RATIOS */}
      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>11. Projected Balance Sheet</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{YEARS.map((yr) => <th key={yr}>Year {yr}</th>)}</tr></thead>
          <tbody>
            <tr><td colSpan={6}><b>Liabilities</b></td></tr>
            <tr><td>Promoter's capital</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.promotersCapital)}</td>)}</tr>
            <tr><td>Profit</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.profit)}</td>)}</tr>
            <tr><td>Term loan</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.termLoanLiability)}</td>)}</tr>
            <tr><td>Working capital loan</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.wcLoanLiability)}</td>)}</tr>
            <tr><td><b>Total liabilities</b></td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}><b>{fmt(b.totalLiabilities)}</b></td>)}</tr>
            <tr><td colSpan={6}><b>Assets</b></td></tr>
            <tr><td>Gross fixed assets</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.grossFixedAssets)}</td>)}</tr>
            <tr><td>Less: depreciation</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.lessDepreciation)}</td>)}</tr>
            <tr><td>Net fixed assets</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.netFixedAssets)}</td>)}</tr>
            <tr><td>Preliminary &amp; pre-op. expenses</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.preliminaryExpenses)}</td>)}</tr>
            <tr><td>Current assets</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.currentAssets)}</td>)}</tr>
            <tr><td>Cash in bank/hand</td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(b.cashInBank)}</td>)}</tr>
            <tr><td><b>Total assets</b></td>{calc.balanceSheet.map((b, i) => <td key={i} style={{ textAlign: "right" }}><b>{fmt(b.totalAssets)}</b></td>)}</tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 16 }}>12. Ratio analysis</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{YEARS.map((yr) => <th key={yr}>Year {yr}</th>)}</tr></thead>
          <tbody>
            <tr><td>Current ratio</td>{calc.ratios.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{r.currentRatio === null ? "N/A" : r.currentRatio.toFixed(2)}</td>)}</tr>
            <tr><td>Debt-equity ratio</td>{calc.ratios.map((r, i) => <td key={i} style={{ textAlign: "right" }}>{r.debtEquityRatio === null ? "N/A" : r.debtEquityRatio.toFixed(2)}</td>)}</tr>
          </tbody>
        </table>
      </div>

      {/* PAGE 9 — CASH FLOW STATEMENT */}
      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>13. Cash Flow Statement</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{YEARS.map((yr) => <th key={yr}>Year {yr}</th>)}</tr></thead>
          <tbody>
            <tr><td>Total inflow (profit + depreciation + loans drawn)</td>{calc.cashFlow.map((c, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(c.totalInflow)}</td>)}</tr>
            <tr><td>Repayment of term loan</td>{calc.cashFlow.map((c, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(c.termRepayment)}</td>)}</tr>
            <tr><td>Repayment of working capital loan</td>{calc.cashFlow.map((c, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(c.wcRepayment)}</td>)}</tr>
            <tr><td>Working capital deployed</td>{calc.cashFlow.map((c, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(c.currentAssetsUse)}</td>)}</tr>
            <tr><td><b>Total outflow</b></td>{calc.cashFlow.map((c, i) => <td key={i} style={{ textAlign: "right" }}><b>{fmt(c.totalOutflow)}</b></td>)}</tr>
            <tr><td>Opening cash balance</td>{calc.cashFlow.map((c, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(c.opening)}</td>)}</tr>
            <tr><td>Surplus for the year</td>{calc.cashFlow.map((c, i) => <td key={i} style={{ textAlign: "right" }}>{fmt(c.surplus)}</td>)}</tr>
            <tr><td><b>Closing cash balance</b></td>{calc.cashFlow.map((c, i) => <td key={i} style={{ textAlign: "right" }}><b>{fmt(c.closing)}</b></td>)}</tr>
          </tbody>
        </table>
      </div>

      {/* PAGE 10 — SIGNATURE */}
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
      </div>
    </div>
  );
}

// ==========================================================================
// CMA / Working Capital — Inputs & on-screen Report
// ==========================================================================
const CMA_INK = "#152238", CMA_GOLD = "#AD8A34", CMA_GOLD_L = "#F3EBD6", CMA_LINE = "#DFDACB", CMA_TEXT = "#23262B", CMA_MUTED = "#6B6656";

function cmaFmt(n) {
  return (isFinite(n) ? n : 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function cmaPct(v) {
  return v === null || !isFinite(v) ? "N/A" : `${v.toFixed(2)}%`;
}
function cmaRatio(v) {
  return v === null || !isFinite(v) ? "N/A" : v.toFixed(2);
}

function CmaPeriodRow({ label, field, periods, onChange }) {
  return (
    <tr>
      <td className="py-1 pr-3 text-sm" style={{ color: CMA_TEXT }}>{label}</td>
      {periods.map((p, i) => (
        <td key={i} className="py-1 px-1">
          <input
            type="number"
            value={p[field]}
            onChange={(e) => onChange(i, field, e.target.value === "" ? 0 : Number(e.target.value))}
            onFocus={(e) => e.target.select()}
            className="w-full bg-white border rounded px-2 py-1.5 text-sm focus:outline-none"
            style={{ borderColor: CMA_LINE, fontFamily: "ui-monospace, monospace" }}
          />
        </td>
      ))}
    </tr>
  );
}

function CmaComputedRow({ label, values, formatter = cmaFmt, bold = false }) {
  return (
    <tr>
      <td className="py-1.5 pr-3 text-sm" style={{ color: bold ? CMA_TEXT : CMA_MUTED, fontWeight: bold ? 600 : 400 }}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className="py-1.5 px-3 text-sm text-right" style={{ fontFamily: "ui-monospace, monospace", fontWeight: bold ? 600 : 400 }}>
          {formatter(v)}
        </td>
      ))}
    </tr>
  );
}

function CmaSection({ title, children }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${CMA_LINE}`, borderRadius: 10 }} className="p-5 mb-5">
      <h3 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-[15px] mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          {children}
        </table>
      </div>
    </div>
  );
}

function CmaInputsAndReport({ tab, cmaEntrepreneur, setCmaEntrepreneur, cmaPeriodLabels, setCmaPeriodLabels, cmaPeriods, updateCmaPeriod, cmaCalc }) {
  const inputCls = "w-full bg-white border rounded px-2 py-1.5 text-sm focus:outline-none";
  const inputStyle = { borderColor: CMA_LINE };

  const periodHeaderRow = (
    <tr>
      <th className="text-left pb-2 text-xs uppercase" style={{ color: CMA_MUTED }}>Particulars</th>
      {cmaPeriodLabels.map((label, i) => (
        <th key={i} className="pb-2 px-1" style={{ minWidth: 110 }}>
          <input
            className="w-full text-xs font-medium border-0 border-b bg-transparent focus:outline-none"
            style={{ borderColor: CMA_LINE, color: CMA_TEXT }}
            value={label}
            onChange={(e) => setCmaPeriodLabels((labels) => labels.map((l, li) => (li === i ? e.target.value : l)))}
          />
        </th>
      ))}
    </tr>
  );

  if (tab === "inputs") {
    return (
      <div className="space-y-6 max-w-6xl">
        <div style={{ background: CMA_GOLD_L, border: `1px solid ${CMA_LINE}`, borderRadius: 10 }} className="p-5">
          <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-[15px] mb-2">
            CMA / Working Capital Assessment
          </h2>
          <p className="text-sm" style={{ color: CMA_MUTED }}>
            This assesses an <b>existing business's</b> working-capital limit across 5 periods (rename the columns
            below to match your actual reporting years — e.g. last audited year, current provisional year, and
            three years projected). It uses the same Nayak Committee (turnover method) and Tandon Committee (I & II)
            methods banks use to assess cash-credit limits.
          </p>
        </div>

        <div style={{ background: "#fff", border: `1px solid ${CMA_LINE}`, borderRadius: 10 }} className="p-5">
          <h3 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-[15px] mb-3">Business details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: CMA_MUTED }}>Name of entrepreneur</span>
              <input className={inputCls} style={inputStyle} value={cmaEntrepreneur.name} onChange={(e) => setCmaEntrepreneur({ ...cmaEntrepreneur, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: CMA_MUTED }}>Business / unit name</span>
              <input className={inputCls} style={inputStyle} value={cmaEntrepreneur.business} onChange={(e) => setCmaEntrepreneur({ ...cmaEntrepreneur, business: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: CMA_MUTED }}>Address</span>
              <input className={inputCls} style={inputStyle} value={cmaEntrepreneur.address} onChange={(e) => setCmaEntrepreneur({ ...cmaEntrepreneur, address: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: CMA_MUTED }}>Mobile</span>
              <input className={inputCls} style={inputStyle} value={cmaEntrepreneur.mobile} onChange={(e) => setCmaEntrepreneur({ ...cmaEntrepreneur, mobile: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: CMA_MUTED }}>Email</span>
              <input type="email" className={inputCls} style={inputStyle} value={cmaEntrepreneur.email} onChange={(e) => setCmaEntrepreneur({ ...cmaEntrepreneur, email: e.target.value })} />
            </label>
          </div>
        </div>

        <CmaSection title="Form II — Operating statement (income & expenses)">
          <thead>{periodHeaderRow}</thead>
          <tbody>
            <CmaPeriodRow label="Domestic sales" field="domesticSales" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Export sales" field="exportSales" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Other income" field="otherIncome" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Purchases (cost of goods)" field="purchases" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Opening stock" field="openingStock" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Closing stock" field="closingStock" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Selling, general & admin expenses" field="sgaExpenses" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Interest" field="interest" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Depreciation" field="depreciation" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Other non-operating income" field="otherNonOpIncome" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Other non-operating expense" field="otherNonOpExpense" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Provision for tax" field="taxProvision" periods={cmaPeriods} onChange={updateCmaPeriod} />
          </tbody>
        </CmaSection>

        <CmaSection title="Form III — Current liabilities & term liabilities">
          <thead>{periodHeaderRow}</thead>
          <tbody>
            <CmaPeriodRow label="Short term borrowings from bank" field="shortTermBorrowings" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Sundry creditors" field="sundryCreditors" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Other current liabilities" field="otherCurrentLiabilities" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Term loans" field="termLoans" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Other term liabilities" field="otherTermLiabilities" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Share capital (proprietor's capital account)" field="shareCapital" periods={cmaPeriods} onChange={updateCmaPeriod} />
          </tbody>
        </CmaSection>

        <CmaSection title="Form III — Current assets & fixed assets">
          <thead>{periodHeaderRow}</thead>
          <tbody>
            <CmaPeriodRow label="Cash & bank" field="cashAndBank" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Receivables" field="receivables" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Stock-in-trade" field="stockInTrade" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Other current assets" field="otherCurrentAssets" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Gross block (fixed assets at cost)" field="grossBlock" periods={cmaPeriods} onChange={updateCmaPeriod} />
            <CmaPeriodRow label="Depreciation to date" field="depreciationToDate" periods={cmaPeriods} onChange={updateCmaPeriod} />
          </tbody>
        </CmaSection>
      </div>
    );
  }

  const p = cmaCalc.periods;
  return (
    <div className="max-w-6xl">
      <CmaSection title="Form II — Operating statement">
        <thead>{periodHeaderRow}</thead>
        <tbody>
          <CmaComputedRow label="Total income" values={p.map((x) => x.totalIncome)} bold />
          <CmaComputedRow label="Cost of sales" values={p.map((x) => x.costOfSales)} />
          <CmaComputedRow label="Gross profit" values={p.map((x) => x.grossProfit)} />
          <CmaComputedRow label="Operating profit (EBITDA)" values={p.map((x) => x.ebitda)} bold />
          <CmaComputedRow label="Profit before tax" values={p.map((x) => x.pbt)} />
          <CmaComputedRow label="Net profit" values={p.map((x) => x.netProfit)} bold />
        </tbody>
      </CmaSection>

      <CmaSection title="Form III — Balance sheet summary">
        <thead>{periodHeaderRow}</thead>
        <tbody>
          <CmaComputedRow label="Total current liabilities" values={p.map((x) => x.totalCurrentLiabilities)} />
          <CmaComputedRow label="Total term liabilities" values={p.map((x) => x.totalTermLiabilities)} />
          <CmaComputedRow label="Total outside liabilities" values={p.map((x) => x.totalOutsideLiabilities)} />
          <CmaComputedRow label="Net worth" values={p.map((x) => x.netWorth)} bold />
          <CmaComputedRow label="Total current assets" values={p.map((x) => x.totalCurrentAssets)} />
          <CmaComputedRow label="Net fixed assets" values={p.map((x) => x.netFixedAssets)} />
          <CmaComputedRow label="Total assets" values={p.map((x) => x.totalAssets)} bold />
          <CmaComputedRow label="Net working capital" values={p.map((x) => x.netWorkingCapital)} bold />
          <CmaComputedRow label="Current ratio" values={p.map((x) => x.currentRatio)} formatter={cmaRatio} />
          <CmaComputedRow label="TOL/TNW ratio" values={p.map((x) => x.tolTnwRatio)} formatter={cmaRatio} />
        </tbody>
      </CmaSection>

      <CmaSection title="Form V — Bank finance for working capital (MPBF)">
        <thead>{periodHeaderRow}</thead>
        <tbody>
          <CmaComputedRow label="MPBF — Turnover method (Nayak Committee)" values={p.map((x) => x.mpbfNayak)} bold />
          <CmaComputedRow label="MPBF — Tandon First Method" values={p.map((x) => x.mpbfTandon1)} bold />
          <CmaComputedRow label="MPBF — Tandon Second Method" values={p.map((x) => x.mpbfTandon2)} bold />
        </tbody>
      </CmaSection>

      <CmaSection title="Miscellaneous ratios">
        <thead>{periodHeaderRow}</thead>
        <tbody>
          <CmaComputedRow label="Gross profit ratio" values={p.map((x) => x.grossProfitRatio)} formatter={cmaPct} />
          <CmaComputedRow label="Operating profit ratio" values={p.map((x) => x.operatingProfitRatio)} formatter={cmaPct} />
          <CmaComputedRow label="Net profit ratio" values={p.map((x) => x.netProfitRatio)} formatter={cmaPct} />
          <CmaComputedRow label="Interest coverage ratio" values={p.map((x) => x.interestCoverageRatio)} formatter={cmaRatio} />
          <CmaComputedRow label="Quick ratio" values={p.map((x) => x.quickRatio)} formatter={cmaRatio} />
          <CmaComputedRow label="Debt-equity ratio" values={p.map((x) => x.debtEquityRatio)} formatter={cmaRatio} />
          <CmaComputedRow label="Capital turnover ratio" values={p.map((x) => x.capitalTurnoverRatio)} formatter={cmaRatio} />
          <CmaComputedRow label="Return on capital employed" values={p.map((x) => x.returnOnCapitalEmployed)} formatter={cmaPct} />
        </tbody>
      </CmaSection>
    </div>
  );
}

// ==========================================================================
// CMA — Printable PDF report
// ==========================================================================
function CmaPrintableReport({ entrepreneur, periodLabels, periods, calc }) {
  const p = calc.periods;
  return (
    <div className="print-only">
      <div className="print-page">
        <h2 style={{ textAlign: "center", textDecoration: "underline", fontSize: 15 }}>
          CMA / Working Capital Assessment
        </h2>
        <table className="print-table" style={{ marginTop: 14 }}>
          <tbody>
            <tr><td style={{ width: 140 }}>Name of entrepreneur</td><td><b>{entrepreneur.name}</b></td></tr>
            <tr><td>Business / unit name</td><td>{entrepreneur.business}</td></tr>
            <tr><td>Address</td><td>{entrepreneur.address}</td></tr>
            <tr><td>Mobile</td><td>{entrepreneur.mobile}</td></tr>
            <tr><td>Email</td><td>{entrepreneur.email}</td></tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 16 }}>Form II — Operating Statement</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{periodLabels.map((l, i) => <th key={i}>{l}</th>)}</tr></thead>
          <tbody>
            <tr><td>Total income</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.totalIncome)}</b></td>)}</tr>
            <tr><td>Cost of sales</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.costOfSales)}</td>)}</tr>
            <tr><td>Gross profit</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.grossProfit)}</td>)}</tr>
            <tr><td>Operating profit (EBITDA)</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.ebitda)}</b></td>)}</tr>
            <tr><td>Interest</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(periods[i].interest)}</td>)}</tr>
            <tr><td>Depreciation</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(periods[i].depreciation)}</td>)}</tr>
            <tr><td>Profit before tax</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.pbt)}</td>)}</tr>
            <tr><td><b>Net profit</b></td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.netProfit)}</b></td>)}</tr>
          </tbody>
        </table>
      </div>

      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>Form III — Analysis of Balance Sheet</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{periodLabels.map((l, i) => <th key={i}>{l}</th>)}</tr></thead>
          <tbody>
            <tr><td colSpan={6}><b>Liabilities</b></td></tr>
            <tr><td>Total current liabilities</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.totalCurrentLiabilities)}</td>)}</tr>
            <tr><td>Total term liabilities</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.totalTermLiabilities)}</td>)}</tr>
            <tr><td>Total outside liabilities</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.totalOutsideLiabilities)}</td>)}</tr>
            <tr><td>Net worth</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.netWorth)}</b></td>)}</tr>
            <tr><td><b>Total liabilities</b></td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.totalLiabilitiesBS)}</b></td>)}</tr>
            <tr><td colSpan={6}><b>Assets</b></td></tr>
            <tr><td>Total current assets</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.totalCurrentAssets)}</td>)}</tr>
            <tr><td>Net fixed assets</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.netFixedAssets)}</td>)}</tr>
            <tr><td><b>Total assets</b></td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.totalAssets)}</b></td>)}</tr>
            <tr><td>Net working capital</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaFmt(x.netWorkingCapital)}</td>)}</tr>
            <tr><td>Current ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaRatio(x.currentRatio)}</td>)}</tr>
            <tr><td>TOL/TNW ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaRatio(x.tolTnwRatio)}</td>)}</tr>
          </tbody>
        </table>
      </div>

      <div className="print-page">
        <h3 style={{ fontSize: 13 }}>Form V — Bank Finance for Working Capital (MPBF)</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Method</th>{periodLabels.map((l, i) => <th key={i}>{l}</th>)}</tr></thead>
          <tbody>
            <tr><td>Turnover method (Nayak Committee)</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.mpbfNayak)}</b></td>)}</tr>
            <tr><td>Tandon Committee — First Method</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.mpbfTandon1)}</b></td>)}</tr>
            <tr><td>Tandon Committee — Second Method</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}><b>{cmaFmt(x.mpbfTandon2)}</b></td>)}</tr>
          </tbody>
        </table>

        <h3 style={{ fontSize: 13, marginTop: 16 }}>Miscellaneous Ratios</h3>
        <table className="print-table" style={{ marginTop: 6 }}>
          <thead><tr><th>Particulars</th>{periodLabels.map((l, i) => <th key={i}>{l}</th>)}</tr></thead>
          <tbody>
            <tr><td>Gross profit ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaPct(x.grossProfitRatio)}</td>)}</tr>
            <tr><td>Operating profit ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaPct(x.operatingProfitRatio)}</td>)}</tr>
            <tr><td>Net profit ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaPct(x.netProfitRatio)}</td>)}</tr>
            <tr><td>Interest coverage ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaRatio(x.interestCoverageRatio)}</td>)}</tr>
            <tr><td>Quick ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaRatio(x.quickRatio)}</td>)}</tr>
            <tr><td>Debt-equity ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaRatio(x.debtEquityRatio)}</td>)}</tr>
            <tr><td>Capital turnover ratio</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaRatio(x.capitalTurnoverRatio)}</td>)}</tr>
            <tr><td>Return on capital employed</td>{p.map((x, i) => <td key={i} style={{ textAlign: "right" }}>{cmaPct(x.returnOnCapitalEmployed)}</td>)}</tr>
          </tbody>
        </table>

        <p style={{ fontSize: 10.5, marginTop: 30, color: "#666" }}>
          This CMA data has been prepared based on the figures furnished by the applicant, using the Nayak Committee
          (turnover method) and Tandon Committee (I &amp; II) methodologies for assessing working capital finance.
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
