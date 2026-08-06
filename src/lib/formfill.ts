import { chromium, Page } from "playwright";
import { PlanField } from "./db";
import { AtsTarget, classifyUrl } from "./ats";

/** A form field as scraped from the page, before any value is assigned. */
export interface ScrapedField {
  selector: string;
  label: string;
  type: PlanField["type"];
  required: boolean;
  options?: string[];
}

export interface ScrapeResult {
  fields: ScrapedField[];
  captcha: boolean;
  finalUrl: string;
}

export interface Attachment {
  name: string;
  buffer: Buffer;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });
    const page = await ctx.newPage();
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") route.abort();
      else route.continue();
    });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Follow a listing URL (usually an aggregator page) to a supported ATS
 * application page, chasing at most a few "Apply" links.
 */
export async function discoverAtsWithBrowser(startUrl: string): Promise<AtsTarget | null> {
  return withPage(async (page) => {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const direct = classifyUrl(page.url());
    if (direct) return direct;

    const hrefs = await page.$$eval("a[href]", (anchors) =>
      anchors
        .filter(
          (a) =>
            /apply/i.test(a.textContent ?? "") || /apply|job/i.test(a.getAttribute("href") ?? "")
        )
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => /^https?:/.test(h))
        .slice(0, 12)
    );
    for (const h of hrefs) {
      const hit = classifyUrl(h);
      if (hit) return hit;
    }
    // Apply links often bounce through a redirect before landing on the ATS.
    for (const h of hrefs.slice(0, 3)) {
      try {
        await page.goto(h, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000);
        const hit = classifyUrl(page.url());
        if (hit) return hit;
      } catch {
        // dead link — try the next one
      }
    }

    // Some boards wire Apply to a JS handler instead of a link — click it and
    // follow wherever it goes, including a new tab.
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    const applyBtn = page
      .getByRole("button", { name: /apply/i })
      .or(page.getByRole("link", { name: /apply/i }))
      .first();
    if (await applyBtn.count()) {
      const popupPromise = page
        .context()
        .waitForEvent("page", { timeout: 8000 })
        .catch(() => null);
      await applyBtn.click({ timeout: 5000 }).catch(() => {});
      const popup = await popupPromise;
      const landed = popup ?? page;
      await landed.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await landed.waitForTimeout(2000);
      const hit = classifyUrl(landed.url());
      if (hit) return hit;
    }
    return null;
  });
}

/* ---------------- Scraping ---------------- */

