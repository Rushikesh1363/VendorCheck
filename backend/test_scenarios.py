from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import database
from backend.generate_fixtures import generate_all_fixtures
from backend.main import app


async def run_tests(base_url: str | None = None):
    database.init_db()
    generate_all_fixtures(force=False)

    if base_url:
        client_ctx = httpx.AsyncClient(base_url=base_url, timeout=30.0)
    else:
        client_ctx = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            timeout=30.0,
        )

    async with client_ctx as client:
        # Clean audit log before verifying all 5 presets
        await client.delete("/api/submissions")

        # 1. Verify health
        r_health = await client.get("/api/health")
        assert r_health.status_code == 200, f"Health failed: {r_health.text}"
        print("[OK] Health:", r_health.json())

        # 2. Fetch presets
        r_presets = await client.get("/api/presets")
        assert r_presets.status_code == 200
        presets = r_presets.json()["presets"]
        assert len(presets) == 5, f"Expected 5 presets, got {len(presets)}"
        print(f"[OK] Loaded {len(presets)} presets.")

        # 3. Verify every preset PDF fixture is downloadable
        for p in presets:
            for _slot, meta in p["files_meta"].items():
                if meta:
                    r_pdf = await client.get(meta["url"])
                    assert r_pdf.status_code == 200, f"Missing fixture {meta['url']}"
                    assert r_pdf.headers["content-type"].startswith("application/pdf")
        print("[OK] All synthetic PDF fixtures downloadable via /api/fixtures/{filename}.")

        # 4. Run each preset through /api/onboard and assert expected outcomes
        for p in presets:
            form_data = dict(p["form_data"])
            files = p["files"]
            if files.get("tax_document"):
                form_data["tax_preset_file"] = files["tax_document"]
            if files.get("bank_document"):
                form_data["bank_preset_file"] = files["bank_document"]
            if files.get("compliance_document"):
                form_data["compliance_preset_file"] = files["compliance_document"]

            resp = await client.post("/api/onboard", data=form_data)
            assert resp.status_code == 200, f"{p['id']} failed HTTP: {resp.text}"
            res = resp.json()

            expected = p["expected_decision"]
            actual = res["decision"]
            assert actual == expected, (
                f"Scenario {p['id']} expected {expected}, got {actual}.\n"
                f"Summary: {res['executive_summary']}\n"
                f"Rules: {json.dumps(res['rule_checks'], indent=2)}"
            )

            # Check specific assertions per scenario
            rule_ids_failed = {
                c["rule_id"] for c in res["rule_checks"] if c["status"] == "FAIL"
            }
            if p["id"] == "scenario_1":
                assert len(rule_ids_failed) == 0
                assert res["outbound_email"] is None
            elif p["id"] == "scenario_2":
                assert "R2_IN_GSTIN_STATE" in rule_ids_failed
                assert "R4_DOCUMENT_VALIDITY" in rule_ids_failed
                assert res["outbound_email"] is not None
                assert "Delhi" in res["outbound_email"]["body"]
                assert "2025-03-31" in res["outbound_email"]["body"]
            elif p["id"] == "scenario_3":
                assert "R2_IN_PAN_CONSTITUTION" in rule_ids_failed
                assert "R3_CRITICAL_FRAUD_MISMATCH" in rule_ids_failed
                assert res["outbound_email"] is not None
            elif p["id"] == "scenario_4a":
                assert "R1_BANK_DOC_TYPE" in rule_ids_failed
                assert "R2_CROSS_BORDER_POLICY" in rule_ids_failed
                assert res["outbound_email"] is not None
            elif p["id"] == "scenario_4b":
                assert len(rule_ids_failed) == 0
                assert len(res["audit_notes"]) >= 1
                assert "DBA" in res["audit_notes"][0]
                assert res["outbound_email"] is None

            # Verify 4 stages present
            assert len(res["stages"]) == 4

            print(
                f"[PASS] {p['id']:12s} -> {actual:8s} ({res['total_latency_ms']} ms) | "
                f"Failed rules: {sorted(rule_ids_failed) or 'None'} | "
                f"Audit notes: {len(res['audit_notes'])}"
            )

        # 5. Test streaming SSE endpoint on scenario_2
        s2 = next(p for p in presets if p["id"] == "scenario_2")
        s2_form = dict(s2["form_data"])
        s2_form["tax_preset_file"] = s2["files"]["tax_document"]
        s2_form["bank_preset_file"] = s2["files"]["bank_document"]
        s2_form["compliance_preset_file"] = s2["files"]["compliance_document"]
        r_stream = await client.post("/api/onboard/stream", data=s2_form)
        assert r_stream.status_code == 200
        sse_events = [
            json.loads(line[6:])
            for line in r_stream.text.splitlines()
            if line.startswith("data: ")
        ]
        event_types = [e["event"] for e in sse_events]
        assert event_types.count("stage_start") == 4
        assert event_types.count("stage_complete") == 4
        assert event_types[-1] == "complete"
        streamed_id = sse_events[-1]["result"]["submission_id"]
        print(f"[PASS] SSE stream emitted {len(sse_events)} events (run {streamed_id}).")

        # 6. Test send-email dispatch endpoint
        r_send = await client.post(f"/api/submissions/{streamed_id}/send-email")
        assert r_send.status_code == 200
        assert r_send.json()["submission"]["outbound_email"]["dispatched"] is True
        print(f"[PASS] Remediation email dispatch recorded for {streamed_id}.")

        # 7. Test Rule 5: Duplicate Bank Account Detection under different entity name
        s1 = next(p for p in presets if p["id"] == "scenario_1")
        dup_form = dict(s1["form_data"])
        dup_form["legal_entity_name"] = "Shell Imposter Trading Pvt Ltd"
        dup_form["bank_account_holder"] = "Shell Imposter Trading Pvt Ltd"
        dup_form["tax_preset_file"] = s1["files"]["tax_document"]
        dup_form["bank_preset_file"] = s1["files"]["bank_document"]
        r_dup = await client.post("/api/onboard", data=dup_form)
        assert r_dup.status_code == 200
        dup_res = r_dup.json()
        dup_failed = {
            c["rule_id"] for c in dup_res["rule_checks"] if c["status"] == "FAIL"
        }
        assert "R5_DUPLICATE_BANK_ACCOUNT" in dup_failed
        assert dup_res["decision"] == "REJECTED"
        print("[PASS] Rule 5 Duplicate Bank Account blocked under different vendor entity.")

        # 7b. Confirm legitimate Scenario 1 still approves after a REJECTED imposter attempt
        s1_re = dict(s1["form_data"])
        s1_re["tax_preset_file"] = s1["files"]["tax_document"]
        s1_re["bank_preset_file"] = s1["files"]["bank_document"]
        s1_re["compliance_preset_file"] = s1["files"]["compliance_document"]
        r_s1_re = await client.post("/api/onboard", data=s1_re)
        assert r_s1_re.status_code == 200
        assert r_s1_re.json()["decision"] == "APPROVED"
        print("[PASS] Scenario 1 still APPROVED after rejected imposter attempt.")

        # 8. Test Dashboard KPIs & list endpoint
        r_list = await client.get("/api/submissions")
        assert r_list.status_code == 200
        kpis = r_list.json()["kpis"]
        print("[PASS] Audit Dashboard KPIs:", kpis)

        # Verify Vite frontend index.html renders cleanly when hitting live URL
        if base_url:
            r_ui = await client.get("/")
            assert r_ui.status_code == 200
            assert "Vendorcheck" in r_ui.text
            print("[PASS] Live Frontend UI served cleanly at", base_url)

        print("\nALL BACKEND & E2E VERIFICATION TESTS PASSED!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=None, help="Live server base URL (e.g. http://127.0.0.1:8000)")
    args = parser.parse_args()
    asyncio.run(run_tests(args.url))
