#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["patchright"]
# ///
"""
Download seed samples from freesound.org using browser-based auth.

Usage:
    uv run scripts/freesound-download.py auth   # Opens browser — log in to freesound
    uv run scripts/freesound-download.py run    # Downloads all candidate samples
"""

import json
import os
import sys
import time

from patchright.sync_api import sync_playwright

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.join(SCRIPT_DIR, "..")
AUTH_DIR = os.path.join(PROJECT_ROOT, "data", "auth")
CONTEXT_PATH = os.path.join(AUTH_DIR, "freesound-context.json")
PROFILE_DIR = os.path.join(AUTH_DIR, "freesound-profile")
SAMPLES_DIR = os.path.join(PROJECT_ROOT, "data", "samples")

# Candidate samples from 20260315-seed-sample-candidates.md
# Format: (category_dir, filename_prefix, freesound_url)
SAMPLES = [
    # 1. Impacts and Collisions
    ("1-impacts", "anvil-strike", "https://freesound.org/people/Benboncan/sounds/103630/"),
    ("1-impacts", "metal-hit-sword", "https://freesound.org/people/o_ciz/sounds/475416/"),
    ("1-impacts", "basic-metal-impact", "https://freesound.org/people/Speedenza/sounds/222580/"),
    ("1-impacts", "hammer-metal-rod", "https://freesound.org/s/323795/"),
    ("1-impacts", "hammering-nails", "https://freesound.org/people/InspectorJ/sounds/406048/"),
    # 2. Gears and Ratchets
    ("2-gears", "toy-ratchet", "https://freesound.org/people/monotraum/sounds/376195/"),
    ("2-gears", "ratchet-wrench", "https://freesound.org/people/CapsLok/sounds/181634/"),
    ("2-gears", "relay-click", "https://freesound.org/people/smokeyvw/sounds/85304/"),
    ("2-gears", "relay-switch", "https://freesound.org/people/MrAuralization/sounds/203600/"),
    ("2-gears", "mechanical-clicks", "https://freesound.org/people/julianmateo_/sounds/636821/"),
    # 3. Friction and Scraping
    ("3-friction", "metal-scraping", "https://freesound.org/people/Doctor_Jekyll/sounds/254064/"),
    ("3-friction", "metal-grind-short", "https://freesound.org/people/Daphne_in_Wonderland/sounds/127151/"),
    ("3-friction", "blade-grinding", "https://freesound.org/people/sentryx86/sounds/52198/"),
    ("3-friction", "metal-brush-scrape", "https://freesound.org/people/Marissrar/sounds/366911/"),
    ("3-friction", "angle-grinder", "https://freesound.org/people/Benboncan/sounds/82932/"),
    # 4. Fluid / Liquid
    ("4-fluid", "single-water-drop", "https://freesound.org/people/qubodup/sounds/792932/"),
    ("4-fluid", "water-drop", "https://freesound.org/people/Aiwha/sounds/415484/"),
    ("4-fluid", "bubble-pop", "https://freesound.org/people/elmasmalo1/sounds/377018/"),
    ("4-fluid", "single-water-bubbles", "https://freesound.org/s/395556/"),
    ("4-fluid", "bubbles-in-water", "https://freesound.org/people/calebrankin/sounds/529383/"),
    # 5. Springs
    ("5-springs", "roland-re301-spring-ir", "https://freesound.org/people/0e0/sounds/131034/"),
    ("5-springs", "spring-hit", "https://freesound.org/people/andreas/sounds/194507/"),
    ("5-springs", "door-stop-twang", "https://freesound.org/people/KeyKrusher/sounds/148452/"),
    ("5-springs", "peavey-spring-reverb-ir", "https://freesound.org/people/unfa/sounds/205622/"),
    # 6. Body Impulse Responses
    ("6-body-ir", "metal-bar-resonance", "https://freesound.org/people/jorickhoofd/sounds/160045/"),
    ("6-body-ir", "metal-tube-clear", "https://freesound.org/people/Speedenza/sounds/222581/"),
    ("6-body-ir", "glass-resonance", "https://freesound.org/people/Widowaker/sounds/459110/"),
    ("6-body-ir", "wine-glass-ring", "https://freesound.org/people/cloe.king/sounds/444166/"),
    ("6-body-ir", "tubular-bell-strike", "https://freesound.org/people/sandyrb/sounds/85797/"),
    # 7. Excitation Transients
    ("7-excitation", "hammer-anvil-hit", "https://freesound.org/people/SoundEffectsPodcast_com/sounds/260626/"),
    ("7-excitation", "steam-hiss", "https://freesound.org/people/jesabat/sounds/119741/"),
    ("7-excitation", "air-hiss", "https://freesound.org/people/Jofae/sounds/367125/"),
    ("7-excitation", "pressure-release", "https://freesound.org/people/brunoboselli/sounds/457294/"),
]