// Playwright serializes evaluate() callbacks with toString(), and bundlers
// (tsx/esbuild, minifiers) inject helpers like __name that don't exist inside
// the page. Shipping the extractor as plain-JS source sidesteps that entirely,
// so keep this string free of TS syntax and template literals.
const EXTRACT_FIELDS_SOURCE = `((maxFields) => {
  const esc = (s) => CSS.escape(s);
  const clean = (s) => s.replace(/\\s+/g, " ").replace(/[*✱]\\s*$/, "").replace(/^\\s*[*✱]/, "").trim();
  const visible = (el) => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const labelFor = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + esc(el.id) + '"]');
      if (l && l.textContent && l.textContent.trim()) return clean(l.textContent);
    }
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\\s+/).map((i) => {
        const e = document.getElementById(i);
        return e ? e.textContent : "";
      }).join(" ");
      if (t.trim()) return clean(t);
    }
    const wrap = el.closest("label");
    if (wrap && wrap.textContent && wrap.textContent.trim()) return clean(wrap.textContent);
    let n = el.parentElement;
    for (let d = 0; n && d < 4; d++, n = n.parentElement) {
      const l = n.querySelector('label, legend, [class*="label" i]');
      if (l && !l.contains(el) && l.textContent && l.textContent.trim()) return clean(l.textContent);
    }
    return clean(el.getAttribute("placeholder") || el.name || "");
  };
  const labelRaw = (el) => {
    const l = el.id ? document.querySelector('label[for="' + esc(el.id) + '"]') : el.closest("label");
    return (l && l.textContent) || "";
  };
  const isRequired = (el) =>
    el.required || el.getAttribute("aria-required") === "true" || /[*✱]/.test(labelRaw(el));
  const selFor = (el) => {
    if (el.id) return "#" + esc(el.id);
    if (el.name) {
      const sel = el.tagName.toLowerCase() + '[name="' + el.name + '"]';
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const path = [];
    let n = el;
    while (n && n.nodeType === 1 && path.length < 8) {
      if (n.id) { path.unshift("#" + esc(n.id)); break; }
      let i = 1;
      let sib = n;
      while ((sib = sib.previousElementSibling)) i++;
      path.unshift(n.tagName.toLowerCase() + ":nth-child(" + i + ")");
      n = n.parentElement;
    }
    return path.join(" > ");
  };

  // Pick the form that looks like the application (has a file upload, or the
  // most fields); fall back to scanning the whole document.
  const forms = Array.from(document.forms);
  const score = (f) =>
    (f.querySelector('input[type="file"]') ? 1000 : 0) +
    f.querySelectorAll("input, textarea, select").length;
  const scope = forms.length > 0 ? forms.reduce((a, b) => (score(a) >= score(b) ? a : b)) : document;

  const out = [];
  const seenRadio = new Set();
  const seenCheck = new Set();
  const els = Array.from(scope.querySelectorAll("input, textarea, select"));
  for (const el of els) {
    if (out.length >= maxFields) break;
    const tag = el.tagName.toLowerCase();
    const itype = (el.type || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(itype)) continue;
    if (itype !== "file" && !visible(el)) continue;

    // Same-name checkbox sets (e.g. "which languages do you speak") become one
    // multi-select field instead of dozens of independent checkboxes.
    if (itype === "checkbox" && el.name) {
      if (seenCheck.has(el.name)) continue;
      const group = Array.from(scope.querySelectorAll('input[type="checkbox"][name="' + esc(el.name) + '"]'));
      if (group.length > 1) {
        seenCheck.add(el.name);
        const options = group.map((r) => labelFor(r)).filter(Boolean);
        let q = "";
        let n = el.parentElement;
        for (let d = 0; n && d < 5 && !q; d++, n = n.parentElement) {
          const l = n.querySelector("legend, [class*='label' i]");
          if (l && l.textContent && !group.some((g) => l.contains(g))) q = clean(l.textContent);
        }
        out.push({
          selector: 'input[type="checkbox"][name="' + el.name + '"]',
          label: q || el.name,
          type: "checkboxgroup",
          required: false,
          options,
        });
        continue;
      }
    }

    if (itype === "radio") {
      const name = el.name;
      if (!name || seenRadio.has(name)) continue;
      seenRadio.add(name);
      const group = Array.from(scope.querySelectorAll('input[type="radio"][name="' + esc(name) + '"]'));
      const options = group.map((r) => labelFor(r)).filter(Boolean);
      let q = "";
      let n = el.parentElement;
      for (let d = 0; n && d < 5 && !q; d++, n = n.parentElement) {
        const l = n.querySelector("legend, [class*='label' i]");
        if (l && l.textContent && !group.some((g) => l.contains(g))) q = clean(l.textContent);
      }
      out.push({
        selector: 'input[type="radio"][name="' + name + '"]',
        label: q || name,
        type: "radio",
        required: group.some((r) => isRequired(r)),
        options,
      });
      continue;
    }

    if (tag === "select") {
      const options = Array.from(el.options)
        .map((o) => (o.textContent || "").trim())
        .filter((t) => t && !/^(select|choose|please|--)/i.test(t))
        .slice(0, 80);
      out.push({ selector: selFor(el), label: labelFor(el), type: "select", required: isRequired(el), options });
      continue;
    }

    const role = el.getAttribute("role");
    const type =
      tag === "textarea" ? "textarea"
      : itype === "file" ? "file"
      : itype === "checkbox" ? "checkbox"
      : role === "combobox" || ["list", "both", "inline"].includes(el.getAttribute("aria-autocomplete") || "") ? "combobox"
      : ["email", "tel", "url", "number", "date"].includes(itype) ? itype
      : "text";
    out.push({ selector: selFor(el), label: labelFor(el), type, required: isRequired(el) });
  }

  const captcha = Boolean(
    document.querySelector('.g-recaptcha, [data-hcaptcha], iframe[src*="captcha" i], iframe[src*="turnstile" i]')
  );
  return { fields: out, captcha };
})`;

