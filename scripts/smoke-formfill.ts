/**
 * Dev smoke test for the ATS form scraper — no submission, read-only.
 * Usage: npx tsx scripts/smoke-formfill.ts <job-or-listing-url>
 */
import { classifyUrl } from "../src/lib/ats";
import { discoverAtsWithBrowser, scrapeApplicationForm } from "../src/lib/formfill";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: npx tsx scripts/smoke-formfill.ts <url>");
    process.exit(1);
  }

  let target = classifyUrl(url);
  if (!target) {
    console.log("Not a direct ATS URL — trying browser discovery…");
    target = await discoverAtsWithBrowser(url);
  }
  if (!target) {
    console.log("No supported ATS found.");
    process.exit(2);
  }
  console.log(`ATS: ${target.ats}\nApply URL: ${target.applyUrl}\n`);

  const scrape = await scrapeApplicationForm(target.applyUrl);
  console.log(`Final URL: ${scrape.finalUrl}`);
  console.log(`Captcha present: ${scrape.captcha}`);
  console.log(`Fields (${scrape.fields.length}):`);
  for (const f of scrape.fields) {
    const opts = f.options
      ? ` options=[${f.options.slice(0, 6).join(" | ")}${f.options.length > 6 ? " | …" : ""}]`
      : "";
    console.log(`  [${f.type}${f.required ? "*" : ""}] ${f.label || "(no label)"} — ${f.selector}${opts}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