TOTAL_SAMPLES = len(SAMPLES)

# Note: 5b (KenMix pack) and 7e (joedeshon pack) are packs, not individual sounds — skipped for now


def do_auth():
    """Open browser for freesound.org login, save session."""
    os.makedirs(AUTH_DIR, exist_ok=True)

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE_DIR,
            headless=False,
            channel="chrome",
            viewport={"width": 1200, "height": 800},
        )

        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://freesound.org/home/login/", wait_until="domcontentloaded", timeout=30000)

        print()
        print("=" * 60)
        print("Freesound.org is open.")
        print()
        print("1. Log in to your freesound account")
        print("2. Wait until you see your dashboard / homepage")
        print()
        input("Press Enter here when logged in...")
        print()

        ctx.storage_state(path=CONTEXT_PATH)
        print(f"Auth saved to {CONTEXT_PATH}")
        ctx.close()


def scrape_metadata(page, url):
    """Scrape license, author, title, description, and tags from a freesound sound page."""
    meta = {"source_url": url}

    # Title
    try:
        title_el = page.locator("#sound_title, h1.sound-title, h1").first
        meta["title"] = title_el.inner_text(timeout=3000).strip()
    except Exception:
        meta["title"] = ""

    # Author — from the username link near the title
    try:
        author_el = page.locator('a[href*="/people/"]').first
        meta["author"] = author_el.inner_text(timeout=3000).strip()
    except Exception:
        meta["author"] = ""

    # License — look for CC license text/link
    try:
        license_el = page.locator('a[href*="creativecommons.org"], .license-deed, .sound-license a').first
        license_text = license_el.get_attribute("href", timeout=3000) or ""
        if not license_text:
            license_text = license_el.inner_text(timeout=3000).strip()
        meta["license_url"] = license_text
        # Extract short name: e.g. "CC BY 4.0" from the URL
        if "creativecommons.org" in license_text:
            parts = license_text.rstrip("/").split("/")
            # e.g. https://creativecommons.org/licenses/by/4.0/
            license_parts = [p for p in parts if p and p not in ("https:", "http:", "", "creativecommons.org", "licenses", "deed")]
            meta["license"] = "CC " + " ".join(license_parts).upper()
        else:
            meta["license"] = license_text
    except Exception:
        meta["license"] = "unknown"
        meta["license_url"] = ""

    # Description
    try:
        desc_el = page.locator("#sound_description, .sound-description").first
        meta["description"] = desc_el.inner_text(timeout=3000).strip()[:500]
    except Exception:
        meta["description"] = ""

    # Tags
    try:
        tag_els = page.locator('.sound-tags a, a.tag, a[href*="/search/?q=tag:"]').all()
        meta["tags"] = [t.inner_text().strip() for t in tag_els[:20] if t.inner_text().strip()]
    except Exception:
        meta["tags"] = []

    return meta