interface RawExtract {
  fields: Array<{
    selector: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
  }>;
  captcha: boolean;
}

async function extractFields(page: Page): Promise<{ fields: ScrapedField[]; captcha: boolean }> {
  const raw = (await page.evaluate(EXTRACT_FIELDS_SOURCE + "(60)")) as RawExtract;
  const seen = new Set<string>();
  let fields = raw.fields.filter((f) => {
    if (!f.selector || seen.has(f.selector)) return false;
    seen.add(f.selector);
    return true;
  }) as ScrapedField[];
  // React-select style widgets render a combobox plus a same-labeled plain
  // input; keep only the combobox so we don't fill (and display) both.
  const comboLabels = new Set(
    fields.filter((f) => f.type === "combobox").map((f) => f.label.toLowerCase())
  );
  fields = fields.filter(
    (f) => !(f.type === "text" && f.label && comboLabels.has(f.label.toLowerCase()))
  );
  return { fields, captcha: raw.captcha };
}

/** Open an ATS application page and enumerate its form fields. */
export async function scrapeApplicationForm(applyUrl: string): Promise<ScrapeResult> {
  return withPage(async (page) => {
    await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    let { fields, captcha } = await extractFields(page);
    // Some listing pages hide the form behind an Apply button on the same page.
    if (fields.filter((f) => f.type !== "checkbox").length < 3) {
      const applyBtn = page
        .getByRole("button", { name: /apply/i })
        .or(page.getByRole("link", { name: /apply/i }))
        .first();
      if (await applyBtn.count()) {
        await applyBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2500);
        ({ fields, captcha } = await extractFields(page));
      }
    }
    return { fields, captcha, finalUrl: page.url() };
  });
}

/* ---------------- Filling + submitting ---------------- */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function pickOption(options: string[], value: string): string | null {
  const v = normalize(value);
  return (
    options.find((o) => normalize(o) === v) ??
    options.find((o) => normalize(o).includes(v) || v.includes(normalize(o))) ??
    null
  );
}

