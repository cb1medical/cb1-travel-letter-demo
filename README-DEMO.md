# CB1 Travel Letter - SANITIZED DEMO

This folder is a **safe-to-share demo** of the travel letter generator. It behaves
exactly like the real tool, but nothing sensitive is in it:

- **No real signatures.** The signatures shipped here are plain "specimen" placeholders,
  not the consultants' real ones. The real signatures are only in the private build.
- **Every letter is watermarked.** A red "SAMPLE - DEMO ONLY - NOT A VALID MEDICAL
  DOCUMENT" banner and a large diagonal "SAMPLE" watermark appear on every generated PDF.
- **The PIN is printed on the unlock screen** (`cb1-travel-demo`), so anyone can try it.
- **Downloads are named `DEMO-travel-letter-...pdf`.**

Because there is nothing secret in this folder, it is safe to push to a public repo and
host on a public URL. Share the link with the team freely.

---

## What the team will see

1. Open the link -> unlock screen shows the demo PIN. Enter `cb1-travel-demo`.
2. Pick a type of care (Pain -> Dr Simon Tordoff, Mental Health -> Dr Vijay Delaffon),
   fill in patient + travel details.
3. Click **Download PDF** -> a watermarked sample letter downloads instantly.

---

## Deploy: GitHub -> Cloudflare Pages

From inside this `Travel Form Demo` folder:

1. Create the repo and push:
   ```
   git init
   git add .
   git commit -m "CB1 travel letter - sanitized demo"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
   A **public** repo is fine (nothing here is sensitive), but private works too.

2. In Cloudflare Pages: **Create project -> Connect to Git -> select the repo**.
   - Framework preset: **None**
   - Build command: *(leave blank)*
   - Build output directory: **/** (repo root)

3. Deploy. Cloudflare gives you a `*.pages.dev` URL - that is the link to share.

Every push to `main` redeploys automatically. The included `_headers` file applies the
security headers.

---

## Do NOT use this folder for the real thing

This is the demo. The real, private build (real signatures, real PIN, no watermark)
lives in the sibling `Travel Form` folder. Deploy that one - after setting a private
PIN - for actual patient use. See its `DEPLOY.md`.