def load_metadata(cat_dir):
    """Load existing metadata.json for a category, or return empty dict."""
    path = os.path.join(cat_dir, "metadata.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_metadata(cat_dir, metadata):
    """Save metadata.json for a category."""
    path = os.path.join(cat_dir, "metadata.json")
    with open(path, "w") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)


def do_run():
    """Download all candidate samples using saved auth."""
    if not os.path.exists(CONTEXT_PATH):
        print("No auth context found. Run 'auth' first:")
        print("  uv run scripts/freesound-download.py auth")
        sys.exit(1)

    os.makedirs(SAMPLES_DIR, exist_ok=True)

    print()
    print(f"Downloading {TOTAL_SAMPLES} samples from freesound.org")
    print(f"Destination: {SAMPLES_DIR}")
    print("=" * 60)
    print()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel="chrome")
        ctx = browser.new_context(storage_state=CONTEXT_PATH)

        downloaded = 0
        skipped = 0
        failed = 0

        for i, (category, name, url) in enumerate(SAMPLES, 1):
            progress = f"[{i}/{TOTAL_SAMPLES}]"
            cat_dir = os.path.join(SAMPLES_DIR, category)
            os.makedirs(cat_dir, exist_ok=True)

            # Load existing metadata for this category
            metadata = load_metadata(cat_dir)

            # Check if already downloaded (any file starting with this prefix)
            existing = [f for f in os.listdir(cat_dir) if f.startswith(name) and f != "metadata.json"]
            if existing:
                print(f"  {progress} SKIP {category}/{name} (exists: {existing[0]})")
                skipped += 1
                continue

            print(f"  {progress} GET  {category}/{name}")
            print(f"         URL: {url}")

            page = None
            try:
                page = ctx.new_page()
                print("         Loading page...", end="", flush=True)
                page.goto(url, wait_until="domcontentloaded", timeout=20000)
                time.sleep(1)
                print(" done")

                # Scrape metadata before downloading
                print("         Scraping metadata...", end="", flush=True)
                meta = scrape_metadata(page, url)
                print(f" done ({meta.get('license', '?')})")

                # Find and click the download button
                print("         Downloading...", end="", flush=True)
                download_btn = page.locator('a#download_button, a.btn-download, a[href*="/download/"]').first
                if not download_btn.is_visible(timeout=5000):
                    download_btn = page.locator('a:has-text("Download")').first

                with page.expect_download(timeout=30000) as download_info:
                    download_btn.click()

                download = download_info.value
                original_filename = download.suggested_filename
                ext = os.path.splitext(original_filename)[1] or ".wav"
                dest_filename = f"{name}{ext}"
                dest = os.path.join(cat_dir, dest_filename)
                download.save_as(dest)

                size_kb = os.path.getsize(dest) / 1024
                print(f" done ({size_kb:.0f} KB)")
                print(f"         Saved: {dest_filename}")

                # Store metadata keyed by filename
                meta["original_filename"] = original_filename
                meta["downloaded_as"] = dest_filename
                meta["size_bytes"] = os.path.getsize(dest)
                metadata[dest_filename] = meta
                save_metadata(cat_dir, metadata)

                downloaded += 1
                page.close()
                time.sleep(0.5)  # Be polite to freesound
                print()

            except Exception as e:
                print(f" FAIL")
                print(f"         Error: {e}")
                failed += 1
                if page:
                    try:
                        page.close()
                    except Exception:
                        pass
                print()

        ctx.close()
        browser.close()

        print("=" * 60)
        print(f"Done: {downloaded} downloaded, {skipped} skipped, {failed} failed")
        print(f"Samples in: {SAMPLES_DIR}")
        print()


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("auth", "run"):
        print("Usage:")
        print("  uv run scripts/freesound-download.py auth   # Log in to freesound")
        print("  uv run scripts/freesound-download.py run    # Download all samples")
        sys.exit(1)

    if sys.argv[1] == "auth":
        do_auth()
    else:
        do_run()


if __name__ == "__main__":
    main()