async function fillOne(page: Page, f: PlanField, attachments: Attachment[]): Promise<void> {
  const loc = page.locator(f.selector).first();
  switch (f.type) {
    case "file": {
      const wantsCover = /cover/i.test(`${f.label} ${f.selector}`);
      const att =
        attachments.find((a) => (wantsCover ? /cover/i.test(a.name) : /resume/i.test(a.name))) ??
        attachments[0];
      if (!att) return;
      await loc.setInputFiles({ name: att.name, mimeType: "application/pdf", buffer: att.buffer });
      await page.waitForTimeout(1500); // let async upload widgets settle
      return;
    }
    case "checkbox": {
      const yes = /^(yes|true|1|checked|agreed?|accept(ed)?)$/i.test(f.value.trim());
      await loc.setChecked(yes, { force: true });
      return;
    }
    case "radio":
    case "checkboxgroup": {
      const wanted = f.value
        .split(",")
        .map((s) => normalize(s))
        .filter(Boolean);
      const inputs = page.locator(f.selector);
      const n = await inputs.count();
      for (let i = 0; i < n; i++) {
        const box = inputs.nth(i);
        const label = normalize(
          await box.evaluate((el) => {
            const input = el as HTMLInputElement;
            const byFor = input.id
              ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
              : null;
            return (byFor ?? input.closest("label"))?.textContent?.trim() ?? input.value;
          })
        );
        if (wanted.some((w) => label === w || label.includes(w) || w.includes(label))) {
          await box.check({ force: true });
          if (f.type === "radio") return;
        }
      }
      return;
    }
    case "select": {
      try {
        await loc.selectOption({ label: f.value });
      } catch {
        const best = pickOption(f.options ?? [], f.value);
        if (best) await loc.selectOption({ label: best });
      }
      return;
    }
    case "combobox": {
      await loc.click({ timeout: 5000 });
      await loc.fill(f.value).catch(() => loc.pressSequentially(f.value.slice(0, 50)));
      await page.waitForTimeout(1500);
      const first = f.value.split(/[,(]/)[0].trim();
      const opt = page
        .locator('[role="option"]')
        .filter({ hasText: new RegExp(escapeRe(first), "i") })
        .first();
      if (await opt.count()) {
        await opt.click();
      } else if (await page.locator('[role="option"]').count()) {
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
      } else {
        await page.keyboard.press("Escape");
      }
      return;
    }
    default:
      await loc.fill(f.value);
  }
}

export interface SubmitResult {
  ok: boolean;
  detail: string;
}

/**
 * Fill a previously scraped form with the reviewed values and submit it.
 * Field-level fill errors are collected; a required field that fails aborts
 * before anything is submitted.
 */
export async function submitApplicationForm(
  applyUrl: string,
  fields: PlanField[],
  attachments: Attachment[]
): Promise<SubmitResult> {
  return withPage(async (page) => {
    await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    const problems: string[] = [];
    for (const f of fields) {
      if (f.type !== "file" && !f.value.trim()) continue;
      try {
        await fillOne(page, f, attachments);
      } catch (e) {
        const msg = `"${f.label}": ${e instanceof Error ? e.message.split("\n")[0] : e}`;
        if (f.required) return { ok: false, detail: `Could not fill required field ${msg}` };
        problems.push(msg);
      }
    }

    const captcha = await page
      .locator('.g-recaptcha, [data-hcaptcha], iframe[src*="captcha" i]')
      .first()
      .isVisible()
      .catch(() => false);
    if (captcha) {
      return { ok: false, detail: "Form has a visible captcha — apply manually via the listing." };
    }

    let submit = page
      .locator('button[type="submit"], input[type="submit"]')
      .filter({ hasText: /submit|apply|send/i })
      .first();
    if (!(await submit.count()))
      submit = page.locator('button[type="submit"], input[type="submit"]').first();
    if (!(await submit.count()))
      submit = page.getByRole("button", { name: /submit|apply/i }).first();
    if (!(await submit.count())) return { ok: false, detail: "No submit button found on the form." };
    await submit.click();

    const success = await new Promise<boolean>((resolve) => {
      let done = false;
      const ok = () => {
        if (!done) {
          done = true;
          resolve(true);
        }
      };
      page.waitForURL(/thank|confirmation|success/i, { timeout: 25000 }).then(ok, () => {});
      page
        .waitForFunction(
          () =>
            /thank(s| you)|application (has been |was )?(received|submitted|sent)|successfully (applied|submitted)|we('ve| have) received your application/i.test(
              document.body.innerText
            ),
          { timeout: 25000 }
        )
        .then(ok, () => {});
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve(false);
        }
      }, 26000);
    });

    if (success) {
      const note = problems.length ? ` (skipped optional: ${problems.join("; ")})` : "";
      return { ok: true, detail: `Submitted via application form${note}` };
    }

    const errors = await page
      .$$eval('[aria-invalid="true"], [class*="error" i]', (els) =>
        els
          .map((e) => e.textContent?.trim() ?? "")
          .filter((t) => t && t.length < 200)
          .slice(0, 5)
      )
      .catch(() => [] as string[]);
    return {
      ok: false,
      detail: errors.length
        ? `Form rejected the submission: ${[...new Set(errors)].join(" · ")}`
        : "No submission confirmation detected — verify on the site before retrying.",
    };
  });
}
