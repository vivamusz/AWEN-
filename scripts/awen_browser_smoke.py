#!/usr/bin/env python3
"""End-to-end smoke tests for AWEN Music and owner-only local curation.

Launch against a local HTTP server, no live music APIs or login required.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.getenv("AWEN_TEST_URL", "http://127.0.0.1:8765/")
SCREEN = Path("awen-test-artifacts")
SCREEN.mkdir(exist_ok=True)

def verify():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        # Offline repeatable fixture: all external providers are optional.
        page.route("https://**/*", lambda route: route.abort())
        try:
            response = page.goto(URL, wait_until="domcontentloaded", timeout=20000)
            assert response and response.status == 200
            page.wait_for_function(
                "typeof tracks !== 'undefined' && tracks.length >= 2059 && !!document.querySelector('#awen-connection-status')",
                timeout=25000,
            )
            catalog_count = page.evaluate("tracks.length")
            assert catalog_count == 2059, catalog_count
            assert page.title().startswith("AWEN Music"), page.title()
            hidden = page.evaluate("!tracks.some(t=>['awen-69','awen-70','awen-71','awen-72','awen-73','awen-158','awen-317'].includes(t.id))")
            assert hidden, "Non-song text fragments must be quarantined from the public catalog"
            official = page.evaluate("({album:tracks.find(t=>t.id==='awen-1')?.album,year:tracks.find(t=>t.id==='awen-1')?.year})")
            assert official["album"] == "Uaiymdama - Single", official
            assert official["year"] == 2026, official
            assert "Подтверждённые релизы Apple Music: 77" in page.locator("#awen-connection-status").inner_text()
            print("PASS: Shared catalog and verified Apple release metadata")
            print("PASS: Desktop main page, shared catalog, and scripts")
            page.locator("#desktopNav [data-nav='playlists']").click()
            assert page.locator(".playlist-card").count() == 5
            page.locator(".playlist-card[data-list='chill']").click()
            page.locator("h1.page-title").wait_for()
            assert "Чилл" in page.locator("h1.page-title").inner_text()
            assert page.locator(".song").count() >= 1
            print("PASS: Five playlists and Chill playlist track list")
            manual_respected = page.evaluate("""() => {
              const t = {genre:'Phonk',subgenres:['Chill Phonk'],moods:['Ночное'],
                energy:2,language:'Без слов',playlists:[],playlist_manual:true};
              const removed = !isOnList(t,'night');
              t.playlists=['night'];
              return removed && isOnList(t,'night');
            }""")
            assert manual_respected, "Automatic playlists must not override manual removal"
            print("PASS: Owner's manual playlist selection takes priority")
            page.locator("#desktopNav [data-nav='genres']").click()
            assert page.locator(".genre-card").count() == 19
            assert page.get_by_text("Country", exact=True).count() >= 1
            print("PASS: All 19 genres including Country")
            page.locator("#desktopNav [data-nav='albums']").click()
            assert page.get_by_text("Uaiymdama - Single", exact=True).count() >= 1
            assert page.get_by_text("Без альбома", exact=True).count() == 0
            print("PASS: Verified Apple albums displayed; unknown album is not a fake group")
            page.locator("#desktopNav [data-nav='tracks']").click()
            page.locator("#search").fill("Kordhell")
            assert page.locator(".song").count() >= 1
            assert "Kordhell" in page.locator(".song").first.inner_text()
            print("PASS: Search by artist")
            page.set_viewport_size({"width": 390, "height": 844})
            page.locator("#mobileNav [data-nav='playlists']").click()
            assert page.locator(".playlist-card").count() == 5
            width = page.evaluate("({scroll:document.documentElement.scrollWidth,inner:window.innerWidth})")
            assert width["scroll"] <= width["inner"] + 5, width
            page.screenshot(path=str(SCREEN/"mobile.png"), full_page=True)
            print("PASS: Mobile layout, navigation, and width")

            page.goto(URL.rstrip("/") + "/curator.html", wait_until="domcontentloaded")
            page.wait_for_function(
                "document.querySelectorAll('#list .song').length > 0 && document.querySelector('#stats')?.textContent?.includes('2075')",
                timeout=25000,
            )
            assert page.locator("#filter").input_value() == "unknown"
            # The sample may already have an official genre; work from the full index.
            page.locator("#filter").select_option("all")
            # Edit one track in the test browser, not on GitHub.
            page.locator("#search").fill("Uaiymdama")
            page.locator("button[data-open='awen-1']").click()
            assert page.locator("#year").input_value() == "2026"
            assert page.locator("#album").input_value() == "Uaiymdama - Single"
            page.locator("#genre").select_option("Country")
            page.locator("#save").click()
            assert page.locator("#genre").input_value() == "Country"
            with page.expect_download() as event:
                page.locator("#export").click()
            download = event.value
            assert download.suggested_filename == "awen-curation-patches.json"
            dst = SCREEN/"patch-export.json"
            download.save_as(dst)
            payload = json.loads(dst.read_text(encoding="utf-8"))
            assert payload["patch_format"] == "awen-curator-patches"
            assert payload["changes"]["awen-1"]["genre"] == "Country"
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("document.querySelectorAll('#list .song').length > 0", timeout=25000)
            # The edited record is no longer in the default "Unknown genre" queue.
            page.locator("#filter").select_option("all")
            page.locator("#search").fill("Uaiymdama")
            page.locator("button[data-open='awen-1']").click()
            assert page.locator("#genre").input_value() == "Country"
            page.screenshot(path=str(SCREEN/"curator.png"), full_page=True)
            print("PASS: Curator editor, patch export, browser-local persistence")
            assert not errors, "JavaScript runtime errors: " + "; ".join(errors)
            print(f"ALL CHECKS PASSED. Catalog contains {catalog_count} records")
        except Exception:
            page.screenshot(path=str(SCREEN/"failure.png"), full_page=True)
            print("Browser JavaScript errors:", errors)
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    verify()
